// Validator tests: POODO gates, invariant-cited rules, the FMEA's H-row controls, and the a collaborator fixtures (refused as
// briefed for I1, I2, I3 and I7; accepted once fixed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../lib/validate.mjs';
import { INVARIANTS, GATES } from '../lib/invariants.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(fs.readFileSync(path.join(HERE, '../fixtures', n), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'job-test-'));
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const OK = { ok: true };
const at = (job, gate = 'orchestrate', o = {}) => validate(job, { gate, offline: true, health: OK, ...o });
const broken = (v) => Object.entries(v.status).filter(([, s]) => s === 'broken').map(([k]) => k);
const says = (v, inv, re) => v.errors.some((e) => e.inv === inv && re.test(e.msg));

test('POODO gates hold all fourteen invariants, each once', () => {
  assert.deepEqual(GATES.map((g) => g.name), ['Pontificate', 'Observe', 'Orient', 'Decide', 'Orchestrate', 'Loop']);
  assert.deepEqual(GATES.flatMap((g) => g.invariants).sort(), INVARIANTS.map((i) => i.id).sort());
});
test('a collaborator as briefed is refused for exactly I1, I2, I3 and I7', () => {
  const v = at(fx('mrton-as-briefed.json'), 'decide');
  assert(!v.ok); assert.deepEqual(broken(v), ['I1', 'I2', 'I3', 'I7']);
  assert(says(v, 'I1', /no primary source/)); assert(says(v, 'I2', /atom CHAR works on model, which mr-btu governs/));
  assert(says(v, 'I3', /add a likeness check against it/)); assert(says(v, 'I7', /\/tmp\/claude-1000\/rai-reta\/mr-btu is on volatile disk/));
  assert(v.errors.every((e) => /^I\d+$/.test(e.inv) && GATES.some((g) => g.id === e.gate)));
});
test('a collaborator, fixed, passes every gate to Orchestrate; the owner-binding gap stays a warning', () => {
  const v = at(fx('mrton.json'));
  assert(v.ok, JSON.stringify(v.errors)); assert.equal(v.status.I8, 'partial'); assert.equal(v.status.I2, 'holds');
});
test('a gate checks only itself and the gates before it', () => {
  const v = at(fx('mrton-as-briefed.json'), 'pontificate');
  assert(v.errors.every((e) => e.gate === 'pontificate')); assert.equal(v.gates.observe, 'not checked'); assert.equal(v.status.I7, 'pending');
});
test('I5: shared files, unowned shared reads, misowned contracts and ownerless seams are refused', () => {
  const j = fx('mrton.json');
  j.atoms[2].files.push(j.atoms[1].files[0]);
  j.atoms[1].reads.push('series/rai-reta/game/plant.ts');
  j.contracts.push({ path: 'series/rai-reta/game/mrton/shared.ts', owner: 'B1' });
  j.seams.push({ id: 'loose', between: ['B1', 'B2'] });
  const v = at(j, 'orient');
  for (const re of [/atoms B1 and B2 share/, /reads shared series\/rai-reta\/game\/plant.ts, which no atom or contract owns/, /inside atom SEAMS's files but is owned by B1/, /seam loose needs an owner/]) assert(says(v, 'I5', re), re);
});
test('I6: an atom without a local check, and a split without a noise-floor proof, are refused', () => {
  const j = fx('mrton.json'); j.atoms[1].checks = []; j.splits[0].proofResult = { ok: true };
  const v = at(j, 'orient');
  assert(says(v, 'I6', /atom B1 has no local check/)); assert(says(v, 'I6', /not proven a no-op \(a pixel diff within a measured noise floor\)/));
  const c = fx('code-overlap-refactor.json'); c.splits = [{ from: 'a.mjs', into: ['b.mjs'], proofResult: { ok: true, kind: 'tests' } }];
  assert(at(c, 'orient').ok);
});
test('I13: speculation off the critical path, no rival, no deadline', () => {
  const j = fx('mrton.json'); j.atoms[1].speculate = 2; delete j.rival; j.deadline = 'today';
  const v = at(j, 'orient');
  assert(says(v, 'I13', /B1 speculates but is not the critical path/)); assert(says(v, 'I13', /strongest rival/)); assert(says(v, 'I13', /deadline/));
});

// The FMEA's H rows: each has a prevention control and a detection control.
test('FMEA H1 intent distorted: prevention needs the verbatim goal, a primary source and a decompressed brief', () => {
  const j = fx('mrton.json'); delete j.brief.assumptions; j.sources[0].primary = false;
  const v = at(j, 'pontificate'); assert(says(v, 'I1', /no primary source/)); assert(says(v, 'I1', /stated apart from what was inferred/));
});
test('FMEA H1 intent distorted: detection is the user\'s confirmation before any spend', () => {
  const j = fx('mrton.json'); delete j.confirmed;
  assert(says(at(j, 'decide'), 'I1', /not been confirmed/));
  assert(says(at(fx('mrton.json'), 'decide', { confirmation: { ok: false, why: 'the card changed after it was confirmed' } }), 'I1', /changed after/));
});
test('FMEA H2 reference not delivered: prevention refuses a governed atom without it; detection requires a measure against it', () => {
  const j = fx('mrton.json'); j.atoms[0].references = [];
  assert(says(at(j, 'orient'), 'I2', /CHAR works on model, which mr-btu governs/));
  const k = fx('mrton.json'); k.criteria = k.criteria.filter((c) => c.id !== 'A2'); k.atoms[0].checks = ['A3'];
  const v = at(k, 'decide'); assert(says(v, 'I3', /mr-btu governs atoms but no criterion measures against it/)); assert(says(v, 'I3', /likeness check/));
});
test('FMEA H3 criterion without a check: prevention needs a runnable, labelled, calibrated check per criterion', () => {
  const j = fx('mrton.json'); delete j.criteria[2].check.run; delete j.criteria[0].check.proxy; delete j.criteria[1].check.calibration.bad;
  const v = at(j, 'decide');
  assert(says(v, 'I3', /A3: its check needs run/)); assert(says(v, 'I3', /A1: say whether the eval check is a proxy/)); assert(says(v, 'I3', /A2: a likeness check needs calibration.good and calibration.bad/));
});
test('FMEA H4 machine overload: prevention names a throttle and the dial; detection runs the health check', () => {
  const j = fx('mrton.json'); delete j.resources.throttle; j.resources.capacityDial = false; j.atoms[0].gpu = true; delete j.resources.gpu;
  const v = at(j); assert(says(v, 'I8', /throttle/)); assert(says(v, 'I8', /capacityDial/)); assert(says(v, 'I8', /gpu-queue/));
  assert(says(at(fx('mrton.json'), 'orchestrate', { health: { ok: false, why: 'fault latch set' } }), 'I8', /health refuses the launch: fault latch set/));
  assert(says(at(fx('mrton.json'), 'orchestrate', { health: null }), 'I8', /health check has not run/));
});
test('I9, I11, I12: no smoke receipt, a relayed approval, a pass claimed without a receipt', () => {
  const j = fx('mrton.json'); j.proofs.smoke = { engines: { codex: true } }; j.gates[0].approval = { by: 'Craig', via: 'relayed' };
  const v = at(j, 'decide');
  assert(says(v, 'I9', /no smoke receipt for claude/)); assert(says(v, 'I11', /relayed approval never counts/)); assert(says(v, 'I12', /without a receipt/));
});
test('I7 on disk: missing paths are refused; I10, I12, I14 at Loop need the baseline, receipts and LESSONS.md', () => {
  const j = fx('mrton.json'); j.notes = path.join(tmp, 'NOTES.md');
  const v = validate(j, { gate: 'observe', volatile: ['/nonexistent-volatile'] });
  assert(says(v, 'I7', /NOTES.md does not exist/));
  const k = fx('mrton.json'); k.rounds = [{ round: 1, receipt: path.join(tmp, 'nope.json'), lessons: path.join(tmp, 'nope.md') }]; k.ratchet.baseline = path.join(tmp, 'gone.json');
  const w = validate(k, { gate: 'loop', health: OK, volatile: ['/nonexistent-volatile'] });
  assert(says(w, 'I12', /round 1: no receipt/)); assert(says(w, 'I14', /round 1: no LESSONS.md/)); assert(says(w, 'I10', /baseline .* is missing/));
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all validator tests passed');
process.exit(fails ? 1 : 0);
