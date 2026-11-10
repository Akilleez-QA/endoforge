import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openLibrary } from '../library.mjs';
import { keysOf, sha256, signatures } from '../key.mjs';
import { Journal } from '../journal.mjs';

const mleb = value => { const out = []; do { let byte = value & 0x7f; value >>>= 7; if (value) byte |= 0x80; out.push(byte); } while (value); return out; };
const sec = (id, content) => (content.length ? [id, ...mleb(content.length), ...content] : []);
const vec = rows => [...mleb(rows.length), ...rows.flat()];
const str = text => [...mleb(Buffer.byteLength(text)), ...Buffer.from(text)];
const I32 = 0x7f;
const f64 = value => { const out = new Uint8Array(8); new DataView(out.buffer).setFloat64(0, value, true); return [...out]; };
const recordStep = (name, delta, scale) => Uint8Array.from([
  0, 97, 115, 109, 1, 0, 0, 0,
  ...sec(1, vec([[0x60, ...vec([[I32], [I32]]), ...vec([])]])),
  ...sec(3, vec([mleb(0)])),
  ...sec(5, vec([[1, 1, 1]])),
  ...sec(7, vec([[...str(name), 0, 0]])),
  ...sec(10, vec([(() => { const body = [0, 0x20, 1, 0x20, 0, 0x2b, 3, 0, 0x44, ...f64(scale), 0xa2, 0x44, ...f64(delta), 0xa0, 0x39, 3, 0, 0x0b]; return [...mleb(body.length), ...body]; })()])),
]);
const inc = recordStep('inc', 1, 1), dbl = recordStep('dbl', 0, 2);
const field = over => ({ name: 'total', kind: 'number', unit: 'kg', label: 'Total', precision: 2, ...over });
const record = (fields, label = 'Balance') => ({ kind: 'record', label, fields });
const balance = record([field()]);
const step = (name, shape = balance) => ({ name, args: [{ ...shape, name: 'state' }], result: shape });
const capOf = (...exports) => ({ exports, traps: [] });
const glueFor = (id, cap) => JSON.stringify({ id, assumption: 'Inputs stay within the declared range.', question: 'Are these inputs sufficient for the need?', exports: cap.exports.map(item => ({ ...item, label: `Export ${item.name}` })), traps: [] });
const blocked = (contract, cap) => `${contract}\n\n\`\`\`capability\n${JSON.stringify(cap)}\n\`\`\`\n`;
const frozenFor = cap => (contract, tests) => { const text = blocked(contract, cap); return { 'CONTRACT.md': text, 'tests.json': tests, 'frozen.sha256': JSON.stringify({ contract: sha256(text), tests: sha256(tests) }) }; };
const seed = async (path, rows) => {
  const probe = await openLibrary({ journal: path }), { hostDigest, environment, environmentId } = probe;
  await probe.close();
  const journal = new Journal(path);
  for (const { id, bytes, cap, contract } of rows) {
    const source = `export const seeded = ${JSON.stringify(id)};`;
    journal.append({ kind: 'library_admit', entry: { id, glueId: id, wasm: Buffer.from(bytes).toString('base64'), wasmSha: sha256(bytes), source, sourceSha: sha256(source), glue: glueFor(id, cap), capability: cap, keys: keysOf(cap, contract), fingerprint: id, own: { contract, tests: '[]' }, promotion: { candidate: id, decision: `decision-${id}` }, qualifiedHost: hostDigest, qualifications: { [environmentId]: { environment, ok: true } } } });
  }
  journal.close();
  return openLibrary({ journal: path, gate: 'none' });
};
const opened = async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-union-layout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = await seed(join(root, 'library.jsonl'), [
    { id: 'incer', bytes: inc, cap: capOf(step('inc')), contract: 'Adds one to the balance.' },
    { id: 'doubler', bytes: dbl, cap: capOf(step('dbl')), contract: 'Doubles the balance.' }]);
  t.after(() => library.close());
  return library;
};
const tests = JSON.stringify([{ name: 'inc', fn: 'inc', args: [{ total: 3 }], expect: { total: 4 } }, { name: 'dbl', fn: 'dbl', args: [{ total: 3 }], expect: { total: 6 } }]);
const served = (library, capability) => library.serve({ id: 'union', capability, files: frozenFor(capability)('Add one or double the balance.', tests) });

test('T4 union serve composes when every member layout agrees with the need, labels aside', async t => {
  const library = await opened(t);
  const relabelled = record([field({ label: 'Sum' })], 'Account');
  const outcome = await served(library, capOf(step('inc', relabelled), step('dbl', relabelled)));
  assert.equal(outcome.verdict, 'pass', JSON.stringify(outcome));
  assert.equal(outcome.receipt.kind, 'library_compose');
  assert.deepEqual(outcome.receipt.plan, { exports: [{ name: 'inc', entry: 'incer', fn: 'inc' }, { name: 'dbl', entry: 'doubler', fn: 'dbl' }] });
  assert.deepEqual(outcome.receipt.sources.map(source => source.candidate).sort(), ['doubler', 'incer']);
});

test('T4 union serve refuses when one member\'s nested layout differs from the need', async t => {
  const library = await opened(t);
  const variants = {
    'nested unit': record([field({ unit: 'g' })]),
    'nested precision': record([field({ precision: 1 })]),
    'nested field name': record([field({ name: 'amount' })]),
    'nested kind': record([field({ kind: 'integer', precision: undefined })]),
    'extra nested field': record([field(), field({ name: 'fee' })]),
    'nested record inside': record([{ name: 'total', kind: 'record', label: 'Total', fields: [field({ name: 'value' })] }]),
  };
  for (const [what, shape] of Object.entries(variants)) {
    for (const capability of [capOf(step('inc'), step('dbl', shape)), capOf(step('inc', shape), step('dbl'))]) {
      const outcome = await served(library, capability);
      assert.equal(outcome.verdict, 'miss', `${what}: ${JSON.stringify(outcome)}`);
      assert.equal(outcome.reason, 'no_contract_match', what);
      assert.equal(outcome.receipt, undefined, what);
    }
  }
  const argOnly = { name: 'dbl', args: [{ ...record([field({ unit: 'g' })]), name: 'state' }], result: balance };
  assert.equal((await served(library, capOf(step('inc'), argOnly))).reason, 'no_contract_match');
  const resultOnly = { name: 'dbl', args: [{ ...balance, name: 'state' }], result: record([field({ unit: 'g' })]) };
  assert.equal((await served(library, capOf(step('inc'), resultOnly))).reason, 'no_contract_match');
});

test('T4 union members that share one layout bind by name, never to the first entry that fits', async t => {
  const library = await opened(t);
  const outcome = await served(library, capOf(step('inc'), step('dbl')));
  assert.equal(outcome.verdict, 'pass', JSON.stringify(outcome));
  assert.deepEqual(outcome.receipt.plan.exports.map(item => [item.name, item.entry, item.fn]), [['inc', 'incer', 'inc'], ['dbl', 'doubler', 'dbl']]);
  const unnamed = await served(library, capOf(step('inc'), step('halve')));
  assert.equal(unnamed.verdict, 'miss', JSON.stringify(unnamed));
  assert.equal(unnamed.reason, 'no_contract_match');
});

test('T4 union signatures carry list and text layout at every depth', () => {
  const listed = (items, max = 4) => ({ kind: 'list', max, items });
  const sig = shape => signatures(capOf({ name: 'f', args: [{ ...shape, name: 'x' }], result: shape }))[0].text;
  const baseShape = record([{ name: 'rows', ...listed(record([field(), { name: 'note', kind: 'text', maxBytes: 8 }])) }]);
  assert.equal(sig(baseShape), sig(record([{ name: 'rows', ...listed(record([{ name: 'note', kind: 'text', maxBytes: 8, label: 'N' }, field({ label: 'T' })])) }], 'Other')));
  for (const changed of [
    record([{ name: 'rows', ...listed(record([field(), { name: 'note', kind: 'text', maxBytes: 8 }]), 5) }]),
    record([{ name: 'rows', ...listed(record([field(), { name: 'note', kind: 'text', maxBytes: 9 }])) }]),
    record([{ name: 'rows', ...listed(record([field({ unit: 'g' }), { name: 'note', kind: 'text', maxBytes: 8 }])) }]),
    record([{ name: 'rows', ...listed(record([field()])) }]),
  ]) assert.notEqual(sig(changed), sig(baseShape));
});
