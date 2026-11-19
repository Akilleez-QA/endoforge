import assert from 'node:assert/strict';
import test from 'node:test';
import { runGates } from '../x1/gates.mjs';
import { rerunGates, shapeOf } from '../x1/rerun.mjs';
import { candidate } from './fixtures/x1/candidate.mjs';

test('the off-loop re-run answers what runGates answers on the supervisor', async () => {
  const passing = candidate(), failing = candidate();
  failing.files['tests.json'] = '[]';
  for (const c of [passing, failing]) {
    const inline = runGates(c);
    assert.deepEqual(await rerunGates(JSON.stringify(c)), { promotable: inline.promotable === true, shape: shapeOf(inline.tests) });
  }
  assert.equal((await rerunGates(JSON.stringify(passing))).promotable, true);
});

test('content that is not a candidate gets no answer, which the commit treats as disagreement', async () => {
  assert.deepEqual(await Promise.all(['', '{', '{}', 'null'].map(rerunGates)), [null, null, null, null]);
});
