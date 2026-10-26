// Fan-out mode core: atomize checks, login discovery and rotation, worker commands, attribution, ratchet,
// re-atomization, the wall-clock model and the capacity dial. Pure logic; synthetic logins, no model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCampaign } from '../lib/campaign.mjs';
import { ownershipMap, overlaps, discoverLogins, assignLanes, laneId, workerCommand, piecePrompt, findings, attribute, totals,
  ratchet, reatomize, wallClock, fleetCapacity, waveSize } from '../lib/fanout.mjs';

let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hillclimb-fanout-'));
const campaign = () => ({
  schema: 'endoforge/hillclimb/1', id: 'demo', mode: 'fanout', goal: 'every beat reads clearly in every aspect today',
  workdir: tmp, render: [{ id: 'stills', command: ['true'] }], stop: { maxRounds: 3 },
  evals: { command: ['true'], key: 'beat' }, contracts: ['game/shared.ts'],
  pieces: {
    B1: { files: ['game/b01.ts'], brief: 'beat one: the plant reveal wide shot', keys: ['b1'], stills: ['16x9/f00000.png'] },
    B2: { files: ['game/b02.ts'], brief: 'beat two: the hero struts in from the left', keys: ['b2'] },
    SCRIPT: { files: ['game/lesson.json'], brief: 'the narration and captions for every beat', keys: [], rules: ['MT-10'], engine: 'claude' },
  },
});

test('a fan-out campaign validates without owners or critique', () => {
  const v = validateCampaign(campaign()); assert(v.ok, v.errors.join('; '));
});
test('atomize: a shared file or a directory holding another piece\'s file is rejected', () => {
  const c = campaign(); c.pieces.B2.files.push('game/b01.ts');
  assert.match(ownershipMap(c).errors.join(), /B1 and B2 share game\/b01.ts/);
  const d = campaign(); d.pieces.B2.files = ['game/'];
  assert.match(ownershipMap(d).errors.join(), /B1 and B2 share/);
  assert(!validateCampaign(d).ok);
  assert(overlaps('a/b', 'a/b/c.ts') && !overlaps('a/b', 'a/bc.ts'));
});
test('atomize: a piece may not own a frozen contract', () => {
  const c = campaign(); c.pieces.B1.files.push('game/shared.ts');
  assert.match(validateCampaign(c).errors.join(), /inside contract game\/shared.ts/);
});
test('one piece is not a decomposition; evals are required; only one piece speculates', () => {
  const c = campaign(); delete c.pieces.B2; delete c.pieces.SCRIPT; delete c.evals;
  const e = validateCampaign(c).errors.join();
  assert.match(e, /at least two pieces/); assert.match(e, /evals.command/);
  const s = campaign(); s.pieces.B1.speculate = 2; s.pieces.B2.speculate = 2;
  assert.match(validateCampaign(s).errors.join(), /only one piece may speculate/);
});

// Synthetic login homes: presence of the credential file only.
const home = path.join(tmp, 'home');
for (const p of ['.codex/auth.json', '.codex-accounts/scubasteve/auth.json', '.codex-accounts/empty/.keep',
  '.claude-accts/acct3/.credentials.json', '.claude-accts/acct1/.credentials.json', '.claude-accts/acct2/.credentials.json']) {
  fs.mkdirSync(path.dirname(path.join(home, p)), { recursive: true }); fs.writeFileSync(path.join(home, p), '');
}
fs.writeFileSync(path.join(home, '.claude-accts/pool.json'), '{}');
const logins = discoverLogins({ home, env: {} });
test('logins are discovered, not assumed (2 Codex + 3 Claude)', () => {
  assert.deepEqual(logins.codex, ['default', 'scubasteve']);
  assert.deepEqual(logins.claude.map((a) => a.name), ['acct3', 'acct1', 'acct2']);
});
test('lanes rotate across every login, explicit engines first, no login idle', () => {
  const c = campaign();
  for (let i = 3; i <= 7; i++) c.pieces[`B${i}`] = { files: [`game/b0${i}.ts`], brief: `beat ${i}: a later beat of the film`, keys: [`b${i}`] };
  const lanes = assignLanes(c, logins);
  assert.equal(lanes.length, 8);
  assert.equal(lanes.find((l) => l.piece === 'SCRIPT').engine, 'claude');
  const used = new Set(lanes.map((l) => `${l.engine}:${l.account}`));
  assert.equal(used.size, 5, [...used].join());
  const per = {}; for (const l of lanes) per[l.account] = (per[l.account] ?? 0) + 1;
  assert(Math.max(...Object.values(per)) - Math.min(...Object.values(per)) <= 1, JSON.stringify(per));
});
test('a speculating piece gets duplicates on different logins; frozen pieces are skipped', () => {
  const c = campaign(); c.pieces.B2.speculate = 2;
  const lanes = assignLanes(c, logins, { skip: ['B1'] });
  const b2 = lanes.filter((l) => l.piece === 'B2');
  assert.deepEqual(b2.map(laneId), ['b2-v1', 'b2-v2']);
  assert.notEqual(`${b2[0].engine}${b2[0].account}`, `${b2[1].engine}${b2[1].account}`);
  assert(!lanes.some((l) => l.piece === 'B1'));
});
test('codex: the prompt comes before the -i flags; claude: CLAUDE_CONFIG_DIR picks the login', () => {
  const c = campaign();
  const cx = workerCommand(c, { engine: 'codex', account: 'default' }, { worktree: '/w', prompt: 'PROMPT', images: ['/s/a.png', '/s/b.png'] });
  const at = cx.argv.indexOf('PROMPT');
  assert(at > 0 && cx.argv.indexOf('-i') > at); assert.deepEqual(cx.argv.slice(-4), ['-i', '/s/a.png', '-i', '/s/b.png']);
  const cl = workerCommand(c, { engine: 'claude', account: 'acct3', configDir: '/h/.claude-accts/acct3' }, { worktree: '/w', prompt: 'P', images: ['/s/a.png'] });
  assert.equal(cl.env.CLAUDE_CONFIG_DIR, '/h/.claude-accts/acct3'); assert.deepEqual(cl.argv.slice(1, 3), ['-p', 'P']); assert(cl.argv.includes('/s'));
});

// The check-mrton rule shape, as round 0 produced it.
const evals0 = { score: 40, hardFails: 4, rules: [
  { id: 'MT-04', level: 'HARD', name: 'occlusion', reason: 'equipment hides him', failing: [{ beat: 'b1', frames: ['16x9/f00'] }, { beat: 'b2', frames: ['16x9/f02'] }] },
  { id: 'MT-10', level: 'HARD', name: 'vo-length', reason: 'narration too long', failing: [{ beat: 'b2', frames: [] }] },
  { id: 'MT-20', level: 'HARD', name: 'continuity', reason: 'pose jumps across the cut', failing: [{ beat: 'b1|b2', frames: [] }] },
  { id: 'MT-07', level: 'STYLE', name: 'small-wide', reason: 'wide too small', failing: [{ beat: 'b1', frames: ['1x1/f00'] }] }] };
test('findings are attributed to their owner: rules beat keys, seams stay unattributed', () => {
  const a = attribute(campaign(), evals0);
  assert.deepEqual(a.byPiece.B1.map((f) => f.rule), ['MT-04', 'MT-07']);
  assert.deepEqual(a.byPiece.B2.map((f) => f.rule), ['MT-04']);
  assert.deepEqual(a.byPiece.SCRIPT.map((f) => f.rule), ['MT-10']);
  assert.deepEqual(a.unattributed.map((f) => f.key), ['b1|b2']);
  assert.equal(findings({ findings: [{ beat: 'b1', rule: 'X', level: 'STYLE' }] }, 'beat')[0].key, 'b1');
  assert.deepEqual(totals({ findings: [{ level: 'HARD' }, { level: 'STYLE' }] }), { score: 6, hard: 1, style: 1 });
});
test('the prompt carries the piece\'s own files, stills and findings only', () => {
  const c = campaign(), a = attribute(c, evals0);
  const p = piecePrompt(c, 'B1', { stills: ['/r/16x9/f00000.png'], found: a.byPiece.B1, round: 2 });
  assert.match(p, /You own ONLY these paths; edit nothing else:\n- game\/b01.ts/);
  assert.match(p, /\[HARD MT-04\] occlusion: equipment hides him \(frames 16x9\/f00\)/);
  assert.match(p, /game\/shared.ts/); assert(!p.includes('MT-10'));
});
test('ratchet: passes and lowers the baseline on improvement; names the piece that regressed', () => {
  const c = campaign(), base = { score: 40, hard: 4 };
  const better = { score: 20, hardFails: 2, rules: [evals0.rules[0]] };
  const r = ratchet(c, base, evals0, better);
  assert(r.pass); assert.deepEqual(r.baseline, { score: 20, hard: 2 }); assert.equal(r.scoreDelta, -20); assert.deepEqual(r.regressed, []);
  const worse = { score: 45, hardFails: 5, rules: [...evals0.rules, { id: 'MT-01', level: 'HARD', failing: [{ beat: 'b2' }] }] };
  const w = ratchet(c, base, evals0, worse);
  assert(!w.pass); assert.deepEqual(w.baseline, base); assert.deepEqual(w.regressed, ['B2']);
});
test('re-atomize: clean pieces freeze, clustered failures are split candidates', () => {
  const c = campaign();
  const h = [{ perPiece: { B1: { after: 0 }, B2: { after: 3 }, SCRIPT: { after: 1 } } }, { perPiece: { B1: { after: 0 }, B2: { after: 9 }, SCRIPT: { after: 1 } } }];
  assert.deepEqual(reatomize(c, h), { frozen: ['B1'], split: ['B2'] });
});
test('wall clock: T = serial stages + the long pole', () => {
  const w = wallClock({ render: 30, evals: 5, collect: 5 }, { B1: 100, B2: 400, SCRIPT: 120 });
  assert.deepEqual([w.T, w.longPole, w.medianAtomSec, w.serialShare], [440, 'B2', 120, 0.09]);
});
test('the capacity dial: drain stops launches, a ramp shrinks the wave', () => {
  const fleet = path.join(tmp, 'fleet'); fs.mkdirSync(fleet);
  assert.equal(fleetCapacity({ FLEET_STATE_DIR: fleet }), 100);
  fs.writeFileSync(path.join(fleet, 'CAPACITY'), '50 ramp\n'); assert.equal(fleetCapacity({ FLEET_STATE_DIR: fleet }), 50);
  fs.writeFileSync(path.join(fleet, 'DRAIN'), 'reboot'); assert.equal(fleetCapacity({ FLEET_STATE_DIR: fleet }), 0);
  assert.deepEqual([waveSize(16, 100), waveSize(16, 50), waveSize(16, 1), waveSize(16, 0)], [16, 8, 1, 0]);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all fan-out core tests passed');
process.exit(fails ? 1 : 0);
