import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { threadId } from 'node:worker_threads';
import { scriptedProvider } from '../x1/transports.mjs';
import { begin, judge } from '../x1/synth/stage.mjs';
import { judgeInCell } from '../x1/synth/cell-host.mjs';

const kernel = op => {
  const body = [0x00, 0x20, 0x00, 0x44, 0, 0, 0, 0, 0, 0, 0, 0, 0x63, 0x04, 0x40, 0x00, 0x0b, 0x20, 0x00, 0x20, 0x01, op, 0x0b];
  const section = (id, bytes) => [id, bytes.length, ...bytes];
  return Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section(1, [1, 0x60, 2, 0x7c, 0x7c, 1, 0x7c]), ...section(3, [1, 0]),
    ...section(7, [1, 1, 0x66, 0x00, 0]), ...section(10, [1, body.length, ...body])]).toString('base64');
};
const mul = 0xa2, add = 0xa0;
const contract = 'Export f(massKg: f64, rate: f64): f64 = massKg * rate. massKg in [0, 100], trap below 0. Result in kg, 2 decimals.';
const goodTests = [{ name: 'one', fn: 'f', args: [2, 3], expect: 6 }, { name: 'neg', fn: 'f', args: [-1, 3], expectError: true }];
const badTests = [...goodTests, { name: 'wrong', fn: 'f', args: [4, 5], expect: 21 }];
const product = 'function f(massKg, rate) { if (massKg < 0) throw Error("neg"); return massKg * rate; }';
const productAgain = 'function f(m, r) { if (m < 0) { throw new RangeError("below zero"); } const out = m * r; return out; }';
const binding = (reference = product) => ({
  exports: [{ name: 'f', params: [{ name: 'massKg', unit: 'kg', min: 0, max: 100 }, { name: 'rate', unit: '1', min: 0, max: 10 }],
    result: { kind: 'number', unit: 'kg', decimals: 2 }, monotone: [{ param: 'massKg', direction: 'increasing' }] }], reference });
const glue = () => JSON.stringify({ id: 'c', exports: [{ name: 'f', label: 'Mass', args: [{ name: 'massKg', kind: 'number', unit: 'kg' }, { name: 'rate', kind: 'number', unit: 'ratio' }],
  result: { kind: 'number', unit: 'kilograms', precision: 2 } }], traps: [] });
const reply = (path, value) => ({ text: JSON.stringify({ calls: [{ name: 'edit_file', path, content: JSON.stringify(value) }, { name: 'done' }] }), usage: 10 });
const sheet = { residual: ['The result is mass times rate.'], quantities: [], relations: [], invariants: ['value.reference'] };
const provider = bindings => scriptedProvider(({ session }) => (session.startsWith('need') ? reply('sheet.json', sheet) : reply('binding.json', bindings[Number(session.split('-')[1])] ?? bindings[0])));
async function frozen({ env = {}, tests = goodTests, bindings = [binding()] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'gaps-synth-'));
  await writeFile(join(root, 'CONTRACT.md'), contract);
  await writeFile(join(root, 'tests.json'), JSON.stringify(tests));
  const stage = begin({ need: 'mass times rate', env, provider: provider(bindings) });
  const result = await stage.finish(root);
  return { root, stage, result, evaluator: JSON.parse(await readFile(join(root, 'synth', 'evaluator.json'), 'utf8')) };
}
const candidate = op => ({ compiled: { wasm: kernel(op) }, files: { 'glue.json': glue() } });

test('G2: the frozen evaluator judges a candidate in a pool cell, not on the controller thread', async () => {
  const { root, stage, evaluator } = await frozen();
  try {
    const good = await stage.evaluate(candidate(mul));
    assert.equal(good.decision, 'pass', JSON.stringify(good));
    assert.equal(typeof good.cell?.thread, 'number');
    assert.notEqual(good.cell.thread, threadId);
    const bad = await stage.evaluate(candidate(add));
    assert.equal(bad.decision, 'refuse');
    assert.notEqual(bad.cell.thread, threadId);
    const local = judge(evaluator, candidate(add));
    assert.deepEqual(bad.failures, local.failures);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G2: a cell that breaks its deadline or cannot run refuses, never passes', async () => {
  const { root, evaluator } = await frozen();
  try {
    const late = await judgeInCell(evaluator, candidate(mul), { deadlineMs: 1 });
    assert.equal(late.decision, 'refuse');
    assert.equal(late.reason, 'cell_timeout');
    const broken = await judgeInCell(evaluator, { compiled: { wasm: 'AAAA' }, files: {} });
    assert.equal(broken.decision, 'refuse');
    assert.notEqual(broken.cell.thread, threadId);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G4: a frozen test that two qualified, agreeing references contradict is reported as suspect at freeze', async () => {
  const { root, result, evaluator } = await frozen({ env: { ENDOFORGE_SYNTH_WIDTH: '2' }, tests: badTests, bindings: [binding(product), binding(productAgain)] });
  try {
    assert.equal(result.suspects.length, 1);
    const [suspect] = result.suspects;
    assert.equal(suspect.test, 'wrong');
    assert.equal(suspect.fn, 'f');
    assert.deepEqual(suspect.args, [4, 5]);
    assert.equal(suspect.expect, 21);
    assert.deepEqual(suspect.references, [{ value: 20 }, { value: 20 }]);
    assert.deepEqual(evaluator.suspects, result.suspects);
    const report = JSON.parse(await readFile(join(root, 'synth', 'suspect.json'), 'utf8'));
    assert.equal(report.kind, 'suspect_frozen_tests');
    assert.equal(report.before, 'implementation');
    assert.equal(report.revision.reason, 'specification_correction');
    assert.deepEqual(report.revision.references, evaluator.members.map(m => m.binding));
    assert.deepEqual(report.tests, result.suspects);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G4: the suspect report reaches a caller-supplied hook before finish returns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gaps-synth-'));
  try {
    await writeFile(join(root, 'CONTRACT.md'), contract);
    await writeFile(join(root, 'tests.json'), JSON.stringify(badTests));
    const seen = [];
    const stage = begin({ need: 'mass times rate', env: { ENDOFORGE_SYNTH_WIDTH: '2' }, provider: provider([binding(product), binding(productAgain)]), suspect: report => seen.push(report) });
    const result = await stage.finish(root);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].tests, result.suspects);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G4: no suspect from one reference, from disagreeing references, or from a reference that fails another gate', async () => {
  const single = await frozen({ tests: badTests, bindings: [binding(product)] });
  const split = await frozen({ env: { ENDOFORGE_SYNTH_WIDTH: '2' }, tests: badTests, bindings: [binding(product), binding('function f(m, r) { if (m < 0) throw Error("neg"); return m * r + 1; }')] });
  const unbounded = binding(productAgain);
  unbounded.exports[0].params = [{ name: 'massKg' }];
  const shape = await frozen({ env: { ENDOFORGE_SYNTH_WIDTH: '2' }, tests: badTests, bindings: [binding(product), unbounded] });
  const clean = await frozen({ env: { ENDOFORGE_SYNTH_WIDTH: '2' }, tests: goodTests, bindings: [binding(product), binding(productAgain)] });
  try {
    for (const run of [single, split, shape, clean]) {
      assert.deepEqual(run.result.suspects, []);
      assert.deepEqual(run.evaluator.suspects, []);
      await assert.rejects(readFile(join(run.root, 'synth', 'suspect.json'), 'utf8'));
    }
  } finally { await Promise.all([single, split, shape, clean].map(run => rm(run.root, { recursive: true, force: true }))); }
});
