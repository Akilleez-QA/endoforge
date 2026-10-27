// Interfaces quoted from source (P-C) and facts that live once (P-A).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../lib/validate.mjs';
import { compileAtom } from '../lib/compile.mjs';
import { interfaceText, imports, select, duplicatedFacts } from '../lib/sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'job-sources-'));
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), t); };
put('lib/shared.mjs', '// the contract\nexport function piece(opts) {\n  return { at: opts.at, dur: opts.dur };\n}\nexport const OTHER = 1;\n');
put('parts/a.mjs', "import { piece } from '../lib/shared.mjs';\nexport default piece({ at: 7.2, dur: 1 });\n");
put('parts/b.mjs', "import { piece } from '../lib/shared.mjs';\nimport timing from '../timing.json';\nexport default piece({ at: timing.items[1].start, dur: 1 });\n");
put('timing.json', JSON.stringify({ items: [{ start: 7.2 }, { start: 14.6 }] }));
// The a collaborator fixture is used only for its well-formed shape; its atoms are pointed at the scratch files above.
function job(edit = () => {}) {
  const j = JSON.parse(fs.readFileSync(path.join(HERE, '../fixtures/mrton.json'), 'utf8'));
  j.repo = tmp; j.atoms = j.atoms.filter((a) => ['B1', 'B2'].includes(a.id));
  j.atoms[0].files = ['parts/a.mjs']; j.atoms[1].files = ['parts/b.mjs'];
  for (const a of j.atoms) delete a.reads;
  j.criticalPath = 'B1'; j.criteria = j.criteria.map((c) => ({ ...c, satisfiedBy: (c.satisfiedBy ?? []).filter((x) => ['B1', 'B2'].includes(x)) })).filter((c) => !c.satisfiedBy || c.satisfiedBy.length || c.check?.kind === 'human');
  j.seams = []; j.splits = []; j.contracts = [{ path: 'lib/shared.mjs', owner: 'frozen' }];
  edit(j); return j;
}
const orient = (j) => validate(j, { gate: 'orient', volatile: ['/nonexistent'] });

test('an interface is quoted verbatim from its file, from the start match to the closing line', () => {
  assert.equal(interfaceText({ repo: tmp }, { file: 'lib/shared.mjs', start: '^export function piece' }), 'export function piece(opts) {\n  return { at: opts.at, dur: opts.dur };\n}');
  assert.equal(interfaceText({ repo: tmp }, { file: 'lib/shared.mjs', start: 5 , end: 5 }), 'export const OTHER = 1;');
  assert.equal(interfaceText({ repo: tmp }, { file: 'lib/shared.mjs', start: '^export class' }), null);
  assert(imports({ repo: tmp }, { files: ['parts/a.mjs'] }, 'lib/shared.mjs'));
});
test('P-C: an atom that imports a contract with no interface quoting it is refused (I2); with one, it passes', () => {
  assert(orient(job()).errors.some((e) => e.inv === 'I2' && /atom B1 imports contract lib\/shared.mjs but no interface quotes it/.test(e.msg)));
  const ok = job((j) => { j.interfaces = [{ id: 'piece', file: 'lib/shared.mjs', start: '^export function piece', what: 'how a part is declared' }]; });
  assert(!orient(ok).errors.some((e) => /imports contract|interface/.test(e.msg)), JSON.stringify(orient(ok).errors));
  const bad = job((j) => { j.interfaces = [{ id: 'piece', file: 'lib/shared.mjs', start: '^export class Nope' }]; });
  assert(orient(bad).errors.some((e) => /interface piece: lib\/shared.mjs has no excerpt/.test(e.msg)));
});
test('P-C: the compiled prompt carries the interface source verbatim', () => {
  const j = job((x) => { x.interfaces = [{ id: 'piece', file: 'lib/shared.mjs', start: '^export function piece', what: 'how a part is declared' }]; });
  assert.match(compileAtom(j, 'B1'), /INTERFACES, verbatim from the source files .*\n<<<piece \(lib\/shared.mjs\): how a part is declared\nexport function piece\(opts\) \{\n  return \{ at: opts.at, dur: opts.dur \};\n\}\npiece>>>/);
});
test('P-A: a fact copied from its source into an owned file is a warning; a derived one is not', () => {
  assert.deepEqual(select({ items: [{ start: 1 }, { start: 2 }] }, 'items[*].start'), [1, 2]);
  const j = job((x) => { x.facts = [{ id: 'timing', source: 'timing.json', select: 'items[*].start' }]; });
  assert.deepEqual(duplicatedFacts(j), [{ fact: 'timing', atom: 'B1', file: 'parts/a.mjs', values: ['7.2'], count: 1 }]);
  assert(orient(j).warnings.some((w) => w.inv === 'I5' && /fact timing is copied into parts\/a.mjs \(atom B1: 7.2\); derive it from its source/.test(w.msg)));
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all sources tests passed');
process.exit(fails ? 1 : 0);
