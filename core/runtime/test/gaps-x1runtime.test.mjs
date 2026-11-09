import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { frozenHolds } from '../../library/library.mjs';
import { runGates } from '../x1/gates.mjs';
import { configuration, hash, implementationFiles as hostFiles } from '../x1/host.mjs';
import { admit, agentLimits, commitCandidate, createLoopPool, evaluateAndCommit, evaluateInCell, implementation as isolateFiles } from '../x1/loop.mjs';
import { implementationFiles as cellFiles } from '../x1/loop-port.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider } from '../x1/transports.mjs';
import { candidate as additionCandidate } from './fixtures/x1/candidate.mjs';
import { idOf, implementation, inputFor, modelFor, reply, specification, stageOf } from './fixtures/x1/scripted-model.mjs';
import { good, seeds } from './fixtures/x1/seeds.mjs';
import { python } from './fixtures/ledger-fixture.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const x1Directory = here('../x1/');
const fixtures = here('./fixtures/x1/');
const need = 'integer add(a,b)';
const { files } = additionCandidate();
const input = seed => inputFor(files['CONTRACT.md'], files['tests.json'], seed.kernel, seed.glue);
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-gaps-x1-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const codexEnv = root => ({ ...process.env, CODEX_HOME: join(root, 'unused-home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_LOOP: 'isolate',
  ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, join(fixtures, 'fake-codex.mjs')]), FAKE_CODEX_KERNEL: good.kernel, FAKE_CODEX_GLUE: good.glue });
const records = ledgerPath => python(`
import json, sys
from core.ledger.ledger import Ledger
print(json.dumps(Ledger(json.load(sys.stdin)['ledger']).records()))
`, { ledger: ledgerPath });
const frozenBundle = async ledgerPath => JSON.parse((await records(ledgerPath)).find(record => record.kind === 'frozen_evaluator').data.content);
const synthReply = (path, value) => ({ text: JSON.stringify({ calls: [{ name: 'edit_file', path, content: JSON.stringify(value) }, { name: 'done' }] }), usage: 1 });
const synthProvider = reference => scriptedProvider(({ session, messages }) => {
  if (session.startsWith('need')) return synthReply('sheet.json', { residual: ['Adds two integers.'], quantities: [], relations: [], invariants: [] });
  assert.ok(!messages[0].content.includes('kernel.ts'), 'the binding step must not see an implementation');
  return synthReply('binding.json', { exports: [{ name: 'add', params: ['a', 'b'].map(name => ({ name, unit: '1', min: -10, max: 10, integer: true })), result: { kind: 'number', unit: '1' } }], reference });
});
const honestReference = 'function add(a, b) { return a + b; }';
const wrongReference = 'function add(a, b) { return a > 5 ? a + b + 1 : a + b; }';
const libraryDouble = verdict => {
  const seen = [];
  return { seen, async serve(asked) { seen.push(asked); return verdict === 'pass' ? { verdict: 'pass', receipt: { kind: 'library_reuse', need: { id: asked.id } }, hash: 'f'.repeat(64) } : { verdict: 'miss', reason: 'no_contract_match' }; } };
};

function localImports(name, seen = new Set()) {
  if (seen.has(name)) return seen;
  seen.add(name);
  if (!name.endsWith('.mjs')) return seen;
  const text = readFileSync(join(x1Directory, name), 'utf8');
  for (const [, target] of text.matchAll(/(?:from\s+|new URL\()'\.\/([^'/]+)'/g)) localImports(target, seen);
  return seen;
}

test('G11: every x1 file the host and the cell import is in the frozen implementation lists', () => {
  for (const name of localImports('host.mjs')) assert.ok(hostFiles.includes(name), `host list misses ${name}`);
  for (const name of localImports('loop-port.mjs')) assert.ok(cellFiles.includes(name), `cell list misses ${name}`);
  for (const name of ['dimensions.mjs', 'generator.mjs']) assert.ok(cellFiles.includes(name), name);
  assert.deepEqual([...hostFiles, ...isolateFiles].sort(), [...cellFiles].sort());
});

test('G11: a frozen tree whose dimensions.mjs or generator.mjs differs from the running code never passes', async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  for (const drifted of ['dimensions.mjs', 'generator.mjs']) {
    const directory = join(root, drifted.replace('.mjs', '')), oracle = join(directory, 'oracle');
    mkdirSync(oracle, { recursive: true });
    for (const name of ['CONTRACT.md', 'tests.json', 'frozen.sha256']) writeFileSync(join(oracle, name), files[name]);
    for (const name of cellFiles) writeFileSync(join(oracle, name), readFileSync(join(x1Directory, name)));
    writeFileSync(join(oracle, drifted), `${readFileSync(join(x1Directory, drifted))}\n`);
    const reference = { ledger: join(directory, 'ledger.sqlite'), root: oracle };
    const admission = await admit(pool, reference, { need, configuration });
    reference.identity = admission.identity;
    const glue = JSON.parse(files['glue.json']); glue.id = drifted.replace('.mjs', '');
    const outcome = await evaluateAndCommit(pool, { candidate: { id: glue.id, files: { ...files, 'glue.json': JSON.stringify(glue) } }, reference, admission, decisionPath: join(directory, 'promotion.json') });
    assert.equal(outcome.promoted, false, drifted);
    assert.equal(outcome.status, 'inconclusive', drifted);
  }
});

async function honestTask(pool, directory) {
  const oracle = join(directory, 'oracle');
  mkdirSync(oracle, { recursive: true });
  for (const name of ['CONTRACT.md', 'tests.json', 'frozen.sha256']) writeFileSync(join(oracle, name), files[name]);
  for (const name of cellFiles) writeFileSync(join(oracle, name), readFileSync(join(x1Directory, name)));
  const reference = { ledger: join(directory, 'ledger.sqlite'), root: oracle };
  const admission = await admit(pool, reference, { need, configuration });
  reference.identity = admission.identity;
  const glue = JSON.parse(files['glue.json']); glue.id = 'addition';
  return { reference, admission, candidate: { id: 'addition', files: { ...files, 'glue.json': JSON.stringify(glue) } }, decisionPath: join(directory, 'promotion.json') };
}

test('G13: commit re-runs the kernel itself, so a consistent wrong cell report cannot promote', async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const { admission, candidate, reference, decisionPath } = await honestTask(pool, join(root, 'addition'));
  const evaluated = await evaluateInCell(pool, { candidate, admission });
  const content = JSON.parse(evaluated.content), glue = JSON.parse(content.files['glue.json']);
  glue.exports[0].result = { kind: 'boolean', unit: '1' };
  content.files['glue.json'] = JSON.stringify(glue);
  assert.equal(runGates(content).promotable, false);
  evaluated.content = JSON.stringify(content);
  const identity = hash(evaluated.content);
  for (const attempt of evaluated.observed.report.attempts) attempt.candidate = identity;
  evaluated.observed.report.frontier = [identity];
  evaluated.sources = null;
  const outcome = await commitCandidate(pool, { evaluated, reference, digest: admission.digest, decisionPath });
  assert.equal(outcome.promoted, false);
  assert.equal(JSON.parse(readFileSync(decisionPath)).decision, 'refuse');
  assert.match(outcome.problem, /independent re-run/);
  assert.equal(outcome.rerun.agrees, false);
  const honest = await honestTask(pool, join(root, 'honest'));
  const kept = await commitCandidate(pool, { evaluated: await evaluateInCell(pool, { candidate: honest.candidate, admission: honest.admission }), reference: honest.reference, digest: honest.admission.digest, decisionPath: honest.decisionPath });
  assert.equal(kept.promoted, true, JSON.stringify(kept.problem));
  assert.equal(kept.rerun.agrees, true);
  assert.ok(kept.rerun.ms >= 0);
});

test('G1: the isolate path consults the library after the freeze and skips implementation on a pass', async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const library = libraryDouble('pass'), record = join(root, 'hit');
  const hit = await runNeed({ need, directory: join(root, 'addition'), pool, env: { ...codexEnv(root), FAKE_CODEX_RECORD: record }, library });
  assert.equal(hit.promoted, true, JSON.stringify(hit));
  assert.equal(hit.reused.kind, 'library_reuse');
  assert.equal(hit.decision, 'f'.repeat(64));
  assert.equal(library.seen.length, 1);
  assert.ok(frozenHolds(library.seen[0].files));
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith('hit.')), ['hit.specification.json']);
  const missed = libraryDouble('miss');
  const miss = await runNeed({ need, directory: join(root, 'miss'), pool, env: codexEnv(root), library: missed });
  assert.equal(miss.promoted, true, JSON.stringify(miss));
  assert.equal(miss.reused, undefined);
  assert.equal(missed.seen.length, 1);
});

test('G1: the agent path consults the library after admission and skips the implementation stage on a pass', { timeout: 30000 }, async t => {
  const root = scratch(t);
  for (const waits of ['release', 'hold']) {
    const stages = [];
    const pool = createLoopPool({ primes: 1, waits, provider: scriptedProvider(({ messages, ...rest }) => { stages.push(stageOf(messages)); return modelFor(input(good))({ messages, ...rest }); }) });
    t.after(() => pool.close());
    const library = libraryDouble('pass'), directory = join(root, `hit-${waits}`);
    const hit = await runNeed({ need, directory, pool, env: { ENDOFORGE_LOOP: 'agent' }, library });
    assert.equal(hit.promoted, true, JSON.stringify(hit));
    assert.equal(hit.reused.kind, 'library_reuse');
    assert.deepEqual(stages, ['specification'], waits);
    assert.equal(library.seen.length, 1);
    assert.equal(library.seen[0].id, `hit-${waits}`);
    assert.ok(frozenHolds(library.seen[0].files));
    assert.deepEqual((await records(join(directory, 'ledger.sqlite'))).map(record => record.kind), ['task', 'admitted_input', 'frozen_evaluator']);
    const missed = libraryDouble('miss');
    const miss = await runNeed({ need, directory: join(root, `miss-${waits}`), pool, env: { ENDOFORGE_LOOP: 'agent' }, library: missed });
    assert.equal(miss.promoted, true, JSON.stringify(miss));
    assert.equal(miss.reused, undefined);
    assert.equal(missed.seen.length, 1);
  }
});

test('G2: the isolate path freezes a synthesized evaluator before code and refuses what it refuses', { timeout: 60000 }, async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const env = { ...codexEnv(root), ENDOFORGE_SYNTH: '1' };
  const directory = join(root, 'honest');
  const passed = await runNeed({ need, directory, pool, env, synthProvider: synthProvider(honestReference) });
  assert.equal(passed.promoted, true, JSON.stringify(passed));
  assert.equal(passed.synthesis.decision, 'pass');
  assert.ok(passed.synthesis.vectors > 10);
  assert.ok((await frozenBundle(join(directory, 'ledger.sqlite'))).files['synth/evaluator.json']);
  assert.equal(JSON.parse(readFileSync(join(directory, 'synthesis.json'))).decision, 'pass');
  const refusedAt = join(root, 'wrong');
  const refused = await runNeed({ need, directory: refusedAt, pool, env, synthProvider: synthProvider(wrongReference) });
  assert.equal(refused.promoted, false);
  assert.equal(refused.synthesis.decision, 'refuse');
  assert.ok(refused.synthesis.failures.some(failure => failure.startsWith('value.reference')));
  assert.equal((await records(join(refusedAt, 'ledger.sqlite'))).find(record => record.kind === 'receipt').data.outcome_state, 'failed');
  const off = await runNeed({ need, directory: join(root, 'off'), pool, env: codexEnv(root), synthProvider: synthProvider(wrongReference) });
  assert.equal(off.promoted, true);
  assert.equal(off.synthesis, undefined);
});

test('G2: the agent path freezes a synthesized evaluator in the ledger before implementation and judges at commit', { timeout: 60000 }, async t => {
  const root = scratch(t);
  const pool = createLoopPool({ primes: 1, provider: scriptedProvider(modelFor(input(good))) });
  t.after(() => pool.close());
  const env = { ENDOFORGE_LOOP: 'agent', ENDOFORGE_SYNTH: '1' };
  const directory = join(root, 'honest');
  const passed = await runNeed({ need, directory, pool, env, synthProvider: synthProvider(honestReference) });
  assert.equal(passed.promoted, true, JSON.stringify(passed));
  assert.equal(passed.synthesis.decision, 'pass');
  assert.ok(JSON.parse(Buffer.from((await frozenBundle(join(directory, 'ledger.sqlite'))).files['synth/evaluator.json'], 'hex').toString()).checks.vectors.length > 10);
  assert.deepEqual(readdirSync(directory).filter(name => !name.startsWith('ledger.sqlite')), []);
  const refusedAt = join(root, 'wrong');
  const refused = await runNeed({ need, directory: refusedAt, pool, env, synthProvider: synthProvider(wrongReference) });
  assert.equal(refused.promoted, false);
  assert.equal(refused.synthesis.decision, 'refuse');
  assert.equal((await records(join(refusedAt, 'ledger.sqlite'))).find(record => record.kind === 'receipt').data.outcome_state, 'failed');
  const off = await runNeed({ need, directory: join(root, 'off'), pool, env: { ENDOFORGE_LOOP: 'agent' }, synthProvider: synthProvider(wrongReference) });
  assert.equal(off.promoted, true);
  assert.equal(off.synthesis, undefined);
});

test('G14: the agent token budget applies to each stage, in both wait modes', { timeout: 60000 }, async t => {
  const root = scratch(t);
  assert.deepEqual(agentLimits, { maxTurns: 6, maxTokens: 64000 });
  for (const waits of ['release', 'hold']) {
    const pool = createLoopPool({ primes: 1, waits, provider: scriptedProvider(modelFor(input(good))) });
    t.after(() => pool.close());
    const both = await runNeed({ need, directory: join(root, `both-${waits}`), pool, env: { ENDOFORGE_LOOP: 'agent' }, limits: { maxTurns: 3, maxTokens: 15 } });
    assert.equal(both.promoted, true, `${waits}: ${JSON.stringify(both)}`);
    assert.equal(both.agent.tokens, 20);
    const repairing = createLoopPool({ primes: 1, waits, provider: scriptedProvider(({ messages, turn }) => {
      if (turn === 0) return reply(specification(input(good)));
      if (turn === 1) return reply(implementation(input(seeds[1]), idOf(messages)));
      return reply(implementation(input(good), idOf(messages)));
    }) });
    t.after(() => repairing.close());
    const capped = await runNeed({ need, directory: join(root, `capped-${waits}`), pool: repairing, env: { ENDOFORGE_LOOP: 'agent' }, limits: { maxTurns: 3, maxTokens: 15 } });
    assert.equal(capped.promoted, false, waits);
    assert.ok(existsSync(join(root, `capped-${waits}`, 'ledger.sqlite')), waits);
  }
});
