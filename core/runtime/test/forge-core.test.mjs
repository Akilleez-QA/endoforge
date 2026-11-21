import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../isolate-pool.mjs';
import { forgeAddress, forgeEvidenceHash, reduceForgeResults } from '../forge-core.mjs';
import { fixture } from './fixtures/ledger-fixture.mjs';

const hostPort = fileURLToPath(new URL('./fixtures/host-call-port.mjs', import.meta.url));
const budget = (tokens = 20, verifyMs = 120000, dollars = 20) => ({ tokens, verifyMs, dollars });
const atom = (goal, inputs = {}, slice = budget(2, 10000, 2)) => ({ goal, inputs, codeVersion: 'fixture-v1', budget: slice });
const launch = children => ({ op: 'spawn', children, budget: budget(10, 60000, 10), merge: 'set-union' });
const forge = { codeVersion: 'fixture-v1', maxDepth: 2, maxFanOut: 4 };
async function setup(t, options = {}) {
  const { job } = await fixture(t);
  const executions = [];
  const pool = new IsolatePool({ hostPort, size: 4, forge, hostCost: () => budget(1, 0, 1),
    hostCalls: request => { executions.push(request); return {}; }, ...options });
  t.after(() => pool.close());
  const run = (calls, options = {}) => pool.run({ ...job(['pass'], { forgeCalls: calls, ...options }), budget: budget(), ledger: 'caller' });
  return { pool, run, executions };
}

test('Forge Core deduplicates simultaneous atoms and retries by goal inputs and code version', async t => {
  const { run, executions } = await setup(t);
  const child = atom('catalog', { value: ['alpha'], forgeCalls: [{ op: 'work' }] });
  const result = await run([launch([child, child]), launch([child])]);
  const [first, second] = result.evidence.seen;
  assert.equal(executions.length, 1);
  assert.equal(first.children[1].cacheHit, true);
  assert.equal(second.children[0].cacheHit, true);
  assert.equal(first.hash, second.hash);
  assert.deepEqual(first.value, ['alpha']);
  assert.equal(first.outcome.verdict, 'pass');
  assert.equal(first.outcome.verifyGenerateRatio, 0.1);
  assert.equal(second.outcome.verifyGenerateRatio, 0.1);
  assert.match(first.children[0].outcome.evidenceHash, /^[a-f0-9]{64}$/);
  const receipt = first.children[0];
  assert.equal(receipt.outcome.evidenceHash, forgeEvidenceHash({ address: receipt.address, value: receipt.value,
    verdict: receipt.outcome.verdict, evidence: receipt.verification }));
  assert.equal(forgeAddress(child), forgeAddress({ ...child, inputs: { forgeCalls: [{ op: 'work' }], value: ['alpha'] } }));
  assert.notEqual(forgeAddress(child), forgeAddress({ ...child, codeVersion: 'fixture-v2' }));
  assert.notEqual(forgeAddress(child), forgeAddress({ ...child, goal: 'other' }));
});

test('Forge Core reduction is associative commutative and stable over 100 shuffled arrivals', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ address: String(i), value: [i % 5], outcome: { verdict: 'pass', evidenceHash: 'a'.repeat(64), verifyCost: 1, generateCost: 10 } }));
  const expected = reduceForgeResults('set-union', rows);
  let seed = 471;
  for (let n = 0; n < 100; n++) {
    const shuffled = [...rows];
    for (let i = shuffled.length - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    assert.deepEqual(reduceForgeResults('set-union', shuffled), expected);
    const left = reduceForgeResults('set-union', shuffled.slice(0, 6));
    const right = reduceForgeResults('set-union', shuffled.slice(6));
    assert.deepEqual(reduceForgeResults('set-union', [{ address: 'left', value: left.value, outcome: left.outcome }, { address: 'right', value: right.value, outcome: right.outcome }]).value, expected.value);
  }
  assert.throws(() => reduceForgeResults('concatenate', rows), /merge/);
});

for (const isolation of ['thread', 'process']) {
  test(`Forge Core ${isolation} lost child conserves budget returns leftovers and pool recovers`, async t => {
    const { run, executions } = await setup(t, { isolation,
      hostCalls: request => { executions.push(request); if (request.op === 'kill') process.kill(request.pid, 'SIGKILL'); return {}; } });
    const calls = isolation === 'process' ? [{ op: 'kill', ownPid: true }] : [];
    const lost = atom('lost', { forgeCalls: calls, exit: isolation === 'thread' });
    const result = await run([launch([lost, atom('healthy', { value: ['ok'] })])]);
    const spawn = result.evidence.seen[0];
    assert.equal(spawn.children[0].status, 'outcome_unknown');
    assert.equal(spawn.children[1].status, 'completed');
    for (const key of ['tokens', 'verifyMs', 'dollars']) {
      assert.ok(result.forge.spent[key] <= budget()[key]);
      assert.equal(result.forge.ownSpent[key] + spawn.children.reduce((sum, child) => sum + (child.cacheHit ? 0 : child.forge.spent[key]), 0), result.forge.spent[key]);
      assert.equal(result.forge.spent[key] + result.forge.remaining[key], budget()[key]);
    }
    assert.ok(result.forge.remaining.tokens > 0);
    assert.equal((await run([])).status, 'completed');
  });
}

test('Forge Core refuses overspend malformed vectors depth width and closed launches', async t => {
  const { run, pool } = await setup(t, { forge: { ...forge, maxDepth: 1 } });
  for (const request of [
    launch(Array(5).fill(atom('wide'))),
    launch([atom('large', {}, budget(30))]),
    { ...launch([atom('bad')]), budget: { tokens: 1 } },
    { ...launch([atom('bad')]), budget: { ...budget(), extra: 1 } },
    { ...launch([atom('bad')]), merge: 'arbitrary' },
    launch([atom('version', {}, budget())].map(a => ({ ...a, codeVersion: 'untrusted' }))),
  ]) {
    const result = await run([request]);
    assert.ok(result.evidence.seen[0].error);
  }
  const nested = atom('nested', { forgeCalls: [launch([atom('grandchild')])] });
  assert.match((await run([launch([nested])])).evidence.seen[0].children[0].value[0].error, /depth/);
  const exhausted = atom('empty', { forgeCalls: [{ op: 'work' }, { op: 'work' }, launch([atom('raise')])] }, budget(1, 10000, 1));
  const child = (await run([launch([exhausted])])).evidence.seen[0].children[0];
  assert.match(child.value[1].error, /budget/);
  assert.match(child.value[2].error, /budget|depth/);
  await pool.close();
  await assert.rejects(run([launch([atom('closed')])]), /closing/);
});

test('Forge Core nested jobs use inherited host depth and refuse capacity deadlock', async t => {
  const { run } = await setup(t);
  const nested = atom('nested', { forgeCalls: [{ ...launch([atom('leaf', { value: ['leaf'] }, budget(1, 8000, 1))]), budget: budget(2, 10000, 2) }] }, budget(5, 20000, 5));
  const result = await run([launch([nested])]);
  assert.equal(result.evidence.seen[0].children[0].value[0].children[0].status, 'completed');
  const single = await setup(t, { size: 1 });
  assert.match((await single.run([launch([atom('queued')])])).evidence.seen[0].error, /capacity/);
});

test('Forge Core refuses unknown costs and malformed envelope budgets before external work', async t => {
  const { run, executions, pool } = await setup(t, { hostCost: undefined });
  const result = await run([{ op: 'work' }]);
  assert.match(result.evidence.seen[0].error, /hostCost/);
  assert.equal(executions.length, 0);
  for (const invalid of [null, {}, { ...budget(), dollars: 0.5 }, { ...budget(), tokens: -1 }, { ...budget(), extra: 1 }]) {
    await assert.rejects(pool.run({ candidates: ['pass'], ledger: 'caller', budget: invalid }), /budget/);
  }
});

test('Forge Core verification cap kills a hung child and failed addresses can retry', async t => {
  const { run, executions } = await setup(t);
  const child = atom('hung', { forgeCalls: [{ op: 'work' }], hang: true }, budget(2, 3000, 2));
  const result = await run([launch([child]), launch([child])]);
  assert.equal(executions.length, 2);
  for (const reply of result.evidence.seen) {
    assert.equal(reply.children[0].status, 'outcome_unknown');
    assert.equal(reply.children[0].cacheHit, false);
    assert.deepEqual(reply.children[0].forge.remaining, budget(0, 0, 0));
  }
});

for (const via of ['host', 'spawn']) {
  test(`Forge Core ${via} reaches child launch through bounded host calls`, async t => {
    const { run } = await setup(t);
    const result = await run([launch([atom('path', { value: ['ok'] })])], { via });
    assert.deepEqual(result.evidence.seen[0].value, ['ok']);
    const oversized = launch([atom('oversized', { value: ['x'.repeat(1048576)] })]);
    assert.match((await run([oversized], { via })).evidence.seen[0].error, /host-call-size/);
    const flooded = await run(Array.from({ length: 4097 }, () => ({ op: 'spawn' })), { via });
    assert.match(flooded.evidence.seen.at(-1).error, /host-call-limit/);
  });
}

test('Forge Core refuses an atom awaiting its own in-flight address', async t => {
  const { run } = await setup(t);
  const child = atom('cycle', { selfSpawn: budget(1, 1000, 1) });
  const result = await run([launch([child])]);
  assert.match(result.evidence.seen[0].children[0].value[0].error, /cycle/);
});
