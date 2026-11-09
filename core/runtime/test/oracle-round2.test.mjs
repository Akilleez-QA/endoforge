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

test('coverage: "`sig`: expression", "computes", "Formula:", word operators, wrapped lines and identity results are read', () => {
  const two = (lines, fn, args, right, wrong) => run(lines, [{ fn, args, expect: right, tol: 1e-9 }, { fn, args, expect: wrong, tol: 1e-9 }]);
  assert.deepEqual(two(['- `deltaFToC(deltaF: f64): f64`: deltaF × 5 / 9; input reading bounds apply.'], 'deltaFToC', [45], 25, 45), ['verified', 'flagged']);
  assert.deepEqual(two(['- `sampleDay(anchor: f64, offset: f64): f64`: anchor + offset, a UTC day index.'], 'sampleDay', [20000, -3], 19997, 20003), ['verified', 'flagged']);
  assert.deepEqual(two(['- `liquidOutletFraction(ratio)`: (ratio - 1) / ratio; dimensionless; show 6 decimal places.'], 'liquidOutletFraction', [3], 2 / 3, 1 / 3), ['verified', 'flagged']);
  assert.deepEqual(two(['### subcoolingF(saturationF: f64, liquidLineF: f64): f64', 'Computes saturationF - liquidLineF. Caller supplies the temperatures.'], 'subcoolingF', [120, 75], 45, -45), ['verified', 'flagged']);
  assert.deepEqual(two(['`maxChargeG(limitG, volumeM3, concentration): f64`', '- Formula: min(limitG, volumeM3 * concentration).'], 'maxChargeG', [150, 30, 7.5], 150, 225), ['verified', 'flagged']);
  assert.deepEqual(two(['- `temperatureDropF(inletF: f64, outletF: f64): f64`: inletF minus outletF.'], 'temperatureDropF', [100, 55], 45, -45), ['verified', 'flagged']);
  assert.deepEqual(two(['`add(a: i32, b: i32): i32`', 'For valid inputs, return the exact sum of a and b.'], 'add', [2, 3], 5, -1), ['verified', 'flagged']);
  assert.deepEqual(two(['- `inventoryLb(volume: f64, fraction: f64, liquid: f64, vapor: f64): f64`', '  returns volume * (fraction * liquid +', '  (1 - fraction) * vapor), shown to 2 decimal places.'], 'inventoryLb', [16, 0.25, 40, 0.1], 161.2, 160), ['verified', 'flagged']);
  assert.deepEqual(two(['- expectedConfirmer(confirmer): validate confirmer; return confirmer unchanged.'], 'expectedConfirmer', [3], 3, 0), ['verified', 'flagged']);
  assert.deepEqual(two(['`refrigerantType(verifiedCode: i32): i32`', '- Returns the supplied verified code: 0 = unknown, 1 = R32, 2 = R410A.'], 'refrigerantType', [2], 2, 0), ['verified', 'flagged']);
  assert.deepEqual(two(['- `pressureStatus(temperatureF: f64): i32`', '  - Return `1` for every accepted input, including 220 °F.'], 'pressureStatus', [220], 1, 0), ['verified', 'flagged']);
});

test('coverage stays honest: a code table entry, a cross-export call and a branch-only constant are not readings', () => {
  assert.equal(run(['- `pressureStatus(milli: i32): i32`', '  Return code 1 = above 140 psig / consult the reaction plan.'], [{ fn: 'pressureStatus', args: [100], expect: 0 }])[0], 'unverified');
  assert.notEqual(run(['`totalChargeG(baseG, runM)` returns baseG plus additionalChargeG.'], [{ fn: 'totalChargeG', args: [750, 1], expect: 760 }])[0], 'flagged');
  assert.notEqual(run(['- `limit(a: f64, b: f64): f64`: limit minus charge, signed grams.'], [{ fn: 'limit', args: [5, 2], expect: 3 }])[0], 'flagged');
});

test('booleans: "true exactly when ..." implies false otherwise, and a wrong boolean is flagged', () => {
  const lines = ['- `overCapacity(pressurePsig: f64): bool`: true exactly when pressurePsig > 140.'];
  assert.deepEqual(run(lines, [{ fn: 'overCapacity', args: [140.001], expect: true }, { fn: 'overCapacity', args: [140], expect: false }, { fn: 'overCapacity', args: [140], expect: true }]), ['verified', 'verified', 'flagged']);
});

test('a comparison is a boolean reading, never its left operand, and is not taken from a quoted condition', () => {
  const lines = ['- `overCapacity(psig, thresholdPsig): bool` = psig > thresholdPsig.'];
  assert.deepEqual(run(lines, [{ fn: 'overCapacity', args: [141, 140], expect: true }, { fn: 'overCapacity', args: [140, 140], expect: false }, { fn: 'overCapacity', args: [140, 140], expect: true }]), ['verified', 'verified', 'flagged']);
  assert.equal(parseExpression('a < b < c'), null);
  assert.notEqual(run(['`classify(x: f64): i32`', 'Code 1 when `x < 0` holds; see the table.'], [{ fn: 'classify', args: [-1], expect: 7 }])[0], 'flagged');
});

test('an "Otherwise" that opens a line refers to an earlier line, so its branch is not evaluated', () => {
  const lines = ['### displayCode(requested: i32, confirmed: i32, built: i32): i32', '- Approved (2) only when requested, confirmed and built are all 1.', '- Otherwise, if requested is 1, result is 1. If requested is 0, result is 0.'];
  assert.notEqual(run(lines, [{ fn: 'displayCode', args: [1, 1, 1], expect: 2 }])[0], 'flagged');
});

test('a trap claimed inside a complete stated domain is flagged when the formula has a value there', () => {
  const lines = ['`chargeG(volume: f64, density: f64): f64` returns volume * density.', 'volume must be in [0, 1000]; density must be in [1, 1000]. Otherwise trap with `invalid input`.'];
  assert.deepEqual(run(lines, [{ fn: 'chargeG', args: [1000, 1], expectError: true }, { fn: 'chargeG', args: [1000.5, 1], expectError: true }, { fn: 'chargeG', args: [1000, 1], expect: 1000 }]), ['flagged', 'verified', 'verified']);
});

test('a trap inside the ranges is not flagged when the contract states any other trap condition', () => {
  const tests = [{ fn: 'f', args: [5, 3], expectError: true }];
  const base = ['`f(low: f64, high: f64): f64` returns high - low.', 'low must be in [0, 100]; high must be in [0, 100].'];
  for (const extra of ['Require low <= high; otherwise trap.', 'If low is 5 and high is 3, throw Error("order").', 'The result must not exceed 50.', 'Inputs must be integers.', 'Trap on overflow.'])
    assert.notEqual(run([...base, extra], extra === 'Inputs must be integers.' ? [{ fn: 'f', args: [5.5, 3], expectError: true }] : tests)[0], 'flagged', extra);
  assert.notEqual(run(base.slice(0, 1).concat('low must be in [0, 100].'), tests)[0], 'flagged');
});

test('a constraint on an intermediate quantity ("TD must be > 0") keeps the domain incomplete', () => {
  const lines = ['`target(room: f64, evap: f64): f64`', '- TD = room - evap', '- target = min(12, max(4, 0.4 * TD))', '- room must be finite and in [-40, 50].', '- evap must be finite and in [-50, 20].', '- TD must be > 0 (evaporator colder than the room).', '- Any violation traps.'];
  assert.notEqual(run(lines, [{ fn: 'target', args: [5, 5], expectError: true }])[0], 'flagged');
});

test('a bullet list directly under a signature belongs to that export, and quoted trap messages do not hide a range', () => {
  const rule = (name, lo, hi) => ({ name, lo, loOpen: false, hi, hiOpen: false });
  const contract = ['`other(volume: f64): f64` returns volume.', '', '`remaining(cap: f64, current: f64): f64`', '- Both inputs must be finite and in 0..1000000 inclusive.', '- Returns cap - current.'].join('\n');
  assert.deepEqual(rangeRules(contract, ['cap', 'current'], [], 'remaining'), [rule('cap', 0, 1000000), rule('current', 0, 1000000)]);
  assert.deepEqual(rangeRules(contract, ['volume'], [], 'other'), []);
  const quoted = '- `over(pressure: f64): bool`: trap when pressure is nonfinite or outside [0,1000]; message “Pressure must be within 0..1000 psig”.';
  assert.deepEqual(rangeRules(quoted, ['pressure'], [], 'over'), [rule('pressure', 0, 1000)]);
});

test('a value test just past a stated bound the parser could not attribute is not marked verified', () => {
  const lines = ['`materialCost(pounds: f64, pricePerPound: f64): f64` returns pounds * pricePerPound.', '- Valid pounds: finite, 0 through 1000 inclusive.', '- Valid unit price: finite, 0 through 10000 inclusive (the price per pound).', '- Either input outside its bounds traps.'];
  assert.deepEqual(run(lines, [{ fn: 'materialCost', args: [0, -1], expect: 0 }, { fn: 'materialCost', args: [15, 2], expect: 30 }, { fn: 'materialCost', args: [1000, 10000], expect: 10000000 }]), ['abstained', 'verified', 'verified']);
});

test('signatures wrapped over lines and typed zero-argument exports are read', () => {
  const wrapped = ['Export only `inventoryLb(volumeFt3: f64, liquidFraction: f64,', 'liquidDensity: f64, vaporDensity: f64): f64`.', 'It returns volumeFt3 * (liquidFraction * liquidDensity + (1 - liquidFraction) * vaporDensity).'];
  assert.deepEqual(run(wrapped, [{ fn: 'inventoryLb', args: [16, 0.25, 40, 0.1], expect: 161.2, tol: 1e-9 }, { fn: 'inventoryLb', args: [16, 0.25, 40, 0.1], expect: 160, tol: 1e-9 }]), ['verified', 'flagged']);
  const nullary = ['- `universalClaimIsTrue(): bool` returns false.', '- `scaled(a: f64): f64` returns a * 2.'];
  assert.deepEqual(run(nullary, [{ fn: 'universalClaimIsTrue', args: [], expect: false }, { fn: 'universalClaimIsTrue', args: [], expect: true }, { fn: 'scaled', args: [2], expect: 4 }]), ['verified', 'flagged', 'verified']);
});

test('ranges wrapped over lines, next to a return clause, or under "fn: name; when: either input" are read', () => {
  const rule = (name, lo, hi, loOpen = false) => ({ name, lo, loOpen, hi, hiOpen: false });
  assert.deepEqual(rangeRules(['`maxCharge(limitG, volume): f64`', '- limitG must be finite in [0, 1000000]; volume finite in', '  (0, 1000000].'].join('\n'), ['limitG', 'volume'], [], 'maxCharge'), [rule('limitG', 0, 1000000), rule('volume', 0, 1000000, true)]);
  assert.deepEqual(rangeRules(['- `subcoolingF(saturationF, liquidLineF): f64`', '  Each input must be in [-200, 300]. Return saturationF - liquidLineF.'].join('\n'), ['saturationF', 'liquidLineF'], [], 'subcoolingF'), [rule('saturationF', -200, 300), rule('liquidLineF', -200, 300)]);
  assert.deepEqual(rangeRules(['`a(x: f64): f64` returns x.', '`subcoolingF(saturationF: f64, liquidLineF: f64): f64` returns saturationF - liquidLineF.', '- fn: subcoolingF; when: either input is nonfinite or outside [-200, 300];'].join('\n'), ['saturationF', 'liquidLineF'], [], 'subcoolingF'), [rule('saturationF', -200, 300), rule('liquidLineF', -200, 300)]);
});
