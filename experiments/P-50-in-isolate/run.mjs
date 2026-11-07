import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, loadavg, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { good, seeds, weak } from '../../core/runtime/test/fixtures/x1/seeds.mjs';
import { scriptedProvider } from '../../core/runtime/x1/transports.mjs';
import { idOf, implementation, reply, specification } from '../../core/runtime/test/fixtures/x1/scripted-model.mjs';
import { candidate } from '../../core/runtime/test/fixtures/x1/candidate.mjs';
import { python } from '../../core/runtime/test/fixtures/ledger-fixture.mjs';
import { buildCorpus } from './corpus.mjs';
import { counts, windows } from './analyze.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const [outputArg, stampArg, ...selected] = process.argv.slice(2);
const output = resolve(outputArg), receiptDirectory = here(`./receipt/${stampArg}`);
assert.equal(readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1), hash(readFileSync(here('./PRECOMMIT.md'))));
mkdirSync(output, { recursive: true }); mkdirSync(receiptDirectory, { recursive: true });
const clientEnv = { CODEX_HOME: join(output, 'unused-home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_ASC_CMD: here('../../tools/asc/node_modules/.bin/asc'),
  ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, here('../../core/runtime/test/fixtures/x1/fake-codex.mjs')]) };
const scrub = text => text.replaceAll(output, '<work>');
const nearest = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.ceil(sorted.length * q) - 1] ?? null; };
const stat = values => ({ n: values.length, p50: nearest(values, 0.5), p95: nearest(values, 0.95), max: Math.max(...values) });
const known = new Map();
const script = ({ messages, turn }) => {
  const input = known.get(JSON.parse(messages[0].content).need.split(': ')[1]);
  if (turn === 0) return reply(specification(input));
  return reply(turn === 1 ? implementation(input, idOf(messages)) : { calls: [{ name: 'done' }] });
};
const agentLimits = { maxTurns: 2, maxTokens: 64000 };
const envFor = (arm, input) => ({ ...process.env, ...clientEnv, ...(arm.startsWith('isolate') ? { ENDOFORGE_LOOP: 'isolate' } : arm.startsWith('agent') ? { ENDOFORGE_LOOP: 'agent' } : {}),
  FAKE_CODEX_CONTRACT: input.contract, FAKE_CODEX_TESTS: input.tests, FAKE_CODEX_KERNEL: input.kernel, FAKE_CODEX_GLUE: input.glue });
const makePool = (arm, size, jobTimeoutMs) => arm.startsWith('isolate') || arm.startsWith('agent')
  ? createLoopPool({ size, isolation: arm.includes('process') ? 'process' : 'thread', ...(jobTimeoutMs ? { jobTimeoutMs } : {}), ...(arm.startsWith('agent') ? { provider: scriptedProvider(script) } : {}) })
  : new IsolatePool({ hostPort: here('../../core/runtime/x1/host.mjs'), size, ...(jobTimeoutMs ? { jobTimeoutMs } : {}) });
const armNames = { current: ['current', 1, 5], 'isolate-thread': ['isolate-thread', 1, 5], 'isolate-process': ['isolate-process', 1, 5],
  'current-8': ['current', 8, 3], 'isolate-thread-8': ['isolate-thread', 8, 3], 'isolate-process-8': ['isolate-process', 8, 3],
  'agent-thread': ['agent-thread', 1, 5], 'agent-process': ['agent-process', 1, 5], 'agent-thread-8': ['agent-thread', 8, 3], 'agent-process-8': ['agent-process', 8, 3] };
const gateVector = async directory => {
  if (!existsSync(join(directory, 'ledger.sqlite'))) return null;
  const records = await python(`
import json, sys
from core.ledger.ledger import Ledger
print(json.dumps(Ledger(json.load(sys.stdin)['ledger']).records()))
`, { ledger: join(directory, 'ledger.sqlite') });
  const receipt = records.find(record => record.kind === 'receipt');
  if (!receipt) return null;
  const rounds = (receipt.data.observations[0].report?.attempts ?? []).flatMap(attempt => attempt.results).filter(check => check.check === 'residual').map(check => {
    try { return Object.fromEntries(Object.entries(JSON.parse(check.reason).gates).map(([name, gate]) => [name, gate.ok])); } catch { return null; }
  }).filter(Boolean);
  return { outcome: receipt.data.outcome_state, rounds };
};
const corpus = await buildCorpus();
for (const entry of corpus) known.set(entry.name, entry);
const corpusDigest = hash(JSON.stringify(corpus));
const result = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here('../../'), encoding: 'utf8' }).trim(), precommit: readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1), testDouble: true, node: process.version, cpus: cpus()[0]?.model, parallelism: availableParallelism(), totalMemory: totalmem(),
  corpus: { digest: corpusDigest, kernels: corpus.length, expectPromoted: corpus.filter(entry => entry.expectPromoted).length }, started: new Date().toISOString(), arms: {}, counting: {}, parity: null };
const rowsByArm = {};
async function timing(name) {
  const [arm, size, reps] = armNames[name];
  const loadStart = loadavg()[0];
  const pool = makePool(arm, size), began = performance.now();
  await pool.ready();
  const readyMs = performance.now() - began, rows = [], base = join(output, name);
  mkdirSync(base, { recursive: true });
  const queue = [];
  for (let rep = 0; rep < reps; rep++) for (const input of corpus) queue.push({ rep, input });
  let cursor = 0;
  const wallStart = performance.now();
  await Promise.all(Array.from({ length: size }, async () => {
    while (cursor < queue.length) {
      const { rep, input } = queue[cursor++], directory = join(base, `${input.name}-${rep}`), start = performance.now();
      const answer = await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory, pool, env: envFor(arm, input), limits: agentLimits });
      const wall = performance.now() - start;
      rows.push({ name: input.name, rep, promoted: answer.promoted, error: answer.error ?? null, wall, model: answer.modelMs, nonModel: wall - answer.modelMs,
        stages: Object.fromEntries(['freeze', 'compile', 'gate', 'ledger', 'promote'].map(stage => [stage, answer.timings[stage]])) });
    }
  }));
  const wallMs = performance.now() - wallStart;
  await pool.close();
  rowsByArm[name] = rows;
  const loadEnd = loadavg()[0];
  result.arms[name] = { loadStart, loadEnd, label: Math.max(loadStart, loadEnd) > 16 ? 'loaded, not for acceptance' : 'acceptance', size, reps, readyMs, wallMs, records: rows.length, promoted: rows.filter(row => row.promoted).length, errors: rows.filter(row => row.error).length,
    nonModel: stat(rows.map(row => row.nonModel)), nonModelPromoted: stat(rows.filter(row => row.promoted).map(row => row.nonModel)),
    stages: Object.fromEntries(['freeze', 'compile', 'gate', 'ledger', 'promote'].map(stage => [stage, stat(rows.map(row => row.stages[stage]).filter(Number.isFinite))])),
    wrongVerdicts: rows.filter(row => row.promoted !== corpus.find(entry => entry.name === row.name).expectPromoted).map(row => `${row.name}-${row.rep}`) };
  writeFileSync(join(receiptDirectory, `rows-${name}.json`), scrub(JSON.stringify(rows)));
  console.log(name, JSON.stringify({ readyMs: Math.round(readyMs), nonModel: result.arms[name].nonModel, promoted: result.arms[name].promoted, records: rows.length }));
}
function counting(arm, inputs) {
  const tracer = join(output, 'syscount'), base = join(output, `count-${arm}`), log = join(output, `count-${arm}.jsonl`);
  execFileSync('gcc', ['-O1', '-o', tracer, here('./syscount.c')]);
  const plan = join(output, `count-${arm}.plan.json`);
  writeFileSync(plan, JSON.stringify({ arm, output: base, env: clientEnv, inputs }));
  const run = spawnSync(tracer, [log, process.execPath, here('./count-child.mjs'), plan], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  assert.equal(run.status, 0, JSON.stringify({ signal: run.signal, error: String(run.error) }));
  const seen = windows(log), rows = JSON.parse(readFileSync(join(base, 'rows.json')));
  const perCandidate = rows.map(row => ({ name: row.name, promoted: row.promoted, requestsAfter: row.requestsAfter, jobsAfter: row.jobsAfter,
    toAdmit: counts(seen[row.id].toAdmit), admit: counts(seen[row.id].admit), toCommit: counts(seen[row.id].toCommit), commit: counts(seen[row.id].commit),
    handoffs: ['toAdmit', 'admit', 'toCommit', 'commit'].reduce((total, key) => total + seen[row.id][key].spawns.length, 0) + row.requestsAfter.length + 2 * row.jobsAfter,
    requests: row.requestsAfter, writesToCommit: seen[row.id].toCommit.writes.slice(0, 12), writesCommit: seen[row.id].commit.writes.slice(0, 12), writesAdmit: seen[row.id].admit.writes.slice(0, 12), readsToCommit: seen[row.id].toCommit.reads.slice(0, 12) }));
  const span = key => ({ spawns: stat(perCandidate.map(row => row[key].spawns)), writes: stat(perCandidate.map(row => row[key].writes)), reads: stat(perCandidate.map(row => row[key].reads)) });
  result.counting[arm] = { candidates: perCandidate.length, toAdmit: span('toAdmit'), admit: span('admit'), toCommit: span('toCommit'), commit: span('commit'), handoffs: stat(perCandidate.map(row => row.handoffs)),
    a1: perCandidate.every(row => ['toAdmit', 'toCommit'].every(key => row[key].spawns === 0 && row[key].execs === 0 && row[key].writes === 0)), sample: perCandidate[0] };
  writeFileSync(join(receiptDirectory, `count-${arm}.json`), scrub(JSON.stringify(perCandidate)));
  console.log('count', arm, JSON.stringify(result.counting[arm].handoffs), 'a1', result.counting[arm].a1);
}
async function parity(arms = ['current', 'isolate-thread', 'isolate-process']) {
  const { files } = candidate();
  const inputs = [...corpus.map(entry => ({ ...entry, slow: false })), ...[good, ...seeds].map(seed => ({ name: `seed-${seed.name}`, contract: files['CONTRACT.md'], tests: files['tests.json'], kernel: seed.kernel, glue: seed.glue, slow: seed.slow, seeded: true })),
    ...(arms.includes('agent-process') ? Object.entries(weak).map(([name, entry], index) => ({ name: `weak-${index}`, label: name, contract: 'Synthetic contract for one kernel.', tests: entry.raw ?? JSON.stringify(entry.tests), kernel: entry.kernel, glue: entry.glue, seeded: true })) : [])];
  const answers = {};
  for (const input of inputs) known.set(input.name, input);
  for (const arm of arms) {
    const pool = makePool(arm, 1, 15000), base = join(output, `parity-${arm}-${stampArg}`);
    await pool.ready();
    mkdirSync(base, { recursive: true });
    answers[arm] = {};
    for (const input of inputs) {
      const directory = join(base, input.name);
      const answer = await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory, pool, env: envFor(arm, input), limits: agentLimits });
      answers[arm][input.name] = { promoted: answer.promoted, error: answer.error ?? null, vector: await gateVector(directory) };
    }
    if (arms.includes('agent-process')) for (const [name, options] of [['expired-deadline', { deadline: Date.now() - 60000 }], ['blank-need', { need: '   ' }]]) {
      const input = known.get('add'), answer = await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory: join(base, name), pool, env: envFor(arm, input), limits: agentLimits, ...options });
      answers[arm][name] = { promoted: answer.promoted, error: answer.error ?? null, vector: await gateVector(join(base, name)) };
    }
    await pool.close();
  }
  if (arms.includes('agent-process')) inputs.push({ name: 'expired-deadline' }, { name: 'blank-need' });
  const differences = inputs.flatMap(input => arms.slice(1).flatMap(arm => JSON.stringify([answers[arm][input.name].promoted, answers[arm][input.name].vector]) === JSON.stringify([answers.current[input.name].promoted, answers.current[input.name].vector]) ? [] : [{ input: input.name, arm, current: answers.current[input.name], other: answers[arm][input.name] }]));
  const expectation = name => name === 'seed-good' || (corpus.find(entry => entry.name === name)?.expectPromoted ?? false);
  const wrong = inputs.filter(input => arms.some(arm => answers[arm][input.name].promoted !== expectation(input.name))).map(input => input.name);
  result.parity = { inputs: inputs.length, seeded: inputs.filter(input => input.seeded).length, differences, wrong, promoted: Object.fromEntries(arms.map(arm => [arm, Object.values(answers[arm]).filter(answer => answer.promoted).length])),
    seededVectors: Object.fromEntries(inputs.filter(input => input.seeded).map(input => [input.name, answers[arms[1]][input.name]])) };
  writeFileSync(join(receiptDirectory, 'parity.json'), scrub(JSON.stringify(answers)));
  console.log('parity', inputs.length, 'differences', differences.length, 'wrong', wrong.length);
}
const steps = selected.length ? selected : ['parity', 'count', 'current', 'isolate-thread', 'isolate-process', 'current-8', 'isolate-thread-8', 'isolate-process-8'];
for (const step of steps) {
  if (step === 'parity') await parity();
  else if (step === 'parity-agent') await parity(['current', 'agent-thread', 'agent-process']);
  else if (step === 'count') { counting('current', corpus.slice(0, 3)); counting('isolate-thread', corpus); counting('isolate-process', corpus); }
  else if (step === 'count-agent') { counting('agent-thread', corpus); counting('agent-process', corpus); }
  else await timing(step);
  result.finished = new Date().toISOString();
  writeFileSync(join(receiptDirectory, 'summary.json'), scrub(JSON.stringify(result, null, 1)));
}
