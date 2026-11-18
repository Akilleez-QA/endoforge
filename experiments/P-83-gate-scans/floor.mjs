import { performance } from 'node:perf_hooks';
const root = new URL(process.argv[2].replace(/\/?$/, '/'), 'file://');
const { compile, loadCompiler, x1Flags } = await import(new URL('experiments/assemblyscript-toolchain.mjs', root));
const { ASC_PATH } = await import(new URL('tools/asc/pin.mjs', root));
const { runGates } = await import(new URL('core/runtime/x1/gates.mjs', root));
const { hash } = await import(new URL('core/runtime/x1/host.mjs', root));
const { withCapability } = await import(new URL('core/runtime/test/fixtures/x1/candidate.mjs', root));
const corpus = JSON.parse(process.argv[3] ? (await import('node:fs')).readFileSync(process.argv[3], 'utf8') : '[]').map(e => ({ ...e, contract: withCapability(e.contract, e.glue) }));
if (process.env.GUARD) { const { installWasmLimit } = await import(new URL('core/runtime/isolate-wasm.mjs', root)); const { trustedWasmModules } = await import(new URL('experiments/assemblyscript-toolchain.mjs', root)); installWasmLimit(4096, e => { throw Error(e); }, trustedWasmModules); }
await loadCompiler(ASC_PATH);
const rounds = Number(process.argv[4] ?? 8), compileMs = [], gateMs = [], digests = {};
for (let r = 0; r < rounds; r++) {
  let c = 0, g = 0;
  for (const e of corpus) {
    const t0 = performance.now();
    const bytes = await compile({ name: 'kernel', source: e.kernel }, ASC_PATH, { flags: x1Flags, onDiagnostic: () => {} });
    const t1 = performance.now();
    const compiled = bytes ? { source: hash(e.kernel), wasm: Buffer.from(bytes).toString('base64') } : { source: hash(e.kernel), error: 'compile' };
    if (bytes) digests[e.name] = hash(Buffer.from(bytes));
    const files = { 'CONTRACT.md': e.contract, 'tests.json': e.tests, 'kernel.ts': e.kernel, 'glue.json': e.glue, 'frozen.sha256': JSON.stringify({ contract: hash(e.contract), tests: hash(e.tests) }) };
    const t2 = performance.now();
    runGates({ id: e.name, files, compiled });
    const t3 = performance.now();
    c += t1 - t0; g += t3 - t2;
  }
  compileMs.push(c / corpus.length); gateMs.push(g / corpus.length);
}
const cpu = process.cpuUsage();
console.log(JSON.stringify({ kernels: corpus.length, rounds, compileMsPerKernel: compileMs.map(v => +v.toFixed(2)), gateMsPerKernel: gateMs.map(v => +v.toFixed(2)), digests }));
