import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzeSpecification, freezeSpecification, rangeRules } from '../x1/oracle.mjs';

const fixture = name => Object.fromEntries(['CONTRACT.md', 'tests.json'].map(file => [file, readFileSync(new URL(`fixtures/oracle/${name}/${file}`, import.meta.url), 'utf8')]));
const statuses = analysis => analysis.decisions.map(d => d.status);

test('a prose sentence "R = 1 means ..." is not read as a second definition of R', () => {
  const files = fixture('prose-definition');
  const analysis = analyzeSpecification(files, { reference: false });
  assert.deepEqual(analysis.decisions.filter(d => d.status === 'flagged' || d.status === 'corrected'), []);
  for (const index of [0, 1, 5]) assert.equal(analysis.decisions[index].status, 'verified', JSON.stringify(analysis.decisions[index]));
  assert.equal(freezeSpecification(files, { reference: false }).report.flagged, 0);
});

test('a piecewise rule "for scale 0, F = ...; for scale 1, F = ..." never applies one branch to the other case', () => {
  const files = fixture('piecewise-assignment');
  const analysis = analyzeSpecification(files, { reference: false });
  assert.deepEqual(analysis.decisions.filter(d => d.status === 'flagged' || d.status === 'corrected'), []);
  const values = analysis.tests.map((t, index) => ({ t, index })).filter(({ t }) => t.fn === 'dischargeTemperatureF' && !t.expectError);
  for (const { index } of values) assert.ok(['verified', 'abstained'].includes(analysis.decisions[index].status), JSON.stringify(analysis.decisions[index]));
  const report = freezeSpecification(files, { reference: false }).report;
  assert.equal(report.flagged, 0);
  assert.equal(report.abstained, statuses(analysis).filter(s => s === 'abstained').length);
});

test('a conditional domain "when isName = 1, entityOrdinal must be in [1, 1000000]" is not applied to isName = 0', () => {
  const files = fixture('conditional-domain');
  assert.deepEqual(rangeRules(files['CONTRACT.md'], ['isName', 'entityOrdinal']).filter(rule => rule.name === 'entityOrdinal'), []);
  const analysis = analyzeSpecification(files, { reference: false });
  assert.notEqual(analysis.decisions[0].status, 'flagged', JSON.stringify(analysis.decisions[0]));
  assert.equal(freezeSpecification(files, { reference: false }).report.flagged, 0);
});

test('two unconditional definitions that disagree make the formula abstain, and the abstention is counted', () => {
  const contract = ['`ratio(a: f64, b: f64): f64`', 'r = a / b', 'r = a * b', 'Return r.'].join('\n');
  const files = { 'CONTRACT.md': contract, 'tests.json': JSON.stringify([{ name: 'x', fn: 'ratio', args: [6, 3], expect: 2, tol: 0 }]) };
  const analysis = analyzeSpecification(files, { reference: false });
  assert.equal(analysis.decisions[0].status, 'abstained');
  assert.match(analysis.decisions[0].why, /conflicting/);
  const report = freezeSpecification(files, { reference: false }).report;
  assert.equal(report.abstained, 1);
  assert.equal(report.verified, 0);
});

test('a conditional range clause is skipped while an unconditional bound on the same line set still applies', () => {
  const rules = rangeRules(['## Valid input', '- 0 <= kw <= 10000', '- When mode = 1, kw must be an integer in [1, 50].', '- kw must be in [2, 40] when mode = 2.', '- 3 <= kw <= 30 if mode = 3.', '- For mode 4, kw is in [4, 20].'].join('\n'), ['kw', 'mode']);
  assert.deepEqual(rules, [{ name: 'kw', lo: 0, loOpen: false, hi: 10000, hiOpen: false }]);
});
