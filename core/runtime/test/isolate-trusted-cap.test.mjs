import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture } from './fixtures/ledger-fixture.mjs';

const hostPort = fileURLToPath(new URL('./fixtures/wasm-port.mjs', import.meta.url));
const compiler = [0, 97, 115, 109, 1, 0, 0, 0,
  1, 6, 1, 0x60, 1, 0x7f, 1, 0x7f, 3, 2, 1, 0, 5, 3, 1, 0, 1,
  7, 17, 2, 6, 109, 101, 109, 111, 114, 121, 2, 0, 4, 103, 114, 111, 119, 0, 0,
  10, 8, 1, 6, 0, 0x20, 0, 0x40, 0, 0x0b];
const sha256 = createHash('sha256').update(Uint8Array.from(compiler)).digest('hex');
const policy = maximumPages => [{ name: 'synthetic-compiler', sha256, maximumPages }];

async function breach(t, isolation, maximumPages, exercise) {
  const { job, directory } = await fixture(t);
  const barrier = join(directory, 'barrier'), release = join(directory, 'release');
  mkdirSync(barrier);
  const size = 4;
  const pool = new IsolatePool({ hostPort, size, isolation, wasmMemoryMaxMb: 1, trustedWasmModules: policy(maximumPages) });
  t.after(() => pool.close());
  const healthy = { action: 'instantiate', bytes: compiler, pages: 1 };
  const failed = pool.run(job(['pass'], { action: 'instantiate', bytes: compiler, barrier, participants: size, ...exercise }));
  const siblings = Array.from({ length: size - 1 }, () => pool.run(job(['pass'], { ...healthy, barrier, participants: size, release })));
  const stopped = await failed;
  writeFileSync(release, 'go');
  const survivors = await Promise.all(siblings);
  const replacement = await pool.run(job(['pass'], healthy));
  await pool.close();
  return { stopped, survivors, replacement };
}

const assertStopped = ({ stopped, survivors, replacement }, isolation) => {
  assert.equal(stopped.error, 'ERR_WORKCELL_WASM_MEMORY_LIMIT');
  assert.equal(stopped.status, isolation === 'process' ? 'rejected' : 'outcome_unknown');
  assert.equal(stopped.report, null);
  assert.notEqual(stopped.receipts[0].record.data.outcome_state, 'passed');
  assert.deepEqual(stopped.receipts[0].record.data.observations[0].trustedWasmModules, policy(stopped.trustedWasmModules[0].maximumPages));
  for (const sibling of survivors) {
    assert.equal(sibling.status, 'completed');
    assert.equal(sibling.receipts[0].record.data.outcome_state, 'passed');
    assert.notEqual(sibling.workcell, stopped.workcell);
  }
  assert.equal(replacement.status, 'completed');
  assert.notEqual(replacement.workcell, stopped.workcell);
};

const importer = [0, 97, 115, 109, 1, 0, 0, 0, 2, 15, 1, 3, 101, 110, 118, 6, 109, 101, 109, 111, 114, 121, 2, 0, 1];
const importerPolicy = [{ name: 'synthetic-importer', sha256: createHash('sha256').update(Uint8Array.from(importer)).digest('hex'), maximumPages: 2 }];

for (const isolation of ['thread', 'process']) {
  test(`${isolation}: JS growth of a pinned module's imported memory past maximumPages stops its cell, even if the RangeError is caught`, { timeout: 60000 }, async t => {
    const { job } = await fixture(t);
    const pool = new IsolatePool({ hostPort, size: 1, isolation, wasmMemoryMaxMb: 1, trustedWasmModules: importerPolicy });
    t.after(() => pool.close());
    const within = await pool.run(job(['pass'], { action: 'instantiate', bytes: importer, imports: true, importMaximum: 2, importGrow: true, pages: 1 }));
    assert.equal(within.status, 'completed');
    const stopped = await pool.run(job(['pass'], { action: 'instantiate', bytes: importer, imports: true, importMaximum: 2, importGrow: true, pages: 2 }));
    assert.equal(stopped.error, 'ERR_WORKCELL_WASM_MEMORY_LIMIT');
    assert.notEqual(stopped.receipts[0].record.data.outcome_state, 'passed');
  });

  test(`${isolation}: a pinned module growing past maximumPages stops its cell and keeps its siblings`, { timeout: 60000 }, async t => {
    assertStopped(await breach(t, isolation, 2, { pages: 2 }), isolation);
  });

  test(`${isolation}: a pinned module cannot continue by catching the trap`, { timeout: 60000 }, async t => {
    assertStopped(await breach(t, isolation, 2, { pages: 2, swallow: true }), isolation);
  });

  test(`${isolation}: JS growth of a pinned module's exported memory past maximumPages stops its cell`, { timeout: 60000 }, async t => {
    assertStopped(await breach(t, isolation, 2, { pages: 2, exportGrow: true }), isolation);
  });

  test(`${isolation}: a pin at the workcell ceiling stops growth past it`, { timeout: 60000 }, async t => {
    assertStopped(await breach(t, isolation, 16, { pages: 16 }), isolation);
  });

  test(`${isolation}: growth up to exactly maximumPages is not a breach`, { timeout: 60000 }, async t => {
    const { job } = await fixture(t);
    const pool = new IsolatePool({ hostPort, size: 1, isolation, wasmMemoryMaxMb: 1, trustedWasmModules: policy(2) });
    t.after(() => pool.close());
    const result = await pool.run(job(['pass'], { action: 'instantiate', bytes: compiler, pages: 1, checkMemory: 2 }));
    assert.equal(result.status, 'completed');
    assert.equal(result.receipts[0].record.data.outcome_state, 'passed');
  });
}
