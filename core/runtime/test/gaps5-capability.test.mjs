import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { capabilityFromContract, capabilityFromGlue } from '../../library/key.mjs';
import { openLibrary } from '../../library/library.mjs';
import { IsolatePool } from '../isolate-pool.mjs';
import { specificationProblems, stagePrompts } from '../x1/agent.mjs';
import { capabilityBlock, capabilityProblems, capabilityRule, generate } from '../x1/generator.mjs';
import { createLoopPool } from '../x1/loop.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider } from '../x1/transports.mjs';
import { candidate } from './fixtures/x1/candidate.mjs';
import { inputFor, modelFor } from './fixtures/x1/scripted-model.mjs';
import { good } from './fixtures/x1/seeds.mjs';

const fixture = name => fileURLToPath(new URL(`./fixtures/x1/${name}`, import.meta.url));
const host = fileURLToPath(new URL('../x1/host.mjs', import.meta.url));
const { files } = candidate();
const fence = '```';
const declared = capabilityFromGlue(JSON.parse(files['glue.json']));
const block = value => `${fence}capability\n${JSON.stringify(value, null, 2)}\n${fence}\n`;
const withBlock = value => `Sum of two integers, each on [-10,10].\n${block(value)}`;
const tests = JSON.parse(files['tests.json']);
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-gaps5-capability-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const codexEnv = (root, over = {}) => ({ ...process.env, CODEX_HOME: join(root, 'home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_LOOP: 'current',
  ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fixture('fake-codex.mjs')]), ENDOFORGE_ASC_CMD: fixture('fake-asc.mjs'), ...over });
const watched = library => {
  const outcomes = [];
  return { outcomes, serve: async (need, options) => { const outcome = await library.serve(need, options); outcomes.push({ need, outcome }); return outcome; } };
};
async function promotedLibrary(t, root) {
  const pool = new IsolatePool({ hostPort: host, size: 1, isolation: 'thread' });
  const directory = join(root, 'source');
  try {
    const source = await runNeed({ need: 'integer add(a,b)', directory, pool, env: codexEnv(root) });
    assert.equal(source.promoted, true, JSON.stringify(source));
  } finally { await pool.close(); }
  const library = await openLibrary({ journal: join(root, 'library.jsonl') });
  t.after(() => library.close());
  const [admitted] = await library.admit([{ ledger: join(directory, 'ledger.sqlite'), promotion: join(directory, 'promotion.json') }]);
  assert.equal(admitted.admitted, true, JSON.stringify(admitted));
  return { library, admitted };
}

test('P1: both specification prompts ask for the capability block with exports, kinds, units, ranges and traps', async t => {
  for (const word of [`${fence}capability`, 'exports', 'kind', 'unit', 'range', 'traps', 'precision']) assert.ok(capabilityRule.includes(word), word);
  const agentPrompt = JSON.parse(stagePrompts.specification({ need: 'integer add(a,b)', id: 'n' }));
  assert.ok(agentPrompt.instructions.includes(capabilityRule));
  assert.ok(JSON.parse(stagePrompts.specification({ need: 'n', id: 'n', oracle: true })).instructions.includes(capabilityRule));
  assert.match(JSON.parse(stagePrompts.implementation({ id: 'n' })).instructions, /capability block in CONTRACT\.md/);
  const root = scratch(t), record = join(root, 'record');
  await assert.rejects(generate({ need: 'integer add(a,b)', directory: join(root, 'spec'), env: codexEnv(root, { FAKE_CODEX_RECORD: record }), freeze: () => { throw Error('stop after the prompt'); } }), /stop after the prompt/);
  const codexPrompt = JSON.parse(readFileSync(`${record}.specification.json`, 'utf8'));
  assert.ok(codexPrompt.instructions.includes(capabilityRule));
});

test('P1: the block the prompts ask for is the block library lookup reads', () => {
  const contract = withBlock(declared);
  assert.deepEqual(capabilityBlock(contract).block, capabilityFromContract(contract));
  assert.deepEqual(capabilityProblems(contract, tests), []);
  assert.deepEqual(specificationProblems({ 'CONTRACT.md': contract, 'tests.json': files['tests.json'] }), null);
});

test('P1: the freeze refuses a capability block that is malformed or disagrees with the frozen tests', async t => {
  const cases = {
    'not JSON': `Sum.\n${fence}capability\n{exports:\n${fence}\n`,
    'no exports': withBlock({ exports: [], traps: [] }),
    'an unknown kind': withBlock({ exports: [{ ...declared.exports[0], result: { kind: 'float', unit: '1' } }], traps: [] }),
    'a missing unit': withBlock({ exports: [{ ...declared.exports[0], args: [{ name: 'a', kind: 'integer' }, { name: 'b', kind: 'integer', unit: '1' }] }], traps: [] }),
    'a number result without precision': withBlock({ exports: [{ ...declared.exports[0], result: { kind: 'number', unit: '1' } }], traps: [] }),
    'a tested function it does not export': withBlock({ exports: [{ ...declared.exports[0], name: 'sum' }], traps: [] }),
    'an argument count that differs from the tests': withBlock({ exports: [{ ...declared.exports[0], args: declared.exports[0].args.slice(0, 1) }], traps: [] }),
    'a trap naming no export': withBlock({ ...declared, traps: ['other'] }),
  };
  for (const [label, contract] of Object.entries(cases)) {
    assert.ok(capabilityProblems(contract, tests).length, label);
    assert.ok(specificationProblems({ 'CONTRACT.md': contract, 'tests.json': files['tests.json'] })?.problems.length, label);
  }
  const trapping = JSON.stringify([...tests, { name: 'high', fn: 'add', args: [11, 0], expectError: true }]);
  assert.match(capabilityProblems(withBlock(declared), JSON.parse(trapping)).join(), /traps must list add/);
  assert.deepEqual(capabilityProblems(withBlock({ ...declared, traps: ['add'] }), JSON.parse(trapping)), []);
  assert.match(capabilityProblems('Sum of two integers.', tests).join(), /no .*capability block/);
  const root = scratch(t);
  for (const [label, contract] of Object.entries(cases)) {
    let froze = false;
    await assert.rejects(generate({ need: 'integer add(a,b)', directory: join(root, label.replace(/\W+/g, '-')), env: codexEnv(root, { FAKE_CODEX_CONTRACT: contract }), freeze: () => { froze = true; throw Error('froze'); } }),
      /capability block refused at the freeze/, label);
    assert.equal(froze, false, label);
  }
});

test('P1: a generated need hits a promoted capability through library lookup on the current path', { timeout: 120000 }, async t => {
  const root = scratch(t), { library, admitted } = await promotedLibrary(t, root);
  const pool = new IsolatePool({ hostPort: host, size: 1, isolation: 'thread' });
  t.after(() => pool.close());
  const missed = watched(library);
  const blockless = 'Sum of two integers, each on [-10,10].';
  assert.match(capabilityProblems(blockless, tests).join(), /no .*capability block/);
  const before = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'without'), pool, env: codexEnv(root, { FAKE_CODEX_CONTRACT: blockless }), library: missed });
  assert.equal(before.promoted, false, JSON.stringify(before));
  assert.equal(before.reused, undefined);
  assert.deepEqual(missed.outcomes, []);
  assert.throws(() => readFileSync(join(root, 'without', 'candidate', 'frozen.sha256')));
  const served = watched(library), record = join(root, 'hit');
  const hit = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'with'), pool, env: codexEnv(root, { FAKE_CODEX_CONTRACT: withBlock(declared), FAKE_CODEX_RECORD: record }), library: served });
  assert.equal(served.outcomes.length, 1);
  const { need, outcome } = served.outcomes[0];
  assert.equal(need.capability, undefined);
  assert.deepEqual(capabilityFromContract(need.files['CONTRACT.md']), declared);
  assert.equal(outcome.verdict, 'pass', JSON.stringify(outcome));
  assert.equal(outcome.receipt.source.candidate, admitted.id);
  assert.equal(hit.promoted, true, JSON.stringify(hit));
  assert.equal(hit.reused.kind, 'library_reuse');
  assert.throws(() => readFileSync(`${record}.implementation.json`));
});

test('P1: a generated need hits a promoted capability through library lookup on the agent path', { timeout: 120000 }, async t => {
  const root = scratch(t), { library, admitted } = await promotedLibrary(t, root);
  const run = async (name, contract) => {
    const stages = [];
    const pool = createLoopPool({ primes: 1, provider: scriptedProvider(({ messages, ...rest }) => { stages.push(JSON.parse(messages.find(m => m.role === 'user').content).stage); return modelFor(inputFor(contract, files['tests.json'], good.kernel, good.glue))({ messages, ...rest }); }) });
    t.after(() => pool.close());
    const served = watched(library);
    const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, name), pool, env: { ENDOFORGE_LOOP: 'agent' }, library: served });
    return { result, served, stages };
  };
  const before = await run('without', 'Sum of two integers, each on [-10,10].');
  assert.equal(before.result.promoted, false, JSON.stringify(before.result));
  assert.equal(before.result.reused, undefined);
  assert.deepEqual(before.served.outcomes, []);
  assert.ok(before.stages.every(stage => stage === 'specification'), JSON.stringify(before.stages));
  const after = await run('with', withBlock(declared));
  assert.equal(after.served.outcomes.length, 1);
  const { need, outcome } = after.served.outcomes[0];
  assert.equal(need.capability, undefined);
  assert.deepEqual(capabilityFromContract(need.files['CONTRACT.md']), declared);
  assert.equal(outcome.verdict, 'pass', JSON.stringify(outcome));
  assert.equal(outcome.receipt.source.candidate, admitted.id);
  assert.equal(after.result.promoted, true, JSON.stringify(after.result));
  assert.equal(after.result.reused.kind, 'library_reuse');
  assert.ok(!after.stages.includes('implementation'), JSON.stringify(after.stages));
});
