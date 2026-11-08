import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [mode, output, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const hit = rest.find(item => item.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const repo = resolve(flag('repo', new URL('../..', import.meta.url).pathname));
const from = path => import(pathToFileURL(join(repo, path)).href);
const { createContainedRoute } = await from('tools/tscheck/contained-route.mjs');
const { plan, probe, P67_TUNED_POLICY, POLICY, TUNED_POLICY } = await from('core/runtime/capacity/index.mjs');
mkdirSync(output, { recursive: true });
const LOADED = 16, PSI_QUIET = 5, DEMAND = Number(flag('demand', 64)), SECONDS = Number(flag('seconds', 30)), QUIET_WAIT_MS = Number(flag('quietWait', 20)) * 60000;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const load = () => Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
const psi = () => Number(readFileSync('/proc/pressure/cpu', 'utf8').match(/^some avg10=([\d.]+)/m)[1]);
const P = probe();
const own = '/sys/fs/cgroup' + readFileSync('/proc/self/cgroup', 'utf8').split('\n').find(line => line.startsWith('0::')).slice(3);
const slice = P.levels.find(level => basename(level.cgroup) === 'heavy.slice')?.cgroup ?? null;
const usage = dir => { try { return Number(readFileSync(`${dir}/cpu.stat`, 'utf8').match(/^usage_usec (\d+)/m)[1]); } catch { return null; } };
const throttledUs = dir => { try { return Number(readFileSync(`${dir}/cpu.stat`, 'utf8').match(/^throttled_usec (\d+)/m)?.[1] ?? 0); } catch { return null; } };
const mine = dir => own === dir || own.startsWith(`${dir}/`);
const others = () => { if (!slice) return []; try { return readdirSync(slice).map(name => join(slice, name)).filter(dir => existsSync(join(dir, 'cgroup.procs')) && !mine(dir) && !basename(dir).startsWith('p68-peer')); } catch { return []; } };
const quiet = () => ({ load: load(), psi: psi(), others: others().map(dir => basename(dir)) });
const isQuiet = state => state.load <= LOADED && state.psi <= PSI_QUIET && state.others.length === 0;
async function gate() {
  if (flag('gate', 'on') === 'off') return { waitedMs: 0, state: quiet(), ok: true };
  const started = Date.now();
  let state = quiet();
  while (!isQuiet(state) && Date.now() - started < QUIET_WAIT_MS) { await sleep(15000); state = quiet(); }
  return { waitedMs: Date.now() - started, state, ok: isQuiet(state) };
}
async function cooldown() {
  const atStop = quiet(), started = Date.now();
  while ((load() > LOADED || psi() > PSI_QUIET) && Date.now() - started < 180000) await sleep(5000);
  return { atStop, after: quiet(), waitedMs: Date.now() - started };
}
const cpuOf = pids => { let t = 0; for (const pid of pids) { try { const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); t += Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14]); } catch {} } return t / 100; };
const peers = [];
function startPeer(count, tag) {
  const unit = `p68-peer-${process.pid}-${tag}`;
  const child = spawn('systemd-run', ['--user', '--scope', '--quiet', '--slice=heavy.slice', '--nice=10', `--unit=${unit}`, '--', 'sh', '-c', `for i in $(seq ${count}); do (while :; do :; done) & done; wait`], { stdio: 'ignore' });
  const entry = { unit, child, dir: slice ? join(slice, `${unit}.scope`) : null };
  peers.push(entry);
  return entry;
}
function stopPeer(entry) {
  spawnSync('systemctl', ['--user', 'stop', `${entry.unit}.scope`], { stdio: 'ignore' });
  try { entry.child.kill('SIGKILL'); } catch {}
  peers.splice(peers.indexOf(entry), 1);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const entry of [...peers]) stopPeer(entry); process.exit(130); });

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

const fixedTotal = total => () => { const shape = plan({ policy: POLICY }); const per = Math.max(1, Math.round(total / shape.cohorts.length)); return { placement: plan({ policy: { ...POLICY, width: per } }) }; };
const ARMS = {
  '2x8-pinned': () => ({ placement: plan({ policy: POLICY }) }),
  '1x16': () => ({ width: 16 }),
  tuned: () => ({ placement: plan({ policy: TUNED_POLICY }) }),
  'tuned-p67': () => ({ placement: plan({ policy: P67_TUNED_POLICY }) }),
};

async function measure(name, options, candidates, verdictSet, seconds, { peer = 0 } = {}) {
  const before = await gate();
  const route = createContainedRoute({ ...ROUTE, ...options });
  await route.ready();
  const pids = () => route.pool.pids ?? [route.pool.pid];
  await Promise.all(Array.from({ length: 16 }, (_, i) => route.check(candidates[i % candidates.length])));
  const peerEntry = peer ? startPeer(peer, name) : null;
  if (peerEntry) await sleep(3000);
  let next = 0, accepted = 0, attempts = 0;
  const widths = [], seen = new Set();
  const stopAt = performance.now() + seconds * 1000;
  const cpu0 = cpuOf(pids()), self0 = process.cpuUsage(), own0 = usage(own), slice0 = slice ? { usage: usage(slice), throttled: throttledUs(slice) } : null, peer0 = peerEntry ? usage(peerEntry.dir) : null;
  const started = performance.now();
  const sampler = setInterval(() => { widths.push([Math.round(performance.now() - started), route.pool.width ?? 16]); for (const dir of others()) seen.add(basename(dir)); }, 1000);
  await Promise.all(Array.from({ length: DEMAND }, async () => { while (performance.now() < stopAt) { const index = next++; const result = await route.check(candidates[index % candidates.length]); attempts += 1; if (result.status === 'completed') accepted += 1; } }));
  const wall = performance.now() - started;
  clearInterval(sampler);
  const self = process.cpuUsage(self0), cpu = cpuOf(pids()) - cpu0 + (self.user + self.system) / 1e6, ownCpu = (usage(own) - own0) / 1e6, peerCpu = peerEntry ? (usage(peerEntry.dir) - peer0) / 1e6 : null;
  const slice1 = slice ? { usage: usage(slice), throttled: throttledUs(slice) } : null;
  if (peerEntry) stopPeer(peerEntry);
  const verdicts = {};
  for (const candidate of verdictSet) verdicts[candidate.name] = verdictOf(await route.check(candidate));
  const controller = route.pool.controller;
  const row = { arm: name, seconds, demand: DEMAND, peer, attempts, accepted, perSecond: +(accepted / wall * 1000).toFixed(1), wallMs: Math.round(wall),
    cpuMsPerAccepted: +(cpu / accepted * 1000).toFixed(3), busyCpus: +(cpu / wall * 1000).toFixed(2), ownCgroupCpus: +(ownCpu / wall * 1000).toFixed(2), ownCgroupMsPerAccepted: +(ownCpu / accepted * 1000).toFixed(3),
    peerCpus: peerCpu === null ? null : +(peerCpu / wall * 1000).toFixed(2),
    slice: slice0 && slice1 ? { cpus: +((slice1.usage - slice0.usage) / 1e6 / wall * 1000).toFixed(2), throttledMs: +((slice1.throttled - slice0.throttled) / 1000).toFixed(1) } : null,
    capacity: route.capacity ? { mode: route.capacity.mode, cap: route.capacity.cap ?? null, allotment: route.capacity.allotment, cohorts: route.capacity.cohorts.map(cohort => ({ width: cohort.width, max: cohort.max, share: cohort.share, pinned: Boolean(cohort.cpus) })) } : null,
    widths, tunerLog: controller?.log ?? null, tunerHistory: controller?.tuner?.history ?? null, occupancy: controller?.occupancy ?? null,
    verdictDigest: createHash('sha256').update(JSON.stringify(verdicts)).digest('hex'), verdicts, othersDuringRow: [...seen] };
  await route.close();
  const after = await cooldown();
  Object.assign(row, { gate: before, end: after, loadStart: before.state.load, psiStart: before.state.psi, loadEnd: after.after.load, psiEnd: after.after.psi, loadAtStop: after.atStop.load, psiAtStop: after.atStop.psi });
  row.quiet = before.ok && seen.size === 0 && after.after.load <= LOADED && after.after.psi <= PSI_QUIET;
  row.loaded = Math.max(row.loadStart, row.loadEnd) > LOADED;
  return row;
}

function calibrate() {
  const count = P.cpus.length, seconds = 4;
  const child = spawnSync('bash', ['-c', `for i in $(seq ${count}); do timeout ${seconds + 1} sh -c 'while :; do :; done' & done; sleep 0.5; a=$(sed -n 's/^usage_usec //p' "$0/cpu.stat"); sleep ${seconds}; b=$(sed -n 's/^usage_usec //p' "$0/cpu.stat"); echo $(( (b - a) / ${seconds} )); wait`, own], { encoding: 'utf8' });
  return { spinners: count, cpus: +(Number(child.stdout.trim()) / 1e6).toFixed(2) };
}

const label = flag('label', 'round1');
const node = process.versions.node;
const file = join(output, `${mode}-${label}-${node}.json`);
const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
const rows = prior?.rows ?? [];
const header = { node, repo, label, mode, affinity: readFileSync('/proc/self/status', 'utf8').match(/^Cpus_allowed_list:\s*(\S+)/m)?.[1], own, probe: P, plan: plan(), tunedPlan: plan({ policy: TUNED_POLICY }), demand: DEMAND,
  calibration: prior?.calibration ?? (flag('calibrate', 'on') === 'on' ? calibrate() : null) };
const save = () => writeFileSync(file, JSON.stringify({ ...header, rows }, null, 1));
save();
const candidates = await needs(flag('asc', '.scratch/asc'));
const verdictSet = mutants(candidates);
let plan_ = [];
if (mode === 'arms') {
  const names = flag('order', 'forward') === 'reverse' ? Object.keys(ARMS).reverse() : Object.keys(ARMS);
  plan_ = names.map(name => [name, ARMS[name], SECONDS, {}]);
} else if (mode === 'sweep') {
  plan_ = flag('widths', '').split(',').filter(Boolean).map(w => [`w${w}`, fixedTotal(Number(w)), SECONDS, {}]).concat([['tuned', ARMS.tuned, Number(flag('plannerSeconds', 120)), {}]]);
  if (flag('order', 'forward') === 'reverse') plan_.reverse();
} else if (mode === 'fair') {
  const peer = Number(flag('peer', 12));
  plan_ = [['tuned-alone', ARMS.tuned, SECONDS, {}], ['tuned-peer', ARMS.tuned, SECONDS, { peer }]];
  if (flag('order', 'forward') === 'reverse') plan_.reverse();
} else throw new Error('usage: bench.mjs arms|sweep|fair <output> [--label=] [--seconds=] [--widths=] [--order=forward|reverse] [--peer=N]');
const only = flag('only', '').split(',').filter(Boolean);
for (const [name, options, seconds, extra] of plan_) {
  if (only.length && !only.includes(name)) continue;
  if (rows.some(row => row.arm === name && row.quiet)) continue;
  const row = await measure(name, options(), candidates, verdictSet, seconds, { peer: extra.peer ?? Number(flag('withPeer', 0)) });
  rows.splice(0, rows.length, ...rows.filter(item => item.arm !== name), row);
  const last = row.tunerLog?.at(-1);
  console.log(JSON.stringify({ arm: row.arm, perSecond: row.perSecond, cpuMsPerAccepted: row.cpuMsPerAccepted, busy: row.busyCpus, own: row.ownCgroupCpus, peer: row.peerCpus, width: row.widths.at(-1)?.[1], u: last?.u, cap: last?.cap, share: last?.share, mode: last?.mode, quiet: row.quiet, load: [row.loadStart, row.loadAtStop, row.loadEnd], psi: [row.psiStart, row.psiEnd] }));
  save();
}
process.exit(0);
