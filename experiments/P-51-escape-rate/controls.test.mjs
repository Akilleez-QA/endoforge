import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { compile } from '../../core/runtime/x1/compiler.mjs';
import { enumerateGlue, enumerateKernel, selectKernelMutants, tokenize } from './mutate.mjs';
import { classifyEscape, difference, gridsFor, load, regenerateTests, relationViolations } from './probe.mjs';
import { clopperPearson, clusterBootstrap, requiredN } from './stats.mjs';
import { caseFor, submit } from './run.mjs';
const here = fileURLToPath(new URL('./', import.meta.url)), asc = process.env.ENDOFORGE_ASC_CMD;
const source = `export function scale(a: f64, b: f64): f64 {
  if (!isFinite(a) || a < 0.0 || a > 100.0 || b < 0.0 || b > 100.0) { abort(); }
  return a * 2.5 + b;
}
`;
const tests = [{ name: 'value', fn: 'scale', args: [2, 1], expect: 6 }, { name: 'other', fn: 'scale', args: [4, 0], expect: 10 }, { name: 'refused', fn: 'scale', args: [-1, 0], expectError: true }];
const glue = { id: 'synthetic', assumption: 'Synthetic linear relation for controls.', question: 'What is the synthetic scaled value?', exports: [{ name: 'scale', label: 'Scaled', headline: true, args: [{ name: 'a', kind: 'number', unit: 'kW', range: '0..100' }, { name: 'b', kind: 'number', unit: 'W', range: '0..100' }], result: { kind: 'number', unit: 'kW', precision: 2 } }], traps: [{ fn: 'scale', when: 'a is negative', message: 'The input is outside the range.' }] };
const kernel = { key: 'synthetic/run/k', id: 'k', need: 'synthetic', cohort: 'synthetic', source, tests, testsText: JSON.stringify(tests), contract: '# Synthetic contract\n', glue: JSON.stringify(glue) };
test('Clopper-Pearson matches closed forms and the published sample sizes', () => {
  const none = clopperPearson(0, 2995);
  assert.ok(Math.abs(none.oneSidedUpper - (1 - 0.05 ** (1 / 2995))) < 1e-9);
  assert.ok(Math.abs(none.upper - (1 - 0.025 ** (1 / 2995))) < 1e-9);
  const all = clopperPearson(10, 10);
  assert.ok(Math.abs(all.lower - 0.025 ** (1 / 10)) < 1e-9);
  const half = clopperPearson(1, 2);
  assert.ok(Math.abs(half.lower - (1 - Math.sqrt(0.975))) < 1e-9 && Math.abs(half.upper - Math.sqrt(0.975)) < 1e-9);
  assert.equal(requiredN(1e-3, 0), 2995);
  assert.equal(requiredN(1e-4, 0), 29956);
  assert.equal(requiredN(1e-3, 2), 6294);
});
test('cluster bootstrap is seeded and covers the point estimate for uneven clusters', () => {
  const rows = [...Array(90).fill({ need: 'a', e: false }), ...Array(10).fill({ need: 'b', e: true }), ...Array(50).fill({ need: 'c', e: false })];
  const first = clusterBootstrap(rows, r => r.need, r => r.e), second = clusterBootstrap(rows, r => r.need, r => r.e);
  assert.deepEqual(first, second);
  assert.equal(first.clusters, 3);
  assert.ok(first.lower <= 10 / 150 && first.upper >= 10 / 150);
});
test('the tokenizer ignores comments and strings and keeps numbers whole', () => {
  const tokens = tokenize('// 12 + 3\nconst a = "4 - 5"; /* 6 */ let b = 1.5e-3 - 7;');
  assert.deepEqual(tokens.filter(t => t.kind === 'number').map(t => t.text), ['1.5e-3', '7']);
});
test('every class has an operator on a kernel with its features, and selection is capped and deterministic', () => {
  const rich = `const K: f64 = 3.6;
function helper(x: f64, y: f64): f64 { return x - y; }
export function f(a: f64, b: f64): f64 {
  if (a < 0.0 || b > 1000.0) { abort(); }
  if (a == 7.0) return 1.5;
  const c = a > 1.0 ? a / 2.75 : Math.floor(b) * K;
  return helper(c, Math.min(a, b)) + 12.0;
}
`;
  const all = enumerateKernel(rich, { decimalZero: new Set(['f']) });
  const classes = new Set(all.map(m => m.class));
  assert.deepEqual([...classes].sort(), ['boundary_errors', 'dropped_rows', 'off_by_one', 'reversed_inputs', 'sign_errors', 'stale_binding', 'swapped_units', 'wrong_constants', 'wrong_join', 'wrong_rounding']);
  const first = selectKernelMutants('k', all, 3), second = selectKernelMutants('k', [...all].reverse(), 3);
  assert.ok(first.selected.every(m => m.source !== rich));
  assert.equal(first.selected.length, 30);
  assert.deepEqual(first.selected.map(m => m.source).sort(), second.selected.map(m => m.source).sort());
});
test('glue mutants change a label field only and never the structure the arity check reads', () => {
  const mutants = enumerateGlue(kernel.glue);
  assert.ok(mutants.some(m => m.op === 'glue_result_unit_swapped'));
  for (const mutant of mutants) assert.equal(JSON.parse(mutant.glue).exports[0].args.length, 2);
});
test('correlated tests follow the mutant, including a value that now traps', { skip: !asc }, async () => {
  const mutant = source.replace('2.5', '3.5');
  const wasm = (await compile({ 'kernel.ts': mutant }, asc)).wasm;
  const regenerated = regenerateTests(tests, load(wasm)).tests;
  assert.equal(regenerated[0].expect, 8);
  assert.equal(regenerated[2].expectError, true);
});
test('the equivalence filter drops a no-op, keeps a real fault and marks a non-finite witness', { skip: !asc }, async () => {
  const base = load((await compile({ 'kernel.ts': source }, asc)).wasm);
  const noop = source.replace('a * 2.5 + b', 'b + a * 2.5');
  const noopLoaded = load((await compile({ 'kernel.ts': noop }, asc)).wasm);
  const none = difference(base, noopLoaded, gridsFor(source, noop, tests, base));
  assert.equal(none.finite, null);
  assert.equal(none.nonFinite, null);
  const real = source.replace('2.5', '2.6');
  const realWitness = difference(base, load((await compile({ 'kernel.ts': real }, asc)).wasm), gridsFor(source, real, tests, base));
  assert.ok(realWitness.finite);
  const finiteGuard = source.replace('!isFinite(a) || ', '');
  const blind = difference(base, load((await compile({ 'kernel.ts': finiteGuard }, asc)).wasm), gridsFor(source, finiteGuard, tests, base));
  assert.equal(blind.finite, null);
  assert.ok(blind.nonFinite);
});
test('relations pass the pristine synthetic kernel and flag a guard moved inside the declared range', { skip: !asc }, async () => {
  const base = load((await compile({ 'kernel.ts': source }, asc)).wasm);
  assert.deepEqual(relationViolations(glue, base), []);
  const moved = load((await compile({ 'kernel.ts': source.replace('a < 0.0', 'a < 50.0') }, asc)).wasm);
  assert.ok(relationViolations(glue, moved).includes('R1_declared_range_accepts'));
});
test('the real path promotes the pristine control, rejects a caught fault, and promotes a planted escape', { skip: !asc, timeout: 120000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'p51-control-'));
  const pool = new IsolatePool({ hostPort: fileURLToPath(new URL('../../core/runtime/x1/host.mjs', import.meta.url)), size: 2, isolation: 'thread', prewarm: true });
  await pool.ready();
  try {
    const wasmOf = async text => (await compile({ 'kernel.ts': text }, asc)).wasm;
    const run = async (name, row, arm) => submit({ replay: caseFor(row, kernel, arm), pool, asc, scratch, name, wasm: row.source ? await wasmOf(row.source) : undefined });
    const pristine = await run('pristine', { surface: 'control' }, 'control');
    assert.equal(pristine.promoted, true, JSON.stringify(pristine));
    const caught = await run('caught', { surface: 'kernel', source: source.replace('2.5', '2.6') }, 'sampled');
    assert.equal(caught.promoted, false);
    assert.equal(caught.caught, 'G4_tests');
    const plantedSource = source.replace('return a * 2.5 + b;', 'if (a > 50.0) return 0.0; return a * 2.5 + b;');
    const planted = await run('planted', { surface: 'kernel', source: plantedSource }, 'sampled');
    assert.equal(planted.promoted, true);
    const baseline = load(await wasmOf(source)), mutant = load(await wasmOf(plantedSource));
    assert.equal(classifyEscape({ surface: 'kernel', witness: { finite: true } }, tests, baseline, mutant).reason, 'test_gap');
    const wrongSource = source.replace('2.5', '3.5');
    const correlated = await run('correlated', { surface: 'kernel', source: wrongSource, correlatedTests: JSON.stringify(regenerateTests(tests, load(await wasmOf(wrongSource))).tests) }, 'correlated');
    assert.equal(correlated.promoted, true);
    const unit = enumerateGlue(kernel.glue).find(m => m.op === 'glue_result_unit_swapped');
    const glueEscape = await run('glue', { surface: 'glue', glue: unit.glue }, 'glue');
    assert.equal(glueEscape.promoted, true);
    const drift = await run('drift', { surface: 'binding', driftTests: JSON.stringify([{ ...tests[0], expect: 7 }, ...tests.slice(1)]) }, 'binding');
    assert.equal(drift.promoted, false);
  } finally {
    await pool.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});
test('an escape inside a frozen tolerance is an evaluator weakness and a non-finite witness is a gate gap', { skip: !asc }, async () => {
  const baseline = load((await compile({ 'kernel.ts': source }, asc)).wasm);
  const shifted = load((await compile({ 'kernel.ts': source.replace('2.5', '2.5000001') }, asc)).wasm);
  const tolerant = tests.map(t => t.expectError ? t : { ...t, tol: 1e-3 });
  assert.equal(classifyEscape({ surface: 'kernel', witness: { finite: true } }, tolerant, baseline, shifted).reason, 'evaluator_weakness');
  assert.equal(classifyEscape({ surface: 'kernel', witness: { finite: false, nonFinite: true } }, tests, baseline, baseline).reason, 'gate_gap');
});
test('replay shim exists and never names a model client', () => {
  const text = readFileSync(join(here, 'replay-codex.mjs'), 'utf8');
  assert.ok(!/api\.|fetch\(|https?:/.test(text));
});
