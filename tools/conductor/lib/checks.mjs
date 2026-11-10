import fs from 'node:fs';
import path from 'node:path';
import { runTypedAsync, StopError } from '../../lib/errors.mjs';
import { stateDir } from './state.mjs';
import { writeJSONAtomic } from '../../lib/lock.mjs';

const expandAll = (cmd, vars) => {
  const sub = (x) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`\${${k}}`, v), x);
  return Array.isArray(cmd) ? cmd.map(sub) : ['sh', '-c', sub(cmd)];
};
const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
function readRubric(f) {
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? null : { unreadable: e.message }; }
  try { const r = JSON.parse(raw); return Array.isArray(r?.items) ? r : { unreadable: 'it has no item list' }; } catch (e) { return { unreadable: e.message }; }
}
export function items(findings, itemPass = 1) {
  const out = {};
  for (const f of findings ?? []) {
    if (!f || f.name == null) continue;
    if (typeof f.pass === 'boolean') out[f.name] = f.pass;
    else if (typeof f.score === 'number') out[f.name] = f.score >= itemPass;
  }
  return out;
}
const same = (a, b) => JSON.stringify(Object.keys(a).sort().map((k) => [k, a[k]])) === JSON.stringify(Object.keys(b).sort().map((k) => [k, b[k]]));

async function runOnce(k, vars, wait) {
  if (k.measure != null) {
    const r = await runTypedAsync(expandAll(k.measure, vars), { ...wait, timeout: (k.timeoutSec ?? 900) * 1000 });
    if (r.kind === 'stop') throw new StopError(`check ${k.id} for ${vars.atom} exited 78`);
    if (r.kind !== 'ok') return { unscored: `measure ${r.kind === 'transient' ? 'still busy' : `exited ${r.status}`}` };
    const v = Number(/(-?\d+(?:\.\d+)?)\s*$/.exec(r.stdout.trim())?.[1]);
    if (!Number.isFinite(v)) return { unscored: `measure printed no number (${r.stdout.trim().slice(-80)})` };
    const ok = Math.abs(v - k.target) <= (k.tolerance ?? 0);
    return { pass: ok, value: v, fix: ok ? null : `measured ${v}, target ${k.target} ± ${k.tolerance ?? 0}`, findings: [{ name: k.id, pass: ok, value: v }] };
  }
  fs.rmSync(vars.out, { force: true });
  const r = await runTypedAsync(expandAll(k.run, vars), { ...wait, timeout: (k.timeoutSec ?? 900) * 1000 });
  if (r.kind === 'stop') throw new StopError(`check ${k.id} for ${vars.atom} exited 78`);
  if (r.kind === 'transient') return { unscored: `still busy after ${Math.round(r.waitedMs / 1000)} s` };
  if (!k.json) return { pass: r.kind === 'ok', fix: r.kind === 'ok' ? null : (r.stdout + r.stderr).trim().slice(-800) };
  const j = readJSON(vars.out);
  if (!j || typeof j.pass !== 'boolean') return { unscored: `no result in ${vars.out} (exit ${r.status})` };
  return { pass: j.pass, fix: j.fix ?? null, findings: j.findings ?? j.elements ?? [] };
}

export function atomChecks(job, id) {
  const configured = (job.conductor?.checks ?? []).filter((k) => !k.atoms || k.atoms.includes(id));
  if (configured.length) return configured;
  const atom = (job.atoms ?? []).find((a) => a.id === id);
  return (atom?.checks ?? []).map((cid) => (job.criteria ?? []).find((c) => c.id === cid))
    .filter((c) => c?.check?.run && c.check.kind !== 'human').map((c) => ({ id: c.id, run: c.check.run }));
}
export async function checkAtom(ctx, id) {
  const { job, file } = ctx, c = job.conductor ?? {}, st = ctx.update(() => {}).atoms[id];
  const dir = path.join(stateDir(job, file), 'slices', id), out = path.join(dir, `i${st.iter}`); fs.mkdirSync(out, { recursive: true });
  const files = ((job.atoms ?? []).find((a) => a.id === id)?.files ?? []).join(' ');
  const wait = { maxWaitMs: (c.busyWaitSec ?? 900) * 1000, baseMs: (c.busyBaseSec ?? 2) * 1000, cwd: job.repo };
  if (c.slice?.command) {
    const r = await runTypedAsync(expandAll(c.slice.command, { atom: id, out, repo: job.repo, files }), { ...wait, timeout: (c.slice.timeoutSec ?? 900) * 1000 });
    if (r.kind === 'stop') throw new StopError(`slice command for ${id} exited 78`);
    if (r.kind === 'transient') return { unscored: true, why: `slice command still busy after ${Math.round(r.waitedMs / 1000)} s` };
    if (r.kind !== 'ok') return { pass: false, feedback: `The slice command failed on your change (exit ${r.status}). Fix this first:\n${(r.stdout + r.stderr).trim().slice(-1200)}`, findings: [{ check: 'slice', exit: r.status }] };
  }
  const checks = atomChecks(job, id);
  const results = await Promise.all(checks.map(async (k) => {
    const rubric = path.join(dir, `rubric-${k.id}.json`), vars = { atom: id, input: out, out: path.join(out, `${k.id}.json`), repo: job.repo, files, rubric };
    const r = await runOnce(k, vars, wait);
    if (r.unscored) return { id: k.id, unscored: r.unscored };
    const it = items(r.findings, k.itemPass);
    if ((k.noiseRuns ?? 1) > 1) {
      const r2 = await runOnce(k, { ...vars, out: path.join(out, `${k.id}.2.json`) }, wait);
      if (!r2.unscored && (r2.pass !== r.pass || !same(items(r2.findings, k.itemPass), it))) return { id: k.id, unstable: 'two runs on the same slice disagree' };
    }
    if (Object.keys(it).length) {
      const frozen = readRubric(rubric);
      if (frozen?.unreadable) return { id: k.id, unstable: `its frozen item list ${rubric} is unreadable (${frozen.unreadable}); restore or remove it` };
      if (!frozen) writeJSONAtomic(rubric, { check: k.id, items: Object.keys(it).sort(), frozenAt: new Date().toISOString() });
      else if (JSON.stringify(frozen.items) !== JSON.stringify(Object.keys(it).sort())) return { id: k.id, unstable: `its item list changed (${frozen.items.join(', ')} → ${Object.keys(it).sort().join(', ')}); it must re-score the frozen items in ${rubric}` };
    }
    const before = st.items?.[k.id] ?? {};
    const regressed = Object.keys(before).filter((n) => before[n] && it[n] === false), improved = Object.keys(it).filter((n) => it[n] && !before[n]);
    return { id: k.id, pass: r.pass, fix: r.fix, findings: r.findings ?? [], items: it, regressed, improved, ...(r.value != null ? { value: r.value } : {}) };
  }));
  fs.writeFileSync(path.join(out, 'verdict.json'), JSON.stringify(results, null, 1));
  const unstable = results.filter((x) => x.unstable);
  if (unstable.length) return { unscored: true, unstable: unstable.map((x) => x.id), why: unstable.map((x) => `${x.id} is unstable: ${x.unstable}`).join('; ') };
  const scored = results.filter((x) => !x.unscored), failed = scored.filter((x) => x.pass === false), un = results.filter((x) => x.unscored);
  const itemsNow = Object.fromEntries(scored.filter((x) => x.items && Object.keys(x.items).length).map((x) => [x.id, x.items]));
  const regressed = scored.flatMap((x) => (x.regressed ?? []).map((n) => `${x.id}: ${n}`)), improved = scored.flatMap((x) => (x.improved ?? []).map((n) => `${x.id}: ${n}`));
  const keep = scored.flatMap((x) => Object.entries(x.items ?? {}).filter(([, p]) => p).map(([n]) => `${x.id}: ${n}`));
  const common = { items: itemsNow, regressed, improved, findings: failed };
  if (failed.length || regressed.length) {
    return { pass: false, ...common, feedback: [`Iteration ${st.iter} failed its checks. Fix first:`, ...failed.map((x) => `- ${x.id}: ${x.fix ?? 'failed'}${x.findings?.length ? ` (${JSON.stringify(x.findings).slice(0, 400)})` : ''}`),
      ...(regressed.length ? [`These passed before and REGRESSED; restore them: ${regressed.join('; ')}`] : []),
      ...(keep.length ? [`Keep passing (do not regress): ${keep.join('; ')}`] : [])].join('\n') };
  }
  if (un.length) return { unscored: true, why: un.map((x) => `${x.id} ${x.unscored}`).join('; '), items: itemsNow };
  return { pass: true, ...common, why: checks.length ? `passed ${checks.map((k) => k.id).join(', ')}` : 'collect gate passed (no slice checks)' };
}
