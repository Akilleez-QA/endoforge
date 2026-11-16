import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { IsolatePool } from '../isolate-pool.mjs';
import { installWasmLimit } from '../isolate-wasm.mjs';
import { toolingWasmPolicy } from '../isolate-wasm-tooling.mjs';
import { loadKernel } from '../x1/meter.mjs';
import { WORKCELL as ASC } from '../../../tools/asc/pin.mjs';
import { KITESURF_ARTIFACT, KITESURF_CORE, WORKCELL as BROWSER } from '../../../tools/browser/pin.mjs';
import { WORKCELL as TSCHECK } from '../../../tools/tscheck/pin.mjs';
import { fixture } from './fixtures/ledger-fixture.mjs';

const hostPort = fileURLToPath(new URL('./fixtures/wasm-port.mjs', import.meta.url));
const toolingPort = fileURLToPath(new URL('./fixtures/tooling-port.mjs', import.meta.url));
const workArea = fileURLToPath(new URL('../../../.test-work/', import.meta.url));
const release = `https://github.com/Akilleez-QA/endoforge/releases/download/${KITESURF_CORE.name}/${KITESURF_ARTIFACT.file}`;
const section = (id, bytes) => [id, bytes.length, ...bytes];
const memory = (initial = 1, maximum) => section(5, maximum ? [1, 1, initial, maximum] : [1, 0, initial]);
const exported = section(7, [2, 6, ...Buffer.from('memory'), 2, 0, 3, ...Buffer.from('run'), 0, 0]);
const module = (...sections) => [0, 97, 115, 109, 1, 0, 0, 0, ...sections.flat()];
const ehModule = (initial = 1, maximum = 2) => module(section(1, [2, 0x60, 0, 0, 0x60, 0, 1, 0x7f]), section(3, [1, 1]), memory(initial, maximum),
  section(13, [1, 0, 0]), exported, section(10, [1, 11, 0, 0x06, 0x7f, 0x08, 0, 0x07, 0, 0x41, 42, 0x0b, 0x0b]));
const eh = ehModule();
const simd = module(section(1, [1, 0x60, 0, 1, 0x7f]), section(3, [1, 0]), memory(), exported,
  section(10, [1, 23, 0, 0xfd, 0x0c, 1, 0, 0, 0, 7, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xfd, 0x1b, 1, 0x0b]));
const oom = module(section(1, [1, 0x60, 0, 0]), section(3, [1, 0]), memory(), exported,
  section(10, [1, 13, 0, 0x41, 4, 0x40, 0, 0x41, 0x7f, 0x46, 0x04, 0x40, 0x00, 0x0b, 0x0b]));
const divide = module(section(1, [1, 0x60, 0, 1, 0x7f]), section(3, [1, 0]), memory(), exported,
  section(10, [1, 7, 0, 0x41, 1, 0x41, 0, 0x6d, 0x0b]));
const abort = module(section(1, [1, 0x60, 0, 0]), section(3, [1, 0]), memory(), exported,
  section(10, [1, 8, 0, 0x41, 1, 0x40, 0, 0x1a, 0x00, 0x0b]));
const recovered = module(section(1, [1, 0x60, 0, 0]), section(3, [2, 0, 0]), memory(),
  section(7, [3, 6, ...Buffer.from('memory'), 2, 0, 3, ...Buffer.from('run'), 0, 1, 7, ...Buffer.from('prepare'), 0, 0]),
  section(10, [2, 7, 0, 0x41, 4, 0x40, 0, 0x1a, 0x0b, 3, 0, 0x00, 0x0b]));
const importer = module(section(2, [1, 3, ...Buffer.from('env'), 6, ...Buffer.from('memory'), 2, 0, 1]));
const digest = bytes => createHash('sha256').update(Uint8Array.from(bytes)).digest('hex');
const pin = (bytes, maximumPages = 2) => ({ name: 'synthetic-tool', sha256: digest(bytes), maximumPages });
const tamper = (bytes, fromEnd) => bytes.map((byte, index) => index === bytes.length - fromEnd ? byte + 1 : byte);
const bounded = /unsupported wasm feature in bounded workcell/;
const refused = /unsupported wasm feature in bounded workcell|ERR_WORKCELL_WASM_MEMORY_LIMIT/;

const body = `
const { installWasmLimit } = await import(${JSON.stringify(new URL('../isolate-wasm.mjs', import.meta.url).href)});
const { parentPort, workerData: { bytes, trusted, tooling } } = await import('node:worker_threads');
try {
  installWasmLimit(1, error => { throw new Error(error); }, trusted, [], tooling);
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(bytes)), { env: { memory: new WebAssembly.Memory({ initial: 1 }) } });
  exports.prepare?.();
  const value = exports.run(), before = exports.memory.grow(1);
  let overflow = null;
  try { exports.memory.grow(1); } catch (error) { overflow = error.message; }
  parentPort.postMessage({ value, before, overflow });
} catch (error) { parentPort.postMessage({ error: error.message }); }
`;
const cell = (bytes, { trusted = [], tooling = [] } = {}) => new Promise((resolve, reject) => {
  const worker = new Worker(`import(${JSON.stringify(`data:text/javascript,${encodeURIComponent(body)}`)});`, { eval: true, workerData: { bytes, trusted, tooling } });
  worker.once('message', message => { worker.terminate(); resolve(message); });
  worker.once('error', reject);
});

test('candidate kernels using exception handling or SIMD are still refused by G2 and the workcell guard', async () => {
  for (const bytes of [eh, simd]) {
    assert.throws(() => loadKernel(Uint8Array.from(bytes), 1000), /unmeterable opcode/);
    assert.match((await cell(bytes)).error, refused);
    assert.match((await cell(bytes, { trusted: [pin(bytes)] })).error, bounded);
  }
});

test('a pinned tooling module runs with exception handling or SIMD and stops at its pinned maximum', async () => {
  for (const [bytes, value] of [[eh, 42], [simd, 7]]) {
    assert.deepEqual(await cell(bytes, { tooling: [pin(bytes)] }), { value, before: 1, overflow: 'ERR_WORKCELL_WASM_MEMORY_LIMIT' });
  }
});

test('a pinned tooling module that traps with unreachable after a failed memory.grow is a memory limit breach', async () => {
  assert.deepEqual(await cell(oom, { tooling: [pin(oom)] }), { error: 'ERR_WORKCELL_WASM_MEMORY_LIMIT' });
});

test('a tooling trap without a failed memory.grow in the same call is not a memory limit breach', async () => {
  assert.deepEqual(await cell(abort, { tooling: [pin(abort)] }), { error: 'unreachable' });
  assert.deepEqual(await cell(recovered, { tooling: [pin(recovered)] }), { error: 'unreachable' });
  assert.deepEqual(await cell(divide, { tooling: [pin(divide)] }), { error: 'divide by zero' });
});

test('unpinned and tampered tooling modules take the unchanged guard and are refused', async () => {
  assert.match((await cell(simd, { tooling: [pin(eh)] })).error, refused);
  assert.match((await cell(tamper(eh, 3), { tooling: [pin(eh)] })).error, refused);
  assert.match((await cell(tamper(simd, 2), { tooling: [pin(simd)] })).error, refused);
  assert(WebAssembly.validate(Uint8Array.from(tamper(eh, 3))) && WebAssembly.validate(Uint8Array.from(tamper(simd, 2))));
});

test('a pinned tooling module cannot import memory or start above its pinned maximum', async () => {
  assert.match((await cell(importer, { tooling: [pin(importer)] })).error, /unsupported wasm feature in tooling module/);
  assert.match((await cell(ehModule(3, 4), { tooling: [pin(ehModule(3, 4))] })).error, /exceeds its pinned maximum/);
});

test('tooling policy rejects bad entries and digests that are also trusted', () => {
  const entry = pin(eh);
  for (const bad of [{ ...entry, name: '../tool' }, { ...entry, sha256: 'wrong' }, { ...entry, maximumPages: 17 }, { ...entry, maximumPages: 1.5 }]) {
    assert.throws(() => toolingWasmPolicy([bad], 1), /invalid toolingWasmModules entry/);
  }
  assert.throws(() => toolingWasmPolicy([entry, entry], 1), /invalid toolingWasmModules entry/);
  assert.throws(() => toolingWasmPolicy({}, 1), /must be an array/);
  assert.throws(() => installWasmLimit(1, () => {}, [entry], [], [entry]), /both trusted and tooling/);
  assert.throws(() => new IsolatePool({ hostPort, wasmMemoryMaxMb: 1, trustedWasmModules: [entry], toolingWasmModules: [entry] }), /both trusted and tooling/);
});

test('the browser pin is valid and disjoint from the trusted compiler pins', () => {
  const pinned = toolingWasmPolicy(BROWSER.toolingWasmModules, BROWSER.wasmMemoryMaxMb);
  const trusted = new Set([...ASC.trustedWasmModules, ...TSCHECK.trustedWasmModules].map(entry => entry.sha256));
  assert(pinned.every(entry => !trusted.has(entry.sha256)));
});

for (const isolation of ['thread', 'process']) {
  test(`${isolation}: a cell runs a pinned tooling module and refuses it unpinned`, { timeout: 60000 }, async t => {
    const { job } = await fixture(t);
    const policy = [pin(eh)];
    const pinned = new IsolatePool({ hostPort, size: 1, isolation, wasmMemoryMaxMb: 1, toolingWasmModules: policy });
    const plain = new IsolatePool({ hostPort, size: 1, isolation, wasmMemoryMaxMb: 1 });
    t.after(() => Promise.all([pinned.close(), plain.close()]));
    const admitted = await pinned.run(job(['pass'], { action: 'instantiate', bytes: eh }));
    assert.equal(admitted.status, 'completed');
    assert.equal(admitted.receipts[0].record.data.outcome_state, 'passed');
    assert.deepEqual(admitted.toolingWasmModules, policy);
    const refused = await plain.run(job(['pass'], { action: 'instantiate', bytes: eh }));
    assert.notEqual(refused.receipts[0].record.data.outcome_state, 'passed');
    assert.equal(refused.toolingWasmModules, undefined);
  });
}

const limited = result => {
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'wasm_memory');
  assert.equal(result.error, 'ERR_WORKCELL_WASM_MEMORY_LIMIT');
  assert.equal(result.exitCode, 18);
};

test('process: a tooling module that traps with unreachable after memory.grow is refused as ERR_WORKCELL_WASM_MEMORY_LIMIT', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort: toolingPort, size: 1, isolation: 'process', wasmMemoryMaxMb: 1, toolingWasmModules: [pin(oom)] });
  t.after(() => pool.close());
  limited(await pool.run(job(['pass'], { bytes: oom, call: 'run' })));
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const kitesurf = async t => {
  const tarball = join(workArea, 'kitesurf', KITESURF_ARTIFACT.file);
  if (!existsSync(tarball)) {
    try {
      const response = await fetch(release, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) return t.skip(`kitesurf artifact unavailable: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (sha256(bytes) !== KITESURF_ARTIFACT.sha256) return t.skip('kitesurf artifact digest mismatch');
      mkdirSync(join(workArea, 'kitesurf'), { recursive: true });
      writeFileSync(tarball, bytes);
    } catch (error) { return t.skip(`kitesurf artifact unavailable: ${error.message}`); }
  }
  if (sha256(readFileSync(tarball)) !== KITESURF_ARTIFACT.sha256) return t.skip('cached kitesurf artifact digest mismatch');
  const directory = mkdtempSync(join(workArea, 'kitesurf-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync('tar', ['xzf', tarball, '-C', directory, '--no-same-owner']);
  const root = join(directory, KITESURF_ARTIFACT.file.replace(/\.tar\.gz$/, ''));
  const wasm = join(root, 'kitesurf_core_bg.wasm'), glue = join(root, 'kitesurf_core.js');
  if (!existsSync(wasm) || !existsSync(glue) || sha256(readFileSync(wasm)) !== KITESURF_CORE.sha256) return t.skip('kitesurf wasm digest mismatch');
  return { wasm, glue };
};

test('process: kitesurf-core allocating past its 4096-page pin is refused as ERR_WORKCELL_WASM_MEMORY_LIMIT', { timeout: 300000 }, async t => {
  const artifact = await kitesurf(t);
  if (!artifact) return;
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort: toolingPort, size: 1, isolation: 'process', ...BROWSER });
  t.after(() => pool.close());
  limited(await pool.run(job(['pass'], { ...artifact, call: '__wbindgen_malloc', args: [260 * 1024 * 1024, 1] })));
});
