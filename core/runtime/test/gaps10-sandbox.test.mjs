import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceDeadline, referenceLimits, runReferences } from '../x1/synth/sandbox.mjs';

const reference = 'function add(a, b) { return a + b; }';
const calls = [{ fn: 'add', args: [1, 2] }, { fn: 'add', args: [3, 4] }];

test('D-14: the reference deadline grows with the variants and calls it must run', () => {
  const { loadMs, callMs, variantMs, startupMs } = referenceLimits;
  assert.equal(referenceDeadline([reference], calls), startupMs + loadMs + 2 * callMs);
  assert.equal(referenceDeadline([reference, reference, reference], calls), startupMs + 3 * (loadMs + 2 * callMs));
  const many = Array.from({ length: 500 }, () => calls[0]);
  assert.equal(referenceDeadline([reference, reference], many), startupMs + 2 * (loadMs + variantMs));
  assert.equal(referenceDeadline([reference], calls, { startupMs: 100 }), 100 + loadMs + 2 * callMs);
  assert.ok(referenceDeadline(Array(6).fill(reference), many) > 30000);
});

test('D-14: a slow-starting but healthy child completes within the derived deadline', async () => {
  const startupMs = 1500;
  const deadline = referenceDeadline([reference], calls, { startupMs });
  const hold = deadline - 1000;
  const started = Date.now();
  const out = await runReferences([reference], calls, { startupMs, hold });
  assert.ok(Date.now() - started >= hold);
  assert.deepEqual(out, [{ results: [{ value: 3 }, { value: 7 }] }]);
});

test('D-14: a hung child is still stopped and the error says it timed out after N ms', async () => {
  const startupMs = 500;
  const deadline = referenceDeadline([reference], calls, { startupMs });
  const started = Date.now();
  await assert.rejects(runReferences([reference], calls, { startupMs, hold: 600000 }), error => {
    assert.match(error.message, /^reference sandbox timed out after \d+ ms \(deadline \d+ ms\)$/);
    const [, waited, limit] = error.message.match(/after (\d+) ms \(deadline (\d+) ms\)/);
    assert.equal(Number(limit), deadline);
    assert.ok(Number(waited) >= deadline);
    return true;
  });
  assert.ok(Date.now() - started < deadline + 10000);
});

test('D-14: a child that exits on its own is reported by exit code, not as a timeout', async () => {
  await assert.rejects(runReferences(null, calls), error => {
    assert.match(error.message, /^reference sandbox exited with code 1$/);
    assert.doesNotMatch(error.message, /timed out/);
    return true;
  });
});

test('D-14: an explicit timeout still overrides the derived deadline', async () => {
  await assert.rejects(runReferences([reference], calls, { timeout: 300, hold: 600000 }), /timed out after \d+ ms \(deadline 300 ms\)/);
});
