import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { specificationFiles, specificationProblems, stagePrompts } from '../x1/agent.mjs';
import { EXPANDED_LIMIT, expandTests, expandedText } from '../x1/compact.mjs';
import { LIMIT } from '../x1/agent.mjs';
import { agentLimits, createLoopPool } from '../x1/loop.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider } from '../x1/transports.mjs';
import { withCapability } from './fixtures/x1/candidate.mjs';
import { idOf, reply, stageOf } from './fixtures/x1/scripted-model.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const value = item => item !== null && typeof item === 'object'
  ? (Array.isArray(item) ? `[${item.map(value).join(', ')}]` : `{${Object.entries(item).map(([key, field]) => `${/^[A-Za-z_]\w*$/.test(key) ? key : JSON.stringify(key)}: ${value(field)}`).join(', ')}}`)
  : JSON.stringify(item);
const compactOf = tests => tests.map(t => `${t.fn}(${t.args.map(value).join(', ')}) = ${t.expectError ? 'trap' : value(t.expect) + (Object.hasOwn(t, 'tol') ? ` ~ ${t.tol}` : '')} | ${t.name}`).join('\n');
const fixture = name => readFileSync(new URL(`./fixtures/oracle/${name}/tests.json`, import.meta.url), 'utf8');

const milk = { id: 1, done: false, hours: 0.5, title: 'buy milk' }, bike = { id: 2, done: false, hours: 2.25, title: 'fix the bike ☕' };
const event = (type, id, hours = 0, title = '') => ({ type, id, hours, title });
const one = { nextId: 2, items: [milk] }, two = { nextId: 3, items: [milk, bike] };
const full = { nextId: 5, items: [1, 2, 3, 4].map(id => ({ id, done: false, hours: 1, title: `t${id}` })) };
const todo = [
  { name: 'add to an empty list', fn: 'reduce', args: [{ nextId: 1, items: [] }, event(0, 0, 0.5, 'buy milk')], expect: one },
  { name: 'add a second item', fn: 'reduce', args: [one, event(0, 0, 2.25, bike.title)], expect: two },
  { name: 'toggle the first item', fn: 'reduce', args: [two, event(1, 1)], expect: { nextId: 3, items: [{ ...milk, done: true }, bike] } },
  { name: 'remove the first item', fn: 'reduce', args: [two, event(2, 1)], expect: { nextId: 3, items: [bike] } },
  { name: 'open hours', fn: 'openHours', args: [two], expect: 2.75, tol: 0.001 },
  { name: 'add to a full list', fn: 'reduce', args: [full, event(0, 0, 1, 'more')], expectError: true },
  { name: 'unknown event type', fn: 'reduce', args: [one, event(9, 1)], expectError: true },
];
const todoCompact = `shape Item(id, done, hours, title)
shape Event(type, id, hours, title)
let one = {nextId: 2, items: [Item(1, false, 0.5, "buy milk")]}
let two = {nextId: 3, items: [Item(1, false, 0.5, "buy milk"), Item(2, false, 2.25, "fix the bike ☕")]}
reduce({nextId: 1, items: []}, Event(0, 0, 0.5, "buy milk")) = $one | add to an empty list
reduce($one, Event(0, 0, 2.25, "fix the bike ☕")) = $two | add a second item
reduce($two, Event(1, 1, 0, "")) = {nextId: 3, items: [Item(1, true, 0.5, "buy milk"), Item(2, false, 2.25, "fix the bike ☕")]} | toggle the first item
reduce($two, Event(2, 1, 0, "")) = {nextId: 3, items: [Item(2, false, 2.25, "fix the bike ☕")]} | remove the first item
openHours($two) = 2.75 ~ 0.001 | open hours
reduce({nextId: 5, items: [Item(1, false, 1, "t1"), Item(2, false, 1, "t2"), Item(3, false, 1, "t3"), Item(4, false, 1, "t4")]}, Event(0, 0, 1, "more")) = trap | add to a full list
reduce($one, Event(9, 1, 0, "")) = trap | unknown event type
`;

test('scalar, trap and tol lines expand to exactly the hand-written tests.json', () => {
  const hand = [{ name: 'Celsius boiling point', fn: 'toF', args: [100, 1], expect: 212, tol: 0 }, { name: 'ratio | thirds', fn: 'ratio', args: [10, 3], expect: 3.3333333333333335, tol: 1e-15 },
    { name: 'label', fn: 'grade', args: [-0.5e-3, true, 'a "b"'], expect: 'low' }, { name: 'below range', fn: 'toF', args: [-101, 0], expectError: true }];
  const source = 'toF(100, 1) = 212 ~ 0 | Celsius boiling point\r\n\nratio(10,3)=3.3333333333333335~1e-15|ratio | thirds\n  grade(-0.5e-3, true, "a \\"b\\"") = "low" | label\ntoF(-101, 0) = trap | below range';
  const expanded = expandTests(source);
  assert.deepEqual(expanded.tests, hand);
  assert.deepEqual(expanded.lines, [1, 3, 4, 5]);
  assert.equal(expanded.text, `[\n${hand.map(t => JSON.stringify(t)).join(',\n')}\n]\n`);
  assert.deepEqual(Object.keys(expanded.tests[0]), ['name', 'fn', 'args', 'expect', 'tol']);
  assert.deepEqual(Object.keys(expanded.tests[3]), ['name', 'fn', 'args', 'expectError']);
});

test('structured state with shapes and named values expands to the hand-written records and lists', () => {
  assert.deepEqual(JSON.parse(expandedText(todoCompact)), todo);
  assert.deepEqual(expandTests('f({"a b": [1, {c: "x"}], d: null}) = {e: [true, false]} | json keys').tests[0], { name: 'json keys', fn: 'f', args: [{ 'a b': [1, { c: 'x' }], d: null }], expect: { e: [true, false] } });
  assert.equal(Object.hasOwn(expandTests('f({__proto__: 1}) = 1 | own').tests[0].args[0], '__proto__'), true);
});

test('every realistic tests.json round-trips through the compact form', () => {
  for (const tests of [...['piecewise-assignment', 'prose-definition', 'conditional-domain'].map(name => JSON.parse(fixture(name))), todo]) {
    assert.deepEqual(JSON.parse(expandedText(compactOf(tests))), tests);
  }
});

test('the compact form is smaller than the tests.json it expands to', t => {
  const rows = ['piecewise-assignment', 'prose-definition', 'conditional-domain'].map(name => [name, fixture(name), compactOf(JSON.parse(fixture(name)))]);
  rows.push(['todo reducer', `[\n${todo.map(test => JSON.stringify(test)).join(',\n')}\n]\n`, todoCompact]);
  for (const [name, json, compact] of rows) {
    t.diagnostic(`${name}: tests.json ${json.length} chars, tests.txt ${compact.length} chars, ${(100 * (1 - compact.length / json.length)).toFixed(1)}% fewer`);
    assert.ok(compact.length < 0.8 * json.length, name);
  }
});

test('a compact form that does not parse is refused with the line and column', () => {
  const refuse = source => expandTests(source).problems;
  assert.deepEqual(refuse(''), ['tests.txt is missing or empty']);
  assert.deepEqual(refuse(undefined), ['tests.txt is missing or empty']);
  assert.deepEqual(refuse('shape P(x)\n'), ['tests.txt has no test lines']);
  assert.deepEqual(refuse('f(1) = 2'), ['tests.txt line 1: expected | and a test name at column 9']);
  assert.deepEqual(refuse('f(1) = 2 |  '), ['tests.txt line 1: expected a test name after | at column 11']);
  assert.deepEqual(refuse('f(1, ) = 2 | a'), ['tests.txt line 1: expected a value at column 6']);
  assert.deepEqual(refuse('f(1) 2 | a'), ['tests.txt line 1: expected = after the arguments at column 6']);
  assert.deepEqual(refuse('f(1e400) = 2 | a'), ['tests.txt line 1: number 1e400 is not finite at column 3']);
  assert.deepEqual(refuse('f(NaN) = 2 | a'), ['tests.txt line 1: NaN is not a value or a shape at column 3']);
  assert.deepEqual(refuse('f($s) = 2 | a'), ['tests.txt line 1: unknown value $s at column 3']);
  assert.deepEqual(refuse('shape P(x, y)\nf(P(1)) = 2 | a'), ['tests.txt line 2: P takes 2 values, got 1 at column 3']);
  assert.deepEqual(refuse('f({a: 1, a: 2}) = 2 | a'), ['tests.txt line 1: duplicate field a at column 3']);
  assert.deepEqual(refuse('f(1) = trap ~ 0.1 | a'), ['tests.txt line 1: expected | and a test name at column 13']);
  assert.deepEqual(refuse('f(1) = 2 ~ x | a'), ['tests.txt line 1: expected a number after ~ at column 12']);
  assert.deepEqual(refuse('shape trap(x)\nlet v = 1\nlet v = 2\nshape P(x, x)'), ['tests.txt line 1: expected a name that is not a keyword at column 11',
    'tests.txt line 3: v is already defined at column 6', 'tests.txt line 4: P needs distinct field names at column 14']);
  assert.throws(() => expandedText('f(1) = 2'), /^Error: tests\.txt does not expand: tests\.txt line 1: expected \| and a test name at column 9$/);
});

test('a compact form that would expand past the tests.json file limit is refused on its line, without building the expansion', () => {
  assert.equal(EXPANDED_LIMIT, LIMIT);
  const tooLarge = line => `tests.txt line ${line}: expands past ${LIMIT} bytes of tests.json`;
  const wide = `let a = [${Array(10000).fill(0).join(',')}]`;
  const begin = performance.now();
  assert.deepEqual(expandTests(`${wide}\nlet b = [${Array(10000).fill('$a').join(',')}]\nf($b) = 1 | bomb`).problems[0], tooLarge(2));
  assert.deepEqual(expandTests(`shape P(x, y)\n${wide}\nlet c = P($a, $a)\nlet d = {x: $c, y: $c}\nf($d) = 1 | nested`).problems[0], tooLarge(4));
  assert.ok(performance.now() - begin < 1000);
  assert.deepEqual(expandTests(`${wide}\n${Array(8).fill('f($a) = 1 | many').join('\n')}`).problems, [tooLarge(5), tooLarge(6), tooLarge(7), tooLarge(8), tooLarge(9)]);
  assert.deepEqual(expandTests(`f("${'é'.repeat(40000)}") = 1 | wide text`).problems, [`tests.txt: expands past ${LIMIT} bytes of tests.json`]);
  assert.equal(expandTests(`${wide}\nf($a) = 1 | fits`).tests[0].args[0].length, 10000);
});

const contract = withCapability('# Ratio\n\n`ratio(a: f64, b: f64): f64`\n\nratio = a / b\n\nShow 3 decimal places.\n\n## Valid input\n- 0 < b <= 100\n\nAny other input traps.',
  JSON.stringify({ exports: [{ name: 'ratio', label: 'Ratio', args: [{ name: 'a', kind: 'number', unit: '1' }, { name: 'b', kind: 'number', unit: '1', range: '0..100' }], result: { kind: 'number', unit: '1', precision: 3 } }],
    traps: [{ fn: 'ratio', when: 'b is outside 0..100', message: 'b is out of range.' }] }));

test('a compact form that testProblems or the oracle refuses is a specification problem on its line, never frozen', () => {
  const problems = source => specificationProblems({ 'CONTRACT.md': contract, 'tests.txt': source }, { compactTests: true })?.problems;
  assert.equal(problems('ratio(1, 2) = 0.5 | half\nratio(1, 0) = trap | zero'), undefined);
  assert.deepEqual(problems('ratio(1, 2) = 0.5 | half\n\nratio(1, 2) = 0.5 ~ 0.5 | loose'), ['test 1 has a tol above 0.01 of its value (tests.txt line 3)']);
  assert.deepEqual(problems('ratio(1, 2) = [1] | list'), ['test 0 expects a list from scalar arguments; a list result needs the structured state it comes from, or a record around it (tests.txt line 1)']);
  assert.deepEqual(problems('ratio(1, 2) = 0.5 | half\nratio(1 2) = 1 | bad'), ['tests.txt line 2: expected ) at column 9']);
  assert.deepEqual(specificationProblems({ 'CONTRACT.md': contract, 'tests.json': '[]', 'tests.txt': 'ratio(1, 2) = 0.5 | half' }, { compactTests: true }), null);
  assert.match(specificationProblems({ 'CONTRACT.md': contract, 'tests.txt': 'ratio(1, 2) = 0.4 | half' }, { compactTests: true, oracle: true }).problems[0], /^test 0 \(half\).*\(tests\.txt line 1\)$/s);
});

test('with the flag off the prompt, editable files and checks are unchanged', () => {
  assert.equal(sha(stagePrompts.specification({ need: 'n', id: 'i' })), '2d07c26f78d2c927aadb3e8f2c88a519a1c91d480ed4b4d200fdce68862a9bad');
  assert.equal(sha(stagePrompts.specification({ need: 'n', id: 'i', oracle: true })), 'd9d2b3a869ad486f5b6a99ccf893c022d0745e158a4c063fd2fd279c65905d3f');
  assert.deepEqual(specificationFiles({}), ['CONTRACT.md', 'tests.json']);
  assert.deepEqual(specificationFiles({ oracle: true }), ['CONTRACT.md', 'tests.json', 'reference.js']);
  assert.deepEqual(specificationFiles({ compactTests: true, oracle: true }), ['CONTRACT.md', 'tests.txt', 'reference.js']);
  assert.deepEqual(specificationProblems({ 'CONTRACT.md': contract, 'tests.txt': 'ratio(1, 2) = 0.5 | half' }).problems, ['tests.json is not JSON']);
  assert.equal(agentLimits.compactTests, undefined);
  const prompt = JSON.parse(stagePrompts.specification({ need: 'n', id: 'i', compactTests: true })).instructions;
  assert.match(prompt, /^Write only CONTRACT\.md and tests\.txt, /);
  assert.doesNotMatch(prompt, /tests\.json is a nonempty array/);
});

const kernel = 'export function ratio(a: f64, b: f64): f64 { if (!(b > 0.0 && b <= 100.0)) abort(); return a / b; }';
const glue = id => JSON.stringify({ id, assumption: 'Both values are plain numbers.', question: 'What is a divided by b?',
  exports: [{ name: 'ratio', label: 'Ratio', args: [{ name: 'a', kind: 'number', unit: '1' }, { name: 'b', kind: 'number', unit: '1', range: '0..100' }], result: { kind: 'number', unit: '1', precision: 3 } }],
  traps: [{ fn: 'ratio', when: 'b is outside 0..100', message: 'b is out of range.' }] });
const source = 'ratio(1, 2) = 0.5 | half ☕\nratio(10, 4) = 2.5 ~ 0.001 | quarter\nratio(1, 0) = trap | zero';
const specReply = tests => reply({ calls: [{ name: 'edit_file', path: 'CONTRACT.md', content: contract }, { name: 'edit_file', path: 'tests.txt', content: tests }, { name: 'done' }] });
const implReply = messages => reply({ calls: [{ name: 'edit_file', path: 'kernel.ts', content: kernel }, { name: 'edit_file', path: 'glue.json', content: glue(idOf(messages)) }, { name: 'done' }] });
const scratch = t => { const root = mkdtempSync(join(tmpdir(), 'ef-compact-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };

for (const waits of ['hold', 'release']) {
  test(`a refused compact form goes back to the model, and the expanded tests.json is what freezes and promotes (${waits})`, { timeout: 60000 }, async t => {
    const prompts = [];
    let turn = 0;
    const pool = createLoopPool({ primes: 1, waits, provider: scriptedProvider(({ messages }) => {
      if (stageOf(messages) !== 'specification') return implReply(messages);
      prompts.push(messages.at(-1).content);
      return specReply(turn++ === 0 ? 'ratio(1, 2) = 0.5' : source);
    }) });
    t.after(() => pool.close());
    const result = await runNeed({ need: 'a ratio', directory: join(scratch(t), 'ratio'), pool, env: { ENDOFORGE_LOOP: 'agent' }, limits: { ...agentLimits, maxTurns: 3, compactTests: true } });
    assert.equal(result.promoted, true, JSON.stringify(result));
    assert.equal(turn, 2);
    assert.match(prompts[1], /tests\.txt line 1: expected \| and a test name at column 18/);
    assert.equal(JSON.parse(result.content).files['tests.json'], expandedText(source));
    assert.deepEqual(result.compact, { sha256: sha(source), bytes: Buffer.byteLength(source), chars: source.length, expandedBytes: Buffer.byteLength(expandedText(source)), tests: 3 });
    assert.notEqual(Buffer.byteLength(source), source.length);
  });
}

test('the compact form composes with the oracle, which corrects the expanded value', { timeout: 60000 }, async t => {
  const pool = createLoopPool({ primes: 1, provider: scriptedProvider(({ messages }) => stageOf(messages) === 'specification'
    ? reply({ calls: [{ name: 'edit_file', path: 'CONTRACT.md', content: contract }, { name: 'edit_file', path: 'tests.txt', content: source.replace('2.5 ~', '2.4 ~') },
      { name: 'edit_file', path: 'reference.js', content: 'function ratio(a, b) { if (!(b > 0 && b <= 100)) throw Error("range"); return a / b; }' }, { name: 'done' }] })
    : implReply(messages)) });
  t.after(() => pool.close());
  const result = await runNeed({ need: 'a ratio', directory: join(scratch(t), 'ratio'), pool, env: { ENDOFORGE_LOOP: 'agent' }, limits: { ...agentLimits, maxTurns: 2, compactTests: true, oracle: true } });
  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(result.oracle.corrected, 1);
  assert.equal(JSON.parse(JSON.parse(result.content).files['tests.json'])[1].expect, 2.5);
  assert.equal(result.compact.tests, 3);
});
