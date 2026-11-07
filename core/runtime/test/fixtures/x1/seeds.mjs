const add = 'export function add(a:i32,b:i32):i32{return a+b}';
const glue = names => JSON.stringify({ id: 'x', assumption: 'Inputs are integers from minus ten to ten.', question: 'Are integer inputs within this range sufficient?',
  exports: names.map(name => ({ name, label: `Call ${name}`, args: ['a', 'b'].map(arg => ({ name: arg, kind: 'integer', unit: '1' })), result: { kind: 'integer', unit: '1' } })), traps: [] });
export const good = { name: 'good', kernel: add, glue: glue(['add']) };
export const seeds = [
  { name: 'type-error', kernel: 'export function add(a:i32,b:i32):i32{return a+"x"}', glue: glue(['add']) },
  { name: 'wrong-answer', kernel: 'export function add(a:i32,b:i32):i32{return a-b}', glue: glue(['add']) },
  { name: 'missing-export', kernel: 'export function other(a:i32,b:i32):i32{return a+b}', glue: glue(['other']) },
  { name: 'extra-import', kernel: '@external("env","escape") declare function escape():void;\nexport function add(a:i32,b:i32):i32{escape();return a+b}', glue: glue(['add']) },
  { name: 'invalid-glue', kernel: add, glue: JSON.stringify({ id: 'x' }) },
  { name: 'host-path-import', kernel: 'import {x} from "/etc/hostname";\nexport function add(a:i32,b:i32):i32{return a+b+x}', glue: glue(['add']) },
  { name: 'relative-host-import', kernel: 'import {createPort} from "../../../core/runtime/x1/host";\nexport function add(a:i32,b:i32):i32{return a+b}', glue: glue(['add']) },
  { name: 'always-traps', kernel: 'export function add(a:i32,b:i32):i32{unreachable();return a+b}', glue: glue(['add']) },
  { name: 'infinite-loop', kernel: 'export function add(a:i32,b:i32):i32{while(a==a){a=a^b;b=b^a}return a}', glue: glue(['add']), slow: true },
];
const glueFor = (name, args, result) => JSON.stringify({ id: 'x', assumption: 'Inputs are synthetic integers for this check.', question: 'Do these synthetic exports answer the question?',
  exports: [{ name, label: `Call ${name}`, args: args.map(arg => ({ name: arg, kind: 'integer', unit: '1' })), result: { kind: 'integer', unit: '1' } }], traps: [] });
export const weak = {
  'a wrong kernel under an unbounded tolerance': { tests: [{ name: 't', fn: 'add', args: [2, 3], expect: 5, tol: 1e308 }], kernel: seeds[1].kernel, glue: good.glue },
  'a test that asserts nothing': { tests: [{ name: 't', fn: 'add', args: [2, 3] }], kernel: 'export function add(a:i32,b:i32):void{}', glue: good.glue },
  'expectError met by a JavaScript type error, not a trap': { refusedAt: 'evaluation', tests: [{ name: 't', fn: 'add', args: [2, 3], expectError: true }], kernel: 'export function add(a:i64,b:i64):i64{return a-b}',
    glue: JSON.stringify({ ...JSON.parse(good.glue), traps: [{ fn: 'add', when: 'inputs are out of range', message: 'Out of range input.' }] }) },
  'expect as an array': { tests: [{ name: 't', fn: 'add', args: [2, 3], expect: [5] }], kernel: good.kernel, glue: good.glue },
  'expect that parses to infinity': { raw: '[{"name":"t","fn":"add","args":[2,3],"expect":1e400}]', kernel: 'export function add(a:i32,b:i32):f64{return 1.0/0.0}', glue: good.glue },
  'an integer expectation past exact range': { raw: '[{"name":"t","fn":"big","args":[],"expect":9007199254740993}]', kernel: 'export function big():i64{return 9007199254740993}', glue: glueFor('big', [], {}) },
};
