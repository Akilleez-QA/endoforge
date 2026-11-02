import fs from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ns = () => Number(process.hrtime.bigint());
const ms = start => (ns() - start) / 1e6;
const stat = values => { const s = [...values].sort((a, b) => a - b), q = p => s[Math.max(0, Math.ceil(s.length * p) - 1)];
  return { n: s.length, median: q(.5), p95: q(.95), min: s[0], max: s.at(-1) }; };
const rss = () => Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync('/proc/self/status', 'utf8'))[1]) * 1024;
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
let asc, core, tsModule;

const workloads = {
  async p01({ wasm }) {
    const module = await WebAssembly.compile(fs.readFileSync(wasm)), imports = { env: { abort() { throw Error('abort'); } } };
    for (let i = 0; i < 50; i++) new WebAssembly.Instance(module, imports);
    const keep = [], samples = [];
    for (let i = 0; i < 2000; i++) { const t = ns(); keep.push(new WebAssembly.Instance(module, imports)); samples.push(ns() - t); }
    keep.length = 0;
    const resident = {};
    for (const K of [100, 1000, 5000]) {
      gc(); const before = { rss: rss(), ...process.memoryUsage() };
      const live = Array.from({ length: K }, () => new WebAssembly.Instance(module, imports));
      for (const i of live) i.exports.initState(0);
      gc(); const after = { rss: rss(), ...process.memoryUsage() };
      resident[K] = { live: live.length, bytesPerInstanceRss: (after.rss - before.rss) / K, bytesPerInstanceArrayBuffers: (after.arrayBuffers - before.arrayBuffers) / K };
    }
    return { instantiateUs: stat(samples.map(x => x / 1000)), resident };
  },
  async p02({ ascPath, kernels }) {
    const t = ns(), cold = !asc; asc ||= await import(pathToFileURL(ascPath));
    const importMs = cold ? ms(t) : null, runs = [];
    for (const [name, source] of kernels) {
      const outputs = {}, start = ns();
      const result = await asc.main([`${name}.ts`, '-O3', '--runtime', 'stub', '--noAssert', '--noColors', '--initialMemory', '1', '--maximumMemory', '16', '--outFile', 'out.wasm'], {
        stdout: asc.createMemoryStream(), stderr: asc.createMemoryStream(), readFile: f => f === `${name}.ts` ? source : null,
        writeFile: (f, d) => { outputs[f] = d; }, listFiles: () => [] });
      const s = result.stats;
      runs.push({ name, ok: !result.error, wallMs: ms(start), parse: s.parseTime / 1e6, initialize: s.initializeTime / 1e6, compile: s.compileTime / 1e6, optimize: s.optimizeTime / 1e6, emit: s.emitTime / 1e6 });
    }
    return { importMs, heapUsed: process.memoryUsage().heapUsed, rss: rss(), runs };
  },
  async p05({ corePath, wasmPath, hostPath, projects }) {
    const t = ns(), cold = !core;
    core ||= await import(pathToFileURL(corePath)); tsModule ||= new WebAssembly.Module(fs.readFileSync(wasmPath));
    const { runOnce } = await import(pathToFileURL(hostPath)), loadMs = cold ? ms(t) : null, cells = {};
    for (const [name, p] of Object.entries(projects)) {
      const one = () => { const s = ns(), r = runOnce(core, tsModule, { files: p.files, cwd: p.root, args: ['-p', `${p.root}/tsconfig.json`, '--pretty', 'false'], fsKind: 'indexed' });
        if (!r.ok) throw Error(`check failed: ${r.error}`); return { wallMs: ms(s), diagnostics: r.diagnostics.length }; };
      for (let i = 0; i < 3; i++) one();
      const samples = Array.from({ length: 20 }, one);
      cells[name] = { wall: stat(samples.map(s => s.wallMs)), diagnostics: samples[0].diagnostics };
    }
    return { loadMs, rss: rss(), cells };
  },
  async ramp({ command }) {
    const start = ns(), r = spawnSync(command[0], command.slice(1), { timeout: 120000 });
    return { checkMs: ms(start), status: r.status };
  },
};

export async function createPort({ workload, out, ...input }) {
  const started = ns(), result = await workloads[workload](input);
  fs.writeFileSync(out, JSON.stringify({ workload, cell: process.pid, cellMs: ms(started), ...result }));
  throw Error('measured');
}
