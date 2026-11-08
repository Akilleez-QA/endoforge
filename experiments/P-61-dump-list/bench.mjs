import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE, createContainedRoute } from '../../tools/tscheck/contained-route.mjs';
import { globalScopeKernels } from '../../tools/tscheck/test/global-scope-kernels.mjs';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { fixture, hostPort } from '../../core/runtime/test/fixtures/ledger-fixture.mjs';

const [mode, output, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const hit = rest.find(item => item.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
mkdirSync(output, { recursive: true });
const node = process.versions.node;
const LOADED = 16;
const load = () => Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
const rssOf = pid => { try { return Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096; } catch { return 0; } };
const sleep = ms => new Promise(done => setTimeout(done, ms));
const gate = async () => { const until = Date.now() + Number(flag('gate', 5)) * 60000; while (load() > LOADED && Date.now() < until) await sleep(15000); };
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
const MiB = bytes => bytes === null ? null : +(bytes / 1048576).toFixed(1);
const save = (name, data) => writeFileSync(join(output, `${name}-${node}.json`), JSON.stringify({ node, mode, ...data }, null, 1));
const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

const candidate = (kernel, tests = [{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }]) => ({ files: { 'kernel.ts': kernel, 'tests.json': JSON.stringify(tests) } });
const add = body => `export function add(a: i32, b: i32): i32 { ${body} }`;
const CORPUS = [
  candidate(add('return a + b;')),
  candidate(add('return "x";')),
  candidate(add('return a - b;')),
  candidate(add('return (globalThis as any).process ? 1 : a + b;')),
  candidate(add('return Math.random() > 2 ? 0 : a + b;')),
  candidate(add('throw new Error("no");')),
  candidate('const unused: number = 1;\nexport function add(a: i32, b: i32): i32 { let t: i32 = a; t += b; return t; }'),
  candidate('export function add(a: i32, b: i32): i32 { return a + b }\nexport function twice(a: i32): i32 { return add(a, a); }', [{ name: 't', fn: 'twice', args: [4], expect: 8 }, { name: 'a', fn: 'add', args: [1, 1], expect: 3 }]),
  candidate('export function add(a: i32, b: i32): i32 { return a + c; }\nconst n: string = 5;'),
  candidate(BASELINE),
  ...globalScopeKernels().map(item => candidate(item.kernel)),
];
const verdict = receipt => ({ status: receipt.status, reason: receipt.reason, passed: receipt.passed, total: receipt.total, comparedRuns: receipt.comparedRuns,
  diagnostics: (receipt.diagnostics || []).map(({ file, line, column, code }) => ({ file, line, column, code })), artifact: receipt.artifact });

function driver(route) {
  const state = { concurrency: 0, settled: 0, accepted: 0, unknown: 0, stop: false, times: [] };
  const lane = async index => {
    let next = index;
    while (!state.stop) {
      if (index >= state.concurrency) { await sleep(2); continue; }
      const receipt = await route.check(CORPUS[next % CORPUS.length]);
      next += 16;
      state.settled += 1;
      state.times.push(performance.now());
      if (receipt.status === 'completed') state.accepted += 1;
      if (receipt.status === 'outcome_unknown') state.unknown += 1;
    }
  };
  state.done = Promise.all(Array.from({ length: 16 }, (_, index) => lane(index)));
  return state;
}
const rateBetween = (times, from, to) => times.filter(time => time >= from && time < to).length / ((to - from) / 1000);

async function shedTrial({ width, low, holdMs, trial }) {
  const directory = mkdtempSync(join(tmpdir(), 'p61-'));
  const route = createContainedRoute({ width, deadlineMs: 2000, dumpList: { directory, holdMs } });
  try {
    await route.ready();
    const pid = route.pool.pid, file = join(directory, `${pid}-endoforge-cohort.json`);
    const state = driver(route);
    const loadStart = load();
    state.concurrency = width;
    await sleep(6000);
    const preFrom = performance.now();
    await sleep(4000);
    const preRate = rateBetween(state.times, preFrom, performance.now());
    state.concurrency = low;
    await sleep(2000);
    const samples = [];
    const sampleUntil = async ms => { const end = performance.now() + ms; while (performance.now() < end) { samples.push([performance.now(), rssOf(pid)]); await sleep(10); } };
    await sampleUntil(500);
    const reported = readJson(file);
    const signalled = performance.now();
    const settledBefore = state.settled, unknownBefore = state.unknown;
    let rewrittenMs = null;
    process.kill(pid, 'SIGUSR2');
    const end = signalled + 2000;
    while (performance.now() < end) {
      samples.push([performance.now(), rssOf(pid)]);
      if (rewrittenMs === null && readJson(file)?.updated !== reported.updated) rewrittenMs = performance.now() - signalled;
      await sleep(10);
    }
    const after = readJson(file);
    const before = median(samples.filter(([time]) => time < signalled).map(([, rss]) => rss));
    const tail = median(samples.filter(([time]) => time >= signalled + 1500).map(([, rss]) => rss));
    const target = before - 0.7 * reported.sheddable_bytes;
    const reach = samples.find(([time, rss]) => time >= signalled && rss <= target);
    state.concurrency = width;
    const resumed = performance.now();
    await sleep(10000);
    const windows = [];
    for (let from = resumed; from + 1000 <= performance.now(); from += 250) windows.push({ atMs: Math.round(from - resumed), rate: rateBetween(state.times, from, from + 1000) });
    const recovered = windows.find(window => window.rate >= 0.9 * preRate);
    state.stop = true;
    await state.done;
    const loadEnd = load();
    return { trial, width, low, holdMs, loadStart, loadEnd, loaded: loadStart > LOADED || loadEnd > LOADED, preRate: +preRate.toFixed(1),
      reportedBytes: reported.sheddable_bytes, reportedMiB: MiB(reported.sheddable_bytes), afterReportedMiB: MiB(after.sheddable_bytes), rewrittenMs: rewrittenMs && Math.round(rewrittenMs),
      rssBeforeMiB: MiB(before), rssTailMiB: MiB(tail), freedMiB: MiB(before - tail), freedRatio: +((before - tail) / reported.sheddable_bytes).toFixed(3),
      timeTo70Ms: reach ? Math.round(reach[0] - signalled) : null, recoveryMs: recovered ? recovered.atMs : null, recoveryFromSignalMs: recovered ? Math.round(recovered.atMs + resumed - signalled) : null,
      windows, unknownDuring: state.unknown - unknownBefore, settledDuring: state.settled - settledBefore, unknownTotal: state.unknown, settledTotal: state.settled,
      cohortLosses: route.pool.stats.cohortLosses, rss: samples.filter((_, index) => index % 5 === 0).map(([time, rss]) => [Math.round(time - signalled), MiB(rss)]) };
  } finally {
    await route.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function cohort() {
  const trials = Number(flag('trials', 5)), width = Number(flag('width', 16)), lows = flag('low', '4,16').split(',').map(Number), holdMs = Number(flag('hold', 30000));
  const rows = [];
  for (let trial = 1; trial <= trials; trial++) for (const low of lows) {
    await gate();
    rows.push(await shedTrial({ width, low, holdMs, trial }));
    const row = rows.at(-1);
    console.log(JSON.stringify({ trial, low, loaded: row.loaded, load: [row.loadStart, row.loadEnd], reportedMiB: row.reportedMiB, freedMiB: row.freedMiB, ratio: row.freedRatio, timeTo70Ms: row.timeTo70Ms, rewrittenMs: row.rewrittenMs, recoveryMs: row.recoveryMs, preRate: row.preRate, unknown: row.unknownTotal }));
    save('cohort', { rows });
  }
}

async function parity() {
  const rounds = Number(flag('rounds', 5)), width = Number(flag('width', 16)), every = Number(flag('every', 100));
  const run = async shedding => {
    const directory = mkdtempSync(join(tmpdir(), 'p61-parity-'));
    const route = createContainedRoute({ width, deadlineMs: 2000, dumpList: shedding ? { directory, holdMs: 500, intervalMs: 50 } : false });
    let sheds = 0, timer = null;
    try {
      await route.ready();
      if (shedding) timer = setInterval(() => { try { process.kill(route.pool.pid, 'SIGUSR2'); sheds += 1; } catch {} }, every);
      const results = [];
      for (let round = 0; round < rounds; round++) {
        const order = CORPUS.map((_, index) => (index * 7 + round * 13) % CORPUS.length);
        const receipts = await Promise.all(order.map(index => route.check(CORPUS[index]).then(receipt => ({ index, verdict: verdict(receipt) }))));
        results.push(...receipts);
      }
      return { results, sheds, stats: { ...route.pool.stats } };
    } finally {
      clearInterval(timer);
      await route.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
  await gate();
  const loadStart = load();
  const plain = await run(false), shed = await run(true);
  const expected = new Map();
  for (const item of plain.results) if (!expected.has(item.index)) expected.set(item.index, JSON.stringify(item.verdict));
  const differences = [...plain.results, ...shed.results].filter(item => JSON.stringify(item.verdict) !== expected.get(item.index)).map(item => ({ index: item.index, verdict: item.verdict, expected: JSON.parse(expected.get(item.index)) }));
  const unknown = results => results.filter(item => item.verdict.status === 'outcome_unknown').length;
  const summary = { width, rounds, candidates: CORPUS.length, attemptsPerArm: plain.results.length, sheds: shed.sheds, loadStart, loadEnd: load(), differences: differences.length, unknownPlain: unknown(plain.results), unknownShed: unknown(shed.results),
    statsPlain: plain.stats, statsShed: shed.stats, firstDifferences: differences.slice(0, 5) };
  console.log(JSON.stringify({ ...summary, firstDifferences: undefined }));
  save('parity', summary);
}

async function overhead() {
  const pairs = Number(flag('pairs', 4)), width = Number(flag('width', 16)), seconds = Number(flag('seconds', 8));
  const rows = [];
  const measure = async enabled => {
    const directory = mkdtempSync(join(tmpdir(), 'p61-over-'));
    const route = createContainedRoute({ width, deadlineMs: 2000, dumpList: enabled ? { directory } : false });
    try {
      await route.ready();
      const state = driver(route);
      state.concurrency = width;
      await sleep(4000);
      const from = performance.now(), accepted0 = state.accepted;
      await sleep(seconds * 1000);
      const elapsed = (performance.now() - from) / 1000;
      const result = { enabled, acceptedPerS: +((state.accepted - accepted0) / elapsed).toFixed(1), settledPerS: +rateBetween(state.times, from, performance.now()).toFixed(1), writes: route.pool.dump?.writes ?? 0 };
      state.stop = true;
      await state.done;
      return result;
    } finally {
      await route.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
  for (let pair = 0; pair < pairs; pair++) {
    await gate();
    const loadStart = load();
    const first = pair % 2 ? await measure(true) : await measure(false), second = pair % 2 ? await measure(false) : await measure(true);
    const on = first.enabled ? first : second, off = first.enabled ? second : first;
    rows.push({ pair, loadStart, loadEnd: load(), off, on, delta: +((on.acceptedPerS - off.acceptedPerS) / off.acceptedPerS).toFixed(4) });
    console.log(JSON.stringify(rows.at(-1)));
    save('overhead', { rows });
  }
  const { getHeapStatistics } = await import('node:v8');
  const reps = 200000, started = performance.now();
  for (let index = 0; index < reps; index++) getHeapStatistics();
  const perCallUs = (performance.now() - started) * 1000 / reps;
  save('overhead', { rows, heapStatisticsUsPerCall: +perCallUs.toFixed(3) });
}

async function pool() {
  const trials = Number(flag('trials', 5)), size = Number(flag('size', 16));
  const rows = [];
  for (let trial = 1; trial <= trials; trial++) {
    await gate();
    const cleanups = [];
    const t = { after: fn => cleanups.push(fn) };
    const directory = mkdtempSync(join(tmpdir(), 'p61-pool-'));
    try {
      const { job } = await fixture(t);
      const instance = new IsolatePool({ hostPort, size, dumpList: { directory } });
      await instance.ready();
      await Promise.all(Array.from({ length: size }, () => instance.run(job(['pass', 'effects']))));
      await sleep(2500);
      const file = join(directory, `${process.pid}-endoforge-isolate-pool.json`);
      const reported = readJson(file).sheddable_bytes;
      const samples = [];
      for (let index = 0; index < 50; index++) { samples.push(rssOf(process.pid)); await sleep(10); }
      const before = median(samples);
      const signalled = performance.now();
      process.kill(process.pid, 'SIGUSR2');
      let reach = null;
      const after = [];
      while (performance.now() - signalled < 2000) {
        const rss = rssOf(process.pid);
        if (reach === null && rss <= before - 0.7 * reported) reach = performance.now() - signalled;
        if (performance.now() - signalled >= 1500) after.push(rss);
        await sleep(10);
      }
      const tail = median(after);
      const recheck = performance.now();
      await instance.run(job(['pass', 'effects']));
      rows.push({ trial, size, load: load(), reportedMiB: MiB(reported), ratio: instance.dump.ratio, freedMiB: MiB(before - tail), freedRatio: +((before - tail) / reported).toFixed(3), timeTo70Ms: reach && Math.round(reach), workersAfter: instance.stats.workers, nextJobMs: Math.round(performance.now() - recheck) });
      console.log(JSON.stringify(rows.at(-1)));
      await instance.close();
    } finally {
      for (const fn of cleanups.reverse()) await fn();
      rmSync(directory, { recursive: true, force: true });
    }
    save('pool', { rows });
  }
}

async function ledger() {
  const script = fileURLToPath(new URL('ledger_bench.py', import.meta.url));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const text = execFileSync('python3', ['-B', script, ...rest.map(item => item.replace(/^--/, ''))], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24 });
  const rows = text.trim().split('\n').map(line => JSON.parse(line));
  for (const row of rows) console.log(JSON.stringify(row));
  save('ledger', { rows });
}

const MODES = { cohort, parity, overhead, pool, ledger };
if (!MODES[mode]) throw new Error(`mode must be one of ${Object.keys(MODES).join(', ')}`);
await MODES[mode]();
process.exit(0);
