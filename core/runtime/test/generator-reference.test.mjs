import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, referenceRule } from '../x1/generator.mjs';
import { fillExpected } from '../x1/reference.mjs';
const fake = new URL('./fixtures/x1/fake-codex.mjs', import.meta.url).pathname;
test('reference evaluator fills expected values and tolerances from the formula', async () => {
  const code = 'function f(x) { if (x < 0) throw Error("neg"); return Math.sqrt(x); } function g(x) { return x * 2; } function h(x) { return x > 1; }';
  const out = await fillExpected(code, [{ name: 'a', fn: 'f', args: [2], expect: 1.41 }, { name: 'b', fn: 'g', args: [3] }, { name: 'c', fn: 'f', args: [-1], expectError: true }, { name: 'd', fn: 'h', args: [2] }, { name: 'e', fn: 'f', args: [3], tol: 0.5 }]);
  assert.deepEqual(out, [{ name: 'a', fn: 'f', args: [2], expect: Math.SQRT2, tol: 1e-9 * Math.SQRT2 }, { name: 'b', fn: 'g', args: [3], expect: 6 },
    { name: 'c', fn: 'f', args: [-1], expectError: true }, { name: 'd', fn: 'h', args: [2], expect: true }, { name: 'e', fn: 'f', args: [3], tol: 0.5, expect: Math.sqrt(3) }]);
});
test('reference evaluator fails closed on missing functions, wrong traps and side effects', async () => {
  await assert.rejects(fillExpected('function f() { return 1; }', [{ name: 'a', fn: 'g', args: [] }]), /no function g/);
  await assert.rejects(fillExpected('function f() { return 1; }', [{ name: 'a', fn: 'f', args: [], expectError: true }]), /does not throw/);
  await assert.rejects(fillExpected('function f() { return NaN; }', [{ name: 'a', fn: 'f', args: [] }]), /non-finite/);
  await assert.rejects(fillExpected('function f() { return process.exit(0); }', [{ name: 'a', fn: 'f', args: [] }]), /throws/);
  await assert.rejects(fillExpected('while (true) {}', [{ name: 'a', fn: 'f', args: [] }]), /evaluator failed/);
});
test('reference mode freezes evaluator-computed expectations, not model numbers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-generator-reference-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = join(root, 'record');
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]), CODEX_HOME: join(root, 'none'),
    ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_CODEX_TERSE: 'reference', FAKE_CODEX_MODE: 'reference', FAKE_CODEX_RECORD: record };
  const out = await generate({ need: 'integer add(a,b)', directory: join(root, 'x'), env });
  assert.deepEqual(JSON.parse(out.candidate.files['tests.json']), [{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }, { name: 'high', fn: 'add', args: [11, 0], expectError: true }]);
  assert.equal(await readFile(join(out.reference.root, 'tests.json'), 'utf8'), out.candidate.files['tests.json']);
  assert.ok(JSON.parse(await readFile(`${record}.specification.json`, 'utf8')).instructions.includes(referenceRule));
  assert.ok(!JSON.parse(await readFile(`${record}.implementation.json`, 'utf8')).instructions.includes(referenceRule));
});
