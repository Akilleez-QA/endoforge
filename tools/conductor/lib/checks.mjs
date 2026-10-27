// Per-atom streaming checks: after an atom's change passes the collect gate, produce ONLY its slice and run ITS
// checks, then freeze it or relaunch it at once with the findings. No barrier: each atom climbs on its own. The tool
// never knows what a check measures; checks are data in the manifest:
//
// conductor.slice.command  command (string or argv) that produces one atom's slice (whatever the job inspects) in
//                          ${out}; ${atom}, ${repo}, ${files}
// conductor.checks         [{ id, run, atoms?, json? }]: run with ${input} = the slice dir, ${atom}, ${files} = the
//                          atom's own files, ${out} = a JSON result path. Pass is exit 0, or, with json: true, the
//                          file's `pass`; a JSON check may give `fix` and `findings`, which go into the next prompt.
//                          `atoms` limits it to some atoms (default: all).
// Typed errors: 75 waits; 78 stops the job; a check that cannot run (still busy, no result file) is "not scored".
import fs from 'node:fs';
import path from 'node:path';
import { runTypedAsync, StopError } from '../../lib/errors.mjs';
import { stateDir } from './state.mjs';

const expandAll = (cmd, vars) => {
  const sub = (x) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`\${${k}}`, v), x);
  return Array.isArray(cmd) ? cmd.map(sub) : ['sh', '-c', sub(cmd)];
};
const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** Render the atom's slice, run its checks, and return { pass } | { pass: false, feedback, findings } | { unscored, why }. */
export async function checkAtom(ctx, id) {
  const { job, file } = ctx, c = job.conductor ?? {}, st = ctx.update(() => {}).atoms[id];
  const out = path.join(stateDir(job, file), 'slices', id, `i${st.iter}`); fs.mkdirSync(out, { recursive: true });
  const wait = { maxWaitMs: (c.busyWaitSec ?? 900) * 1000, baseMs: (c.busyBaseSec ?? 2) * 1000, cwd: job.repo };
  if (c.slice?.command) {
    const r = await runTypedAsync(expandAll(c.slice.command, { atom: id, out, repo: job.repo, files: ((job.atoms ?? []).find((a) => a.id === id)?.files ?? []).join(' ') }), { ...wait, timeout: (c.slice.timeoutSec ?? 900) * 1000 });
    if (r.kind === 'stop') throw new StopError(`slice command for ${id} exited 78`);
    if (r.kind === 'transient') return { unscored: true, why: `slice command still busy after ${Math.round(r.waitedMs / 1000)} s` };
    if (r.kind !== 'ok') return { pass: false, feedback: `The slice command failed on your change (exit ${r.status}). Fix this first:\n${(r.stdout + r.stderr).trim().slice(-1200)}`, findings: [{ check: 'slice', exit: r.status }] };
  }
  const checks = (c.checks ?? []).filter((k) => !k.atoms || k.atoms.includes(id));
  const results = await Promise.all(checks.map(async (k) => {
    const res = path.join(out, `${k.id}.json`); fs.rmSync(res, { force: true });
    const files = ((job.atoms ?? []).find((a) => a.id === id)?.files ?? []).join(' ');
    const r = await runTypedAsync(expandAll(k.run, { atom: id, input: out, out: res, repo: job.repo, files }), { ...wait, timeout: (k.timeoutSec ?? 900) * 1000 });
    if (r.kind === 'stop') throw new StopError(`check ${k.id} for ${id} exited 78`);
    if (r.kind === 'transient') return { id: k.id, unscored: `still busy after ${Math.round(r.waitedMs / 1000)} s` };
    if (!k.json) return { id: k.id, pass: r.kind === 'ok', fix: r.kind === 'ok' ? null : (r.stdout + r.stderr).trim().slice(-800) };
    const j = readJSON(res);
    if (!j || typeof j.pass !== 'boolean') return { id: k.id, unscored: `no result in ${res} (exit ${r.status})` };
    return { id: k.id, pass: j.pass, fix: j.fix ?? null, findings: j.findings ?? j.elements ?? [], score: j.total ?? j.score ?? null };
  }));
  fs.writeFileSync(path.join(out, 'verdict.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((x) => x.pass === false), un = results.filter((x) => x.unscored);
  if (failed.length) return { pass: false, findings: failed, feedback: `Iteration ${st.iter} failed its checks. Fix first:\n${failed.map((x) => `- ${x.id}: ${x.fix ?? 'failed'}${x.findings?.length ? ` (${JSON.stringify(x.findings).slice(0, 400)})` : ''}`).join('\n')}` };
  if (un.length) return { unscored: true, why: un.map((x) => `${x.id} ${x.unscored}`).join('; ') };
  return { pass: true, why: checks.length ? `passed ${checks.map((k) => k.id).join(', ')}` : 'collect gate passed (no slice checks)' };
}
