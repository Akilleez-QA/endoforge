// Prompt compiler: atom prompts come from the manifest, never by hand.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileAtom, compileAll, excerpt } from '../lib/compile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(fs.readFileSync(path.join(HERE, '../fixtures', n), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'job-compile-'));
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const order = (s, ...parts) => { let at = -1; for (const p of parts) { const i = s.indexOf(p); assert(i > at, `"${p}" out of order or missing`); at = i; } };

test('an atom prompt runs goal verbatim → governing references → sources → checks → files → return format', () => {
  const p = compileAtom(fx('mrton.json'), 'CHAR', { offline: true });
  order(p, 'THE GOAL, in Craig\'s own words', '> code red, a collaborator video today', 'The brief:', 'READ AND LOOK AT THESE FIRST',
    'mr-btu governs model', 'Source script (primary) governs persona', 'Your checks', 'A2: a collaborator reads as Mr. BTU\'s older brother', 'You own ONLY these paths', 'Reply in exactly this form');
  assert.match(p, /Look at: \/mnt\/cold-steam\/factory-scratch\/mrton\/reference\/mr-btu\/closeups\/body-views.jpg/);
  assert.match(p, /Private: view locally, never copy it into git/); assert.match(p, /never claim a pass you did not see/);
  assert(!/lumberjack/i.test(p));
  const b = compileAtom(fx('mrton.json'), 'B1', { offline: true });
  assert.match(b, /Your contract can express: pose, camera, look, props/); assert.match(b, /A7: each beat stages the script's set-piece .* \(needs pose, camera, props\)/);
});
test('the as-briefed character atom would have compiled with no reference at all', () => {
  assert(!compileAtom(fx('mrton-as-briefed.json'), 'CHAR', { offline: true }).includes('READ AND LOOK AT THESE FIRST'));
});
test('sources are excerpted from disk: line ranges, matches with context, whole short files, a cap', () => {
  const f = path.join(tmp, 'script.md'); fs.writeFileSync(f, ['# Script', 'b1: Let me tell you about his big brother.', 'b2: He struts in.', 'b3: The compressor roars.', 'end'].join('\n'));
  assert.equal(excerpt({ path: f, excerpt: { lines: '2-3' } }), 'b1: Let me tell you about his big brother.\nb2: He struts in.');
  assert.equal(excerpt({ path: f, excerpt: { match: 'compressor', context: 1 } }), 'b2: He struts in.\nb3: The compressor roars.\nend');
  assert.match(excerpt({ path: f }), /^# Script/); assert.equal(excerpt({ path: f }, { offline: true }), null);
  fs.writeFileSync(path.join(tmp, 'big.md'), 'x'.repeat(9000)); assert.match(excerpt({ path: path.join(tmp, 'big.md') }), /excerpt cut at 6000/);
  const j = fx('mrton.json'); j.sources[0].path = f; j.sources[0].excerpt = { lines: '2-2' };
  assert.match(compileAtom(j, 'B1'), /<<<script\nb1: Let me tell you about his big brother.\nscript>>>/);
});
test('contracts, seams, findings, stills and matching lessons reach the atom', () => {
  const j = fx('mrton.json');
  const p = compileAtom(j, 'B1', { round: 2, outputs: ['/r/16x9/f00000.png'], found: [{ level: 'HARD', rule: 'MT-04', detail: 'hidden behind the rack', frames: ['16x9/f00'] }],
    lessons: [{ text: 'staging hid the hero behind the rack', fix: 'check occlusion', key: 'k' }, { text: 'unrelated', key: 'u' }] });
  assert.match(p, /series\/rai-reta\/game\/stage.ts \(frozen\)/); assert.match(p, /b1-b2-cut between B1 and B2: owned by SEAMS; report problems/);
  assert.match(p, /\[HARD MT-04\] hidden behind the rack \(frames 16x9\/f00\)/); assert.match(p, /\/r\/16x9\/f00000.png/);
  assert.match(p, /staging hid the hero behind the rack → check occlusion/); assert(!p.includes('unrelated'));
});
test('compileAll hashes the prompt set; a changed goal changes the hash', () => {
  const a = compileAll(fx('mrton.json'), { offline: true }), j = fx('mrton.json'); j.goal.verbatim += '!';
  assert.equal(Object.keys(a.prompts).length, 5); assert.match(a.manifestHash, /^[0-9a-f]{64}$/);
  assert.equal(compileAll(fx('mrton.json'), { offline: true }).manifestHash, a.manifestHash);
  assert.notEqual(compileAll(j, { offline: true }).manifestHash, a.manifestHash);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all compile tests passed');
process.exit(fails ? 1 : 0);
