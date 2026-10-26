// The proofs the gates need, made by the tool: the smoke receipt (I9) and the split proof against a measured noise
// floor (I6; NOTES #19: render the baseline twice, a split is a no-op when its diff is within that noise).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from '../lib/validate.mjs';
import { loadJob } from '../bin/job.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), BIN = path.join(HERE, '../bin/job.mjs');
const fx = (n) => JSON.parse(fs.readFileSync(path.join(HERE, '../fixtures', n), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'job-proofs-'));
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const home = path.join(tmp, 'home');
for (const p of ['.codex/auth.json', '.claude-accts/a1/.credentials.json']) { fs.mkdirSync(path.dirname(path.join(home, p)), { recursive: true }); fs.writeFileSync(path.join(home, p), ''); }
const stub = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return p; };
const env = { ...process.env, HOME: home, ENDOFORGE_NOTIFY: 'none', ENDOFORGE_JOBS: path.join(tmp, 'none') };
for (const k of Object.keys(env)) if (k.startsWith('CODEX_POOL_') || k === 'ENDOFORGE_CLAUDE_ACCOUNTS') delete env[k];
const cli = (...a) => spawnSync(process.execPath, [BIN, ...a], { env, encoding: 'utf8' });
const setup = (name, edit = () => {}) => { const d = path.join(tmp, name); fs.mkdirSync(d); const j = fx('mrton.json'); edit(j, d); const f = path.join(d, 'job.json'); fs.writeFileSync(f, JSON.stringify(j)); return f; };

test('smoke runs one atom per engine and records the receipt the Decide gate needs', () => {
  const ok = stub('ok.sh', 'echo READY');
  const f = setup('smoke-ok', (j) => { delete j.proofs.smoke; j.fanout = { codexPool: ok, claudeBin: ok }; });
  const r = cli('smoke', f); assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = loadJob(f); assert.deepEqual(j.proofs.smoke.engines, { claude: true, codex: true }); assert(fs.existsSync(j.proofs.smoke.receipt));
  assert(!validate(j, { gate: 'decide', offline: true, confirmation: { ok: true } }).errors.some((e) => e.inv === 'I9'));
  assert.match(fs.readFileSync(path.join(path.dirname(f), 'events.jsonl'), 'utf8'), /"kind":"SMOKE"/);
});
test('a failed smoke is recorded as failed and the Decide gate refuses (I9)', () => {
  const bad = stub('bad.sh', 'echo nope; exit 4');
  const f = setup('smoke-bad', (j) => { delete j.proofs.smoke; j.fanout = { codexPool: bad, claudeBin: stub('ok2.sh', 'echo READY') }; });
  assert.equal(cli('smoke', f).status, 1);
  const v = validate(loadJob(f), { gate: 'decide', offline: true, confirmation: { ok: true } });
  assert(v.errors.some((e) => e.inv === 'I9' && /no smoke receipt for codex/.test(e.msg)));
});
test('prove-split measures the noise floor from a second baseline render and passes a diff within it', () => {
  const py = `import sys, os; from PIL import Image
for d, px in (("A", 10), ("C", 11), ("B", 11), ("X", 40)):
    os.makedirs(sys.argv[1] + "/" + d, exist_ok=True); im = Image.new("RGB", (8, 8), (10, 20, 30)); im.putpixel((2, 2), (px, 20, 30)); im.save(sys.argv[1] + "/" + d + "/f0.png")`;
  assert.equal(spawnSync('python3', ['-c', py, tmp]).status, 0);
  const proof = path.join(tmp, 'split', 'proof.json');
  const f = setup('split', (j) => { j.splits[0].proof = proof; delete j.splits[0].proofResult; });
  const P = (...a) => cli('prove-split', f, '--from', 'series/rai-reta/game/l1-mr-ton.ts', ...a);
  assert.equal(P('--before', path.join(tmp, 'A'), '--after', path.join(tmp, 'B')).status, 1, 'a 1/255 diff fails without a measured floor');
  const ok = P('--before', path.join(tmp, 'A'), '--after', path.join(tmp, 'B'), '--noise', path.join(tmp, 'C'));
  assert.equal(ok.status, 0, ok.stdout); assert.match(ok.stdout, /no-op \(noise floor 1\)/);
  assert.equal(validate(loadJob(f), { gate: 'orient', volatile: ['/nonexistent'], offline: false }).errors.filter((e) => e.inv === 'I6').length, 0);
  assert.equal(P('--before', path.join(tmp, 'A'), '--after', path.join(tmp, 'X'), '--noise', path.join(tmp, 'C')).status, 1, 'a real change stays above the noise');
  fs.writeFileSync(proof, JSON.stringify({ ok: true, kind: 'pixels', noiseFloor: 0, noiseMeasured: false }));
  assert(validate(loadJob(f), { gate: 'orient', volatile: ['/nonexistent'] }).errors.some((e) => e.inv === 'I6'));
});
test('a code split is proven by its tests', () => {
  const f = setup('tests-split', (j, d) => { j.kind = 'code'; j.repo = d; j.splits[0].proof = path.join(d, 'split.json'); });
  assert.equal(cli('prove-split', f, '--from', 'series/rai-reta/game/l1-mr-ton.ts', '--tests', 'true').status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(f), 'split.json'), 'utf8')).kind, 'tests');
  assert.equal(cli('prove-split', f, '--from', 'series/rai-reta/game/l1-mr-ton.ts', '--tests', 'false').status, 1);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all proofs tests passed');
process.exit(fails ? 1 : 0);
