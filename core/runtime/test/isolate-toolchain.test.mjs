import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const policy = { name: 'synthetic-compiler', sha256, maximumPages: 2 };

test('trusted compiler policy rejects invalid or ambiguous caps', () => {
  for (const entry of [{ ...policy, name: '../compiler' }, { ...policy, sha256: 'wrong' },
    ...[0, 1.5, 17].map(maximumPages => ({ ...policy, maximumPages }))]) {
    assert.throws(() => new IsolatePool({ hostPort, wasmMemoryMaxMb: 1, trustedWasmModules: [entry] }), /trustedWasmModules/);
  }
  assert.throws(() => new IsolatePool({ hostPort, trustedWasmModules: [policy, policy] }), /trustedWasmModules/);
});

for (const isolation of ['thread', 'process']) {
  test(`${isolation}: trusted compiler runs with an explicit native maximum and supervisor receipt`, { timeout: 30000 }, async t => {
    const boundedCompiler = [...compiler.slice(0, 20), 5, 4, 1, 1, 1, 1, ...compiler.slice(25)];
    const existing = { ...policy, name: 'already-bounded-compiler',
      sha256: createHash('sha256').update(Uint8Array.from(boundedCompiler)).digest('hex') };
    const { job } = await fixture(t), declared = [{ ...policy }, existing];
    const pool = new IsolatePool({ hostPort, size: 1, isolation, wasmMemoryMaxMb: 1, trustedWasmModules: declared });
    t.after(() => pool.close());
    declared[0].maximumPages = 16;
    for (const action of ['compile', 'module', 'instantiate', 'instance', 'compile-streaming', 'instantiate-streaming']) {
      const result = await pool.run(job(['pass'], { action, bytes: compiler, pages: 1, checkMemory: 2 }));
      assert.equal(result.status, 'completed');
      assert.equal(result.receipts[0].record.data.outcome_state, 'passed');
      assert.deepEqual(result.trustedWasmModules, [policy, existing]);
      assert.deepEqual(result.receipts[0].record.data.observations[0].trustedWasmModules, [policy, existing]);
    }
    const bounded = await pool.run(job(['pass'], { action: 'instantiate', bytes: compiler, pages: 2,
      expectedOldPages: -1, checkMemory: 1 }));
    assert.equal(bounded.status, 'completed');
    assert.equal(bounded.receipts[0].record.data.outcome_state, 'passed');
    const preserved = await pool.run(job(['pass'], { action: 'instantiate', bytes: boundedCompiler, pages: 1,
      expectedOldPages: -1, checkMemory: 1 }));
    assert.equal(preserved.status, 'completed');
    assert.equal(preserved.receipts[0].record.data.outcome_state, 'passed');
  });

  test(`${isolation}: untrusted no-max remains rejected despite candidate-supplied policy`, { timeout: 30000 }, async t => {
    const { job } = await fixture(t);
    const pool = new IsolatePool({ hostPort, size: 1, isolation, wasmMemoryMaxMb: 1, trustedWasmModules: [policy] });
    t.after(() => pool.close());
    const bytes = [...compiler, 0, 2, 1, 120];
    const forged = [{ ...policy, sha256: createHash('sha256').update(Uint8Array.from(bytes)).digest('hex') }];
    const result = await pool.run(job(['pass'], { action: 'instantiate', bytes, trustedWasmModules: forged }));
    assert.equal(result.error, 'ERR_WORKCELL_WASM_MEMORY_LIMIT');
    assert.equal(result.report, null);
    assert.equal(result.status, isolation === 'process' ? 'rejected' : 'outcome_unknown');
    assert.deepEqual(result.receipts[0].record.data.observations[0].trustedWasmModules, [policy]);
    const replacement = await pool.run(job(['pass'], { action: 'instantiate', bytes: compiler, pages: 1 }));
    assert.equal(replacement.status, 'completed');
    assert.notEqual(replacement.workcell, result.workcell);
  });
}
