import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ARMS } from './arms.mjs';
import { ATTACKS, BENIGN } from './attacks.mjs';
import { createContainedRoute } from '../../tools/tscheck/contained-route.mjs';

const [mode, output, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const hit = rest.find(item => item.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
mkdirSync(output, { recursive: true });
const node = process.versions.node;
const load = () => Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
const gate = async () => { while (load() > 20) await new Promise(done => setTimeout(done, 15000)); };
const percentile = (values, p) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2); };
const modulesOf = source => ({ '/guest/main.js': source });
const TICK = 100;
const cpuOf = pids => {
  let ticks = 0;
  for (const pid of pids) { try { const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); ticks += Number(fields[11]) + Number(fields[12]) + Number(fields[13]) + Number(fields[14]); } catch {} }
  return ticks / TICK;
};
const rssOf = pids => {
  let total = 0;
  for (const pid of pids) { try { total += Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096; } catch {} }
  return total;
};
const selfRss = () => Number(readFileSync('/proc/self/statm', 'utf8').split(' ')[1]) * 4096;
const MiB = bytes => +(bytes / 1048576).toFixed(1);
const save = (name, data) => writeFileSync(join(output, `${name}-${node}.json`), JSON.stringify({ node, ...data }, null, 1));
const prior = name => { const file = join(output, `${name}-${node}.json`); return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).rows : []; };

// Closed loop: `width` submitters each take the next attempt until `total` are done.
async function drive(runner, width, total, makeJob, onResult) {
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < total) {
      const index = next++;
      const started = performance.now();
      const result = await runner.run(makeJob(index));
      onResult(index, result, started, performance.now());
    }
  }));
}

async function measured(runner, pidsOf, width, total, makeJob, onResult) {
  const pids0 = pidsOf();
  const cpu0 = new Map(pids0.map(pid => [pid, cpuOf([pid])])), self0 = process.cpuUsage(), stats0 = { ...runner.stats };
  let peak = 0, peakSelf = 0;
  const sampler = setInterval(() => { peak = Math.max(peak, rssOf(pidsOf())); peakSelf = Math.max(peakSelf, selfRss()); }, 20);
  const wallStart = performance.now();
  await drive(runner, width, total, makeJob, onResult);
  const wall = performance.now() - wallStart;
  clearInterval(sampler);
  const pids1 = pidsOf();
  const childCpu = pids1.reduce((sum, pid) => sum + cpuOf([pid]) - (cpu0.get(pid) ?? 0), 0);
  const self = process.cpuUsage(self0);
  const stats1 = runner.stats;
  return { wall, peak, peakSelf, childCpu, selfCpu: (self.user + self.system) / 1e6, delta: key => (stats1[key] ?? 0) - (stats0[key] ?? 0), samePids: pids0.length === pids1.length && pids0.every(pid => pids1.includes(pid)) };
}

async function throughput() {
  const arms = flag('arms', 'shared-reuse,shared-fresh,process-cell,cohort-cell').split(','), widths = flag('widths', '1,8,16,32').split(',').map(Number);
  const per = Number(flag('per', 200)), spin = Number(flag('spin', 10)), label = flag('label', `spin${spin}`);
  const rows = prior(`throughput-${label}`);
  for (const arm of arms) for (const width of widths) {
    if (rows.some(row => row.arm === arm && row.width === width)) continue;
    await gate();
    const loadStart = load(), created = performance.now();
    const runner = ARMS[arm]({ width, spare: width });
    await runner.ready();
    await Promise.all(Array.from({ length: width }, () => runner.run({ modules: modulesOf(BENIGN), entry: '/guest/main.js', input: { spin: 10 } })));
    const readyMs = performance.now() - created;
    await new Promise(done => setTimeout(done, 300));
    const idle = rssOf(runner.pids());
    const total = Math.max(1000, per * width), latency = [], cells = new Set();
    let failed = 0;
    const run = await measured(runner, () => runner.pids(), width, total, () => ({ modules: modulesOf(BENIGN), entry: '/guest/main.js', input: { spin } }), (index, result, start, end) => {
      if (result.status !== 'completed') failed += 1;
      latency.push(end - start);
      if (result.cell !== undefined) cells.add(`${result.cohort}:${result.cell}`);
    });
    // Child CPU is read from processes alive at both ends; per-process arms replace none on the warm path.
    const row = { arm, width, attempts: total, failed, perSecond: +(total / run.wall * 1000).toFixed(1), p50: percentile(latency, 0.5), p95: percentile(latency, 0.95), readyMs: Math.round(readyMs),
      cpuMsPerAttempt: +((run.childCpu + run.selfCpu) / total * 1000).toFixed(3), childCpuMsPerAttempt: +(run.childCpu / total * 1000).toFixed(3), supervisorCpuMsPerAttempt: +(run.selfCpu / total * 1000).toFixed(3),
      idleRssMiB: MiB(idle), peakRssMiB: MiB(run.peak), peakPerActiveMiB: +(MiB(run.peak) / width).toFixed(1), supervisorPeakRssMiB: MiB(run.peakSelf),
      processSpawnsPerAttempt: +((run.delta('cohortStarts') + run.delta('spawns')) / total).toFixed(4), workerStartsPerAttempt: arm === 'process-cell' ? 0 : +(cells.size / total).toFixed(4), ipcPerAttempt: +(run.delta('messages') / total).toFixed(2),
      pidsStable: run.samePids, loadStart, loadEnd: load() };
    row.loaded = Math.max(row.loadStart, row.loadEnd) > 16;
    rows.push(row);
    console.log(JSON.stringify(row));
    await runner.close();
    save(`throughput-${label}`, { workload: { guest: 'BENIGN', spin }, rows });
  }
}

async function routeCandidates(ascPath) {
  const asc = await import(pathToFileURL(resolve(ascPath, 'node_modules/assemblyscript/dist/asc.js')).href);
  const kernels = new URL('../P-15-workcell-concurrency/kernels/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', kernels)));
  const extract = (source, signature) => {
    const start = source.indexOf(signature);
    if (start < 0) return null;
    let depth = 0;
    for (let at = source.indexOf('{', start); at < source.length; at++) {
      if (source[at] === '{') depth += 1;
      if (source[at] === '}' && --depth === 0) return source.slice(start, at + 1);
    }
    return null;
  };
  const argumentSets = [[1, 0, 1], [2.5, 1, 2], [100, 3, 4], [7, 4, 0], [3, 6, 5], [1, 0, 99], [0, 2, 2], [12345.5, 5, 6]];
  const candidates = [];
  for (const { name } of manifest) {
    const source = readFileSync(new URL(`${name}.ts`, kernels), 'utf8');
    const helper = extract(source, 'function toBaseFactor'), convert = extract(source, 'export function convertUnit');
    if (!helper || !convert) continue;
    const scalar = `${helper}\n${convert}\n`, files = {};
    const result = await asc.main(['kernel.ts', '-O3', '--runtime', 'stub', '--noColors', '--noAssert', '--outFile', 'out.wasm'],
      { stdout: asc.createMemoryStream(), stderr: asc.createMemoryStream(), readFile: file => file === 'kernel.ts' ? scalar : null, writeFile: (file, data) => { files[file] = data; }, listFiles: () => [] });
    if (result.error) continue;
    const instance = new WebAssembly.Instance(new WebAssembly.Module(files['out.wasm']), { env: { abort() { throw new Error('abort'); } } });
    const tests = argumentSets.map((args, index) => ({ name: `c${index}`, fn: 'convertUnit', args, expect: instance.exports.convertUnit(...args), tol: 1e-9 })).filter(test => Number.isFinite(test.expect));
    candidates.push({ name, files: { 'kernel.ts': scalar, 'tests.json': JSON.stringify(tests) } });
  }
  return candidates;
}

async function route() {
  const layouts = flag('layouts', 'shared-reuse,shared-fresh,process-per-cell').split(','), widths = flag('widths', '1,8,16,32').split(',').map(Number);
  const reps = Number(flag('reps', 10)), candidates = await routeCandidates(flag('asc', '.scratch/asc'));
  const rows = prior('route');
  for (const layout of layouts) for (const width of widths) {
    if (rows.some(row => row.layout === layout && row.width === width)) continue;
    await gate();
    const loadStart = load(), created = performance.now();
    const route = createContainedRoute({ width, deadlineMs: 2000, layout, check: 'supervisor' });
    await route.ready();
    await Promise.all(Array.from({ length: width }, (_, index) => route.check(candidates[index % candidates.length])));
    const readyMs = performance.now() - created;
    const pool = route.pool, pidsOf = () => typeof pool.pids === 'function' ? pool.pids() : Array.isArray(pool.pids) ? pool.pids : [pool.pid].filter(Boolean);
    const total = Math.max(candidates.length * reps, width * 20), latency = [], check = [], run = [], rest = [];
    let accepted = 0;
    const adapter = { stats: pool.stats, run: index => route.check(candidates[index % candidates.length]) };
    Object.defineProperty(adapter, 'stats', { get: () => pool.stats });
    const measuredRun = await measured(adapter, pidsOf, width, total, index => index, (index, receipt, start, end) => {
      if (receipt.status === 'completed') accepted += 1;
      const whole = end - start;
      latency.push(whole); check.push(receipt.checkMs ?? 0); run.push(receipt.runMs ?? 0); rest.push(whole - (receipt.checkMs ?? 0) - (receipt.runMs ?? 0));
    });
    const row = { layout, width, attempts: total, accepted, acceptedPerSecond: +(accepted / measuredRun.wall * 1000).toFixed(1), p50: percentile(latency, 0.5), p95: percentile(latency, 0.95),
      checkP50: percentile(check, 0.5), runTwiceP50: percentile(run, 0.5), evaluateAndWaitP50: percentile(rest, 0.5), evaluateAndWaitP95: percentile(rest, 0.95), readyMs: Math.round(readyMs),
      cpuMsPerAttempt: +((measuredRun.childCpu + measuredRun.selfCpu) / total * 1000).toFixed(2), supervisorCpuMsPerAttempt: +(measuredRun.selfCpu / total * 1000).toFixed(2),
      childPeakRssMiB: MiB(measuredRun.peak), childPeakPerActiveMiB: +(MiB(measuredRun.peak) / width).toFixed(1), supervisorPeakRssMiB: MiB(measuredRun.peakSelf),
      processSpawnsPerAttempt: +(measuredRun.delta('cohortStarts') / total).toFixed(4), ipcPerAttempt: +(measuredRun.delta('messages') / total).toFixed(2), loadStart, loadEnd: load() };
    row.loaded = Math.max(row.loadStart, row.loadEnd) > 16;
    rows.push(row);
    console.log(JSON.stringify(row));
    await route.close();
    save('route', { workload: { needs: candidates.length, names: candidates.map(item => item.name) }, rows });
  }
}

async function recovery() {
  const arms = flag('arms', 'shared-reuse,shared-fresh,cohort-cell').split(','), widths = flag('widths', '8,16,32').split(',').map(Number);
  const kinds = flag('kinds', 'map-table-limit,string-regex').split(','), reps = Number(flag('reps', 3)), per = Number(flag('per', 60));
  const spinRate = (() => { let total = 0; const started = performance.now(); for (let i = 0; i < 5e7; i++) total = (total + i * 31) % 1000003; return total >= 0 ? 5e7 / (performance.now() - started) : 0; })();
  const spin = Math.round(spinRate * Number(flag('work-ms', 3)));
  const rows = prior('recovery');
  for (const arm of arms) for (const width of widths) for (const kind of ['none', ...kinds]) for (let rep = 0; rep < (kind === 'none' ? 1 : reps); rep++) {
    if (rows.some(row => row.arm === arm && row.width === width && row.kind === kind && row.rep === rep)) continue;
    await gate();
    const loadStart = load();
    const runner = ARMS[arm]({ width, spare: width });
    await runner.ready();
    await Promise.all(Array.from({ length: width }, () => runner.run({ modules: modulesOf(BENIGN), entry: '/guest/main.js', input: { spin: 10 } })));
    const total = per * width, fatalAt = kind === 'none' ? -1 : Math.floor(total / 2);
    const fatalSource = kind === 'none' ? null : ATTACKS.find(item => item.name === kind).source;
    const starts0 = runner.stats.cohortStarts ?? 0;
    const outcomes = { completed: 0, refused: 0, outcome_unknown: 0 };
    let breacher = null, lossAt = null, lostPid = null, firstAfter = null;
    const unknownAt = [];
    const wallStart = performance.now();
    await drive(runner, width, total, index => index === fatalAt
      ? { modules: modulesOf(fatalSource), entry: '/guest/main.js', deadlineMs: 20000, input: { canary: '', marker: '/nonexistent/m', port: 1, decoy: 0 } }
      : { modules: modulesOf(BENIGN), entry: '/guest/main.js', input: { spin }, deadlineMs: 5000 },
    (index, result, start, end) => {
      if (index === fatalAt) { breacher = { status: result.status, reason: result.reason, ms: Math.round(end - start) }; lossAt ??= end; lostPid = result.cohort; return; }
      outcomes[result.status] = (outcomes[result.status] || 0) + 1;
      if (result.status === 'outcome_unknown') { unknownAt.push(end); lossAt ??= end; lostPid ??= result.cohort; }
      if (lossAt !== null && firstAfter === null && result.status === 'completed' && end >= lossAt && (result.cohort !== lostPid || arm === 'cohort-cell')) firstAfter = end;
    });
    const wall = performance.now() - wallStart;
    const row = { arm, width, kind, rep, attempts: total, ...outcomes, breacher, blastRadius: outcomes.outcome_unknown + (breacher?.status === 'outcome_unknown' ? 1 : 0),
      innocentLost: outcomes.outcome_unknown + outcomes.refused, processSpawns: (runner.stats.cohortStarts ?? 0) - starts0, lossToReplacementResultMs: lossAt !== null && firstAfter !== null ? +(firstAfter - lossAt).toFixed(1) : null,
      wallMs: Math.round(wall), workMs: Number(flag('work-ms', 3)), loadStart, loadEnd: load() };
    row.loaded = Math.max(row.loadStart, row.loadEnd) > 16;
    rows.push(row);
    console.log(JSON.stringify(row));
    await runner.close();
    save('recovery', { rows });
  }
}

// Least-squares fit of peak child RSS against width over widths 8-32; budget = active attempts whose fitted RSS fits.
async function budget() {
  const budgetMiB = Number(flag('mib', 4096)), out = {};
  for (const label of flag('labels', 'spin10,spin200000').split(',')) {
    const rows = prior(`throughput-${label}`), arms = [...new Set(rows.map(row => row.arm))];
    out[label] = arms.map(arm => {
      const points = rows.filter(row => row.arm === arm && row.width >= 8).map(row => [row.width, row.peakRssMiB]);
      const n = points.length, mx = points.reduce((a, [x]) => a + x, 0) / n, my = points.reduce((a, [, y]) => a + y, 0) / n;
      const slope = points.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / points.reduce((a, [x]) => a + (x - mx) ** 2, 0), base = my - slope * mx;
      return { arm, marginalMiB: +slope.toFixed(1), baseMiB: +base.toFixed(1), activeIn4GiB: Math.floor((budgetMiB - base) / slope) };
    });
  }
  save('budget', { budgetMiB, rows: out });
  console.log(JSON.stringify(out, null, 1));
}

await { throughput, route, recovery, budget }[mode]();
process.exit(0);
