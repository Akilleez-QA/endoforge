import { spawnSync } from 'node:child_process';

export const EXIT = { OK: 0, FAIL: 1, USAGE: 2, TRANSIENT: 75, STOP: 78, TIMEOUT: 124 };

export function classify(status) {
  if (status === 0) return 'ok';
  if (status === EXIT.TRANSIENT) return 'transient';
  if (status === EXIT.STOP) return 'stop';
  return 'fail';
}

export class StopError extends Error {
  constructor(message) { super(message); this.name = 'StopError'; this.exitCode = EXIT.STOP; }
}

export const unscored = (why) => ({ scored: false, why });
export const isScored = (x) => x != null && x.scored !== false;

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

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

export async function runTypedAsync(argv, { maxWaitMs = 600_000, baseMs = 2000, capMs = 60_000, timeout = 0, log = () => {}, ...spawnOpts } = {}) {
  const { spawn } = await import('node:child_process');
  let attempts = 0, waited = 0, delay = baseMs;
  for (;;) {
    attempts++;
    const r = await new Promise((resolve) => {
      let out = '', err = '', timer = null;
      const c = spawn(argv[0], argv.slice(1), { ...spawnOpts, stdio: ['ignore', 'pipe', 'pipe'] });
      c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
      if (timeout) timer = setTimeout(() => c.kill('SIGTERM'), timeout);
      c.on('error', (e) => { clearTimeout(timer); resolve({ status: null, out, err: err + e.message }); });
      c.on('close', (status) => { clearTimeout(timer); resolve({ status, out, err }); });
    });
    const kind = classify(r.status);
    if (kind !== 'transient' || waited + delay > maxWaitMs) return { status: r.status, kind, attempts, waitedMs: waited, stdout: r.out, stderr: r.err };
    log(`${argv[0]} is busy (exit 75); retrying in ${Math.round(delay / 1000)} s (attempt ${attempts})`);
    await new Promise((res) => setTimeout(res, delay)); waited += delay; delay = Math.min(delay * 2, capMs);
  }
}
