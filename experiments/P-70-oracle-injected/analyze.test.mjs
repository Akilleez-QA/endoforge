import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { clustered, random, resamples, share, specShare } from './analyze.mjs';
import { regenerate, targets } from './reanalyze.mjs';

const caught = status => status === 'flagged' || status === 'corrected';
const specs = (count, flagged, tests = 3) => Array.from({ length: count }, (_, s) => Array.from({ length: tests }, (_, index) =>
  ({ hash: `h${s}`, need: `n${s % 10}`, index, after: s < flagged && index === 0 ? 'flagged' : 'verified' }))).flat();

function collapsing(rows, metric) {
  const groups = [...Map.groupBy(rows, r => r.hash).values()], next = random(70), values = [];
  for (let r = 0; r < resamples; r++) {
    const sample = [];
    for (let i = 0; i < groups.length; i++) sample.push(...groups[Math.floor(next() * groups.length)]);
    values.push(metric(sample));
  }
  values.sort((a, b) => a - b);
  return { lo: values[Math.floor(0.025 * resamples)], hi: values[Math.ceil(0.975 * resamples) - 1] };
}
const oldSpecShare = rows => { const g = Map.groupBy(rows, r => r.hash); return [...g.values()].filter(x => x.some(r => caught(r.after))).length / g.size; };

test('a spec drawn twice counts twice in the spec-level share', () => {
  const rows = [{ hash: 'a', after: 'flagged', draw: '0:0' }, { hash: 'a', after: 'flagged', draw: '0:1' }, { hash: 'b', after: 'verified', draw: '1:0' }];
  assert.equal(specShare('after')(rows), 2 / 3);
  assert.equal(specShare('after')(rows.map(({ draw, ...r }) => r)), 1 / 2);
});

test('100 specifications with 1 flagged: the upper bound reflects repeated draws (3%), not the collapsed 1.72%', () => {
  const rows = specs(100, 1), fixed = clustered(rows, specShare('after')), old = collapsing(rows, oldSpecShare);
  assert.equal(fixed.point, 0.01);
  assert.ok(old.hi < 0.02, `collapsed upper bound ${old.hi}`);
  assert.ok(fixed.hi >= 0.03, `upper bound ${fixed.hi}`);
  assert.ok(fixed.hi <= 0.04, `upper bound ${fixed.hi}`);
  assert.equal(fixed.lo, 0);
});

test('every resample has as many specifications as the data', () => {
  const rows = specs(50, 50, 2), seen = new Set();
  clustered(rows, sample => { seen.add(new Set(sample.map(r => `${r.draw}\0${r.hash}`)).size); return specShare('after')(sample); });
  assert.deepEqual([...seen], [50]);
});

test('row-share metrics are unchanged by the fix: the draw sequence is the same', () => {
  const rows = specs(120, 7, 4).map((r, i) => ({ ...r, after: i % 9 === 0 ? 'flagged' : r.after }));
  const metric = share(r => caught(r.after)), fixed = clustered(rows, metric), old = collapsing(rows, metric);
  assert.deepEqual({ lo: fixed.lo, hi: fixed.hi }, old);
});

test('regeneration refuses rows whose hash is not the one recorded for that receipt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p70-'));
  try {
    const rows = join(dir, 'rows.json');
    writeFileSync(rows, JSON.stringify({ pristine: [], injected: [], excluded: [] }));
    for (const receipt of Object.keys(targets)) assert.throws(() => regenerate(rows, receipt), /sha256/);
    assert.throws(() => regenerate(rows, 'P-70-oracle-injected/receipt/elsewhere'), /no recorded rows/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
