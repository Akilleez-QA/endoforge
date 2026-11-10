import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { threadId } from 'node:worker_threads';
import { IsolatePool } from '../isolate-pool.mjs';
import { COMPAT_POLICY } from '../contained/promotion.mjs';
import { configuration, hash } from '../x1/host.mjs';
import { receipt } from '../x1/ledger.mjs';
import { admit, createLoopPool, evaluateAndCommit } from '../x1/loop.mjs';
import { implementationFiles } from '../x1/loop-port.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider } from '../x1/transports.mjs';
import { createContainedRoute } from '../../../tools/tscheck/contained-route.mjs';
import { candidate as additionCandidate } from './fixtures/x1/candidate.mjs';
import { inputFor, modelFor } from './fixtures/x1/scripted-model.mjs';
import { good } from './fixtures/x1/seeds.mjs';
import { python } from './fixtures/ledger-fixture.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const x1Directory = here('../x1/');
const fixtures = here('./fixtures/x1/');
const need = 'integer add(a,b)';
const { files } = additionCandidate();
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-gaps2-commit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const records = ledgerPath => python(`
import json, sys
from core.ledger.ledger import Ledger
print(json.dumps(Ledger(json.load(sys.stdin)['ledger']).records()))
`, { ledger: ledgerPath });
const codexEnv = (root, loop, extra = {}) => ({ ...process.env, CODEX_HOME: join(root, 'unused-home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_LOOP: loop,
  ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, join(fixtures, 'fake-codex.mjs')]), FAKE_CODEX_KERNEL: good.kernel, FAKE_CODEX_GLUE: good.glue,
  ...(loop === 'current' ? { ENDOFORGE_ASC_CMD: join(fixtures, 'fake-asc.mjs') } : {}), ...extra });
const currentPool = async t => {
  const pool = new IsolatePool({ hostPort: here('../x1/host.mjs'), size: 1, isolation: 'thread' });
  await pool.ready();
  t.after(() => pool.close());
  return pool;
};

const todoSource = `const ITEM: usize = 40;
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
const todoContract = [
  'A to-do list reducer: the state holds the next id and at most four items, each with an id, a done flag, estimated hours and a title of at most sixteen UTF-8 bytes.',
  'reduce(state, event) applies one event and returns the next state: type 0 adds an open item with the next id, type 1 toggles the item with the event id, type 2 removes it and closes the gap.',
  'reduce traps on non-finite or negative hours, an unknown id, a full list or an unknown event type.',
  'openHours(state) returns the total hours of the open items as a finite number shown with two decimal places.',
  '',
  '```capability',
  JSON.stringify({ exports: [
    { name: 'reduce', args: [{ name: 'state', ...stateType }, { name: 'event', ...eventType }], result: stateType },
    { name: 'openHours', args: [{ name: 'state', ...stateType }], result: { kind: 'number', unit: 'h', precision: 2 } },
  ], traps: ['reduce'] }),
  '```',
].join('\n');
const todoGlue = {
  id: 'todo', assumption: 'The list holds at most four items and every title fits in sixteen UTF-8 bytes.', question: 'Which items are still open, and how many hours do they need?',
  exports: [
    { name: 'reduce', label: 'Apply an event to the to-do list', headline: true, args: [{ name: 'state', ...stateType }, { name: 'event', ...eventType }], result: stateType },
    { name: 'openHours', label: 'Hours of open items', args: [{ name: 'state', ...stateType }], result: { kind: 'number', unit: 'h', precision: 2 } },
  ],
  traps: [{ fn: 'reduce', when: 'the event names a missing item, the list is full or hours are invalid', message: 'This event cannot be applied to the list.' }],
};
const milk = { id: 1, done: false, hours: 0.5, title: 'buy milk' };
const bike = { id: 2, done: false, hours: 2.25, title: 'fix the bike' };
const event = (type, id, hours = 0, title = '') => ({ type, id, hours, title });
const one = { nextId: 2, items: [milk] }, two = { nextId: 3, items: [milk, bike] };
const reordered = item => ({ title: item.title, hours: item.hours, done: item.done, id: item.id });
const todoTests = [
  { name: 'add to an empty list', fn: 'reduce', args: [{ nextId: 1, items: [] }, event(0, 0, 0.5, 'buy milk')], expect: { items: [reordered({ ...milk, hours: 0.5000001 })], nextId: 2 }, tol: 0.000001 },
  { name: 'add a second item', fn: 'reduce', args: [one, event(0, 0, 2.25, bike.title)], expect: { items: [milk, bike].map(reordered), nextId: 3 } },
  { name: 'toggle the first item', fn: 'reduce', args: [two, event(1, 1)], expect: { nextId: 3, items: [{ ...milk, done: true }, bike] } },
  { name: 'remove the first item', fn: 'reduce', args: [two, event(2, 1)], expect: { nextId: 3, items: [bike] } },
  { name: 'open hours', fn: 'openHours', args: [two], expect: 2.75 },
  { name: 'toggle a missing item', fn: 'reduce', args: [one, event(1, 7)], expectError: true },
  { name: 'unknown event type', fn: 'reduce', args: [one, event(9, 1)], expectError: true },
];
const todoInput = () => inputFor(todoContract, JSON.stringify(todoTests), todoSource, JSON.stringify(todoGlue));

const valueMeets = (frozen, seen, declared = null) => python(`
import json, sys
from tools.x1_loop import value_meets
r = json.load(sys.stdin)
print(json.dumps(value_meets(r['frozen'], r['seen'], r['declared'])))
`, { frozen, seen, declared });

test('H1: value_meets compares records and lists structurally, by field name, with tol on every numeric leaf', async () => {
  const declared = stateType;
  const got = { nextId: 2, items: [{ id: 1, done: false, hours: 0.5, title: 'buy milk' }] };
  assert.equal(await valueMeets({ expect: { items: [{ title: 'buy milk', hours: 0.5, done: false, id: 1 }], nextId: 2 } }, { got }, declared), true);
  assert.equal(await valueMeets({ expect: { items: [{ title: 'buy milk', hours: 0.5000001, done: false, id: 1 }], nextId: 2 }, tol: 0.000001 }, { got }, declared), true);
  assert.equal(await valueMeets({ expect: { items: [{ title: 'buy milk', hours: 0.6, done: false, id: 1 }], nextId: 2 }, tol: 0.000001 }, { got }, declared), false);
  assert.equal(await valueMeets({ expect: { items: [{ title: 'buy milk', hours: 0.5, done: true, id: 1 }], nextId: 2 } }, { got }, declared), false);
  assert.equal(await valueMeets({ expect: { items: [], nextId: 2 } }, { got }, declared), false);
  assert.equal(await valueMeets({ expect: { items: [{ title: 'buy milk', hours: 0.5, done: false, id: 1, extra: 1 }], nextId: 2 } }, { got }, declared), false);
  assert.equal(await valueMeets({ expect: { items: [{ title: 'buy milk', hours: 0.5, done: false, id: 1 }], nextId: 2 } }, { got: { ...got, extra: 1 } }, declared), false);
  assert.equal(await valueMeets({ expect: { items: [{ title: 'buy milk', hours: 0.5, done: false, id: 1 }], nextId: 2 } }, { got }, null), true);
  assert.equal(await valueMeets({ expect: { a: 1, b: [1, 2] } }, { got: { b: [1, 2], a: 1 } }, null), true);
  assert.equal(await valueMeets({ expect: { a: 1 } }, { got: '{"a": 1}' }, null), false);
  const long = { nextId: 2, items: [{ id: 1, done: false, hours: 0.5, title: 'a title far longer than sixteen bytes' }] };
  assert.equal(await valueMeets({ expect: long }, { got: long }, declared), false);
});

test('H1: the to-do reducer is promoted through the isolate in-cell commit', { timeout: 120000 }, async t => {
  const root = scratch(t), pool = createLoopPool({ primes: 1 });
  t.after(() => pool.close());
  const directory = join(root, 'todo'), oracle = join(directory, 'oracle');
  mkdirSync(oracle, { recursive: true });
  const todoFiles = { 'CONTRACT.md': todoContract, 'tests.json': JSON.stringify(todoTests) };
  todoFiles['frozen.sha256'] = JSON.stringify({ contract: hash(todoFiles['CONTRACT.md']), tests: hash(todoFiles['tests.json']) });
  for (const [name, text] of Object.entries(todoFiles)) writeFileSync(join(oracle, name), text);
  for (const name of implementationFiles) writeFileSync(join(oracle, name), readFileSync(join(x1Directory, name)));
  const reference = { ledger: join(directory, 'ledger.sqlite'), root: oracle };
  const admission = await admit(pool, reference, { need: 'a to-do list reducer', configuration });
  reference.identity = admission.identity;
  const candidate = { id: 'todo', files: { ...todoFiles, 'kernel.ts': todoSource, 'glue.json': JSON.stringify(todoGlue) } };
  const outcome = await evaluateAndCommit(pool, { candidate, reference, admission, decisionPath: join(directory, 'promotion.json') });
  assert.equal(outcome.problem ?? null, null);
  assert.equal(outcome.promoted, true, JSON.stringify(outcome.report?.attempts?.[0]?.results?.find(check => !check.passed) ?? outcome));
  assert.equal(JSON.parse(readFileSync(join(directory, 'promotion.json'))).decision, 'promote');
});

test('H1: the to-do reducer is promoted end to end on the agent path, in both wait modes', { timeout: 120000 }, async t => {
  const root = scratch(t);
  for (const waits of ['release', 'hold']) {
    const pool = createLoopPool({ primes: 1, waits, provider: scriptedProvider(modelFor(todoInput())) });
    t.after(() => pool.close());
    const directory = join(root, `todo-${waits}`);
    const result = await runNeed({ need: 'a to-do list reducer over records and lists', directory, pool, env: { ENDOFORGE_LOOP: 'agent' } });
    assert.equal(result.problem ?? null, null, waits);
    assert.equal(result.promoted, true, `${waits}: ${JSON.stringify(result)}`);
    const receipts = (await records(join(directory, 'ledger.sqlite'))).filter(record => record.kind === 'receipt');
    assert.equal(receipts.at(-1).data.outcome_state, 'passed', waits);
  }
});

test('H2: the Python drift check covers every frozen x1 implementation file, and receipts carry the nine-gate label', async () => {
  const listed = await python(`
import json
from tools.x1_loop import IMPLEMENTATION_FILES, GATE_LABEL
print(json.dumps(dict(files=list(IMPLEMENTATION_FILES), label=GATE_LABEL)))
`, {});
  for (const name of implementationFiles) assert.ok(listed.files.includes(name), `IMPLEMENTATION_FILES misses ${name}`);
  for (const name of ['oracle.mjs', 'dimensions.mjs', 'generator.mjs', 'ledger.mjs', 'reference.mjs', 'scalar.mjs']) assert.ok(listed.files.includes(name), name);
  const drifted = await python(`
import json, sys
from tools.x1_loop import frozen_drift
names = json.load(sys.stdin)
out = {}
for name in names:
    record = dict(data=dict(content=json.dumps(dict(files={name: "00"}))))
    out[name] = frozen_drift(record, None)
print(json.dumps(out))
`, ['oracle.mjs', 'dimensions.mjs', 'generator.mjs', 'ledger.mjs', 'reference.mjs', 'scalar.mjs']);
  for (const [name, drift] of Object.entries(drifted)) assert.equal(drift, true, name);
  assert.equal(receipt({ identity: 'evr:x' }, 'd', 'c').data.precommit.acceptance_boundary, listed.label);
});

const synthReply = (path, value) => ({ text: JSON.stringify({ calls: [{ name: 'edit_file', path, content: JSON.stringify(value) }, { name: 'done' }] }), usage: 1 });
const addBinding = reference => ({ exports: [{ name: 'add', params: ['a', 'b'].map(name => ({ name, unit: '1', min: -10, max: 10, integer: true })), result: { kind: 'number', unit: '1' } }], reference });
const synthProvider = references => scriptedProvider(({ session }) => {
  if (session.startsWith('need')) return synthReply('sheet.json', { residual: ['Adds two integers.'], quantities: [], relations: [], invariants: [] });
  return synthReply('binding.json', addBinding(references[Number(session.split('-')[1])] ?? references[0]));
});
const honest = 'function add(a, b) { return a + b; }';
const honestAgain = 'function add(x, y) { const sum = y + x; return sum; }';

test('H3: on the isolate and agent paths the synthesized evaluator judges at commit in a bounded cell, not on the controller thread', { timeout: 120000 }, async t => {
  const root = scratch(t);
  const isolatePool = createLoopPool({ primes: 1 });
  t.after(() => isolatePool.close());
  const isolate = await runNeed({ need, directory: join(root, 'isolate'), pool: isolatePool, env: codexEnv(root, 'isolate', { ENDOFORGE_SYNTH: '1' }), synthProvider: synthProvider([honest]) });
  assert.equal(isolate.promoted, true, JSON.stringify(isolate));
  const agentPool = createLoopPool({ primes: 1, provider: scriptedProvider(modelFor(inputFor(files['CONTRACT.md'], files['tests.json'], good.kernel, good.glue))) });
  t.after(() => agentPool.close());
  const agent = await runNeed({ need, directory: join(root, 'agent'), pool: agentPool, env: { ENDOFORGE_LOOP: 'agent', ENDOFORGE_SYNTH: '1' }, synthProvider: synthProvider([honest]) });
  assert.equal(agent.promoted, true, JSON.stringify(agent));
  for (const result of [isolate, agent]) {
    assert.equal(result.synthesis.decision, 'pass');
    assert.equal(typeof result.synthesis.cell?.thread, 'number');
    assert.notEqual(result.synthesis.cell.thread, threadId);
  }
});

const wrongTests = JSON.stringify([...JSON.parse(files['tests.json']), { name: 'wrong', fn: 'add', args: [4, 5], expect: 10 }]);
async function revisedLedger(directory) {
  const all = await records(join(directory, 'ledger.sqlite'));
  const frozen = all.filter(record => record.kind === 'frozen_evaluator');
  assert.equal(frozen.length, 2);
  const [first, revised] = frozen;
  assert.equal(revised.data.revision.of, first.id);
  assert.equal(revised.data.revision.reason, 'specification_correction');
  const evidence = all.find(record => record.id === revised.data.revision.evidence);
  assert.equal(evidence.kind, 'admitted_input');
  assert.equal(JSON.parse(evidence.data.content).kind, 'suspect_frozen_tests');
  const tests = JSON.parse(Buffer.from(JSON.parse(revised.data.content).files['tests.json'], 'hex').toString());
  assert.equal(tests.find(entry => entry.name === 'wrong').expect, 9);
  const receipts = all.filter(record => record.kind === 'receipt');
  assert.equal(receipts.at(-1).data.frozen_evaluator, revised.id);
  assert.ok(all.findIndex(record => record.id === revised.id) < all.findIndex(record => record.kind === 'candidate'), 'the revision precedes every candidate');
  return revised;
}

test('H4: a suspect frozen test is recorded as a ledger revision before implementation, on every path, and the candidate is judged against it', { timeout: 180000 }, async t => {
  const root = scratch(t), references = [honest, honestAgain];
  const hooks = [];
  const suspect = report => hooks.push(report);
  const current = await runNeed({ need, directory: join(root, 'current'), pool: await currentPool(t), env: codexEnv(root, 'current', { ENDOFORGE_SYNTH: '1', ENDOFORGE_SYNTH_WIDTH: '2', FAKE_CODEX_TESTS: wrongTests }), synthProvider: synthProvider(references), suspect });
  assert.equal(current.promoted, true, JSON.stringify(current));
  const isolatePool = createLoopPool({ primes: 1 });
  t.after(() => isolatePool.close());
  const isolate = await runNeed({ need, directory: join(root, 'isolate'), pool: isolatePool, env: codexEnv(root, 'isolate', { ENDOFORGE_SYNTH: '1', ENDOFORGE_SYNTH_WIDTH: '2', FAKE_CODEX_TESTS: wrongTests }), synthProvider: synthProvider(references), suspect });
  assert.equal(isolate.promoted, true, JSON.stringify(isolate));
  const results = { current, isolate };
  for (const waits of ['release', 'hold']) {
    const pool = createLoopPool({ primes: 1, waits, provider: scriptedProvider(modelFor(inputFor(files['CONTRACT.md'], wrongTests, good.kernel, good.glue))) });
    t.after(() => pool.close());
    results[waits] = await runNeed({ need, directory: join(root, waits), pool, env: { ENDOFORGE_LOOP: 'agent', ENDOFORGE_SYNTH: '1', ENDOFORGE_SYNTH_WIDTH: '2' }, synthProvider: synthProvider(references), suspect });
    assert.equal(results[waits].promoted, true, `${waits}: ${JSON.stringify(results[waits])}`);
  }
  for (const [name, result] of Object.entries(results)) {
    const revised = await revisedLedger(join(root, name));
    assert.equal(result.revision, revised.id, name);
    assert.deepEqual(result.suspects.map(entry => entry.test), ['wrong'], name);
  }
  assert.equal(hooks.length, 4);
  assert.ok(hooks.every(report => report.kind === 'suspect_frozen_tests'));
  const untouched = await runNeed({ need, directory: join(root, 'clean'), pool: isolatePool, env: codexEnv(root, 'isolate', { ENDOFORGE_SYNTH: '1', ENDOFORGE_SYNTH_WIDTH: '2' }), synthProvider: synthProvider(references) });
  assert.equal(untouched.promoted, true);
  assert.equal(untouched.revision, undefined);
  assert.equal((await records(join(root, 'clean', 'ledger.sqlite'))).filter(record => record.kind === 'frozen_evaluator').length, 1);
});

test('H5: a TypeScript candidate that passes the compatibility route is promoted under its own policy, on every path', { timeout: 240000 }, async t => {
  const root = scratch(t);
  const route = createContainedRoute({ width: 1, deadlineMs: 2000 });
  t.after(() => route.close());
  const isolatePool = createLoopPool({ primes: 1 });
  t.after(() => isolatePool.close());
  const agentPool = createLoopPool({ primes: 1, provider: scriptedProvider(modelFor(inputFor(files['CONTRACT.md'], files['tests.json'], good.kernel, good.glue))) });
  t.after(() => agentPool.close());
  const runs = {
    current: await runNeed({ need, directory: join(root, 'current'), pool: await currentPool(t), env: codexEnv(root, 'current'), containedRoute: route }),
    isolate: await runNeed({ need, directory: join(root, 'isolate'), pool: isolatePool, env: codexEnv(root, 'isolate'), containedRoute: route }),
    agent: await runNeed({ need, directory: join(root, 'agent'), pool: agentPool, env: { ENDOFORGE_LOOP: 'agent' }, containedRoute: route }),
  };
  for (const [name, result] of Object.entries(runs)) {
    assert.equal(result.promoted, true, `${name}: ${JSON.stringify(result)}`);
    assert.equal(result.contained.status, 'completed', name);
    assert.equal(result.compatibility.promoted, true, `${name}: ${JSON.stringify(result.compatibility)}`);
    assert.equal(result.compatibility.policy, COMPAT_POLICY, name);
    assert.equal(result.compatibility.decision, 'promote', name);
    assert.ok(existsSync(join(root, name, 'compatibility.sqlite')), name);
    assert.equal(JSON.parse(readFileSync(join(root, name, 'compatibility-promotion.json'))).decision, 'promote', name);
  }
  const refusing = await runNeed({ need, directory: join(root, 'refusing'), pool: isolatePool, env: codexEnv(root, 'isolate', { FAKE_CODEX_KERNEL: 'export function add(a:i32,b:i32):i32{return a+b}\nexport function bad(a:i32):i32{const s:string=a;return 0}' }), containedRoute: route });
  assert.equal(refusing.compatibility?.promoted ?? false, false);
});

test('H6: the caller principal reaches library.serve on every path', { timeout: 120000 }, async t => {
  const root = scratch(t);
  const library = () => {
    const seen = [];
    return { seen, async serve(asked, options) { seen.push(options ?? {}); return { verdict: 'miss', reason: 'no_contract_match' }; } };
  };
  const isolatePool = createLoopPool({ primes: 1 });
  t.after(() => isolatePool.close());
  const agentPool = createLoopPool({ primes: 1, provider: scriptedProvider(modelFor(inputFor(files['CONTRACT.md'], files['tests.json'], good.kernel, good.glue))) });
  t.after(() => agentPool.close());
  const paths = {
    current: [await currentPool(t), codexEnv(root, 'current')],
    isolate: [isolatePool, codexEnv(root, 'isolate')],
    agent: [agentPool, { ENDOFORGE_LOOP: 'agent' }],
  };
  for (const [name, [pool, env]] of Object.entries(paths)) {
    const lib = library();
    const result = await runNeed({ need, directory: join(root, name), pool, env, library: lib, principal: 'team-ledger' });
    assert.equal(result.promoted, true, `${name}: ${JSON.stringify(result)}`);
    assert.deepEqual(lib.seen.map(options => options.principal), ['team-ledger'], name);
  }
});
