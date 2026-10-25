#!/usr/bin/env node
// Run a capability from any artefact directory:  node bin/try.mjs <dir> <fn> <args…>   (no fn: list the exports)
// Adapted from campaigns/x1-spec-study/factory/try.mjs (loop 0) to take a directory instead of an id; same rendering:
// the value at field precision with its unit (or the label of a boolean/code), then the assumption, the note and the
// question; a trap prints the glue's message (the one matching the argument at fault when that can be told).
import fs from 'node:fs';
import path from 'node:path';
import { loadCapability, callRender } from '../lib/sheet.mjs';
const [dirArg, fn, ...args] = process.argv.slice(2);
if (!dirArg) { console.error('usage: try.mjs <dir> <fn> <args…>'); process.exit(2); }
const dir = path.resolve(dirArg);
const cap = loadCapability(dir);
if (!fn) { for (const e of cap.glue.exports) console.log(`${e.name}(${e.args.map((a) => `${a.name} [${a.unit}${a.kind === 'code' && a.codes ? ': ' + Object.entries(a.codes).map(([k, v]) => `${k}=${v}`).join(', ') : ''}]`).join(', ')}) -> ${e.result.unit}${e.headline ? '   [headline]' : ''}\n   ${e.label}`); process.exit(0); }
if (!cap.exportNames.includes(fn)) { console.error(`no export ${fn}; exports: ${cap.exportNames.join(', ')}`); process.exit(2); }
const r = callRender(cap, fn, args.map(Number));
console.log(r.text);
console.log(`assumption: ${cap.glue.assumption}`);
if (cap.glue.notes) console.log(`note: ${cap.glue.notes}`);
console.log(`question: ${cap.glue.question}`);
process.exit(r.trapped ? 1 : 0);
