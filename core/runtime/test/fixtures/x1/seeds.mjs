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
