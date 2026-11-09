import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { canonical, capabilityFromGlue, signatures } from '../../library/key.mjs';
import { IsolatePool } from '../isolate-pool.mjs';
import { specificationProblems } from '../x1/agent.mjs';
import { capabilityAgreement } from '../x1/contract.mjs';
import { runGates } from '../x1/gates.mjs';
import { capabilityProblems, generate } from '../x1/generator.mjs';
import { hash } from '../x1/host.mjs';
import { createLoopPool } from '../x1/loop.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider } from '../x1/transports.mjs';
import { candidate } from './fixtures/x1/candidate.mjs';
import { inputFor, modelFor } from './fixtures/x1/scripted-model.mjs';
import { good } from './fixtures/x1/seeds.mjs';

const fixture = name => fileURLToPath(new URL(`./fixtures/x1/${name}`, import.meta.url));
const host = fileURLToPath(new URL('../x1/host.mjs', import.meta.url));
const fence = '```';
const { files } = candidate();
const tests = JSON.parse(files['tests.json']);
const glue = JSON.parse(files['glue.json']);
const declared = capabilityFromGlue(glue);
const blockless = 'Sum of two integers, each on [-10,10].';
const withBlock = value => `${blockless}\n${fence}capability\n${JSON.stringify(value, null, 2)}\n${fence}\n`;
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-gaps6-capability-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const codexEnv = (root, over = {}) => ({ ...process.env, CODEX_HOME: join(root, 'home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_LOOP: 'current',
  ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fixture('fake-codex.mjs')]), ENDOFORGE_ASC_CMD: fixture('fake-asc.mjs'), ...over });
const gated = (contract, glueValue) => {
  const next = { ...files, 'CONTRACT.md': contract, 'glue.json': JSON.stringify(glueValue) };
  next['frozen.sha256'] = JSON.stringify({ contract: hash(next['CONTRACT.md']), tests: hash(next['tests.json']) });
  return runGates({ ...candidate(), files: next });
};
const variant = (change, base = declared) => { const value = structuredClone(base); change(value); return value; };
const librarySame = (block, glueValue) => {
  const named = capability => Object.fromEntries(signatures(capability).map(item => [item.name, item.text]));
  return canonical(named(block)) === canonical(named(capabilityFromGlue(glueValue)));
};

test('M1: the shared check refuses a contract with no capability block, and nothing lets a caller skip it', () => {
  assert.match(capabilityProblems(blockless, tests).join(), /no .*capability block/);
  assert.match(capabilityProblems(blockless, tests, { required: false }).join(), /no .*capability block/);
  assert.match(specificationProblems({ 'CONTRACT.md': blockless, 'tests.json': files['tests.json'] })?.problems.join() ?? '', /no .*capability block/);
  assert.match(specificationProblems({ 'CONTRACT.md': blockless, 'tests.json': files['tests.json'] }, { oracle: true })?.problems.join() ?? '', /no .*capability block/);
  assert.equal(specificationProblems({ 'CONTRACT.md': withBlock(declared), 'tests.json': files['tests.json'] }), null);
});

test('M1: the current path refuses to freeze a contract with no capability block', async t => {
  const root = scratch(t);
  let froze = false;
  await assert.rejects(generate({ need: 'integer add(a,b)', directory: join(root, 'spec'), env: codexEnv(root, { FAKE_CODEX_CONTRACT: blockless }), freeze: () => { froze = true; throw Error('froze'); } }),
    /capability block refused at the freeze: CONTRACT.md has no .*capability block/);
  assert.equal(froze, false);
  assert.equal(existsSync(join(root, 'spec', 'candidate', 'frozen.sha256')), false);
  const pool = new IsolatePool({ hostPort: host, size: 1, isolation: 'thread' });
  t.after(() => pool.close());
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'run'), pool, env: codexEnv(root, { FAKE_CODEX_CONTRACT: blockless }) });
  assert.equal(result.promoted, false);
  assert.equal(existsSync(join(root, 'run', 'ledger.sqlite')), false);
  assert.equal(existsSync(join(root, 'run', 'promotion.json')), false);
});

test('M1: the isolate path refuses to freeze a contract with no capability block', { timeout: 120000 }, async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'run'), pool, env: codexEnv(root, { ENDOFORGE_LOOP: 'isolate', FAKE_CODEX_CONTRACT: blockless }) });
  assert.equal(result.promoted, false);
  assert.equal(existsSync(join(root, 'run', 'candidate', 'frozen.sha256')), false);
  assert.equal(existsSync(join(root, 'run', 'promotion.json')), false);
});

test('M1: the agent path never freezes a contract with no capability block and tells the model why', { timeout: 120000 }, async t => {
  const root = scratch(t), stages = [], told = [];
  const pool = createLoopPool({ primes: 1, provider: scriptedProvider(({ messages, ...rest }) => {
    stages.push(JSON.parse(messages.find(m => m.role === 'user').content).stage);
    told.push(...messages.filter(m => m.role === 'user').map(m => m.content));
    return modelFor(inputFor(blockless, files['tests.json'], good.kernel, good.glue))({ messages, ...rest });
  }) });
  t.after(() => pool.close());
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'run'), pool, env: { ENDOFORGE_LOOP: 'agent' } });
  assert.equal(result.promoted, false, JSON.stringify(result));
  assert.ok(stages.length > 0);
  assert.ok(stages.every(stage => stage === 'specification'), JSON.stringify(stages));
  assert.ok(told.some(text => /no .*capability block/.test(text)), 'the specification check names the missing block');
  assert.equal(existsSync(join(root, 'run', 'promotion.json')), false);
});

test('M1: every path freezes and promotes a contract that carries an agreeing capability block', { timeout: 180000 }, async t => {
  const root = scratch(t), contract = withBlock(declared);
  const current = new IsolatePool({ hostPort: host, size: 1, isolation: 'thread' }), loop = createLoopPool({ primes: 1 });
  const agent = createLoopPool({ primes: 1, provider: scriptedProvider(modelFor(inputFor(contract, files['tests.json'], good.kernel, good.glue))) });
  t.after(() => Promise.all([current.close(), loop.close(), agent.close()]));
  const runs = {
    current: await runNeed({ need: 'integer add(a,b)', directory: join(root, 'current'), pool: current, env: codexEnv(root, { FAKE_CODEX_CONTRACT: contract }) }),
    isolate: await runNeed({ need: 'integer add(a,b)', directory: join(root, 'isolate'), pool: loop, env: codexEnv(root, { ENDOFORGE_LOOP: 'isolate', FAKE_CODEX_CONTRACT: contract }) }),
    agent: await runNeed({ need: 'integer add(a,b)', directory: join(root, 'agent'), pool: agent, env: { ENDOFORGE_LOOP: 'agent' } }),
  };
  for (const [path, result] of Object.entries(runs)) assert.equal(result.promoted, true, `${path}: ${JSON.stringify(result)}`);
});

test('M1: G7 refuses glue.json that disagrees with the frozen capability block', () => {
  const agreeing = gated(withBlock(declared), glue);
  assert.equal(agreeing.gates.G7_glue.ok, true, JSON.stringify(agreeing.gates.G7_glue));
  assert.equal(agreeing.promotable, true);
  const missing = gated(blockless, glue);
  assert.equal(missing.gates.G7_glue.ok, false);
  assert.match(missing.gates.G7_glue.why, /no .*capability block/);
  assert.equal(missing.promotable, false);
  const cases = {
    unit: [variant(v => { v.exports[0].args[0].unit = 'm'; }), /add argument 1 \(a\) unit: the capability block says "m", glue.json says "1"/],
    kind: [variant(v => { v.exports[0].result = { kind: 'number', unit: '1', precision: 2 }; }), /add result kind: the capability block says "number", glue.json says "integer"/],
    range: [variant(v => { v.exports[0].args[1].range = '-10..10'; }), /add argument 2 \(b\) range: the capability block says "-10..10", glue.json says nothing/],
    precision: [variant(v => { v.exports[0].result.precision = 0; }), /add result precision/],
    trap: [variant(v => { v.traps = ['add']; }), /capability block lists add as trapping, and glue.json has no trap for it/],
    'argument count': [variant(v => { v.exports[0].args.pop(); }), /add: the capability block declares 1 arguments, glue.json 2/],
    'a missing export': [variant(v => { v.exports.push({ ...v.exports[0], name: 'sub' }); }), /capability block exports sub, which glue.json does not describe/],
    'a different export': [variant(v => { v.exports[0].name = 'sum'; }), /glue.json describes add, which the capability block does not export/],
  };
  for (const [label, [block, why]] of Object.entries(cases)) {
    const result = gated(withBlock(block), glue);
    assert.equal(result.gates.G7_glue.ok, false, label);
    assert.match(result.gates.G7_glue.why, why, label);
    assert.equal(result.promotable, false, label);
  }
  const trapping = gated(withBlock(variant(v => { v.traps = []; })), { ...glue, traps: [{ fn: 'add', when: 'never', message: 'Out of range.' }] });
  assert.match(trapping.gates.G7_glue.why, /glue.json has a trap for add, which the capability block does not list as trapping/);
});

test('M1: the gate agrees with library lookup on what counts as the same capability', () => {
  const glueWith = change => variant(change, glue);
  const pairs = [
    [declared, glue],
    [variant(v => { v.exports[0].args[0].unit = 'dimensionless'; }), glue],
    [variant(v => { v.exports[0].args[0].unit = ' None '; }), glue],
    [variant(v => { v.exports[0].args[0].range = '[-10, 10]'; }), glueWith(g => { g.exports[0].args[0].range = '-10..10'; })],
    [variant(v => { v.exports[0].args[0].range = '0..5'; }), glueWith(g => { g.exports[0].args[0].range = '0..6'; })],
    [variant(v => { v.exports[0].args[0].unit = 'm'; }), glue],
    [variant(v => { v.exports[0].result.kind = 'code'; v.exports[0].result.codes = { 0: 'Low', 1: 'High' }; }), glueWith(g => { g.exports[0].result.kind = 'code'; g.exports[0].result.codes = { 1: 'high', 0: ' low ' }; })],
    [variant(v => { v.exports[0].result.kind = 'code'; v.exports[0].result.codes = { 0: 'Low', 1: 'High' }; }), glueWith(g => { g.exports[0].result.kind = 'code'; g.exports[0].result.codes = { 0: 'High', 1: 'Low' }; })],
    [variant(v => { v.traps = ['add']; }), glueWith(g => { g.traps = [{ fn: 'add', when: 'a is out of range', message: 'Out of range.' }]; })],
    [variant(v => { v.traps = ['add']; }), glue],
  ];
  for (const [index, [block, glueValue]] of pairs.entries()) {
    const problems = capabilityAgreement(block, glueValue);
    assert.equal(problems.length === 0, librarySame(block, glueValue), `pair ${index}: ${problems.join('; ')}`);
  }
});

test('M1: on the current path, a model whose glue.json departs from its frozen block is refused at G7', { timeout: 120000 }, async t => {
  const root = scratch(t), pool = new IsolatePool({ hostPort: host, size: 1, isolation: 'thread' });
  t.after(() => pool.close());
  const drifted = JSON.stringify(variant(g => { g.exports[0].result.unit = 'USD'; }, glue));
  const directory = join(root, 'run');
  const result = await runNeed({ need: 'integer add(a,b)', directory, pool, env: codexEnv(root, { FAKE_CODEX_CONTRACT: withBlock(declared), FAKE_CODEX_GLUE: drifted }) });
  assert.equal(result.promoted, false, JSON.stringify(result));
  assert.equal(JSON.parse(readFileSync(join(directory, 'promotion.json'), 'utf8')).decision, 'refuse');
});
