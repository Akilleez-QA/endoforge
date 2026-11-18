import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';

const [role, ...rest] = process.argv.slice(2);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

async function probe(rootPath, corpusPath, index, t0, t1) {
  const root = new URL(rootPath.replace(/\/?$/, '/'), 'file://');
  const { compile, loadCompiler, x1Flags } = await import(new URL('experiments/assemblyscript-toolchain.mjs', root));
  const { ASC_PATH } = await import(new URL('tools/asc/pin.mjs', root));
  const { runGates } = await import(new URL('core/runtime/x1/gates.mjs', root));
  const { hash } = await import(new URL('core/runtime/x1/host.mjs', root));
  const { withCapability } = await import(new URL('core/runtime/test/fixtures/x1/candidate.mjs', root));
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')).map(e => ({ ...e, contract: withCapability(e.contract, e.glue) }));
  await loadCompiler(ASC_PATH);
  const marks = [];
  for (let k = index; Date.now() < t1; k++) {
    const e = corpus[k % corpus.length];
    const a = performance.now();
    const bytes = await compile({ name: 'kernel', source: e.kernel }, ASC_PATH, { flags: x1Flags, onDiagnostic: () => {} });
    const b = performance.now();
    const compiled = bytes ? { source: hash(e.kernel), wasm: Buffer.from(bytes).toString('base64') } : { source: hash(e.kernel), error: 'compile' };
    const files = { 'CONTRACT.md': e.contract, 'tests.json': e.tests, 'kernel.ts': e.kernel, 'glue.json': e.glue, 'frozen.sha256': JSON.stringify({ contract: hash(e.contract), tests: hash(e.tests) }) };
    runGates({ id: e.name, files, compiled });
    runGates({ id: e.name, files, compiled });
    const c = performance.now();
    marks.push({ t: Date.now(), cpu: cpuMs(), compile: b - a, gate: c - b });
  }
  const inside = marks.filter(m => m.t >= t0 && m.t <= t1);
  if (inside.length < 2) return { index, jobs: 0 };
  const first = inside[0], last = inside.at(-1), jobs = inside.slice(1);
  return { index, jobs: jobs.length, seconds: (last.t - first.t) / 1000, cpuMs: last.cpu - first.cpu,
    compileMs: jobs.reduce((t, m) => t + m.compile, 0), gateMs: jobs.reduce((t, m) => t + m.gate, 0), rssMb: process.memoryUsage().rss / 2 ** 20 };
}

async function load(duty, t0, t1) {
  const block = Buffer.alloc(1 << 16, 7);
  while (Date.now() < t0) await sleep(5);
  const start = cpuMs(), began = Date.now();
  while (Date.now() < t1) {
    const until = performance.now() + duty * 10;
    while (performance.now() < until) createHash('sha256').update(block).digest();
    await sleep((1 - duty) * 10);
  }
  return { duty, cores: (cpuMs() - start) / (Date.now() - began) };
}

const child = (args, qos) => new Promise((resolve, reject) => {
  const command = qos ? ['taskpolicy', [...qos, process.execPath, ...args]] : [process.execPath, args];
  const p = spawn(command[0], command[1], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  p.stdout.on('data', chunk => { out += chunk; });
  p.once('close', code => (code === 0 ? resolve(JSON.parse(out.trim().split('\n').pop())) : reject(Error(`child exited ${code}`))));
});

if (role === 'probe') console.log(JSON.stringify(await probe(rest[0], rest[1], Number(rest[2]), Number(rest[3]), Number(rest[4]))));
else if (role === 'load') console.log(JSON.stringify(await load(Number(rest[0]), Number(rest[1]), Number(rest[2]))));
else {
  const [rootPath, corpusPath, count, windowS, warmS = '10', loadSpec = '', qosName = ''] = [role, ...rest];
  const n = Number(count), self = fileURLToPath(import.meta.url);
  const qos = { '': null, background: ['-b'], utility: ['-c', 'utility'] }[qosName];
  const duties = loadSpec ? loadSpec.split(',').map(Number) : [];
  const t0 = Date.now() + Number(warmS) * 1000, t1 = t0 + Number(windowS) * 1000, loadStart = loadavg()[0];
  const probes = Array.from({ length: n }, (_, i) => child([self, 'probe', rootPath, corpusPath, String(i), String(t0), String(t1)], qos));
  const loads = duties.map(d => child([self, 'load', String(d), String(t0), String(t1)], null));
  const rows = await Promise.all(probes), loaded = await Promise.all(loads);
  const sum = key => rows.reduce((t, r) => t + (r[key] ?? 0), 0);
  const rates = rows.map(r => r.jobs / r.seconds).sort((a, b) => b - a);
  console.log(JSON.stringify({ n, qos: qosName || 'default', windowS: Number(windowS), warmS: Number(warmS), load: duties, loadCores: +loaded.reduce((t, l) => t + l.cores, 0).toFixed(3),
    jobsPerS: +rates.reduce((t, r) => t + r, 0).toFixed(3), cpuMsPerJob: +(sum('cpuMs') / sum('jobs')).toFixed(2), probeCores: +(rows.reduce((t, r) => t + r.cpuMs / r.seconds, 0) / 1000).toFixed(3),
    compileMsPerJob: +(sum('compileMs') / sum('jobs')).toFixed(2), gateMsPerJob: +(sum('gateMs') / sum('jobs')).toFixed(2), jobs: sum('jobs'),
    ratePerProbe: rates.map(r => +r.toFixed(2)), rssMb: Math.round(sum('rssMb')), loadavg: [+loadStart.toFixed(2), +loadavg()[0].toFixed(2)] }));
}
