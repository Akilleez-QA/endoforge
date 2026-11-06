import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture, hostPort } from './fixtures/ledger-fixture.mjs';
import { holdTimers, liveTimers } from './fixtures/hold-timers.mjs';

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
    assert.ok(took < budget, `the deadline finishes the job: ${took} ms of ${budget} ms`);
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
  assert.ok(performance.now() - started < budget);
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
  const startedFile = join(directory, 'started');
  const pool = new IsolatePool({ hostPort: stubborn, size: 1, jobTimeoutMs: heldDeadline });
  t.after(() => pool.close());
  const result = pool.run(job(['pass'], { blockMs: 3000, startedFile }));
  await until(() => existsSync(startedFile) && deadlines.count);
  await sleep(200);
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
  assert.ok(performance.now() - started < budget);
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
  assert.equal(results[0].status, 'completed', 'the result that arrived is kept');
  assert.equal(results[1].status, 'completed', 'the next job ran');
  assert.notEqual(results[1].workcell, results[0].workcell);
});
