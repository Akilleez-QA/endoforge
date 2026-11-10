import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const example = fileURLToPath(new URL('../../../examples/library-reuse.mjs', import.meta.url));

test('examples/library-reuse.mjs prints generated and promoted, then reused, then a library miss with its reason', { timeout: 300000 }, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [example], { maxBuffer: 1 << 24, timeout: 280000 });
  const printed = JSON.parse(stdout);

  assert.equal(printed.first.promoted, true);
  assert.equal(printed.first.reused, false);
  assert.deepEqual(printed.first.modelStages, ['implementation', 'specification']);

  assert.deepEqual(printed.admitted, { admitted: true, entries: 1 });

  assert.equal(printed.second.promoted, true);
  assert.equal(printed.second.library, 'pass');
  assert.equal(printed.second.reusedFrom, 'first');
  assert.deepEqual(printed.second.modelStages, ['specification']);

  assert.equal(printed.third.library, 'miss');
  assert.equal(printed.third.missReason, 'no_contract_match');
  assert.equal(printed.third.reused, false);
  assert.equal(printed.third.promoted, true);
  assert.deepEqual(printed.third.modelStages, ['implementation', 'specification']);

  assert.equal(typeof printed.journal, 'string');
});
