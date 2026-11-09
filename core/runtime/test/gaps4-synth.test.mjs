import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { threadId } from 'node:worker_threads';
import { compile } from '../x1/compiler.mjs';
import { createLoopPool } from '../x1/loop.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { bindingShape, combine, compileMember, begin, prompts } from '../x1/synth/stage.mjs';
import { judge } from '../x1/synth/judge.mjs';
import { scriptedProvider } from '../x1/transports.mjs';
import { candidate as additionCandidate } from './fixtures/x1/candidate.mjs';
import { inputFor, modelFor } from './fixtures/x1/scripted-model.mjs';
import { good } from './fixtures/x1/seeds.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const asc = here('../../../tools/asc/node_modules/.bin/asc');
const noCompiler = !existsSync(asc) && 'run make loop-setup to install the pinned AssemblyScript compiler';

const source = `const ITEM: usize = 40;
const MAX: u32 = 4;
const STATE: usize = 176;

function slot(state: usize, index: u32): usize { return state + 16 + <usize>index * ITEM; }

function find(state: usize, id: i32): i32 {
  const count = load<u32>(state + 8);
  for (let i: u32 = 0; i < count; i++) if (load<i32>(slot(state, i)) == id) return <i32>i;
  return -1;
}

function checked(state: usize): u32 {
  const count = load<u32>(state + 8);
  if (count > MAX) abort();
  for (let i: u32 = 0; i < count; i++) if (!isFinite(load<f64>(slot(state, i) + 8))) abort();
  return count;
}

export function reduce(state: usize, event: usize, out: usize): void {
  const count = checked(state);
  memory.copy(out, state, STATE);
  const kind = load<i32>(event);
  const id = load<i32>(event + 4);
  if (kind == 0) {
    const hours = load<f64>(event + 8);
    if (count >= MAX || !isFinite(hours) || hours < 0) abort();
    const target = slot(out, count);
    const nextId = load<i32>(out);
    store<i32>(target, nextId);
    store<i32>(target + 4, 0);
    store<f64>(target + 8, hours);
    memory.copy(target + 16, event + 16, 20);
    store<u32>(out + 8, count + 1);
    store<i32>(out, nextId + 1);
  } else if (kind == 1) {
    const at = find(out, id);
    if (at < 0) abort();
    const done = slot(out, <u32>at) + 4;
    store<i32>(done, load<i32>(done) ^ 1);
  } else if (kind == 2) {
    const at = find(out, id);
    if (at < 0) abort();
    memory.copy(slot(out, <u32>at), slot(out, <u32>at + 1), <usize>(count - 1 - <u32>at) * ITEM);
    memory.fill(slot(out, count - 1), 0, ITEM);
    store<u32>(out + 8, count - 1);
  } else abort();
}

export function openHours(state: usize): f64 {
  const count = checked(state);
  let total: f64 = 0;
  for (let i: u32 = 0; i < count; i++) if (load<i32>(slot(state, i) + 4) == 0) total += load<f64>(slot(state, i) + 8);
  return total;
}
`;
const togglesOnlyOn = source.replace('store<i32>(done, load<i32>(done) ^ 1);', 'store<i32>(done, 1);');
const firstTwoOnly = source.replace('for (let i: u32 = 0; i < count; i++) if (load<i32>(slot(state, i) + 4) == 0) total', 'for (let i: u32 = 0; i < count && i < 2; i++) if (load<i32>(slot(state, i) + 4) == 0) total');
const contract = [
  'A to-do list reducer: the state holds the next id and at most four items, each with an id, a done flag, estimated hours (zero or more) and a title of at most sixteen UTF-8 bytes.',
  'reduce(state, event) applies one event and returns the next state: type 0 adds an open item with the next id, type 1 toggles the item with the event id, type 2 removes it and closes the gap.',
  'reduce traps on non-finite or negative hours, an unknown id, a full list or an unknown event type.',
  'openHours(state) returns the total hours of the open items as a finite number shown with two decimal places.',
].join('\n');
const item = { kind: 'record', fields: [
  { name: 'id', kind: 'integer', unit: '1' },
  { name: 'done', kind: 'boolean', unit: '1', labels: { true: 'Done', false: 'Open' } },
  { name: 'hours', kind: 'number', unit: 'h', precision: 2 },
  { name: 'title', kind: 'text', maxBytes: 16 },
] };
const stateType = { kind: 'record', label: 'To-do list', fields: [{ name: 'nextId', kind: 'integer', unit: '1' }, { name: 'items', kind: 'list', max: 4, items: item }] };
const eventType = { kind: 'record', label: 'Event', fields: [
  { name: 'type', kind: 'code', unit: '1', codes: { 0: 'Add an item', 1: 'Toggle an item', 2: 'Remove an item' } },
  { name: 'id', kind: 'integer', unit: '1' },
  { name: 'hours', kind: 'number', unit: 'h' },
  { name: 'title', kind: 'text', maxBytes: 16 },
] };
const glue = {
  id: 'todo', assumption: 'The list holds at most four items and every title fits in sixteen UTF-8 bytes.', question: 'Which items are still open, and how many hours do they need?',
  exports: [
    { name: 'reduce', label: 'Apply an event to the to-do list', headline: true, args: [{ name: 'state', ...stateType }, { name: 'event', ...eventType }], result: stateType },
    { name: 'openHours', label: 'Hours of open items', args: [{ name: 'state', ...stateType }], result: { kind: 'number', unit: 'h', precision: 2 } },
  ],
  traps: [{ fn: 'reduce', when: 'the event names a missing item, the list is full or hours are invalid', message: 'This event cannot be applied to the list.' }],
};
const milk = { id: 1, done: false, hours: 0.5, title: 'buy milk' };
const bike = { id: 2, done: false, hours: 2.25, title: 'fix the bike ☕' };
const event = (type, id, hours = 0, title = '') => ({ type, id, hours, title });
const one = { nextId: 2, items: [milk] }, two = { nextId: 3, items: [milk, bike] };
const toggled = { nextId: 3, items: [{ ...milk, done: true }, bike] };
const tests = [
  { name: 'add to an empty list', fn: 'reduce', args: [{ nextId: 1, items: [] }, event(0, 0, 0.5, 'buy milk')], expect: one },
  { name: 'add a second item', fn: 'reduce', args: [one, event(0, 0, 2.25, bike.title)], expect: two },
  { name: 'toggle the first item', fn: 'reduce', args: [two, event(1, 1)], expect: toggled },
  { name: 'remove the first item', fn: 'reduce', args: [two, event(2, 1)], expect: { nextId: 3, items: [bike] } },
  { name: 'open hours', fn: 'openHours', args: [toggled], expect: 2.25 },
  { name: 'open hours of an empty list', fn: 'openHours', args: [{ nextId: 1, items: [] }], expect: 0 },
  { name: 'toggle a missing item', fn: 'reduce', args: [one, event(1, 7)], expectError: true },
  { name: 'unknown event type', fn: 'reduce', args: [one, event(9, 1)], expectError: true },
];
const reference = `function reduce(state, event) {
  if (state.items.length > 4) throw Error('too many items');
  const items = state.items.map(i => ({ id: i.id, done: i.done, hours: i.hours, title: i.title }));
  if (event.type === 0) {
    if (items.length >= 4 || !Number.isFinite(event.hours) || event.hours < 0) throw Error('cannot add');
    items.push({ id: state.nextId, done: false, hours: event.hours, title: event.title });
    return { nextId: state.nextId + 1, items };
  }
  const at = items.findIndex(i => i.id === event.id);
  if (event.type === 1) { if (at < 0) throw Error('missing'); items[at].done = !items[at].done; return { nextId: state.nextId, items }; }
  if (event.type === 2) { if (at < 0) throw Error('missing'); items.splice(at, 1); return { nextId: state.nextId, items }; }
  throw Error('unknown event');
}
function openHours(state) { let total = 0; for (const i of state.items) if (!i.done) total += i.hours; return total; }`;
const referenceAgain = `function openHours(s) { return s.items.filter(x => x.done === false).reduce((sum, x) => sum + x.hours, 0); }
function reduce(s, e) {
  const copy = { nextId: s.nextId, items: s.items.map(x => Object.assign({}, x)) };
  if (s.items.length > 4) throw new RangeError('state');
  switch (e.type) {
    case 0:
      if (!(e.hours >= 0) || !Number.isFinite(e.hours) || copy.items.length === 4) throw new RangeError('add');
      copy.items.push({ id: s.nextId, done: false, hours: e.hours, title: e.title });
      copy.nextId = s.nextId + 1;
      return copy;
    case 1: { const x = copy.items.find(y => y.id === e.id); if (!x) throw new RangeError('toggle'); x.done = !x.done; return copy; }
    case 2: { const k = copy.items.findIndex(y => y.id === e.id); if (k === -1) throw new RangeError('remove'); copy.items.splice(k, 1); return copy; }
    default: throw new RangeError('type');
  }
}`;
const countsDone = reference.replace('if (!i.done) total += i.hours', 'total += i.hours');
const declaredItem = { kind: 'record', fields: [{ name: 'id', kind: 'integer' }, { name: 'done', kind: 'boolean' }, { name: 'hours', kind: 'number', min: 0 }, { name: 'title', kind: 'text', maxBytes: 16 }] };
const declaredState = { kind: 'record', fields: [{ name: 'nextId', kind: 'integer' }, { name: 'items', kind: 'list', max: 4, items: declaredItem }] };
const declaredEvent = { kind: 'record', fields: [{ name: 'type', kind: 'code', codes: { 0: 'add', 1: 'toggle', 2: 'remove' } }, { name: 'id', kind: 'integer' }, { name: 'hours', kind: 'number' }, { name: 'title', kind: 'text', maxBytes: 16 }] };
const binding = (source = reference) => ({
  exports: [
    { name: 'reduce', params: [{ name: 'state', unit: '', ...declaredState }, { name: 'event', unit: '', ...declaredEvent }], result: { unit: '', ...declaredState }, monotone: [] },
    { name: 'openHours', params: [{ name: 'state', unit: '', ...declaredState }], result: { kind: 'number', unit: 'h', decimals: 2, min: 0, max: null }, monotone: [] },
  ], reference: source });
const reply = (path, value) => ({ text: JSON.stringify({ calls: [{ name: 'edit_file', path, content: JSON.stringify(value) }, { name: 'done' }] }), usage: 1 });
const sheet = { residual: ['A to-do list reducer and the open hours of a list.'], quantities: [], relations: [], invariants: ['value.reference', 'range.result'] };
const provider = bindings => scriptedProvider(({ session }) => (session.startsWith('need') ? reply('sheet.json', sheet) : reply('binding.json', bindings[Number(session.split('-')[1])] ?? bindings[0])));
async function frozen({ env = {}, bindings = [binding()] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'gaps4-synth-'));
  await writeFile(join(root, 'CONTRACT.md'), contract);
  await writeFile(join(root, 'tests.json'), JSON.stringify(tests));
  const stage = begin({ need: 'a to-do list reducer over records and lists', env, provider: provider(bindings) });
  await stage.finish(root);
  return { root, stage, evaluator: JSON.parse(await readFile(join(root, 'synth', 'evaluator.json'), 'utf8')) };
}
const key = value => JSON.stringify(value);
const frozenArgs = new Set(tests.map(t => key(t.args)));
const generated = (evaluator, fn) => evaluator.checks.vectors.filter(v => v.fn === fn && !frozenArgs.has(key(v.args)));
const todoCandidate = wasm => ({ compiled: { wasm }, files: { 'glue.json': JSON.stringify(glue) } });

test('S1: the binding prompt asks for the layout of structured parameters, so inputs can be generated from it', () => {
  assert.match(bindingShape.exports[0].params[0].kind, /record\|list\|text/);
  assert.match(prompts.binding(sheet, contract).instructions, /parameter takes a record, list or text, declare its full layout/);
});

test('S1: synthesis generates and qualifies structured vectors for exports over records and lists, at width 1', async () => {
  const { root, evaluator } = await frozen();
  try {
    const exports = evaluator.members[0].exports;
    assert.equal(exports.reduce.qualified, true, JSON.stringify(exports.reduce));
    assert.equal(exports.openHours.qualified, true, JSON.stringify(exports.openHours));
    const reduces = generated(evaluator, 'reduce'), hours = generated(evaluator, 'openHours');
    assert.ok(reduces.length >= 20, `reduce has ${reduces.length} generated vectors`);
    assert.ok(hours.length >= 10, `openHours has ${hours.length} generated vectors`);
    assert.ok(reduces.some(v => v.throws) && reduces.some(v => !v.throws), 'reduce vectors cover returns and traps');
    assert.ok(reduces.some(v => v.args[0].items.length >= 3), 'reduce vectors reach lists longer than any frozen test');
    assert.ok(reduces.some(v => !v.throws && v.args[1].type === 1 && v.args[0].items.some(i => i.id === v.args[1].id && i.done)), 'a done item is toggled back');
    assert.ok(hours.some(v => v.args[0].items.filter(i => !i.done).length >= 3), 'openHours sees three or more open items');
    for (const v of reduces.filter(r => !r.throws)) assert.ok(v.value && Array.isArray(v.value.items) && v.value.items.length <= 4, JSON.stringify(v));
    assert.deepEqual(evaluator.checks.ranges.filter(r => r.fn === 'openHours'), [{ fn: 'openHours', min: 0, max: undefined }].map(r => JSON.parse(JSON.stringify(r))));
    assert.ok(exports.reduce.discrimination.score >= 0.8, JSON.stringify(exports.reduce.discrimination));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('S1: the frozen structured vectors pass the correct reducer and refuse kernels the frozen tests miss', { skip: noCompiler, timeout: 120000 }, async () => {
  const { root, stage, evaluator } = await frozen();
  try {
    const kernels = {};
    for (const [name, kernel] of [['correct', source], ['togglesOnlyOn', togglesOnlyOn], ['firstTwoOnly', firstTwoOnly]]) {
      const compiled = await compile({ 'kernel.ts': kernel }, asc);
      assert.equal(compiled.error, undefined, name);
      kernels[name] = compiled.wasm;
    }
    const pass = await stage.evaluate(todoCandidate(kernels.correct));
    assert.equal(pass.decision, 'pass', JSON.stringify(pass.failures));
    assert.notEqual(pass.cell.thread, threadId);
    assert.ok(pass.vectors > tests.length, `${pass.vectors} vectors`);
    assert.equal(pass.skipped, 0);
    const toggle = await stage.evaluate(todoCandidate(kernels.togglesOnlyOn));
    assert.equal(toggle.decision, 'refuse');
    assert.match(toggle.failures.join('\n'), /value\.reference: reduce/);
    const partial = await stage.evaluate(todoCandidate(kernels.firstTwoOnly));
    assert.equal(partial.decision, 'refuse');
    assert.match(partial.failures.join('\n'), /value\.reference: openHours/);
    const local = judge(evaluator, todoCandidate(kernels.firstTwoOnly));
    assert.deepEqual(partial.failures, local.failures);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('S1: at width 2 structured vectors are kept where both references agree and an export one reference misreads keeps none', async () => {
  const agreeing = await frozen({ env: { ENDOFORGE_SYNTH_WIDTH: '2' }, bindings: [binding(reference), binding(referenceAgain)] });
  const split = await frozen({ env: { ENDOFORGE_SYNTH_WIDTH: '2' }, bindings: [binding(reference), binding(countsDone)] });
  try {
    assert.equal(agreeing.evaluator.width, 2);
    const reduces = generated(agreeing.evaluator, 'reduce');
    assert.ok(reduces.length >= 40, `reduce keeps ${reduces.length} vectors from both members`);
    assert.ok(generated(agreeing.evaluator, 'openHours').length >= 20);
    assert.equal(agreeing.evaluator.checks.ranges.filter(r => r.fn === 'openHours').length, 1);
    assert.ok(generated(split.evaluator, 'reduce').length >= 40);
    assert.equal(split.evaluator.members[1].exports.openHours.qualified, false);
    assert.deepEqual(split.evaluator.checks.vectors.filter(v => v.fn === 'openHours'), []);
    assert.deepEqual(split.evaluator.checks.ranges.filter(r => r.fn === 'openHours'), []);
  } finally { await Promise.all([agreeing, split].map(run => rm(run.root, { recursive: true, force: true }))); }
});

test('S1: codes and monotone relations are kept for exports over records, lists and text, and never over a structured parameter', async () => {
  const tagged = { kind: 'record', fields: [{ name: 'label', kind: 'text', maxBytes: 8 }, { name: 'weights', kind: 'list', max: 3, items: { kind: 'number', min: 0, max: 10 } }] };
  const structuredBinding = {
    exports: [
      { name: 'grade', params: [{ name: 'entry', ...tagged }], result: { kind: 'code', codes: { 0: 'empty', 1: 'light', 2: 'heavy' } }, monotone: [] },
      { name: 'scaled', params: [{ name: 'entry', ...tagged }, { name: 'factor', min: 0, max: 5 }], result: { kind: 'number', min: 0 },
        monotone: [{ param: 'factor', direction: 'increasing' }, { param: 'entry', direction: 'increasing' }] },
      { name: 'shout', params: [{ name: 'word', kind: 'text', maxBytes: 8 }], result: { kind: 'text', maxBytes: 8 }, monotone: [] },
    ],
    reference: `function grade(e) { const t = e.weights.reduce((a, b) => a + b, 0); return t === 0 ? 0 : t < 10 ? 1 : 2; }
function scaled(e, factor) { if (factor < 0 || factor > 5) throw Error('factor'); return e.weights.reduce((a, b) => a + b, 0) * factor; }
function shout(w) { return w.toUpperCase(); }`,
  };
  const frozenTests = [
    { name: 'empty', fn: 'grade', args: [{ label: 'a', weights: [] }], expect: 0 },
    { name: 'light', fn: 'grade', args: [{ label: 'b', weights: [1, 2] }], expect: 1 },
    { name: 'scale', fn: 'scaled', args: [{ label: 'c', weights: [1, 2] }, 2], expect: 6 },
    { name: 'shout', fn: 'shout', args: ['hey'], expect: 'HEY' },
  ];
  const member = await compileMember(structuredBinding, frozenTests);
  for (const fn of ['grade', 'scaled', 'shout']) assert.equal(member.exports[fn].qualified, true, `${fn}: ${JSON.stringify(member.exports[fn].failures)}`);
  assert.ok(member.exports.scaled.dropped.some(d => /monotone entry/.test(d)), JSON.stringify(member.exports.scaled.dropped));
  const checks = await combine([member]);
  assert.deepEqual(checks.codes.find(c => c.fn === 'grade').codes.sort(), ['0', '1', '2']);
  assert.ok(checks.vectors.filter(v => v.fn === 'grade').map(v => v.value).includes(2), 'a generated list reaches the heavy code');
  const monotone = checks.monotone.filter(m => m.fn === 'scaled');
  assert.deepEqual(monotone.map(m => [m.param, m.direction]), [[1, 'increasing']]);
  assert.ok(monotone[0].chain.length >= 3);
  assert.ok(monotone[0].chain.every(i => checks.vectors[i].fn === 'scaled'));
  assert.deepEqual(checks.ranges.find(r => r.fn === 'scaled'), { fn: 'scaled', min: 0, max: undefined });
  const words = checks.vectors.filter(v => v.fn === 'shout');
  assert.ok(words.length > 3 && words.every(v => typeof v.args[0] === 'string' && Buffer.byteLength(v.args[0]) <= 8 && v.value === v.args[0].toUpperCase()), JSON.stringify(words));
});

const addReply = (path, value) => ({ text: JSON.stringify({ calls: [{ name: 'edit_file', path, content: JSON.stringify(value) }, { name: 'done' }] }), usage: 1 });
const addProvider = () => scriptedProvider(({ session }) => (session.startsWith('need')
  ? addReply('sheet.json', { residual: ['Adds two integers.'], quantities: [], relations: [], invariants: [] })
  : addReply('binding.json', { exports: [{ name: 'add', params: ['a', 'b'].map(name => ({ name, unit: '1', min: -10, max: 10, integer: true })), result: { kind: 'number', unit: '1' } }], reference: 'function add(a, b) { return a + b; }' })));
const { files } = additionCandidate();
const fixtures = here('./fixtures/x1/');

test('S2: on the isolate and agent paths the commit judges with the caller\'s synthesis cell limits', { timeout: 180000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'gaps4-synth-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const isolateEnv = { ...process.env, CODEX_HOME: join(root, 'unused-home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_LOOP: 'isolate', ENDOFORGE_SYNTH: '1',
    ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, join(fixtures, 'fake-codex.mjs')]), FAKE_CODEX_KERNEL: good.kernel, FAKE_CODEX_GLUE: good.glue };
  const isolatePool = createLoopPool({ primes: 1 });
  t.after(() => isolatePool.close());
  const agentPool = createLoopPool({ primes: 1, provider: scriptedProvider(modelFor(inputFor(files['CONTRACT.md'], files['tests.json'], good.kernel, good.glue))) });
  t.after(() => agentPool.close());
  const runs = {
    isolate: options => runNeed({ need: 'integer add(a,b)', pool: isolatePool, env: isolateEnv, synthProvider: addProvider(), ...options }),
    agent: options => runNeed({ need: 'integer add(a,b)', pool: agentPool, env: { ENDOFORGE_LOOP: 'agent', ENDOFORGE_SYNTH: '1' }, synthProvider: addProvider(), ...options }),
  };
  for (const [path, run] of Object.entries(runs)) {
    const late = await run({ directory: join(root, `${path}-late`), synthCell: { deadlineMs: 1 } });
    assert.equal(late.promoted, false, `${path}: ${JSON.stringify(late)}`);
    assert.equal(late.synthesis?.decision, 'refuse', path);
    assert.equal(late.synthesis.reason, 'cell_timeout', path);
    assert.equal(late.problem, 'synthesized evaluator refused the candidate', path);
    const roomy = await run({ directory: join(root, `${path}-roomy`), synthCell: { deadlineMs: 60000, resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } } });
    assert.equal(roomy.promoted, true, `${path}: ${JSON.stringify(roomy)}`);
    assert.equal(roomy.synthesis.decision, 'pass', path);
    assert.notEqual(roomy.synthesis.cell.thread, threadId, path);
  }
});
