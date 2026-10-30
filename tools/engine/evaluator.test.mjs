import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { evaluateCandidates, paretoFrontier, requireFrozen } from './evaluator.mjs';
import { GATE_ORDER } from './gates.mjs';

function fixture(t, configure = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ef06-'));
  t.after(() => rmSync(directory, { recursive: true }));
  const root = join(directory, 'evaluator');
  mkdirSync(root);
  writeFileSync(join(root, 'residual.txt'), 'identity preserves x');
  const signature = { version: 1, name: 'identity', inputs: [{ path: 'x', type: 'number', unit: '1', domain: [0, 10] }], output: { type: 'number', unit: '1' } };
  const configuration = {
    gateInput: { version: 1, contract: { version: 1, signature, refusals: [], tolerance: 0, sources: ['EF06 control'] },
      cases: [{ id: 'zero', inputs: { x: 0 } }], limits: { wallMs: 10, memoryBytes: 1024, fuel: 100 }, allowedEffects: [] },
    invariants: ['identity'], objectives: { latency: 'min', quality: 'max' },
  };
  configure(configuration);
  const reference = { ledger: join(directory, 'ledger.sqlite'), root };
  reference.identity = execFileSync('python3', ['-B', '-c', `
import json, sys
from tools.ledger.ledger import Ledger
from tools.ledger.frozen import FrozenEvaluators
request = json.load(sys.stdin)
ledger = Ledger(request['ledger'])
for kind, identity, data in [('task', 't1', dict(intent='Identity', acceptance='x preserved')),
                            ('admitted_input', 'i1', dict(task='t1', content='0', origin='user'))]:
    ledger.append(dict(version=0, kind=kind, id=identity, data=data))
frozen = FrozenEvaluators(ledger).freeze(request['root'], task='t1', admitted_input='i1',
    confirmed_by='test contract', qualification='positive and negative controls',
    synthesis_context=dict(id='context', candidate_blind='confirmed', inputs=['i1']),
    configuration=request['configuration'], residual='identity preserves x', invariant_version='v1')
print(frozen['id'])
`], { cwd: fileURLToPath(new URL('../../', import.meta.url)), input: JSON.stringify({ ...reference, configuration }), encoding: 'utf8' }).trim();
  const calls = [];
  const metrics = { a: { latency: 1, quality: 1 }, b: { latency: 2, quality: 2 }, c: { latency: 3, quality: 1 } };
  const port = {
    describe: () => signature,
    run: () => ({ status: 'completed', outputs: [{ caseId: 'zero', value: 0 }], usage: { wallMs: 1, memoryBytes: 10, fuel: 1 }, effects: [] }),
    scanEffects: () => [],
    invariant(name, candidate, bundle, round) {
      assert.equal(name, 'identity');
      assert.equal(bundle.invariant_version, 'v1');
      calls.push(`invariant:${candidate}:${round}`);
      return { passed: true, reason: 'identity holds' };
    },
    residual(candidate, bundle, round) {
      assert.equal(Buffer.from(bundle.files['residual.txt'], 'hex').toString(), bundle.residual);
      calls.push(`residual:${candidate}:${round}`);
      return { passed: true, reason: 'request holds' };
    },
    measure(candidate, bundle, round) {
      assert.deepEqual(bundle.configuration, configuration);
      calls.push(`measure:${candidate}:${round}`);
      return metrics[candidate];
    },
  };
  return { reference, port, calls, root };
}

test('engine conformance: fixed layers, frozen identity, deterministic Pareto selection and fresh finalists', async t => {
  const { reference, port, calls } = fixture(t);
  const first = await evaluateCandidates(reference, ['a', 'b', 'c'], port);
  assert.deepEqual(first, await evaluateCandidates(reference, ['a', 'b', 'c'], port));
  assert.equal(first.stage, 'completed');
  assert.deepEqual(first.frontier, ['a', 'b']);
  assert.deepEqual(first.attempts.map(r => [r.candidate, r.round]), [['a', 0], ['b', 0], ['c', 0], ['a', 1], ['b', 1]]);
  for (const attempt of first.attempts) {
    assert.equal(attempt.frozen_evaluator, reference.identity);
    assert.equal(attempt.evaluator_digest, (await requireFrozen(reference)).digest);
    assert.deepEqual(attempt.results.map(r => r.check), [...GATE_ORDER, 'invariant:identity', 'residual']);
  }
  assert.deepEqual(calls.slice(0, 3), ['invariant:a:0', 'residual:a:0', 'measure:a:0']);
});

test('invalid frozen policies and duplicate candidate identities refuse before host operations', async t => {
  for (const configure of [c => { c.weights = {}; }, c => { c.objectives.latency = 0.5; },
    c => { c.invariants.push('identity'); }, c => { c.gateInput.candidate = 'a'; }]) {
    const { reference, port, calls } = fixture(t, configure);
    await assert.rejects(evaluateCandidates(reference, ['a'], port));
    assert.deepEqual(calls, []);
  }
  const { reference, port, calls } = fixture(t);
  await assert.rejects(evaluateCandidates(reference, ['a', 'a'], port), /unique/);
  assert.deepEqual(calls, []);
});

test('first failing gate, invariant or residual prevents measurement and ranking', async t => {
  const { reference, port, calls } = fixture(t);
  for (const [method, check, value] of [
    ['describe', 'interface', {}], ['run', 'bounds', { status: 'timeout' }],
    ['scanEffects', 'forbidden_effects', ['network']],
    ['invariant', 'invariant:identity', { passed: false, reason: 'broken invariant' }],
    ['residual', 'residual', { passed: false, reason: 'wrong result' }],
    ['residual', 'residual', { passed: 'yes', reason: 'malformed' }],
  ]) {
    calls.length = 0;
    const result = await evaluateCandidates(reference, ['a'], { ...port, [method]: () => value });
    assert.deepEqual(result.frontier, []);
    assert.equal(result.attempts[0].firstFailure, check);
    assert.deepEqual(result.attempts[0].results.filter(r => !r.passed).map(r => r.check), [check]);
    assert(!calls.some(call => call.startsWith('measure:')));
  }
});

test('a finalist that fails fresh residual checks is removed', async t => {
  const { reference, port } = fixture(t);
  port.residual = (candidate, bundle, round) => ({ passed: round === 0, reason: 'fresh residual evidence' });
  const result = await evaluateCandidates(reference, ['a'], port);
  assert.deepEqual(result.frontier, []);
  assert.equal(result.attempts[1].firstFailure, 'residual');
});

test('final selection uses fresh measurements and stops on an explicitly unknown finalist', async t => {
  const { reference, port } = fixture(t);
  const measure = port.measure;
  port.measure = (candidate, bundle, round) => round === 0 ? measure(candidate, bundle, round) :
    { latency: candidate === 'a' ? 3 : 1, quality: 2 };
  assert.deepEqual((await evaluateCandidates(reference, ['a', 'b'], port)).frontier, ['b']);
  port.residual = (candidate, bundle, round) => round === 0 ? { passed: true, reason: 'pass' } : { status: 'outcome_unknown' };
  const result = await evaluateCandidates(reference, ['a'], port);
  assert.equal(result.stage, 'outcome_unknown');
  assert.equal(result.attempts[1].firstFailure, 'residual');
  assert.deepEqual(result.frontier, []);
  port.run = () => ({ status: 'outcome_unknown' });
  assert.equal((await evaluateCandidates(reference, ['a'], port)).stage, 'outcome_unknown');
});

test('host exceptions stop the campaign as outcome_unknown without selecting earlier survivors', async t => {
  const { reference, port } = fixture(t);
  for (const method of ['describe', 'run', 'scanEffects', 'invariant', 'residual', 'measure']) {
    const result = await evaluateCandidates(reference, ['a', 'b'], { ...port, [method]: async () => { throw new Error('lost acknowledgment'); } });
    assert.equal(result.stage, 'outcome_unknown');
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].stage, 'outcome_unknown');
    assert.deepEqual(result.frontier, []);
  }
  port.measure = candidate => { if (candidate === 'b') throw new Error('lost'); return { latency: 1, quality: 1 }; };
  assert.deepEqual((await evaluateCandidates(reference, ['a', 'b'], port)).frontier, []);
});

test('missing identity and evaluator drift fail closed before execution and after measurement', async t => {
  const { reference, port, calls, root } = fixture(t);
  await assert.rejects(evaluateCandidates({ ...reference, identity: 'missing' }, ['a'], port), /frozen/);
  assert.deepEqual(calls, []);
  const measure = port.measure;
  port.measure = (...args) => { writeFileSync(join(root, 'residual.txt'), 'changed'); return measure(...args); };
  const result = await evaluateCandidates(reference, ['a', 'b'], port);
  assert.equal(result.stage, 'rejected');
  assert.equal(result.attempts[0].firstFailure, 'frozen');
  assert.deepEqual(result.frontier, []);
  calls.length = 0;
  await assert.rejects(evaluateCandidates(reference, ['a'], port), /frozen/);
  assert.deepEqual(calls, []);
});

test('frozen policy and measurement evidence are isolated from callback mutation', async t => {
  const { reference, port } = fixture(t);
  port.residual = (candidate, bundle) => {
    bundle.configuration.objectives.latency = 'max';
    bundle.configuration.gateInput.allowedEffects.push('network');
    return { passed: true, reason: 'pass' };
  };
  assert.deepEqual((await evaluateCandidates(reference, ['a', 'b', 'c'], port)).frontier, ['a', 'b']);
  for (const metrics of [{ latency: NaN, quality: 1 }, { latency: 1 }, { latency: 1, quality: 1, weight: 1 }]) {
    port.measure = () => metrics;
    const result = await evaluateCandidates(reference, ['a'], port);
    assert.equal(result.attempts[0].firstFailure, 'measurement');
    assert.deepEqual(result.frontier, []);
  }
});

test('Pareto keeps ties and tradeoffs without a weighted score; malformed objectives fail closed', () => {
  const rows = [[1, 1], [2, 2], [3, 1], [1, 1]].map(([latency, quality], candidate) => ({ candidate, metrics: { latency, quality } }));
  assert.deepEqual(paretoFrontier(rows, { latency: 'min', quality: 'max' }).map(r => r.candidate), [0, 1, 3]);
  for (const objectives of [{}, { latency: 0.5, quality: 0.5 }, { latency: 'min' }]) assert.throws(() => paretoFrontier(rows, objectives));
  assert.deepEqual(paretoFrontier([], { latency: 'min' }), []);
});
