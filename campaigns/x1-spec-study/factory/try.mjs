#!/usr/bin/env node
// Run a promoted capability:  node factory/try.mjs <id> <fn> <args…>
// Renders through work/factory/<id>/glue.json when it exists: the value at field precision with its unit (or the label of
// a boolean/code), then the assumption, the note and the question; a trap prints the glue's message instead of a wasm stack.
// Pass --raw to print the bare number as the kernel returned it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const raw = argv.includes('--raw');
const [id, fn, ...args] = argv.filter(a => a !== '--raw');
if (!id || !fn) { console.error('usage: try.mjs <id> <fn> <args…> [--raw]'); process.exit(2); }
const dir = path.join(KIT, 'work', 'factory', id);
const bytes = fs.readFileSync(path.join(dir, 'kernel.wasm'));
const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, { env: { abort: () => { throw new Error('kernel aborted (contract says this input is invalid)'); } } });
if (typeof inst.exports[fn] !== 'function') { console.error(`no export ${fn}; exports: ${Object.keys(inst.exports).join(', ')}`); process.exit(2); }
const glue = fs.existsSync(path.join(dir, 'glue.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'glue.json'), 'utf8')) : null;
const spec = glue?.exports.find(x => x.name === fn) ?? null;
let out;
try { out = inst.exports[fn](...args.map(Number)); }
catch (e) {
  if (raw || !glue) { console.error(String(e.message || e)); process.exit(1); }
  const traps = glue.traps.filter(t => t.fn === fn);
  console.log(`refused: ${traps.length ? traps.map(t => `${t.message} (when ${t.when})`).join(' / ') : 'invalid input for this function (no trap message recorded)'}`);
  process.exit(1);
}
if (raw || !spec) { console.log(String(out)); process.exit(0); }
const r = spec.result;
let shown;
if (r.kind === 'boolean') shown = out ? r.labels.true : r.labels.false;
else if (r.kind === 'code') shown = `${out} = ${r.codes[String(out)] ?? 'unlabelled code'}`;
else if (r.kind === 'integer') shown = `${out} ${r.unit}`;
else shown = `${Number(out).toFixed(r.precision)} ${r.unit}`;
const argLine = spec.args.map((a, i) => `${a.name} = ${args[i]}${a.kind === 'code' ? ` (${a.codes?.[String(Number(args[i]))] ?? '?'})` : a.unit && a.unit !== 'code' ? ` ${a.unit}` : ''}`).join(', ');
console.log(`${fn}(${argLine}) -> ${shown}`);
console.log(`assumption: ${glue.assumption}`);
if (glue.notes) console.log(`note: ${glue.notes}`);
console.log(`question: ${glue.question}`);
