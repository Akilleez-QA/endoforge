import assert from 'node:assert/strict';
import test from 'node:test';
import { GATE_ORDER, runUniversalGates } from './gates.mjs';

function probe() {
  const signature = {
    version: 1, name: 'identity',
    inputs: [{ path: 'x', type: 'number', unit: '1', domain: [0, 10] }],
    output: { type: 'number', unit: '1' },
  };
  const input = {
    version: 1, candidate: 'test-artifact-v1',
    contract: { version: 1, signature, refusals: [], tolerance: 0, sources: ['test specification'] },
    cases: [{ id: 'zero', inputs: { x: 0 } }],
    limits: { wallMs: 10, memoryBytes: 1024, fuel: 100 }, allowedEffects: [],
  };
  const calls = [];
  const port = {
    describe(candidate) {
      calls.push('describe');
      assert.equal(candidate, input.candidate);
      return structuredClone(signature);
    },
    run(candidate, cases, limits) {
      calls.push('run');
      assert.equal(candidate, input.candidate);
      assert.deepEqual(cases, input.cases);
      assert.deepEqual(limits, input.limits);
      return {
        status: 'completed', outputs: [{ caseId: 'zero', value: 0 }],
        usage: { wallMs: 1, memoryBytes: 1024, fuel: 100 }, effects: [],
      };
    },
    scanEffects(candidate) {
      calls.push('scan');
      assert.equal(candidate, input.candidate);
      return [];
    },
  };
  return { input, port, calls };
}

function rejected(result, check) {
  assert.equal(result.passed, false);
  assert.equal(result.firstFailure, check);
  assert.deepEqual(result.results.map(r => r.check), GATE_ORDER.slice(0, GATE_ORDER.indexOf(check) + 1));
  assert.deepEqual(result.results.filter(r => !r.passed).map(r => r.check), [check]);
  assert(result.results.every(r => typeof r.reason === 'string' && r.reason.length > 0));
}

test('positive control passes all five gates with a deterministic verdict and port conformance', async () => {
  const { input, port, calls } = probe();
  const first = await runUniversalGates(input, port);
  assert.deepEqual(first, await runUniversalGates(input, port));
  assert.equal(first.passed, true);
  assert.equal(first.firstFailure, null);
  assert.deepEqual(first.results.map(r => r.check), GATE_ORDER);
  assert(first.results.every(r => r.passed && r.reason.length > 0));
  assert.deepEqual(calls, ['describe', 'run', 'run', 'scan', 'describe', 'run', 'run', 'scan']);
});

test('schema rejects malformed contracts, probes and limits before any port call', async () => {
  for (const mutate of [
    x => { x.extra = true; }, x => { x.contract.version = 2; },
    x => { x.contract.signature.inputs[0].type = 'unknown'; },
    x => { x.contract.signature.inputs[0].domain = [1, 0]; },
    x => { x.contract.sources = []; }, x => { x.cases = []; },
    x => { x.cases.push(x.cases[0]); }, x => { x.allowedEffects = null; },
    x => { x.limits.fuel = 0; }, x => { x.limits.wallMs = Infinity; },
    x => { x.limits.memoryBytes = true; }, x => { x.limits.fuel = 0.5; },
    x => { x.cases[0].inputs.x = NaN; }, x => { x.cases[0].inputs.x = undefined; },
  ]) {
    const { input, port, calls } = probe();
    mutate(input);
    rejected(await runUniversalGates(input, port), 'schema');
    assert.deepEqual(calls, []);
  }
});

test('interface rejects wrong name, type, unit, arity and domain without running', async () => {
  for (const mutate of [s => { s.name = 'other'; }, s => { s.output.type = 'string'; },
    s => { s.output.unit = 'K'; }, s => { s.inputs = []; }, s => { s.inputs[0].domain = [0, 9]; }]) {
    const { input, port, calls } = probe();
    const describe = port.describe;
    port.describe = candidate => { const s = describe(candidate); mutate(s); return s; };
    rejected(await runUniversalGates(input, port), 'interface');
    assert.deepEqual(calls, ['describe']);
  }
});

test('bounds rejects each exceeded resource on either run and stops immediately', async () => {
  for (const resource of ['wallMs', 'memoryBytes', 'fuel']) for (const failOn of [1, 2]) {
    const { input, port, calls } = probe();
    const run = port.run;
    let count = 0;
    port.run = (...args) => {
      const result = run(...args);
      if (++count === failOn) result.usage[resource] = input.limits[resource] + 1;
      return result;
    };
    const result = await runUniversalGates(input, port);
    rejected(result, 'bounds');
    assert.match(result.results.at(-1).reason, new RegExp(resource));
    assert.deepEqual(calls, ['describe', ...Array(failOn).fill('run')]);
  }
});

test('incomplete, missing, invalid and wrongly typed runtime evidence fails closed', async () => {
  for (const mutate of [
    r => { r.status = 'timeout'; }, r => { delete r.usage.fuel; },
    r => { r.usage.wallMs = -1; }, r => { r.usage.fuel = true; },
    r => { r.outputs = []; }, r => { r.outputs[0].caseId = 'other'; },
    r => { r.outputs[0].value = '0'; }, r => { r.outputs[0].value = NaN; },
    r => { r.effects = null; },
  ]) {
    const { input, port } = probe();
    const run = port.run;
    port.run = (...args) => { const result = run(...args); mutate(result); return result; };
    rejected(await runUniversalGates(input, port), 'bounds');
  }
});

test('determinism compares values, full refusals and effects but excludes usage', async () => {
  for (const kind of ['value', 'refusal', 'effect', 'usage']) {
    const { input, port, calls } = probe();
    const run = port.run;
    let count = 0;
    port.run = (...args) => {
      const r = run(...args);
      count++;
      if (kind === 'value') r.outputs[0].value = count;
      if (kind === 'refusal') r.outputs = [{ caseId: 'zero', error: { path: 'x', reason: String(count) } }];
      if (kind === 'effect' && count === 2) r.effects = ['network'];
      if (kind === 'usage') r.usage.wallMs = count;
      return r;
    };
    const result = await runUniversalGates(input, port);
    if (kind === 'usage') assert.equal(result.passed, true);
    else { rejected(result, 'determinism'); assert(!calls.includes('scan')); }
  }
});

test('forbidden effects checks both static capabilities and runtime attempts with an explicit allowlist', async () => {
  for (const origin of ['static', 'runtime']) for (const allowed of [false, true]) {
    const { input, port } = probe();
    if (allowed) input.allowedEffects = ['network'];
    if (origin === 'static') port.scanEffects = () => ['network'];
    else {
      const run = port.run;
      port.run = (...args) => ({ ...run(...args), effects: ['network'] });
    }
    const result = await runUniversalGates(input, port);
    if (allowed) assert.equal(result.passed, true);
    else { rejected(result, 'forbidden_effects'); assert.match(result.results.at(-1).reason, /network/); }
  }
});

test('missing methods and rejected async port operations become first-failure records', async () => {
  for (const [method, check] of [['describe', 'interface'], ['run', 'bounds'], ['scanEffects', 'forbidden_effects']]) {
    for (const missing of [false, true]) {
      const { input, port } = probe();
      if (missing) delete port[method];
      else port[method] = async () => { throw new Error('port refused'); };
      const first = await runUniversalGates(input, port);
      rejected(first, check);
      assert.deepEqual(first, await runUniversalGates(input, port));
    }
  }
});

test('each replay receives isolated inputs and the first outcome is snapshotted', async () => {
  const { input, port } = probe();
  const before = structuredClone(input);
  const shared = port.run(input.candidate, input.cases, input.limits);
  let round = 0;
  port.run = async (candidate, cases, limits) => {
    assert.deepEqual(cases, before.cases);
    assert.deepEqual(limits, before.limits);
    cases[0].inputs.x = 99;
    limits.fuel = 999;
    shared.outputs[0].value = round++;
    return shared;
  };
  rejected(await runUniversalGates(input, port), 'determinism');
  assert.deepEqual(input, before);
});

test('caller mutation after invocation cannot change the checked policy', async () => {
  const { input, port } = probe();
  port.run = () => ({
    status: 'completed', outputs: [{ caseId: 'zero', value: 0 }],
    usage: { wallMs: 1, memoryBytes: 1024, fuel: 100 }, effects: ['network'],
  });
  const pending = runUniversalGates(input, port);
  input.allowedEffects.push('network');
  rejected(await pending, 'forbidden_effects');
});
