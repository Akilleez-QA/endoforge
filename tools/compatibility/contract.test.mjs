import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { probeTrustedReducer, WIT_SHA256 } from './contract.ts';
import { referenceReducer as reducer } from './reference.ts';
import { createCompatibilityPool, probeInWorkcell } from './workcell.mjs';

const meta = { contractVersion: '1.0.0', stateSchema: 'counter-v1', eventSchema: 'increment-v1', effectSchema: 'notify-v1' };
const policy = { inputBytes: 32, readBytes: 4, outputBytes: 64, effects: 2 };
const probe = (impl = reducer, expected = meta, bounds = policy, snapshots = [Uint8Array.of(3)]) =>
  probeTrustedReducer(impl, expected, Uint8Array.of(1), Uint8Array.of(2), snapshots, bounds);
const refused = receipt => {
  assert.equal(receipt.lane, 'compatibility');
  assert.equal(receipt.validation, 'trusted-reducer-conformance-only');
  assert.equal(receipt.status, 'refused');
};

test('pins the exact EF-18 WIT and replays a working reducer', () => {
  const wit = readFileSync(new URL('../kernel/kernel.wit', import.meta.url));
  assert.equal(WIT_SHA256, createHash('sha256').update(wit).digest('hex'));
  const receipt = probe();
  assert.equal(receipt.lane, 'compatibility');
  assert.equal(receipt.validation, 'trusted-reducer-conformance-only');
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.witSha256, WIT_SHA256);
  assert.deepEqual(receipt.transition, { state: Uint8Array.of(6),
    effects: [{ capability: 'notify', operation: 'changed', payload: Uint8Array.of(2) }] });
  assert.deepEqual(probe(), receipt);
});

test('refuses extra exports, missing exports, wrong types and asynchronous reducers', () => {
  for (const impl of [{ ...reducer, hidden() {} }, { reduce: reducer.reduce },
    { ...reducer, reduce: 2 }, { ...reducer, describe: async () => meta },
    { ...reducer, reduce: async () => ({ state: new Uint8Array(), effects: [] }) }]) refused(probe(impl));
});

test('reference refuses missing input and overflow instead of wrapping bytes', () => {
  refused(probe(reducer, meta, policy, []));
  refused(probe(reducer, meta, policy, [Uint8Array.of(255)]));
  refused(probe(reducer, meta, policy, [new Uint8Array()]));
});

test('works when SharedArrayBuffer is unavailable in the runtime', () => {
  const original = globalThis.SharedArrayBuffer;
  try {
    globalThis.SharedArrayBuffer = undefined;
    assert.equal(probe().status, 'passed');
  } finally {
    globalThis.SharedArrayBuffer = original;
  }
});

test('refuses contract and schema drift, extra fields and malformed metadata', () => {
  for (const key of Object.keys(meta)) {
    refused(probe({ ...reducer, describe: () => ({ ...meta, [key]: 'different' }) }));
    refused(probe(reducer, { ...meta, [key]: '' }));
  }
  for (const value of [{ ...meta, extra: true }, { ...meta, stateSchema: '\ud800' }, null]) {
    refused(probe({ ...reducer, describe: () => value }));
  }
});

test('reads return copies, enforce a shared budget and revoke borrowed handles', () => {
  let saved;
  const source = Uint8Array.of(7, 8);
  const impl = { ...reducer, reduce: (state, event, inputs) => {
    saved = inputs[0];
    assert.deepEqual(Reflect.ownKeys(saved), ['size', 'read']);
    assert.equal(saved.size(), 2n);
    saved.read(0n, 2).value[0] = 99;
    assert.deepEqual(inputs[1].read(0n, 2), { tag: 'ok', value: source });
    assert.deepEqual(saved.read(0n, 1), { tag: 'err', value: 'limit-exceeded' });
    assert.deepEqual(saved.read(2n, 0), { tag: 'ok', value: new Uint8Array() });
    assert.deepEqual(saved.read(2n, 1), { tag: 'err', value: 'out-of-bounds' });
    assert.deepEqual(saved.read(0xffffffffffffffffn, 1), { tag: 'err', value: 'out-of-bounds' });
    return { state, effects: [] };
  } };
  assert.equal(probe(impl, meta, policy, [source, source]).status, 'passed');
  assert.deepEqual(source, Uint8Array.of(7, 8));
  assert.throws(() => saved.size(), /expired/);
  assert.throws(() => saved.read(0n, 0), /expired/);
});

test('rejects invalid WIT integers and revokes on a thrown reducer', () => {
  for (const [offset, length] of [[0, 1], [-1n, 1], [2n ** 64n, 1], [0n, -1], [0n, 0.5], [0n, NaN], [0n, 2 ** 32]]) {
    let saved;
    refused(probe({ ...reducer, reduce: (state, event, inputs) => {
      saved = inputs[0];
      saved.read(offset, length);
      return { state, effects: [] };
    } }));
    assert.throws(() => saved.size(), /expired/);
  }
});

test('snapshots policy, schemas and buffers before reducer code runs', () => {
  const bounds = { ...policy };
  const expected = { ...meta };
  const source = Uint8Array.of(3);
  const impl = { ...reducer, describe() {
    bounds.outputBytes = 0; expected.stateSchema = 'changed'; source[0] = 99;
    return { ...meta };
  } };
  assert.deepEqual(probe(impl, expected, bounds, [source]).transition.state, Uint8Array.of(6));
});

test('copies arguments and returned byte arrays; effects remain inert data', () => {
  const state = Uint8Array.of(1), event = Uint8Array.of(2), payload = Uint8Array.of(5);
  const output = { state: payload, effects: [{ capability: 'network', operation: 'send', payload }] };
  const receipt = probeTrustedReducer({ ...reducer, reduce(s, e) {
    s[0] = 99; e[0] = 99; return output;
  } }, meta, state, event, [], policy);
  payload[0] = 42;
  assert.deepEqual([state[0], event[0], receipt.transition.state[0], receipt.transition.effects[0].payload[0]], [1, 2, 5, 5]);
});

test('refuses malformed transitions, accessors, output volume and sparse effects', () => {
  for (const output of [null, { state: [1], effects: [] }, { state: new Uint8Array(), effects: [,] },
    { state: new Uint8Array(), effects: [], extra: true }, { state: new Uint8Array(65), effects: [] },
    { state: new Uint8Array(), effects: [{ capability: '', operation: 'x', payload: new Uint8Array() }] },
    { state: new Uint8Array(), effects: [{ capability: 'x'.repeat(65), operation: 'x', payload: new Uint8Array() }] },
    { get state() { throw new Error('must not execute'); }, effects: [] }]) {
    refused(probe({ ...reducer, reduce: () => output }));
  }
  refused(probe(reducer, meta, { ...policy, effects: 0 }));
  refused(probe(reducer, meta, { ...policy, outputBytes: 14 }));
});

test('rejects malformed budgets, excessive inputs and shared memory before invocation', () => {
  let called = false;
  const impl = { ...reducer, describe() { called = true; return meta; } };
  for (const value of [-1, NaN, Infinity, 0.5, 16 * 1024 * 1024 + 1]) {
    refused(probe(impl, meta, { ...policy, readBytes: value }));
  }
  refused(probe(impl, meta, { ...policy, effects: 1025 }));
  refused(probe(impl, meta, { ...policy, inputBytes: 2 }));
  refused(probe(impl, meta, policy, Array(1025).fill(new Uint8Array())));
  refused(probe(impl, meta, policy, Array(1)));
  refused(probe(impl, meta, policy, [new Uint8Array(new SharedArrayBuffer(1))]));
  assert.equal(called, false);
});

const sha256 = value => createHash('sha256').update(value).digest('hex');
const referenceSource = readFileSync(new URL('./reference.ts', import.meta.url), 'utf8');
const cellJob = (source, exportName = 'referenceReducer', over = {}) => ({ reducer: { source, exportName }, expected: meta,
  state: Uint8Array.of(1), event: Uint8Array.of(2), snapshots: [Uint8Array.of(3)], limits: policy, ...over });
const cellPool = (t, options) => {
  const pool = createCompatibilityPool(options);
  t.after(() => pool.close());
  return pool;
};
const describeSource = `describe: () => (${JSON.stringify(meta)})`;
const inlineReducer = (...members) => `export const reducer = { ${[describeSource, ...members].join(', ')} };`;
const working = 'reduce: (state, event) => ({ state: Uint8Array.of(state[0] + event[0]), effects: [] })';

test('runs the reference reducer in a process-mode IsolatePool workcell and binds its identities', async t => {
  const receipt = await probeInWorkcell(cellPool(t), cellJob(referenceSource));
  assert.equal(receipt.status, 'passed', receipt.reason);
  assert.equal(receipt.lane, 'compatibility');
  assert.equal(receipt.validation, 'trusted-reducer-conformance-only');
  assert.deepEqual([...receipt.transition.state], [6]);
  assert.deepEqual([...receipt.transition.effects[0].payload], [2]);
  assert.equal(receipt.workcell.isolation, 'process');
  assert.ok(Number.isSafeInteger(receipt.workcell.id) && receipt.workcell.id !== process.pid);
  assert.equal(receipt.identities.source, sha256(referenceSource));
  assert.equal(receipt.identities.wit, WIT_SHA256);
  assert.equal(receipt.identities.runtime, process.version);
  assert.equal(receipt.identities.compiler, `node-strip-types/${process.versions.amaro}`);
  assert.match(receipt.identities.evaluator, /^[0-9a-f]{64}$/);
});

test('gives the same transition in a thread-mode workcell', async t => {
  const receipt = await probeInWorkcell(cellPool(t, { isolation: 'thread' }), cellJob(referenceSource));
  assert.equal(receipt.status, 'passed', receipt.reason);
  assert.equal(receipt.workcell.isolation, 'thread');
  assert.deepEqual([...receipt.transition.state], [6]);
});

test('refuses non-conforming reducers from inside the workcell', async t => {
  const pool = cellPool(t);
  const cases = [
    [inlineReducer(working, 'hidden() {}'), /record fields differ/],
    [inlineReducer('reduce: async () => ({ state: new Uint8Array(), effects: [] })'), /record fields differ/],
    [inlineReducer('reduce: () => { throw new Error("planted failure"); }'), /planted failure/],
    ['export const other = 1;', /no reducer export/],
    ['export const reducer = {', /./],
  ];
  for (const [source, reason] of cases) {
    const receipt = await probeInWorkcell(pool, cellJob(source, 'reducer'));
    refused(receipt);
    assert.match(receipt.reason, reason);
    assert.equal(receipt.identities.source, sha256(source));
  }
  refused(await probeInWorkcell(pool, cellJob(referenceSource, 'referenceReducer', { snapshots: [Uint8Array.of(255)] })));
  refused(await probeInWorkcell(pool, cellJob(referenceSource, 'referenceReducer', { limits: { ...policy, outputBytes: 14 } })));
});

test('a reducer that hangs or exits is stopped and refused, and the pool keeps working', async t => {
  const pool = cellPool(t, { jobTimeoutMs: 3000 });
  const hung = await probeInWorkcell(pool, cellJob(inlineReducer('reduce() { for (;;); }'), 'reducer'));
  refused(hung);
  assert.match(hung.reason, /deadline/);
  const exited = await probeInWorkcell(pool, cellJob(inlineReducer('reduce() { process.exit(0); }'), 'reducer'));
  refused(exited);
  assert.match(exited.reason, /worker_exit/);
  assert.equal((await probeInWorkcell(pool, cellJob(referenceSource))).status, 'passed');
});

test('a reducer that exhausts the workcell heap is stopped and refused', async t => {
  const pool = cellPool(t, { jobTimeoutMs: 30000, resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 4 } });
  const body = 'reduce() { const kept = []; for (;;) kept.push(new Array(4096).fill({})); }';
  const receipt = await probeInWorkcell(pool, cellJob(inlineReducer(body), 'reducer'));
  refused(receipt);
  assert.match(receipt.reason, /heap/);
  assert.equal((await probeInWorkcell(pool, cellJob(referenceSource))).status, 'passed');
});

test('refuses before dispatch when the kernel contract no longer matches the pin', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'compat-wit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const witPath = join(directory, 'kernel.wit');
  writeFileSync(witPath, 'package drifted:kernel;\n');
  const receipt = await probeInWorkcell(cellPool(t), cellJob(referenceSource), { witPath });
  refused(receipt);
  assert.match(receipt.reason, /WIT/);
  assert.equal(receipt.workcell, null);
  assert.equal(receipt.identities.wit, sha256('package drifted:kernel;\n'));
});

test('shared memory cannot cross into the workcell', async t => {
  const snapshots = [new Uint8Array(new SharedArrayBuffer(1))];
  const receipt = await probeInWorkcell(cellPool(t), cellJob(referenceSource, 'referenceReducer', { snapshots }));
  refused(receipt);
  assert.match(receipt.reason, /unshared bytes required/);
  assert.equal(receipt.workcell, null);
});
