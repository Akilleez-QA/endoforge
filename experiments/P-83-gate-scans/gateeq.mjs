import { readFileSync } from 'node:fs';
const load = t => Promise.all(['core/runtime/x1/gates.mjs', 'core/runtime/x1/host.mjs', 'core/runtime/test/fixtures/x1/candidate.mjs', 'experiments/assemblyscript-toolchain.mjs', 'tools/asc/pin.mjs'].map(p => import(new URL(p, t).href)));
const [[GA, H, C, T, P], [GB]] = [await load(process.argv[3]), await load(process.argv[4])];
const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let same = 0, n = 0;
for (const e of corpus) for (const contract of [C.withCapability(e.contract, e.glue), e.contract]) {
  const bytes = await T.compile({ name: 'kernel', source: e.kernel }, P.ASC_PATH, { flags: T.x1Flags, onDiagnostic: () => {} });
  const compiled = bytes ? { source: H.hash(e.kernel), wasm: Buffer.from(bytes).toString('base64') } : { source: H.hash(e.kernel), error: 'x' };
  const files = { 'CONTRACT.md': contract, 'tests.json': e.tests, 'kernel.ts': e.kernel, 'glue.json': e.glue, 'frozen.sha256': JSON.stringify({ contract: H.hash(contract), tests: H.hash(e.tests) }) };
  const strip = r => JSON.stringify({ ...r, at: null }, (k, v) => (/ms$/i.test(k) ? null : v));
  n++; const a = strip(GA.runGates({ id: e.name, files, compiled })), b = strip(GB.runGates({ id: e.name, files, compiled })); if (a === b) same++; else if (!globalThis.shown) { globalThis.shown = 1; let i = 0; while (a[i] === b[i]) i++; console.log(a.slice(i - 200, i + 200)); console.log(b.slice(i - 200, i + 200)); }
}
console.log('gate results identical', same, 'of', n);
