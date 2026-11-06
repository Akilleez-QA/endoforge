import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture } from './fixtures/ledger-fixture.mjs';
import { holdTimers } from './fixtures/hold-timers.mjs';

const hostPort = fileURLToPath(new URL('./fixtures/hang-port.mjs', import.meta.url));

test('stackSizeMb is optional, thread-only and validated', () => {
  assert.throws(() => new IsolatePool({ hostPort, resourceLimits: { stackSizeMb: 0 } }), /limits/);
  assert.throws(() => new IsolatePool({ hostPort, resourceLimits: { other: 1 } }), /limits/);
  assert.throws(() => new IsolatePool({ hostPort, isolation: 'process', resourceLimits: { stackSizeMb: 8 } }), /thread/);
  assert.throws(() => new IsolatePool({ hostPort, jobTimeoutMs: 0 }), /jobTimeoutMs/);
});

test('a job past its deadline is unknown, its cell is replaced, and the next job completes', { timeout: 60000 }, async t => {
  const deadlines = holdTimers(t, 3599997);
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1, jobTimeoutMs: 3599997, resourceLimits: { stackSizeMb: 8 } });
  t.after(() => pool.close());
  const running = pool.run(job(['pass'], { hang: true }));
  while (!deadlines.count) await new Promise(setImmediate);
  deadlines.fire();
  const hung = await running;
  assert.equal(hung.status, 'outcome_unknown');
  assert.equal(hung.reason, 'deadline');
  assert.equal(hung.report, null);
  assert.equal(hung.receipts[0].record.data.outcome_state, 'inconclusive');
  const next = await pool.run(job(['pass'], {}));
  assert.equal(next.status, 'completed');
  assert.notEqual(next.workcell, hung.workcell);
  assert.equal(next.receipts[0].record.data.outcome_state, 'passed');
});

test('a job inside its deadline is unaffected', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1, jobTimeoutMs: 30000 });
  t.after(() => pool.close());
  assert.equal((await pool.run(job(['pass'], {}))).status, 'completed');
});

test('warm is opt-in: ready() waits for the host module, and a failure never becomes a pass', { timeout: 60000 }, async t => {
  const warmPort = fileURLToPath(new URL('./fixtures/warm-port.mjs', import.meta.url));
  assert.throws(() => new IsolatePool({ hostPort: warmPort, warm: 'yes' }), /warm/);
  const { job } = await fixture(t);
  for (const isolation of ['thread', 'process']) {
    const pool = new IsolatePool({ hostPort: warmPort, size: 2, isolation, warm: { value: 'loaded' } });
    t.after(() => pool.close());
    await pool.ready();
    const result = await pool.run(job(['pass'], { expectWarm: 'loaded' }));
    assert.equal(result.status, 'completed', isolation);
    assert.equal(result.receipts[0].record.data.outcome_state, 'passed');
    await pool.close();
    const failing = new IsolatePool({ hostPort: warmPort, size: 1, isolation, warm: { fail: true } });
    t.after(() => failing.close());
    await assert.rejects(failing.ready(), /before ready/);
    const lost = await failing.run(job(['pass'], {}));
    assert.equal(lost.status, 'outcome_unknown', isolation);
    assert.match(lost.reason, /warm failed/);
    assert.notEqual(lost.receipts[0].record.data.outcome_state, 'passed');
    await failing.close();
  }
  const absent = new IsolatePool({ hostPort, size: 1, warm: {} });
  t.after(() => absent.close());
  await assert.rejects(absent.ready(), /before ready/);
  await absent.close();
  const off = new IsolatePool({ hostPort: warmPort, size: 1 });
  t.after(() => off.close());
  const cold = await off.run(job(['pass'], { expectWarm: null }));
  assert.equal(cold.status, 'completed');
});

const warmExit = fileURLToPath(new URL('./fixtures/warm-exit-port.mjs', import.meta.url));
const warms = counter => existsSync(counter) ? readFileSync(counter, 'utf8').length : 0;

for (const isolation of ['thread', 'process']) {
  test(`${isolation}: a warm() that exits the cell stops respawning, and the failure is surfaced`, { timeout: 60000 }, async t => {
    const { job, directory } = await fixture(t);
    const counter = join(directory, 'warms');
    const size = 2;
    const pool = new IsolatePool({ hostPort: warmExit, size, isolation, warm: { counter } });
    t.after(() => pool.close());
    await assert.rejects(pool.ready(), /failed before ready/);
    await sleep(1500);
    const settled = warms(counter);
    assert.ok(settled <= size + 2 + size, `${settled} warms`);
    await sleep(500);
    assert.equal(warms(counter), settled, 'no further respawn');
    assert.equal(pool.stats.workers, 0);
    assert.equal(pool.halted, true);
    const result = await pool.run(job());
    assert.equal(result.status, 'outcome_unknown');
    assert.equal(result.reason, 'workcell_start_failed');
    assert.notEqual(result.receipts[0].record.data.outcome_state, 'passed');
    assert.equal(warms(counter), settled, 'a later job starts no cell');
  });
}

test('a cell reporting ready resets the count, so start failures with a ready between them never halt', { timeout: 60000 }, async t => {
  const { job, directory } = await fixture(t);
  const counter = join(directory, 'warms');
  const pool = new IsolatePool({ hostPort: warmExit, size: 1, warm: { counter, exitCounts: [0, 1, 3, 4] } });
  t.after(() => pool.close());
  const reasons = async () => [(await pool.run(job())).reason ?? 'completed', (await pool.run(job())).reason ?? 'completed', (await pool.run(job())).status];
  assert.deepEqual(await reasons(), ['worker_exit', 'worker_exit', 'completed']);
  assert.equal((await pool.run(job(['exit']))).reason, 'worker_exit');
  assert.deepEqual(await reasons(), ['worker_exit', 'worker_exit', 'completed']);
  assert.equal(pool.halted, false);
});

for (const isolation of ['thread', 'process']) {
  test(`${isolation}: a warm() that hangs rejects ready() within warmTimeoutMs, and the pool stops respawning`, { timeout: 60000 }, async t => {
    const warmPort = fileURLToPath(new URL('./fixtures/warm-port.mjs', import.meta.url));
    const { job } = await fixture(t);
    const pool = new IsolatePool({ hostPort: warmPort, size: 1, isolation, warm: { hang: true }, warmTimeoutMs: 200 });
    t.after(() => pool.close());
    await assert.rejects(pool.ready(), /before ready/);
    const result = await pool.run(job());
    assert.equal(result.status, 'outcome_unknown');
    assert.notEqual(result.receipts[0].record.data.outcome_state, 'passed');
    while (!pool.halted) await pool.run(job());
    assert.equal((await pool.run(job())).reason, 'workcell_start_failed');
  });

  test(`${isolation}: a job deadline during a hung warm() is not a start failure`, { timeout: 60000 }, async t => {
    const warmPort = fileURLToPath(new URL('./fixtures/warm-port.mjs', import.meta.url));
    const { job } = await fixture(t);
    const pool = new IsolatePool({ hostPort: warmPort, size: 1, isolation, warm: { hang: true }, jobTimeoutMs: 100 });
    t.after(() => pool.close());
    for (let attempt = 0; attempt < 5; attempt++) assert.equal((await pool.run(job())).reason, 'deadline');
    assert.equal(pool.halted, false);
  });
}

test('a warm timer never outlives the warm', { timeout: 60000 }, async t => {
  const warmPort = fileURLToPath(new URL('./fixtures/warm-port.mjs', import.meta.url));
  const warmTimers = holdTimers(t, 3599998);
  const { job, directory } = await fixture(t);
  const ready = new IsolatePool({ hostPort: warmPort, size: 2, warm: { value: 'loaded' }, warmTimeoutMs: 3599998 });
  t.after(() => ready.close());
  await ready.ready();
  assert.equal(warmTimers.count, 0);
  const exited = new IsolatePool({ hostPort: warmExit, size: 1, warm: { counter: join(directory, 'warms') }, warmTimeoutMs: 3599998 });
  t.after(() => exited.close());
  await assert.rejects(exited.ready(), /before ready/);
  while (!exited.halted) await exited.run(job());
  assert.equal(warmTimers.count, 0);
});

test('warmTimeoutMs is checked', () => {
  assert.throws(() => new IsolatePool({ hostPort, warmTimeoutMs: 0 }), /warmTimeoutMs/);
});

test('a cell that fails to start a few times recovers once one reports ready', { timeout: 60000 }, async t => {
  const { job, directory } = await fixture(t);
  const counter = join(directory, 'warms');
  const pool = new IsolatePool({ hostPort: warmExit, size: 1, warm: { counter, exitFirst: 2 } });
  t.after(() => pool.close());
  const lost = [await pool.run(job()), await pool.run(job())];
  assert.deepEqual(lost.map(result => result.reason), ['worker_exit', 'worker_exit']);
  const recovered = await pool.run(job());
  assert.equal(recovered.status, 'completed', recovered.reason);
  assert.equal(recovered.receipts[0].record.data.outcome_state, 'passed');
  assert.equal(pool.halted, false);
});
