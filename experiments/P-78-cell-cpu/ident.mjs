// Exploratory (P-78): node ident.mjs <guard module URL or path> -- prints the digest of every module the guard hands to native compile (compiler, primers, P-15 kernels).
// Byte identity of the guard's rewrite: capture what reaches native compile for the compiler, primer and corpus kernels.
import { createHash } from 'node:crypto';
const [guardPath, mode] = process.argv.slice(2);
const seen = [];
const nativeCompile = WebAssembly.compile, NativeModule = WebAssembly.Module;
const record = bytes => { const v = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes); seen.push([v.length, createHash('sha256').update(v).digest('hex')]); };
WebAssembly.compile = (bytes, options) => { record(bytes); return nativeCompile(bytes, options); };
WebAssembly.Module = new Proxy(NativeModule, { construct(target, [bytes, options], derived) { record(bytes); return Reflect.construct(target, [bytes, options], derived); } });
const { installWasmLimit } = await import(guardPath);
const { WORKCELL } = await import('../../tools/asc/pin.mjs');
installWasmLimit(WORKCELL.wasmMemoryMaxMb, e => { throw Error(e); }, WORKCELL.trustedWasmModules);
const t = performance.now();
const port = await import('../../core/runtime/x1/loop-port.mjs');
await port.warm({ primes: 2 });
const warmMs = performance.now() - t;
// corpus kernels, compiled and loaded through the gates' own path
const { compile, x1Flags } = await import('../../experiments/assemblyscript-toolchain.mjs');
const { ASC_PATH } = await import('../../tools/asc/pin.mjs');
const { readFileSync, readdirSync } = await import('node:fs');
const dir = new URL('../../experiments/P-15-workcell-concurrency/kernels/', import.meta.url);
let kernels = 0;
for (const name of readdirSync(dir).filter(n => n.endsWith('.ts')).sort()) {
  const bytes = await compile({ name: 'kernel', source: readFileSync(new URL(name, dir), 'utf8') }, ASC_PATH, { flags: x1Flags });
  if (bytes) { new WebAssembly.Module(bytes); kernels++; }
}
console.log(JSON.stringify({ guard: guardPath.split('/').pop(), warmMs: Math.round(warmMs), kernels, modules: seen.length, digest: createHash('sha256').update(JSON.stringify(seen)).digest('hex'), first: seen.slice(0, 3) }));
