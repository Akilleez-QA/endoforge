import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ASC_PATH } from './asc/pin.mjs';

const gate = fileURLToPath(new URL('./gate/gate.mjs', import.meta.url));
const asc = fileURLToPath(new URL('./asc/node_modules/.bin/asc', import.meta.url));
const coreSchema = JSON.parse(readFileSync(new URL('../core/runtime/x1/glue.schema.json', import.meta.url), 'utf8'));
const gateSchema = JSON.parse(readFileSync(new URL('./gate/glue.schema.json', import.meta.url), 'utf8'));

const kernel = `const ITEM: usize = 40;
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
const mutatingKernel = kernel.replace('memory.copy(out, state, STATE);', 'memory.copy(out, state, STATE);\n  store<i32>(state, 99);');
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

const shippingKernel = `export function shippingCents(grams: i32, zone: i32): i32 {
  if (grams < 0 || (zone != 1 && zone != 2)) unreachable();
  return 500 + grams * (zone == 1 ? 2 : 4);
}
`;
const shippingContract = 'shippingCents(grams, zone): 500 cents base plus 2 cents per gram in zone 1, 4 cents per gram in zone 2.\nRefuse negative weights and any other zone.\n';
const shippingTests = [
  { name: '1 kg, zone 1', fn: 'shippingCents', args: [1000, 1], expect: 2500 },
  { name: '1 kg, zone 2', fn: 'shippingCents', args: [1000, 2], expect: 4500 },
  { name: 'zone 3 is refused', fn: 'shippingCents', args: [1000, 3], expectError: true },
  { name: 'negative weight is refused', fn: 'shippingCents', args: [-1, 1], expectError: true },
];
const shippingGlue = {
  id: 'shipping', assumption: 'Weights are whole grams and only zones 1 and 2 ship.', question: 'Do any parcels ship outside zones 1 and 2?',
  exports: [{ name: 'shippingCents', label: 'Shipping price for one parcel', headline: true,
    args: [{ name: 'grams', kind: 'integer', unit: 'g' }, { name: 'zone', kind: 'code', unit: 'code', codes: { 1: 'domestic', 2: 'international' } }],
    result: { kind: 'integer', unit: 'cents' } }],
  traps: [{ fn: 'shippingCents', when: 'negative weight or unknown zone', message: 'Give a weight of 0 g or more and zone 1 or 2.' }],
};

const prebuilt = {
  todo: 'AGFzbQEAAAABGARgBH9/f38AYAF/AX9gA39/fwBgAX8BfAINAQNlbnYFYWJvcnQAAAMEAwECAwUFAQEAgAgHHwMGcmVkdWNlAAIJb3BlbkhvdXJzAAMGbWVtb3J5AgAK0QQDXQICfwF8IAAoAggiAkEESwRAQQBBAEEAQQAQAAsDQCABIAJJBEAgAEEQaiABQShsaisDCCIDIAOhRAAAAAAAAAAAYgRAQQBBAEEAQQAQAAsgAUEBaiEBDAELCyACC68DAgF8An8gABABIQQgAiAAQbAB/AoAACABKAIEIQAgASgCACIFBEAgBUEBRgRAIAIoAgghBEEAIQECQANAIAEgBEkEQCACQRBqIAFBKGxqKAIAIABGDQIgAUEBaiEBDAELC0F/IQELIAFBAEgEQEEAQQBBAEEAEAALIAIgAUEobGoiAEEUaiAAKAIUQQFzNgIABSAFQQJGBEAgAigCCCEFQQAhAQJAA0AgASAFSQRAIAJBEGogAUEobGooAgAgAEYNAiABQQFqIQEMAQsLQX8hAQsgAUEASARAQQBBAEEAQQAQAAsgAUEobCIAIAJBEGpqIAAgAmpBOGogBEEBayIAIAFrQShs/AoAACACIARBKGxqQRhrQQBBKPwLACACIAA2AggFQQBBAEEAQQAQAAsLBSAEQQRPIAErAwgiAyADoUQAAAAAAAAAAGJyIANEAAAAAAAAAABjcgRAQQBBAEEAQQAQAAsgAkEQaiAEQShsaiIAIAIoAgAiBTYCACAAQQA2AgQgACADOQMIIABBEGogAUEQakEU/AoAACACIARBAWo2AgggAiAFQQFqNgIACwtAAgF8A38gABABIQMDQCACIANJBEAgAEEQaiACQShsaiIEKAIERQRAIAEgBCsDCKAhAQsgAkEBaiECDAELCyABCw==',
  mutating: 'AGFzbQEAAAABGARgBH9/f38AYAF/AX9gA39/fwBgAX8BfAINAQNlbnYFYWJvcnQAAAMEAwECAwUFAQEAgAgHHwMGcmVkdWNlAAIJb3BlbkhvdXJzAAMGbWVtb3J5AgAK2QQDXQICfwF8IAAoAggiAkEESwRAQQBBAEEAQQAQAAsDQCABIAJJBEAgAEEQaiABQShsaisDCCIDIAOhRAAAAAAAAAAAYgRAQQBBAEEAQQAQAAsgAUEBaiEBDAELCyACC7cDAgF8An8gABABIQQgAiAAQbAB/AoAACAAQeMANgIAIAEoAgQhACABKAIAIgUEQCAFQQFGBEAgAigCCCEEQQAhAQJAA0AgASAESQRAIAJBEGogAUEobGooAgAgAEYNAiABQQFqIQEMAQsLQX8hAQsgAUEASARAQQBBAEEAQQAQAAsgAiABQShsaiIAQRRqIAAoAhRBAXM2AgAFIAVBAkYEQCACKAIIIQVBACEBAkADQCABIAVJBEAgAkEQaiABQShsaigCACAARg0CIAFBAWohAQwBCwtBfyEBCyABQQBIBEBBAEEAQQBBABAACyABQShsIgAgAkEQamogACACakE4aiAEQQFrIgAgAWtBKGz8CgAAIAIgBEEobGpBGGtBAEEo/AsAIAIgADYCCAVBAEEAQQBBABAACwsFIARBBE8gASsDCCIDIAOhRAAAAAAAAAAAYnIgA0QAAAAAAAAAAGNyBEBBAEEAQQBBABAACyACQRBqIARBKGxqIgAgAigCACIFNgIAIABBADYCBCAAIAM5AwggAEEQaiABQRBqQRT8CgAAIAIgBEEBajYCCCACIAVBAWo2AgALC0ACAXwDfyAAEAEhAwNAIAIgA0kEQCAAQRBqIAJBKGxqIgQoAgRFBEAgASAEKwMIoCEBCyACQQFqIQIMAQsLIAEL',
  shipping: 'AGFzbQEAAAABBwFgAn9/AX8DAgEABQMBAAAHGgINc2hpcHBpbmdDZW50cwAABm1lbW9yeQIACioBKAAgAEEASCABQQFHIAFBAkdxcgRAAAtB9AMgAEECQQQgAUEBRhtsags=',
};
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const sha = text => createHash('sha256').update(text).digest('hex');
const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'ef-gate-asc-'));
roots.push(fixtureRoot);
const fixtureAsc = path.join(fixtureRoot, 'asc.mjs'), argsLog = path.join(fixtureRoot, 'args.json');
writeFileSync(path.join(fixtureRoot, 'modules.json'), JSON.stringify({ [sha(kernel)]: prebuilt.todo, [sha(mutatingKernel)]: prebuilt.mutating, [sha(shippingKernel)]: prebuilt.shipping }));
writeFileSync(fixtureAsc, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(argsLog)}, JSON.stringify(args));
const modules = JSON.parse(readFileSync(${JSON.stringify(path.join(fixtureRoot, 'modules.json'))}, 'utf8'));
const wasm = modules[createHash('sha256').update(readFileSync(args[0], 'utf8')).digest('hex')];
if (!wasm) { process.stderr.write('ERROR TS2304: Cannot find name'); process.exit(1); }
writeFileSync(args[args.indexOf('-o') + 1], Buffer.from(wasm, 'base64'));
if (args.includes('--textFile')) writeFileSync(args[args.indexOf('--textFile') + 1], '(module)');
`);
chmodSync(fixtureAsc, 0o755);
const realCompiler = existsSync(asc);
const compiler = realCompiler ? asc : fixtureAsc;
const gateCli = (args, env = {}) => spawnSync(process.execPath, [gate, ...args], { encoding: 'utf8', timeout: 300_000, env: { ...process.env, ENDOFORGE_ASC: compiler, ...env } });
function kernelDir({ id = 'todo', contractText = contract, tests = todoTests, source = kernel, glueValue = glue } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ef-gate-'));
  roots.push(root);
  const dir = path.join(root, id);
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'CONTRACT.md'), contractText);
  writeFileSync(path.join(dir, 'tests.json'), JSON.stringify(tests));
  const frozen = gateCli(['freeze', dir]);
  assert.equal(frozen.status, 0, frozen.stderr);
  writeFileSync(path.join(dir, 'kernel.ts'), source);
  writeFileSync(path.join(dir, 'glue.json'), JSON.stringify(glueValue));
  return dir;
}
function run(dir, env) {
  const outcome = gateCli(['run', dir], env);
  const result = JSON.parse(readFileSync(path.join(dir, 'result.json'), 'utf8'));
  return { outcome, result };
}
const failing = result => Object.entries(result.gates).filter(([, gate]) => !gate.ok).map(([name, gate]) => `${name}: ${gate.why}`);

test('H9: the gate compiles with the core compiler flags and fails G2 when the kernel does not compile', () => {
  const dir = kernelDir({ source: 'export function reduce(): void { nope(); }\n' });
  const { outcome, result } = run(dir, { ENDOFORGE_ASC: fixtureAsc });
  assert.deepEqual(Object.keys(result.gates), ['G1_frozen', 'G2_compiles']);
  assert.equal(result.gates.G2_compiles.ok, false);
  assert.match(result.gates.G2_compiles.why, /TS2304/);
  assert.equal(outcome.status, 1);
  const args = JSON.parse(readFileSync(argsLog, 'utf8'));
  assert.equal(args[0], path.join(dir, 'kernel.ts'));
  for (const flag of ['--runtime', 'stub', '-O3', '--noAssert', '--maximumMemory', '1024', '-o', '--textFile']) assert.ok(args.includes(flag), flag);
});

test('H9: the gate tool glue schema is the core schema, with record, list and text kinds and layout fields', () => {
  assert.deepEqual(gateSchema, coreSchema);
  assert.deepEqual(gateSchema.$defs.kind.enum, ['number', 'integer', 'boolean', 'code', 'record', 'list', 'text']);
  for (const key of ['fields', 'items', 'max', 'maxBytes']) assert.ok(Object.hasOwn(gateSchema.$defs.value.properties, key), key);
});

test('H9: a to-do reducer over records and lists passes every gate through the gate CLI with state in and state out', () => {
  const dir = kernelDir();
  const { outcome, result } = run(dir);
  assert.deepEqual(failing(result), [], JSON.stringify(result.tests.filter(entry => !entry.pass)));
  assert.equal(outcome.status, 0);
  assert.equal(result.promotable, true);
  assert.equal(result.gates.G4_tests.passed, todoTests.length);
  assert.deepEqual(result.tests[2].got, toggled);
  assert.equal(result.tests[1].got.items[1].title, bike.title);
  assert.equal(result.tests[5].got, 2.25);
  assert.ok(result.gates.G8_nonfinite.probes > 0);
  assert.equal(result.gates.G9_units.ok, true);
  assert.ok(existsSync(path.join(dir, 'kernel.wasm')));
  assert.ok(existsSync(path.join(dir, 'kernel.wat')));
});

test('H9: a wrong expected state fails the tests gate, so the structured comparison is not vacuous', () => {
  const tests = structuredClone(todoTests);
  tests[2].expect.items[0].done = false;
  const { outcome, result } = run(kernelDir({ tests }));
  assert.equal(result.gates.G4_tests.ok, false);
  assert.equal(result.tests[2].pass, false);
  assert.equal(result.promotable, false);
  assert.equal(outcome.status, 1);
});

test('H9: a kernel that writes into its read-only state buffer is refused', () => {
  const { result } = run(kernelDir({ source: mutatingKernel }));
  assert.equal(result.gates.G4_tests.ok, false);
  assert.match(String(result.tests[0].got), /read-only input/);
  assert.equal(result.promotable, false);
});

test('H9: a value that does not fit its declared layout fails at the boundary and never counts as a trap', () => {
  const tests = [...todoTests, { name: 'long title', fn: 'reduce', args: [one, event(0, 0, 1, 'a title far longer than sixteen bytes')], expectError: true }];
  const { result } = run(kernelDir({ tests }));
  assert.equal(result.gates.G4_tests.ok, false);
  assert.match(String(result.tests.at(-1).got), /16 bytes/);
  assert.equal(result.tests.at(-1).trap, undefined);
});

test('H9: glue for structured state is checked against the module and the declared layout', () => {
  const noMax = structuredClone(glue);
  delete noMax.exports[0].args[0].fields[1].max;
  assert.match(run(kernelDir({ glueValue: noMax })).result.gates.G7_glue.why, /reduce\.state\.items: list without max/);
  const scalarResult = structuredClone(glue);
  scalarResult.exports[0].result = { kind: 'integer', unit: '1' };
  assert.match(run(kernelDir({ glueValue: scalarResult })).result.gates.G7_glue.why, /reduce: glue lists 2 args, the export takes 3/);
});

test('H9: a scalar kernel still passes, now under the same nine gates as the loop', () => {
  const { outcome, result } = run(kernelDir({ id: 'shipping', contractText: shippingContract, tests: shippingTests, source: shippingKernel, glueValue: shippingGlue }));
  assert.deepEqual(failing(result), []);
  assert.equal(outcome.status, 0);
  assert.equal(result.promotable, true);
  for (const name of ['G1_frozen', 'G2_compiles', 'G3_exports', 'G4_tests', 'G5_deterministic', 'G6_bounded', 'G7_glue', 'G8_nonfinite', 'G9_units']) assert.ok(result.gates[name], name);
});

test('H9: tests that assert nothing are refused at the frozen gate, as in the loop', () => {
  const { result } = run(kernelDir({ id: 'shipping', contractText: shippingContract, tests: [], source: shippingKernel, glueValue: shippingGlue }));
  assert.equal(result.gates.G1_frozen.ok, false);
  assert.match(result.gates.G1_frozen.why, /nonempty/);
  assert.equal(result.promotable, false);
});

test('H9: tests edited after freezing still stop the run at the frozen gate', () => {
  const dir = kernelDir();
  writeFileSync(path.join(dir, 'tests.json'), '[]');
  const { outcome, result } = run(dir);
  assert.deepEqual(result.gates, { G1_frozen: { ok: false, why: 'tests.json changed after freeze' } });
  assert.equal(outcome.status, 1);
});

test('H9: freeze still refuses once kernel.ts exists', () => {
  const dir = kernelDir();
  const again = gateCli(['freeze', dir]);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /refusing to freeze/);
});

test('P3: with ENDOFORGE_ASC unset the gate compiles with the pinned compiler that make loop-setup installs', () => {
  assert.ok(existsSync(ASC_PATH), `pinned compiler missing at ${ASC_PATH}; run make loop-setup`);
  const dir = kernelDir();
  const env = { ...process.env };
  delete env.ENDOFORGE_ASC;
  const outcome = spawnSync(process.execPath, [gate, 'run', dir], { encoding: 'utf8', timeout: 300_000, env });
  const result = JSON.parse(readFileSync(path.join(dir, 'result.json'), 'utf8'));
  assert.equal(result.gates.G2_compiles.ok, true, result.gates.G2_compiles.why);
  assert.deepEqual(failing(result), []);
  assert.equal(outcome.status, 0, outcome.stderr);
  assert.ok(existsSync(path.join(dir, 'kernel.wasm')));
});

test('P3: with ENDOFORGE_ASC unset a kernel that does not compile fails G2 with the pinned compiler diagnostics', () => {
  const dir = kernelDir({ source: 'export function reduce(): void { nope(); }\n' });
  const env = { ...process.env };
  delete env.ENDOFORGE_ASC;
  const outcome = spawnSync(process.execPath, [gate, 'run', dir], { encoding: 'utf8', timeout: 300_000, env });
  const result = JSON.parse(readFileSync(path.join(dir, 'result.json'), 'utf8'));
  assert.deepEqual(Object.keys(result.gates), ['G1_frozen', 'G2_compiles']);
  assert.equal(result.gates.G2_compiles.ok, false);
  assert.match(result.gates.G2_compiles.why, /TS2304|nope/);
  assert.equal(outcome.status, 1);
});

test('P3: the gate default compiler is the tools/asc pin, not a root node_modules path', () => {
  const source = readFileSync(gate, 'utf8');
  assert.doesNotMatch(source, /node_modules\/\.bin\/asc/);
  assert.match(source, /ASC_PATH/);
});
