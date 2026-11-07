import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, loadavg, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { scriptedProvider } from '../../core/runtime/x1/transports.mjs';
import { implementation, reply, specification, stageOf } from '../../core/runtime/test/fixtures/x1/scripted-model.mjs';
import { buildCorpus } from '../P-50-in-isolate/corpus.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const [outputArg, stampArg, ...selected] = process.argv.slice(2);
const output = resolve(outputArg), receiptDirectory = here(`./receipt/${stampArg}`);
const precommit = readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1);
assert.equal(precommit, hash(readFileSync(here('./PRECOMMIT.md'))));
mkdirSync(output, { recursive: true }); mkdirSync(receiptDirectory, { recursive: true });
const nearest = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.ceil(sorted.length * q) - 1] ?? null; };
const stat = values => ({ n: values.length, p50: nearest(values, 0.5), p95: nearest(values, 0.95), max: values.length ? Math.max(...values) : null });
const env = { ENDOFORGE_LOOP: 'agent' };
const corpus = await buildCorpus(), known = new Map(corpus.map(entry => [entry.name, entry]));
const random = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const treeRss = () => {
  const parents = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try { parents.set(Number(name), Number(readFileSync(`/proc/${name}/stat`, 'utf8').split(') ')[1].split(' ')[1])); } catch { }
  }
  const tree = new Set([process.pid]);
  for (let grew = true; grew;) { grew = false; for (const [pid, parent] of parents) if (!tree.has(pid) && tree.has(parent)) { tree.add(pid); grew = true; } }
  let kb = 0;
  for (const pid of tree) try { kb += Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0); } catch { }
  return { bytes: kb * 1024, processes: tree.size };
};
const result = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here('../../'), encoding: 'utf8' }).trim(), precommit, testDouble: true, node: process.version,
  cpus: cpus()[0]?.model, parallelism: availableParallelism(), totalMemory: totalmem(), corpus: { digest: hash(JSON.stringify(corpus)), kernels: corpus.length }, started: new Date().toISOString(), arms: {} };
const arms = {
  'serial-hold': { waits: 'hold', size: 1, count: 5 * corpus.length, width: 1, delay: [0, 0] },
  'serial-release': { waits: 'release', size: 1, count: 5 * corpus.length, width: 1, delay: [0, 0] },
  'swarm-hold': { waits: 'hold', size: 4, count: 64, width: 64, delay: [2000, 4000] },
  'swarm-release': { waits: 'release', size: 4, count: 64, width: 64, delay: [2000, 4000] },
  'swarm-release-256': { waits: 'release', size: 4, count: 256, width: 256, delay: [2000, 4000] },
};
async function arm(name) {
  const { waits, size, count, width, delay: [low, high] } = arms[name], next = random(57), loadStart = loadavg()[0];
  const sendBusy = [];
  let sending = 0, mostSending = 0, inFlight = 0, mostInFlight = 0, pool;
  const script = async ({ messages }) => {
    sendBusy.push(pool.stats.busy);
    mostSending = Math.max(mostSending, ++sending);
    const ms = low + (high - low) * next();
    if (ms) await sleep(ms);
    sending -= 1;
    const input = known.get(JSON.parse(messages[0].content).need.split(': ')[1]);
    return reply(stageOf(messages) === 'specification' ? specification(input) : implementation(input, JSON.parse(messages[0].content).id));
  };
  pool = createLoopPool({ size, isolation: 'process', waits, provider: scriptedProvider(script) });
  await pool.ready();
  const requests = {}, parkMs = [], request = pool.ledger.request.bind(pool.ledger), run = pool.run.bind(pool);
  pool.ledger.request = (action, ...rest) => {
    requests[action] = (requests[action] ?? 0) + 1;
    const start = performance.now(), pending = request(action, ...rest);
    if (action === 'park') pending.then(() => parkMs.push(performance.now() - start), () => {});
    return pending;
  };
  let jobs = 0;
  pool.run = input => { jobs += 1; return run(input); };
  const idle = treeRss();
  let peak = idle;
  const sampler = setInterval(() => { const now = treeRss(); if (now.bytes > peak.bytes) peak = now; }, 250);
  const rows = [], base = join(output, name), busyStart = pool.busyMs, begin = performance.now();
  let cursor = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (cursor < count) {
      const index = cursor++, input = corpus[index % corpus.length], start = performance.now();
      let started = false;
      const observe = stage => { if (stage === 'model' && !started) { started = true; mostInFlight = Math.max(mostInFlight, ++inFlight); } };
      const answer = await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory: join(base, `${input.name}-${index}`), pool, env, observe, limits: { maxTurns: 2, maxTokens: 64000 } });
      const wall = performance.now() - start;
      if (started) inFlight -= 1;
      rows.push({ name: input.name, index, promoted: answer.promoted, expected: input.expectPromoted, error: answer.error ?? null, wall, model: answer.modelMs, nonModel: wall - answer.modelMs,
        stages: Object.fromEntries(['freeze', 'compile', 'gate', 'ledger'].map(stage => [stage, answer.timings[stage]])) });
    }
  }));
  const wallMs = performance.now() - begin, busyMs = pool.busyMs - busyStart;
  clearInterval(sampler);
  await pool.close();
  const loadEnd = loadavg()[0], modelInJobs = waits === 'hold' ? rows.reduce((total, row) => total + row.model, 0) : 0;
  result.arms[name] = { waits, size, count, width, delay: [low, high], loadStart, loadEnd, label: Math.max(loadStart, loadEnd) > 16 ? 'loaded' : 'acceptance',
    wallMs, throughputPerMinute: count / (wallMs / 60000), promoted: rows.filter(row => row.promoted).length, errors: rows.filter(row => row.error).length,
    wrongVerdicts: rows.filter(row => row.promoted !== row.expected).map(row => `${row.name}-${row.index}`),
    nonModel: stat(rows.map(row => row.nonModel)), model: stat(rows.map(row => row.model)),
    stages: Object.fromEntries(['freeze', 'compile', 'gate', 'ledger'].map(stage => [stage, stat(rows.map(row => row.stages[stage]).filter(Number.isFinite))])),
    parkMs: stat(parkMs), crossings: { bridgeRequestsPerCandidate: Object.fromEntries(Object.entries(requests).map(([action, n]) => [action, n / count])), jobsPerCandidate: jobs / count },
    busyAtSend: { values: [...new Set(sendBusy)].sort(), sends: sendBusy.length, zero: sendBusy.filter(value => value === 0).length },
    peakInFlight: mostInFlight, peakWaiting: mostSending,
    occupancy: busyMs / (size * wallMs), usefulOccupancy: (busyMs - modelInJobs) / (size * wallMs),
    memory: { idleBytes: idle.bytes, peakBytes: peak.bytes, peakProcesses: peak.processes, inFlightPerGiB: mostInFlight / (peak.bytes / 2 ** 30) } };
  writeFileSync(join(receiptDirectory, `rows-${name}.json`), JSON.stringify(rows).replaceAll(output, '<work>'));
  console.log(name, JSON.stringify({ label: result.arms[name].label, wall: Math.round(wallMs), nonModel: result.arms[name].nonModel, inFlight: mostInFlight, busy: result.arms[name].busyAtSend.values, peakMiB: Math.round(peak.bytes / 2 ** 20) }));
}
for (const name of selected.length ? selected : Object.keys(arms)) {
  await arm(name);
  result.finished = new Date().toISOString();
  writeFileSync(join(receiptDirectory, 'summary.json'), JSON.stringify(result, null, 1));
}
