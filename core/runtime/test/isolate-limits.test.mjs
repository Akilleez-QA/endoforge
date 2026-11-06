import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture } from './fixtures/ledger-fixture.mjs';

const hostPort = fileURLToPath(new URL('./fixtures/hang-port.mjs', import.meta.url));

test('stackSizeMb is optional, thread-only and validated', () => {
  assert.throws(() => new IsolatePool({ hostPort, resourceLimits: { stackSizeMb: 0 } }), /limits/);
  assert.throws(() => new IsolatePool({ hostPort, resourceLimits: { other: 1 } }), /limits/);
  assert.throws(() => new IsolatePool({ hostPort, isolation: 'process', resourceLimits: { stackSizeMb: 8 } }), /thread/);
  assert.throws(() => new IsolatePool({ hostPort, jobTimeoutMs: 0 }), /jobTimeoutMs/);
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
