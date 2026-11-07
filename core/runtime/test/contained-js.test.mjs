import assert from 'node:assert/strict';
import test from 'node:test';
import { createContainedPool, createContainedRunner, LANE, validateContract } from '../contained/runner.mjs';

const one = source => ({ modules: { '/g/main.js': source }, entry: '/g/main.js' });
const scoped = (t, make, options) => { const runner = make(options); t.after(() => runner.close()); return runner; };
const FATAL = 'exports.main = () => { const m = new Map(); for (let i = 0; ; i++) m.set(i, i); };';

test('a guest has no ambient authority and only an allowlist of globals', async t => {
  const runner = scoped(t, createContainedRunner);
  const result = await runner.run(one(`exports.main = () => ({
    types: ['process', 'require2', 'Buffer', 'console', 'fetch', 'setTimeout', 'queueMicrotask', 'performance', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'ArrayBuffer', 'Uint8Array', 'Intl', 'Temporal', 'WeakRef', 'FinalizationRegistry', 'eval'].filter(name => typeof globalThis[name] !== 'undefined'),
    ctor: (() => { try { return globalThis.constructor.constructor('return 1')(); } catch (error) { return error.name; } })(),
    fn: (() => { try { return (() => {}).constructor('return 1')(); } catch (error) { return error.name; } })(),
    modules: ['fs', 'node:fs', '../../x'].map(name => { try { require(name); return 'got'; } catch (error) { return error.message; } }),
  });`));
  assert.equal(result.status, 'completed');
  assert.equal(result.lane, LANE);
  const seen = JSON.parse(result.output);
  assert.deepEqual(seen.types, []);
  assert.equal(seen.ctor, 'EvalError');
  assert.equal(seen.fn, 'EvalError');
  assert.ok(seen.modules.every(message => message.startsWith('module not granted')));
});

test('dynamic import is refused before the guest runs, in every comment form', async t => {
  const runner = scoped(t, createContainedRunner);
  for (const source of ['exports.main = () => import("node:fs");', 'exports.main = () => import/* a */(1);', 'exports.main = () => import // b\n(1);', 'exports.main = () => import<!-- c\n(1);', 'exports.main = () => import (1);']) {
    const result = await runner.run(one(source));
    assert.equal(result.reason, 'dynamic_import', source);
  }
  assert.equal((await runner.run(one('exports.main = () => ({ important: "import" });'))).status, 'completed');
});

test('a stack overflow near an error or a port yields only guest-realm errors', async t => {
  const runner = scoped(t, createContainedRunner);
  const source = `exports.main = () => {
    const ports = require('host:ports'), caught = new Array(3000).fill(null); let count = 0;
    const keep = value => { if (count < 3000) caught[count++] = value; };
    const go = () => { try { go(); } catch (error) { keep(error); try { void new Error('x').stack; } catch (f) { keep(f); } if (count < 400) { try { ports.echo(1); } catch (f) { keep(f); } } throw error; } };
    try { go(); } catch (error) { keep(error); }
    let foreign = 0;
    for (let i = 0; i < count; i++) { const value = caught[i]; if (value && typeof value === 'object' && !(value instanceof Object)) foreign += 1; }
    return { foreign, count };
  };`;
  const result = await runner.run({ ...one(source), deadlineMs: 30000, contract: { ports: { echo: { maxCalls: 100000, maxBytes: 100 } } }, ports: { echo: value => value } });
  assert.equal(result.status, 'completed');
  const { foreign, count } = JSON.parse(result.output);
  assert.ok(count > 0);
  assert.equal(foreign, 0);
});

test('each breach kills only that guest and is refused', async t => {
  const runner = scoped(t, createContainedRunner, { width: 3, spare: 3 });
  const healthy = runner.run({ ...one('exports.main = I => { let total = 0; for (let i = 0; i < I.n; i++) total += i % 3; return total; };'), input: { n: 3e8 }, deadlineMs: 60000 });
  const [loop, heap, overflow] = await Promise.all([
    runner.run({ ...one('exports.main = () => { for (;;); };'), deadlineMs: 150 }),
    runner.run({ ...one('exports.main = () => { const a = []; for (;;) a.push(new Array(1e5).fill(0)); };'), deadlineMs: 20000 }),
    runner.run(one('exports.main = function f() { return f() + 1; };')),
  ]);
  assert.equal(loop.reason, 'deadline');
  assert.equal(heap.reason, 'heap');
  assert.equal(overflow.reason, 'stack');
  assert.equal((await healthy).status, 'completed');
  assert.equal(runner.stats.cohortLosses, 0);
});

test('a V8 fatal error takes one pool cell and no sibling', { timeout: 120000 }, async t => {
  const pool = scoped(t, createContainedPool, { width: 3 });
  await pool.ready();
  const siblings = [0, 1].map(() => pool.run({ ...one('exports.main = I => { let total = 0; for (let i = 0; i < I.n; i++) total += i % 3; return total; };'), input: { n: 3e9 }, deadlineMs: 90000 }));
  const fatal = await pool.run({ ...one(FATAL), deadlineMs: 60000 });
  assert.equal(fatal.status, 'refused');
  assert.equal(fatal.reason, 'heap');
  for (const sibling of await Promise.all(siblings)) assert.equal(sibling.status, 'completed');
  assert.equal(pool.stats.cohortLosses, 1);
  assert.equal((await pool.run(one('exports.main = () => 1;'))).status, 'completed');
});

test('a fatal error in a shared cohort is reported as unknown for all it held', { timeout: 120000 }, async t => {
  const runner = scoped(t, createContainedRunner, { width: 2 });
  const sibling = runner.run({ ...one('exports.main = () => { for (;;); };'), deadlineMs: 60000 });
  const fatal = await runner.run({ ...one(FATAL), deadlineMs: 60000 });
  assert.equal(fatal.status, 'outcome_unknown');
  assert.equal((await sibling).status, 'outcome_unknown');
});

test('a deadline is enforced from outside against async work', async t => {
  const runner = scoped(t, createContainedRunner);
  for (const source of ['exports.main = () => { (function loop() { Promise.resolve().then(loop); })(); return 1; };', 'exports.main = () => { const t = { then(r) { Promise.resolve().then(() => t.then(r)); } }; return Promise.resolve(t); };']) {
    const started = performance.now();
    assert.equal((await runner.run({ ...one(source), deadlineMs: 150 })).reason, 'deadline');
    assert.ok(performance.now() - started < 3000);
  }
  assert.equal((await runner.run(one('exports.main = () => new Promise(() => {});'))).reason, 'never_settled');
});

test('a port that never answers cannot extend the deadline', async t => {
  const runner = scoped(t, createContainedRunner);
  const started = performance.now();
  const result = await runner.run({ ...one('exports.main = () => require("host:ports").hang(1);'), deadlineMs: 200, contract: { ports: { hang: { maxCalls: 1, maxBytes: 64 } } }, ports: { hang: () => new Promise(() => {}) } });
  assert.equal(result.reason, 'deadline');
  assert.ok(performance.now() - started < 3000);
  assert.equal(runner.stats.cohortLosses, 0);
});

test('runs compare equal, and clock and randomness exist only by grant', async t => {
  const runner = scoped(t, createContainedRunner);
  const source = 'exports.main = () => [(() => { try { return Date.now(); } catch (e) { return e.name; } })(), (() => { try { return Math.random(); } catch (e) { return e.name; } })(), (() => { try { return new Date().getTime(); } catch (e) { return e.name; } })(), new Date(0).toISOString()];';
  const plain = await runner.runTwice(one(source));
  assert.equal(plain.comparedRuns, 2);
  assert.deepEqual(JSON.parse(plain.output), ['TypeError', 'TypeError', 'TypeError', '1970-01-01T00:00:00.000Z']);
  const granted = await runner.runTwice({ ...one(source), contract: { grants: { clock: { fixedMs: 5 }, random: { seed: 9 } } } });
  const [now, random, date] = JSON.parse(granted.output);
  assert.equal(now, 5);
  assert.equal(date, 5);
  assert.ok(random >= 0 && random < 1);
  assert.equal(granted.comparedRuns, 2);
});

test('runTwice refuses output that differs', async t => {
  const runner = scoped(t, createContainedRunner);
  let call = 0;
  const result = await runner.runTwice({ ...one('const p = require("host:ports"); exports.main = () => p.next(null);'), contract: { ports: { next: { maxCalls: 1, maxBytes: 100 } } }, ports: { next: () => call++ } });
  assert.equal(result.reason, 'nondeterministic');
});

test('ports are granted by name, bounded, and pass only JSON values', async t => {
  const runner = scoped(t, createContainedRunner);
  const contract = { ports: { echo: { maxCalls: 2, maxBytes: 64 }, boom: { maxCalls: 1, maxBytes: 64 } } };
  const ports = { echo: value => value, boom: () => { throw new TypeError('host detail'); } };
  const source = `const p = require('host:ports');
    const attempt = f => { try { return f(); } catch (e) { return { message: e.message, guest: e instanceof Error }; } };
    exports.main = () => ({ names: Object.keys(p), first: attempt(() => p.echo({ a: 1 })), boom: attempt(() => p.boom(1)), large: attempt(() => p.echo('x'.repeat(100))), over: attempt(() => p.echo(1)) });`;
  const result = await runner.run({ ...one(source), contract, ports });
  const seen = JSON.parse(result.output);
  assert.deepEqual(seen.names, ['echo', 'boom']);
  assert.deepEqual(seen.first, { a: 1 });
  assert.deepEqual(seen.boom, { message: 'port refused: handler failed', guest: true });
  assert.equal(seen.large.message, 'port refused: byte budget');
  assert.equal(seen.over.message, 'port refused: call budget');
  const none = await runner.run(one('exports.main = () => Object.keys(require("host:ports"));'));
  assert.equal(none.output, '[]');
});

test('hostile output and input do not pollute the supervisor', async t => {
  const runner = scoped(t, createContainedRunner);
  const input = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}');
  const result = await runner.run({ ...one(`exports.main = I => { Object.prototype.polluted = 2; return JSON.parse('{"__proto__":{"polluted":3}}'); };`), input });
  assert.equal(result.status, 'completed');
  JSON.parse(result.output);
  assert.equal(({}).polluted, undefined);
  assert.equal((await runner.run(one('exports.main = () => ({}).polluted ?? null;'))).output, 'null');
});

test('hostile values in a guest cannot break the result path', async t => {
  const runner = scoped(t, createContainedRunner);
  const poison = `Promise.prototype.then = () => { throw new Error('then'); }; JSON.stringify = () => { throw new Error('stringify'); }; JSON.parse = () => { throw new Error('parse'); };`;
  assert.equal((await runner.run(one(`${poison} exports.main = I => ({ ok: 1 });`))).output, '{"ok":1}');
  assert.equal((await runner.run(one('exports.main = () => ({ get then() { throw new TypeError("x"); } });'))).reason, 'thrown');
  assert.equal((await runner.run({ ...one('exports.main = () => "x".repeat(2 ** 22);') })).reason, 'output_too_large');
  assert.equal((await runner.run(one('export const main = () => 1;'))).reason, 'compile');
});

test('contract fields and grants are refused unless known', () => {
  assert.throws(() => validateContract({ network: true }), /unknown contract field/);
  assert.throws(() => validateContract({ grants: { fs: true } }), /unknown grant/);
  assert.throws(() => validateContract({ grants: { clock: {} } }), /fixedMs/);
  assert.throws(() => validateContract({ ports: { Echo: { maxCalls: 1, maxBytes: 1 } } }), /invalid port/);
  assert.deepEqual(validateContract(), { grants: {}, ports: [], limits: {} });
});
