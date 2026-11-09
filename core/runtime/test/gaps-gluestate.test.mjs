import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { stagePrompts } from '../x1/agent.mjs';
import { compile } from '../x1/compiler.mjs';
import { runGates, testProblems } from '../x1/gates.mjs';
import { hash } from '../x1/host.mjs';
import { layoutOf, layoutTable, measuredPort, probeCalls } from '../x1/measure.mjs';
import { candidate as additionCandidate } from './fixtures/x1/candidate.mjs';

const asc = fileURLToPath(new URL('../../../tools/asc/node_modules/.bin/asc', import.meta.url));
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
const mutatingSource = source.replace('memory.copy(out, state, STATE);', 'memory.copy(out, state, STATE);\n  store<i32>(state, 99);');
const wasm = {
  todo: 'AGFzbQEAAAABGARgBH9/f38AYAF/AX9gA39/fwBgAX8BfAINAQNlbnYFYWJvcnQAAAMEAwECAwUFAQEAgAgHHwMGcmVkdWNlAAIJb3BlbkhvdXJzAAMGbWVtb3J5AgAK0QQDXQICfwF8IAAoAggiAkEESwRAQQBBAEEAQQAQAAsDQCABIAJJBEAgAEEQaiABQShsaisDCCIDIAOhRAAAAAAAAAAAYgRAQQBBAEEAQQAQAAsgAUEBaiEBDAELCyACC68DAgF8An8gABABIQQgAiAAQbAB/AoAACABKAIEIQAgASgCACIFBEAgBUEBRgRAIAIoAgghBEEAIQECQANAIAEgBEkEQCACQRBqIAFBKGxqKAIAIABGDQIgAUEBaiEBDAELC0F/IQELIAFBAEgEQEEAQQBBAEEAEAALIAIgAUEobGoiAEEUaiAAKAIUQQFzNgIABSAFQQJGBEAgAigCCCEFQQAhAQJAA0AgASAFSQRAIAJBEGogAUEobGooAgAgAEYNAiABQQFqIQEMAQsLQX8hAQsgAUEASARAQQBBAEEAQQAQAAsgAUEobCIAIAJBEGpqIAAgAmpBOGogBEEBayIAIAFrQShs/AoAACACIARBKGxqQRhrQQBBKPwLACACIAA2AggFQQBBAEEAQQAQAAsLBSAEQQRPIAErAwgiAyADoUQAAAAAAAAAAGJyIANEAAAAAAAAAABjcgRAQQBBAEEAQQAQAAsgAkEQaiAEQShsaiIAIAIoAgAiBTYCACAAQQA2AgQgACADOQMIIABBEGogAUEQakEU/AoAACACIARBAWo2AgggAiAFQQFqNgIACwtAAgF8A38gABABIQMDQCACIANJBEAgAEEQaiACQShsaiIEKAIERQRAIAEgBCsDCKAhAQsgAkEBaiECDAELCyABCw==',
  mutating: 'AGFzbQEAAAABGARgBH9/f38AYAF/AX9gA39/fwBgAX8BfAINAQNlbnYFYWJvcnQAAAMEAwECAwUFAQEAgAgHHwMGcmVkdWNlAAIJb3BlbkhvdXJzAAMGbWVtb3J5AgAK2QQDXQICfwF8IAAoAggiAkEESwRAQQBBAEEAQQAQAAsDQCABIAJJBEAgAEEQaiABQShsaisDCCIDIAOhRAAAAAAAAAAAYgRAQQBBAEEAQQAQAAsgAUEBaiEBDAELCyACC7cDAgF8An8gABABIQQgAiAAQbAB/AoAACAAQeMANgIAIAEoAgQhACABKAIAIgUEQCAFQQFGBEAgAigCCCEEQQAhAQJAA0AgASAESQRAIAJBEGogAUEobGooAgAgAEYNAiABQQFqIQEMAQsLQX8hAQsgAUEASARAQQBBAEEAQQAQAAsgAiABQShsaiIAQRRqIAAoAhRBAXM2AgAFIAVBAkYEQCACKAIIIQVBACEBAkADQCABIAVJBEAgAkEQaiABQShsaigCACAARg0CIAFBAWohAQwBCwtBfyEBCyABQQBIBEBBAEEAQQBBABAACyABQShsIgAgAkEQamogACACakE4aiAEQQFrIgAgAWtBKGz8CgAAIAIgBEEobGpBGGtBAEEo/AsAIAIgADYCCAVBAEEAQQBBABAACwsFIARBBE8gASsDCCIDIAOhRAAAAAAAAAAAYnIgA0QAAAAAAAAAAGNyBEBBAEEAQQBBABAACyACQRBqIARBKGxqIgAgAigCACIFNgIAIABBADYCBCAAIAM5AwggAEEQaiABQRBqQRT8CgAAIAIgBEEBajYCCCACIAVBAWo2AgALC0ACAXwDfyAAEAEhAwNAIAIgA0kEQCAAQRBqIAJBKGxqIgQoAgRFBEAgASAEKwMIoCEBCyACQQFqIQIMAQsLIAEL',
};
const contract = [
  'A to-do list reducer: the state holds the next id and at most four items, each with an id, a done flag, estimated hours and a title of at most sixteen UTF-8 bytes.',
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
const full = { nextId: 5, items: [1, 2, 3, 4].map(id => ({ id, done: false, hours: 1, title: `t${id}` })) };
const todoTests = [
  { name: 'add to an empty list', fn: 'reduce', args: [{ nextId: 1, items: [] }, event(0, 0, 0.5, 'buy milk')], expect: one },
  { name: 'add a second item', fn: 'reduce', args: [one, event(0, 0, 2.25, bike.title)], expect: two },
  { name: 'toggle the first item', fn: 'reduce', args: [two, event(1, 1)], expect: toggled },
  { name: 'remove the first item', fn: 'reduce', args: [two, event(2, 1)], expect: { nextId: 3, items: [bike] } },
  { name: 'remove the last item', fn: 'reduce', args: [two, event(2, 2)], expect: { nextId: 3, items: [milk] } },
  { name: 'open hours', fn: 'openHours', args: [toggled], expect: 2.25 },
  { name: 'open hours of an empty list', fn: 'openHours', args: [{ nextId: 1, items: [] }], expect: 0 },
  { name: 'toggle a missing item', fn: 'reduce', args: [one, event(1, 7)], expectError: true },
  { name: 'add to a full list', fn: 'reduce', args: [full, event(0, 0, 1, 'more')], expectError: true },
  { name: 'add negative hours', fn: 'reduce', args: [one, event(0, 0, -1, 'x')], expectError: true },
  { name: 'unknown event type', fn: 'reduce', args: [one, event(9, 1)], expectError: true },
];
function todoCandidate({ kernel = source, module = wasm.todo, tests = todoTests, glueValue = glue } = {}) {
  const files = { 'CONTRACT.md': contract, 'kernel.ts': kernel, 'tests.json': JSON.stringify(tests), 'glue.json': JSON.stringify(glueValue) };
  files['frozen.sha256'] = JSON.stringify({ contract: hash(files['CONTRACT.md']), tests: hash(files['tests.json']) });
  return { id: 'todo', files, compiled: { source: hash(kernel), wasm: module } };
}
const failing = result => Object.entries(result.gates).filter(([, gate]) => !gate.ok).map(([name, gate]) => `${name}: ${gate.why}`);

test('G28: the declared layout places records, lists and text at fixed little-endian offsets with natural alignment', () => {
  const state = layoutOf(stateType), events = layoutOf(eventType);
  assert.equal(state.size, 176);
  assert.equal(events.size, 40);
  assert.deepEqual(layoutTable(stateType), [
    { path: 'nextId', offset: 0, type: 'i32' },
    { path: 'items.count', offset: 8, type: 'u32' },
    { path: 'items[i].id', offset: 16, stride: [40], type: 'i32' },
    { path: 'items[i].done', offset: 20, stride: [40], type: 'i32' },
    { path: 'items[i].hours', offset: 24, stride: [40], type: 'f64' },
    { path: 'items[i].title.bytes', offset: 32, stride: [40], type: 'u32' },
    { path: 'items[i].title.utf8', offset: 36, stride: [40], type: 'u8[16]' },
  ]);
  assert.throws(() => layoutOf({ kind: 'list', items: { kind: 'integer', unit: '1' } }), /max/);
  assert.throws(() => layoutOf({ kind: 'list', max: 1 << 20, items: { kind: 'number', unit: '1' } }), /exceeds/);
});

test('G28: a to-do list reducer over records and lists passes every gate with state in and state out', () => {
  const result = runGates(todoCandidate());
  assert.deepEqual(failing(result), [], JSON.stringify(result.tests.filter(entry => !entry.pass)));
  assert.equal(result.promotable, true);
  assert.equal(result.gates.G4_tests.passed, todoTests.length);
  assert.deepEqual(result.tests[2].got, toggled);
  assert.equal(result.tests[1].got.items[1].title, bike.title);
  assert.equal(result.tests[5].got, 2.25);
  assert.ok(result.gates.G8_nonfinite.probes > 0);
});

test('G28: a wrong expected state fails the tests gate, so structured comparison is not vacuous', () => {
  const tests = structuredClone(todoTests);
  tests[2].expect.items[0].done = false;
  const result = runGates(todoCandidate({ tests }));
  assert.equal(result.gates.G4_tests.ok, false);
  assert.equal(result.tests[2].pass, false);
  assert.equal(result.promotable, false);
});

test('G28: a kernel that writes into its read-only state buffer is refused, not passed', () => {
  const result = runGates(todoCandidate({ kernel: mutatingSource, module: wasm.mutating }));
  assert.equal(result.gates.G4_tests.ok, false);
  assert.match(String(result.tests[0].got), /read-only input/);
  assert.equal(result.promotable, false);
});

test('G28: a value that does not fit its declared layout fails at the boundary and never counts as a trap', () => {
  const tests = [...todoTests, { name: 'five items', fn: 'openHours', args: [{ nextId: 6, items: [...full.items, { id: 5, done: false, hours: 1, title: 'x' }] }], expectError: true },
    { name: 'long title', fn: 'reduce', args: [one, event(0, 0, 1, 'a title far longer than sixteen bytes')], expectError: true }];
  const result = runGates(todoCandidate({ tests }));
  assert.equal(result.gates.G4_tests.ok, false);
  assert.match(String(result.tests.at(-2).got), /more than 4/);
  assert.match(String(result.tests.at(-1).got), /16 bytes/);
  assert.equal(result.tests.at(-1).trap, undefined);
});

test('G28: glue for structured state is checked against the module and the declared layout', () => {
  const noMax = structuredClone(glue);
  delete noMax.exports[0].args[0].fields[1].max;
  assert.match(runGates(todoCandidate({ glueValue: noMax })).gates.G7_glue.why, /reduce\.state\.items: list without max/);
  const scalarResult = structuredClone(glue);
  scalarResult.exports[0].result = { kind: 'integer', unit: '1' };
  assert.match(runGates(todoCandidate({ glueValue: scalarResult })).gates.G7_glue.why, /reduce: glue lists 2 args, the export takes 3/);
  const unlabelled = structuredClone(glue);
  delete unlabelled.exports[0].args[1].fields[0].codes;
  assert.match(runGates(todoCandidate({ glueValue: unlabelled })).gates.G7_glue.why, /reduce\.event\.type: code value without a codes table/);
  const noPrecision = structuredClone(glue);
  delete noPrecision.exports[0].result.fields[1].items.fields[2].precision;
  assert.match(runGates(todoCandidate({ glueValue: noPrecision })).gates.G7_glue.why, /reduce result\.items\[\]\.hours: number value without precision/);
  const badKind = structuredClone(glue);
  badKind.exports[0].args[0].fields[0].kind = 'pointer';
  assert.equal(runGates(todoCandidate({ glueValue: badKind })).gates.G7_glue.ok, false);
});

test('G28: non-finite probes reach number fields inside structured state', () => {
  const entries = new Map(glue.exports.map(entry => [entry.name, entry]));
  const calls = probeCalls(todoTests, { reduce: { params: ['i32', 'i32', 'i32'], results: [] }, openHours: { params: ['i32'], results: ['f64'] } }, entries);
  assert.ok(calls.some(call => call.fn === 'reduce' && Number.isNaN(call.args[1].hours)));
  assert.ok(calls.some(call => call.fn === 'openHours' && call.args[0].items.some(entry => entry.hours === Infinity)));
  assert.ok(calls.every(call => call.args.every(arg => typeof arg === 'object')));
});

test('G28: the measured commit port runs structured frozen tests and records the decoded state', () => {
  const candidate = todoCandidate(), port = measuredPort(() => candidate);
  assert.equal(port.describe('todo').name, 'x1.kernel');
  const run = port.run('todo', [{ id: 'frozen-tests' }], { wallMs: 30000 });
  assert.equal(run.status, 'completed');
  const calls = run.outputs[0].value.calls;
  assert.deepEqual(calls[2].value, toggled);
  assert.equal(calls[7].trap, 'abort');
});

test('G28: scalar kernels keep their behaviour', () => {
  const result = runGates(additionCandidate());
  assert.deepEqual(failing(result), []);
  assert.equal(result.tests[0].got, 5);
});

test('G28: frozen tests can hold structured state, still with finite leaves and bounded tolerance', () => {
  assert.deepEqual(testProblems(todoTests), []);
  assert.deepEqual(testProblems([{ fn: 'f', args: [], expect: { a: [1, 2.5], b: 'x', c: true } }]), []);
  assert.match(testProblems([{ fn: 'f', args: [], expect: { a: [null] } }])[0], /null/);
  assert.match(testProblems([{ fn: 'f', args: [{ a: 1 }], expect: [Infinity] }])[0], /non-finite/);
  assert.match(testProblems([{ fn: 'add', args: [2, 3], expect: [5] }])[0], /list from scalar arguments/);
  assert.deepEqual(testProblems([{ fn: 'f', args: [[1, 2]], expect: [2, 1] }]), []);
  assert.match(testProblems([{ fn: 'f', args: [], expect: { a: 100 }, tol: 5 }])[0], /tol above/);
  assert.deepEqual(testProblems([{ fn: 'f', args: [], expect: { a: 100, b: [200] }, tol: 0.5 }]), []);
});

test('G28: the agent stages describe structured state and its layout', () => {
  const specification = JSON.parse(stagePrompts.specification({ need: 'a to-do list', id: 'todo' }));
  assert.match(specification.instructions, /records, lists and text/);
  const implementation = JSON.parse(stagePrompts.implementation({ id: 'todo' }));
  assert.ok(implementation.stateRules.some(rule => /host-owned linear-memory buffer/.test(rule)));
  assert.ok(implementation.stateRules.some(rule => /little-endian/.test(rule)));
  assert.ok(['record', 'list', 'text'].every(kind => implementation.glueSchema.$defs.kind.enum.includes(kind)));
});

test('G28: the embedded to-do modules are what the pinned compiler builds from their sources', { skip: !existsSync(asc) && 'run make loop-setup to install the pinned AssemblyScript compiler' }, async () => {
  for (const [name, kernel] of [['todo', source], ['mutating', mutatingSource]]) {
    const compiled = await compile({ 'kernel.ts': kernel }, asc);
    assert.equal(compiled.error, undefined);
    assert.equal(compiled.wasm, wasm[name], name);
  }
});
