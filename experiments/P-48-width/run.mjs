import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { fixture, hostPort as basePort } from '../../core/runtime/test/fixtures/ledger-fixture.mjs';
import { TSRS_MODULE, WORKCELL } from '../../tools/tscheck/pin.mjs';
import { TS_INVARIANT } from '../../tools/tscheck/port.mjs';

const [work, out, ...arms] = process.argv.slice(2);
const hostPort = fileURLToPath(new URL('../../tools/tscheck/port.mjs', import.meta.url));
const cellEntry = new URL('./cell.mjs', import.meta.url);
const cleanup = [];
const t = { after: fn => cleanup.push(fn) };
const scratch = mkdtempSync(join(tmpdir(), 'p48-'));
const read = (dir, root, files = {}) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) read(path, root, files);
    else files[`/proj/${relative(root, path)}`] = readFileSync(path, 'utf8');
  }
  return files;
};
const project = { root: '/proj', files: read(join(work, 'medium/ill/proj'), join(work, 'medium/ill/proj')) };
const projectFile = join(scratch, 'project.json');
writeFileSync(projectFile, JSON.stringify(project));
const pct = (values, q) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] : null;
const cgroup = `/sys/fs/cgroup${/^0::(.*)$/m.exec(readFileSync('/proc/self/cgroup', 'utf8'))[1]}`;
const slice = cgroup.slice(0, cgroup.indexOf('/heavy.slice') + '/heavy.slice'.length);
const stat = path => Object.fromEntries(readFileSync(join(path, 'cpu.stat'), 'utf8').trim().split('\n').map(line => line.split(' ')).map(([k, v]) => [k, Number(v)]));
const machine = () => {
  const [, ...fields] = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/);
  const values = fields.map(Number);
  return { busy: values.reduce((a, b) => a + b) - values[3] - values[4], };
};
const measure = async (fn) => {
  const m0 = machine(), own0 = stat(cgroup), slice0 = cgroup.includes('/heavy.slice') ? stat(slice) : null, started = performance.now();
  const extra = await fn();
  const seconds = (performance.now() - started) / 1000;
  const m1 = machine(), own1 = stat(cgroup), slice1 = cgroup.includes('/heavy.slice') ? stat(slice) : null;
  const busyCpus = (m1.busy - m0.busy) / 100 / seconds, ownCpus = (own1.usage_usec - own0.usage_usec) / 1e6 / seconds;
  return { seconds: +seconds.toFixed(2), busyCpus: +busyCpus.toFixed(1), ownCpus: +ownCpus.toFixed(1), otherCpus: +(busyCpus - ownCpus).toFixed(1),
    throttledPeriods: slice1 ? slice1.nr_throttled - slice0.nr_throttled : null, throttledMs: slice1 ? Math.round((slice1.throttled_usec - slice0.throttled_usec) / 1000) : null, ...extra };
};
const compileShared = () => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('../../core/runtime/isolate-wasm-compile.mjs', import.meta.url), { resourceLimits: WORKCELL.resourceLimits,
    workerData: { wasmMemoryMaxMb: WORKCELL.wasmMemoryMaxMb, trustedWasmModules: WORKCELL.trustedWasmModules, sources: WORKCELL.sharedWasmModules } });
  worker.once('message', message => { worker.terminate(); resolve(message); });
  worker.once('error', reject);
});
const shared = await compileShared();
const { reference: frozenReference } = await fixture(t);
const bare = async (kind, processes, size, units) => {
  const config = { kind, units, projectFile, reference: frozenReference };
  const cells = Array.from({ length: size }, () => processes
    ? fork(cellEntry, [JSON.stringify(config)], { execArgv: [`--max-old-space-size=${WORKCELL.resourceLimits.maxOldGenerationSizeMb}`], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
    : new Worker(cellEntry, { resourceLimits: WORKCELL.resourceLimits, execArgv: [], workerData: { ...config, shared } }));
  await Promise.all(cells.map(cell => new Promise((resolve, reject) => { cell.once('message', resolve); cell.once('error', reject); })));
  const finished = cells.map(cell => new Promise((resolve, reject) => { cell.once('message', resolve); cell.once('error', reject); }));
  const result = await measure(async () => {
    for (const cell of cells) processes ? cell.send('go') : cell.postMessage('go');
    const replies = await Promise.all(finished);
    const walls = replies.flatMap(reply => reply.rows.map(row => row.wallMs));
    return { unitsPerSecond: null, unitP50Ms: pct(walls, .5), unitP95Ms: pct(walls, .95), diagnostics: [...new Set(replies.flatMap(reply => reply.rows.map(row => row.diagnostics).filter(v => v !== undefined)))] };
  });
  result.unitsPerSecond = +(size * units / result.seconds).toFixed(1);
  await Promise.all(cells.map(cell => processes ? cell.exitCode !== null || new Promise(resolve => cell.once('exit', resolve)) : cell.terminate()));
  return result;
};
const pooled = async (kind, size) => {
  const checked = kind !== 'harness';
  const { job } = await fixture(t, checked ? { invariants: ['identity', TS_INVARIANT] } : undefined);
  const file = join(scratch, `${kind}-${size}-${Date.now()}.jsonl`);
  const portOptions = checked ? { basePort, projects: { pass: project }, reportFile: file } : {};
  const pool = new IsolatePool({ hostPort: checked ? hostPort : basePort, size, prewarm: true, jobTimeoutMs: 120000, ...(checked ? WORKCELL : {}), isolation: kind === 'full-process' ? 'process' : 'thread' });
  await pool.ready();
  const run = () => pool.run({ ...job(['pass'], portOptions), timing: true });
  await Promise.all(Array.from({ length: size }, run));
  let results;
  const result = await measure(async () => { results = await Promise.all(Array.from({ length: 8 * size }, run)); return {}; });
  await pool.close();
  const walls = checked ? readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)).slice(size).map(row => row.wallMs) : [];
  const gates = results.map(r => r.timings.gate), ledgers = results.map(r => r.timings.ledger);
  return { ...result, unitsPerSecond: +(results.length / result.seconds).toFixed(1), completed: results.filter(r => r.status === 'completed').length, jobs: results.length,
    gateP50Ms: Math.round(pct(gates, .5)), gateP95Ms: Math.round(pct(gates, .95)), ledgerP50Ms: Math.round(pct(ledgers, .5)), ledgerP95Ms: Math.round(pct(ledgers, .95)), unitP50Ms: pct(walls, .5), unitP95Ms: pct(walls, .95) };
};
const runners = {
  full: size => pooled('full', size), 'full-process': size => pooled('full-process', size), harness: size => pooled('harness', size),
  frozen: size => bare('frozen', false, size, 8), compiler: size => bare('compiler', false, size, 8), 'compiler-process': size => bare('compiler', true, size, 8),
  touch: size => bare('touch', false, size, 8), 'touch-process': size => bare('touch', true, size, 8), calibration: size => bare('spin', false, size, 8),
};
const result = { node: process.version, module: TSRS_MODULE.name, cpus: readFileSync('/proc/cpuinfo', 'utf8').split('\n').filter(line => line.startsWith('processor')).length, inHeavySlice: cgroup.includes('/heavy.slice'), runs: [] };
for (let rep = 0; rep < 2; rep++) for (const arm of arms) for (const size of [1, 4, 8, 16, 28]) {
  const row = { arm, size, rep, load1: Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]), ...await runners[arm](size) };
  result.runs.push(row);
  console.log(JSON.stringify(row));
  writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
}
for (const fn of cleanup) await fn();
rmSync(scratch, { recursive: true, force: true });
