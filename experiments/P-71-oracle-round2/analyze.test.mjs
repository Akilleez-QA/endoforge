import assert from 'node:assert/strict';
import { test } from 'node:test';
import { random, resamples } from '../P-70-oracle-injected/analyze.mjs';
import { needClustered } from './analyze.mjs';

const caught = status => status === 'flagged' || status === 'corrected';
const pristine = Array.from({ length: 100 }, (_, s) => Array.from({ length: 3 }, (_, index) =>
  ({ hash: `h${s}`, need: `n${s % 10}`, index, after: s === 0 && index === 0 ? 'flagged' : 'verified' }))).flat();

function collapsing(rows) {
  const groups = [...Map.groupBy(rows, r => r.need).values()], next = random(71), values = [];
  for (let r = 0; r < resamples; r++) {
    const sample = [];
    for (let i = 0; i < groups.length; i++) sample.push(...groups[Math.floor(next() * groups.length)]);
    const specs = Map.groupBy(sample, r => r.hash);
    values.push([...specs.values()].filter(g => g.some(r => caught(r.after))).length / specs.size);
  }
  values.sort((a, b) => a - b);
  return values[Math.ceil(0.975 * resamples) - 1];
}

test('need-clustered spec-level false flags count a need drawn twice as two sets of specifications', () => {
  const fixed = needClustered({ pristine, injected: [] }).falseFlagSpecs;
  assert.equal(fixed.point, 0.01);
  assert.equal(fixed.clusters, 10);
  assert.equal(fixed.hi, 0.03);
  assert.equal(collapsing(pristine), 0.02);
});

test('row-share metrics clustered by need are unchanged by the fix', () => {
  const need = needClustered({ pristine, injected: [] });
  assert.equal(need.falseFlagTests.point, 1 / 300);
  assert.ok(need.falseFlagTests.hi >= need.falseFlagTests.point);
});
