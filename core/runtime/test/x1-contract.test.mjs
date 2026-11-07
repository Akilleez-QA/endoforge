import assert from 'node:assert/strict';
import test from 'node:test';
import { hash } from '../x1/host.mjs';
import { runGates } from '../x1/gates.mjs';
import { glueProblems, kernelParameters, nonFiniteExpectation, unitDisagreements } from '../x1/contract.mjs';
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
test('a unit that disagrees with a name is recorded, and never refuses', () => {
  const glue = glueFor([arg('massLb', '°F'), arg('tempF', 'lb')]);
  assert.match(unitDisagreements(glue).join(), /disagrees with the name/);
  assert.deepEqual(glueProblems(glue, { source, contract: '' }), []);
  const c = kernel(toZero, 'Results are finite numbers.');
  c.files['kernel.ts'] = 'export function scale(valueF: f64): f64 { return 0 }';
  c.compiled.source = hash(c.files['kernel.ts']);
  c.files['glue.json'] = JSON.stringify({ ...JSON.parse(c.files['glue.json']), exports: [{ name: 'scale', label: 'Scale a value', args: [{ name: 'valueF', kind: 'number', unit: 'lb' }], result: { kind: 'number', unit: '1', precision: 2 } }] });
  const result = runGates(c);
  assert.equal(result.promotable, true, JSON.stringify(result.gates));
  assert.equal(result.gates.G7_glue.advisory.length, 1);
});
test('an exclusion written under the last export still covers the others', () => {
  const contract = 'Results are finite.\n\n`first(x: f64): f64`\nDouble it.\n\n`second(x: f64): f64`\nTriple it.\nNonfinite inputs are outside the caller contract.';
  assert.deepEqual(nonFiniteExpectation(contract, ['first', 'second']), { first: 'excluded', second: 'excluded' });
});
test('a closing section is not read as part of the last export', () => {
  const contract = 'Results are finite.\n\n`first(x: f64): f64`\nDouble it.\n\n`second(x: f64): f64`\nTriple it.\n\n## Tests\nNonfinite inputs are outside the caller contract.';
  assert.deepEqual(nonFiniteExpectation(contract, ['first', 'second']), { first: 'excluded', second: 'excluded' });
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
