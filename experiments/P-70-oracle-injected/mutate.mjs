import { createHash } from 'node:crypto';
import { loadKernel } from '../../core/runtime/x1/meter.mjs';
import { callKernel, freshKernel, kernelFuel } from '../../core/runtime/x1/measure.mjs';

export const classes = ['sign', 'scale', 'rounding', 'swap', 'boundary'];
const relativeFloor = 1e-9;
const pick = (key, salt) => createHash('sha256').update(`P-70:70:${salt}:${key}`).digest();

export function evaluator(compiled) {
  const loaded = loadKernel(Buffer.from(compiled.wasm, 'base64'), kernelFuel);
  return (fn, args) => {
    const got = callKernel(freshKernel(loaded), fn, args);
    if (got.limit) return { limit: got.limit };
    if (got.trap) return { trap: true };
    return { value: typeof got.value === 'bigint' ? Number(got.value) : got.value };
  };
}

export const margin = (test, value) => 2 * Math.max(Number.isFinite(test.tol) ? test.tol : 0, relativeFloor * Math.max(1, Math.abs(value)));
export const passes = (test, outcome) => test.expectError ? outcome.trap === true
  : !outcome.trap && !outcome.limit && typeof test.expect === 'number' ? (Number.isFinite(test.tol) ? Math.abs(Number(outcome.value) - test.expect) <= test.tol : Number(outcome.value) === test.expect)
    : !outcome.trap && !outcome.limit && typeof test.expect === 'boolean' ? Boolean(outcome.value) === test.expect || outcome.value === (test.expect ? 1 : 0) : false;

const certainlyWrong = (test, truth, value) => Number.isFinite(value) && Math.abs(value - truth) > margin(test, truth) && Math.abs(value - test.expect) > margin(test, test.expect);
const fourFigures = value => { const step = 10 ** (Math.floor(Math.log10(Math.abs(value))) - 3); return { rounded: Math.round(value / step) * step, step }; };
const neighbours = x => Number.isInteger(x) ? [x - 1, x + 1] : [x - 1e-6 * Math.max(1, Math.abs(x)), x + 1e-6 * Math.max(1, Math.abs(x))];

function numberMutation(kind, test, truth, run, key) {
  const bit = pick(key, kind)[0];
  if (kind === 'sign') return truth !== 0 ? { expect: -test.expect, detail: 'negated' } : null;
  if (kind === 'scale') {
    const [factor, label] = [[1000, 'x1000'], [1 / 1000, '/1000'], [3.6, 'x3.6'], [1 / 3.6, '/3.6']][bit % 4];
    return truth !== 0 ? { expect: test.expect * factor, detail: label } : null;
  }
  if (kind === 'rounding') {
    if (truth === 0) return null;
    const { rounded, step } = fourFigures(test.expect);
    return { expect: rounded + (bit % 2 ? step : -step), detail: 'four figures, last digit off by one' };
  }
  if (kind === 'swap') {
    const numeric = test.args.map((a, i) => ({ a, i })).filter(({ a }) => Number.isFinite(a));
    if (numeric.length < 2) return null;
    const [first, second] = [numeric[0].i, numeric[1].i];
    if (test.args[first] === test.args[second]) return null;
    const swapped = [...test.args]; [swapped[first], swapped[second]] = [swapped[second], swapped[first]];
    const got = run(test.fn, swapped);
    return got.trap || got.limit || !Number.isFinite(Number(got.value)) ? null : { expect: Number(got.value), detail: `value of args ${first} and ${second} swapped` };
  }
  return null;
}

function boundaryMutation(test, truthOutcome, run) {
  for (const [i, x] of test.args.entries()) {
    if (!Number.isFinite(x)) continue;
    for (const y of neighbours(x)) {
      const args = [...test.args]; args[i] = y;
      const near = run(test.fn, args);
      if (near.limit) continue;
      if (!test.expectError && near.trap) return { test: { ...withoutExpect(test), expectError: true }, detail: `value test next to a trap edge (arg ${i}) claims a trap` };
      if (test.expectError && !near.trap && Number.isFinite(Number(near.value))) return { test: { ...withoutExpect(test), expect: Number(near.value), tol: 0 }, detail: `trap test next to a value edge (arg ${i}) claims the neighbouring value` };
      if (!test.expectError && !near.trap && !Number.isInteger(x)) {
        const closer = [...test.args]; closer[i] = x + (y - x) / 10;
        const nearer = run(test.fn, closer), jump = Math.abs(Number(near.value) - truthOutcome.value);
        if (!nearer.trap && !nearer.limit && jump > 1e-3 * Math.max(1, Math.abs(truthOutcome.value)) && Math.abs(Number(nearer.value) - truthOutcome.value) > 0.5 * jump
          && certainlyWrong(test, truthOutcome.value, Number(near.value))) return { test: { ...test, expect: Number(near.value) }, detail: `piecewise jump at arg ${i}; expect takes the other branch` };
      }
    }
  }
  return null;
}
const withoutExpect = ({ expect: _e, tol: _t, expectError: _x, ...rest }) => rest;

export function injections(spec, tests, run) {
  const out = [];
  for (const kind of classes) {
    const candidates = [];
    tests.forEach((test, index) => {
      if (!test || !Array.isArray(test.args) || !test.args.every(Number.isFinite)) return;
      const truth = run(test.fn, test.args);
      if (truth.limit || !passes(test, truth)) return;
      if (kind === 'boundary') {
        const mutated = boundaryMutation(test, truth, run);
        if (mutated) candidates.push({ index, test: mutated.test, detail: mutated.detail });
        return;
      }
      if (test.expectError || typeof test.expect !== 'number' || truth.trap) return;
      const value = Number(truth.value), mutated = numberMutation(kind, test, value, run, `${spec.hash}:${index}`);
      if (mutated && certainlyWrong(test, value, mutated.expect)) candidates.push({ index, test: { ...test, expect: mutated.expect }, detail: mutated.detail });
    });
    if (!candidates.length) continue;
    const chosen = candidates.sort((a, b) => pick(`${spec.hash}:${a.index}`, `choose-${kind}`).compare(pick(`${spec.hash}:${b.index}`, `choose-${kind}`)))[0];
    out.push({ kind, ...chosen, original: tests[chosen.index] });
  }
  return out;
}
