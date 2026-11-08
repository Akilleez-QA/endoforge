import test from 'node:test';
import assert from 'node:assert/strict';
import { createStageRates, format, loopStages, verdict } from '../stage-rates.mjs';

const clocked = stages => {
  let now = 0;
  const rates = createStageRates({ stages, tickMs: 0, clock: () => now });
  return { rates, at: t => { now = t; } };
};

test('a single server stage infers FIFO service and satisfies Little', () => {
  const { rates, at } = clocked({ ledger: { servers: 1 } });
  const start = rates.snapshot();
  at(0); const slots = [rates.arrive('ledger'), rates.arrive('ledger'), rates.arrive('ledger')];
  for (const [i, slot] of slots.entries()) { at(10 * (i + 1)); rates.done(slot); }
  at(40);
  const row = rates.view({ from: start }).stages.ledger;
  assert.equal(row.completionsPerSecond, 75);
  assert.equal(row.serviceMs.mean, 10);
  assert.equal(row.waitMs, 10);
  assert.equal(row.utilisation, 0.75);
  assert.equal(row.inSystem.mean, 1.5);
  assert.ok(Math.abs(row.little.error) < 1e-12);
});

test('explicit start separates waiting from service and blocked time lowers net utilisation', () => {
  const { rates, at } = clocked({ cell: { servers: 2, queue: 'explicit' } });
  const start = rates.snapshot();
  at(0); const a = rates.arrive('cell'), b = rates.arrive('cell'), c = rates.arrive('cell');
  rates.start(a); rates.start(b);
  at(50); rates.done(a); rates.start(c);
  at(100); rates.done(b); rates.done(c); rates.block('cell', 40);
  const row = rates.view({ from: start }).stages.cell;
  assert.equal(row.utilisation, 1);
  assert.equal(row.netUtilisation, 0.8);
  assert.equal(row.queue.mean, 0.5);
  assert.equal(row.serviceMs.mean, (50 + 100 + 50) / 3);
});

test('rule V names a saturated stage, prefers net utilisation, and falls back to population', () => {
  const row = (net, queue, extra = {}) => ({ netUtilisation: net, utilisation: net, arrivalsPerSecond: 1, completionsPerSecond: 1, queue: { mean: queue, growthPerSecond: 0 }, inSystem: { mean: 1 }, servers: 1, ...extra });
  assert.equal(verdict({ cell: row(0.2, 6, { utilisation: 1 }), ledger: row(0.99, 8) }).bottleneck, 'ledger');
  assert.equal(verdict({ cell: row(0.9, 3), ledger: row(0.88, 9) }).bottleneck, 'ledger');
  assert.equal(verdict({ cell: row(0.85, 0) }).kind, 'unsaturated');
  const population = verdict({ 'model:spec': { ...row(null, 0), inSystem: { mean: 7 }, group: 'model' }, 'model:impl': { ...row(null, 0), inSystem: { mean: 8 }, group: 'model' }, cell: row(0.3, 0) });
  assert.deepEqual([population.bottleneck, population.kind], ['model', 'population']);
});

test('the loop stage table formats a readable view', () => {
  const { rates, at } = clocked(loopStages({ cells: 4, lane: 1 }));
  at(0); const slot = rates.arrive('model:spec'); at(5); rates.done(slot); rates.span('cell.compile', 3);
  at(1000);
  const text = format(rates.view({ windowMs: 1000 }));
  assert.match(text, /model:spec/);
  assert.match(text, /bottleneck: model/);
  assert.match(text, /tscheck\.check/);
});
