import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clopperPearson, upperBound, cohenKappa, decideX1, shuffle, betainc } from '../lib/stats.mjs';

const close = (a, b, tol) => Math.abs(a - b) <= tol;

test('betainc sanity', () => {
  assert.ok(close(betainc(0.5, 1, 1), 0.5, 1e-12));
  assert.ok(close(betainc(0.25, 2, 3), 0.2617, 1e-4)); // tabulated
});

test('R14 X1 intervals: 0/20 upper 16.8 %', () => {
  const ci = clopperPearson(0, 20);
  assert.equal(ci.lower, 0);
  assert.ok(close(ci.upper, 0.168, 5e-4), `upper ${ci.upper}`);
});

test('R14 X1 intervals: 12/60 is 10.8–32.3 %', () => {
  const ci = clopperPearson(12, 60);
  assert.ok(close(ci.lower, 0.108, 1e-3), `lower ${ci.lower}`);
  assert.ok(close(ci.upper, 0.323, 1e-3), `upper ${ci.upper}`);
});

test('C01 §3 bounds: 8/20 lower 19.1 %, 9/20 lower 23.1 %, 1/20 is 0.1–24.9 %', () => {
  assert.ok(close(clopperPearson(8, 20).lower, 0.191, 1e-3));
  assert.ok(close(clopperPearson(9, 20).lower, 0.231, 1e-3));
  const one = clopperPearson(1, 20);
  assert.ok(close(one.lower, 0.0013, 5e-4) && close(one.upper, 0.249, 1e-3));
});

test('R14 §2.1 one-sided bounds: 0/2995 → 0.10 %, 0/29956 → 0.010 %, 0/1081 → 0.28 %', () => {
  assert.ok(close(upperBound(0, 2995), 0.0010, 2e-5));
  assert.ok(close(upperBound(0, 29956), 0.00010, 2e-6));
  assert.ok(close(upperBound(0, 1081), 0.0028, 5e-5));
});

test('decision bands (DP-6)', () => {
  assert.equal(decideX1(0, 20).decision, 'kill');
  assert.equal(decideX1(1, 20).decision, 'kill');
  assert.equal(decideX1(2, 20).decision, 'extend to 60');
  assert.equal(decideX1(7, 20).decision, 'extend to 60');
  assert.equal(decideX1(8, 20).decision, 'pass');
  assert.equal(decideX1(11, 60).decision, 'kill');
  assert.equal(decideX1(12, 60).decision, 'pass');
  assert.equal(decideX1(1, 20).pointEstimateDecision, true);
  assert.equal(decideX1(0, 20).pointEstimateDecision, false);
});

test("Cohen's kappa", () => {
  const k = cohenKappa(['y', 'y', 'n', 'n'], ['y', 'y', 'n', 'n']);
  assert.equal(k.kappa, 1);
  const k2 = cohenKappa(['y', 'n', 'y', 'n'], ['y', 'y', 'n', 'n']);
  assert.ok(close(k2.kappa, 0, 1e-12));
  const k3 = cohenKappa(['a', 'a', 'b', 'b', 'a'], ['a', 'b', 'b', 'b', 'a']);
  assert.ok(close(k3.kappa, 0.6154, 1e-3)); // po=0.8, pe=0.6*0.4+0.4*0.6=0.48
});

test('seeded shuffle is reproducible and a permutation', () => {
  const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], 42);
  const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8], 42);
  assert.deepEqual(a, b);
  assert.deepEqual(a.slice().sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.notDeepEqual(shuffle([1, 2, 3, 4, 5, 6, 7, 8], 43), a);
});
