import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture } from './fixtures/ledger-fixture.mjs';

const hostPort = fileURLToPath(new URL('./fixtures/hang-port.mjs', import.meta.url));

test('stackSizeMb is optional and validated', () => {
  assert.throws(() => new IsolatePool({ hostPort, resourceLimits: { stackSizeMb: 0 } }), /limits/);
  assert.throws(() => new IsolatePool({ hostPort, resourceLimits: { other: 1 } }), /limits/);
  const pool = fileURLToPath(new URL('../isolate-pool.mjs', import.meta.url));
  const refused = spawnSync('/bin/sh', ['-c', 'ulimit -Hs 8192 && exec "$@"', 'sh', process.execPath, '--input-type=module', '-e',
    `import { IsolatePool } from ${JSON.stringify(pool)}; new IsolatePool({ hostPort: ${JSON.stringify(hostPort)}, isolation: 'process', resourceLimits: { stackSizeMb: 64 } });`], { encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /cannot raise the process stack limit/);
  assert.throws(() => new IsolatePool({ hostPort, jobTimeoutMs: 0 }), /jobTimeoutMs/);
});

test('process: a stack overflow under stackSizeMb is an unknown outcome, not a dead process', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort: fileURLToPath(new URL('./fixtures/recurse-port.mjs', import.meta.url)), size: 1, isolation: 'process', resourceLimits: { stackSizeMb: 64 } });
  t.after(() => pool.close());
  const overflowed = await pool.run(job(['pass'], { recurse: true }));
  assert.equal(overflowed.status, 'outcome_unknown');
  assert.equal(overflowed.signal, undefined);
  assert.notEqual(overflowed.receipts[0].record.data.outcome_state, 'passed');
  const next = await pool.run(job(['pass'], {}));
  assert.equal(next.status, 'completed');
  assert.equal(next.workcell, overflowed.workcell);
});

test('a job past its deadline is unknown, its cell is replaced, and the next job completes', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1, jobTimeoutMs: 1500, resourceLimits: { stackSizeMb: 8 } });
  t.after(() => pool.close());
  const hung = await pool.run(job(['pass'], { hang: true }));
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
