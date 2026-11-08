import assert from 'node:assert/strict';
import test from 'node:test';
import { hash } from '../x1/host.mjs';
import { runGates } from '../x1/gates.mjs';
import { glueFindings, glueProblems, kernelParameters, nonFiniteExpectation, statesComputation, unitDisagreements } from '../x1/contract.mjs';
import { unitFindings } from '../x1/dimensions.mjs';
import { candidate } from './fixtures/x1/candidate.mjs';
import { wasm } from './fixtures/x1/wasm.mjs';
const passThrough = { name: 'scale', params: ['f64'], results: ['f64'], body: [0x20, 0] };
const guarded = { name: 'scale', params: ['f64'], results: ['f64'], body: [0x20, 0, 0x20, 0, 0x62, 0x04, 0x40, 0x00, 0x0b, 0x20, 0, 0x44, 0, 0, 0, 0, 0, 0, 0xf0, 0x7f, 0x61, 0x04, 0x40, 0x00, 0x0b, 0x20, 0, 0x44, 0, 0, 0, 0, 0, 0, 0xf0, 0xff, 0x61, 0x04, 0x40, 0x00, 0x0b, 0x20, 0] };
const toZero = { name: 'scale', params: ['f64'], results: ['f64'], body: [0x44, 0, 0, 0, 0, 0, 0, 0, 0] };
const kernel = (fn, contract) => {
  const c = candidate();
  c.files['CONTRACT.md'] = contract;
  c.files['kernel.ts'] = 'export function scale(x: f64): f64 { return x }';
  c.files['tests.json'] = JSON.stringify([{ name: 'one', fn: 'scale', args: [fn === toZero ? 0 : 1], expect: fn === toZero ? 0 : 1 }]);
  c.files['frozen.sha256'] = JSON.stringify({ contract: hash(contract), tests: hash(c.files['tests.json']) });
  c.files['glue.json'] = JSON.stringify({ id: 'addition', assumption: 'Input is a plain number with no unit.', question: 'What does the scale function return?',
    exports: [{ name: 'scale', label: 'Scale a value', args: [{ name: 'x', kind: 'number', unit: '1' }], result: { kind: 'number', unit: '1', precision: 2 } }], traps: [] });
  c.compiled = { source: hash(c.files['kernel.ts']), wasm: wasm({ functions: [fn] }).toString('base64') };
  return c;
};
for (const [text, want] of [
  ['Trap on nonfinite or out-of-domain input before calculation.', 'trap'],
  ['Inputs must be finite; reject any domain violation before arithmetic.', 'trap'],
  ['Trap message: `x must be finite and in [0, 1000]`.', 'trap'],
  ['Trap cases use finite inputs and exercise each domain restriction.', 'silent'],
  ['Fractional and nonfinite inputs are outside the boundary assumptions.', 'excluded'],
  ['Callers supply finite numbers.', 'excluded'],
  ['Both arguments and the result are finite numeric scalars.', 'finite'],
  ['NaN inputs propagate to the result.', 'permitted'],
  ['The kernel returns NaN when the sensor is absent.', 'permitted'],
  ['The kernel never returns NaN.', 'silent'],
  ['Multiply by two.', 'silent'],
]) test(`the contract "${text}" reads as ${want}`, () => assert.equal(nonFiniteExpectation(text, ['scale']).scale, want));
test('a statement under one export does not bind another', () => {
  const contract = '`first(x: f64): f64`\nTrap on nonfinite input.\n\n`second(x: f64): f64`\nMultiply by two.';
  assert.deepEqual(nonFiniteExpectation(contract, ['first', 'second']), { first: 'trap', second: 'silent' });
});
for (const [name, fn, contract, ok] of [
  ['a trap contract refuses a kernel that returns on NaN', passThrough, 'Trap on nonfinite input.', false],
  ['a trap contract refuses a kernel that hides NaN behind a finite value', toZero, 'Reject nonfinite input by trapping.', false],
  ['a trap contract accepts a kernel that traps', guarded, 'Trap on nonfinite input.', true],
  ['a finite-result contract refuses a non-finite result', passThrough, 'Results are finite numbers.', false],
  ['a finite-result contract accepts a finite result', toZero, 'Results are finite numbers.', true],
  ['a permitting contract accepts a non-finite result', passThrough, 'NaN inputs propagate to the result.', true],
  ['an excluding contract accepts a non-finite result', passThrough, 'Nonfinite inputs are outside this contract.', true],
  ['a silent contract records but does not refuse', passThrough, 'Multiply by one.', true],
]) test(name, () => {
  const result = runGates(kernel(fn, contract));
  assert.equal(result.gates.G8_nonfinite?.ok, ok, JSON.stringify(result.gates));
  assert.equal(result.promotable, ok);
});
test('a silent contract leaves the non-finite result on record', () => {
  assert.deepEqual(runGates(kernel(passThrough, 'Multiply by one.')).gates.G8_nonfinite.unjudged, { silent: 3 });
});
test('integer parameters get no float probe', () => {
  const result = runGates(candidate());
  assert.equal(result.gates.G8_nonfinite.ok, true);
  assert.equal(result.gates.G8_nonfinite.probes, 0);
});
const glueFor = (args, result = { kind: 'number', unit: '1', precision: 2 }) => ({ exports: [{ name: 'f', args, result }] });
const arg = (name, unit = '1') => ({ name, kind: 'number', unit });
const source = 'export function f(massLb: f64, /* note */ tempF: f64 = 1): f64 { return 0 }';
test('kernel parameters survive comments and defaults', () => assert.deepEqual(kernelParameters(source).get('f'), ['massLb', 'tempF']));
for (const [name, glue, contract, match] of [
  ['swapped argument names', glueFor([arg('tempF', 'F'), arg('massLb', 'lb')]), '', /differ from kernel parameters/],
  ['a renamed argument', glueFor([arg('mass', 'lb'), arg('tempF', 'F')]), '', /differ from kernel parameters/],
  ['a changed precision', glueFor([arg('massLb', 'lb'), arg('tempF', '°F')], { kind: 'number', unit: '1', precision: 4 }), '`f(massLb, tempF)`\nShow 2 decimal places.', /contract states 2/],
  ['swapped code labels', glueFor([arg('massLb', 'lb'), arg('tempF', '°F')], { kind: 'code', unit: 'code', precision: 0, codes: { 0: 'too cold', 1: 'within range' } }), '`f(massLb, tempF)`\nCodes: 0 = within range, 1 = too cold.', /fit the contract better swapped/],
]) test(`G7 finds ${name}`, () => assert.match(glueProblems(glue, { source, contract }).join(), match));
test('a unit that disagrees with a name is recorded by the glue gate and refused by the unit gate', () => {
  const glue = glueFor([arg('massLb', '°F'), arg('tempF', 'lb')]);
  assert.match(unitDisagreements(glue).join(), /disagrees with the name/);
  assert.deepEqual(glueProblems(glue, { source, contract: '' }), []);
  const c = kernel(toZero, 'Results are finite numbers.');
  c.files['kernel.ts'] = 'export function scale(valueF: f64): f64 { return 0 }';
  c.compiled.source = hash(c.files['kernel.ts']);
  c.files['glue.json'] = JSON.stringify({ ...JSON.parse(c.files['glue.json']), exports: [{ name: 'scale', label: 'Scale a value', args: [{ name: 'valueF', kind: 'number', unit: 'lb' }], result: { kind: 'number', unit: '1', precision: 2 } }] });
  const result = runGates(c);
  assert.equal(result.gates.G7_glue.ok, true, JSON.stringify(result.gates));
  assert.equal(result.gates.G7_glue.advisory.length, 1);
  assert.match(result.gates.G9_units.why, /^N: scale.valueF unit lb/);
  assert.equal(result.promotable, false);
});
test('an exclusion written under the last export still covers the others', () => {
  const contract = 'Results are finite.\n\n`first(x: f64): f64`\nDouble it.\n\n`second(x: f64): f64`\nTriple it.\nNonfinite inputs are outside the caller contract.';
  assert.deepEqual(nonFiniteExpectation(contract, ['first', 'second']), { first: 'excluded', second: 'excluded' });
});
test('a closing section is not read as part of the last export', () => {
  const contract = 'Results are finite.\n\n`first(x: f64): f64`\nDouble it.\n\n`second(x: f64): f64`\nTriple it.\n\n## Tests\nNonfinite inputs are outside the caller contract.';
  assert.deepEqual(nonFiniteExpectation(contract, ['first', 'second']), { first: 'excluded', second: 'excluded' });
});
test('a code table beside a stated computation records a swap and does not refuse', () => {
  const swapped = glueFor([arg('massLb', 'lb'), arg('tempF', '°F')], { kind: 'code', unit: 'code', precision: 0, codes: { 0: 'too cold', 1: 'within range' } });
  for (const contract of ['`f(massLb, tempF)`\nCodes: 0 = within range, 1 = too cold.\nFormula: return 1 if tempF < 32.',
    '`f(massLb, tempF)`\nCodes: 0 = within range, 1 = too cold.\nThe result is `tempF < 32 ? 1 : 0`.']) {
    const found = glueFindings(swapped, { source, contract });
    assert.deepEqual(found.problems, []);
    assert.match(found.advisory.join(), /fit the contract better swapped/);
  }
});
test('only an expression over the parameters counts as a stated computation', () => {
  assert.equal(statesComputation(['`f(massLb, tempF)`'], ['massLb', 'tempF']), false);
  assert.equal(statesComputation(['## Formula and display', 'All tests follow the formula exactly.'], ['massLb', 'tempF']), false);
  assert.equal(statesComputation(['Range `0..1`, message `too-cold`.'], ['massLb', 'tempF']), false);
  assert.equal(statesComputation(['Formula after validation: `massLb + 2 * tempF`.'], ['massLb', 'tempF']), true);
});
test('G7 stays quiet when glue matches the kernel and contract', () => {
  const glue = glueFor([arg('massLb', 'lb'), arg('tempF', '°F difference')], { kind: 'code', unit: 'code', precision: 0, codes: { 0: 'within range', 1: 'too cold' } });
  assert.deepEqual(glueProblems(glue, { source, contract: '`f(massLb, tempF)`\nCodes: 0 = within range, 1 = too cold. Show 0 decimal places.' }), []);
});
test('runGates refuses mislabelled glue at G7', () => {
  const c = kernel(toZero, 'Results are finite numbers.');
  c.files['glue.json'] = JSON.stringify({ ...JSON.parse(c.files['glue.json']), exports: [{ name: 'scale', label: 'Scale a value', args: [{ name: 'y', kind: 'number', unit: '1' }], result: { kind: 'number', unit: '1', precision: 2 } }] });
  assert.match(runGates(c).gates.G7_glue.why, /differ from kernel parameters/);
});
const unitGlue = (exports) => ({ exports: exports.map(([name, args, result]) => ({ name, label: name, args: args.map(([n, kind, unit]) => ({ name: n, kind, unit })), result })) });
const unitCases = [
  ['a code result in a physical unit', 'export function over(psig: f64): i32 { return psig > 140.0 ? 1 : 0; }', [['over', [['psig', 'number', 'psig']], { kind: 'code', unit: 'psig', codes: { 0: 'no', 1: 'yes' } }]], /^K: /],
  ['a computed code shown in a physical unit', 'export function band(x: f64, lo: f64): f64 { return x < lo ? 1 : 0; }', [['band', [['x', 'number', '°F'], ['lo', 'number', '°F']], { kind: 'number', unit: '°F difference', precision: 0 }]], /^D: band returns a computed code/],
  ['a ratio of flows shown as a flow', 'export function ratio(feedKgS: f64, evapKgS: f64): f64 { return feedKgS / evapKgS; }', [['ratio', [['feedKgS', 'number', 'kg/s'], ['evapKgS', 'number', 'kg/s']], { kind: 'number', unit: 'kg/s', precision: 2 }]], /^D: ratio returns dimensionless/],
  ['a product whose result unit balances nothing', 'export function drop(dT: f64, slope: f64): f64 { return dT * slope; }', [['drop', [['dT', 'number', '°F difference'], ['slope', 'number', 'psi/°F']], { kind: 'number', unit: '°F difference', precision: 1 }]], /^D: drop returns M L\^-1 T\^-2/],
  ['a sum of a pressure and a temperature', 'export function add(p: f64, t: f64): f64 { return p + t; }', [['add', [['p', 'number', 'psig'], ['t', 'number', '°F']], { kind: 'number', unit: 'psig', precision: 1 }]], /^D: add: \+ joins/],
  ['a parameter unit its name contradicts', 'export function dew(temperatureF: f64, rhPct: f64): f64 { return temperatureF; }', [['dew', [['temperatureF', 'number', '%'], ['rhPct', 'number', '°F']], { kind: 'number', unit: '°F', precision: 1 }]], /^N: dew.temperatureF/],
  ['labels that fit their names better swapped', 'export function decide(action: i32, roleRights: i32): i32 { return action & roleRights; }', [['decide', [['action', 'code', 'role rights mask'], ['roleRights', 'code', 'approval action']], { kind: 'code', unit: 'decision', codes: { 0: 'no', 1: 'yes' } }]], /^L: /],
  ['a computed code showing an argument unit', 'export function floor(action: i32, right: i32): i32 { return right > 0 ? 1 : 0; }', [['floor', [['action', 'code', 'approval action'], ['right', 'code', 'flag']], { kind: 'code', unit: 'approval action', codes: { 0: 'no', 1: 'yes' } }]], /^R: /],
  ['a span of epoch timestamps shown as a timestamp', 'export function age(nowMs: f64, thenMs: f64): f64 { return nowMs + thenMs; }', [['age', [['nowMs', 'integer', 'ms since Unix epoch'], ['thenMs', 'integer', 'ms']], { kind: 'number', unit: 'ms', precision: 0 }]], /^D: age returns a time point/],
];
for (const [name, source, exports, pattern] of unitCases) test(`the unit gate refuses ${name}`, () => {
  const { problems } = unitFindings(unitGlue(exports), { source });
  assert.ok(problems.some(p => pattern.test(p)), JSON.stringify(problems));
});
test('the unit gate refuses a code labelled never returned that the tests return', () => {
  const glue = unitGlue([['verdict', [], { kind: 'code', unit: 'verdict', codes: { 0: 'Reserved; never returned', 1: 'False' } }]]);
  assert.match(unitFindings(glue, { source: 'export function verdict(): i32 { return 0; }', outputs: [{ fn: 'verdict', out: 0, err: null }] }).problems[0], /^C: /);
  assert.deepEqual(unitFindings(glue, { source: 'export function verdict(): i32 { return 1; }', outputs: [{ fn: 'verdict', out: 1, err: null }] }).problems, []);
});
for (const [name, source, exports] of [
  ['a coefficient that may carry a unit', 'export function drop(dropF: f64): f64 { return dropF * 3.47; }', [['drop', [['dropF', 'number', '°F']], { kind: 'number', unit: 'psi', precision: 1 }]]],
  ['a temperature difference shown in bare degrees', 'export function sub(satF: f64, lineF: f64): f64 { return satF - lineF; }', [['sub', [['satF', 'number', '°F'], ['lineF', 'number', '°F']], { kind: 'number', unit: '°F', precision: 1 }]]],
  ['a dimensionless code', 'export function ok(x: i32): i32 { return x > 0 ? 1 : 0; }', [['ok', [['x', 'code', 'dimensionless']], { kind: 'code', unit: 'dimensionless', codes: { 0: 'no', 1: 'yes' } }]]],
  ['a generic code passed through', 'export function pick(typeCode: i32, liquidIn: f64): i32 { return typeCode == 1 ? 1 : 0; }', [['pick', [['typeCode', 'code', 'code'], ['liquidIn', 'number', 'in']], { kind: 'code', unit: 'code', codes: { 0: 'a', 1: 'b' } }]]],
  ['an epoch day from an epoch timestamp', 'const DAY_MS: f64 = 86400000;\nexport function day(anchorMs: f64): f64 { return Math.floor(anchorMs / DAY_MS); }', [['day', [['anchorMs', 'integer', 'ms since Unix epoch']], { kind: 'number', unit: 'UTC day index', precision: 0 }]]],
  ['a unit the gate cannot parse', 'export function f(a: f64): f64 { return a; }', [['f', [['a', 'number', 'degrees in selected scale']], { kind: 'number', unit: 'selected unit', precision: 1 }]]],
]) test(`the unit gate accepts ${name}`, () => assert.deepEqual(unitFindings(unitGlue(exports), { source }).problems, []));
test('runGates reports the unit gate', () => {
  const result = runGates(kernel(passThrough, 'Multiply by one.'));
  assert.equal(result.gates.G9_units.ok, true);
  assert.equal(result.gates.G9_units.checks.scale, 'dimensionless');
});
