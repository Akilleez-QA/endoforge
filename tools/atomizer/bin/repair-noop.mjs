#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const USAGE = 'usage: repair-noop.mjs --failures <failures.json> --map \'<json [{"from","to"}]>\'  (exit 0: parts copied; 10: model repair needed; 2: bad arguments)';
const refuse = (why) => { console.error(`${why}\n${USAGE}`); process.exit(2); };
const A = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
  if (a !== '--failures' && a !== '--map') refuse(`unknown argument ${a}`);
  const v = process.argv[++i];
  if (v == null || v.startsWith('--')) refuse(`${a} needs a value`);
  A[a.slice(2)] = v;
}
for (const k of ['failures', 'map']) if (!A[k]) refuse(`missing --${k}`);
let map; try { map = JSON.parse(A.map); } catch (e) { refuse(`--map is not JSON: ${e.message}`); }
if (!Array.isArray(map) || !map.every((m) => m && typeof m.from === 'string' && typeof m.to === 'string' && m.from && m.to)) refuse('--map must be a JSON list of {"from","to"} paths');
let failures; try { failures = JSON.parse(fs.readFileSync(A.failures, 'utf8')); } catch (e) { console.error(`no readable failures.json: ${e.message}`); process.exit(10); }
if (!Array.isArray(failures) || failures.length) { console.error(`${failures.length ?? '?'} failing tests: model repair needed`); process.exit(10); }
for (const m of map) { fs.mkdirSync(path.dirname(m.to), { recursive: true }); fs.copyFileSync(m.from, m.to); }
fs.writeFileSync('/out/repair-notes.md', 'No gate failed in the draft (failures.json is empty). Every kernel part copied unchanged by the script fast path; no model was called.\n');
console.log('no-op repair: parts copied');
