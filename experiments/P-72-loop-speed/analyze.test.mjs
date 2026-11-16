import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, bootstrap, checkCorrection, expectedTime, hedge, quantile, race } from './analyze.mjs';
import { startOrder, verifiedPrecommit } from './design.mjs';

const precommit = 'ab'.repeat(32);
const row = ({ need, arm, sample = 0, promoted = true, wall, escaped = false, corrections = [], begins = [0, wall * 500], heldOut = null }) => ({
  stage: 'synthetic', testDouble: true, need, arm, sample, promoted, wallMs: wall * 1000, escaped, heldOut, corrections, complete: true, limits: arm === 'oracle' ? { oracle: true } : {},
  replies: begins.map(beginMs => ({ beginMs, endMs: beginMs + 1, costUsd: 0.01, detail: { output: 100 }, causes: [] })), calls: begins.length, outputTokens: 100 * begins.length, leu: 0.01 * begins.length,
  rounds: [{ failed: false, gates: [], failingTests: 0, g8: null }], firstCheck: { g4: true, g7: true, gates: [], pass: true }, g8Failures: [], oracleFlags: [], oracle: null,
  extraTurns: { g8: 0, afterPass: 0, repeated: 0, oracleFlag: 0, failedCheck: 0, invalidReply: 0 }, loadStart: 1, loadEnd: 1, loaded: false });

function arm(name, needs, wallOf, { failures = {}, escapes = {}, corrections = {} } = {}) {
  return needs.flatMap((need, n) => Array.from({ length: 4 }, (_, sample) => row({ need, arm: name, sample, wall: wallOf(n, sample), promoted: !(failures[need] ?? []).includes(sample),
    escaped: (escapes[need] ?? []).includes(sample), corrections: sample === 0 ? corrections[need] ?? [] : [] })));
}
const needs = count => Array.from({ length: count }, (_, i) => `R-${i}`);
const verdictOf = (analysis, name) => analysis.verdicts.find(v => v.arm === name);

test('expected time is the mean wall time over the share promoted, and infinite when nothing promoted', () => {
  const runs = [10, 20, 30, 40].map((wall, i) => row({ need: 'n', arm: 'main', wall, promoted: i < 2 }));
  assert.equal(expectedTime(runs), 50);
  assert.equal(expectedTime(runs.map(r => ({ ...r, promoted: false }))), Infinity);
  assert.equal(quantile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
});

test('the bootstrap resamples per-need differences with a seed and returns the constant for constant differences', () => {
  assert.deepEqual(bootstrap([2, 2, 2], 7, 1000), [2, 2]);
  const spread = [1, -3, 4, 0.5, 2.25, -1.125, 0.375, 5.5, -2.75, 1.625, 3.125, -0.625];
  assert.deepEqual(bootstrap(spread, 99, 2000), bootstrap(spread, 99, 2000));
  assert.notDeepEqual(bootstrap(spread, 99, 2000), bootstrap(spread, 100, 2000));
});

test('a lever that is faster on every need has an interval that excludes zero, and the rules adopt it', () => {
  const list = needs(12), base = (n, s) => 20 + n + s * 0.25;
  const rows = [...arm('main', list, base), ...arm('fixed', list, (n, s) => base(n, s) - 1), ...arm('oracle', list, (n, s) => base(n, s) - 2 + (n % 3) * 0.2),
    ...arm('overlap', list, (n, s) => base(n, s) - 4 - (n % 2)), ...arm('compact', list, (n, s) => base(n, s) - 1.5)];
  const analysis = analyze(rows, { precommit, resamples: 10000 });
  const fixed = verdictOf(analysis, 'fixed');
  assert.equal(fixed.met, true);
  assert.ok(Math.abs(fixed.changeSeconds + 1) < 1e-9);
  const oracle = verdictOf(analysis, 'oracle');
  assert.ok(oracle.interval[1] < 0 && oracle.met, JSON.stringify(oracle));
  assert.equal(oracle.outcome, '`limits.oracle` defaults to on');
  const overlap = verdictOf(analysis, 'overlap');
  assert.ok(Math.abs(overlap.changeSeconds + 3.5) < 1e-9 && overlap.interval[1] < 0 && overlap.met);
  assert.equal(verdictOf(analysis, 'compact').outcome, 'the compact form defaults to on');
  const fixedWalls = rows.filter(r => r.arm === 'fixed').map(r => r.wallMs / 1000);
  assert.deepEqual(analysis.arms.fixed.promotedWall, { p50: quantile(fixedWalls, 0.5), p90: quantile(fixedWalls, 0.9) });
  assert.equal(analysis.arms.main.passRate, 1);
});

test('a lever with no consistent effect has an interval that includes zero, and the rules keep the default', () => {
  const list = needs(12), base = (n, s) => 30 + s;
  const swing = n => (n % 2 ? 3 : -3);
  const rows = [...arm('main', list, base), ...arm('fixed', list, base), ...arm('oracle', list, (n, s) => base(n, s) + swing(n)), ...arm('compact', list, (n, s) => base(n, s) - swing(n))];
  const analysis = analyze(rows, { precommit, resamples: 10000 });
  for (const name of ['oracle', 'compact']) {
    const v = verdictOf(analysis, name);
    assert.ok(Math.abs(v.changeSeconds) < 1e-9);
    assert.ok(v.interval[0] < 0 && v.interval[1] > 0, JSON.stringify(v.interval));
    assert.equal(v.met, false);
  }
  assert.equal(verdictOf(analysis, 'overlap').decided, false);
});

test('pass within two points, escapes and contradicted corrections decide as the precommit says', () => {
  const list = Array.from({ length: 25 }, (_, i) => (i === 0 ? 'H01' : `R-${i}`)), base = () => 20;
  const twoFewer = { 'R-1': [1], 'R-2': [2] }, threeMore = { ...twoFewer, 'R-3': [3], 'R-5': [0], 'R-6': [1] };
  const wrong = { H01: [{ index: 1, frozen: { name: 'one', fn: 'kwToHp', args: [1], expect: 1.3412, tol: 1e-9 } }] };
  const rows = [...arm('main', list, base), ...arm('fixed', list, () => 19, { failures: twoFewer }), ...arm('oracle', list, () => 18, { failures: twoFewer, corrections: wrong }),
    ...arm('compact', list, () => 18, { failures: threeMore }), ...arm('overlap', list, () => 17, { escapes: { 'R-4': [0] } })];
  const analysis = analyze(rows, { precommit, resamples: 2000 });
  const fixed = verdictOf(analysis, 'fixed');
  assert.ok(Math.abs(fixed.pass.difference + 0.02) < 1e-12);
  assert.equal(fixed.checks.notWorseOnPass, true);
  assert.equal(fixed.met, true);
  const oracle = verdictOf(analysis, 'oracle');
  assert.equal(analysis.arms.oracle.oracle.contradicted, 1);
  assert.equal(oracle.checks.noContradictedCorrection, false);
  assert.equal(oracle.met, false);
  const compact = verdictOf(analysis, 'compact');
  assert.equal(compact.checks.notWorseOnPass, false);
  assert.equal(compact.met, false);
  const overlap = verdictOf(analysis, 'overlap');
  assert.equal(overlap.escapes.arm, 1);
  assert.equal(overlap.checks.noMoreEscapes, false);
  assert.equal(overlap.outcome, 'implementation overlap stays behind its flag');
});

test('a corrected value is checked against the H need reference, and R needs are left unchecked', () => {
  assert.equal(checkCorrection('H01', { frozen: { fn: 'kwToHp', args: [1], expect: 1000 / 745.699872, tol: 1e-9 } }).status, 'agrees');
  assert.equal(checkCorrection('H01', { frozen: { fn: 'kwToHp', args: [1], expect: 1.3412, tol: 1e-9 } }).status, 'contradicted');
  assert.equal(checkCorrection('H01', { frozen: { fn: 'kwToHp', args: [-1], expectError: true } }).status, 'agrees');
  assert.equal(checkCorrection('H01', { frozen: { fn: 'kwToHp', args: [-1], expect: 0 } }).status, 'contradicted');
  assert.equal(checkCorrection('CC-001', { frozen: { fn: 'x', args: [1], expect: 1 } }).status, 'unchecked');
});

test('the hedge starts a second attempt only past the threshold, and races cancel at the first promotion', () => {
  const slow = row({ need: 'n', arm: 'fixed', wall: 40, begins: [0, 20000, 35000] }), quick = row({ need: 'n', arm: 'fixed', wall: 10, begins: [0, 5000] });
  assert.deepEqual(hedge(slow, quick, 20000), { pass: true, time: 30, end: 30, calls: 4, started: 2, escaped: false });
  assert.deepEqual(hedge(quick, slow, 20000), { pass: true, time: 10, end: 10, calls: 2, started: 1, escaped: false });
  const failed = { ...row({ need: 'n', arm: 'fixed', wall: 50, begins: [0, 15000, 30000] }), promoted: false };
  assert.deepEqual(race([{ row: failed, offset: 0 }, { row: quick, offset: 0 }]), { pass: true, time: 10, end: 10, calls: 3, started: 2, escaped: false });
  assert.deepEqual(race([{ row: failed, offset: 0 }]), { pass: false, time: null, end: 50, calls: 3, started: 1, escaped: false });
});

test('the per-need start order is a seeded permutation that differs between needs', () => {
  const hashed = verifiedPrecommit();
  const a = startOrder(hashed, 'H01', 20), b = startOrder(hashed, 'H05', 20);
  assert.deepEqual([...a].sort((x, y) => x - y), Array.from({ length: 20 }, (_, i) => i));
  assert.deepEqual(a, startOrder(hashed, 'H01', 20));
  assert.notDeepEqual(a, b);
});
