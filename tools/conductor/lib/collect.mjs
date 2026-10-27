// The collect gate (P-B: check each change the moment it lands, before anything builds on it). Ported from the live
// /mnt/cold-steam/factory-scratch/mrton/fanout.py collect. One writer on the integration branch (an exclusive lock
// around the whole apply-gate-commit, from any caller). Per atom:
//   diff its OWN files from its lane base (new files included) → apply → run its gate → commit,
//   or revert ONLY this atom and write the exact error to gates/<atom>-i<iter>.gate.json for its next prompt.
// The gate is the atom's `gate` (or conductor.gate), run in the integration repo with ${atom} expanded; a busy gate
// (75) waits, 78 stops the job.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { withLock, writeJSONAtomic } from '../../lib/lock.mjs';
import { runTyped, StopError } from '../../lib/errors.mjs';
import { stateDir } from './state.mjs';

const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
const ok = (r, what) => { if (r.status !== 0) throw new Error(`${what}: ${r.stderr.trim()}`); return r.stdout.trim(); };
const inFiles = (p, files) => files.some((f) => p === f || p.startsWith(f.replace(/\/$/, '') + '/'));

export const gateFile = (job, file, id, iter) => path.join(stateDir(job, file), 'gates', `${id}-i${iter}.gate.json`);
export const collectLock = (job) => path.join(job.repo, '.git', 'endoforge-collect');

export function collectAtom(job, file, st, id, { waitMs = 600_000 } = {}) {
  const a = (job.atoms ?? []).find((x) => x.id === id), files = a.files, lane = st.lane, gf = gateFile(job, file, id, st.iter);
  return withLock(collectLock(job), () => {
    if (git(job.repo, 'diff', '--cached', '--quiet').status !== 0) throw new Error(`${job.repo} has staged changes; one writer: commit or unstage them first`);
    const untracked = ok(git(lane.worktree, 'ls-files', '--others', '--exclude-standard', '--', ...files), 'ls-files').split('\n').filter(Boolean);
    if (untracked.length) ok(git(lane.worktree, 'add', '-N', '--', ...untracked), 'add -N');
    const diff = git(lane.worktree, 'diff', '--binary', lane.base, '--', ...files).stdout;
    const links = (job.conductor?.links ?? []).map((l) => l.path);
    const stray = ok(git(lane.worktree, 'status', '--porcelain'), 'status').split('\n').filter(Boolean).map((l) => l.slice(3)).filter((p) => !inFiles(p, files) && !links.includes(p.replace(/\/$/, '')));
    if (!diff) { writeJSONAtomic(gf, { ok: true, change: false, stray }); return { status: 'no-change', stray }; }
    const before = ok(git(job.repo, 'rev-parse', 'HEAD'), 'rev-parse');
    const ap = spawnSync('git', ['-C', job.repo, 'apply', '--3way', '--index', '-'], { input: diff, encoding: 'utf8' });
    if (ap.status !== 0) { revert(job, files, before); return record(gf, { ok: false, stage: 'apply', error: ap.stderr.slice(-1500), stray }); }
    if (git(job.repo, 'diff', '--cached', '--quiet').status === 0) { writeJSONAtomic(gf, { ok: true, change: false, already: true, stray }); return { status: 'no-change', already: true, stray }; }   // already collected
    const gate = a.gate ?? job.conductor?.gate;
    if (gate) {
      const argv = Array.isArray(gate) ? gate.map((x) => x.replaceAll('${atom}', id)) : ['sh', '-c', gate.replaceAll('${atom}', id)];
      const r = runTyped(argv, { cwd: job.repo, maxWaitMs: waitMs, timeout: (job.conductor?.gateTimeoutSec ?? 300) * 1000 });
      if (r.kind === 'stop') { revert(job, files, before); throw new StopError(`gate for ${id} exited 78`); }
      if (r.kind !== 'ok') {
        revert(job, files, before);
        return record(gf, { ok: false, stage: 'gate', command: argv.join(' '), exit: r.status, error: (r.stdout + r.stderr).slice(-1500), stray });
      }
    }
    ok(git(job.repo, 'commit', '-q', '-m', `${job.id} ${id} i${st.iter} (${lane.engine}:${lane.account})`, ...(job.conductor?.trailer ? ['-m', job.conductor.trailer] : [])), 'commit');
    const sha = ok(git(job.repo, 'rev-parse', 'HEAD'), 'rev-parse');
    return record(gf, { ok: true, change: true, sha, stray });
  }, { waitMs });
}

function record(gf, g) { writeJSONAtomic(gf, { ...g, at: new Date().toISOString() }); return { status: g.ok ? 'applied' : 'reverted', ...g }; }

/** Undo ONLY this atom's files in the integration repo: restore tracked ones, delete ones it created. */
function revert(job, files, head) {
  git(job.repo, 'reset', '-q', head, '--', ...files);
  for (const f of files) if (git(job.repo, 'ls-files', '--error-unmatch', '--', f).status === 0) git(job.repo, 'checkout', head, '--', f);
  git(job.repo, 'clean', '-fdq', '--', ...files);                 // files and folders this atom created
}

/** The feedback a reverted atom carries into its next prompt. */
export function gateFeedback(g) {
  if (!g || g.ok) return null;
  return `Your last change was reverted at the collect gate (${g.stage}${g.command ? `: ${g.command}` : ''}). Fix this error first:\n${g.error.trim()}`;
}
