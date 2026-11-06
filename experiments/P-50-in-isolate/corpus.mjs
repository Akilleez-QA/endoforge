import { readFileSync } from 'node:fs';
import { compile, x1Flags } from '../assemblyscript-toolchain.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { ASC_PATH } from '../../tools/asc/pin.mjs';
import { installWasmLimit } from '../../core/runtime/isolate-wasm.mjs';
import { trustedWasmModules } from '../assemblyscript-toolchain.mjs';

const kernels = new URL('../P-15-workcell-concurrency/kernels/', import.meta.url);
const addSource = 'export function add(a:i32,b:i32):i32{return a+b}';
const contract = name => `Synthetic ${name}: exported numeric functions, with golden tests taken once from this kernel.`;
const exportsOf = source => [...source.matchAll(/export function (\w+)\(([^)]*)\)\s*:\s*(\w+)/g)].map(([, name, args, result]) => ({ name,
  args: args.split(',').map(arg => arg.trim()).filter(Boolean).map(arg => { const [argument, type] = arg.split(':').map(part => part.trim()); return { name: argument, type }; }), result }));
const argumentSets = [[0, 0, 0, 0, 0, 0], [1, 2, 3, 4, 5, 6], [3, 1, 0, 2, 1, 4]];
function glueFor(name, functions, traps) {
  return JSON.stringify({ id: name, assumption: 'Synthetic kernel with unit-free numeric inputs.', question: 'Do these synthetic exports return their golden values?',
    exports: functions.map(fn => ({ name: fn.name, label: `Call ${fn.name}`, args: fn.args.map(arg => ({ name: arg.name, kind: /^f/.test(arg.type) ? 'number' : 'integer', unit: '1' })),
      result: /^f/.test(fn.result) ? { kind: 'number', unit: '1', precision: 6 } : { kind: 'integer', unit: '1' } })),
    traps: [...traps].map(fn => ({ fn, when: 'inputs are outside its memory', message: 'Inputs are outside the supported range.' })) });
}
async function entry(name, source, sibling) {
  installWasmLimit(4096, error => { throw new Error(error); }, trustedWasmModules);
  const shape = sibling ?? source, functions = exportsOf(shape), usable = functions.filter(fn => !fn.args.some(arg => /64$/.test(arg.type) && !/^f/.test(arg.type)));
  const bytes = await compile({ name: 'kernel', source: shape }, ASC_PATH, { flags: x1Flags });
  if (!bytes) throw Error(`${name}: corpus kernel does not compile`);
  const module = new WebAssembly.Module(bytes), tests = [], traps = new Set();
  const instance = new WebAssembly.Instance(module, { env: { abort() { throw new Error('abort'); } } });
  for (const fn of usable) for (const [index, values] of argumentSets.entries()) {
    const args = values.slice(0, fn.args.length), test = { name: `${fn.name}-${index}`, fn: fn.name, args };
    try {
      const raw = instance.exports[fn.name](...args);
      const value = typeof raw === 'bigint' ? raw.toString() : raw;
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      tests.push(typeof value === 'number' && !Number.isInteger(value) ? { ...test, expect: value, tol: 1e-9 } : { ...test, expect: value });
    } catch { traps.add(fn.name); tests.push({ ...test, expectError: true }); }
  }
  return { name, contract: contract(name), kernel: source, tests: JSON.stringify(tests), glue: glueFor(name, functions, traps), expectPromoted: !sibling };
}
export async function buildCorpus() {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', kernels))), corpus = [];
  corpus.push(await entry('add', addSource));
  for (const kernel of manifest) {
    const source = readFileSync(new URL(`${kernel.name}.ts`, kernels), 'utf8');
    if (hash(source) !== kernel.sha256) throw Error(`${kernel.name}: kernel digest differs`);
    corpus.push(await entry(kernel.name, source, kernel.expectTypeError ? readFileSync(new URL(`${manifest[manifest.indexOf(kernel) - 1].name}.ts`, kernels), 'utf8') : null));
  }
  return corpus;
}
