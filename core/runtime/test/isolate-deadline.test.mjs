import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture, hostPort, python } from './fixtures/ledger-fixture.mjs';
import { holdTimers, liveTimers } from './fixtures/hold-timers.mjs';
import { timingOnly } from './fixtures/timing.mjs';

const stubborn = fileURLToPath(new URL('./fixtures/stubborn-port.mjs', import.meta.url));

const heldDeadline = 3599999;
const killGraceMs = 1000;
const exitGraceMs = 500;

function reap(t, pidFile) {
  t.after(() => {
    if (!existsSync(pidFile)) return;
    try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch { }
  });
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check) {
  while (!check()) await sleep(5);
}

async function jobMs(job, isolation = 'thread') {
  const pool = new IsolatePool({ hostPort, size: 1, isolation });
  try {
    const started = performance.now();
    await pool.run(job());
    return performance.now() - started;
  } finally { await pool.close(); }
}

test('a finished job leaves no deadline to stop its idle cell', { timeout: 60000 }, async t => {
  const deadlines = holdTimers(t, heldDeadline);
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1, jobTimeoutMs: heldDeadline });
  t.after(() => pool.close());
  const first = await pool.run(job());
  assert.equal(first.status, 'completed');
  assert.equal(deadlines.count, 0);
  const second = await pool.run(job());
  assert.equal(second.status, 'completed');
  assert.equal(second.workcell, first.workcell);
});

test('a job that fails to post leaves no deadline to stop its cell', { timeout: 60000 }, async t => {
  const deadlines = holdTimers(t, heldDeadline);
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1, isolation: 'process', jobTimeoutMs: heldDeadline });
  t.after(() => pool.close());
  await pool.ready();
  const failed = await pool.run(job(['pass'], { unsendable: new SharedArrayBuffer(8) }));
  assert.equal(failed.status, 'outcome_unknown');
  assert.notEqual(failed.reason, 'deadline');
  assert.notEqual(failed.workcell, null);
  assert.equal(deadlines.count, 0);
  const next = await pool.run(job());
  assert.equal(next.status, 'completed');
  assert.equal(next.workcell, failed.workcell);
});

for (const [name, portOptions] of [['traps SIGTERM', { trapTerm: true }], ['leaves a grandchild holding stderr', { holdStderr: true }]]) {
  test(`a process cell that ${name} still meets its deadline and is replaced`, { timeout: 60000 }, async t => {
    const deadlines = holdTimers(t, heldDeadline);
    const { job, directory } = await fixture(t);
    const pidFile = join(directory, 'grandchild');
    const startedFile = join(directory, 'started');
    reap(t, pidFile);
    const budget = 4000 + 3 * await jobMs(job, 'process');
    const pool = new IsolatePool({ hostPort: stubborn, size: 1, isolation: 'process', jobTimeoutMs: heldDeadline });
    t.after(() => pool.close());
    const run = async () => {
      rmSync(startedFile, { force: true });
      const result = pool.run(job(['pass'], { ...portOptions, pidFile, startedFile }));
      await until(() => existsSync(startedFile) && deadlines.count);
      const fired = performance.now();
      deadlines.fire();
      return [await result, performance.now() - fired];
    };
    const [stopped, took] = await run();
    assert.equal(stopped.status, 'outcome_unknown');
    assert.equal(stopped.reason, 'deadline');
    timingOnly(t, 'the deadline finishes the job within budget', () => assert.ok(took < budget, `the deadline finishes the job: ${took} ms of ${budget} ms`));
    assert.notEqual(stopped.receipts[0].record.data.outcome_state, 'passed');
    const [again] = await run();
    assert.equal(again.reason, 'deadline');
    assert.notEqual(again.workcell, stopped.workcell);
  });
}

test('a process cell that exits with a grandchild holding stderr is not left pending', { timeout: 60000 }, async t => {
  const { job, directory } = await fixture(t);
  const pidFile = join(directory, 'grandchild');
  reap(t, pidFile);
  const budget = 4000 + 3 * await jobMs(job, 'process');
  const pool = new IsolatePool({ hostPort: stubborn, size: 1, isolation: 'process' });
  t.after(() => pool.close());
  const started = performance.now();
  const lost = await pool.run(job(['pass'], { holdStderr: true, pidFile, exitAfter: true }));
  assert.equal(lost.status, 'outcome_unknown');
  assert.equal(lost.reason, 'worker_exit');
  assert.equal(lost.exitCode, 17);
  const took = performance.now() - started;
  timingOnly(t, 'a lost cell with a stderr-holding grandchild settles within budget', () => assert.ok(took < budget, `${took} ms of ${budget} ms`));
});

test('an idle process cell that exited is never given the next job while a grandchild holds its stderr', { timeout: 60000 }, async t => {
  const { job, directory } = await fixture(t);
  const pidFile = join(directory, 'grandchild');
  reap(t, pidFile);
  const pool = new IsolatePool({ hostPort: stubborn, size: 1, isolation: 'process' });
  t.after(() => pool.close());
  const first = await pool.run(job(['pass'], { holdStderr: true, pidFile, quick: true }));
  assert.equal(first.status, 'completed');
  process.kill(first.workcell, 'SIGKILL');
  await until(() => !alive(first.workcell));
  await new Promise(setImmediate);
  const next = await pool.run(job(['pass'], { quick: true }));
  assert.equal(next.status, 'completed', `${next.reason}`);
  assert.notEqual(next.workcell, first.workcell);
});

test('a lost process cell leaves no kill, exit or deadline timer behind', { timeout: 60000 }, async t => {
  const timers = liveTimers(t, [killGraceMs, exitGraceMs, heldDeadline]);
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort: stubborn, size: 1, isolation: 'process', jobTimeoutMs: heldDeadline });
  const lost = await pool.run(job(['pass'], { exitAfter: true }));
  assert.equal(lost.reason, 'worker_exit');
  assert.deepEqual(timers(), []);
  await pool.close();
  assert.deepEqual(timers(), []);
});

test('a supervisor stops holding the stderr of a grandchild that outlives its cell', { timeout: 60000 }, async t => {
  const { directory } = await fixture(t);
  const pidFile = join(directory, 'grandchild');
  reap(t, pidFile);
  const script = join(directory, 'supervisor.mjs');
  const fixtures = new URL('./fixtures/', import.meta.url).href;
  writeFileSync(script, `
import { IsolatePool } from ${JSON.stringify(new URL('../isolate-pool.mjs', import.meta.url).href)};
import { fixture } from ${JSON.stringify(`${fixtures}ledger-fixture.mjs`)};
const after = [];
const { job } = await fixture({ after: fn => after.push(fn) });
const pool = new IsolatePool({ hostPort: ${JSON.stringify(stubborn)}, size: 1, isolation: 'process' });
const lost = await pool.run(job(['pass'], { holdStderr: true, pidFile: ${JSON.stringify(pidFile)}, exitAfter: true }));
await pool.close();
for (const fn of after) fn();
console.log(lost.reason);
`);
  const result = await new Promise(resolve => execFile(process.execPath, [script], { timeout: 45000 }, (error, stdout) => resolve({ error, stdout })));
  assert.equal(result.error, null, 'the supervisor exits while the grandchild is still running');
  assert.equal(result.stdout.trim(), 'worker_exit');
  assert.equal(alive(Number(readFileSync(pidFile, 'utf8'))), true);
});

test('stated limit: terminate can not interrupt a thread cell in a blocking native call', { timeout: 60000 }, async t => {
  const deadlines = holdTimers(t, heldDeadline);
  const { job, directory } = await fixture(t);
  const blockedFile = join(directory, 'blocked');
  const pool = new IsolatePool({ hostPort: stubborn, size: 1, jobTimeoutMs: heldDeadline });
  t.after(() => pool.close());
  const result = pool.run(job(['pass'], { blockMs: 5000, blockedFile }));
  await until(() => existsSync(blockedFile) && deadlines.count);
  const fired = performance.now();
  deadlines.fire();
  const stopped = await result;
  assert.equal(stopped.status, 'outcome_unknown');
  assert.equal(stopped.reason, 'deadline');
  assert.notEqual(stopped.receipts[0].record.data.outcome_state, 'passed');
  assert.ok(performance.now() - fired > 1000, 'the overrun is the limit README states');
});

test('close finishes with a cell that traps SIGTERM', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const budget = 5000 + 3 * await jobMs(job, 'process');
  const pool = new IsolatePool({ hostPort: stubborn, size: 1, isolation: 'process', jobTimeoutMs: 400 });
  await pool.run(job(['pass'], { trapTerm: true }));
  const started = performance.now();
  await pool.close();
  const took = performance.now() - started;
  timingOnly(t, 'close of a SIGTERM-trapping cell within budget', () => assert.ok(took < budget, `${took} ms of ${budget} ms`));
  assert.equal(pool.stats.workers, 0);
});

test('when the supervisor stalls past a deadline, the next job does not go to the dying cell', { timeout: 60000 }, async t => {
  const deadlines = holdTimers(t, heldDeadline);
  const { job, directory } = await fixture(t);
  const release = join(directory, 'release');
  const stallMs = 2000 + 5 * await jobMs(job);
  const pool = new IsolatePool({ hostPort, size: 1, jobTimeoutMs: heldDeadline });
  t.after(() => pool.close());
  await pool.ready();
  const first = pool.run(job(['pass'], { release }));
  const second = pool.run(job(['pass'], { release }));
  await until(() => deadlines.count);
  await sleep(50);
  await new Promise(setImmediate);
  writeFileSync(release, 'go');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stallMs);
  deadlines.fire();
  const results = await Promise.all([first, second]);
  assert.deepEqual([results[0].status, results[0].reason], ['outcome_unknown', 'deadline']);
  assert.equal(results[1].status, 'completed', 'the next job ran');
  assert.notEqual(results[1].workcell, results[0].workcell);
});

const warmPort = fileURLToPath(new URL('./fixtures/warm-port.mjs', import.meta.url));
for (const isolation of ['thread', 'process']) {
  test(`${isolation}: the job budget starts when the cell is warm, also for a cell that replaces a stopped one`, { timeout: 60000 }, async t => {
    const deadlines = holdTimers(t, heldDeadline);
    const { job } = await fixture(t);
    const gates = mkdtempSync(join(tmpdir(), 'ef-gate-')), gate = join(gates, 'gate');
    const pool = new IsolatePool({ hostPort: warmPort, size: 1, isolation, jobTimeoutMs: heldDeadline, warm: { value: 'loaded', gate } });
    t.after(async () => {
      writeFileSync(gate, 'go');
      await pool.close();
      rmSync(gates, { recursive: true, force: true });
    });
    const first = pool.run(job(['pass'], { expectWarm: 'loaded' }));
    await until(() => pool.stats.busy === 1);
    await sleep(50);
    assert.equal(deadlines.count, 0, 'no budget runs while the first cell warms');
    writeFileSync(gate, 'go');
    const warmed = await first;
    assert.equal(warmed.status, 'completed');
    assert.equal(deadlines.count, 0);
    const spin = pool.run(job(['pass'], { spin: true }));
    await until(() => deadlines.count === 1);
    deadlines.fire();
    const stopped = await spin;
    assert.deepEqual([stopped.status, stopped.reason], ['outcome_unknown', 'deadline']);
    const after = pool.run(job(['pass'], { expectWarm: 'loaded' }));
    await until(() => pool.stats.busy === 1);
    await sleep(50);
    assert.equal(deadlines.count, 0, 'no budget runs while the replacement cell warms');
    writeFileSync(gate, 'go');
    const replaced = await after;
    assert.equal(replaced.status, 'completed');
    assert.notEqual(replaced.workcell, stopped.workcell);
  });
}

function receiptCount(ledger) {
  return python(`
import json, sys
from core.ledger.ledger import Ledger
print(json.dumps(sum(row['kind'] == 'receipt' for row in Ledger(json.load(sys.stdin)['ledger']).records())))
`, { ledger });
}

test('a verdict is kept only when it is claimed before the deadline', { timeout: 60000 }, async t => {
  const deadlines = holdTimers(t, heldDeadline);
  const { job, directory } = await fixture(t);
  const release = join(directory, 'release');
  const early = new IsolatePool({ hostPort, size: 1, isolation: 'process', jobTimeoutMs: heldDeadline });
  t.after(() => early.close());
  await early.ready();
  const running = early.run(job(['pass'], { release }));
  await until(() => deadlines.count);
  writeFileSync(release, 'go');
  const kept = await running;
  assert.equal(kept.status, 'completed');
  assert.equal(kept.receipts[0].record.data.outcome_state, 'passed');
  assert.equal(deadlines.count, 0);
  const again = await early.run(job(['pass'], { release }));
  assert.equal(again.status, 'completed');
  assert.equal(again.workcell, kept.workcell);

  const startedFile = join(directory, 'started-late');
  const verdictFile = join(directory, 'verdict-late');
  const late = new IsolatePool({ hostPort: stubborn, size: 1, isolation: 'process', jobTimeoutMs: heldDeadline });
  t.after(() => late.close());
  await late.ready();
  const pending = late.run(job(['pass'], { verdictOnTerm: true, startedFile, verdictFile }));
  await until(() => existsSync(startedFile) && deadlines.count);
  deadlines.fire();
  const stopped = await pending;
  assert.equal(existsSync(verdictFile), true);
  assert.equal(stopped.status, 'outcome_unknown');
  assert.equal(stopped.reason, 'deadline');
  assert.equal(stopped.report, null);
  assert.equal(stopped.receipts[0].record.data.outcome_state, 'inconclusive');
  assert.equal(stopped.receipts[0].record.data.delivery_state, 'outcome_unknown');
  const followed = await late.run(job(['pass'], { quick: true }));
  assert.equal(followed.status, 'completed');
  assert.equal(followed.receipts[0].record.data.outcome_state, 'passed');
  assert.notEqual(followed.workcell, stopped.workcell);
});

test('a process cell that traps SIGTERM and then returns a verdict stays inconclusive', { timeout: 60000 }, async t => {
  const { job, reference, directory } = await fixture(t);
  const verdictFile = join(directory, 'verdict');
  const pool = new IsolatePool({ hostPort: stubborn, size: 1, isolation: 'process', jobTimeoutMs: 400 });
  t.after(() => pool.close());
  await pool.ready();
  const started = performance.now();
  const stopped = await pool.run(job(['pass'], { verdictOnTerm: true, verdictFile }));
  assert.equal(existsSync(verdictFile), true);
  assert.equal(stopped.status, 'outcome_unknown');
  assert.equal(stopped.reason, 'deadline');
  assert.equal(stopped.report, null);
  assert.equal(stopped.receipts.length, 1);
  assert.equal(stopped.receipts[0].record.data.outcome_state, 'inconclusive');
  assert.equal(stopped.receipts[0].record.data.delivery_state, 'outcome_unknown');
  assert.equal(stopped.receipts[0].record.data.observations[0].status, 'outcome_unknown');
  assert.equal(stopped.receipts[0].record.data.observations[0].reason, 'deadline');
  const took = performance.now() - started;
  timingOnly(t, 'a late verdict after SIGTERM is stopped within 8000 ms', () => assert.ok(took < 8000, `${took} ms`));
  assert.equal(alive(stopped.workcell), false);
  assert.equal(pool.stats.busy, 0);
  assert.equal(pool.stats.workers, 1);
  assert.equal(await receiptCount(reference.ledger), 1);
});

test('a late verdict and the cell exit settle a deadline once', { timeout: 60000 }, async t => {
  const deadlines = holdTimers(t, heldDeadline);
  const { job, reference, directory } = await fixture(t);
  const startedFile = join(directory, 'started');
  const verdictFile = join(directory, 'verdict');
  const pool = new IsolatePool({ hostPort: stubborn, size: 1, isolation: 'process', jobTimeoutMs: heldDeadline });
  t.after(() => pool.close());
  await pool.ready();
  const pending = pool.run(job(['pass'], { verdictOnTerm: true, exitAfterVerdict: true, startedFile, verdictFile }));
  await until(() => existsSync(startedFile) && deadlines.count);
  deadlines.fire();
  const giveUp = performance.now() + 2000;
  while (!existsSync(verdictFile)) {
    if (performance.now() > giveUp) break;
  }
  assert.equal(existsSync(verdictFile), true);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  const stopped = await pending;
  assert.equal(stopped.status, 'outcome_unknown');
  assert.equal(stopped.reason, 'deadline');
  assert.equal(stopped.report, null);
  assert.equal(stopped.receipts.length, 1);
  assert.equal(stopped.receipts[0].record.data.outcome_state, 'inconclusive');
  assert.equal(await receiptCount(reference.ledger), 1);
  const next = await pool.run(job(['pass'], { quick: true }));
  assert.equal(next.status, 'completed');
  assert.equal(next.receipts[0].record.data.outcome_state, 'passed');
  assert.notEqual(next.workcell, stopped.workcell);
  assert.equal(pool.stats.busy, 0);
  assert.equal(await receiptCount(reference.ledger), 2);
});
