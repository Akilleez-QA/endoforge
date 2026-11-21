import assert from 'node:assert/strict';
import test from 'node:test';
import { forgeEvidenceHash, reduceForgeResults } from '../forge-core.mjs';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture } from './fixtures/ledger-fixture.mjs';

const row = (patch = {}) => ({ address: 'fixture', value: ['ok'], outcome: {
  verdict: 'pass', evidenceHash: 'a'.repeat(64), verifyCost: 1, generateCost: 10, ...patch,
} });

for (const field of ['verdict', 'evidenceHash', 'verifyCost', 'generateCost']) {
  test(`merge refuses missing ${field}`, () => {
    const input = row();
    delete input.outcome[field];
    assert.throws(() => reduceForgeResults('set-union', [input]), /outcome|cost|verdict|evidence/);
  });
}

test('merge refuses failed unknown malformed and expensive verification', () => {
  assert.throws(() => reduceForgeResults('set-union', [{ value: ['unverified'] }]), /verdict/);
  for (const verdict of ['fail', 'unknown']) assert.throws(() => reduceForgeResults('set-union', [row(), row({ verdict })]), /verdict/);
  for (const verifyCost of [-1, NaN, Infinity, '1', null]) assert.throws(() => reduceForgeResults('set-union', [row({ verifyCost })]), /cost/);
  assert.throws(() => reduceForgeResults('set-union', [row({ evidenceHash: 'bad' })]), /evidence/);
  assert.throws(() => reduceForgeResults('set-union', [row({ verifyCost: 10 })]), /cheaper/);
  assert.throws(() => reduceForgeResults('set-union', [row({ generateCost: 0 })]), /cost/);
});

test('evidence replays canonically and binds inputs value verdict and evidence', () => {
  const input = { address: 'inputs-hash', value: ['ok'], verdict: 'pass', evidence: { b: 2, a: 1 } };
  const expected = '478cf538dfd292a9456328d97a8bc8b7c889a3166e8f4bb483feba0ea264c768';
  assert.equal(forgeEvidenceHash(input), expected);
  assert.equal(expected, forgeEvidenceHash({ ...input, evidence: { a: 1, b: 2 } }));
  for (const patch of [{ address: 'other-inputs' }, { value: ['wrong'] }, { verdict: 'fail' }, { evidence: {} }]) {
    assert.notEqual(expected, forgeEvidenceHash({ ...input, ...patch }));
  }
});

test('merge receipt exposes aggregate verification costs and ratio independent of order', () => {
  const rows = [row(), row({ verifyCost: 2, generateCost: 20 })];
  const merged = reduceForgeResults('set-union', rows);
  assert.equal(merged.outcome.verdict, 'pass');
  assert.match(merged.outcome.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(merged.outcome.verifyCost, 3);
  assert.equal(merged.outcome.generateCost, 30);
  assert.equal(merged.outcome.verifyGenerateRatio, 0.1);
  assert.equal(reduceForgeResults('set-union', [row({ verifyCost: 0 })]).outcome.verifyGenerateRatio, 0);
  assert.equal(reduceForgeResults('set-union', []).outcome.verdict, 'unknown');
  assert.throws(() => reduceForgeResults('set-union', [reduceForgeResults('set-union', [])]), /verdict/);
  assert.deepEqual(merged, reduceForgeResults('set-union', rows.reverse()));
});

test('pool rejects unverified results evicts them for retry and retains loser evidence', async t => {
  const { job } = await fixture(t);
  const budget = { tokens: 20, verifyMs: 60000, dollars: 20 };
  const pool = new IsolatePool({ size: 2, hostPort: fileURLToPath(new URL('./fixtures/host-call-port.mjs', import.meta.url)),
    forge: { codeVersion: 'fixture-v1', maxDepth: 1, maxFanOut: 2 } });
  t.after(() => pool.close());
  for (const outcome of [null, ...['verdict', 'evidenceHash', 'verifyCost', 'generateCost'].map(omit => ({ omit })), { verdict: 'fail' }, { verdict: 'unknown' }, { verifyCost: -1 }, { evidenceHash: 'b'.repeat(64) }, { verifyCost: null }]) {
    const child = { goal: 'verify', inputs: { value: ['untrusted'], outcome }, codeVersion: 'fixture-v1', budget: { tokens: 2, verifyMs: 10000, dollars: 2 } };
    const call = { op: 'spawn', children: [child], budget: { tokens: 5, verifyMs: 20000, dollars: 5 }, merge: 'set-union' };
    const result = await pool.run({ ...job(['pass'], { forgeCalls: [call, call] }), budget, ledger: 'caller' });
    for (const receipt of result.evidence.seen) {
      assert.equal(receipt.outcome?.verdict, 'unknown', JSON.stringify(receipt));
      assert.equal(receipt.value, undefined);
      assert.equal(receipt.children[0].status, 'rejected');
      assert.equal(receipt.children[0].cacheHit, false);
      if (outcome?.verdict === 'fail') assert.match(receipt.children[0].outcome.evidenceHash, /^[a-f0-9]{64}$/);
    }
  }
});

test('fractional cost metrics stay deterministic over shuffled arrivals', () => {
  const rows = [row({ verifyCost: 0.1, generateCost: 1 }), row({ verifyCost: 0.2, generateCost: 2 }), row({ verifyCost: 0.3, generateCost: 3 })];
  assert.deepEqual(reduceForgeResults('set-union', rows), reduceForgeResults('set-union', [...rows].reverse()));
});
