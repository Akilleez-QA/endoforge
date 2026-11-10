import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityAgreement } from '../x1/contract.mjs';

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

test('R4: a block that names a structured kind without declaring its layout still agrees with glue that declares it', () => {
  const shallow = { exports: [
    { name: 'record', args: [{ name: 'state', kind: 'record' }, { name: 'event', kind: 'record' }], result: { kind: 'record' } },
    { name: 'mean', args: [{ name: 'state', kind: 'record' }], result: { kind: 'number', unit: 'C', precision: 1 } },
  ], traps: ['record'] };
  assert.deepEqual(capabilityAgreement(shallow, glue), []);
  assert.match(capabilityAgreement(shallow, drift(g => { g.exports[0].result = { kind: 'list', max: 8, items: reading }; })).join(), /record result kind/);
});
