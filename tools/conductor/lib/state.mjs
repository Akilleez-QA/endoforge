// The Conductor's durable state: one JSON file per job (<jobdir>/conductor/state.json), written atomically under its
// lock, so the daemon resumes after an app restart or a reboot exactly where it was (P4: state outlives processes).
// First principle (NOTES "The missing layer"): deterministic mechanism lives in code that never sleeps; judgment lives
// in a model, called only when judgment is needed.
//
// Phases, POODO as a state machine:
//   staged → go (the user's go on the staged card) → smoke → fired → streaming (per-atom loops) → gates →
//   locks (human taste locks) → finals → compose → done
// `finals` and `compose` run only when the job declares them (job.conductor.finals / .compose); any phase may end in
// `done` when the job is stopped.
import fs from 'node:fs';
import path from 'node:path';
import { withLock, writeJSONAtomic } from '../../lib/lock.mjs';

export const SCHEMA = 'endoforge/conductor/1';
export const PHASES = ['staged', 'go', 'smoke', 'fired', 'streaming', 'gates', 'locks', 'finals', 'compose', 'done'];
export const ATOM_STATUS = ['pending', 'launched', 'landed', 'checking', 'frozen', 'relaunch', 'needs-coordinator', 'locked', 'failed'];
export const SETTLED = ['frozen', 'locked'];

export const stateDir = (job, file) => job.conductor?.dir ?? path.join(path.dirname(path.resolve(file)), 'conductor');
export const stateFile = (job, file) => path.join(stateDir(job, file), 'state.json');

export function initState(job) {
  const c = job.conductor ?? {};
  return {
    schema: SCHEMA, job: job.id, phase: 'staged', paused: false, stopped: null,
    budget: { maxIterations: c.maxIterations ?? 3, maxLaunches: c.maxLaunches ?? 200, launches: 0 },
    atoms: Object.fromEntries((job.atoms ?? []).map((a) => [a.id, { status: 'pending', iter: 0, history: [] }])),
    escalations: [], log: [], createdAt: new Date().toISOString(),
  };
}

export function loadState(job, file) {
  try { return JSON.parse(fs.readFileSync(stateFile(job, file), 'utf8')); } catch { return initState(job); }
}

/** Read-modify-write under the state lock. fn mutates the state; the result is written atomically and returned. */
export function updateState(job, file, fn) {
  const f = stateFile(job, file);
  return withLock(f, () => {
    const s = loadState(job, file);
    fn(s);
    s.updatedAt = new Date().toISOString();
    writeJSONAtomic(f, s);
    return s;
  });
}

/** The phase after `from` for this job (finals and compose only when declared). */
export function nextPhase(from, job) {
  const skip = new Set([...(job.conductor?.finals ? [] : ['finals']), ...(job.conductor?.compose ? [] : ['compose'])]);
  let i = PHASES.indexOf(from);
  if (i < 0) throw new Error(`unknown phase ${from}`);
  do i++; while (i < PHASES.length && skip.has(PHASES[i]));
  return PHASES[Math.min(i, PHASES.length - 1)];
}

/** Move to `to`: only the next phase, or `done` when stopped. Anything else is a bug and throws. */
export function transition(s, job, to, why) {
  const legal = to === nextPhase(s.phase, job) || (to === 'done' && s.stopped);
  if (!legal) throw new Error(`illegal transition ${s.phase} → ${to}`);
  s.log.push({ at: new Date().toISOString(), from: s.phase, to, why });
  s.phase = to;
  return s;
}

/** True when every atom is frozen or locked (streaming is over). */
export const allSettled = (s) => Object.values(s.atoms).every((a) => SETTLED.includes(a.status));
