// Job intake tests: the validator suite, then the CLI (calibrate, gates), and the code and campus fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from '../lib/validate.mjs';
import { INVARIANTS, GATES } from '../lib/invariants.mjs';
import { calibrate } from '../bin/job.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), BIN = path.join(HERE, '../bin/job.mjs');
const fx = (n) => JSON.parse(fs.readFileSync(path.join(HERE, '../fixtures', n), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'job-test-'));
let fails = 0;
for (const t of ['validate.test.mjs', 'card.test.mjs', 'compile.test.mjs', 'events.test.mjs', 'proofs.test.mjs', 'sources.test.mjs']) { const r = spawnSync(process.execPath, [path.join(HERE, t)], { encoding: 'utf8' }); process.stdout.write(r.stdout); if (r.status !== 0) fails++; }
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const OK = { ok: true };
const at = (job, gate = 'orchestrate', o = {}) => validate(job, { gate, offline: true, health: OK, confirmation: OK, ...o });
const broken = (v) => Object.entries(v.status).filter(([, s]) => s === 'broken').map(([k]) => k);
const says = (v, inv, re) => v.errors.some((e) => e.inv === inv && re.test(e.msg));

test('the code job passes; without a tests criterion it is refused (I3)', () => {
  assert(at(fx('code-overlap-refactor.json')).ok, JSON.stringify(at(fx('code-overlap-refactor.json')).errors));
  const j = fx('code-overlap-refactor.json'); j.criteria = j.criteria.map((c) => ({ ...c, check: { ...c.check, kind: 'command' } }));
  assert(says(at(j), 'I3', /code: a code job needs a tests criterion/));
});
test('the campus job passes; without its truth package it is refused (I4)', () => {
  assert(at(fx('campus-compressor-hall.json')).ok, JSON.stringify(at(fx('campus-compressor-hall.json')).errors));
  const j = fx('campus-compressor-hall.json'); delete j.truth;
  assert.deepEqual(broken(at(j)), ['I4']);
  const k = fx('campus-compressor-hall.json'); k.truth = [{ id: 'guess', what: 'an artist impression', path: '/mnt/x', tolerance: '1 m' }];
  assert(says(at(k), 'I4', /survey evidence/));
  const s = fx('campus-compressor-hall.json'); delete s.criteria[0].check.baseline;
  assert(says(at(s), 'I3', /site-rules check with its ratchet baseline/));
});

// One writer, independent atoms, constraint focus.
test('FMEA H3 miscalibrated check: detection runs known-good and known-bad, and a check that passes both is refused', () => {
  const script = path.join(tmp, 'check.sh'); fs.writeFileSync(script, '#!/bin/sh\ngrep -q good "$1"\n', { mode: 0o755 });
  const lax = path.join(tmp, 'lax.sh'); fs.writeFileSync(lax, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const [n, t] of [['good.txt', 'good'], ['bad.txt', 'bad']]) fs.writeFileSync(path.join(tmp, n), t);
  const j = fx('mrton.json'); j.repo = tmp;
  j.criteria[0].check = { ...j.criteria[0].check, run: `${script} \${input}`, calibration: { good: path.join(tmp, 'good.txt'), bad: path.join(tmp, 'bad.txt') } };
  j.criteria[1].check = { ...j.criteria[1].check, run: `${lax} \${input}`, calibration: { good: path.join(tmp, 'good.txt'), bad: path.join(tmp, 'bad.txt') } };
  const r = calibrate(j);
  assert.deepEqual([r.A1.good, r.A1.bad, r.A2.good, r.A2.bad], [0, 1, 0, 0]);
  j.proofs.calibration = r;
  const v = at(j, 'decide'); assert(says(v, 'I3', /A2 is not calibrated/)); assert(!says(v, 'I3', /A1 is not calibrated/));
});
test('the CLI exits 1 on a refused gate and 0 on a passing one', () => {
  const r = spawnSync(process.execPath, [BIN, 'validate', path.join(HERE, '../fixtures/mrton-as-briefed.json'), '--gate', 'decide', '--offline'], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stdout, /REFUSED observe I7/); assert.match(r.stdout, /Pontificate  refused/);
  const ok = spawnSync(process.execPath, [BIN, 'validate', path.join(HERE, '../fixtures/code-overlap-refactor.json'), '--gate', 'decide', '--offline'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all job tests passed');
process.exit(fails ? 1 : 0);
