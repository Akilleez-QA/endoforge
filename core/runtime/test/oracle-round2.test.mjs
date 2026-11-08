import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSpecification, freezeSpecification, parseExpression, rangeRules } from '../x1/oracle.mjs';

const spec = (lines, tests) => ({ 'CONTRACT.md': lines.join('\n'), 'tests.json': JSON.stringify(tests) });
const run = (lines, tests) => analyzeSpecification(spec(lines, tests), { reference: false }).decisions.map(d => d.status);
const caught = status => status === 'flagged' || status === 'corrected';

test('a bare piecewise rule "unit 0 returns value; unit 1 returns ..." is a guard, and each branch applies only to its own case', () => {
  const lines = ['`toCelsius(value: f64, unit: i32): f64`', 'Unit 0 returns value; unit 1 returns (value - 32) * 5 / 9. Show 2 decimal places.'];
  const statuses = run(lines, [
    { fn: 'toCelsius', args: [10, 0], expect: 10 }, { fn: 'toCelsius', args: [50, 1], expect: 10 },
    { fn: 'toCelsius', args: [10, 0], expect: -12.222222222222221 }, { fn: 'toCelsius', args: [50, 1], expect: 50 }]);
  assert.deepEqual(statuses, ['verified', 'verified', 'flagged', 'flagged']);
});

test('a bare branch the parser cannot evaluate abstains instead of borrowing the other branch', () => {
  const lines = ['`toCelsius(temperature: f64, unit: i32): f64`', 'unit 0 uses `(temperature - 32) * 5 / 9`; unit 1 is identity.'];
  const statuses = run(lines, [{ fn: 'toCelsius', args: [212, 0], expect: 100 }, { fn: 'toCelsius', args: [220, 1], expect: 220 }]);
  assert.equal(statuses[0], 'verified');
  assert.equal(statuses[1], 'abstained');
});

test('a formula followed by "for <label>" is conditional on a case the parser cannot read', () => {
  const lines = ['`toCelsius(temperature: f64, unit: i32): f64`', 'Unit code 0 = Fahrenheit; 1 = Celsius.', 'Return Celsius, computed as `(temperature - 32) * (5 / 9)` for Fahrenheit, or unchanged for Celsius.'];
  const statuses = run(lines, [{ fn: 'toCelsius', args: [220, 1], expect: 220 }, { fn: 'toCelsius', args: [32, 0], expect: 0 }]);
  assert.ok(!statuses.some(caught), statuses.join());
});

test('code lists and "returns 1 exactly when ..., otherwise 0" are evaluated branch by branch', () => {
  const codes = ['`classify(deltaF: f64): i32`', 'Return code **0** for `deltaF < 0`, **1** for `deltaF == 0` (including negative zero), and **2** for `deltaF > 0`.'];
  assert.deepEqual(run(codes, [{ fn: 'classify', args: [-3], expect: 0 }, { fn: 'classify', args: [0], expect: 1 }, { fn: 'classify', args: [45], expect: 2 }, { fn: 'classify', args: [45], expect: 0 }]),
    ['verified', 'verified', 'verified', 'flagged']);
  const threshold = ['- `over(p: f64): i32` returns 1 exactly when p > 140, otherwise 0.'];
  assert.deepEqual(run(threshold, [{ fn: 'over', args: [141], expect: 1 }, { fn: 'over', args: [140], expect: 0 }, { fn: 'over', args: [140], expect: 1 }]), ['verified', 'verified', 'flagged']);
  const pair = ['- `adequate(level: f64, minimum: f64): i32` returns 1 exactly when level >= minimum, otherwise 0.'];
  assert.deepEqual(run(pair, [{ fn: 'adequate', args: [50, 50], expect: 1 }, { fn: 'adequate', args: [49.999, 50], expect: 0 }]), ['verified', 'verified']);
});

test('a guarded "for scale 0, F = ...; for scale 1, F = ..." evaluates the branch for each case', () => {
  const lines = ['`toF(temperature: f64, scale: i32): f64`', 'For scale 0, F = temperature; for scale 1, F = temperature * 9 / 5 + 32.', 'Return F.'];
  assert.deepEqual(run(lines, [{ fn: 'toF', args: [220, 0], expect: 220 }, { fn: 'toF', args: [100, 1], expect: 212 }, { fn: 'toF', args: [100, 1], expect: 100 }]), ['verified', 'verified', 'flagged']);
});

test('thousands separators inside a formula are read as one number, and a wrong-arity call is not a reading', () => {
  const lines = ['`sessionDay(anchorMs: f64): f64` returns floor(anchorMs / 86,400,000).'];
  assert.deepEqual(run(lines, [{ fn: 'sessionDay', args: [86399999], expect: 0 }, { fn: 'sessionDay', args: [86400000], expect: 1 }, { fn: 'sessionDay', args: [86400000], expect: 2 }]), ['verified', 'verified', 'flagged']);
  assert.equal(parseExpression('floor(x / 86, 400)'), null);
  assert.notEqual(parseExpression('max(0, 100)'), null);
  assert.notEqual(run(['`day(ms: f64): f64` returns floor(ms / 86,400).'], [{ fn: 'day', args: [86400], expect: 1 }])[0], 'flagged');
});

test('a nested rule "state 2 gives 2 only if built is 1, otherwise 1" keeps both conditions on the branch', () => {
  const lines = ['### `displayCode(state, built) -> code`', '- Rule: state 0 gives 0; state 1 gives 1; state 2 gives 2 only if built is 1, otherwise 1.'];
  assert.deepEqual(run(lines, [{ fn: 'displayCode', args: [0, 1], expect: 0 }, { fn: 'displayCode', args: [2, 0], expect: 1 }, { fn: 'displayCode', args: [2, 1], expect: 2 }, { fn: 'displayCode', args: [2, 1], expect: 1 }]),
    ['verified', 'verified', 'verified', 'flagged']);
});

test('a formula followed by "for <label>," with the other case on the next line is still conditional', () => {
  const lines = ['- `toCelsius(temperature: f64, unit: i32): f64`', '  Return Celsius, computed as `(temperature - 32) * (5 / 9)` for Fahrenheit,', '  or unchanged for Celsius.'];
  assert.ok(!run(lines, [{ fn: 'toCelsius', args: [220, 1], expect: 220 }]).some(caught));
});

test('a range stated in one export\'s block does not apply to another export with the same parameter name (P-32 CC-022)', () => {
  const lines = ['## Exports', '- `scaled(dropF: f64, slope: f64): f64`', '  returns dropF * slope, in psi, shown to 2 decimal places.', '  dropF is a nonnegative magnitude in [0, 1000].',
    '- `ratio(dropF: f64, dropPsi: f64): f64` returns dropPsi / dropF.', '  dropF must be in [0.001, 1000]; dropPsi in [0, 1000000].'];
  assert.deepEqual(run(lines, [{ fn: 'scaled', args: [0, 1000], expect: 0 }, { fn: 'scaled', args: [2, 3], expect: 6 }, { fn: 'ratio', args: [0, 1], expectError: true }, { fn: 'scaled', args: [2, 3], expect: 5 }]),
    ['verified', 'verified', 'verified', 'flagged']);
});

test('ranges read the nearest parameter, dotted and worded intervals, "outside", "both inputs" and finite value sets', () => {
  const rule = (name, lo, hi, loOpen = false, hiOpen = false) => ({ name, lo, loOpen, hi, hiOpen });
  assert.deepEqual(rangeRules('Both arguments must be finite. Accept pounds in [0, 1000] and pricePerPound\nin [0, 10000], inclusive.', ['pounds', 'pricePerPound']), [rule('pounds', 0, 1000)]);
  assert.deepEqual(rangeRules('- Invalid pricePerPound (nonfinite or outside [0, 10000]): trap `Invalid price`.', ['pounds', 'pricePerPound']), [rule('pricePerPound', 0, 10000)]);
  assert.deepEqual(rangeRules('3. Rate outside 0..500: `Invalid addition rate`.', ['length', 'rate']), [rule('rate', 0, 500)]);
  assert.deepEqual(rangeRules('Inclusive bounds: factoryG 0..100000; runM 0..100.', ['factoryG', 'runM']), [rule('factoryG', 0, 100000), rule('runM', 0, 100)]);
  assert.deepEqual(rangeRules('`f(a: f64, b: f64): f64`\n- Both inputs must be finite and in 0..1000000 inclusive.', ['a', 'b'], [], 'f'), [rule('a', 0, 1000000), rule('b', 0, 1000000)]);
  assert.deepEqual(rangeRules('Accept a finite temperature from -100 through 500 inclusive.', ['temperature']), [rule('temperature', -100, 500)]);
  assert.deepEqual(rangeRules('actualF inclusive [-350, 350]; targetF inclusive [0, 100].', ['actualF', 'targetF']), [rule('actualF', -350, 350), rule('targetF', 0, 100)]);
  assert.deepEqual(rangeRules('Both parameters must be exactly 0 (absent) or 1 (present).', ['roleRight', 'qualification'], [], 'g'), [{ name: 'roleRight', values: [0, 1] }, { name: 'qualification', values: [0, 1] }]);
  assert.deepEqual(rangeRules('- The result a + b lies in [-20, 20].', ['a', 'b']), []);
  assert.deepEqual(rangeRules('Valid sums lie in [-20, 20].', ['a', 'b']), []);
});

test('a finite value set traps every other value, and a value test inside it is not flagged by the set', () => {
  const lines = ['`canApprove(roleRight: i32, recorded: i32): i32`', 'Both parameters must be exactly 0 (absent) or 1 (present).', 'Returns roleRight * recorded.'];
  assert.deepEqual(run(lines, [{ fn: 'canApprove', args: [1, 1], expect: 1 }, { fn: 'canApprove', args: [0, 2], expectError: true }, { fn: 'canApprove', args: [0, 2], expect: 0 }]), ['verified', 'verified', 'flagged']);
});
