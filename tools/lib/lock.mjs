// Locks for every shared mutable file (NOTES #34, #35: two collects on one branch; two writers on one manifest).
// A lock is a directory <path>.lock holding its owner's pid and host; mkdir is atomic, a dead owner's lock is
// reclaimed by rename (one reclaimer wins), and a waiter gives up with a typed transient error after `waitMs`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export class LockBusy extends Error { constructor(m) { super(m); this.name = 'LockBusy'; this.exitCode = 75; } }

export function acquire(target, { waitMs = 60_000, pollMs = 100, owner = process.pid } = {}) {
  const dir = `${target}.lock`, deadline = Date.now() + waitMs;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  for (;;) {
    try { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'owner'), JSON.stringify({ pid: owner, host: os.hostname(), at: new Date().toISOString() })); return () => fs.rmSync(dir, { recursive: true, force: true }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    let o = null; try { o = JSON.parse(fs.readFileSync(path.join(dir, 'owner'), 'utf8')); } catch {}
    if (o && o.host === os.hostname() && !alive(o.pid)) { try { const t = `${dir}.stale-${process.pid}`; fs.renameSync(dir, t); fs.rmSync(t, { recursive: true, force: true }); } catch {} continue; }
    if (Date.now() > deadline) throw new LockBusy(`${target} is locked by pid ${o?.pid ?? '?'} since ${o?.at ?? '?'}`);
    sleepSync(pollMs);
  }
}
/** Run fn while holding the lock on target; always released. */
export function withLock(target, fn, opts) { const release = acquire(target, opts); try { return fn(); } finally { release(); } }
/** Write JSON atomically (temp file + rename), so a reader never sees half a file. */
export function writeJSONAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(value, null, 1) + '\n'); fs.renameSync(tmp, file);
}
