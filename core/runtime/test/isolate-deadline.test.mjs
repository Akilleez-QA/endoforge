import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture, hostPort } from './fixtures/ledger-fixture.mjs';

const stubborn = fileURLToPath(new URL('./fixtures/stubborn-port.mjs', import.meta.url));

function reap(t, pidFile) {
  t.after(() => {
    if (!existsSync(pidFile)) return;
    try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch { }
  });
}

test('a finished job leaves no deadline to stop its idle cell', { timeout: 30000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1, jobTimeoutMs: 2000 });
  t.after(() => pool.close());
  const first = await pool.run(job());
  assert.equal(first.status, 'completed');
  await sleep(2300);
  const second = await pool.run(job());
  assert.equal(second.status, 'completed');
  assert.equal(second.workcell, first.workcell);
});

test('a job that fails to post leaves no deadline to stop its cell', { timeout: 30000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1, isolation: 'process', jobTimeoutMs: 800 });
  t.after(() => pool.close());
  await pool.ready();
  const failed = await pool.run(job(['pass'], { unsendable: new SharedArrayBuffer(8) }));
  assert.equal(failed.status, 'outcome_unknown');
  assert.notEqual(failed.reason, 'deadline');
  assert.notEqual(failed.workcell, null);
  await sleep(1100);
  const next = await pool.run(job());
  assert.equal(next.status, 'completed');
  assert.equal(next.workcell, failed.workcell);
});

for (const [name, portOptions] of [['traps SIGTERM', { trapTerm: true }], ['leaves a grandchild holding stderr', { holdStderr: true }]]) {
  test(`a process cell that ${name} still meets its deadline and is replaced`, { timeout: 30000 }, async t => {
    const { job, directory } = await fixture(t);
    const pidFile = join(directory, 'grandchild');
    reap(t, pidFile);
    const pool = new IsolatePool({ hostPort: stubborn, size: 1, isolation: 'process', jobTimeoutMs: 500 });
    t.after(() => pool.close());
    const started = performance.now();
    const stopped = await pool.run(job(['pass'], { ...portOptions, pidFile }));
    assert.equal(stopped.status, 'outcome_unknown');
    assert.equal(stopped.reason, 'deadline');
    assert.ok(performance.now() - started < 4000, 'the deadline finishes the job');
    assert.notEqual(stopped.receipts[0].record.data.outcome_state, 'passed');
    const again = await pool.run(job(['pass'], { pidFile, ...portOptions }));
    assert.equal(again.reason, 'deadline');
    assert.notEqual(again.workcell, stopped.workcell);
  });
}

test('a process cell that exits with a grandchild holding stderr is not left pending', { timeout: 30000 }, async t => {
  const { job, directory } = await fixture(t);
  const pidFile = join(directory, 'grandchild');
  reap(t, pidFile);
  const pool = new IsolatePool({ hostPort: stubborn, size: 1, isolation: 'process' });
  t.after(() => pool.close());
  const started = performance.now();
  const lost = await pool.run(job(['pass'], { holdStderr: true, pidFile, exitAfter: true }));
  assert.equal(lost.status, 'outcome_unknown');
  assert.equal(lost.reason, 'worker_exit');
  assert.equal(lost.exitCode, 17);
  assert.ok(performance.now() - started < 4000);
});

test('close finishes with a cell that traps SIGTERM', { timeout: 30000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort: stubborn, size: 1, isolation: 'process', jobTimeoutMs: 400 });
  await pool.run(job(['pass'], { trapTerm: true }));
  const started = performance.now();
  await pool.close();
  assert.ok(performance.now() - started < 5000);
  assert.equal(pool.stats.workers, 0);
});

test('when the supervisor stalls past a deadline, the next job does not go to the dying cell', { timeout: 30000 }, async t => {
  const { job, directory } = await fixture(t);
  const release = join(directory, 'release');
  const pool = new IsolatePool({ hostPort, size: 1, jobTimeoutMs: 400 });
  t.after(() => pool.close());
  await pool.ready();
  const first = pool.run(job(['pass'], { release }));
  const second = pool.run(job(['pass'], { release }));
  while (!pool.stats.busy) await sleep(5);
  await sleep(50);
  await new Promise(setImmediate);
  writeFileSync(release, 'go');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  const results = await Promise.all([first, second]);
  assert.equal(results[0].status, 'completed', 'the result that arrived is kept');
  assert.equal(results[1].status, 'completed', 'the next job ran');
  assert.notEqual(results[1].workcell, results[0].workcell);
});
