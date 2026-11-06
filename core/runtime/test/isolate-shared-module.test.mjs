import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const trustedWasmModules = [{ name: 'synthetic-compiler', sha256, maximumPages: 2 }];

function compilerFile(t, bytes = compiler) {
  const directory = mkdtempSync(join(tmpdir(), 'ef-shared-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'compiler.wasm');
  writeFileSync(path, Uint8Array.from(bytes));
  return path;
}
const options = (t, path, extra) => ({ hostPort, wasmMemoryMaxMb: 1, trustedWasmModules, sharedWasmModules: [{ sha256, path }], ...extra });

test('process cells compile per cell, since a module cannot cross a process boundary', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool(options(t, compilerFile(t), { size: 1, isolation: 'process' }));
  t.after(() => pool.close());
  const result = await pool.run(job(['pass'], { action: 'instantiate', bytes: compiler, pages: 1, checkMemory: 2 }));
  assert.equal(result.status, 'completed');
  assert.equal(result.sharedWasmModules, undefined);
});

test('shared modules are validated and must be pinned', t => {
  const path = compilerFile(t);
  assert.throws(() => new IsolatePool(options(t, path, { trustedWasmModules: [] })), /sharedWasmModules/);
  assert.throws(() => new IsolatePool(options(t, path, { sharedWasmModules: [{ sha256 }] })), /sharedWasmModules/);
});

test('a shared module runs through every checked path and keeps per-instance state', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool(options(t, compilerFile(t), { size: 1 }));
  t.after(() => pool.close());
  for (const action of ['compile', 'module', 'instantiate', 'instance', 'compile-streaming', 'instantiate-streaming']) {
    const result = await pool.run(job(['pass'], { action, bytes: compiler, pages: 1, checkMemory: 2 }));
    assert.equal(result.status, 'completed', action);
    assert.deepEqual(result.sharedWasmModules, [sha256]);
    assert.equal(result.receipts[0].record.data.outcome_state, 'passed');
  }
});

test('a shared module growing past its cap stops only its cell', { timeout: 60000 }, async t => {
  const { job, directory } = await fixture(t);
  const barrier = join(directory, 'barrier'), release = join(directory, 'release');
  mkdirSync(barrier);
  const size = 4;
  const pool = new IsolatePool(options(t, compilerFile(t), { size }));
  t.after(() => pool.close());
  const healthy = { action: 'instantiate', bytes: compiler, pages: 1, checkMemory: 2 };
  const failing = pool.run(job(['pass'], { action: 'instantiate', bytes: compiler, pages: 2, swallow: true, barrier, participants: size }));
  const siblings = Array.from({ length: size - 1 }, () => pool.run(job(['pass'], { ...healthy, barrier, participants: size, release })));
  const stopped = await failing;
  writeFileSync(release, 'go');
  const survivors = await Promise.all(siblings);
  const replacement = await pool.run(job(['pass'], healthy));
  assert.equal(stopped.status, 'outcome_unknown');
  assert.equal(stopped.error, 'ERR_WORKCELL_WASM_MEMORY_LIMIT');
  assert.deepEqual(survivors.map(r => r.status), ['completed', 'completed', 'completed']);
  assert.equal(replacement.status, 'completed');
  assert.deepEqual(replacement.sharedWasmModules, [sha256]);
  assert.notEqual(replacement.workcell, stopped.workcell);
});

test('a module from port options stays refused, and other bytes are still checked', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool(options(t, compilerFile(t), { size: 1 }));
  t.after(() => pool.close());
  const foreign = await pool.run(job(['pass'], { action: 'foreign-module', module: new WebAssembly.Module(Uint8Array.from(compiler)) }));
  assert.equal(foreign.status, 'outcome_unknown');
  assert.notEqual(foreign.receipts[0].record.data.outcome_state, 'passed');
  const other = await pool.run(job(['pass'], { action: 'instantiate', bytes: [...compiler, 0, 2, 1, 120] }));
  assert.equal(other.error, 'ERR_WORKCELL_WASM_MEMORY_LIMIT');
});

test('bytes that do not match the digest fall back to per-cell compile', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  for (const path of [compilerFile(t, [...compiler, 0, 2, 1, 120]), '/nonexistent/compiler.wasm']) {
    const pool = new IsolatePool(options(t, path, { size: 1 }));
    t.after(() => pool.close());
    const result = await pool.run(job(['pass'], { action: 'instantiate', bytes: compiler, pages: 1, checkMemory: 2 }));
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.sharedWasmModules, []);
    await pool.close();
  }
});
