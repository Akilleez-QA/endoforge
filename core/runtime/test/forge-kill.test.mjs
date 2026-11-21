import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';
import { wasm, spin } from './fixtures/x1/wasm.mjs';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../isolate-pool.mjs';
import { ForgeKillScope } from '../forge-kill.mjs';
import { fixture } from './fixtures/ledger-fixture.mjs';

const hostPort = fileURLToPath(new URL('./fixtures/host-call-port.mjs', import.meta.url));
const budget = { tokens: 20, verifyMs: 60000, dollars: 20 };
const launch = (goal, inputs, verifyMs = 20000) => ({ op: 'spawn', children: [{ goal, inputs, codeVersion: 'fixture-v1',
  budget: { tokens: 5, verifyMs, dollars: 5 } }], budget: { tokens: 5, verifyMs, dollars: 5 }, merge: 'set-union' });

for (const isolation of ['thread', 'process']) for (const level of ['isolate', 'warp', 'block']) {
  test(`${isolation} ${level} kill stops the whole tree and measures latency`, { timeout: 15000 }, async t => {
    const { job } = await fixture(t);
    let now = 100;
    const scope = new ForgeKillScope({ level, now: () => now });
    let reached;
    const ready = new Promise(resolve => { reached = resolve; });
    let calls = 0;
    const pool = new IsolatePool({ hostPort, isolation, size: 4,
      forge: { codeVersion: 'fixture-v1', maxDepth: 3, maxFanOut: 2 }, hostCost: () => ({ tokens: 0, verifyMs: 0, dollars: 0 }),
      hostCalls: () => { calls++; reached(); return {}; } });
    t.after(() => pool.close());
    const leaf = { forgeCalls: [{ op: 'ready' }], hang: true };
    const pending = pool.run({ ...job(['pass'], { forgeCalls: [launch('middle', { forgeCalls: [launch('leaf', leaf, 10000)] })] }),
      ledger: 'caller', budget }, { scope });
    await ready;
    assert.equal(pool.stats.busy, 3);
    scope.kill('operator');
    now = 107;
    const result = await pending;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.kill.level, level);
    assert.equal(result.kill.propagationMs, 0);
    assert.equal(result.kill.stopMs, 7);
    assert.equal(result.kill.withinBound, true);
    assert.ok(result.kill.stopMs <= result.kill.latencyLimitMs);
    assert.equal(result.kill.reason, 'operator');
    assert.equal(result.evidence, undefined);
    assert.equal(result.children[0].status, 'cancelled');
    assert.equal(result.children[0].children[0].status, 'cancelled');
    assert.equal(pool.stats.busy, 0);
    assert.equal(pool.stats.queued, 0);
    assert.equal(calls, 1);
    assert.deepEqual(result.forge.remaining, { tokens: 0, verifyMs: 0, dollars: 0 });
    assert.equal((await pool.run({ ...job(['pass'], { forgeCalls: [] }), ledger: 'caller', budget })).status, 'completed');
  });
}

test('block kill reaches warp and isolate scopes and refuses queued and future work', async t => {
  const { job } = await fixture(t);
  const block = new ForgeKillScope({ level: 'block' });
  const warp = new ForgeKillScope({ level: 'warp', parent: block });
  const isolate = new ForgeKillScope({ level: 'isolate', parent: warp });
  const pool = new IsolatePool({ hostPort, size: 1 });
  t.after(() => pool.close());
  const input = { ...job(['pass'], { forgeCalls: [], hang: true }), ledger: 'caller' };
  const running = pool.run(input, { scope: isolate });
  const queued = pool.run(input, { scope: warp });
  block.kill('budget-unknown');
  for (const result of await Promise.all([running, queued, pool.run(input, { scope: block })])) {
    assert.equal(result.status, 'cancelled');
    assert.equal(result.kill.reason, 'budget-unknown');
  }
  assert.equal(pool.stats.busy, 0);
});

test('AbortSignal cancellation is observed before dispatch', async t => {
  const { job } = await fixture(t);
  const controller = new AbortController();
  controller.abort('cancel');
  const pool = new IsolatePool({ hostPort, size: 1 });
  t.after(() => pool.close());
  assert.equal((await pool.run({ ...job(), ledger: 'caller' }, { signal: controller.signal })).status, 'cancelled');
  assert.equal(pool.stats.workers, 0);
});

for (const target of ['parent', 'leaf']) test(`SIGKILL of ${target} returns cancellation values with zero kernel side effects`, { timeout: 15000 }, async t => {
  const { job, directory } = await fixture(t);
  const marker = `${directory}/world-effect`;
  let rootPid;
  let proposal;
  let effects = 0;
  const kernels = ['fs.writeFile', 'net.send', 'process.spawn'].map(name => [...wasm({
    imports: [{ module: 'world', field: name }], functions: [{ name: 'attempt', body: [0x10, 0] }],
  })]);
  const pool = new IsolatePool({ hostPort: fileURLToPath(new URL('./fixtures/forge-kill-port.mjs', import.meta.url)),
    isolation: 'process', size: 4, forge: { codeVersion: 'fixture-v1', maxDepth: 3, maxFanOut: 2 },
    hostCost: () => ({ tokens: 0, verifyMs: 0, dollars: 0 }),
    hostCalls: (request, context) => {
      if (request.op === 'identify') rootPid = context.workcell;
      else if (request.op === 'kernel-ready') {
        assert.equal(request.refused.length, 3);
        assert.ok(request.refused.every(message => /forbidden import/.test(message)));
        proposal = request.proposedEffects;
        process.kill(target === 'parent' ? rootPid : context.workcell, 'SIGKILL');
      } else { effects++; writeFileSync(marker, 'escaped'); }
      return {};
    } });
  t.after(() => pool.close());
  const leaf = { kernels, spin: [...wasm({ functions: [{ ...spin, name: 'spin' }] })] };
  const result = await pool.run({ ...job(['pass'], { forgeCalls: [{ op: 'identify' }, launch('leaf', leaf)] }), ledger: 'caller', budget });
  assert.deepEqual(proposal, [{ op: 'write', path: 'synthetic-output' }]);
  assert.equal(effects, 0);
  assert.equal(existsSync(marker), false);
  assert.equal(pool.stats.busy, 0);
  if (target === 'parent') {
    assert.equal(result.status, 'outcome_unknown');
    assert.equal(result.signal, 'SIGKILL');
    assert.equal(result.children[0].status, 'cancelled');
  } else {
    const receipt = result.evidence.seen[1];
    assert.equal(receipt.outcome.verdict, 'unknown');
    assert.equal(receipt.children[0].status, 'outcome_unknown');
    assert.equal(receipt.value, undefined);
  }
});

test('cancelled work persists an inconclusive receipt and reports a missed latency budget', async t => {
  const { job, directory } = await fixture(t);
  let now = 10;
  const scope = new ForgeKillScope({ now: () => now, latencyLimitMs: 5 });
  scope.kill('budget-unknown');
  now = 20;
  const pool = new IsolatePool({ hostPort, size: 1, ledgerBridge: { journal: `${directory}/journal` } });
  t.after(() => pool.close());
  const result = await pool.run(job(), { scope });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.kill.withinBound, false);
  assert.equal(result.kill.stopMs, 10);
  assert.equal(result.receipts[0].record.data.outcome_state, 'inconclusive');
  assert.equal(result.receipts[0].record.data.delivery_state, 'outcome_unknown');
});

test('a live host callback receives cancellation while another scope remains usable', async t => {
  const { job } = await fixture(t);
  const scope = new ForgeKillScope();
  let notify;
  const ready = new Promise(resolve => { notify = resolve; });
  let aborted = false;
  const pool = new IsolatePool({ hostPort, size: 2, hostCalls: (request, { signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => { aborted = true; resolve({ discarded: true }); }, { once: true });
    notify();
  }) });
  t.after(() => pool.close());
  const pending = pool.run({ ...job(['pass'], { forgeCalls: [{ op: 'waiting' }] }), ledger: 'caller' }, { scope });
  await ready;
  scope.kill();
  assert.equal((await pending).status, 'cancelled');
  assert.equal(aborted, true);
  assert.equal((await pool.run({ ...job(['pass'], { forgeCalls: [] }), ledger: 'caller' })).status, 'completed');
});

for (const isolation of ['thread', 'process']) test(`${isolation} parent deadline stops in-flight descendants`, { timeout: 10000 }, async t => {
  const { job } = await fixture(t);
  let reached;
  const ready = new Promise(resolve => { reached = resolve; });
  const pool = new IsolatePool({ hostPort, isolation, size: 3, jobDeadlineMs: 1500,
    forge: { codeVersion: 'fixture-v1', maxDepth: 2, maxFanOut: 2 },
    hostCost: () => ({ tokens: 0, verifyMs: 0, dollars: 0 }), hostCalls: () => { reached(); return {}; } });
  t.after(() => pool.close());
  const pending = pool.run({ ...job(['pass'], { forgeCalls: [launch('leaf', { forgeCalls: [{ op: 'ready' }], hang: true })] }), ledger: 'caller', budget });
  await ready;
  const result = await pending;
  assert.equal(result.status, 'outcome_unknown');
  assert.equal(result.reason, 'deadline');
  assert.equal(result.children[0].status, 'cancelled');
  assert.equal(pool.stats.busy, 0);
});

test('in-flight cache ownership keeps one killed root from cancelling another root', { timeout: 10000 }, async t => {
  const { job } = await fixture(t);
  const scope = new ForgeKillScope();
  let notify;
  const both = new Promise(resolve => { notify = resolve; });
  const releases = [];
  const pool = new IsolatePool({ hostPort, size: 4, forge: { codeVersion: 'fixture-v1', maxDepth: 2, maxFanOut: 2 },
    hostCost: () => ({ tokens: 0, verifyMs: 0, dollars: 0 }), hostCalls: () => new Promise(resolve => {
      releases.push(resolve);
      if (releases.length === 2) notify();
    }) });
  t.after(() => pool.close());
  const input = { ...job(['pass'], { forgeCalls: [launch('shared', { value: ['ok'], forgeCalls: [{ op: 'ready' }] })] }), ledger: 'caller', budget };
  const first = pool.run(input, { scope });
  const second = pool.run(input);
  await both;
  scope.kill();
  releases.forEach(resolve => resolve({}));
  assert.equal((await first).status, 'cancelled');
  assert.deepEqual((await second).evidence.seen[0].value, ['ok']);
  const cached = await pool.run(input);
  assert.equal(cached.evidence.seen[0].children[0].cacheHit, true);
  assert.equal(releases.length, 2);
});
