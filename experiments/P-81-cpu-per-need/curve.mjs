// Exploratory (P-81): CPU (all threads) and wall of each compile+gates round in a fresh process, from compiler load on.
import { readFileSync, readdirSync } from 'node:fs';
const root = process.argv[2], rounds = Number(process.argv[3] ?? 20), kind = process.argv[4] ?? 'primer';
const { installWasmLimit } = await import(`${root}/core/runtime/isolate-wasm.mjs`);
const { trustedWasmModules, compile, x1Flags, loadCompiler } = await import(`${root}/experiments/assemblyscript-toolchain.mjs`);
const { ASC_PATH } = await import(`${root}/tools/asc/pin.mjs`);
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
if (process.env.CC) (await import("node:module")).enableCompileCache(process.env.CC);
const t0 = performance.now(), c0 = cpu();
installWasmLimit(4096, e => { throw Error(e); }, trustedWasmModules);
const imported = await import(`${root}/core/runtime/x1/loop-port.mjs`);
const c1 = cpu(), t1 = performance.now();
await loadCompiler(ASC_PATH);
const c2 = cpu(), t2 = performance.now();
const primer = 'export function primer(a:f64,b:i32):f64{let t=a;for(let i=0;i<b;i++){t+=Math.sqrt(<f64>i)}if(b<0){throw new Error("range")}return t}';
const dir = `${root}/experiments/P-15-workcell-concurrency/kernels/`;
const kernels = readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => readFileSync(dir + f, 'utf8'));
const out = [];
const seq = kind.split(',').flatMap(t => Array(Number(t.slice(1))).fill(t[0]));
let ki = 0;
for (let i = 0; i < seq.length; i++) {
  const a = cpu(), b = performance.now();
  const src = seq[i] === 'p' ? primer : kernels[(ki++) % kernels.length];
  const bytes = await compile({ name: 'kernel', source: src }, ASC_PATH, { flags: x1Flags });
  if (bytes) new WebAssembly.Module(bytes);
  out.push([Math.round(cpu() - a), Math.round(performance.now() - b)]);
}
if (process.env.CC) (await import("node:module")).flushCompileCache();
await new Promise(r => setTimeout(r, 1500)); const c3 = cpu();
const sum = (f, t) => out.slice(f, t).reduce((x, r) => x + r[0], 0);
const nk = seq.filter(x => x === 'k').length, np = seq.length - nk;
console.log(JSON.stringify({ kind, flags: process.execArgv.join(' '), total: Math.round(c3 - c0), primers: sum(0, np), kernels: sum(np, seq.length), lastK4: sum(seq.length - 4, seq.length), boot: [Math.round(c0), Math.round(t0)], imports: [Math.round(c1 - c0), Math.round(t1 - t0)], loadCompiler: [Math.round(c2 - c1), Math.round(t2 - t1)], rounds: out, tailCpu: Math.round(c3 - c0 - out.reduce((t, r) => t + r[0], 0) - (c2 - c0)) }));
