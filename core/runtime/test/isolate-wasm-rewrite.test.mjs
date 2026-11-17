import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

// P-78: the guard rewrites every module a cell compiles, the 8.9 MB compiler included, once per cell start. The rewrite
// copies through every byte it does not change; these digests are what the per-byte rewrite before P-78 produced.
const guard = new URL('../isolate-wasm.mjs', import.meta.url).href;
const compiler = { bytes: 8907183, sha256: '4ef5a64b915604b42bfdba2d1f4fc3536678e3b3d5b836e586c71a16eb84d529' };
const sequence = 'a5fe94b318916f68c16a723eabd4e0fc90a2f9573e2e2ef246f279fb0136e4d4';

const body = `
const { createHash } = await import('node:crypto');
const { parentPort, workerData: { guard, pin, port } } = await import('node:worker_threads');
const seen = [], record = bytes => { const view = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes); seen.push([view.length, createHash('sha256').update(view).digest('hex')]); };
const compile = WebAssembly.compile, Module = WebAssembly.Module;
WebAssembly.compile = (bytes, options) => { record(bytes); return compile(bytes, options); };
WebAssembly.Module = new Proxy(Module, { construct: (target, [bytes, options], derived) => { record(bytes); return Reflect.construct(target, [bytes, options], derived); } });
const { installWasmLimit } = await import(guard);
const { WORKCELL } = await import(pin);
installWasmLimit(WORKCELL.wasmMemoryMaxMb, error => { throw new Error(error); }, WORKCELL.trustedWasmModules);
await (await import(port)).warm({ primes: 2 });
parentPort.postMessage({ seen, sequence: createHash('sha256').update(JSON.stringify(seen)).digest('hex') });
`;

test('the guard rewrites the compiler and the primer kernels to the same bytes as before P-78', { timeout: 60000 }, async () => {
  const workerData = { guard, pin: new URL('../../../tools/asc/pin.mjs', import.meta.url).href, port: new URL('../x1/loop-port.mjs', import.meta.url).href };
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(`import(${JSON.stringify(`data:text/javascript,${encodeURIComponent(body)}`)});`, { eval: true, workerData });
    worker.once('message', message => { worker.terminate(); resolve(message); });
    worker.once('error', reject);
  });
  assert.deepEqual(result.seen.find(([length]) => length === compiler.bytes), [compiler.bytes, compiler.sha256]);
  assert.equal(result.sequence, sequence);
});
