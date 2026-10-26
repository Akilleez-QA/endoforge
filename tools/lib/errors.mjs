// One error taxonomy for every Endoforge tool (P-E: "errors are typed"; NOTES #1, #32, #33). The exit codes are the
// fleet's: 75 (EX_TEMPFAIL) means transient — a busy guard, a queue, a rate-limited pool — so wait and retry with
// backoff; 78 (EX_CONFIG) means stop loudly — a fault latch, an unsafe or missing state — and never retry; anything
// else non-zero is a failure of the thing itself. A gate or eval that could not run is "unscored", never a number.
import { spawnSync } from 'node:child_process';

export const EXIT = { OK: 0, FAIL: 1, USAGE: 2, TRANSIENT: 75, STOP: 78, TIMEOUT: 124 };

/** 'ok' | 'transient' | 'stop' | 'fail' for an exit status (null status from a signal or spawn error is a failure). */
export function classify(status) {
  if (status === 0) return 'ok';
  if (status === EXIT.TRANSIENT) return 'transient';
  if (status === EXIT.STOP) return 'stop';
  return 'fail';
}

/** Raised when a step reports 78: the caller stops the whole job, loudly, with exit 78. */
export class StopError extends Error {
  constructor(message) { super(message); this.name = 'StopError'; this.exitCode = EXIT.STOP; }
}

/** A gate or eval that could not run. It is reported as "not scored" and never compared as a number. */
export const unscored = (why) => ({ scored: false, why });
export const isScored = (x) => x != null && x.scored !== false;

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Run argv; on 75 wait with exponential backoff (base, doubling, capped) and retry until maxWaitMs has passed.
 *  Returns { status, kind, attempts, waitedMs, stdout, stderr }. 78 and failures return at once. */
export function runTyped(argv, { maxWaitMs = 600_000, baseMs = 2000, capMs = 60_000, sleep = sleepSync, log = () => {}, ...spawnOpts } = {}) {
  let attempts = 0, waited = 0, delay = baseMs;
  for (;;) {
    attempts++;
    const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', ...spawnOpts });
    const kind = r.error ? 'fail' : classify(r.status);
    if (kind !== 'transient' || waited + delay > maxWaitMs) return { status: r.error ? null : r.status, kind, attempts, waitedMs: waited, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? r.error.message : '') };
    log(`${argv[0]} is busy (exit 75); retrying in ${Math.round(delay / 1000)} s (attempt ${attempts})`);
    sleep(delay); waited += delay; delay = Math.min(delay * 2, capMs);
  }
}
