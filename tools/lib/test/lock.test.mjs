import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { acquire, withLock, writeJSONAtomic, LockBusy } from '../lock.mjs';

const LOCK = fileURLToPath(new URL('../lock.mjs', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-lock-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const deadPid = () => { const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }); return Number(r.stdout); };

test('acquire makes <target>.lock with the owner pid, host and time, and the release removes it', () => {
  const target = path.join(tmp, 'a', 'state.json');
  const release = acquire(target);
  const owner = JSON.parse(fs.readFileSync(`${target}.lock/owner`, 'utf8'));
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.host, os.hostname());
  assert.ok(!Number.isNaN(Date.parse(owner.at)));
  release();
  assert.equal(fs.existsSync(`${target}.lock`), false);
});

test('a held lock makes a second acquire wait and then throw LockBusy with exit code 75', () => {
  const target = path.join(tmp, 'busy');
  const release = acquire(target);
  try {
    const start = Date.now();
    assert.throws(() => acquire(target, { waitMs: 150, pollMs: 20 }), e => e instanceof LockBusy && e.exitCode === 75 && e.message.includes(`pid ${process.pid}`));
    assert.ok(Date.now() - start >= 150);
  } finally { release(); }
});

test('a lock whose owner pid is dead on this host is reclaimed at once', () => {
  const target = path.join(tmp, 'dead');
  fs.mkdirSync(`${target}.lock`);
  fs.writeFileSync(`${target}.lock/owner`, JSON.stringify({ pid: deadPid(), host: os.hostname(), at: new Date().toISOString() }));
  const release = acquire(target, { waitMs: 0 });
  assert.equal(JSON.parse(fs.readFileSync(`${target}.lock/owner`, 'utf8')).pid, process.pid);
  release();
});

test('a dead pid on another host is not reclaimed', () => {
  const target = path.join(tmp, 'remote');
  fs.mkdirSync(`${target}.lock`);
  fs.writeFileSync(`${target}.lock/owner`, JSON.stringify({ pid: deadPid(), host: `${os.hostname()}-other`, at: new Date().toISOString() }));
  assert.throws(() => acquire(target, { waitMs: 50, pollMs: 10 }), LockBusy);
  fs.rmSync(`${target}.lock`, { recursive: true });
});

test('an ownerless lock is reclaimed only once it is older than orphanMs', () => {
  const target = path.join(tmp, 'orphan');
  fs.mkdirSync(`${target}.lock`);
  assert.throws(() => acquire(target, { waitMs: 50, pollMs: 10, orphanMs: 60_000 }), LockBusy);
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(`${target}.lock`, old, old);
  const release = acquire(target, { waitMs: 0, orphanMs: 60_000 });
  assert.equal(JSON.parse(fs.readFileSync(`${target}.lock/owner`, 'utf8')).pid, process.pid);
  release();
});

test('withLock returns the result and releases the lock when fn throws', () => {
  const target = path.join(tmp, 'with');
  assert.equal(withLock(target, () => 7), 7);
  assert.equal(fs.existsSync(`${target}.lock`), false);
  assert.throws(() => withLock(target, () => { throw new Error('boom'); }), /boom/);
  assert.equal(fs.existsSync(`${target}.lock`), false);
});

test('withLock serialises read-modify-write across processes, so no update is lost', async () => {
  const counter = path.join(tmp, 'counter.json');
  writeJSONAtomic(counter, { n: 0 });
  const body = `import fs from 'node:fs';
import { withLock, writeJSONAtomic } from ${JSON.stringify(LOCK)};
for (let i = 0; i < 25; i++) withLock(${JSON.stringify(counter)}, () => {
  const { n } = JSON.parse(fs.readFileSync(${JSON.stringify(counter)}, 'utf8'));
  writeJSONAtomic(${JSON.stringify(counter)}, { n: n + 1 });
}, { pollMs: 1 });`;
  const runs = Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', body], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; child.stderr.on('data', d => { err += d; });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`child exited ${code}: ${err}`))));
  }));
  await Promise.all(runs);
  assert.deepEqual(JSON.parse(fs.readFileSync(counter, 'utf8')), { n: 100 });
});

test('writeJSONAtomic writes indented JSON with a trailing newline, creates the directory and leaves no temp file', () => {
  const file = path.join(tmp, 'deep', 'er', 'out.json');
  writeJSONAtomic(file, { a: [1, 2] });
  assert.equal(fs.readFileSync(file, 'utf8'), `${JSON.stringify({ a: [1, 2] }, null, 1)}\n`);
  writeJSONAtomic(file, { a: 3 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 3 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['out.json']);
});

test('writeJSONAtomic removes its temp file and keeps the old content when the value cannot be serialised', () => {
  const file = path.join(tmp, 'keep.json');
  writeJSONAtomic(file, { ok: true });
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => writeJSONAtomic(file, cyclic), TypeError);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ok: true });
  assert.deepEqual(fs.readdirSync(tmp).filter(n => n.startsWith('keep.json.tmp')), []);
});
