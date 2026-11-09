import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect, loadKernel, meter } from '../x1/meter.mjs';
import { invoke } from '../x1/measure.mjs';
import { link } from '../../library/link.mjs';
import { applied, mutantsOf } from '../../library/mutants.mjs';
import { accepted, discriminate, fingerprint, gridFor, loaded } from '../../library/discriminate.mjs';

const leb = value => { const out = []; let n = value; do { const part = n % 128; n = Math.floor(n / 128); out.push(part | (n ? 128 : 0)); } while (n); return out; };
const sec = (id, content) => (content.length ? [id, ...leb(content.length), ...content] : []);
const vec = rows => [...leb(rows.length), ...rows.flat()];
const str = text => [...leb(Buffer.byteLength(text)), ...Buffer.from(text)];
const I32 = 0x7f;
const f64 = value => { const out = new Uint8Array(8); new DataView(out.buffer).setFloat64(0, value, true); return [...out]; };
const assemble = ({ types = [], funcs = [], memories = [], exports = [] }) => Uint8Array.from([
  0, 97, 115, 109, 1, 0, 0, 0,
  ...sec(1, vec(types.map(([params, results]) => [0x60, ...vec(params.map(p => [p])), ...vec(results.map(r => [r]))]))),
  ...sec(3, vec(funcs.map(f => leb(f.type)))),
  ...(memories.length ? sec(5, vec(memories.map(m => [1, ...leb(m.initial), ...leb(m.max)]))) : []),
  ...sec(7, vec(exports.map(([name, kind, index]) => [...str(name), kind, index]))),
  ...sec(10, vec(funcs.map(f => { const body = [0, ...f.code, 0x0b]; return [...leb(body.length), ...body]; }))),
]);
const counter = (name, step) => assemble({
  types: [[[], [I32]]],
  funcs: [{ type: 0, code: [0x41, 0, 0x41, 0, 0x28, 2, 0, 0x41, step, 0x6a, 0x36, 2, 0, 0x41, 0, 0x28, 2, 0] }],
  memories: [{ initial: 1, max: 1 }], exports: [[name, 0, 0]] });
const recordStep = (name, delta, scale) => assemble({
  types: [[[I32, I32], []]],
  funcs: [{ type: 0, code: [0x20, 1, 0x20, 0, 0x2b, 3, 0, 0x44, ...f64(scale), 0xa2, 0x44, ...f64(delta), 0xa0, 0x39, 3, 0] }],
  memories: [{ initial: 1, max: 2 }], exports: [[name, 0, 0]] });
const inc = recordStep('inc', 1, 1), dbl = recordStep('dbl', 0, 2);
const balance = { kind: 'record', label: 'Balance', fields: [{ name: 'total', kind: 'number', unit: 'kg', label: 'Total', precision: 2 }] };
const stepEntry = name => ({ name, args: [{ ...balance, name: 'state' }], result: balance });
const twoMemories = assemble({
  types: [[[I32, I32], [I32]]],
  funcs: [{ type: 0, code: [0x41, 0, 0x20, 0, 0x36, 2, 0, 0x41, 0, 0x20, 1, 0x36, 0x42, 1, 0, 0x41, 0, 0x28, 2, 0, 0x41, 0, 0x28, 0x42, 1, 0, 0x6a] }],
  memories: [{ initial: 1, max: 1 }, { initial: 2, max: 2 }], exports: [['both', 0, 0]] });
const pipeline = () => link([inc, dbl], { wrappers: [{ name: 'step', params: ['i32', 'i32'], bufferResult: 8, stages: [
  { part: 0, fn: 'inc', args: [{ input: 0 }], buffers: { args: [8], out: 8 } },
  { part: 1, fn: 'dbl', args: [{ previous: true }], buffers: { args: [8], out: 8 } }] }] });

test('K3: the meter reads every memory of a multi-memory module and meters accesses to each', () => {
  const shape = inspect(twoMemories);
  assert.deepEqual(shape.memories.map(m => m.initial), [1, 2]);
  const kernel = loadKernel(twoMemories, 1_000_000).start(() => {});
  assert.equal(kernel.instance.exports.both(3, 4), 7);
  assert.ok(kernel.used() > 0);
  assert.equal(kernel.memories().length, 2);
  assert.equal(kernel.memoryBytes(), 3 * 65536);
  assert.equal(new DataView(kernel.memories()[1].buffer).getInt32(0, true), 4);
  assert.equal(new DataView(kernel.memory().buffer).getInt32(0, true), 3);
  const starved = loadKernel(twoMemories, 3).start(() => {});
  assert.throws(() => starved.instance.exports.both(1, 2), WebAssembly.RuntimeError);
});

test('K3: a composition gives each part its own WebAssembly memory, and the meter reads them all', () => {
  const bytes = link([counter('a', 1), counter('b', 10)], { exports: [{ name: 'a', part: 0, fn: 'a' }, { name: 'b', part: 1, fn: 'b' }] });
  assert.equal(inspect(bytes).memories.length, 3);
  const kernel = loadKernel(Buffer.from(bytes), 1_000_000).start(() => {});
  const { a, b } = kernel.instance.exports;
  assert.deepEqual([a(), a(), b(), a(), b()], [1, 2, 10, 3, 20]);
  const words = kernel.memories().map(memory => (memory.buffer.byteLength ? new DataView(memory.buffer).getInt32(0, true) : null));
  assert.deepEqual(words, [null, 3, 20]);
  assert.equal(kernel.memoryBytes(), kernel.memories().reduce((sum, memory) => sum + memory.buffer.byteLength, 0));
});

test('K3: structured state crosses between parts only as a host-mediated copy through the composed glue', () => {
  const bytes = pipeline();
  assert.equal(inspect(bytes).memories.length, 3);
  const kernel = loadKernel(Buffer.from(bytes), 1_000_000).start(() => {});
  const entry = stepEntry('step');
  assert.deepEqual(invoke(kernel, entry, 'step', [{ total: 3 }]), { total: 8 });
  assert.deepEqual(invoke(kernel, entry, 'step', [{ total: -1.5 }]), { total: -1 });
  const [host, first, second] = kernel.memories();
  assert.ok(host.buffer.byteLength > 0);
  const window = memory => new DataView(memory.buffer).getFloat64(65536, true);
  assert.equal(window(first), -1.5);
  assert.equal(window(second), -0.5);
  assert.ok(kernel.used() > 0);
});

test('K3: composed multi-memory modules mutate into valid, meterable modules', () => {
  const bytes = pipeline();
  const { sites } = mutantsOf(bytes);
  assert.ok(sites.length > 0);
  for (const site of sites) meter(Buffer.from(applied(bytes, site)), 1000);
  for (const site of sites) new WebAssembly.Module(applied(bytes, site));
});

test('K4: the mutation grid holds structured values built from the declared layout', () => {
  const item = stepEntry('inc');
  const grid = gridFor(item, [{ fn: 'inc', args: [{ total: 3 }], expect: { total: 4 } }], [7]);
  assert.ok(grid.length > 4);
  assert.ok(grid.every(row => row.length === 1 && typeof row[0].total === 'number'));
  assert.ok(new Set(grid.map(row => row[0].total)).size > 4);
  assert.ok(grid.some(row => row[0].total === 7));
  const call = loaded(inc, WebAssembly, new Map([['inc', item]]));
  assert.deepEqual(call('inc', [{ total: 2 }]), { value: { total: 3 } });
  assert.equal(accepted({ fn: 'inc', args: [{ total: 2 }], expect: { total: 3 } }, call('inc', [{ total: 2 }])), true);
  assert.equal(accepted({ fn: 'inc', args: [{ total: 2 }], expect: { total: 4 } }, call('inc', [{ total: 2 }])), false);
  const bad = call('inc', [{ total: 'x' }]);
  assert.ok(bad.problem);
  assert.equal(accepted({ fn: 'inc', args: [{ total: 'x' }], expect: { total: 1 } }, bad), false);
});

test('K4: weak structured tests leave surviving mutants; strong ones kill them', () => {
  const capability = { exports: [stepEntry('inc')], traps: [] };
  const weak = discriminate({ bytes: inc, tests: [{ fn: 'inc', args: [{ total: 0 }], expect: { total: 1 } }], capability, numbers: [0.25] });
  assert.equal(weak.unsupported, null);
  assert.ok(weak.mutants > 0);
  assert.ok(weak.survivors.length > 0, JSON.stringify(weak));
  assert.ok(weak.survivors.every(s => typeof s.args[0].total === 'number'));
  assert.ok(weak.wrappers.total > 0);
  assert.ok(weak.wrappers.survivors.length > 0, JSON.stringify(weak.wrappers));
  const strong = discriminate({ bytes: inc, tests: [
    { fn: 'inc', args: [{ total: 3 }], expect: { total: 4 } }, { fn: 'inc', args: [{ total: 1.37 }], expect: { total: 2.37 }, tol: 1e-9 },
    { fn: 'inc', args: [{ total: -2.5 }], expect: { total: -1.5 } }], capability, numbers: [] });
  assert.equal(strong.survivors.length + strong.wrappers.survivors.length, 0, JSON.stringify(strong));
  assert.ok(strong.killed > 0);
});

const todo = Buffer.from('AGFzbQEAAAABGARgBH9/f38AYAF/AX9gA39/fwBgAX8BfAINAQNlbnYFYWJvcnQAAAMEAwECAwUFAQEAgAgHHwMGcmVkdWNlAAIJb3BlbkhvdXJzAAMGbWVtb3J5AgAK0QQDXQICfwF8IAAoAggiAkEESwRAQQBBAEEAQQAQAAsDQCABIAJJBEAgAEEQaiABQShsaisDCCIDIAOhRAAAAAAAAAAAYgRAQQBBAEEAQQAQAAsgAUEBaiEBDAELCyACC68DAgF8An8gABABIQQgAiAAQbAB/AoAACABKAIEIQAgASgCACIFBEAgBUEBRgRAIAIoAgghBEEAIQECQANAIAEgBEkEQCACQRBqIAFBKGxqKAIAIABGDQIgAUEBaiEBDAELC0F/IQELIAFBAEgEQEEAQQBBAEEAEAALIAIgAUEobGoiAEEUaiAAKAIUQQFzNgIABSAFQQJGBEAgAigCCCEFQQAhAQJAA0AgASAFSQRAIAJBEGogAUEobGooAgAgAEYNAiABQQFqIQEMAQsLQX8hAQsgAUEASARAQQBBAEEAQQAQAAsgAUEobCIAIAJBEGpqIAAgAmpBOGogBEEBayIAIAFrQShs/AoAACACIARBKGxqQRhrQQBBKPwLACACIAA2AggFQQBBAEEAQQAQAAsLBSAEQQRPIAErAwgiAyADoUQAAAAAAAAAAGJyIANEAAAAAAAAAABjcgRAQQBBAEEAQQAQAAsgAkEQaiAEQShsaiIAIAIoAgAiBTYCACAAQQA2AgQgACADOQMIIABBEGogAUEQakEU/AoAACACIARBAWo2AgggAiAFQQFqNgIACwtAAgF8A38gABABIQMDQCACIANJBEAgAEEQaiACQShsaiIEKAIERQRAIAEgBCsDCKAhAQsgAkEBaiECDAELCyABCw==', 'base64');
const todoItem = { kind: 'record', fields: [
  { name: 'id', kind: 'integer', unit: '1' }, { name: 'done', kind: 'boolean', unit: '1', labels: { true: 'Done', false: 'Open' } },
  { name: 'hours', kind: 'number', unit: 'h', precision: 2 }, { name: 'title', kind: 'text', maxBytes: 16 }] };
const stateType = { kind: 'record', label: 'To-do list', fields: [{ name: 'nextId', kind: 'integer', unit: '1' }, { name: 'items', kind: 'list', max: 4, items: todoItem }] };
const eventType = { kind: 'record', label: 'Event', fields: [
  { name: 'type', kind: 'code', unit: '1', codes: { 0: 'Add an item', 1: 'Toggle an item', 2: 'Remove an item' } },
  { name: 'id', kind: 'integer', unit: '1' }, { name: 'hours', kind: 'number', unit: 'h' }, { name: 'title', kind: 'text', maxBytes: 16 }] };
const todoCapability = { exports: [
  { name: 'reduce', args: [{ name: 'state', ...stateType }, { name: 'event', ...eventType }], result: stateType },
  { name: 'openHours', args: [{ name: 'state', ...stateType }], result: { kind: 'number', unit: 'h', precision: 2 } }], traps: ['reduce'] };
const milk = { id: 1, done: false, hours: 0.5, title: 'buy milk' }, bike = { id: 2, done: false, hours: 2.25, title: 'fix the bike' };
const event = (type, id, hours = 0, title = '') => ({ type, id, hours, title });
const one = { nextId: 2, items: [milk] }, two = { nextId: 3, items: [milk, bike] }, toggled = { nextId: 3, items: [{ ...milk, done: true }, bike] };
const todoTests = [
  { name: 'add', fn: 'reduce', args: [{ nextId: 1, items: [] }, event(0, 0, 0.5, 'buy milk')], expect: one },
  { name: 'add second', fn: 'reduce', args: [one, event(0, 0, 2.25, bike.title)], expect: two },
  { name: 'toggle', fn: 'reduce', args: [two, event(1, 1)], expect: toggled },
  { name: 'remove first', fn: 'reduce', args: [two, event(2, 1)], expect: { nextId: 3, items: [bike] } },
  { name: 'remove last', fn: 'reduce', args: [two, event(2, 2)], expect: { nextId: 3, items: [milk] } },
  { name: 'open hours', fn: 'openHours', args: [toggled], expect: 2.25 },
  { name: 'open hours empty', fn: 'openHours', args: [{ nextId: 1, items: [] }], expect: 0 },
  { name: 'missing', fn: 'reduce', args: [one, event(1, 7)], expectError: true },
  { name: 'negative hours', fn: 'reduce', args: [one, event(0, 0, -1, 'x')], expectError: true },
  { name: 'unknown type', fn: 'reduce', args: [one, event(9, 1)], expectError: true },
];

test('K4: a record-and-list reducer gets a real mutation check', () => {
  const call = loaded(todo, WebAssembly, new Map(todoCapability.exports.map(entry => [entry.name, entry])));
  for (const t of todoTests) assert.equal(accepted(t, call(t.fn, t.args)), true, t.name);
  const grid = gridFor(todoCapability.exports[0], todoTests, []);
  assert.ok(grid.length > 16);
  assert.ok(grid.every(args => args.length === 2 && Array.isArray(args[0].items) && typeof args[1].type === 'number'));
  assert.ok(new Set(grid.map(args => args[0].items.length)).size > 1);
  assert.ok(new Set(grid.map(args => args[1].type)).size >= 3);
  const full = discriminate({ bytes: todo, tests: todoTests, capability: todoCapability, numbers: [] });
  assert.equal(full.unsupported, null);
  assert.equal(full.invalid, 0);
  assert.ok(full.killed > 0);
  assert.equal(full.mutants, full.killed + full.equivalent + full.survivors.length);
  const weak = discriminate({ bytes: todo, tests: todoTests.slice(0, 1), capability: todoCapability, numbers: [] });
  assert.ok(weak.survivors.length > full.survivors.length, `${weak.survivors.length} vs ${full.survivors.length}`);
  assert.ok(weak.survivors.some(s => s.fn === 'reduce' && Array.isArray(s.args[0].items)));
  const prints = fingerprint({ bytes: todo, capability: todoCapability, numbers: [] });
  assert.ok(prints[0].length > 1 && prints[0].some(row => row.startsWith('{')));
});
