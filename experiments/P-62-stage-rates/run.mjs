import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { scriptedProvider } from '../../core/runtime/x1/transports.mjs';
import { LedgerBridge } from '../../core/runtime/isolate-ledger.mjs';
import { createStageRates, loopStages } from '../../core/runtime/stage-rates.mjs';
import { createContainedRoute } from '../../tools/tscheck/contained-route.mjs';
import { implementation, reply, specification, stageOf } from '../../core/runtime/test/fixtures/x1/scripted-model.mjs';
import { buildCorpus } from '../P-50-in-isolate/corpus.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const [outputArg, stampArg, plan, ...selected] = process.argv.slice(2);
const output = resolve(outputArg), receipt = here(`./receipt/${stampArg}`);
const acceptance = stampArg !== 'pilot';
if (acceptance) {
  const recorded = readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1).split(' ')[0];
  assert.equal(recorded, hash(readFileSync(here('./PRECOMMIT.md'))), 'PRECOMMIT.md differs from its recorded digest');
}
mkdirSync(output, { recursive: true }); mkdirSync(receipt, { recursive: true });
const corpus = await buildCorpus(), known = new Map(corpus.map(entry => [entry.name, entry]));
const random = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const TICK = 100;
const treeCpu = () => {
  const stats = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try { const fields = readFileSync(`/proc/${name}/stat`, 'utf8').split(') ')[1].split(' '); stats.set(Number(name), { parent: Number(fields[1]), ticks: Number(fields[11]) + Number(fields[12]) + Number(fields[13]) + Number(fields[14]) }); } catch { }
  }
  const tree = new Set([process.pid]);
  for (let grew = true; grew;) { grew = false; for (const [pid, { parent }] of stats) if (!tree.has(pid) && tree.has(parent)) { tree.add(pid); grew = true; } }
  let ticks = 0;
  for (const pid of tree) ticks += stats.get(pid)?.ticks ?? 0;
  return { pids: tree, ms: ticks * 1000 / TICK };
};
const p57 = [2000, 4000], fast = [20, 40];
const base = { cells: 4, width: 16, model: fast, ledger: 'disk', ledgerDelayMs: 0, cellDelayMs: 0, lane: 0, laneCheck: 'fused', lanePad: 0, laneDelayMs: 0, modelScale: 1, rates: true, seconds: 40, warmup: 10 };
const configs = {
  ledger: { ...base, ledgerDelayMs: 25 },
  checker: { ...base, ledger: 'tmpfs', lane: 1, lanePad: 3000 },
  model: { ...base, model: p57, seconds: 130, warmup: 15 },
  'main-fast': { ...base },
  cells: { ...base, ledger: 'tmpfs' },
};
const stagePerturbations = config => ['model', 'cell', 'ledger', ...(config.lane ? ['tscheck'] : [])];

function gate(n) {
  let free = n; const waiting = [];
  return { acquire: () => free > 0 ? (free -= 1, Promise.resolve()) : new Promise(done => waiting.push(done)), release: () => { const next = waiting.shift(); if (next) next(); else free += 1; } };
}
const originalRequest = LedgerBridge.prototype.request;
function throttleLedger(ms) {
  LedgerBridge.prototype.request = originalRequest;
  if (!ms) return;
  let chain = Promise.resolve();
  LedgerBridge.prototype.request = function (...args) {
    const run = chain.then(() => sleep(ms)).then(() => originalRequest.apply(this, args));
    chain = run.then(() => {}, () => {});
    return run;
  };
}
const padded = (kernel, n) => n ? `${kernel}\n${Array.from({ length: n }, (_, i) => `export const pad${i}: number = ${i};`).join('\n')}\n` : kernel;

async function arm(label, config) {
  const loadStart = loadavg()[0];
  const directory = config.ledger === 'tmpfs' ? join('/dev/shm', `p62-${process.pid}`, label) : join(output, label);
  rmSync(directory, { recursive: true, force: true }); mkdirSync(directory, { recursive: true });
  throttleLedger(config.ledgerDelayMs);
  const next = random(62), [low, high] = config.model;
  const rates = config.rates ? createStageRates({ stages: loopStages({ cells: config.cells, lane: config.lane }) }) : null;
  const provider = scriptedProvider(async ({ messages }) => {
    const ms = (low + (high - low) * next()) * config.modelScale;
    if (ms) await sleep(ms);
    const input = known.get(JSON.parse(messages[0].content).need.split(': ')[1]);
    return reply(stageOf(messages) === 'specification' ? specification(input) : implementation(input, JSON.parse(messages[0].content).id));
  });
  const pool = createLoopPool({ size: config.cells, isolation: 'process', waits: 'release', provider, rates,
    ...(config.cellDelayMs ? { hostPort: here('./delay-port.mjs'), cellEnv: { P62_CELL_DELAY_MS: String(config.cellDelayMs) } } : {}) });
  const route = config.lane ? createContainedRoute({ width: config.lane, deadlineMs: 4000, check: config.laneCheck }) : null;
  await pool.ready();
  if (route) { await route.ready(); await route.check({ files: { 'kernel.ts': padded(corpus[0].kernel, config.lanePad), 'tests.json': corpus[0].tests } }); }
  const laneGate = route ? gate(config.lane) : null;
  const lane = async content => {
    const files = JSON.parse(content).files, slot = rates?.arrive('tscheck');
    await laneGate.acquire();
    rates?.start(slot);
    try {
      if (config.laneDelayMs) await sleep(config.laneDelayMs);
      const result = await route.check({ files: { 'kernel.ts': padded(files['kernel.ts'], config.lanePad), 'tests.json': files['tests.json'] } });
      rates?.span('tscheck.check', result.checkMs); rates?.span('tscheck.run', result.runMs ?? 0);
      return result.status;
    } finally { laneGate.release(); rates?.done(slot); }
  };
  const publishPath = join('/dev/shm', `p62-${label}.json`), unpublish = rates?.publish(publishPath, 1000);
  const done = [], live = [], begin = performance.now(), stopAt = begin + config.seconds * 1000;
  let cursor = 0, windowStart = null, windowEnd = null;
  const liveTimer = rates ? setInterval(() => { const view = rates.view({ windowMs: 5000 }); live.push({ at: (performance.now() - begin) / 1000, bottleneck: view.verdict.bottleneck, kind: view.verdict.kind, published: existsSync(publishPath) }); }, 1000) : null;
  const marks = (async () => {
    await sleep(config.warmup * 1000);
    windowStart = { t: performance.now(), snapshot: rates?.snapshot(), cpu: treeCpu().ms };
    await sleep(Math.max(0, stopAt - performance.now()));
    windowEnd = { t: performance.now(), snapshot: rates?.snapshot(), cpu: treeCpu().ms };
  })();
  await Promise.all(Array.from({ length: config.width }, async () => {
    while (performance.now() < stopAt) {
      const index = cursor++, input = corpus[index % corpus.length], start = performance.now();
      const answer = await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory: join(directory, `${input.name}-${index}`), pool, env: { ENDOFORGE_LOOP: 'agent' }, limits: { maxTurns: 2, maxTokens: 64000 } });
      const laneStatus = route && answer.content ? await lane(answer.content) : null;
      done.push({ index, name: input.name, start, end: performance.now(), promoted: answer.promoted, expected: input.expectPromoted, error: answer.error ?? null, lane: laneStatus, modelMs: answer.modelMs });
    }
  }));
  await marks;
  clearInterval(liveTimer); unpublish?.();
  const inWindow = done.filter(row => row.end > windowStart.t && row.end <= windowEnd.t), seconds = (windowEnd.t - windowStart.t) / 1000;
  const view = rates ? rates.view({ from: windowStart.snapshot, to: windowEnd.snapshot }) : null;
  rates?.stop();
  await pool.close(); await route?.close();
  throttleLedger(0);
  rmSync(directory, { recursive: true, force: true });
  const loadEnd = loadavg()[0];
  const row = { label, config, loadStart, loadEnd, loaded: Math.max(loadStart, loadEnd) > 16, windowSeconds: seconds, completed: inWindow.length,
    throughput: inWindow.length / seconds, promotedPerSecond: inWindow.filter(item => item.promoted).length / seconds,
    cpuMsPerCandidate: (windowEnd.cpu - windowStart.cpu) / inWindow.length, wrongVerdicts: done.filter(item => item.promoted !== item.expected).length, errors: done.filter(item => item.error).length,
    lanes: route ? Object.fromEntries(Object.entries(done.reduce((all, item) => (all[item.lane] = (all[item.lane] ?? 0) + 1, all), {}))) : null,
    verdict: view?.verdict ?? null, grossArgmax: view ? Object.entries(view.stages).filter(([, item]) => !item.within && item.utilisation !== null).sort(([, a], [, b]) => b.utilisation - a.utilisation).map(([name, item]) => `${name} ${item.utilisation.toFixed(2)}`) : null, view, live, firstLive: live[0] ?? null, liveAt5: live.find(item => item.at >= 4.5 && item.at <= 5.5) ?? null, dropped: rates?.dropped ?? null,
    published: rates && existsSync(publishPath) ? JSON.parse(readFileSync(publishPath, 'utf8')).at : null };
  if (rates) rmSync(publishPath, { force: true });
  console.log(JSON.stringify({ label, throughput: +row.throughput.toFixed(2), cpu: +row.cpuMsPerCandidate.toFixed(1), verdict: row.verdict && `${row.verdict.bottleneck} (${row.verdict.kind})`, liveAt5: row.liveAt5?.bottleneck, load: [loadStart, loadEnd], wrong: row.wrongVerdicts, errors: row.errors }));
  if (view) console.log(rates ? (await import('../../core/runtime/stage-rates.mjs')).format(view) : '');
  return row;
}

const result = { plan, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here('../../'), encoding: 'utf8' }).trim(), node: process.version, cpus: cpus()[0]?.model, parallelism: availableParallelism(),
  corpus: { digest: hash(JSON.stringify(corpus)), kernels: corpus.length }, started: new Date().toISOString(), rows: [] };
const save = () => { result.finished = new Date().toISOString(); writeFileSync(join(receipt, `${plan}.json`), JSON.stringify(result, null, 1)); };
const waitForLoad = async () => { while (loadavg()[0] > 16) await sleep(15000); };
const meanService = (row, stage) => row.view.stages[stage].serviceMs.mean;

if (plan === 'pilot') {
  for (const name of selected) { await waitForLoad(); result.rows.push(await arm(`pilot-${name}`, { ...configs[name.split(':')[0]], seconds: 20, warmup: 5, ...(JSON.parse(name.split(':').slice(1).join(':') || '{}')) })); save(); }
} else if (plan === 'controlled') {
  for (const name of selected.length ? selected : ['ledger', 'checker', 'model', 'main-fast', 'cells']) {
    const config = configs[name], bases = [];
    for (let rep = 0; rep < 2; rep++) { await waitForLoad(); const row = await arm(`${name}-base-${rep}`, config); bases.push(row); result.rows.push(row); save(); }
    const reference = bases[0];
    for (const stage of stagePerturbations(config)) {
      const perturbed = stage === 'model' ? { modelScale: 1.2 } : stage === 'cell' ? { cellDelayMs: Math.round(0.2 * meanService(reference, 'cell')) }
        : stage === 'ledger' ? { ledgerDelayMs: config.ledgerDelayMs + Math.round(0.2 * meanService(reference, 'ledger')) } : { laneDelayMs: Math.round(0.2 * meanService(reference, 'tscheck')) };
      await waitForLoad();
      result.rows.push(await arm(`${name}-plus20-${stage}`, { ...config, ...perturbed }));
      save();
    }
  }
} else if (plan === 'rerun') {
  for (const label of selected) {
    const [, name, kind, stage] = /^(.+)-(base|plus20)-(.+)$/.exec(label), config = configs[name];
    assert.ok(kind === 'base' || stage === 'model', 'only base and model-scale arms rerun without a reference');
    await waitForLoad();
    result.rows.push(await arm(`${label}-rerun`, kind === 'base' ? config : { ...config, modelScale: 1.2 }));
    save();
  }
} else if (plan === 'micro') {
  const rates = createStageRates({ stages: loopStages({ cells: 4, lane: 1 }), tickMs: 0 }), names = Object.keys(loopStages({ cells: 4, lane: 1 })).filter(name => !name.includes('.'));
  const timed = (n, body) => { const begin = process.hrtime.bigint(); for (let i = 0; i < n; i++) body(i); return Number(process.hrtime.bigint() - begin) / n; };
  for (let round = 0; round < 3; round++) {
    const n = 2_000_000, empty = timed(n, () => {});
    const triple = timed(n, i => { const slot = rates.arrive(names[i % names.length]); rates.start(slot); rates.done(slot); }) - empty;
    const span = timed(n, () => rates.span('cell.compile', 3.5)) - empty;
    const view = timed(2000, () => rates.view({ windowMs: 5000 }));
    result.rows.push({ round, nsPerArriveStartDone: triple, nsPerSpan: span, nsPerView: view });
    console.log(JSON.stringify(result.rows.at(-1)));
  }
} else if (plan === 'overhead') {
  const config = configs[selected[0] ?? 'cells'], pairs = Number(selected[1] ?? 8);
  for (let pair = 0; pair < pairs; pair++) for (const on of pair % 2 ? [false, true] : [true, false]) {
    await waitForLoad();
    result.rows.push(await arm(`overhead-${on ? 'on' : 'off'}-${pair}`, { ...config, rates: on, seconds: 30, warmup: 8 }));
    save();
  }
}
save();
