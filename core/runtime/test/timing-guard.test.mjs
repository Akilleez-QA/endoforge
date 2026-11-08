import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultLoadThreshold, loadGuard, timingOnly } from './fixtures/timing.mjs';

const recorder = () => {
  const notes = [];
  return { notes, t: { diagnostic: note => notes.push(note) } };
};
const failing = () => assert.fail('timing assert ran');

test('without the opt-in the timing assert always runs, whatever the load', () => {
  const { t, notes } = recorder();
  assert.throws(() => timingOnly(t, 'x', failing, { env: {}, load: () => 99 }), /timing assert ran/);
  assert.deepEqual(timingOnly(t, 'x', () => {}, { env: {}, load: () => 99 }), { status: 'checked' });
  assert.deepEqual(notes, []);
});

test('with the opt-in and load above the default threshold the assert is reported as skipped-loaded', () => {
  const { t, notes } = recorder();
  assert.equal(defaultLoadThreshold, 16);
  const result = timingOnly(t, 'cut off promptly', failing, { env: { ENDOFORGE_LOAD_GUARD: '1' }, load: () => 16.5 });
  assert.deepEqual(result, { status: 'skipped-loaded', load: 16.5, threshold: 16 });
  assert.deepEqual(notes, ['skipped-loaded: cut off promptly (load 16.50 > 16)']);
});

test('with the opt-in at or below the threshold the assert runs and can fail', () => {
  const { t, notes } = recorder();
  assert.throws(() => timingOnly(t, 'x', failing, { env: { ENDOFORGE_LOAD_GUARD: '1' }, load: () => 16 }), /timing assert ran/);
  assert.throws(() => timingOnly(t, 'x', failing, { env: { ENDOFORGE_LOAD_GUARD: '1', ENDOFORGE_LOAD_THRESHOLD: '40' }, load: () => 30 }), /timing assert ran/);
  assert.deepEqual(notes, []);
});

test('the threshold is configurable and must be a positive number', () => {
  assert.deepEqual(loadGuard({ ENDOFORGE_LOAD_GUARD: '1', ENDOFORGE_LOAD_THRESHOLD: '4' }, () => 5), { load: 5, threshold: 4 });
  assert.equal(loadGuard({ ENDOFORGE_LOAD_GUARD: '0' }, () => 99), null);
  for (const value of ['0', '-1', 'high']) assert.throws(() => loadGuard({ ENDOFORGE_LOAD_GUARD: '1', ENDOFORGE_LOAD_THRESHOLD: value }, () => 1), /positive number/);
});
