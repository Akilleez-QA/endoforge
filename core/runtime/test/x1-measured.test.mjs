import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { runUniversalGates } from '../../engine/gates.mjs';
import { configuration, createPort, hash } from '../x1/host.mjs';
import { runGates } from '../x1/gates.mjs';
import { candidate } from './fixtures/x1/candidate.mjs';
import { add, callsHost, grows, recurse, spin, stateful, wasm } from './fixtures/x1/wasm.mjs';
import { timingOnly } from './fixtures/timing.mjs';
const withWasm = (bytes, change = {}) => { const c = candidate(); c.compiled.wasm = Buffer.from(bytes).toString('base64'); Object.assign(c.files, change); return c; };
const twice = withWasm(wasm({ functions: [stateful], globals: [0] }));
{
  const files = twice.files;
  files['tests.json'] = JSON.stringify([{ name: 'first', fn: 'add', args: [1, 1], expect: 2 }, { name: 'second', fn: 'add', args: [2, 0], expect: 3 }]);
  files['frozen.sha256'] = JSON.stringify({ contract: hash(files['CONTRACT.md']), tests: hash(files['tests.json']) });
}
const gates = async c => {
  const identity = c === null ? 'no-such-candidate' : hash(JSON.stringify(c));
  return runUniversalGates({ ...structuredClone(configuration.gateInput), candidate: identity }, createPort({ candidates: c === null ? {} : { [identity]: c } }));
};
test('a real kernel passes every universal gate', async () => {
  const result = await gates(candidate());
  assert.equal(result.passed, true, JSON.stringify(result));
});
for (const [name, c, check] of [
  ['an empty candidate', { id: 'empty', files: {}, compiled: {} }, 'interface'],
  ['garbage wasm', withWasm(Buffer.from('not a module at all')), 'interface'],
  ['a compile failure', { ...candidate(), compiled: { source: 'x', error: 'compiler failed' } }, 'interface'],
  ['a nonexistent id', null, 'interface'],
  ['a missing export', withWasm(wasm({ functions: [{ ...add, name: 'sub' }] })), 'interface'],
  ['a wrong arity', withWasm(wasm({ functions: [{ ...add, params: ['i32'], body: [0x20, 0] }] })), 'interface'],
  ['a start function that traps', withWasm(wasm({ functions: [add, { body: [0x00] }], start: 1 })), 'interface'],
  ['a kernel that loops forever', withWasm(wasm({ functions: [spin] })), 'bounds'],
  ['a kernel that recurses forever', withWasm(wasm({ functions: [recurse] })), 'bounds'],
  ['a kernel whose answer depends on earlier calls', twice, 'determinism'],
  ['an import other than abort', withWasm(wasm({ imports: [{ module: 'env', field: 'escape' }], functions: [callsHost] })), 'forbidden_effects'],
]) test(`universal gates refuse ${name} without an ambiguous outcome`, async () => {
  const result = await gates(c);
  assert.equal(result.passed, false, JSON.stringify(result));
  assert.equal(result.firstFailure, check, JSON.stringify(result));
});
test('usage is read from outside the guest and differs between kernels', async t => {
  const usage = async c => {
    const identity = hash(JSON.stringify(c));
    const port = createPort({ candidates: { [identity]: c } });
    return (await port.run(identity, configuration.gateInput.cases, configuration.gateInput.limits)).usage;
  };
  const plain = await usage(candidate()), grown = await usage(withWasm(wasm({ functions: [grows], memory: 1 })));
  assert(plain.fuel > 0 && plain.fuel < 1000, JSON.stringify(plain));
  assert.equal(plain.memoryBytes, 0);
  assert.equal(grown.memoryBytes, 4 * 65536);
  assert(grown.fuel > plain.fuel, JSON.stringify([plain, grown]));
  assert(plain.wallMs >= 0);
  timingOnly(t, 'a plain kernel runs its cases within 1000 ms wall', () => assert(plain.wallMs < 1000, `${plain.wallMs} ms`));
});
test('memory stays visible when the kernel keeps it private', async () => {
  const c = withWasm(wasm({ functions: [grows], memory: 1, exportMemory: false })), identity = hash(JSON.stringify(c));
  const run = await createPort({ candidates: { [identity]: c } }).run(identity, configuration.gateInput.cases, configuration.gateInput.limits);
  assert.equal(run.usage.memoryBytes, 4 * 65536);
});
test('the two rounds are fresh instances in different call orders', async () => {
  const c = twice, identity = hash(JSON.stringify(c)), port = createPort({ candidates: { [identity]: c } });
  const { cases, limits } = configuration.gateInput;
  const [first, second] = [await port.run(identity, cases, limits), await port.run(identity, cases, limits)];
  assert.notDeepEqual(first.outputs, second.outputs);
});
test('abort is observed at run time and only abort is allowed', async () => {
  const c = withWasm(wasm({ imports: [{ module: 'env', field: 'abort', params: ['i32', 'i32', 'i32', 'i32'] }], functions: [{ ...add, body: [0x41, 0, 0x41, 0, 0x41, 0, 0x41, 0, 0x10, 0, 0x20, 0, 0x20, 1, 0x6a] }] }));
  const identity = hash(JSON.stringify(c)), port = createPort({ candidates: { [identity]: c } });
  assert.deepEqual(port.scanEffects(identity), ['call:env.abort', 'import:env.abort']);
  const run = port.run(identity, configuration.gateInput.cases, configuration.gateInput.limits);
  assert.deepEqual(run.effects, ['call:env.abort']);
  assert.deepEqual(configuration.gateInput.allowedEffects, ['call:env.abort', 'import:env.abort']);
});
test('wall time alone never refuses: it reads as an unknown outcome', async () => {
  const identity = hash(JSON.stringify(candidate())), port = createPort({ candidates: { [identity]: candidate() } });
  const run = port.run(identity, configuration.gateInput.cases, { ...configuration.gateInput.limits, wallMs: 1e-9 });
  assert.equal(run.status, 'outcome_unknown');
});
test('G6 refuses a kernel that never returns, promptly and even when the test expects a trap', t => {
  for (const kernel of [spin, recurse]) {
    const c = withWasm(wasm({ functions: [kernel] }));
    c.files['tests.json'] = JSON.stringify([{ name: 'traps', fn: 'add', args: [1, 2], expectError: true }]);
    c.files['frozen.sha256'] = JSON.stringify({ contract: hash(c.files['CONTRACT.md']), tests: hash(c.files['tests.json']) });
    const begin = performance.now(), result = runGates(c);
    assert.equal(result.gates.G6_bounded.ok, false, JSON.stringify(result.gates));
    assert.equal(result.promotable, false);
    const took = performance.now() - begin;
    timingOnly(t, 'G6 refuses a non-returning kernel within 10000 ms', () => assert(took < 10000, `${took} ms`));
  }
});
test('runGates reports garbage wasm and a trapping start as G2, not as an exception', () => {
  assert.equal(runGates(withWasm(Buffer.from('garbage'))).gates.G2_compiles.ok, false);
  assert.equal(runGates(withWasm(wasm({ functions: [add, { body: [0x00] }], start: 1 }))).gates.G2_compiles.ok, false);
});
test('a kernel that never returns does not hang the process', { timeout: 30000 }, () => {
  const c = withWasm(wasm({ functions: [spin] }));
  const code = `import(${JSON.stringify(new URL('../x1/gates.mjs', import.meta.url).href)}).then(({ runGates }) => { console.log(runGates(JSON.parse(process.argv[1])).promotable); });`;
  const run = spawnSync(process.execPath, ['-e', code, JSON.stringify(c)], { timeout: 20000, encoding: 'utf8' });
  assert.equal(run.signal, null);
  assert.equal(run.stdout.trim(), 'false');
});
