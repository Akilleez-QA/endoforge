import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { dumpListDirectory, dumpListEnabled, registerHolder, SCHEMA } from '../dump-list.mjs';
import { createContainedRunner } from '../contained/runner.mjs';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture, hostPort } from './fixtures/ledger-fixture.mjs';

process.report.reportOnSignal = false;
const helper = fileURLToPath(new URL('../dump-list.mjs', import.meta.url));
const temp = t => { const directory = mkdtempSync(join(tmpdir(), 'ef-dump-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };
const json = files => files.filter(name => name.endsWith('.json'));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const until = async (check, ms = 5000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('condition not reached'); await new Promise(done => setTimeout(done, 10)); } };
const run = source => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { err += chunk; });
  return new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, out, err })); });
};

test('registration is off without the directory or the variable, and on with either', t => {
  const state = temp(t);
  const env = { XDG_STATE_HOME: state };
  assert.equal(dumpListDirectory(env), join(state, 'memguard', 'dump-list.d'));
  assert.equal(dumpListEnabled(env), false);
  const holder = registerHolder({ name: 'off', priority: 10, measure: () => 1, env });
  assert.equal(holder.enabled, false);
  assert.equal(existsSync(join(state, 'memguard')), false);
  assert.equal(dumpListEnabled({ ...env, ENDOFORGE_DUMP_LIST: '1' }), true);
  mkdirSync(dumpListDirectory(env), { recursive: true });
  assert.equal(dumpListEnabled(env), true);
  assert.equal(dumpListEnabled({ ...env, ENDOFORGE_DUMP_LIST: '0' }), false);
  assert.equal(dumpListEnabled({ XDG_STATE_HOME: 'relative', HOME: state }), existsSync(join(process.env.HOME || '', '.local/state/memguard/dump-list.d')));
});

test('a process that writes a diagnostic report on SIGUSR2 is not registered, since the signal would write to disk instead of shedding', t => {
  const directory = temp(t);
  const previous = process.report.reportOnSignal, signal = process.report.signal;
  t.after(() => { process.report.reportOnSignal = previous; process.report.signal = signal; });
  process.report.reportOnSignal = true;
  process.report.signal = 'SIGUSR2';
  const holder = registerHolder({ name: 'reporting', priority: 1, measure: () => 1, directory });
  assert.equal(holder.enabled, false);
  assert.equal(holder.refused, 'report-on-signal');
  assert.deepEqual(readdirSync(directory), []);
  const elsewhere = registerHolder({ name: 'cohort', priority: 1, measure: () => 1, directory, pid: process.pid + 1 });
  assert.equal(elsewhere.enabled, true);
  elsewhere.close();
  process.report.signal = 'SIGUSR1';
  const fine = registerHolder({ name: 'reporting', priority: 1, measure: () => 1, directory, listen: false });
  assert.equal(fine.enabled, true);
  fine.close();
});

test('the variable creates the directory and the file follows the protocol exactly', t => {
  const state = temp(t);
  const holder = registerHolder({ name: 'proto.holder_1', priority: 42, measure: () => 1234.7, env: { XDG_STATE_HOME: state, ENDOFORGE_DUMP_LIST: '1' } });
  t.after(() => holder.close());
  const directory = dumpListDirectory({ XDG_STATE_HOME: state });
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(directory), [`${process.pid}-proto.holder_1.json`]);
  const record = read(holder.path);
  assert.deepEqual(Object.keys(record), ['schema', 'pid', 'name', 'priority', 'sheddable_bytes', 'signal', 'updated']);
  assert.deepEqual({ ...record, updated: undefined }, { schema: SCHEMA, pid: process.pid, name: 'proto.holder_1', priority: 42, sheddable_bytes: 1234, signal: 'SIGUSR2', updated: undefined });
  assert.ok(!Number.isNaN(Date.parse(record.updated)) && record.updated.endsWith('Z'));
  assert.equal(statSync(holder.path).mode & 0o777, 0o600);
  assert.throws(() => registerHolder({ name: 'bad name', priority: 1, measure: () => 0, directory }), /must match/);
  assert.throws(() => registerHolder({ name: 'x'.repeat(65), priority: 1, measure: () => 0, directory }), /must match/);
  assert.throws(() => registerHolder({ name: 'ok', priority: 200, measure: () => 0, directory }), /priority/);
});

test('each write replaces the file by rename, so a reader never sees a partial record, and no temporary file is left', t => {
  const directory = temp(t);
  let bytes = 0;
  const holder = registerHolder({ name: 'atomic', priority: 1, measure: () => bytes, directory, refreshMs: 0 });
  t.after(() => holder.close());
  const inodes = new Set();
  for (let index = 0; index < 200; index++) {
    bytes = index * 1000 + 1;
    holder.refresh();
    const record = read(holder.path);
    assert.equal(record.sheddable_bytes, bytes);
    inodes.add(statSync(holder.path).ino);
  }
  assert.ok(inodes.size > 1);
  assert.deepEqual(readdirSync(directory), [`${process.pid}-atomic.json`]);
});

test('refreshes are rate limited, unchanged values are not rewritten, and a trailing write lands the last value', async t => {
  const directory = temp(t);
  let bytes = 10;
  const holder = registerHolder({ name: 'rate', priority: 1, measure: () => bytes, directory, refreshMs: 200 });
  t.after(() => holder.close());
  assert.equal(holder.writes, 1);
  for (let index = 0; index < 50; index++) { bytes += 1; holder.refresh(); }
  assert.equal(holder.writes, 1);
  await until(() => read(holder.path).sheddable_bytes === 60, 2000);
  assert.equal(holder.writes, 2);
  await new Promise(done => setTimeout(done, 250));
  holder.refresh();
  assert.equal(holder.writes, 2);
});

test('a stale file with the same name is overwritten and close removes the file', t => {
  const directory = temp(t);
  const path = join(directory, `${process.pid}-stale.json`);
  writeFileSync(path, '{"schema":"memguard-dump/1","pid":1,"name":"stale","priority":0,"sheddable_bytes":999999999,"signal":"SIGUSR2","updated":"2000-01-01T00:00:00.000Z"}\n');
  const holder = registerHolder({ name: 'stale', priority: 7, measure: () => 5, directory });
  assert.deepEqual({ ...read(path), updated: undefined }, { schema: SCHEMA, pid: process.pid, name: 'stale', priority: 7, sheddable_bytes: 5, signal: 'SIGUSR2', updated: undefined });
  holder.close();
  assert.equal(existsSync(path), false);
});

test('SIGUSR2 sheds, the file is rewritten with the new estimate, the process survives, and the file is gone after exit', { timeout: 30000 }, async t => {
  const directory = temp(t);
  const source = `import { registerHolder } from ${JSON.stringify(helper)};
    let held = 5000000;
    const holder = registerHolder({ name: 'child', priority: 30, measure: () => held, shed: async () => { await new Promise(done => setTimeout(done, 20)); held = 1000; }, directory: ${JSON.stringify(directory)} });
    process.stdout.write('registered\\n');
    const end = Date.now() + 20000;
    const tick = setInterval(() => { if (holder.sheds >= 2 || Date.now() > end) { clearInterval(tick); process.stdout.write('sheds ' + holder.sheds + '\\n'); } }, 10);`;
  const done = run(source);
  await until(() => json(readdirSync(directory)).length === 1, 10000);
  const [file] = json(readdirSync(directory));
  const pid = Number(file.split('-')[0]);
  assert.equal(read(join(directory, file)).sheddable_bytes, 5000000);
  process.kill(pid, 'SIGUSR2');
  await until(() => read(join(directory, file)).sheddable_bytes === 1000, 2000);
  process.kill(pid, 'SIGUSR2');
  const result = await done;
  assert.equal(result.signal, null, result.err);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /sheds 2/);
  assert.deepEqual(readdirSync(directory), []);
});

test('a contained cohort registers under its own pid, sheds idle Workers on SIGUSR2 without losing an in-flight run, and unregisters', { timeout: 60000 }, async t => {
  const directory = temp(t);
  const runner = createContainedRunner({ width: 4, deadlineMs: 4000, dumpList: { directory, floor: 1, holdMs: 60000, intervalMs: 50 } });
  t.after(() => runner.close());
  await runner.ready();
  const pid = runner.pid;
  const quick = { modules: { '/g/main.js': 'exports.main = input => input * 2;' }, entry: '/g/main.js', input: 21 };
  let open, entered = 0;
  const gate = new Promise(resolve => { open = resolve; });
  const slow = { modules: { '/g/main.js': 'exports.main = input => input + require("host:ports").gate(1);' }, entry: '/g/main.js', input: 1,
    contract: { ports: { gate: { maxCalls: 1, maxBytes: 64 } } }, ports: { gate: async () => { entered += 1; await gate; return 1; } } };
  await Promise.all(Array.from({ length: 8 }, () => runner.run(quick)));
  const file = join(directory, `${pid}-endoforge-cohort.json`);
  await until(() => existsSync(file) && read(file).sheddable_bytes > 0);
  const before = runner.dump;
  assert.ok(before.idle >= 2, JSON.stringify(before));
  const inflight = [runner.run(slow), runner.run(slow)];
  await until(() => entered === 2);
  const writes = runner.dump.writes;
  process.kill(pid, 'SIGUSR2');
  await until(() => runner.dump.writes > writes, 2000);
  const after = runner.dump;
  assert.equal(after.holding, true);
  assert.ok(after.idle <= 1, JSON.stringify(after));
  assert.equal(read(file).sheddable_bytes, 0);
  process.kill(pid, 'SIGUSR2');
  await new Promise(done => setTimeout(done, 200));
  open();
  const results = await Promise.all(inflight);
  for (const result of results) assert.deepEqual([result.status, result.output], ['completed', '2']);
  const later = await Promise.all(Array.from({ length: 6 }, () => runner.run(quick)));
  assert.ok(later.every(result => result.status === 'completed' && result.output === '42'));
  assert.equal(runner.stats.unknown, 0);
  assert.equal(runner.stats.cohortLosses, 0);
  await runner.close();
  assert.deepEqual(readdirSync(directory), []);
});

test('a runner without the directory or the variable writes nothing and installs no handler in its cohort', { timeout: 30000 }, async t => {
  const state = temp(t);
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = state;
  t.after(() => { if (previous === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous; });
  const runner = createContainedRunner({ width: 1 });
  t.after(() => runner.close());
  const result = await runner.run({ modules: { '/g/main.js': 'exports.main = () => 1;' }, entry: '/g/main.js' });
  assert.equal(result.status, 'completed');
  assert.equal(runner.dump, null);
  assert.equal(existsSync(join(state, 'memguard')), false);
});

test('an isolate pool retires idle prewarmed cells beyond the floor on SIGUSR2 to its own process, keeps serving, and unregisters on close', { timeout: 90000 }, async t => {
  const directory = temp(t);
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 4, dumpList: { directory, floor: 1, holdMs: 60000 } });
  t.after(() => pool.close());
  await pool.ready();
  const file = join(directory, `${process.pid}-endoforge-isolate-pool.json`);
  assert.equal(read(file).priority, 20);
  assert.ok(read(file).sheddable_bytes > 0, JSON.stringify(read(file)));
  const first = await pool.run(job(['pass', 'effects']));
  assert.ok(first.report);
  process.kill(process.pid, 'SIGUSR2');
  await until(() => pool.stats.workers === 1 && pool.dump.sheds === 1 && read(file).sheddable_bytes === 0);
  assert.equal(read(file).sheddable_bytes, 0);
  const results = await Promise.all(Array.from({ length: 3 }, () => pool.run(job(['pass', 'effects']))));
  for (const result of results) assert.deepEqual(result.report, first.report);
  await pool.close();
  assert.deepEqual(readdirSync(directory), []);
});
