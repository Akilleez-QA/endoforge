import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { scriptedProvider } from '../../core/runtime/x1/transports.mjs';
import { buildCorpus } from '../P-50-in-isolate/corpus.mjs';
import { env, instrument, pythonStats, random, scriptFor, stat } from './common.mjs';

const arms = {
  'serial-hold': { waits: 'hold', size: 1, count: 105, width: 1, delay: [0, 0] },
  'serial-release': { waits: 'release', size: 1, count: 105, width: 1, delay: [0, 0] },
  'swarm-hold': { waits: 'hold', size: 4, count: 64, width: 64, delay: [2000, 4000] },
  'swarm-release': { waits: 'release', size: 4, count: 64, width: 64, delay: [2000, 4000] },
  'swarm-release-256': { waits: 'release', size: 4, count: 256, width: 256, delay: [2000, 4000] },
};
const { output, name } = JSON.parse(process.argv[2]);
const statsDirectory = instrument(output, `loop-${name}`);
const corpus = await buildCorpus(), known = new Map(corpus.map(entry => [entry.name, entry]));
const treeRss = () => {
  const parents = new Map();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try { parents.set(Number(entry), Number(readFileSync(`/proc/${entry}/stat`, 'utf8').split(') ')[1].split(' ')[1])); } catch { }
  }
  const tree = new Set([process.pid]);
  for (let grew = true; grew;) { grew = false; for (const [pid, parent] of parents) if (!tree.has(pid) && tree.has(parent)) { tree.add(pid); grew = true; } }
  let kb = 0;
  for (const pid of tree) try { kb += Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0); } catch { }
  return { bytes: kb * 1024, processes: tree.size };
};
const { waits, size, count, width, delay: [low, high] } = arms[name], next = random(57), loadStart = loadavg()[0];
const sendBusy = [];
let sending = 0, mostSending = 0, inFlight = 0, mostInFlight = 0, pool;
const observeModel = { send: () => { sendBusy.push(pool.stats.busy); mostSending = Math.max(mostSending, ++sending); }, returned: () => { sending -= 1; } };
pool = createLoopPool({ size, isolation: 'process', waits, provider: scriptedProvider(scriptFor(known, null, low, high, next, observeModel)) });
await pool.ready();
const requests = {}, actionMs = {}, request = pool.ledger.request.bind(pool.ledger), run = pool.run.bind(pool);
pool.ledger.request = (action, ...rest) => {
  requests[action] = (requests[action] ?? 0) + 1;
  const start = performance.now(), pending = request(action, ...rest);
  pending.then(() => (actionMs[action] ??= []).push(performance.now() - start), () => {});
  return pending;
};
let jobs = 0;
pool.run = input => { jobs += 1; return run(input); };
const idle = treeRss();
let peak = idle;
const sampler = setInterval(() => { const now = treeRss(); if (now.bytes > peak.bytes) peak = now; }, 250);
const rows = [], base = join(output, `loop-${name}`), busyStart = pool.busyMs, begin = performance.now();
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
const loadEnd = loadavg()[0], modelInJobs = waits === 'hold' ? rows.reduce((total, row) => total + row.model, 0) : 0, python = pythonStats(statsDirectory);
let writer = null;
try { writer = JSON.parse(readFileSync(join(statsDirectory, 'writer.json'), 'utf8')); } catch { }
const summary = { name, waits, size, count, width, delay: [low, high], loadStart, loadEnd, label: Math.max(loadStart, loadEnd) > 16 ? 'loaded' : 'acceptance',
  wallMs, throughputPerMinute: count / (wallMs / 60000), promoted: rows.filter(row => row.promoted).length, errors: rows.filter(row => row.error).length,
  wrongVerdicts: rows.filter(row => row.promoted !== row.expected).map(row => `${row.name}-${row.index}`),
  nonModel: stat(rows.map(row => row.nonModel)), model: stat(rows.map(row => row.model)),
  stages: Object.fromEntries(['freeze', 'compile', 'gate', 'ledger'].map(stage => [stage, stat(rows.map(row => row.stages[stage]).filter(Number.isFinite))])),
  requestMs: Object.fromEntries(Object.entries(actionMs).map(([action, values]) => [action, stat(values)])),
  crossings: { bridgeRequestsPerCandidate: Object.fromEntries(Object.entries(requests).map(([action, n]) => [action, n / count])), jobsPerCandidate: jobs / count },
  busyAtSend: { values: [...new Set(sendBusy)].sort(), sends: sendBusy.length, zero: sendBusy.filter(value => value === 0).length, one: sendBusy.filter(value => value === 1).length },
  peakInFlight: mostInFlight, peakWaiting: mostSending,
  occupancy: busyMs / (size * wallMs), usefulOccupancy: (busyMs - modelInJobs) / (size * wallMs),
  memory: { idleBytes: idle.bytes, peakBytes: peak.bytes, peakProcesses: peak.processes, inFlightPerGiB: mostInFlight / (peak.bytes / 2 ** 30) },
  bridge: { pythonProcesses: python.length, syncs: python.reduce((total, p) => total + (p.syncs ?? 0), 0), syncsPerCandidate: python.reduce((total, p) => total + (p.syncs ?? 0), 0) / count,
    cpuMsPerCandidate: 1000 * python.reduce((total, p) => total + p.user + p.system, 0) / count, peakRssMiB: Math.max(0, ...python.map(p => p.max_rss_kib / 1024)), writer } };
writeFileSync(join(output, `loop-${name}.json`), JSON.stringify({ summary, rows: rows.map(row => ({ ...row })) }).replaceAll(output, '<work>'));
console.log(name, JSON.stringify({ label: summary.label, wall: Math.round(wallMs), nonModel: summary.nonModel, inFlight: mostInFlight, busy: summary.busyAtSend.values, syncs: summary.bridge.syncsPerCandidate }));
