import assert from 'node:assert/strict';
import test from 'node:test';
import { repeatedFailure, takeReply } from '../x1/agent.mjs';

const take = async (calls, verdicts, repeated) => {
  const state = { messages: [], overlay: {}, editable: ['kernel.ts'], repeated, receipt: { turns: 0, tokens: 0, tool_calls: 0 }, limits: { maxTokens: 1000 } };
  const seen = [];
  state.check = async () => { seen.push({ ...state.overlay }); return verdicts[seen.length - 1] ?? null; };
  const exit = await takeReply(state, { text: JSON.stringify({ calls }), usage: 10 });
  const last = state.messages.at(-1);
  return { exit, seen, receipt: state.receipt, next: last.role === 'user' ? JSON.parse(last.content) : null };
};
const edit = content => ({ name: 'edit_file', path: 'kernel.ts', content });

test('a passing check ends the stage without done', async () => {
  const { exit, seen, receipt, next } = await take([edit('a'), { name: 'check' }], []);
  assert.equal(exit, 'stop');
  assert.equal(seen.length, 1);
  assert.equal(next, null);
  assert.deepEqual(receipt, { turns: 1, tokens: 10, tool_calls: 2 });
});

test('a failing check without done sends the failures back', async () => {
  const { exit, seen, next } = await take([edit('a'), { name: 'check' }], [['G4_tests']]);
  assert.equal(exit, null);
  assert.equal(seen.length, 1);
  assert.deepEqual(next.results.at(-1), { check: ['G4_tests'] });
  assert.equal(next.instructions, 'Fix what failed, then done.');
});

test('an edit after a passing check is checked again before the stage ends', async () => {
  const { exit, seen } = await take([edit('a'), { name: 'check' }, edit('b')], []);
  assert.equal(exit, 'stop');
  assert.deepEqual(seen.map(files => files['kernel.ts']), ['a', 'b']);
  const failing = await take([edit('a'), { name: 'check' }, edit('b'), { name: 'done' }], [null, ['G2_compile']]);
  assert.equal(failing.exit, null);
  assert.deepEqual(failing.next.results.at(-1), { check: ['G2_compile'] });
});

test('a refused edit after a passing check does not repeat the check', async () => {
  const { exit, seen } = await take([{ name: 'check' }, { name: 'edit_file', path: 'tests.json', content: '[]' }], []);
  assert.equal(exit, 'stop');
  assert.equal(seen.length, 1);
});

test('done without check still checks first', async () => {
  const passing = await take([edit('a'), { name: 'done' }], []);
  assert.equal(passing.exit, 'stop');
  assert.equal(passing.seen.length, 1);
  const failing = await take([edit('a'), { name: 'done' }], [['G4_tests']]);
  assert.equal(failing.exit, null);
  assert.deepEqual(failing.next.results.at(-1), { check: ['G4_tests'] });
});

test('a reply with only edits keeps the turn going without a check', async () => {
  const { exit, seen, next } = await take([edit('a')], []);
  assert.equal(exit, null);
  assert.equal(seen.length, 0);
  assert.equal(next.instructions, 'Fix what failed, then done.');
});

const failing = (got, extra = {}) => ({ gates: { G4_tests: { ok: false, passed: 4, total: 5 } }, tests: [{ name: 'push locks', fn: 'next', args: [1, 1], expect: 0, got, pass: false, ms: Math.random(), ...extra }] });
const round = failures => ({ source: 'x', failures });

test('the same failing tests with the same values in two consecutive checks are a repeated failure', () => {
  assert.deepEqual(repeatedFailure([round(failing(1)), round(failing(1))]),
    { gates: ['G4_tests'], tests: [{ name: 'push locks', fn: 'next', args: [1, 1], expect: 0, got: 1 }] });
  assert.equal(repeatedFailure([round(failing(1)), round(failing(1)), round(null)]), null);
  assert.equal(repeatedFailure([round(failing(1))]), null);
});

test('a failure that changes between checks, or one without failing tests, is not a repeated failure', () => {
  assert.equal(repeatedFailure([round(failing(1)), round(failing(2))]), null);
  assert.equal(repeatedFailure([round(failing(1)), round(failing(1, { name: 'coin unlocks' }))]), null);
  assert.equal(repeatedFailure([round(failing(1)), round({ ...failing(1), gates: { ...failing(1).gates, G7_glue: { ok: false, why: 'id' } } })]), null);
  assert.equal(repeatedFailure([round(failing(1)), round(failing(1)), round(failing(2))]), null);
  const compile = { gates: { G2_compiles: { ok: false, why: 'compiler failed or timed out' } }, tests: [] };
  assert.equal(repeatedFailure([round(compile), round(compile)]), null);
});

test('a repeated failure ends the stage with its own exit reason and records the tests', async () => {
  const repeat = { gates: ['G4_tests'], tests: [{ name: 'push locks' }] };
  const { exit, receipt, next } = await take([edit('a'), { name: 'done' }], [['G4_tests']], () => repeat);
  assert.equal(exit, 'repeated_failure');
  assert.deepEqual(receipt.repeated, repeat);
  assert.equal(next, null);
  const changed = await take([edit('a'), { name: 'done' }], [['G4_tests']], () => null);
  assert.equal(changed.exit, null);
  assert.deepEqual(changed.next.results.at(-1), { check: ['G4_tests'] });
  const passed = await take([edit('a'), { name: 'done' }], [], () => repeat);
  assert.equal(passed.exit, 'stop');
  assert.equal(passed.receipt.repeated, undefined);
  const unchecked = await take([edit('a')], [], () => repeat);
  assert.equal(unchecked.exit, null);
});
