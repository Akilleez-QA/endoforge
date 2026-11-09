import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TOOLS = ['tools/job', 'tools/conductor', 'tools/atomizer', 'tools/hillclimb'];
const SKIP = new Set(['node_modules', 'ledger', 'test']);
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };

function sources(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.(mjs|js|sh|py)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('workflow tool sources cite only repository files that exist', () => {
  const missing = [];
  for (const tool of TOOLS) for (const f of sources(path.join(REPO, tool))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const [, ref] of text.matchAll(/(?:^|[\s(`'"])\.?\/?((?:docs|tools|sources|experiments)\/[\w.\/-]+\.(?:md|json))(?![\w])/gm)) {
      if (ref.includes('{') || ref.includes('*')) continue;
      if (!fs.existsSync(path.join(REPO, ref))) missing.push(`${path.relative(REPO, f)} -> ${ref}`);
    }
    for (const [, ref] of text.matchAll(/(?:Schema|see|See):? ([A-Z][A-Z0-9_-]*\.md)\b/g)) {
      if (!fs.existsSync(path.join(path.dirname(f), ref)) && !fs.existsSync(path.join(REPO, tool, ref))) missing.push(`${path.relative(REPO, f)} -> ${ref}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the job tool does not cite the deadline fan-out playbook, which this repository does not ship', () => {
  const cites = sources(path.join(REPO, 'tools/job')).filter((f) => fs.readFileSync(f, 'utf8').includes('PLAYBOOK-deadline-fanout'));
  assert.deepEqual(cites.map((f) => path.relative(REPO, f)), []);
});

if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('tool references: all passed');
