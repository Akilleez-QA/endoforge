import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLoopPool } from '../x1/loop.mjs';
import { agentLimits } from '../x1/loop.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider } from '../x1/transports.mjs';
import { analyzeSpecification, applyChanges, formulaReference, freezeSpecification, parseExpression, rangeRules, referenceFunctions } from '../x1/oracle.mjs';
import { specificationProblems } from '../x1/agent.mjs';
import { idOf, reply, stageOf } from './fixtures/x1/scripted-model.mjs';

const contract = ['# kW to horsepower', '', '`kwToHp(kw: f64): f64`', '', 'hp = kw * 1000 / 745.699872', '', 'Show 3 decimal places.', '', '## Valid input', '- 0 <= kw <= 10000', '', 'Any other input traps.'].join('\n');
const reference = 'function kwToHp(kw) { if (!(kw >= 0 && kw <= 10000)) throw Error("range"); return kw * 1000 / 745.699872; }';
const tests = expect => JSON.stringify([{ name: 'request', fn: 'kwToHp', args: [6.2], expect, tol: 0.0001 }, { name: 'one', fn: 'kwToHp', args: [1], expect: 1.341022089595028, tol: 1e-9 },
  { name: 'zero', fn: 'kwToHp', args: [0], expect: 0 }, { name: 'negative', fn: 'kwToHp', args: [-1], expectError: true }]);
const kernel = 'export function kwToHp(kw: f64): f64 { if (!(kw >= 0.0 && kw <= 10000.0)) abort(); return kw * 1000.0 / 745.699872; }';
const glue = id => JSON.stringify({ id, assumption: 'Power is real power in kilowatts.', question: 'How many horsepower is this many kilowatts?',
  exports: [{ name: 'kwToHp', label: 'Horsepower', args: [{ name: 'kw', kind: 'number', unit: 'kW', range: '0..10000' }], result: { kind: 'number', unit: 'hp', precision: 3 } }],
  traps: [{ fn: 'kwToHp', when: 'kw is outside 0..10000', message: 'Power is outside the supported range.' }] });
const files = expect => ({ 'CONTRACT.md': contract, 'tests.json': tests(expect), 'reference.js': reference });
const specReply = (expect, withReference = true) => reply({ calls: [{ name: 'edit_file', path: 'CONTRACT.md', content: contract }, { name: 'edit_file', path: 'tests.json', content: tests(expect) },
  ...(withReference ? [{ name: 'edit_file', path: 'reference.js', content: reference }] : []), { name: 'done' }] });
const implReply = messages => reply({ calls: [{ name: 'edit_file', path: 'kernel.ts', content: kernel }, { name: 'edit_file', path: 'glue.json', content: glue(idOf(messages)) }, { name: 'done' }] });
const scratch = t => { const root = mkdtempSync(join(tmpdir(), 'ef-oracle-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const env = { ENDOFORGE_LOOP: 'agent' };
const correct = 6.2 * 1000 / 745.699872;

test('expressions parse with functions and powers and stop at trailing prose', () => {
  const parsed = parseExpression('sqrt(3) * volts ^ 2 / 745.699872 hp, unrounded');
  assert.ok(parsed);
  assert.deepEqual([...parsed.names].sort(), ['volts']);
  assert.equal(parseExpression('0.25 for top feed, 0.50 for bottom feed'), null);
});

test('a contract formula with intermediate steps gives the expected value', () => {
  const text = ['`dewPointF(tempF: f64, rhPct: f64): f64`', '1. T_c = (tempF - 32) * 5/9', '2. gamma = ln(rhPct/100) + 17.625*T_c/(243.04 + T_c)', '3. Td_c = 243.04*gamma/(17.625 - gamma)', '4. result = Td_c*9/5 + 32  (degrees F)'].join('\n');
  const values = formulaReference(text, 'dewPointF', ['tempF', 'rhPct'])([77, 50]);
  assert.ok(Math.abs(values[0] - 56.9437025722654) < 1e-9, String(values));
});

test('ranges parse inclusive, exclusive and grouped bounds', () => {
  assert.deepEqual(rangeRules('## Valid inputs\n- 0 < powerFactor <= 1\n- kw must be finite, 0 <= kw <= 1,000,000.', ['powerFactor', 'kw']),
    [{ name: 'powerFactor', lo: 0, loOpen: true, hi: 1, hiOpen: false }, { name: 'kw', lo: 0, loOpen: false, hi: 1000000, hiOpen: false }]);
  assert.deepEqual(rangeRules('Codes: 1 = normal (8 <= deltaF <= 12).', ['deltaF']), []);
});

test('a reference runs in a fresh context and its traps are outcomes', () => {
  const run = referenceFunctions(reference, ['kwToHp']);
  assert.deepEqual(run.kwToHp([-1]), { trap: true });
  assert.equal(run.kwToHp([6.2]).value, correct);
  assert.equal(referenceFunctions('process.exit(1)', ['kwToHp']), null);
  assert.deepEqual(referenceFunctions('function kwToHp() { for (;;) {} }', ['kwToHp']).kwToHp([1]), { trap: true, timeout: true });
});

test('two agreeing references replace a wrong literal, and every number test gets a tolerance', () => {
  const frozen = freezeSpecification(files(8.314471));
  assert.equal(frozen.report.corrected, 1);
  assert.equal(frozen.report.flagged, 0);
  const out = JSON.parse(frozen.text);
  assert.equal(out[0].expect, correct);
  assert.equal(out[2].tol, 1e-9);
  assert.equal(applyChanges(tests(8.314471), frozen.changes), frozen.text);
  assert.throws(() => applyChanges(tests(8.314471), [{ index: 0, test: { ...out[0], args: [7] } }]), /only expect, tol and expectError/);
});

test('one reference that contradicts the literal is a spec problem, not a frozen test', () => {
  const analysis = analyzeSpecification({ 'CONTRACT.md': contract, 'tests.json': tests(8.314471) });
  assert.equal(analysis.decisions[0].status, 'flagged');
  assert.match(specificationProblems({ 'CONTRACT.md': contract, 'tests.json': tests(8.314471) }, { oracle: true }).problems[0], /test 0 \(request\)/);
  assert.equal(specificationProblems({ 'CONTRACT.md': contract, 'tests.json': tests(8.314471) }), null);
  assert.equal(specificationProblems({ 'CONTRACT.md': contract, 'tests.json': tests(correct) }, { oracle: true }), null);
});

test('a value test outside the stated domain is flagged as a trap', () => {
  const text = JSON.stringify([{ name: 'big', fn: 'kwToHp', args: [20000], expect: 26820.44, tol: 0.01 }]);
  const analysis = analyzeSpecification({ 'CONTRACT.md': contract, 'tests.json': text, 'reference.js': reference });
  assert.equal(analysis.decisions[0].status, 'corrected');
  assert.deepEqual(analysis.decisions[0].computed, { trap: true });
});

for (const waits of ['hold', 'release']) {
  test(`with the oracle a wrong frozen value is corrected before implementation (${waits})`, { timeout: 60000 }, async t => {
    const seen = [];
    const pool = createLoopPool({ primes: 1, waits, provider: scriptedProvider(({ messages }) => { seen.push(stageOf(messages)); return stageOf(messages) === 'specification' ? specReply(8.314471) : implReply(messages); }) });
    t.after(() => pool.close());
    const result = await runNeed({ need: 'kW to hp', directory: join(scratch(t), 'hp'), pool, env, limits: { ...agentLimits, maxTurns: 2, oracle: true } });
    assert.equal(result.promoted, true, JSON.stringify(result));
    assert.equal(result.oracle.corrected, 1);
    assert.equal(result.oracle.spec_errors[0].computed.value, correct);
    assert.deepEqual(seen, ['specification', 'implementation']);
  });
}

test('without the oracle the same wrong frozen value cannot be passed', { timeout: 60000 }, async t => {
  const pool = createLoopPool({ primes: 1, provider: scriptedProvider(({ messages }) => stageOf(messages) === 'specification' ? specReply(8.314471, false) : implReply(messages)) });
  t.after(() => pool.close());
  const result = await runNeed({ need: 'kW to hp', directory: join(scratch(t), 'hp'), pool, env, limits: { ...agentLimits, maxTurns: 2, oracle: false } });
  assert.equal(result.promoted, false, JSON.stringify(result));
  assert.equal(result.oracle, undefined);
});

test('a contradiction the oracle cannot settle goes back to the specification turn', { timeout: 60000 }, async t => {
  const prompts = [];
  let specTurns = 0;
  const pool = createLoopPool({ primes: 1, provider: scriptedProvider(({ messages }) => {
    if (stageOf(messages) !== 'specification') return implReply(messages);
    prompts.push(messages.at(-1).content);
    return specReply(specTurns++ === 0 ? 8.314471 : correct, false);
  }) });
  t.after(() => pool.close());
  const result = await runNeed({ need: 'kW to hp', directory: join(scratch(t), 'hp'), pool, env, limits: { ...agentLimits, maxTurns: 3, oracle: true } });
  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(specTurns, 2);
  assert.match(prompts[1], /formula give/);
  assert.equal(result.oracle.flagged, 0);
});
