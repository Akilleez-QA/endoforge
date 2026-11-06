import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture } from './fixtures/ledger-fixture.mjs';

const hostPort = fileURLToPath(new URL('../../../experiments/P-44-offheap/port.mjs', import.meta.url));
const resourceLimits = { maxOldGenerationSizeMb: 24, maxYoungGenerationSizeMb: 4 };
const options = (t, capMb) => {
  const directory = mkdtempSync(join(tmpdir(), 'ef-offheap-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { alloc: { kind: 'arraybuffer', capMb, progress: join(directory, 'progress.json') } };
};

for (const isolation of ['thread', 'process']) {
  test(`${isolation}: heap limits do not bound off-heap memory, the stated limit in REQ-ISO-013`, { timeout: 60000 }, async t => {
    const { job } = await fixture(t);
    const pool = new IsolatePool({ hostPort, size: 1, isolation, resourceLimits, cgroupRoot: isolation === 'process' ? '/tmp/absent-ef-cgroup' : undefined });
    t.after(() => pool.close());
    const result = await pool.run(job(['pass'], options(t, 256)));
    assert.equal(result.status, 'completed');
    assert.equal(result.receipts[0].record.data.outcome_state, 'passed');
    assert.equal(result.cgroup, isolation === 'process' ? 'unavailable' : 'not_applicable');
  });
}

test('process with a delegated cgroup: off-heap memory past memory.max is killed and never passes', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1, isolation: 'process', resourceLimits,
    cgroupRoot: process.env.EF_TEST_CGROUP_ROOT, cgroupLimits: { memoryMax: 128 * 1048576 } });
  t.after(() => pool.close());
  const result = await pool.run(job(['pass'], options(t, 1024)));
  if (result.cgroup !== 'enabled') return t.skip('no delegated cgroup: run inside a Delegate=yes scope');
  assert.equal(result.status, 'outcome_unknown');
  assert.equal(result.reason, 'worker_exit');
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.receipts[0].record.data.outcome_state, 'inconclusive');
  assert.equal((await pool.run(job(['pass'], {}))).status, 'completed');
});
