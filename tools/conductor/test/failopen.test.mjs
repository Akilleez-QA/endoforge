import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadJob } from '../../job/lib/load.mjs';
import { readEvents } from '../../job/lib/events.mjs';
import { conduct } from '../lib/daemon.mjs';
import { handlers, idle } from '../lib/handlers.mjs';
import { loadState, updateState, stateFile } from '../lib/state.mjs';
import { laneExit, LOST } from '../lib/launch.mjs';
import { acquire, writeJSONAtomic } from '../../lib/lock.mjs';
import { exitWrapper, readExit } from '../../lib/exitfile.mjs';
import { scratch, sh } from './helpers.mjs';

const CONDUCT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../bin/conduct.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-failopen-'));
let fails = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const exitFile = (name, text) => { const f = path.join(tmp, `${name}.exit`); if (text != null) fs.writeFileSync(f, text); return f; };
const stubCtl = (name, script) => { const f = path.join(tmp, name); fs.writeFileSync(f, `#!/bin/sh\n${script}\n`, { mode: 0o755 }); return f; };
const withCtl = (ctl, fn) => { process.env.ENDOFORGE_SYSTEMCTL = ctl; try { return fn(); } finally { delete process.env.ENDOFORGE_SYSTEMCTL; } };
const deadPid = () => { const r = spawnSync('sh', ['-c', 'echo $$'], { encoding: 'utf8' }); return Number(r.stdout); };

test('an exit file that is empty or garbage is not an exit code', () => {
  for (const text of ['', '\n', 'garbage', '1x']) assert.equal(readExit(exitFile('bad', text)), null, JSON.stringify(text));
  assert.equal(readExit(exitFile('missing')), null);
  assert.equal(readExit(exitFile('ok', '0\n')), 0);
  assert.equal(readExit(exitFile('seven', '7\n')), 7);
});
test('a lane whose process is alive with an empty exit file is still running', () => {
  const live = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  try { assert.equal(laneExit({ lane: { exitFile: exitFile('live', ''), pid: live.pid } }), null); } finally { process.kill(-live.pid, 'SIGKILL'); }
});
test('a lane whose process is gone with an empty or missing exit file ended unknown, never 0', () => {
  assert.equal(laneExit({ lane: { exitFile: exitFile('gone', ''), pid: deadPid() } }), LOST);
  assert.equal(laneExit({ lane: { exitFile: exitFile('none'), pid: deadPid() } }), LOST);
  assert.notEqual(LOST, 0);
});
test('a unit that ended with no exit file reports its own status, or unknown when that says 0', () => {
  const failed = stubCtl('ctl-failed', 'case "$2" in is-active) echo failed; exit 3;; show) echo 7;; esac');
  const gone = stubCtl('ctl-gone', 'case "$2" in is-active) echo inactive; exit 3;; show) echo 0;; esac');
  const live = stubCtl('ctl-live', 'case "$2" in is-active) echo active;; esac');
  withCtl(failed, () => assert.equal(laneExit({ lane: { exitFile: exitFile('u1'), unit: 'u' } }), 7));
  withCtl(gone, () => assert.equal(laneExit({ lane: { exitFile: exitFile('u2'), unit: 'u' } }), LOST));
  withCtl(live, () => assert.equal(laneExit({ lane: { exitFile: exitFile('u3'), unit: 'u' } }), null));
});
test('systemctl failing is not a clean exit of an adopted lane', () => {
  const broken = stubCtl('ctl-broken', 'echo "Failed to connect to bus" >&2; exit 1');
  withCtl(broken, () => assert.equal(laneExit({ lane: { unit: 'u' } }), null));
  const showFails = stubCtl('ctl-show', 'case "$2" in is-active) echo inactive; exit 3;; show) exit 1;; esac');
  withCtl(showFails, () => assert.equal(laneExit({ lane: { unit: 'u' } }), null));
});
test('the exit wrapper keeps the status and leaves no exit file when it cannot write one', () => {
  const ok = exitFile('w-ok');
  assert.equal(spawnSync('sh', ['-c', exitWrapper(ok), 'atom', 'sh', '-c', 'exit 7']).status, 7);
  assert.equal(readExit(ok), 7);
  assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith('w-ok') && f.endsWith('.tmp')), []);
  const nowhere = path.join(tmp, 'no-such-dir', 'x.exit');
  assert.equal(spawnSync('sh', ['-c', exitWrapper(nowhere), 'atom', 'sh', '-c', 'exit 7']).status, 7);
  assert.equal(fs.existsSync(nowhere), false);
});
test('a worker killed with its wrapper is settled, and its half-done work is not collected', async () => {
  const worker = `#!/bin/bash
for a in "$@"; do case "$a" in *READY*) echo READY; exit 0;; *"You own ONLY"*) brief="$a";; esac; done
f=$(printf '%s\\n' "$brief" | sed -n '/You own ONLY/{n;s/^- //p;q}')
echo half-done > "$f"
kill -9 $PPID
exit 0
`;
  const setup = scratch(path.join(tmp, 'killed'), worker);
  const { f, repo } = setup('killed-job', { 'a.txt': 'bad' }, { gate: null, maxIterations: 1 });
  await conduct(f, { load: loadJob, handlers, tickMs: 30, maxTicks: 150 }); await idle();
  const a = loadState(loadJob(f), f).atoms.A;
  assert.equal(a.status, 'needs-coordinator');
  assert.match(a.last, /no recorded exit code/);
  assert.equal(sh(repo, 'git', 'rev-list', '--count', 'HEAD'), '1');
});
test('an unreadable state file stops the job and is left as it was, a missing one starts fresh', () => {
  const job = { id: 'j', atoms: [{ id: 'A' }], conductor: { dir: path.join(tmp, 'state-a') } }, f = path.join(tmp, 'j.json');
  assert.equal(loadState(job, f).phase, 'staged');
  updateState(job, f, (s) => { s.phase = 'streaming'; s.budget.launches = 9; });
  const file = stateFile(job, f), torn = fs.readFileSync(file, 'utf8').slice(0, 40);
  for (const text of [torn, '', '[]', '{}']) {
    fs.writeFileSync(file, text);
    assert.throws(() => loadState(job, f), (e) => e.exitCode === 78 && e.message.includes(file));
    assert.throws(() => updateState(job, f, () => {}), (e) => e.exitCode === 78);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
});
test('the daemon exits 78 on a torn state, says so once, and its unit does not restart on 78', () => {
  const setup = scratch(path.join(tmp, 'torn'));
  const { f } = setup('torn-job', { 'a.txt': 'bad' }, { gate: null });
  const job = loadJob(f), file = stateFile(job, f);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(0, 40));
  const torn = fs.readFileSync(file, 'utf8');
  const r = spawnSync(process.execPath, [CONDUCT, 'run', f, '--max-ticks', '1'], { encoding: 'utf8' });
  assert.equal(r.status, 78, r.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), torn);
  assert.equal(readEvents(job, f).filter((e) => e.kind === 'NEEDS-YOU' && /unreadable/.test(e.summary)).length, 1);
  const unit = spawnSync(process.execPath, [CONDUCT, 'unit', f, '--dry-run'], { encoding: 'utf8' });
  assert.match(unit.stdout, /RestartPreventExitStatus=78/);
});
test('a lock whose owner could not be written is not left behind', () => {
  const target = path.join(tmp, 'res-a'), write = fs.writeFileSync;
  fs.writeFileSync = () => { throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); };
  try { assert.throws(() => acquire(target, { waitMs: 10 }), { code: 'ENOSPC' }); } finally { fs.writeFileSync = write; }
  assert.equal(fs.existsSync(`${target}.lock`), false);
});
test('a lock with no readable owner is reclaimed once it is old, and honoured while it is young', () => {
  const target = path.join(tmp, 'res-b'), dir = `${target}.lock`;
  fs.mkdirSync(dir);
  assert.throws(() => acquire(target, { waitMs: 10, pollMs: 2 }), { name: 'LockBusy' });
  const old = new Date(Date.now() - 3600_000); fs.utimesSync(dir, old, old);
  acquire(target, { waitMs: 200, pollMs: 2 })();
  assert.equal(fs.existsSync(dir), false);
});
test('atomic JSON is synced before the rename and leaves no temporary when a write fails', () => {
  const file = path.join(tmp, 'atomic', 'x.json'), calls = [], sync = fs.fsyncSync, rename = fs.renameSync;
  fs.fsyncSync = (fd) => { calls.push('fsync'); return sync(fd); };
  fs.renameSync = (a, b) => { calls.push('rename'); return rename(a, b); };
  try { writeJSONAtomic(file, { a: 1 }); } finally { fs.fsyncSync = sync; fs.renameSync = rename; }
  assert.equal(calls.indexOf('fsync') < calls.indexOf('rename') && calls.includes('fsync'), true);
  assert.equal(calls.lastIndexOf('fsync') > calls.indexOf('rename'), true);
  fs.fsyncSync = () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); };
  try { assert.throws(() => writeJSONAtomic(file, { a: 2 }), { code: 'EIO' }); } finally { fs.fsyncSync = sync; }
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['x.json']);
});

for (const [name, fn] of tests) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
