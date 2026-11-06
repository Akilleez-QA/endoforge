import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { good, seeds } from '../../core/runtime/test/fixtures/x1/seeds.mjs';
import { candidate } from '../../core/runtime/test/fixtures/x1/candidate.mjs';
import { python } from '../../core/runtime/test/fixtures/ledger-fixture.mjs';
import { buildCorpus } from './corpus.mjs';
import { counts, windows } from './analyze.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const [outputArg, stampArg, ...selected] = process.argv.slice(2);
const output = resolve(outputArg), receiptDirectory = here(`./receipt/${stampArg}`);
assert.equal(readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim(), hash(readFileSync(here('./PRECOMMIT.md'))));
mkdirSync(output, { recursive: true }); mkdirSync(receiptDirectory, { recursive: true });
const clientEnv = { CODEX_HOME: join(output, 'unused-home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_ASC_CMD: here('../../tools/asc/node_modules/.bin/asc'),
  ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, here('../../core/runtime/test/fixtures/x1/fake-codex.mjs')]) };
const nearest = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.ceil(sorted.length * q) - 1] ?? null; };
const stat = values => ({ n: values.length, p50: nearest(values, 0.5), p95: nearest(values, 0.95), max: Math.max(...values) });
const envFor = (arm, input) => ({ ...process.env, ...clientEnv, ...(arm.startsWith('isolate') ? { ENDOFORGE_LOOP: 'isolate' } : {}),
  FAKE_CODEX_CONTRACT: input.contract, FAKE_CODEX_TESTS: input.tests, FAKE_CODEX_KERNEL: input.kernel, FAKE_CODEX_GLUE: input.glue });
const makePool = (arm, size, jobTimeoutMs) => arm.startsWith('isolate')
  ? createLoopPool({ size, isolation: arm.includes('process') ? 'process' : 'thread', ...(jobTimeoutMs ? { jobTimeoutMs } : {}) })
  : new IsolatePool({ hostPort: here('../../core/runtime/x1/host.mjs'), size, ...(jobTimeoutMs ? { jobTimeoutMs } : {}) });
const armNames = { current: ['current', 1, 5], 'isolate-thread': ['isolate-thread', 1, 5], 'isolate-process': ['isolate-process', 1, 5],
  'current-8': ['current', 8, 3], 'isolate-thread-8': ['isolate-thread', 8, 3], 'isolate-process-8': ['isolate-process', 8, 3] };
const gateVector = async directory => {
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
const corpusDigest = hash(JSON.stringify(corpus));
const result = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here('../../'), encoding: 'utf8' }).trim(), precommit: readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim(), testDouble: true, node: process.version, cpus: cpus()[0]?.model, parallelism: availableParallelism(), totalMemory: totalmem(),
  corpus: { digest: corpusDigest, kernels: corpus.length, expectPromoted: corpus.filter(entry => entry.expectPromoted).length }, started: new Date().toISOString(), arms: {}, counting: {}, parity: null };
const rowsByArm = {};
async function timing(name) {
  const [arm, size, reps] = armNames[name];
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
      const answer = await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory, pool, env: envFor(arm, input) });
      const wall = performance.now() - start;
      rows.push({ name: input.name, rep, promoted: answer.promoted, error: answer.error ?? null, wall, model: answer.modelMs, nonModel: wall - answer.modelMs,
        stages: Object.fromEntries(['freeze', 'compile', 'gate', 'ledger', 'promote'].map(stage => [stage, answer.timings[stage]])) });
    }
  }));
  const wallMs = performance.now() - wallStart;
  await pool.close();
  rowsByArm[name] = rows;
  result.arms[name] = { size, reps, readyMs, wallMs, records: rows.length, promoted: rows.filter(row => row.promoted).length, errors: rows.filter(row => row.error).length,
    nonModel: stat(rows.map(row => row.nonModel)), nonModelPromoted: stat(rows.filter(row => row.promoted).map(row => row.nonModel)),
    stages: Object.fromEntries(['freeze', 'compile', 'gate', 'ledger', 'promote'].map(stage => [stage, stat(rows.map(row => row.stages[stage]).filter(Number.isFinite))])),
    wrongVerdicts: rows.filter(row => row.promoted !== corpus.find(entry => entry.name === row.name).expectPromoted).map(row => `${row.name}-${row.rep}`) };
  writeFileSync(join(receiptDirectory, `rows-${name}.json`), JSON.stringify(rows));
  console.log(name, JSON.stringify({ readyMs: Math.round(readyMs), nonModel: result.arms[name].nonModel, promoted: result.arms[name].promoted, records: rows.length }));
}
function counting(arm, inputs) {
  const tracer = join(output, 'syscount'), base = join(output, `count-${arm}`), log = join(output, `count-${arm}.jsonl`);
  execFileSync('gcc', ['-O1', '-o', tracer, here('./syscount.c')]);
  const run = spawnSync(tracer, [log, process.execPath, here('./count-child.mjs'), JSON.stringify({ arm, output: base, env: clientEnv, inputs })], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  assert.equal(run.status, 0);
  const seen = windows(log), rows = JSON.parse(readFileSync(join(base, 'rows.json')));
  const perCandidate = rows.map(row => ({ name: row.name, promoted: row.promoted, requestsAfter: row.requestsAfter, jobsAfter: row.jobsAfter,
    toCommit: counts(seen[row.id].toCommit), commit: counts(seen[row.id].commit),
    handoffs: seen[row.id].toCommit.spawns.length + seen[row.id].commit.spawns.length + row.requestsAfter.length + 2 * row.jobsAfter,
    writesToCommit: seen[row.id].toCommit.writes.slice(0, 12), writesCommit: seen[row.id].commit.writes.slice(0, 12), readsToCommit: seen[row.id].toCommit.reads.slice(0, 12) }));
  const span = key => ({ spawns: stat(perCandidate.map(row => row[key].spawns)), writes: stat(perCandidate.map(row => row[key].writes)), reads: stat(perCandidate.map(row => row[key].reads)) });
  result.counting[arm] = { candidates: perCandidate.length, toCommit: span('toCommit'), commit: span('commit'), handoffs: stat(perCandidate.map(row => row.handoffs)),
    a1: perCandidate.every(row => row.toCommit.spawns === 0 && row.toCommit.execs === 0 && row.toCommit.writes === 0), sample: perCandidate[0] };
  writeFileSync(join(receiptDirectory, `count-${arm}.json`), JSON.stringify(perCandidate));
  console.log('count', arm, JSON.stringify(result.counting[arm].handoffs), 'a1', result.counting[arm].a1);
}
async function parity() {
  const { files } = candidate();
  const inputs = [...corpus.map(entry => ({ ...entry, slow: false })), ...[good, ...seeds].map(seed => ({ name: `seed-${seed.name}`, contract: files['CONTRACT.md'], tests: files['tests.json'], kernel: seed.kernel, glue: seed.glue, slow: seed.slow, seeded: true }))];
  const arms = ['current', 'isolate-thread', 'isolate-process'], answers = {};
  for (const arm of arms) {
    const pool = makePool(arm, 1, 15000), base = join(output, `parity-${arm}`);
    await pool.ready();
    mkdirSync(base, { recursive: true });
    answers[arm] = {};
    for (const input of inputs) {
      const directory = join(base, input.name);
      const answer = await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory, pool, env: envFor(arm, input) });
      answers[arm][input.name] = { promoted: answer.promoted, error: answer.error ?? null, vector: await gateVector(directory) };
    }
    await pool.close();
  }
  const differences = inputs.flatMap(input => arms.slice(1).flatMap(arm => JSON.stringify([answers[arm][input.name].promoted, answers[arm][input.name].vector]) === JSON.stringify([answers.current[input.name].promoted, answers.current[input.name].vector]) ? [] : [{ input: input.name, arm, current: answers.current[input.name], other: answers[arm][input.name] }]));
  const expectation = name => name === 'seed-good' || (corpus.find(entry => entry.name === name)?.expectPromoted ?? false);
  const wrong = inputs.filter(input => arms.some(arm => answers[arm][input.name].promoted !== expectation(input.name))).map(input => input.name);
  result.parity = { inputs: inputs.length, seeded: inputs.filter(input => input.seeded).length, differences, wrong, promoted: Object.fromEntries(arms.map(arm => [arm, Object.values(answers[arm]).filter(answer => answer.promoted).length])),
    seededVectors: Object.fromEntries(inputs.filter(input => input.seeded).map(input => [input.name, answers['isolate-thread'][input.name]])) };
  writeFileSync(join(receiptDirectory, 'parity.json'), JSON.stringify(answers));
  console.log('parity', inputs.length, 'differences', differences.length, 'wrong', wrong.length);
}
const steps = selected.length ? selected : ['parity', 'count', 'current', 'isolate-thread', 'isolate-process', 'current-8', 'isolate-thread-8', 'isolate-process-8'];
for (const step of steps) {
  if (step === 'parity') await parity();
  else if (step === 'count') { counting('current', corpus.slice(0, 3)); counting('isolate-thread', corpus); counting('isolate-process', corpus); }
  else await timing(step);
  result.finished = new Date().toISOString();
  writeFileSync(join(receiptDirectory, 'summary.json'), JSON.stringify(result, null, 1));
}
