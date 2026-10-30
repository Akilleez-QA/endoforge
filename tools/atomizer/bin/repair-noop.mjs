#!/usr/bin/env node
// Preflight for the repair atom: when the draft's failures.json is empty, copy every kernel part to its declared output unchanged and exit 0; otherwise exit 10 so the model repair runs.
// usage: node repair-noop.mjs --failures /in/<draft>/failures.json --map '<json [{"from":"/in/k/x.ts","to":"/out/x.ts"}]>'
import fs from 'node:fs';
import path from 'node:path';
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
let failures; try { failures = JSON.parse(fs.readFileSync(arg('failures'), 'utf8')); } catch (e) { console.error(`no readable failures.json: ${e.message}`); process.exit(10); }
if (!Array.isArray(failures) || failures.length) { console.error(`${failures.length ?? '?'} failing tests: model repair needed`); process.exit(10); }
for (const m of JSON.parse(arg('map'))) { fs.mkdirSync(path.dirname(m.to), { recursive: true }); fs.copyFileSync(m.from, m.to); }
fs.writeFileSync('/out/repair-notes.md', 'No gate failed in the draft (failures.json is empty). Every kernel part copied unchanged by the script fast path; no model was called.\n');
console.log('no-op repair: parts copied');
