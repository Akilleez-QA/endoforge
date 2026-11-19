import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { availableParallelism, cpus, loadavg, totalmem } from 'node:os';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { scriptedProvider, SpawnClaudeTransport } from '../../core/runtime/x1/transports.mjs';
import { createStageRates, loopStages, format } from '../../core/runtime/stage-rates.mjs';
import { implementation, reply, specification, stageOf } from '../../core/runtime/test/fixtures/x1/scripted-model.mjs';
import { withCapability } from '../../core/runtime/test/fixtures/x1/candidate.mjs';
import { subscribedHome } from '../../core/runtime/test/fixtures/subscription.mjs';
import { buildCorpus } from '../P-50-in-isolate/corpus.mjs';

const forbidden = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY'];
assert.deepEqual(forbidden.filter(name => process.env[name] !== undefined), [], 'credential variables must be unset');
const here = path => fileURLToPath(new URL(path, import.meta.url));
const [outputArg, stampArg, plan, ...selected] = process.argv.slice(2);
const output = resolve(outputArg), receipt = here(`./receipt/${stampArg}`);
if (stampArg !== 'pilot') {
  const recorded = readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1).split(' ')[0];
  assert.equal(recorded, hash(readFileSync(here('./PRECOMMIT.md'))), 'PRECOMMIT.md differs from its recorded digest');
}
mkdirSync(output, { recursive: true }); mkdirSync(receipt, { recursive: true });
const corpus = (await buildCorpus()).map(entry => ({ ...entry, contract: withCapability(entry.contract, entry.glue) }));
const known = new Map(corpus.map(entry => [entry.name, entry]));
const fakeClaude = fileURLToPath(new URL('../../core/runtime/test/fixtures/x1/fake-claude.mjs', import.meta.url));
const SPEC_MS = 15500, IMPL_MS = 6300;
const descendants = () => {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,time=,comm='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/));
  const table = rows.map(([pid, ppid, rss, time, ...comm]) => ({ pid: +pid, ppid: +ppid, rssKb: +rss, cpuS: time.split(':').reduce((t, part) => t * 60 + Number(part), 0), comm: basename(comm.join(' ')) }));
  const tree = new Set([process.pid]);
  for (let grew = true; grew;) { grew = false; for (const row of table) if (!tree.has(row.pid) && tree.has(row.ppid)) { tree.add(row.pid); grew = true; } }
  return table.filter(row => tree.has(row.pid));
};
const memoryLevel = () => Number(execFileSync('sysctl', ['-n', 'kern.memorystatus_level'], { encoding: 'utf8' }).trim());
const taskpolicy = (pids, flag) => { for (const pid of pids) execFileSync('taskpolicy', [flag, '-p', String(pid)]); };

const transportErrors = new Map();
const intervalsOf = () => ({ model: [], transport: [], jobs: [], ledger: [], events: [], compile: 0, gates: 0 });
function providerFor(arm, scale, perNeed, transport) {
  return scriptedProvider(async ({ messages }) => {
    const first = JSON.parse(messages[0].content), id = first.id, record = perNeed.get(id), stage = stageOf(messages);
    const input = known.get(first.need.split(': ')[1]);
    if (arm === 'B') {
      const begin = performance.now();
      try { await transport.send({ messages: [{ role: 'user', content: 'stand-in turn' }] }); } catch (error) { transportErrors.set(error.message, (transportErrors.get(error.message) ?? 0) + 1); throw error; }
      record?.transport.push([begin, performance.now()]);
    }
    const ms = (stage === 'specification' ? SPEC_MS : IMPL_MS) * scale, begin = performance.now();
    if (ms) await sleep(ms);
    record?.model.push([begin, performance.now()]);
    return reply(stage === 'specification' ? specification(input) : implementation(input, id));
  });
}
const covered = (intervals, from, to) => {
  const clipped = intervals.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, end = -Infinity;
  for (const [a, b] of clipped) { if (b <= end) continue; total += b - Math.max(a, end); end = b; }
  return total;
};
const subtract = (intervals, minus) => intervals.flatMap(([a, b]) => {
  let pieces = [[a, b]];
  for (const [c, d] of minus) pieces = pieces.flatMap(([x, y]) => (d <= x || c >= y ? [[x, y]] : [[x, Math.min(c, y)], [Math.max(d, x), y]].filter(([p, q]) => q > p)));
  return pieces;
});
function bucketsOf(record, start, end) {
  const event = name => record.events.filter(([n]) => n === name).map(([, t]) => t);
  const pair = (open, close) => event(open).map((t, i) => [t, event(close)[i] ?? end]);
  const transport = record.transport, model = subtract(record.model, transport);
  const freeze = subtract(pair('admitting', 'admitted'), [...model, ...transport]);
  const commitPhase = pair('committing', 'returned');
  const ledgerOutside = subtract(record.ledger.filter(([, , action]) => action !== 'admit').map(([a, b]) => [a, b]), freeze);
  const promote = subtract(commitPhase, ledgerOutside);
  const higher = [...transport, ...model, ...freeze, ...ledgerOutside, ...promote];
  const jobsOnly = subtract(record.jobs, higher);
  const setup = [[start, event('need')[0] ?? start]];
  const ms = list => covered(list, start, end);
  const b = { spawnInit: ms(transport), model: ms(model), freeze: ms(freeze), ledger: ms(ledgerOutside), promote: ms(promote), setup: ms(setup), compile: record.compile, gate: record.gates };
  const cellTime = ms(jobsOnly);
  b.crossing = cellTime - b.compile - b.gate;
  const named = Object.values(b).reduce((t, v) => t + v, 0), wall = end - start;
  return { wall, ...b, unattributed: wall - named, counts: { jobs: record.jobs.length, ledger: record.ledger.length, model: record.model.length, transport: transport.length } };
}

async function arm(label, config) {
  transportErrors.clear();
  const loadStart = loadavg()[0], memStart = memoryLevel();
  const directory = mkdtempSync(join(output, `${label}-`));
  const perNeed = new Map(), cells = config.cells ?? Math.min(config.width, 12);
  const rates = createStageRates({ stages: loopStages({ cells, lane: 0 }) });
  let transport = null, home = null;
  if (config.arm === 'B') {
    home = subscribedHome(join(directory, 'home'));
    transport = new SpawnClaudeTransport({ command: fakeClaude, cwd: directory, base: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home }, environment: { FAKE_CLAUDE_LOG: join(directory, 'fake.log') }, governor: null });
  }
  const pool = createLoopPool({ size: cells, isolation: config.isolation ?? 'process', waits: 'release', provider: providerFor(config.arm, config.scale, perNeed, transport), rates });
  const run = pool.run.bind(pool);
  pool.run = async job => { const begin = performance.now(); try { return await run(job); } finally { perNeed.get(job.portOptions?.id)?.jobs.push([begin, performance.now()]); } };
  const request = pool.ledger.request.bind(pool.ledger);
  let sent = 0;
  const capture = config.capture ? openSync(join(output, 'capture.jsonl'), 'w') : null;
  pool.ledger.request = async (action, job, ...rest) => { const begin = performance.now();
    if (capture !== null) writeSync(capture, JSON.stringify({ id: ++sent, action, job: { reference: job.reference, candidates: job.candidates, receipts: job.receipts }, result: rest[0] }) + '\n'); try { return await request(action, job, ...rest); } finally { perNeed.get(basename(dirname(job?.reference?.ledger ?? '')))?.ledger.push([begin, performance.now(), action]); } };
  await pool.ready(); await pool.ledger.start();
  const tree = descendants(), cellPids = tree.filter(row => row.pid !== process.pid && row.pid !== pool.ledger.pid && row.comm === 'node').map(row => row.pid);
  if (config.qos === 'cells-background') taskpolicy(cellPids, '-b');
  if (config.qos === 'writer-background') taskpolicy([pool.ledger.pid], '-b');
  if (config.qos === 'cells-utility') for (const pid of cellPids) execFileSync('taskpolicy', ['-t', '2', '-l', '2', '-p', String(pid)]);
  const done = [], begin = performance.now(), stopAt = begin + config.seconds * 1000;
  let cursor = 0, windowStart = null, windowEnd = null, peakRss = 0;
  const memTimer = setInterval(() => { peakRss = Math.max(peakRss, descendants().reduce((t, row) => t + row.rssKb, 0)); }, 2000);
  const cpuNow = () => descendants().reduce((t, row) => t + (row.pid === process.pid ? 0 : row.cpuS), 0) * 1000 + (process.cpuUsage().user + process.cpuUsage().system) / 1000;
  const marks = (async () => {
    await sleep(config.warmup * 1000);
    windowStart = { t: performance.now(), snapshot: rates.snapshot(), cpu: cpuNow(), elu: performance.eventLoopUtilization() };
    await sleep(Math.max(0, stopAt - performance.now()));
    windowEnd = { t: performance.now(), snapshot: rates.snapshot(), cpu: cpuNow(), tree: descendants(), elu: performance.eventLoopUtilization(windowStart.elu) };
  })();
  await Promise.all(Array.from({ length: config.width }, async () => {
    while (performance.now() < stopAt) {
      const index = cursor++, input = corpus[index % corpus.length], id = `${input.name}-${index}`, record = intervalsOf();
      perNeed.set(id, record);
      const start = performance.now();
      const answer = await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory: join(directory, id), pool, env: { ENDOFORGE_LOOP: 'agent' }, limits: { maxTurns: 2, maxTokens: 64000 }, observe: name => record.events.push([name, performance.now()]) });
      const end = performance.now();
      record.compile = answer.timings?.compile ?? 0; record.gates = answer.timings?.gate ?? 0;
      done.push({ index, name: input.name, start, end, promoted: answer.promoted, expected: input.expectPromoted, error: answer.error ?? null, outcome: `${answer.promoted}/${input.expectPromoted}/${answer.status ?? '-'}/${answer.problem ?? '-'}`, buckets: bucketsOf(record, start, end) });
      perNeed.delete(id);
      rmSync(join(directory, id), { recursive: true, force: true });
    }
  }));
  await marks;
  clearInterval(memTimer);
  const view = rates.view({ from: windowStart.snapshot, to: windowEnd.snapshot });
  rates.stop();
  await pool.close(); await transport?.close();
  if (capture !== null) closeSync(capture);
  const fakeStarts = config.arm === 'B' ? readFileSync(join(directory, 'fake.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(line => line.start).length : 0;
  rmSync(directory, { recursive: true, force: true });
  const inWindow = done.filter(row => row.end > windowStart.t && row.end <= windowEnd.t), seconds = (windowEnd.t - windowStart.t) / 1000;
  const mean = key => inWindow.reduce((t, row) => t + row.buckets[key], 0) / Math.max(1, inWindow.length);
  const keys = ['wall', 'spawnInit', 'model', 'freeze', 'compile', 'gate', 'crossing', 'ledger', 'promote', 'setup', 'unattributed'];
  const buckets = Object.fromEntries(keys.map(key => [key, mean(key)]));
  const throughput = inWindow.length / seconds, W = buckets.wall / 1000, L = config.width;
  const littleResidual = Math.abs(L - throughput * W) / L;
  const nonModel = (buckets.wall - buckets.model) / buckets.wall;
  const rssKb = windowEnd.tree.reduce((t, row) => t + row.rssKb, 0);
  const cellsRss = windowEnd.tree.filter(row => row.comm === 'node' && row.pid !== process.pid).map(row => row.rssKb);
  const loadEnd = loadavg()[0];
  const row = { label, config: { ...config, cells }, loadStart, loadEnd, loaded: Math.max(loadStart, loadEnd) > 16, memoryLevel: [memStart, memoryLevel()], windowSeconds: seconds, completed: inWindow.length, all: done.length,
    throughput, promotedPerSecond: inWindow.filter(item => item.promoted).length / seconds, wrongVerdicts: done.filter(item => item.promoted !== item.expected).length, errors: done.filter(item => item.error).length,
    buckets, nonModelShare: nonModel, reconciliation: Math.abs(buckets.unattributed) / buckets.wall, littleResidual, cpuMsPerCandidate: (windowEnd.cpu - windowStart.cpu) / Math.max(1, inWindow.length),
    rss: { treeMb: rssKb / 1024, peakTreeMb: peakRss / 1024, parentMb: (windowEnd.tree.find(r => r.pid === process.pid)?.rssKb ?? 0) / 1024, cellMb: cellsRss.map(kb => kb / 1024), writerMb: windowEnd.tree.filter(r => r.comm.startsWith('python')).reduce((t, r) => t + r.rssKb, 0) / 1024, writers: windowEnd.tree.filter(r => r.comm.startsWith('python')).length },
    hostElu: windowEnd.elu.utilization,
    perGb: throughput / (rssKb / 1024 / 1024), outcomes: done.reduce((all, item) => (all[item.outcome] = (all[item.outcome] ?? 0) + 1, all), {}), transportErrors: Object.fromEntries(transportErrors), fakeSpawns: fakeStarts, verdict: view.verdict, view, wallP50: [...inWindow.map(r => r.buckets.wall)].sort((a, b) => a - b)[Math.floor(inWindow.length / 2)] ?? null };
  console.log(JSON.stringify({ label, thr: +throughput.toFixed(2), n: inWindow.length, nonModel: +(100 * nonModel).toFixed(1), recon: +(100 * row.reconciliation).toFixed(1), little: +(100 * littleResidual).toFixed(1), verdict: `${view.verdict.bottleneck} (${view.verdict.kind})`, rssMb: Math.round(rssKb / 1024), load: [loadStart, loadEnd].map(v => +v.toFixed(1)), wrong: row.wrongVerdicts, errors: row.errors, b: Object.fromEntries(keys.map(k => [k, +buckets[k].toFixed(1)])) }));
  console.log(format(view));
  return row;
}

const result = { plan, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here('../../'), encoding: 'utf8' }).trim(), node: process.version, cpu: cpus()[0]?.model, parallelism: availableParallelism(), memoryGb: totalmem() / 2 ** 30,
  perflevels: execFileSync('sysctl', ['hw.perflevel0.physicalcpu', 'hw.perflevel1.physicalcpu', 'hw.perflevel2.physicalcpu'], { encoding: 'utf8' }).trim(),
  corpus: { digest: hash(JSON.stringify(corpus)), kernels: corpus.length }, started: new Date().toISOString(), rows: [] };
const suffix = plan === 'qos-clamp' || plan === 'climb' ? `-${selected[0]}` : '';
const receiptPath = join(receipt, `${plan}${suffix}.json`);
try { const prior = JSON.parse(readFileSync(receiptPath, 'utf8')); result.rows = prior.rows; result.resumed = [...(prior.resumed ?? []), { at: new Date().toISOString(), kept: prior.rows.length }]; } catch { }
const save = () => { result.finished = new Date().toISOString(); writeFileSync(receiptPath, JSON.stringify(result, null, 1)); };
const waitForLoad = async () => { for (let i = 0; loadavg()[0] > 16; i++) { if (i > 40) throw Error('stop: load above 16 for 10 minutes'); await sleep(15000); } };
const timing = scale => (scale >= 1 ? { seconds: 150, warmup: 25 } : scale >= 0.1 ? { seconds: 45, warmup: 8 } : { seconds: 25, warmup: 5 });
const timingWide = scale => (scale >= 1 ? { seconds: 110, warmup: 35 } : scale >= 0.1 ? { seconds: 45, warmup: 10 } : { seconds: 25, warmup: 6 });
const runRow = async (label, config) => {
  if (result.rows.some(row => row.label === label || row.rerunOf === label)) return;
  await waitForLoad();
  let row = await arm(label, config);
  if (row.loaded) { await waitForLoad(); row = { ...(await arm(`${label}-rerun`, config)), rerunOf: label }; }
  result.rows.push(row); save();
  if (row.loaded) throw Error(`stop: ${label} loaded twice`);
  if (row.reconciliation > 0.10) console.log(`finding: ${label} reconciliation ${(100 * row.reconciliation).toFixed(1)}%`);
};

if (plan === 'pilot') {
  for (const spec of selected) { const [a, s, w, sec] = spec.split(':'); await runRow(`pilot-${spec}`, { arm: a, scale: Number(s), width: Number(w), seconds: Number(sec ?? 12), warmup: 3 }); }
} else if (plan === 'predict') {
  for (const a of ['A', 'B']) for (const scale of [1, 0.1, 0.01, 0]) for (const width of [1, 64]) await runRow(`${a}-s${scale}-w${width}`, { arm: a, scale, width, ...(width === 1 ? timing(scale) : timingWide(scale)) });
} else if (plan === 'sweep') {
  for (const a of ['A', 'B']) for (const width of [1, 2, 4, 6, 8, 12, 24, 64]) await runRow(`sweep-${a}-w${width}`, { arm: a, scale: 0, width, seconds: 25, warmup: 6 });
} else if (plan === 'sweep-rerun') {
  for (const a of ['B', 'A']) for (const width of [1, 2, 4, 6, 8, 12, 24, 64]) await runRow(`sweep-${a}-w${width}-rerun`, { arm: a, scale: 0, width, seconds: 25, warmup: 6 });
} else if (plan === 'qos') {
  for (let rep = 0; rep < 2; rep++) for (const qos of ['default', 'cells-utility', 'cells-background', 'writer-background']) await runRow(`qos-${qos}-${rep}`, { arm: 'A', scale: 0, width: 12, qos, seconds: 25, warmup: 6 });
} else if (plan === 'qos-clamp') {
  for (let rep = 0; rep < 2; rep++) await runRow(`qos-${selected[0] ?? 'clamp'}-${rep}`, { arm: 'A', scale: 0, width: 12, qos: selected[0] ?? 'clamp', seconds: 25, warmup: 6 });
} else if (plan === 'capture') {
  await runRow('capture-w64', { arm: 'A', scale: 0, width: 64, seconds: 20, warmup: 3, capture: true });
} else if (plan === 'climb') {
  const rep = Number(selected[0]);
  await runRow(`w64-r${rep}`, { arm: 'A', scale: 0, width: 64, seconds: 25, warmup: 6 });
  await runRow(`w1-r${rep}`, { arm: 'A', scale: 0, width: 1, seconds: 25, warmup: 5 });
} else if (plan === 'isolation') {
  for (const isolation of ['process', 'thread']) for (const width of [12, 24]) await runRow(`iso-${isolation}-w${width}`, { arm: 'A', scale: 0, width, isolation, seconds: 25, warmup: 6 });
}
save();
