import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { agentLimits, completedCalls, createLoopPool } from '../x1/loop.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider, WarmClaudeTransport } from '../x1/transports.mjs';
import { candidate, capabilityFor } from './fixtures/x1/candidate.mjs';
import { implementation, inputFor, reply, specification, stageOf } from './fixtures/x1/scripted-model.mjs';
import { good, seeds } from './fixtures/x1/seeds.mjs';
import { subscribedHome } from './fixtures/subscription.mjs';

const { files } = candidate();
const need = 'integer add(a,b)';
const env = { ENDOFORGE_LOOP: 'agent' };
const input = (seed, contract = files['CONTRACT.md']) => inputFor(contract, files['tests.json'], seed.kernel, seed.glue);
const overlapOn = { ...agentLimits, overlap: true };
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-overlap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const libraryDouble = verdict => ({ async serve(asked) { return verdict === 'pass' ? { verdict: 'pass', receipt: { kind: 'library_reuse', need: { id: asked.id } }, hash: 'f'.repeat(64) } : { verdict: 'miss' }; } });
const prefixThroughContract = text => text.slice(0, text.indexOf('{"name":"edit_file","path":"tests.json"'));
const within = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);

function scripted({ seed = good, specs = [specification(input(good))], overlapSeed = seed, partial = true } = {}) {
  const log = [], calls = [], ended = [];
  let implStarted;
  const started = new Promise(resolve => { implStarted = resolve; });
  const provider = scriptedProvider(async ({ session, messages, turn, onPartial }) => {
    const overlap = session.endsWith(':overlap'), stage = stageOf(messages);
    calls.push({ session, overlap, stage, messages: messages.map(message => ({ ...message })), partial: typeof onPartial === 'function' });
    if (overlap) { log.push('impl:start'); implStarted(); return reply(implementation(input(overlapSeed), JSON.parse(messages[0].content).id)); }
    if (stage === 'implementation') return reply(implementation(input(seed), JSON.parse(messages[0].content).id));
    const text = JSON.stringify(specs[Math.min(turn, specs.length - 1)]);
    if (partial) onPartial?.(prefixThroughContract(text));
    if (partial && onPartial && turn === 0) await within(started, 2000);
    log.push('spec:end');
    return reply(text);
  });
  const endSession = provider.endSession.bind(provider);
  provider.endSession = session => { ended.push(session); endSession(session); };
  return { provider, log, calls, ended };
}
const poolFor = (t, provider, waits = 'release') => {
  const pool = createLoopPool({ primes: 1, waits, provider });
  t.after(() => pool.close());
  return pool;
};

test('overlap off keeps the loop as it is: one session, no partial hook, no overlap record', { timeout: 30000 }, async t => {
  const root = scratch(t), model = scripted();
  const result = await runNeed({ need, directory: join(root, 'addition'), pool: poolFor(t, model.provider), env });
  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(result.overlap, undefined);
  assert.deepEqual(model.calls.map(call => [call.overlap, call.stage, call.partial]), [[false, 'specification', false], [false, 'implementation', false]]);
  assert.equal(result.agent.turns, 2);
});

test('overlap starts the implementation before the specification reply ends, blind to tests.json, and checks it only after the freeze', { timeout: 60000 }, async t => {
  const root = scratch(t);
  for (const waits of ['release', 'hold']) {
    const model = scripted(), events = [];
    const result = await runNeed({ need, directory: join(root, `addition-${waits}`), pool: poolFor(t, model.provider, waits), env, limits: overlapOn, observe: stage => events.push(stage) });
    assert.equal(result.promoted, true, JSON.stringify(result));
    assert.deepEqual(model.log.slice(0, 2), ['impl:start', 'spec:end'], waits);
    const { overlap } = result;
    assert.equal(overlap.ran, true);
    assert.equal(overlap.trigger, 'partial');
    assert.equal(overlap.outcome, 'used');
    assert.ok(overlap.offsetMs < overlap.specReplyMs, JSON.stringify(overlap));
    assert.equal(overlap.usage, 10);
    assert.ok(overlap.callMs >= 0 && overlap.waitedMs >= 0);
    const blind = model.calls.filter(call => call.overlap);
    assert.equal(blind.length, 1);
    assert.equal(blind[0].messages.length, 1);
    const prompt = JSON.parse(blind[0].messages[0].content);
    assert.deepEqual(Object.keys(prompt.frozen), ['CONTRACT.md']);
    assert.equal(prompt.frozen['CONTRACT.md'], files['CONTRACT.md']);
    assert.ok(!blind[0].messages[0].content.includes(JSON.stringify(files['tests.json']).slice(1, -1)));
    assert.ok(!blind[0].messages[0].content.includes('"expect\\":5') && !blind[0].messages[0].content.includes('"expect":5'));
    assert.deepEqual(model.calls.filter(call => !call.overlap).map(call => call.stage), ['specification']);
    assert.ok(events.indexOf('overlap:start') < events.indexOf('admitting'), events.join());
    assert.ok(events.indexOf('admitted') < events.indexOf('overlap:used'), events.join());
    assert.equal(result.rounds.length, 1);
    assert.equal(result.agent.turns, 2);
    assert.ok(model.ended.some(session => session.endsWith(':overlap')));
  }
});

test('a capability block that changes before the freeze replaces the overlapped implementation with the normal stage', { timeout: 30000 }, async t => {
  const root = scratch(t);
  const first = { calls: [{ name: 'edit_file', path: 'CONTRACT.md', content: `Integer addition.\n\n${capabilityFor([['add', ['x', 'y']]])}` }, { name: 'edit_file', path: 'tests.json', content: '[]' }, { name: 'done' }] };
  const model = scripted({ specs: [first, specification(input(good))], overlapSeed: seeds.find(seed => seed.name === 'wrong-answer') });
  const result = await runNeed({ need, directory: join(root, 'addition'), pool: poolFor(t, model.provider), env, limits: overlapOn });
  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(result.overlap.outcome, 'replaced');
  assert.equal(result.overlap.reason, 'block changed');
  assert.deepEqual(model.calls.filter(call => !call.overlap).map(call => call.stage), ['specification', 'specification', 'implementation']);
  assert.deepEqual(result.rounds.map(round => round.failures), [null]);
});

test('a reused admission discards the overlapped implementation and ends its session', { timeout: 30000 }, async t => {
  const root = scratch(t), model = scripted();
  const result = await runNeed({ need, directory: join(root, 'addition'), pool: poolFor(t, model.provider), env, limits: overlapOn, library: libraryDouble('pass') });
  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(result.reused.kind, 'library_reuse');
  assert.equal(result.overlap.outcome, 'discarded');
  assert.equal(result.overlap.reason, 'reused');
  assert.ok(model.ended.some(session => session.endsWith(':overlap')));
  assert.deepEqual(model.calls.filter(call => !call.overlap).map(call => call.stage), ['specification']);
});

test('without a partial reply the overlap starts when the specification reply ends, and a failing overlapped implementation is not promoted', { timeout: 30000 }, async t => {
  const root = scratch(t), model = scripted({ seed: seeds.find(seed => seed.name === 'wrong-answer'), partial: false });
  const result = await runNeed({ need, directory: join(root, 'addition'), pool: poolFor(t, model.provider), env, limits: { ...overlapOn, maxTurns: 1 } });
  assert.equal(result.promoted, false, JSON.stringify(result));
  assert.equal(result.overlap.trigger, 'reply');
  assert.deepEqual(model.log.slice(0, 2), ['spec:end', 'impl:start']);
  assert.equal(result.overlap.outcome, 'used');
  assert.equal(result.rounds.length, 1);
  assert.ok(result.rounds[0].failures);
});

test('completed calls are read from a partial reply, braces and quotes inside strings included', () => {
  const text = JSON.stringify({ calls: [{ name: 'edit_file', path: 'CONTRACT.md', content: 'a } " { b' }, { name: 'edit_file', path: 'tests.json', content: '[1]' }] });
  assert.deepEqual(completedCalls(text.slice(0, text.indexOf('tests.json') + 5)).map(call => call.content), ['a } " { b']);
  assert.equal(completedCalls(text).length, 2);
  assert.deepEqual(completedCalls('{"calls":[{"name":"edit'), []);
});

test('the warm transport streams partial reply text only when asked', { timeout: 30000 }, async t => {
  const root = scratch(t), fake = fileURLToPath(new URL('./fixtures/x1/fake-claude.mjs', import.meta.url));
  const make = partial => new WarmClaudeTransport({ model: 'stub', command: fake, cwd: root, partial, governor: null, base: { PATH: process.env.PATH, HOME: subscribedHome(join(root, 'home')) } });
  const on = make(true), off = make(false);
  t.after(async () => { await on.close(); await off.close(); });
  assert.ok(on.arguments.includes('--include-partial-messages') && !off.arguments.includes('--include-partial-messages'));
  const seen = [];
  let started = false;
  const replied = await on.send({ session: 'a', messages: [{ role: 'user', content: 'one' }], onPartial: text => seen.push(text), onStart: () => { started = true; } });
  assert.equal(started, true);
  assert.equal(seen.length, 2);
  assert.equal(seen.at(-1), replied.text);
});
