import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [mode, output, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const hit = rest.find(item => item.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const repo = resolve(flag('repo', new URL('../..', import.meta.url).pathname));
const from = path => import(pathToFileURL(join(repo, path)).href);
const { createContainedRoute } = await from('tools/tscheck/contained-route.mjs');
const { plan, probe } = await from('core/runtime/capacity/index.mjs');
mkdirSync(output, { recursive: true });
const LOADED = 16, DEMAND = Number(flag('demand', 48)), SECONDS = Number(flag('seconds', 90));
const load = () => Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
const gate = async () => { if (flag('gate', 'on') === 'off') return; const until = Date.now() + 30 * 60000; while (load() > LOADED && Date.now() < until) await new Promise(done => setTimeout(done, 15000)); };
const cpuOf = pids => { let t = 0; for (const pid of pids) { try { const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); t += Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14]); } catch {} } return t / 100; };
const sliceStat = () => { const p = probe(); if (!p.quotaCgroup) return null; try { const s = Object.fromEntries(readFileSync(`${p.quotaCgroup}/cpu.stat`, 'utf8').trim().split('\n').map(line => line.split(' ')).map(([k, v]) => [k, Number(v)])); return { usage: s.usage_usec, throttled: s.throttled_usec ?? 0 }; } catch { return null; } };
const EVENTS = 'cycles:u,instructions:u,ls_any_fills_from_sys.dram_io_all:u,ls_any_fills_from_sys.near_cache:u';
const perfStart = pids => {
  if (flag('perf', 'on') !== 'on' || !pids.length) return null;
  const child = spawn('perf', ['stat', '-x', ',', '-e', EVENTS, '-p', pids.join(',')], { stdio: ['ignore', 'ignore', 'pipe'] });
  let text = '';
  child.stderr.on('data', chunk => { text += chunk; });
  const done = new Promise(ok => child.on('close', () => ok(text)));
  return { stop: async () => { child.kill('SIGINT'); const raw = await done; const counts = {}; for (const line of raw.split('\n')) { const [value, , name] = line.split(','); if (name) counts[name.replace(/:u$/, '')] = /^\d+$/.test(value) ? Number(value) : null; } return counts; } };
};
const ROUTE = { check: 'fused', checker: { reuse: { growthMb: 16 }, incremental: true }, deadlineMs: 2000 };

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
const mutants = base => base.flatMap(need => {
  const tests = JSON.parse(need.files['tests.json']);
  return [
    { name: need.name, files: need.files },
    { name: `${need.name}:type`, files: { ...need.files, 'kernel.ts': `${need.files['kernel.ts']}\nconst broken: i32 = "x";\n` } },
    { name: `${need.name}:wrong`, files: { ...need.files, 'tests.json': JSON.stringify(tests.map(test => ({ ...test, expect: test.expect + 1 }))) } },
  ];
}).concat([{ name: 'spin:deadline', files: { 'kernel.ts': 'export function convertUnit(v: f64, a: i32, b: i32): f64 { for (;;) {} return v; }\n', 'tests.json': JSON.stringify([{ name: 'c0', fn: 'convertUnit', args: [1, 0, 1], expect: 1 }]) } }]);
const verdictOf = result => ({ status: result.status, reason: result.reason ?? null, output: result.outputSha256 ?? null, passed: result.passed ?? null });

const fixed = (cohorts, width, pinned, perDomain = cohorts / 2) => ({ placement: pinned ? plan({ policy: { mode: 'fixed', width, perDomain, headroom: 1 } }) : { mode: 'fixed', tuned: false, width: cohorts * width, cohorts: Array.from({ length: cohorts }, () => ({ width, max: width, cpus: null })) } });
const ARMS = {
  '1x16': () => ({ width: 16 }),
  '2x8': () => fixed(2, 8, false),
  '4x4': () => fixed(4, 4, false),
  '4x4-pinned': () => fixed(4, 4, true, 2),
  '2x8-pinned': () => fixed(2, 8, true, 1),
  planner: () => ({}),
};
const single = width => () => ({ width });

async function measure(name, options, candidates, verdictSet, seconds) {
  await gate();
  const route = createContainedRoute({ ...ROUTE, ...options });
  await route.ready();
  const pids = () => route.pool.pids ?? [route.pool.pid];
  await Promise.all(Array.from({ length: Math.min(DEMAND, 16) }, (_, i) => route.check(candidates[i % candidates.length])));
  let next = 0, accepted = 0, attempts = 0;
  const widths = [];
  const stopAt = performance.now() + seconds * 1000;
  const cpu0 = cpuOf(pids()), self0 = process.cpuUsage(), slice0 = sliceStat(), loadStart = load();
  const perf = perfStart(pids());
  const started = performance.now();
  const sampler = setInterval(() => widths.push([Math.round(performance.now() - started), route.pool.width ?? 16]), 1000);
  await Promise.all(Array.from({ length: DEMAND }, async () => { while (performance.now() < stopAt) { const index = next++; const result = await route.check(candidates[index % candidates.length]); attempts += 1; if (result.status === 'completed') accepted += 1; } }));
  const wall = performance.now() - started;
  clearInterval(sampler);
  const counts = perf ? await perf.stop() : null;
  const self = process.cpuUsage(self0), cpu = cpuOf(pids()) - cpu0 + (self.user + self.system) / 1e6, slice1 = sliceStat();
  const verdicts = {};
  for (const candidate of verdictSet) verdicts[candidate.name] = verdictOf(await route.check(candidate));
  const row = { arm: name, seconds, demand: DEMAND, attempts, accepted, perSecond: +(accepted / wall * 1000).toFixed(1), wallMs: Math.round(wall),
    cpuMsPerAccepted: +(cpu / accepted * 1000).toFixed(3), busyCpus: +(cpu / wall * 1000).toFixed(2), perf: counts,
    perAttempt: counts && Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v === null ? null : Math.round(v / attempts)])), ipc: counts?.cycles ? +(counts.instructions / counts.cycles).toFixed(3) : null,
    slice: slice0 && slice1 ? { cpus: +((slice1.usage - slice0.usage) / 1e6 / wall * 1000).toFixed(2), throttledMs: +((slice1.throttled - slice0.throttled) / 1000).toFixed(1) } : null,
    capacity: route.capacity ? { mode: route.capacity.mode, cohorts: route.capacity.cohorts.map(cohort => ({ width: cohort.width, max: cohort.max, pinned: Boolean(cohort.cpus) })) } : null,
    widths, tunerLog: route.pool.controller?.log ?? null, tunerHistory: route.pool.controller?.tuner?.history ?? null,
    verdictDigest: createHash('sha256').update(JSON.stringify(verdicts)).digest('hex'), verdicts, loadStart, loadEnd: load() };
  row.loaded = Math.max(row.loadStart, row.loadEnd) > LOADED;
  await route.close();
  return row;
}

const candidates = await needs(flag('asc', '.scratch/asc'));
const verdictSet = mutants(candidates);
const label = flag('label', 'round1');
const node = process.versions.node;
const file = join(output, `${mode}-${label}-${node}.json`);
const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).rows : [];
const arms = mode === 'arms' ? Object.entries(ARMS) : flag('widths', '').split(',').filter(Boolean).map(w => [`w${w}`, single(Number(w))]).concat([['planner', ARMS.planner]]);
const only = flag('only', '').split(',').filter(Boolean);
for (const [name, options] of arms) {
  if (only.length && !only.includes(name)) continue;
  if (prior.some(row => row.arm === name && !row.loaded)) continue;
  const row = await measure(name, options(), candidates, verdictSet, name === 'planner' ? Number(flag('plannerSeconds', SECONDS)) : SECONDS);
  prior.splice(0, prior.length, ...prior.filter(item => item.arm !== name), row);
  console.log(JSON.stringify({ arm: row.arm, perSecond: row.perSecond, cpuMsPerAccepted: row.cpuMsPerAccepted, ipc: row.ipc, nearCache: row.perAttempt?.['ls_any_fills_from_sys.near_cache'], busy: row.busyCpus, slice: row.slice, width: row.widths.at(-1)?.[1], loaded: row.loaded, load: [row.loadStart, row.loadEnd] }));
  writeFileSync(file, JSON.stringify({ node, repo, label, mode, affinity: readFileSync('/proc/self/status', 'utf8').match(/^Cpus_allowed_list:\s*(\S+)/m)?.[1], probe: probe(), plan: plan(), demand: DEMAND, rows: prior }, null, 1));
}
