// Per-atom streaming checks: after an atom's change passes the collect gate, produce ONLY its slice and run ITS
// checks, then freeze it or relaunch it at once with the findings. No barrier: each atom climbs on its own. The tool
// never knows what a check measures; checks are data in the manifest:
//
// conductor.slice.command  command (string or argv) that produces one atom's slice in ${out}; ${atom}, ${repo}, ${files}
// conductor.checks         [{ id, atoms?, … }] in one of three forms:
//   { run }                        pass is exit 0
//   { run, json: true }            pass is the result file's `pass`; `fix` and `findings` (judged items:
//                                  { name, pass } or { name, score }, passing at score ≥ itemPass, default 1) go into
//                                  the next prompt
//   { measure, target, tolerance } an observable outcome, measured (U2): the command prints a number; pass is
//                                  |value − target| ≤ tolerance. Measure the outcome, not the input.
//   Vars: ${input} the slice dir, ${out} the JSON result path, ${atom}, ${files}, ${repo}, ${rubric} (see U5).
// U5 stable measures: a check that returns judged items freezes its item list on first use (rubric-<check>.json) and
//   must re-score exactly those items; a changed list, or two runs that disagree (noiseRuns: 2), mark the check
//   unstable: it is not acted on, and the coordinator is told.
// U6 per-item ratchet: items that passed before are a keep-list; the result says which regressed and which improved.
// Typed errors: 75 waits; 78 stops the job; a check that cannot run is "not scored".
import fs from 'node:fs';
import path from 'node:path';
import { runTypedAsync, StopError } from '../../lib/errors.mjs';
import { stateDir } from './state.mjs';

const expandAll = (cmd, vars) => {
  const sub = (x) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`\${${k}}`, v), x);
  return Array.isArray(cmd) ? cmd.map(sub) : ['sh', '-c', sub(cmd)];
};
const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
/** Judged items as { name: true|false }; items without a verdict (no pass, no numeric score) are left out. */
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

/** Produce the atom's slice, run its checks, and return { pass, items, regressed, improved } | { pass: false, feedback, … }
 *  | { unscored, why, unstable? }. The atom's last items per check are its keep-list. */
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
  const checks = (c.checks ?? []).filter((k) => !k.atoms || k.atoms.includes(id));
  const results = await Promise.all(checks.map(async (k) => {
    const rubric = path.join(dir, `rubric-${k.id}.json`), vars = { atom: id, input: out, out: path.join(out, `${k.id}.json`), repo: job.repo, files, rubric };
    const r = await runOnce(k, vars, wait);
    if (r.unscored) return { id: k.id, unscored: r.unscored };
    const it = items(r.findings, k.itemPass);
    if ((k.noiseRuns ?? 1) > 1) {                                   // U5: the check's own run-to-run noise
      const r2 = await runOnce(k, { ...vars, out: path.join(out, `${k.id}.2.json`) }, wait);
      if (!r2.unscored && (r2.pass !== r.pass || !same(items(r2.findings, k.itemPass), it))) return { id: k.id, unstable: 'two runs on the same slice disagree' };
    }
    if (Object.keys(it).length) {                                   // U5: freeze the item list on first use
      const frozen = readJSON(rubric);
      if (!frozen) fs.writeFileSync(rubric, JSON.stringify({ check: k.id, items: Object.keys(it).sort(), frozenAt: new Date().toISOString() }, null, 1));
      else if (JSON.stringify(frozen.items) !== JSON.stringify(Object.keys(it).sort())) return { id: k.id, unstable: `its item list changed (${frozen.items.join(', ')} → ${Object.keys(it).sort().join(', ')}); it must re-score the frozen items in ${rubric}` };
    }
    const before = st.items?.[k.id] ?? {};                          // U6: the keep-list
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
