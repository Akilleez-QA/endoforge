import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { binding, keysOf } from '../../library/key.mjs';
import { specificationProblems, stagePrompts } from '../x1/agent.mjs';
import { capabilityAgreement } from '../x1/contract.mjs';
import { capabilityProblems, capabilityRule, generate, glueRules } from '../x1/generator.mjs';
import { good } from './fixtures/x1/seeds.mjs';

const fixture = name => fileURLToPath(new URL(`./fixtures/x1/${name}`, import.meta.url));

const reading = { kind: 'record', fields: [
  { name: 'probe', kind: 'code', unit: '1', codes: { 0: 'Supply air', 1: 'Return air' } },
  { name: 'temperature', kind: 'number', unit: 'C', range: '-40..120', precision: 1 },
  { name: 'tag', kind: 'text', maxBytes: 16 },
] };
const log = { kind: 'list', max: 8, items: reading };
const summary = { kind: 'record', fields: [
  { name: 'latest', ...reading },
  { name: 'history', ...log },
  { name: 'meanTemperature', kind: 'number', unit: 'C', precision: 1 },
] };
const copy = value => JSON.parse(JSON.stringify(value));
const glue = copy({
  exports: [
    { name: 'record', args: [{ name: 'state', ...summary }, { name: 'event', ...reading }], result: summary },
    { name: 'mean', args: [{ name: 'state', ...summary }], result: { kind: 'number', unit: 'C', precision: 1 } },
  ],
  traps: [{ fn: 'record', when: 'the log is full', message: 'The log is full.' }],
});
const block = copy({ exports: glue.exports, traps: ['record'] });
const drift = change => { const value = copy(glue); change(value); return value; };
const field = (type, name) => type.fields.find(item => item.name === name);

test('R4: glue that declares the same nested capability as the block agrees with it', () => {
  assert.deepEqual(capabilityAgreement(block, glue), []);
});

test('R4: a nested Celsius result relabelled Fahrenheit in glue.json is refused', () => {
  const problems = capabilityAgreement(block, drift(g => { field(g.exports[0].result, 'meanTemperature').unit = 'F'; }));
  assert.equal(problems.length, 1, problems.join('; '));
  assert.match(problems[0], /record result\.meanTemperature unit: the capability block says "C", glue\.json says "F"/);
});

test('R4: every nested difference the block declares is refused, through records, lists, text and arguments', () => {
  const cases = [
    ['a record field two levels down changes unit', g => { field(field(g.exports[0].result, 'latest'), 'temperature').unit = 'F'; }, /record result\.latest\.temperature unit/],
    ['a list item field changes unit', g => { field(field(g.exports[0].result, 'history').items, 'temperature').unit = 'degF'; }, /record result\.history\[\]\.temperature unit/],
    ['a list item field changes precision', g => { field(field(g.exports[0].result, 'history').items, 'temperature').precision = 2; }, /record result\.history\[\]\.temperature precision/],
    ['a list bound changes', g => { field(g.exports[0].result, 'history').max = 9; }, /record result\.history max: the capability block says 8, glue\.json says 9/],
    ['a text bound changes', g => { field(field(g.exports[0].result, 'latest'), 'tag').maxBytes = 32; }, /record result\.latest\.tag maxBytes/],
    ['a list item changes kind', g => { field(g.exports[0].result, 'history').items = { kind: 'number', unit: 'C', precision: 1 }; }, /record result\.history\[\] kind/],
    ['a nested field changes kind', g => { field(g.exports[0].result, 'meanTemperature').kind = 'integer'; }, /record result\.meanTemperature kind/],
    ['nested code labels are swapped', g => { field(field(g.exports[0].result, 'latest'), 'probe').codes = { 0: 'Return air', 1: 'Supply air' }; }, /record result\.latest\.probe codes/],
    ['a nested argument range changes', g => { field(g.exports[0].args[1], 'temperature').range = '-40..150'; }, /record argument 2 \(event\)\.temperature range/],
    ['a nested argument field changes unit in a list', g => { field(field(g.exports[1].args[0], 'history').items, 'temperature').unit = 'F'; }, /mean argument 1 \(state\)\.history\[\]\.temperature unit/],
    ['a record field is missing from glue.json', g => { g.exports[0].result.fields = g.exports[0].result.fields.filter(item => item.name !== 'meanTemperature'); }, /record result: the capability block declares field meanTemperature, which glue\.json does not/],
    ['glue.json adds a record field', g => { g.exports[0].result.fields.push({ name: 'maxTemperature', kind: 'number', unit: 'F', precision: 1 }); }, /record result: glue\.json declares field maxTemperature, which the capability block does not/],
    ['a record field is renamed', g => { field(g.exports[0].args[1], 'temperature').name = 'temperatureF'; }, /record argument 2 \(event\): the capability block declares field temperature, which glue\.json does not/],
    ['glue.json drops the list items', g => { delete field(g.exports[0].result, 'history').items; }, /record result\.history items: the capability block declares list items, glue\.json does not/],
    ['glue.json drops the record fields', g => { delete field(g.exports[0].result, 'latest').fields; }, /record result\.latest fields: the capability block declares record fields, glue\.json does not/],
  ];
  for (const [label, change, why] of cases) {
    const problems = capabilityAgreement(block, drift(change));
    assert.ok(problems.length > 0, label);
    assert.match(problems.join('; '), why, `${label}: ${problems.join('; ')}`);
  }
});

test('R4: record fields are compared by name, so declaring them in another order still agrees', () => {
  const reordered = copy(block);
  reordered.exports[0].result.fields.reverse();
  field(reordered.exports[0].args[1], 'probe').codes = { 1: ' return AIR ', 0: 'Supply air' };
  assert.deepEqual(capabilityAgreement(reordered, glue), []);
});

const contractWith = capability => `A temperature log over records, lists and text.\n\n\`\`\`capability\n${JSON.stringify(capability)}\n\`\`\`\n`;
const logTests = [{ name: 'record a reading', fn: 'record', args: [{}, {}], expect: {} }, { name: 'full', fn: 'record', args: [{}, {}], expectError: true }, { name: 'mean', fn: 'mean', args: [{}], expect: 0 }];
const missing = [
  ['a record result without fields', b => { delete b.exports[0].result.fields; }, /record result of kind record needs fields/],
  ['a record argument with empty fields', b => { b.exports[0].args[1].fields = []; }, /argument (?:2 \(event\)|event) of kind record needs fields/],
  ['a nested list without max', b => { delete field(b.exports[0].result, 'history').max; }, /result\.history of kind list needs max/],
  ['a nested list with max beyond the bound', b => { field(b.exports[0].result, 'history').max = 5000; }, /result\.history of kind list needs max/],
  ['a nested list without items', b => { delete field(b.exports[0].result, 'history').items; }, /result\.history of kind list needs items/],
  ['a text two levels down without maxBytes', b => { delete field(field(b.exports[0].result, 'latest'), 'tag').maxBytes; }, /result\.latest\.tag of kind text needs maxBytes/],
  ['a text inside list items without maxBytes', b => { delete field(field(b.exports[1].args[0], 'history').items, 'tag').maxBytes; }, /\.history\[\]\.tag of kind text needs maxBytes/],
  ['a nested number field without a unit', b => { delete field(b.exports[0].result, 'meanTemperature').unit; }, /result\.meanTemperature needs a unit/],
  ['a nested field without a kind', b => { delete field(field(b.exports[0].result, 'latest'), 'temperature').kind; }, /result\.latest\.temperature kind must be one of/],
  ['a nested code field without codes', b => { delete field(b.exports[0].args[1], 'probe').codes; }, /\.probe of kind code needs a codes table/],
  ['a nested field without a name', b => { delete field(b.exports[0].args[1], 'probe').name; }, /needs a name/],
  ['a record that names one field twice', b => { b.exports[0].args[1].fields.push({ name: 'tag', kind: 'text', maxBytes: 8 }); }, /declares field tag twice/],
];
const shallowed = change => { const value = copy(block); change(value); return value; };
const shallow = { exports: [
  { name: 'record', args: [{ name: 'state', kind: 'record' }, { name: 'event', kind: 'record' }], result: { kind: 'record' } },
  { name: 'mean', args: [{ name: 'state', kind: 'list' }], result: { kind: 'text' } },
], traps: ['record'] };

test('S2: the freeze accepts a structured capability block that declares its whole layout', () => {
  assert.deepEqual(capabilityProblems(contractWith(block), logTests), []);
});

test('S2: the freeze refuses a record, list or text value, at any depth, that does not declare its layout', () => {
  for (const [label, change, why] of missing) assert.match(capabilityProblems(contractWith(shallowed(change)), logTests).join('; '), why, label);
  const problems = capabilityProblems(contractWith(shallow), logTests).join('; ');
  for (const why of [/record argument state of kind record needs fields/, /record argument event of kind record needs fields/, /record result of kind record needs fields/, /mean argument state of kind list needs max/, /mean argument state of kind list needs items/, /mean result of kind text needs maxBytes/]) assert.match(problems, why);
});

test('S2: G7 refuses glue against a frozen block that names a structured kind without its layout, even when glue declares it', () => {
  const blockless = copy(shallow);
  blockless.exports[1] = copy(block.exports[1]);
  blockless.exports[1].args[0] = { name: 'state', kind: 'record' };
  const problems = capabilityAgreement(blockless, glue).join('; ');
  for (const why of [/record argument 1 \(state\) of kind record needs fields/, /record argument 2 \(event\) of kind record needs fields/, /record result of kind record needs fields/, /mean argument 1 \(state\) of kind record needs fields/]) {
    assert.match(problems, new RegExp(`the capability block does not declare the layout: ${why.source}`));
  }
  for (const [label, change, why] of missing) {
    const found = capabilityAgreement(shallowed(change), glue).join('; ');
    assert.match(found, /the capability block does not declare the layout/, label);
    assert.match(found, why, label);
  }
});

test('S2: every prompt that asks for the capability block asks for the layout of records, lists and text', () => {
  for (const word of ['record, list or text', '"fields"', '"items"', '"max"', '"maxBytes"', 'at every depth']) assert.ok(capabilityRule.includes(word), word);
  assert.ok(JSON.parse(stagePrompts.specification({ need: 'n', id: 'n' })).instructions.includes(capabilityRule));
  assert.ok(JSON.parse(stagePrompts.specification({ need: 'n', id: 'n', oracle: true })).instructions.includes(capabilityRule));
  assert.match(JSON.parse(stagePrompts.implementation({ id: 'n' })).instructions, /nested layout \(record fields, list items and max, text maxBytes\)/);
});

test('S2: the Codex prompts ask for the layout in the block and in glue.json', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-gaps8-layout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const record = join(root, 'record');
  await generate({ need: 'integer add(a,b)', directory: join(root, 'run'), freeze: async () => ({ identity: 'evr:x', digest: 'd' }),
    env: { ...process.env, CODEX_HOME: join(root, 'unused-home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_LOOP: 'current', ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fixture('fake-codex.mjs')]),
      ENDOFORGE_ASC_CMD: fixture('fake-asc.mjs'), FAKE_CODEX_KERNEL: good.kernel, FAKE_CODEX_GLUE: good.glue, FAKE_CODEX_RECORD: record } });
  assert.ok(JSON.parse(readFileSync(`${record}.specification.json`, 'utf8')).instructions.includes(capabilityRule));
  assert.match(JSON.parse(readFileSync(`${record}.implementation.json`, 'utf8')).instructions, /nested layout \(record fields, list items and max, text maxBytes\)/);
});

test('S2: the library key and binding include the nested layout, so nested drift between a need and an entry misses', () => {
  const keys = capability => keysOf(capability, 'A temperature log.');
  assert.deepEqual(binding(block, block), { record: 'record', mean: 'mean' });
  const drifts = [
    ['a nested unit', b => { field(b.exports[0].result, 'meanTemperature').unit = 'F'; }],
    ['a nested unit two levels down', b => { field(field(b.exports[0].result, 'latest'), 'temperature').unit = 'F'; }],
    ['a list item unit in an argument', b => { field(field(b.exports[1].args[0], 'history').items, 'temperature').unit = 'F'; }],
    ['a nested precision', b => { field(field(b.exports[0].result, 'history').items, 'temperature').precision = 2; }],
    ['a nested range', b => { field(b.exports[0].args[1], 'temperature').range = '-40..150'; }],
    ['a list bound', b => { field(b.exports[0].result, 'history').max = 9; }],
    ['a text bound', b => { field(field(b.exports[0].result, 'latest'), 'tag').maxBytes = 32; }],
    ['a nested kind', b => { field(b.exports[0].result, 'meanTemperature').kind = 'integer'; }],
    ['nested code labels', b => { field(b.exports[0].args[1], 'probe').codes = { 0: 'Return air', 1: 'Supply air' }; }],
    ['a renamed field', b => { field(b.exports[0].args[1], 'temperature').name = 'temperatureF'; }],
    ['an added field', b => { b.exports[0].result.fields.push({ name: 'count', kind: 'integer', unit: '1' }); }],
    ['a dropped field', b => { b.exports[0].result.fields.pop(); }],
  ];
  for (const [label, change] of drifts) {
    const other = shallowed(change);
    for (const mode of ['interface', 'contract', 'prose']) assert.notEqual(keys(other)[mode], keys(block)[mode], `${label} ${mode}`);
    assert.equal(binding(block, other), null, label);
    assert.equal(binding(other, block), null, label);
  }
  const reordered = copy(block);
  reordered.exports[0].result.fields.reverse();
  assert.deepEqual(keys(reordered), keys(block));
  assert.deepEqual(binding(reordered, block), { record: 'record', mean: 'mean' });
});

test('S2: a scalar capability keeps the library key it had before the nested layout was keyed', () => {
  const capability = { exports: [
    { name: 'shippingCents', args: [{ name: 'grams', kind: 'integer', unit: 'g', range: '0..30000' }, { name: 'zone', kind: 'code', unit: '1', codes: { 1: 'Domestic', 2: 'International' } }], result: { kind: 'integer', unit: 'cents' } },
    { name: 'insured', args: [{ name: 'value', kind: 'number', unit: 'USD' }], result: { kind: 'boolean', unit: '1', labels: { true: 'Insured', false: 'Not insured' } } },
  ], traps: ['shippingCents'] };
  assert.deepEqual(keysOf(capability, 'Shipping costs 500 cents plus 2 cents per gram.'), {
    interface: '9cc9b136100b47c69eb3b963609b26bc5294107b48ce19a242a6307bde4e2645',
    contract: '48dcd0b37e05772dbed63ae590c04e71aec3b6fa6c14cd31b4ec95dcaba5991b',
    prose: 'b8cbe7cb222f8ffd3db98ef311ed04f0558dfcdfdb59e79f8d15990f239a97c6',
  });
});

const invoice = { kind: 'record', fields: [{ name: 'amount', kind: 'number', unit: 'USD' }, { name: 'paid', kind: 'boolean', unit: '1' }] };
const invoiceBlock = result => ({ exports: [{ name: 'bill', args: [{ name: 'order', ...copy(invoice) }], result }], traps: [] });
const invoiceContract = result => contractWith(invoiceBlock(result));
const invoiceTests = [{ name: 'bill an order', fn: 'bill', args: [{}], expect: {} }];
const unlabelled = [
  ['a record result field of kind number without precision', copy(invoice), /bill result\.amount of kind number in a result needs precision/],
  ['a record result field of kind boolean without labels', copy(invoice), /bill result\.paid of kind boolean in a result needs labels/],
  ['a list result item of kind number without precision', { kind: 'list', max: 4, items: { kind: 'number', unit: 'USD' } }, /bill result\[\] of kind number in a result needs precision/],
  ['a number two levels down in a result without precision', { kind: 'list', max: 4, items: copy(invoice) }, /bill result\[\]\.amount of kind number in a result needs precision/],
  ['a nested result precision beyond 6', { kind: 'record', fields: [{ name: 'amount', kind: 'number', unit: 'USD', precision: 7 }] }, /result\.amount of kind number in a result needs precision/],
  ['nested result labels without a false label', { kind: 'record', fields: [{ name: 'paid', kind: 'boolean', unit: '1', labels: { true: 'Paid' } }] }, /result\.paid of kind boolean in a result needs labels/],
  ['a boolean result without labels', { kind: 'boolean', unit: '1' }, /bill result of kind boolean in a result needs labels/],
];
const labelled = { kind: 'record', fields: [{ name: 'amount', kind: 'number', unit: 'USD', precision: 2 }, { name: 'paid', kind: 'boolean', unit: '1', labels: { true: 'Paid', false: 'Unpaid' } }] };

test('S2: the freeze refuses a structured result whose number or boolean leaves lack the precision or labels G7 requires, at every depth', () => {
  for (const [label, result, why] of unlabelled) {
    const problems = capabilityProblems(invoiceContract(result), invoiceTests).join('; ');
    assert.match(problems, why, `${label}: ${problems}`);
  }
  assert.deepEqual(capabilityProblems(invoiceContract(labelled), invoiceTests), []);
});

test('S2: the agent path refuses the same specification, so the model can still repair it before the freeze', () => {
  for (const [label, result, why] of unlabelled) {
    const refused = specificationProblems({ 'CONTRACT.md': invoiceContract(result), 'tests.json': JSON.stringify(invoiceTests) });
    assert.ok(refused, label);
    assert.match(refused.problems.join('; '), why, label);
  }
  assert.equal(specificationProblems({ 'CONTRACT.md': invoiceContract(labelled), 'tests.json': JSON.stringify(invoiceTests) }), null);
});

test('S2: every prompt that asks for the block or glue asks for precision and labels inside a structured result', () => {
  for (const word of ['inside a result, precision (0 to 6) when number', '"labels" with true and false strings when boolean']) assert.ok(capabilityRule.includes(word), word);
  assert.ok(glueRules.some(rule => /every number inside a record or list result at any depth, must include an integer precision/.test(rule)));
  assert.ok(glueRules.some(rule => /every boolean inside a record or list result at any depth, must include labels/.test(rule)));
  assert.ok(JSON.parse(stagePrompts.implementation({ id: 'n' })).glueRules.some(rule => /every number inside a record or list result/.test(rule)));
});

test('S2: an argument needs no precision or labels at any depth', () => {
  const block = invoiceBlock(labelled);
  assert.deepEqual(block.exports[0].args[0].fields.map(item => item.precision ?? item.labels ?? null), [null, null]);
  assert.deepEqual(capabilityProblems(contractWith(block), invoiceTests), []);
});

test('S2: a frozen block whose nested result leaves lack precision or labels is named as the reason G7 cannot pass', () => {
  const glued = { exports: [{ name: 'bill', args: [{ name: 'order', ...copy(invoice) }], result: copy(labelled) }], traps: [] };
  const problems = capabilityAgreement(invoiceBlock(copy(invoice)), glued).join('; ');
  assert.match(problems, /the capability block does not declare the layout: bill result\.amount of kind number in a result needs precision/);
  assert.match(problems, /the capability block does not declare the layout: bill result\.paid of kind boolean in a result needs labels/);
  assert.deepEqual(capabilityAgreement(invoiceBlock(copy(labelled)), glued), []);
});

test('S2: the freeze refuses a structured value whose buffer layout exceeds what G7 can lay out', () => {
  const huge = { kind: 'list', max: 4096, items: { kind: 'text', maxBytes: 65536 } };
  assert.match(capabilityProblems(invoiceContract(huge), invoiceTests).join('; '), /bill result has no buffer layout G7 can place: layout of \d+ bytes exceeds 1048576/);
  const glued = { exports: [{ name: 'bill', args: [{ name: 'order', ...copy(invoice) }], result: copy(huge) }], traps: [] };
  assert.match(capabilityAgreement(invoiceBlock(copy(huge)), glued).join('; '), /the capability block does not declare the layout: bill result has no buffer layout G7 can place/);
});
