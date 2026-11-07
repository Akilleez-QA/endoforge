export const GLOBAL_SCOPE = Object.freeze([
  'declare var Symbol: number;',
  'let Symbol = 1;',
  'interface Array<T> { length: string }',
  'type PropertyKey = number;',
  'interface ArrayLike<T> { readonly length: string }',
  'declare class Promise<T> {}',
  'interface Object { constructor: number }',
  'interface Iterator<T> { next(): number }',
  'type Partial<T> = T;',
  'interface Number { toFixed: string }',
  'interface ObjectConstructor { new(): number }',
  'declare global { type Partial<T> = T; }',
  'declare global { interface Boolean { valueOf(): string } }',
  'declare global { interface SymbolConstructor { readonly iterator: number } }',
  'interface SymbolConstructor { readonly iterator: number }',
  'declare var NaN: string;',
  'interface Function { apply: number }',
  'interface Array<T> { [n: number]: string }',
  'interface ReadonlyArray<T> { length: string }',
  'interface PromiseLike<T> { then: number }',
  'type Record<K, T> = string;',
  'interface String { [Symbol.iterator]: number }',
  '/// <reference lib="dom" />\nconst element: HTMLElement | null = null;',
  '/// <reference no-default-lib="true"/>\nconst n = 1;',
  '/// <reference types="node" />\nconst p = process.pid;',
]);

const ADD = 'function add(a: i32, b: i32): i32 { return a + b; }';

export const globalScopeKernels = () => GLOBAL_SCOPE.flatMap((source, index) => [
  { name: `global-${index}:script`, kernel: `${source}\n${ADD}\n` },
  { name: `global-${index}:module`, kernel: `${source}\nexport ${ADD}\n` },
]);
