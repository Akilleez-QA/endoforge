import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scriptedProvider } from '../x1/transports.mjs';
import { compareUnits } from '../x1/synth/units.mjs';
import { mutants } from '../x1/synth/qualify.mjs';
import { begin, compileMember, enabled, judge, prompts } from '../x1/synth/stage.mjs';

const kernel = op => {
  const body = [0x00, 0x20, 0x00, 0x44, 0, 0, 0, 0, 0, 0, 0, 0, 0x63, 0x04, 0x40, 0x00, 0x0b, 0x20, 0x00, 0x20, 0x01, op, 0x0b];
  const section = (id, bytes) => [id, bytes.length, ...bytes];
  return Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section(1, [1, 0x60, 2, 0x7c, 0x7c, 1, 0x7c]), ...section(3, [1, 0]),
    ...section(7, [1, 1, 0x66, 0x00, 0]), ...section(10, [1, body.length, ...body])]).toString('base64');
};
const mul = 0xa2, add = 0xa0;
const contract = 'Export f(massKg: f64, rate: f64): f64 = massKg * rate. massKg in [0, 100], trap below 0. Result in kg, 2 decimals.';
const tests = [{ name: 'one', fn: 'f', args: [2, 3], expect: 6 }, { name: 'neg', fn: 'f', args: [-1, 3], expectError: true }];
const binding = (reference = 'function f(massKg, rate) { if (massKg < 0) throw Error("neg"); return massKg * rate; }') => ({
  exports: [{ name: 'f', params: [{ name: 'massKg', unit: 'kg', min: 0, max: 100 }, { name: 'rate', unit: '1', min: 0, max: 10 }],
    result: { kind: 'number', unit: 'kg', decimals: 2 }, monotone: [{ param: 'massKg', direction: 'increasing' }] }], reference });
const glue = (over = {}) => JSON.stringify({ id: 'c', exports: [{ name: 'f', label: 'Mass', args: [{ name: 'massKg', kind: 'number', unit: over.arg ?? 'kg' }, { name: 'rate', kind: 'number', unit: 'ratio' }],
  result: { kind: 'number', unit: over.result ?? 'kilograms', precision: over.precision ?? 2 } }], traps: [] });
const reply = (path, value) => ({ text: JSON.stringify({ calls: [{ name: 'edit_file', path, content: JSON.stringify(value) }, { name: 'done' }] }), usage: 10 });
const sheet = { residual: ['The result is mass times rate.'], quantities: [], relations: [], invariants: ['value.reference'] };
const provider = (bindings = [binding()]) => scriptedProvider(({ session }) => (session.startsWith('need') ? reply('sheet.json', sheet) : reply('binding.json', bindings[Number(session.split('-')[1])] ?? bindings[0])));
async function frozenRoot(env, given) {
  const root = await mkdtemp(join(tmpdir(), 'synth-'));
  await writeFile(join(root, 'CONTRACT.md'), contract);
  await writeFile(join(root, 'tests.json'), JSON.stringify(tests));
  const stage = begin({ need: 'mass times rate', env, provider: given });
  await stage.finish(root);
  return { root, stage };
}

test('the stage is off unless ENDOFORGE_SYNTH=1', () => {
  assert.equal(enabled({}), false);
  assert.equal(enabled({ ENDOFORGE_SYNTH: '1' }), true);
});

test('units compare by dimension and scale, and an unknown unit never refuses', () => {
  assert.equal(compareUnits('g/m', 'grams per metre'), 'same');
  assert.equal(compareUnits('Btu/h', 'BTU/hr'), 'same');
  assert.equal(compareUnits('g', 'm'), 'different');
  assert.equal(compareUnits('°F', '°C'), 'different');
  assert.equal(compareUnits('psig', 'psia'), 'different');
  assert.equal(compareUnits('code', 'g'), 'unknown');
});

test('the binding prompt carries the contract and never the tests or a candidate', () => {
  const text = JSON.stringify(prompts.binding(sheet, contract));
  assert.ok(text.includes('massKg * rate'));
  assert.ok(!text.includes('"expect"') && !text.includes('kernel.ts') && !text.includes('glue.json'));
});

test('reference faults are seeded across constants, comparisons, operators and argument order', () => {
  const faults = mutants(binding().reference);
  assert.ok(faults.some(m => m.includes('massKg <= 0')));
  assert.ok(faults.some(m => m.includes('massKg / rate')));
  assert.ok(faults.some(m => m.includes('function f(rate, massKg)')));
});

test('a reference that reproduces the frozen tests qualifies under every meta-gate', async () => {
  const member = await compileMember(binding(), tests);
  const f = member.exports.f;
  assert.equal(f.qualified, true, f.failures.join('; '));
  assert.ok(f.vectors.length > 20);
  assert.ok(f.vectors.some(v => v.throws) && f.vectors.some(v => 'value' in v));
  assert.ok(f.discrimination.score >= 0.8);
});

test('a reference that disagrees with a frozen test is unqualified (M3), and a wrong arity fails M1', async () => {
  const wrong = await compileMember(binding('function f(massKg, rate) { if (massKg < 0) throw Error("neg"); return massKg + rate; }'), tests);
  assert.equal(wrong.exports.f.qualified, false);
  assert.ok(wrong.exports.f.failures.some(x => x.startsWith('M3')));
  const arity = await compileMember({ ...binding(), exports: [{ ...binding().exports[0], params: [{ name: 'massKg' }] }] }, tests);
  assert.ok(arity.exports.f.failures.some(x => x.startsWith('M1')));
});

test('the frozen evaluator passes the right kernel and refuses a finite fault the frozen tests miss', async () => {
  const { root, stage } = await frozenRoot({}, provider());
  try {
    const evaluator = JSON.parse(await readFile(join(root, 'synth', 'evaluator.json'), 'utf8'));
    assert.equal(evaluator.confirmation.confirmed_by, 'task contract, no person');
    const good = await stage.evaluate({ compiled: { wasm: kernel(mul) }, files: { 'glue.json': glue() } });
    assert.equal(good.decision, 'pass', JSON.stringify(good));
    const fault = judge(evaluator, { compiled: { wasm: kernel(add) }, files: { 'glue.json': glue() } });
    assert.equal(fault.decision, 'refuse');
    assert.ok(fault.failures.some(x => x.startsWith('value.reference')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('glue checks refuse swapped units and changed decimals', async () => {
  const { root } = await frozenRoot({}, provider());
  try {
    const evaluator = JSON.parse(await readFile(join(root, 'synth', 'evaluator.json'), 'utf8'));
    const run = over => judge(evaluator, { compiled: { wasm: kernel(mul) }, files: { 'glue.json': glue(over) } });
    assert.ok(run({ result: 'm' }).failures.some(x => x.startsWith('units.glue')));
    assert.ok(run({ arg: 'lb' }).failures.some(x => x.startsWith('units.glue')));
    assert.ok(run({ precision: 3 }).failures.some(x => x.startsWith('precision.glue')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an evaluator changed after freeze refuses, and an unconfirmed one abstains', async () => {
  const { root, stage } = await frozenRoot({}, provider());
  try {
    const path = join(root, 'synth', 'evaluator.json'), evaluator = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(judge({ ...evaluator, confirmation: { approved: false } }, {}).decision, 'abstain');
    await writeFile(path, JSON.stringify({ ...evaluator, checks: { ...evaluator.checks, vectors: [] } }));
    assert.equal((await stage.evaluate({ compiled: { wasm: kernel(mul) }, files: { 'glue.json': glue() } })).decision, 'refuse');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('dual mode keeps only the checks both independent evaluators agree on', async () => {
  const other = binding('function f(massKg, rate) { if (massKg < 0) throw Error("neg"); return massKg > 50 ? 0 : massKg * rate; }');
  other.exports[0].result.unit = 'lb';
  const { root } = await frozenRoot({ ENDOFORGE_SYNTH_WIDTH: '2' }, provider([binding(), other]));
  try {
    const evaluator = JSON.parse(await readFile(join(root, 'synth', 'evaluator.json'), 'utf8'));
    assert.equal(evaluator.width, 2);
    assert.ok(evaluator.checks.vectors.every(v => v.throws || v.args[0] <= 50));
    assert.equal(evaluator.checks.glue[0].result.unit, null);
    assert.equal(judge(evaluator, { compiled: { wasm: kernel(mul) }, files: { 'glue.json': glue({ result: 'm' }) } }).decision, 'pass');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a model failure leaves an abstaining evaluator, never a refusal', async () => {
  const broken = scriptedProvider(() => ({ text: 'not json', usage: 1 }));
  const { root, stage } = await frozenRoot({}, broken);
  try {
    assert.equal((await stage.evaluate({ compiled: { wasm: kernel(add) }, files: { 'glue.json': glue() } })).decision, 'abstain');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a range with one open side survives the frozen file (JSON has no Infinity)', async () => {
  const open = binding();
  open.exports[0].result.min = -1e6;
  const { root, stage } = await frozenRoot({}, provider([open]));
  try {
    const evaluator = JSON.parse(await readFile(join(root, 'synth', 'evaluator.json'), 'utf8'));
    assert.deepEqual(evaluator.checks.ranges, [{ fn: 'f', min: -1e6 }]);
    assert.equal((await stage.evaluate({ compiled: { wasm: kernel(mul) }, files: { 'glue.json': glue() } })).decision, 'pass');
  } finally { await rm(root, { recursive: true, force: true }); }
});
