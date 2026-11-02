import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture, hostPort } from './fixtures/ledger-fixture.mjs';
import { poolBreach } from './fixtures/pool-breach.mjs';

for (const breach of ['heap', 'wasm_memory']) {
  test(`process ${breach}: one lost cell, zero lost siblings, native verdicts and verified chain`, { timeout: 60000 }, async t => {
    const result = await poolBreach(t, 'process', breach);
    const { failed, survivors, replacement, expected, chain } = result;
    assert.equal(result.distinctInitialWorkcells, 8);
    assert.equal(result.workcellsLost, 1);
    assert.equal(result.siblingsLost, 0);
    assert.equal(failed.status, 'rejected');
    assert.equal(failed.reason, breach);
    assert.equal(failed.error, breach === 'heap' ? 'ERR_WORKER_OUT_OF_MEMORY' : 'ERR_WORKCELL_WASM_MEMORY_LIMIT');
    assert.equal(failed.receipts[0].record.data.outcome_state, 'failed');
    assert.equal(failed.receipts[0].record.data.observations[0].status, 'rejected');
    assert.equal(failed.receipts[0].record.data.observations[0].reason, breach);
    assert(['enabled', 'unavailable'].includes(failed.cgroup));
    for (const good of [...survivors, replacement]) {
      assert.deepEqual(good.report, expected);
      assert.deepEqual(good.receipts.map(r => r.record.data.outcome_state), ['passed', 'failed']);
      assert.notEqual(good.workcell, failed.workcell);
      assert.equal(good.isolation, 'process');
    }
    assert(!survivors.some(r => r.workcell === replacement.workcell));
    assert.deepEqual(chain, { receipts: 17, verified: true });
  });
}

test('process fallback, validation and unknown exits', { timeout: 30000 }, async t => {
  assert.throws(() => new IsolatePool({ hostPort, isolation: 'other' }), /isolation/);
  assert.throws(() => new IsolatePool({ hostPort, cgroupLimits: { pidsMax: 0 } }), /cgroupLimits/);
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, isolation: 'process', size: 1, cgroupRoot: '/tmp/absent-ef-cgroup' });
  t.after(() => pool.close());
  const result = await pool.run(job(['exit']));
  assert.equal(result.status, 'outcome_unknown');
  assert.equal(result.reason, 'worker_exit');
  assert.equal(result.cgroup, 'unavailable');
  assert.equal(result.receipts[0].record.data.outcome_state, 'inconclusive');
  assert.equal((await pool.run(job())).status, 'completed');
});

test('process compile gate rejects missing and oversized imported or defined memory limits', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ isolation: 'process', size: 1, wasmMemoryMaxMb: 1,
    hostPort: fileURLToPath(new URL('./fixtures/wasm-port.mjs', import.meta.url)) });
  t.after(() => pool.close());
  for (const memory of [[0, 1], [1, 1, 17], [1, 17, 17]]) for (const imported of [false, true]) {
    const section = imported ? [1, 1, 101, 1, 109, 2, ...memory] : [1, ...memory];
    const bytes = [0, 97, 115, 109, 1, 0, 0, 0, imported ? 2 : 5, section.length, ...section];
    for (const action of ['compile', 'instantiate']) {
      const result = await pool.run(job(['pass'], { action, bytes }));
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason, 'wasm_memory');
      assert.equal(result.report, null);
      assert.equal(result.receipts[0].record.data.outcome_state, 'failed');
    }
  }
});
