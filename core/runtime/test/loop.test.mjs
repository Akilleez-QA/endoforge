import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import { ASC_PATH } from '../../../tools/asc/pin.mjs';
import { IsolatePool } from '../isolate-pool.mjs';
import { admit, checkCandidate, commitCandidate, createLoopPool, evaluateAndCommit, evaluateInCell } from '../x1/loop.mjs';
import { configuration, hash } from '../x1/host.mjs';
import { ledger } from '../x1/ledger.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { evaluate as evaluateReference } from '../x1/reference.mjs';
import { candidate as additionCandidate } from './fixtures/x1/candidate.mjs';
import { forgeries } from './fixtures/x1/forgeries.mjs';
import { good, seeds } from './fixtures/x1/seeds.mjs';
import { python } from './fixtures/ledger-fixture.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const stagePort = here('./fixtures/x1/loop-stage-port.mjs');
const repairModule = here('./fixtures/x1/loop-repair.mjs');
const x1Directory = here('../x1/');
const ascCommand = here('../../../tools/asc/node_modules/.bin/asc');
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-loop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const baseEnv = root => ({ ...process.env, CODEX_HOME: join(root, 'unused-home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_ASC_CMD: ascCommand,
  ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, here('./fixtures/x1/fake-codex.mjs')]) });
const isolated = root => ({ ...baseEnv(root), ENDOFORGE_LOOP: 'isolate' });
const needEnv = (env, seed) => ({ ...env, FAKE_CODEX_KERNEL: seed.kernel, FAKE_CODEX_GLUE: seed.glue });
const records = ledgerPath => python(`
import json, sys
from core.ledger.ledger import Ledger
print(json.dumps(Ledger(json.load(sys.stdin)['ledger']).records()))
`, { ledger: ledgerPath });
const gateVector = async directory => {
  const receipt = (await records(join(directory, 'ledger.sqlite'))).find(record => record.kind === 'receipt');
  if (!receipt) return null;
  const attempts = receipt.data.observations[0].report?.attempts ?? [];
  const x1 = attempts.flatMap(attempt => attempt.results).filter(check => check.check === 'residual').map(check => {
    try { return JSON.parse(check.reason); } catch { return null; }
  }).filter(Boolean);
  return { outcome: receipt.data.outcome_state, rounds: x1.map(result => Object.fromEntries(Object.entries(result.gates).map(([name, gate]) => [name, gate.ok]))) };
};
async function task(pool, directory) {
  mkdirSync(directory, { recursive: true });
  const oracle = join(directory, 'oracle');
  mkdirSync(oracle);
  const { files } = additionCandidate();
  for (const name of ['CONTRACT.md', 'tests.json', 'frozen.sha256']) writeFileSync(join(oracle, name), files[name]);
  for (const name of ['host.mjs', 'gates.mjs', 'glue.schema.json', 'loop-port.mjs', 'agent.mjs']) writeFileSync(join(oracle, name), readFileSync(join(x1Directory, name)));
  const reference = { ledger: join(directory, 'ledger.sqlite'), root: oracle };
  const admission = await admit(pool, reference, { need: 'integer add(a,b)', configuration });
  reference.identity = admission.identity;
  const id = directory.split('/').pop();
  const glue = JSON.parse(files['glue.json']); glue.id = id;
  return { reference, admission, candidate: { id, files: { ...files, 'glue.json': JSON.stringify(glue) } }, decisionPath: join(directory, 'promotion.json') };
}

test('verdicts match the current path on good and seeded bad candidates', { timeout: 120000 }, async t => {
  const root = scratch(t), current = new IsolatePool({ hostPort: here('../x1/host.mjs'), size: 1, jobTimeoutMs: 4000 });
  const loop = createLoopPool({ primes: 1, jobTimeoutMs: 4000 });
  t.after(() => Promise.all([current.close(), loop.close()]));
  for (const arm of ['current', 'isolate']) mkdirSync(join(root, arm));
  for (const seed of [good, ...seeds]) {
    const left = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'current', seed.name), pool: current, env: needEnv(baseEnv(root), seed) });
    const right = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'isolate', seed.name), pool: loop, env: needEnv(isolated(root), seed) });
    assert.equal(right.promoted, left.promoted, seed.name);
    assert.equal(right.promoted, seed === good, seed.name);
    assert.deepEqual(await gateVector(join(root, 'isolate', seed.name)), await gateVector(join(root, 'current', seed.name)), seed.name);
    if (!right.error) assert.equal(JSON.parse(readFileSync(join(root, 'isolate', seed.name, 'promotion.json'))).decision, right.promoted ? 'promote' : 'refuse');
  }
});

test('a promoted result is durable and the unchanged promotion rule agrees', async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const directory = join(root, 'addition');
  const result = await runNeed({ need: 'integer add(a,b)', directory, pool, env: needEnv(isolated(root), good) });
  assert.equal(result.promoted, true, JSON.stringify(result));
  assert(Object.values(result.timings).every(n => Number.isFinite(n) && n >= 0));
  const decision = JSON.parse(readFileSync(join(directory, 'promotion.json')));
  assert.equal(decision.sha256, result.decision);
  assert.equal(decision.decision, 'promote');
  const kinds = (await records(join(directory, 'ledger.sqlite'))).map(record => record.kind);
  assert.deepEqual(kinds, ['task', 'admitted_input', 'frozen_evaluator', 'candidate', 'receipt']);
  const replay = await ledger('promote', { reference: { ledger: join(directory, 'ledger.sqlite'), identity: decision.frozen_evaluator },
    candidate: result.candidate, receipt: result.receipt, decisionPath: join(root, 'replay.json') });
  assert.equal(replay.decision, 'promote');
  const refused = await ledger('promote', { reference: { ledger: join(directory, 'ledger.sqlite'), identity: decision.frozen_evaluator },
    candidate: result.candidate, receipt: { ...result.receipt, hash: '0'.repeat(64) }, decisionPath: join(root, 'wrong-hash.json') });
  assert.equal(refused.decision, 'refuse');
});

test('the loop refuses a pool that is not a loop pool, and the current path stays the default', async t => {
  const root = scratch(t), current = new IsolatePool({ hostPort: here('../x1/host.mjs'), size: 1 });
  t.after(() => current.close());
  const refused = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'wrong-pool'), pool: current, env: isolated(root) });
  assert.equal(refused.promoted, false);
  const kept = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'default'), pool: current, env: needEnv(baseEnv(root), good) });
  assert.equal(kept.promoted, true);
});

test('warm compile is repeatable across a failing neighbor, and a check round leaves nothing durable', async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const { admission, candidate, reference } = await task(pool, join(root, 'addition'));
  const before = (await records(reference.ledger)).length;
  assert.equal(await checkCandidate(pool, admission, candidate), null);
  const bad = await checkCandidate(pool, admission, { ...candidate, files: { ...candidate.files, 'kernel.ts': seeds[0].kernel } });
  assert.equal(bad.gates.G2_compiles.ok, false);
  assert.equal(await checkCandidate(pool, admission, candidate), null);
  assert.equal((await records(reference.ledger)).length, before);
  const first = await evaluateInCell(pool, { candidate, admission });
  const second = await evaluateInCell(pool, { candidate, admission });
  assert.equal(first.content, second.content);
  assert.equal(hash(first.content), first.observed.evidence.identity);
});

test('a kernel with more than the allowed memory never reaches the gates', async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const { admission, candidate } = await task(pool, join(root, 'addition'));
  const over = await checkCandidate(pool, admission, { ...candidate, files: { ...candidate.files, 'kernel.ts':
    'memory.data(70000000);\nexport function add(a:i32,b:i32):i32{return a+b}' } });
  assert.equal(over.gates.G2_compiles.ok, false);
});

for (const mode of ['change', 'add', 'delete', 'replace']) {
  test(`a frozen tree ${mode} after admission is refused at commit`, async t => {
    const root = scratch(t), pool = createLoopPool({ primes: 1 });
    t.after(() => pool.close());
    for (const stage of ['generated', 'committing']) {
      const directory = join(root, `${stage}-${mode}`), oracle = join(directory, 'oracle');
      const observe = seen => {
        if (seen !== stage) return;
        if (mode === 'change') appendFileSync(join(oracle, 'tests.json'), ' ');
        if (mode === 'add') writeFileSync(join(oracle, 'extra.txt'), 'x');
        if (mode === 'delete') unlinkSync(join(oracle, 'CONTRACT.md'));
        if (mode === 'replace') renameSync(oracle, `${oracle}-moved`);
      };
      const result = await runNeed({ need: 'integer add(a,b)', directory, pool, env: needEnv(isolated(root), good), observe });
      assert.equal(result.promoted, false);
      assert.equal(result.problem, 'frozen_drift');
      const vector = await gateVector(directory);
      assert.equal(vector.outcome, 'failed');
      assert.equal(JSON.parse(readFileSync(join(directory, 'promotion.json'))).decision, 'refuse');
    }
  });
}

test('a frozen tree change during the job is refused', async t => {
  const root = scratch(t), directory = join(root, 'addition');
  process.env.EF_MUTATE_FILE = join(directory, 'oracle', 'tests.json');
  const pool = createLoopPool({ primes: 1, hostPort: stagePort });
  await pool.ready();
  delete process.env.EF_MUTATE_FILE;
  t.after(() => pool.close());
  const result = await runNeed({ need: 'integer add(a,b)', directory, pool, env: needEnv(isolated(root), good) });
  assert.equal(result.promoted, false);
  assert.equal(result.problem, 'frozen_drift');
});

test('a bundle changed in the job with its digest unchanged never passes', async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const { admission, candidate, reference, decisionPath } = await task(pool, join(root, 'addition'));
  const data = JSON.parse(admission.encoded), bundle = JSON.parse(data.content);
  bundle.files['gates.mjs'] = Buffer.from('export const runGates = () => ({ promotable: true, gates: {} });').toString('hex');
  data.content = JSON.stringify(bundle);
  const outcome = await evaluateAndCommit(pool, { candidate, reference, decisionPath, digest: admission.digest,
    admission: { ...admission, encoded: JSON.stringify(data) } });
  assert.equal(outcome.promoted, false);
  assert.equal(outcome.status, 'inconclusive');
});

test('a self-consistent changed bundle and digest cannot promote', async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const forge = admission => {
    const data = JSON.parse(admission.encoded), bundle = JSON.parse(data.content);
    bundle.residual = 'always pass';
    data.content = JSON.stringify(bundle);
    data.freeze.digest = hash(data.content);
    const encoded = JSON.stringify(data);
    return { identity: `evr:${hash(encoded)}`, digest: data.freeze.digest, encoded };
  };
  const honest = await task(pool, join(root, 'honest-digest'));
  const kept = await evaluateAndCommit(pool, { candidate: honest.candidate, reference: honest.reference, decisionPath: honest.decisionPath,
    digest: honest.admission.digest, admission: forge(honest.admission) });
  assert.equal(kept.promoted, false);
  assert.equal(kept.status, 'failed');
  assert.match(kept.problem, /different frozen evaluator/);
  const forged = await task(pool, join(root, 'forged-digest'));
  await assert.rejects(evaluateAndCommit(pool, { candidate: forged.candidate, reference: forged.reference, decisionPath: forged.decisionPath,
    admission: forge(forged.admission) }), /digest/);
  assert.equal((await records(forged.reference.ledger)).some(record => record.kind === 'candidate'), false);
});

test('a change to the bundle held in the cell fails at the next verification', async t => {
  const root = scratch(t);
  process.env.EF_FLIP_ADMISSION = '1';
  const pool = createLoopPool({ primes: 1, hostPort: stagePort });
  await pool.ready();
  delete process.env.EF_FLIP_ADMISSION;
  t.after(() => pool.close());
  const directory = join(root, 'addition');
  const result = await runNeed({ need: 'integer add(a,b)', directory, pool, env: needEnv(isolated(root), good) });
  assert.equal(result.promoted, false);
  assert.equal((await gateVector(directory)).outcome, 'failed');
});

test('an implementation in the frozen tree that differs from the cell code never passes', async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const directory = join(root, 'addition');
  const oracle = join(directory, 'oracle');
  mkdirSync(oracle, { recursive: true });
  const { files } = additionCandidate();
  for (const name of ['CONTRACT.md', 'tests.json', 'frozen.sha256']) writeFileSync(join(oracle, name), files[name]);
  for (const name of ['host.mjs', 'glue.schema.json', 'loop-port.mjs', 'agent.mjs']) writeFileSync(join(oracle, name), readFileSync(join(x1Directory, name)));
  writeFileSync(join(oracle, 'gates.mjs'), `${readFileSync(join(x1Directory, 'gates.mjs'))}\n`);
  const reference = { ledger: join(directory, 'ledger.sqlite'), root: oracle };
  const admission = await admit(pool, reference, { need: 'integer add(a,b)', configuration });
  reference.identity = admission.identity;
  const glue = JSON.parse(files['glue.json']); glue.id = 'addition';
  const outcome = await evaluateAndCommit(pool, { candidate: { id: 'addition', files: { ...files, 'glue.json': JSON.stringify(glue) } }, reference, admission, decisionPath: join(directory, 'promotion.json') });
  assert.equal(outcome.promoted, false);
  assert.equal(outcome.status, 'inconclusive');
});

for (const [name, forge] of Object.entries(forgeries)) {
  test(`a forged receipt is refused: ${name}`, async t => {
    const root = scratch(t), pool = createLoopPool({ primes: 1 });
    t.after(() => pool.close());
    const { admission, candidate, reference, decisionPath } = await task(pool, join(root, 'addition'));
    const evaluated = await evaluateInCell(pool, { candidate, admission });
    forge(evaluated);
    const outcome = await commitCandidate(pool, { evaluated, reference, digest: admission.digest, decisionPath });
    assert.equal(outcome.promoted, false);
    assert.equal(JSON.parse(readFileSync(decisionPath)).decision, 'refuse');
    const replay = await ledger('promote', { reference, candidate: outcome.candidate, receipt: outcome.receipt, decisionPath: join(root, 'replay.json') });
    assert.equal(replay.decision, 'refuse', name);
  });
}

test('an unforged commit through the same split still promotes, so the forgeries above prove the checks', async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const { admission, candidate, reference, decisionPath } = await task(pool, join(root, 'addition'));
  const evaluated = await evaluateInCell(pool, { candidate, admission });
  const outcome = await commitCandidate(pool, { evaluated, reference, digest: admission.digest, decisionPath });
  assert.equal(outcome.promoted, true, JSON.stringify(outcome.problem));
});

test('commit rejects a receipt that does not bind the frozen evaluator', async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const { admission, candidate, reference, decisionPath } = await task(pool, join(root, 'addition'));
  const evaluated = await evaluateInCell(pool, { candidate, admission });
  await assert.rejects(commitCandidate(pool, { evaluated, reference: { ...reference, identity: `evr:${'0'.repeat(64)}` }, digest: admission.digest, decisionPath }));
  await assert.rejects(commitCandidate(pool, { evaluated, reference, digest: '0'.repeat(64), decisionPath }));
  assert.equal((await records(reference.ledger)).some(record => record.kind === 'candidate'), false);
});

test('repair rounds run in one cell, are bounded and cannot edit the oracle', { timeout: 60000 }, async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1, jobTimeoutMs: 8000 });
  t.after(() => pool.close());
  await pool.ready();
  const wrong = { 'kernel.ts': seeds[1].kernel };
  const fixed = await task(pool, join(root, 'fixed'));
  const repaired = await evaluateAndCommit(pool, { ...fixed, candidate: { ...fixed.candidate, files: { ...fixed.candidate.files, ...wrong } },
    repair: { module: repairModule, maxRounds: 3, options: { kernel: good.kernel } } });
  assert.equal(repaired.promoted, true, JSON.stringify(repaired.problem));
  assert.deepEqual(repaired.rounds.map(round => Boolean(round.failures)), [true, false]);
  const bounded = await task(pool, join(root, 'bounded'));
  const stopped = await evaluateAndCommit(pool, { ...bounded, candidate: { ...bounded.candidate, files: { ...bounded.candidate.files, ...wrong } },
    repair: { module: repairModule, maxRounds: 2, options: { mode: 'never' } } });
  assert.equal(stopped.promoted, false);
  assert.equal(stopped.rounds.length, 3);
  const oracle = await task(pool, join(root, 'oracle'));
  const edited = await evaluateAndCommit(pool, { ...oracle, candidate: { ...oracle.candidate, files: { ...oracle.candidate.files, ...wrong } },
    repair: { module: repairModule, maxRounds: 2, options: { mode: 'tests' } } });
  assert.equal(edited.promoted, false);
  assert.equal(edited.status, 'inconclusive');
  const spin = await task(pool, join(root, 'spin'));
  const lost = await evaluateAndCommit(pool, { ...spin, candidate: { ...spin.candidate, files: { ...spin.candidate.files, ...wrong } },
    repair: { module: repairModule, maxRounds: 2, options: { mode: 'spin' } } });
  assert.equal(lost.promoted, false);
  assert.equal(lost.status, 'inconclusive');
  const again = await task(pool, join(root, 'after-spin'));
  assert.equal((await evaluateAndCommit(pool, again)).promoted, true);
});

test('generator repair uses a check round in the cell and no compiler process', { timeout: 30000 }, async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const { ENDOFORGE_ASC_CMD: _, ...env } = isolated(root);
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'addition'), pool,
    env: { ...env, ENDOFORGE_SELF_CHECK: '1', FAKE_CODEX_MODE: 'repair' } });
  assert.equal(result.promoted, true, JSON.stringify(result));
});

test('one admission serves many candidates and each commits once, batched into one chain', { timeout: 60000 }, async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1, size: 4 });
  t.after(() => pool.close());
  const original = pool.ledger.request.bind(pool.ledger), seen = [];
  pool.ledger.request = (action, ...rest) => { seen.push(action); return original(action, ...rest); };
  const { admission, candidate, reference } = await task(pool, join(root, 'addition'));
  const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => evaluateAndCommit(pool, {
    candidate: { ...candidate, files: { ...candidate.files, 'kernel.ts': `${candidate.files['kernel.ts']}\n// variant ${i}` } }, reference, admission,
    decisionPath: join(root, 'addition', `promotion-${i}.json`), receiptId: `receipt-${i}` })));
  assert(outcomes.every(outcome => outcome.promoted));
  assert.deepEqual(seen.sort(), ['admit', ...Array(8).fill('commit')]);
  const stored = await records(reference.ledger);
  assert.equal(stored.filter(record => record.kind === 'receipt').length, 8);
  for (const outcome of outcomes) {
    const replay = await ledger('promote', { reference, candidate: outcome.candidate, receipt: outcome.receipt, decisionPath: join(root, `replay-${outcome.candidate}.json`) });
    assert.equal(replay.decision, 'promote');
  }
});

test('a lost cell leaves an inconclusive receipt and no promotion', { timeout: 30000 }, async t => {
  const root = scratch(t);
  process.env.EF_KILL_STAGE = 'compile:read';
  const pool = createLoopPool({ primes: 0, isolation: 'process', hostPort: stagePort });
  await pool.ready();
  delete process.env.EF_KILL_STAGE;
  t.after(() => pool.close());
  const directory = join(root, 'addition');
  const result = await runNeed({ need: 'integer add(a,b)', directory, pool, env: needEnv(isolated(root), good) });
  assert.equal(result.promoted, false);
  assert.equal((await gateVector(directory)).outcome, 'inconclusive');
});

test('reference evaluation keeps its process: a vm context in a cell does not hold the same boundary', async () => {
  const escape = "function probe() { const p = Math.constructor.constructor('return process')(); return p.getBuiltinModule('node:fs').readFileSync(p.execPath).length > 0 ? 1 : 0; }";
  const inCell = await new Promise((resolve, reject) => {
    const worker = new Worker(`
const vm = require('node:vm'), { parentPort, workerData } = require('node:worker_threads');
const context = vm.createContext({ Math, Number, Array, Object, JSON, Error, RangeError, TypeError, isFinite, isNaN });
vm.runInContext(workerData, context, { timeout: 2000 });
try { parentPort.postMessage({ value: context.probe() }); } catch (error) { parentPort.postMessage({ error: String(error.code || error) }); }
`, { eval: true, workerData: escape });
    worker.once('message', message => { worker.terminate(); resolve(message); });
    worker.once('error', reject);
  });
  assert.deepEqual(inCell, { value: 1 });
  const [separate] = await evaluateReference(escape, [{ fn: 'probe', args: [] }]);
  assert.match(separate.error ?? '', /ERR_ACCESS_DENIED|denied|not permitted|Access/i, JSON.stringify(separate));
});

test('ASC_PATH resolves to the pinned install', () => assert.ok(readFileSync(ASC_PATH).length > 0));
