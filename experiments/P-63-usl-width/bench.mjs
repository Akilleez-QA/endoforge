import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [mode, output, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const hit = rest.find(item => item.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const repo = resolve(flag('repo', new URL('../..', import.meta.url).pathname));
const from = path => import(pathToFileURL(join(repo, path)).href);
mkdirSync(output, { recursive: true });
const node = process.versions.node;
const LOADED = 16;
const load = () => Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
const gate = async () => { const until = Date.now() + 30 * 60000; while (load() > LOADED && Date.now() < until) await new Promise(done => setTimeout(done, 15000)); };
const percentile = (values, p) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2); };
const cpuOf = pids => { let t = 0; for (const pid of pids) { try { const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); t += Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14]); } catch {} } return t / 100; };
const cgroupDir = () => '/sys/fs/cgroup' + readFileSync('/proc/self/cgroup', 'utf8').split('\n').find(line => line.startsWith('0::')).slice(3);
const throttle = () => {
  const out = {};
  let dir = cgroupDir();
  while (dir.length > '/sys/fs/cgroup'.length) {
    try {
      const stat = Object.fromEntries(readFileSync(`${dir}/cpu.stat`, 'utf8').trim().split('\n').map(line => line.split(' ')).map(([k, v]) => [k, Number(v)]));
      const max = readFileSync(`${dir}/cpu.max`, 'utf8').trim();
      out[dir.split('/').pop()] = { max, usage_usec: stat.usage_usec, nr_throttled: stat.nr_throttled ?? 0, throttled_usec: stat.throttled_usec ?? 0 };
    } catch {}
    dir = dir.slice(0, dir.lastIndexOf('/'));
  }
  return out;
};
const throttleDelta = (a, b) => Object.fromEntries(Object.keys(b).map(k => [k, { max: b[k].max, cpus: +((b[k].usage_usec - (a[k]?.usage_usec ?? 0)) / 1e6).toFixed(2), nr_throttled: b[k].nr_throttled - (a[k]?.nr_throttled ?? 0), throttled_ms: +((b[k].throttled_usec - (a[k]?.throttled_usec ?? 0)) / 1000).toFixed(1) }]));
const EVENTS = 'cycles:u,instructions:u,ls_any_fills_from_sys.dram_io_all:u,ls_any_fills_from_sys.near_cache:u';
const perfStart = pids => {
  if (flag('perf', 'on') !== 'on') return null;
  const child = spawn('perf', ['stat', '-x', ',', '-e', EVENTS, '-p', pids.join(',')], { stdio: ['ignore', 'ignore', 'pipe'] });
  let text = '';
  child.stderr.on('data', chunk => { text += chunk; });
  const done = new Promise(ok => child.on('close', () => ok(text)));
  return { stop: async () => { child.kill('SIGINT'); const raw = await done; const counts = {}; for (const line of raw.split('\n')) { const [value, , name] = line.split(','); if (name) counts[name.replace(/:u$/, '')] = /^\d+$/.test(value) ? Number(value) : null; } return counts; } };
};
const perAttempt = (counts, n) => counts && Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v === null ? null : +(v / n).toFixed(0)]));

const ROUTE = {
  'route-default': { check: 'fused', checker: { reuse: { growthMb: 16 }, incremental: true } },
  'route-fresh': { check: 'fused', checker: { reuse: false, incremental: false } },
};

async function needs(ascPath) {
  const asc = await import(pathToFileURL(resolve(ascPath, 'node_modules/assemblyscript/dist/asc.js')).href);
  const kernels = pathToFileURL(join(repo, 'experiments/P-15-workcell-concurrency/kernels/'));
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', kernels)));
  const extract = (source, signature) => { const start = source.indexOf(signature); if (start < 0) return null; let depth = 0; for (let at = source.indexOf('{', start); at < source.length; at++) { if (source[at] === '{') depth += 1; if (source[at] === '}' && --depth === 0) return source.slice(start, at + 1); } return null; };
  const argumentSets = [[1, 0, 1], [2.5, 1, 2], [100, 3, 4], [7, 4, 0], [3, 6, 5], [1, 0, 99], [0, 2, 2], [12345.5, 5, 6]];
  const out = [];
  for (const { name } of manifest) {
    const whole = readFileSync(new URL(`${name}.ts`, kernels), 'utf8');
    const helper = extract(whole, 'function toBaseFactor'), convert = extract(whole, 'export function convertUnit');
    if (!helper || !convert) continue;
    const scalar = `${helper}\n${convert}\n`, files = {};
    const result = await asc.main(['kernel.ts', '-O3', '--runtime', 'stub', '--noColors', '--noAssert', '--outFile', 'out.wasm'],
      { stdout: asc.createMemoryStream(), stderr: asc.createMemoryStream(), readFile: file => file === 'kernel.ts' ? scalar : null, writeFile: (file, data) => { files[file] = data; }, listFiles: () => [] });
    if (result.error) continue;
    const instance = new WebAssembly.Instance(new WebAssembly.Module(files['out.wasm']), { env: { abort() { throw new Error('abort'); } } });
    const tests = argumentSets.map((args, index) => ({ name: `c${index}`, fn: 'convertUnit', args, expect: instance.exports.convertUnit(...args), tol: 1e-9 })).filter(test => Number.isFinite(test.expect));
    out.push({ name, files: { 'kernel.ts': scalar, 'tests.json': JSON.stringify(tests) } });
  }
  return out;
}

async function routeWorkload(name) {
  const { createContainedRoute } = await from('tools/tscheck/contained-route.mjs');
  const candidates = await needs(flag('asc', '.scratch/asc'));
  return {
    workload: { kind: 'route', arm: name, config: ROUTE[name], needs: candidates.length, deadlineMs: 2000 },
    async open(width) { const route = createContainedRoute({ width, deadlineMs: 2000, ...ROUTE[name] }); await route.ready(); await Promise.all(Array.from({ length: width }, (_, i) => route.check(candidates[i % candidates.length]))); return { pids: () => [route.pool.pid], close: () => route.close(), run: async index => (await route.check(candidates[index % candidates.length])).status === 'completed', total: Math.max(400, 40 * width) }; },
  };
}

async function runtimeWorkload() {
  const { ARMS } = await from('experiments/P-54-contained-js/arms.mjs');
  const { BENIGN } = await from('experiments/P-54-contained-js/attacks.mjs');
  const job = spin => ({ modules: { '/guest/main.js': BENIGN }, entry: '/guest/main.js', input: { spin } });
  return {
    workload: { kind: 'runtime', arm: 'shared-reuse', guest: 'BENIGN', spin: 10 },
    async open(width) { const runner = ARMS['shared-reuse']({ width, spare: width }); await runner.ready(); await Promise.all(Array.from({ length: width }, () => runner.run(job(10)))); await new Promise(done => setTimeout(done, 300)); return { pids: () => runner.pids(), close: () => runner.close(), run: async () => (await runner.run(job(10))).status === 'completed', total: Math.max(1000, 200 * width) }; },
  };
}

export async function measureRow(opened, width) {
  const pids = opened.pids(), total = opened.total, latency = [];
  let next = 0, accepted = 0;
  const cpu0 = cpuOf(pids), self0 = process.cpuUsage(), cg0 = throttle(), loadStart = load();
  const perf = perfStart(pids);
  const wallStart = performance.now();
  await Promise.all(Array.from({ length: width }, async () => { while (next < total) { const index = next++, started = performance.now(); if (await opened.run(index)) accepted += 1; latency.push(performance.now() - started); } }));
  const wall = performance.now() - wallStart;
  const counts = perf ? await perf.stop() : null;
  const self = process.cpuUsage(self0), selfCpu = (self.user + self.system) / 1e6, childCpu = cpuOf(pids) - cpu0;
  const row = { width, attempts: total, accepted, perSecond: +(accepted / wall * 1000).toFixed(1), p50: percentile(latency, 0.5), p95: percentile(latency, 0.95), wallMs: Math.round(wall),
    cpuMsPerAccepted: +((childCpu + selfCpu) / accepted * 1000).toFixed(3), busyCpus: +((childCpu + selfCpu) / wall * 1000).toFixed(2),
    perf: counts, perfPerAttempt: perAttempt(counts, total), ipc: counts?.cycles ? +(counts.instructions / counts.cycles).toFixed(3) : null,
    cgroup: throttleDelta(cg0, throttle()), loadStart, loadEnd: load() };
  row.loaded = Math.max(row.loadStart, row.loadEnd) > LOADED;
  return row;
}

async function sweep() {
  const name = flag('workload', 'route-default'), widths = flag('widths', '4,12,20,24').split(',').map(Number), label = flag('label', 'round1');
  const w = name === 'runtime' ? await runtimeWorkload() : await routeWorkload(name);
  const file = join(output, `${name}-${label}-${node}.json`);
  const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).rows : [];
  for (const width of widths) {
    if (prior.some(row => row.width === width)) continue;
    await gate();
    const opened = await w.open(width);
    const row = { workload: name, label, cpus: flag('cpus', 'all'), ...(await measureRow(opened, width)) };
    await opened.close();
    prior.push(row);
    console.log(JSON.stringify({ ...row, perf: undefined, cgroup: undefined }));
    writeFileSync(file, JSON.stringify({ node, repo, label, workload: w.workload, affinity: flag('cpus', 'all'), rows: prior }, null, 1));
  }
}

async function calibrate() {
  const { calibrateWidth } = await import('../../tools/width/usl.mjs');
  const name = flag('workload', 'route-default'), widths = flag('widths', '1,4,8,16,24,32').split(',').map(Number), scale = Number(flag('scale', 0.25)), label = flag('label', 'cal1');
  const started = performance.now();
  const w = name === 'runtime' ? await runtimeWorkload() : await routeWorkload(name);
  const setupMs = Math.round(performance.now() - started);
  const rows = [];
  const result = await calibrateWidth(async width => { const opened = await w.open(width); opened.total = Math.max(width * 4, Math.round(opened.total * scale)); const row = await measureRow(opened, width); await opened.close(); rows.push(row); return row.perSecond; }, { widths });
  const out = { node, repo, label, workload: w.workload, scale, setupMs, calibrationMs: result.calibrationMs, totalMs: Math.round(performance.now() - started), width: result.width, predicted: result.predicted, fit: result.fit, rows: rows.map(row => ({ ...row, perf: undefined })) };
  writeFileSync(join(output, `calibrate-${name}-${label}-${node}.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ ...out, rows: rows.map(r => [r.width, r.perSecond, r.loaded]) }));
}

if (mode === 'sweep') await sweep();
else if (mode === 'calibrate') await calibrate();
else { console.error('usage: bench.mjs sweep|calibrate <output> [--workload=route-default|route-fresh|runtime] [--widths=..] [--label=..] [--repo=..] [--asc=..] [--perf=on|off]'); process.exit(2); }
