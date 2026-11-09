import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  overlaps, ownershipMap, validateFanout, discoverLogins, assignLanes, laneId, workerCommand, piecePrompt,
  findings, attribute, totals, ratchet, reatomize, wallClock, workerCapacity, waveSize,
} from '../lib/fanout.mjs';
import { reviewAtoms, fixAtoms, judgeAtoms, patchPaths, inScope, laneOf, pick, models } from '../lib/plan.mjs';
import { scoreRound, decide } from '../lib/scoreboard.mjs';
import { validate } from '../../atomizer/lib/validate.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hillclimb-fps-'));
const shared = JSON.parse(fs.readFileSync(new URL('../../atomizer/policy.json', import.meta.url), 'utf8'));
const policy = { ...shared, bindRoots: [...shared.bindRoots, tmp, fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')] };
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const brief = 'improve this piece until the evals pass';
const fanoutCampaign = (extra = {}) => ({
  id: 'demo', goal: 'make the synthetic scene read clearly', mode: 'fanout',
  pieces: { A: { files: ['src/a'], brief }, B: { files: ['src/b.txt'], brief } },
  contracts: ['contracts/api.json'], evals: { command: ['true'] }, ...extra,
});

test('overlaps treats a directory, its glob form and its children as one tree', () => {
  assert.ok(overlaps('src/a', 'src/a/x.js'));
  assert.ok(overlaps('src/a/**', 'src/a/b/c'));
  assert.ok(overlaps('src/a/', 'src/a'));
  assert.ok(!overlaps('src/a', 'src/ab'));
  assert.ok(!overlaps('src/a/x', 'src/b/x'));
});

test('ownershipMap maps each file to its piece and reports shared files and contract writes', () => {
  const ok = ownershipMap({ pieces: { A: { files: ['a/x'] }, B: { files: ['b/y'] } }, contracts: ['c/k.json'] });
  assert.deepEqual(ok, { owner: { 'a/x': 'A', 'b/y': 'B' }, errors: [] });
  const shared = ownershipMap({ pieces: { A: { files: ['src'] }, B: { files: ['src/b.js'] }, C: { files: ['src/b.js'] } } });
  assert.equal(shared.errors.length, 3);
  assert.ok(shared.errors.some((e) => e === 'pieces A and B share src / src/b.js: one writer per file'));
  assert.ok(shared.errors.some((e) => e === 'pieces B and C share src/b.js: one writer per file'));
  const contract = ownershipMap({ pieces: { A: { files: ['contracts/api.json'] } }, contracts: ['contracts'] });
  assert.deepEqual(contract.errors, ['piece A owns contracts/api.json, inside contract contracts: contracts are read-only to every piece']);
  assert.deepEqual(ownershipMap({}), { owner: {}, errors: [] });
});

test('validateFanout accepts a sound decomposition and names every refusal', () => {
  assert.deepEqual(validateFanout(fanoutCampaign()), []);
  const one = validateFanout(fanoutCampaign({ pieces: { A: { files: ['a'], brief } } }));
  assert.ok(one.some((e) => /at least two pieces/.test(e)));
  const bad = validateFanout(fanoutCampaign({
    pieces: { a: { files: [], brief: 'short' }, B: { files: ['b'], brief, engine: 'gpt', speculate: 4, stills: 'x' },
      C: { files: ['c'], brief, speculate: 2 }, D: { files: ['d'], brief, speculate: 3 } },
    evals: {},
  }));
  for (const re of [/piece key a must be uppercase/, /piece a needs files/, /piece a needs a brief/, /piece B engine must be codex or claude/,
    /piece B speculate must be 1\.\.3/, /piece B stills must be a list/, /only one piece may speculate .*C, D/, /needs evals\.command/]) {
    assert.ok(bad.some((e) => re.test(e)), `${re} not in ${bad.join('; ')}`);
  }
  const overlap = validateFanout(fanoutCampaign({ pieces: { A: { files: ['src'], brief }, B: { files: ['src/b'], brief } } }));
  assert.ok(overlap.some((e) => /pieces A and B share/.test(e)));
});

test('discoverLogins reads only logins with credentials under the given home', () => {
  const home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  for (const [d, f] of [['.codex-accounts/two', 'auth.json'], ['.codex-accounts/empty', null], ['.claude-accts/one', '.credentials.json'], ['.claude-accts/bare', null]]) {
    fs.mkdirSync(path.join(home, d), { recursive: true });
    if (f) fs.writeFileSync(path.join(home, d, f), '{}');
  }
  const found = discoverLogins({ home, env: {} });
  assert.deepEqual(found.codex, ['default', 'two']);
  assert.deepEqual(found.claude, [{ name: 'one', dir: path.join(home, '.claude-accts', 'one') }]);
  assert.deepEqual(discoverLogins({ home: path.join(tmp, 'nobody'), env: {} }), { codex: [], claude: [] });
});

test('assignLanes spreads pieces across logins, honours engine and account pins, and refuses the impossible', () => {
  const logins = { codex: ['default', 'two'], claude: [{ name: 'one', dir: '/d/one' }] };
  const c = fanoutCampaign({ pieces: { A: { files: ['a'], brief, speculate: 2 }, B: { files: ['b'], brief, engine: 'claude' }, C: { files: ['c'], brief, account: 'two' } } });
  const lanes = assignLanes(c, logins);
  assert.deepEqual(lanes.map(laneId), ['a-v1', 'a-v2', 'b', 'c']);
  const by = Object.fromEntries(lanes.map((l) => [laneId(l), l]));
  assert.equal(by.b.engine, 'claude');
  assert.equal(by.b.configDir, '/d/one');
  assert.equal(by.c.account, 'two');
  assert.notEqual(by['a-v1'].engine + by['a-v1'].account, by['a-v2'].engine + by['a-v2'].account);
  assert.deepEqual(assignLanes(c, logins, { skip: ['A', 'C'] }).map(laneId), ['b']);
  assert.throws(() => assignLanes(c, { codex: [], claude: [] }), /no logins found/);
  assert.throws(() => assignLanes(c, { codex: ['default'], claude: logins.claude }), /^Error: piece C: no login two available$/);
  delete c.pieces.C;
  assert.throws(() => assignLanes(c, { codex: ['default'], claude: [] }), /^Error: piece B: no claude login available$/);
});

test('workerCommand for a codex lane runs the agent pool in the worktree with the prompt and images', () => {
  const c = fanoutCampaign({ fanout: { codexPool: '/pool', codexModel: 'm1' } });
  const cmd = workerCommand(c, { engine: 'codex', account: 'default' }, { worktree: '/w', prompt: 'P', images: ['/s/1.png'] });
  assert.deepEqual(cmd, { argv: ['/pool', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-C', '/w', '-m', 'm1', 'P', '-i', '/s/1.png'], env: {} });
});

test('piecePrompt states ownership, contracts, other pieces, findings and the check', () => {
  const c = fanoutCampaign();
  c.pieces.A.check = ['make', 'check'];
  const p = piecePrompt(c, 'A', { found: [{ level: 'HARD', rule: 'R1', detail: 'edge is blurred', frames: [3] }], note: 'hurry', round: 2 });
  for (const s of ['YOUR PIECE: A', 'round 2', '- src/a', '- contracts/api.json', 'B (src/b.txt)', '[HARD R1] edge is blurred (frames 3)', 'Notes from the host: hurry', '`make check`']) assert.ok(p.includes(s), s);
  const q = piecePrompt(c, 'B');
  assert.ok(q.includes('No outputs selected') && q.includes('critique it against the goal yourself'));
});

test('findings, attribute and totals read both eval shapes and route findings to pieces', () => {
  const flat = { findings: [{ piece: 'a', rule: 'R1', detail: 'x' }, { piece: 'zz', level: 'STYLE', reason: 'y' }] };
  assert.deepEqual(findings(flat), [{ key: 'a', rule: 'R1', level: 'HARD', detail: 'x', frames: [] }, { key: 'zz', rule: null, level: 'STYLE', detail: 'y', frames: [] }]);
  const rules = { rules: [{ id: 'R2', name: 'n', reason: 'r', failing: [{ piece: 'b', frames: [1] }] }] };
  assert.deepEqual(findings(rules), [{ key: 'b', rule: 'R2', level: 'HARD', detail: 'n: r', frames: [1] }]);
  const c = fanoutCampaign();
  c.pieces.B.rules = ['R9'];
  const a = attribute(c, { findings: [{ piece: 'a', detail: 'x' }, { piece: 'q', rule: 'R9' }, { piece: 'q' }] });
  assert.equal(a.byPiece.A.length, 1);
  assert.equal(a.byPiece.B.length, 1);
  assert.equal(a.unattributed.length, 1);
  assert.deepEqual(totals(flat), { score: 6, hard: 1, style: 1 });
  assert.deepEqual(totals({ score: 2, hardFails: 0, styleFails: 2, findings: [] }), { score: 2, hard: 0, style: 2 });
});

test('ratchet keeps a non-worsening round, refuses a worse one and names regressed pieces', () => {
  const c = fanoutCampaign();
  const before = { findings: [{ piece: 'a' }, { piece: 'a' }] };
  const better = ratchet(c, { score: 10, hard: 2 }, before, { findings: [{ piece: 'b' }] });
  assert.equal(better.pass, true);
  assert.deepEqual(better.baseline, { score: 5, hard: 1 });
  assert.deepEqual(better.regressed, ['B']);
  assert.deepEqual(better.perPiece, { A: { before: 2, after: 0 }, B: { before: 0, after: 1 } });
  const worse = ratchet(c, { score: 5, hard: 1 }, before, { findings: [{ piece: 'a' }, { piece: 'b' }] });
  assert.equal(worse.pass, false);
  assert.deepEqual(worse.baseline, { score: 5, hard: 1 });
  assert.equal(worse.scoreDelta, 5);
});

test('reatomize freezes pieces clean for freezeAfter rounds and splits outliers', () => {
  const c = fanoutCampaign({ pieces: { A: {}, B: {}, C: {} } });
  const h = [{ perPiece: { A: { after: 0 }, B: { after: 1 }, C: { after: 0 } } }, { perPiece: { A: { after: 0 }, B: { after: 9 }, C: { after: 1 } } }];
  assert.deepEqual(reatomize(c, h), { frozen: ['A'], split: ['B'] });
  assert.deepEqual(reatomize(c, h.slice(0, 1)), { frozen: [], split: [] });
  assert.deepEqual(reatomize(c, []), { frozen: [], split: [] });
});

test('wallClock adds serial stages to the long pole', () => {
  assert.deepEqual(wallClock({ render: 30, evals: 10 }, { A: 60, B: 20, C: 40 }), { T: 100, serial: 40, longPole: 'A', longPoleSec: 60, medianAtomSec: 40, serialShare: 0.4 });
  assert.deepEqual(wallClock({}, {}), { T: 0, serial: 0, longPole: null, longPoleSec: 0, medianAtomSec: 0, serialShare: 0 });
});

test('workerCapacity reads the dial from WORKER_STATE_DIR, clamps it, and DRAIN stops all work', () => {
  const dir = path.join(tmp, 'workers');
  const env = { WORKER_STATE_DIR: dir };
  assert.equal(workerCapacity(env), 100);
  fs.mkdirSync(dir, { recursive: true });
  for (const [text, want] of [['40\n', 40], ['250', 100], ['-5', 0], ['abc', 100]]) {
    fs.writeFileSync(path.join(dir, 'CAPACITY'), text);
    assert.equal(workerCapacity(env), want, text);
  }
  fs.writeFileSync(path.join(dir, 'DRAIN'), '');
  assert.equal(workerCapacity(env), 0);
  const xdg = path.join(tmp, 'xdg');
  fs.mkdirSync(path.join(xdg, 'workers'), { recursive: true });
  fs.writeFileSync(path.join(xdg, 'workers', 'CAPACITY'), '25');
  assert.equal(workerCapacity({ XDG_STATE_HOME: xdg }), 25);
});

test('waveSize scales the batch by the dial, keeps at least one slot open, and stops at zero', () => {
  assert.equal(waveSize(8, 100), 8);
  assert.equal(waveSize(8, 50), 4);
  assert.equal(waveSize(8, 1), 1);
  assert.equal(waveSize(8, 0), 0);
  assert.equal(waveSize(8, -3), 0);
  assert.equal(waveSize(0, 100), 0);
});

const campaign = {
  id: 'demo', goal: 'make the synthetic scene read clearly', workdir: path.join(tmp, 'hc-demo'), repo: path.join(tmp, 'hc-repo'),
  owners: { MESH: { describe: 'geometry', scope: ['models/'] }, LIGHT: { describe: 'lighting', scope: ['light/**'], model: 'opus' } },
  critique: { count: 5 }, references: { index: ['refs/a.png'] }, stop: { maxRounds: 3 },
};
for (const d of ['hc-demo/rounds/r01', 'hc-demo/rounds/r02', 'hc-demo/rounds/r03', 'hc-repo']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
const fixlist = {
  schema: 'endoforge/hillclimb-fixlist/1', round: 2, items: [
    { id: 1, still: 's1', problem: 'edge is far too soft here', owner: 'MESH', severity: 'blocker', carried_from: 3 },
    { id: 2, still: 's2', problem: 'shadow falls the wrong way', owner: 'LIGHT', severity: 'major', carried_from: null },
    { id: 3, still: 's3', problem: 'faint seam on the left side', owner: 'MESH', severity: 'minor' },
  ], resolved_from_previous: [1, 2],
};

test('pick rotates models by round and slot unless mixing is off', () => {
  assert.deepEqual(models(campaign), ['opus', 'codex']);
  assert.equal(pick(campaign, 1, 0), 'codex');
  assert.equal(pick(campaign, 1, 1), 'opus');
  assert.equal(pick({ ...campaign, mix: false }, 1, 0, 'sonnet'), 'sonnet');
  assert.equal(pick({ ...campaign, mix: false, models: ['m'] }, 1, 0), 'm');
});

test('reviewAtoms builds consult, one critic per model, a merge and a script compose that the atomizer accepts', () => {
  const d = reviewAtoms(campaign, 2, { hasPrevious: true });
  assert.equal(d.need.id, 'HC-DEMO-R02-REVIEW');
  assert.deepEqual(d.atoms.map((a) => a.id), ['consult', 'critic-opus', 'critic-codex', 'critique', 'compose']);
  const compose = d.atoms.at(-1);
  assert.equal(compose.worker.model, 'script');
  assert.ok(compose.worker.command.includes('--previous'));
  assert.ok(!d.atoms.find((a) => a.id === 'critic-codex').worker.tools.includes('Glob'));
  assert.deepEqual(validate(d, policy).errors, []);
  const single = reviewAtoms({ ...campaign, mix: false }, 1);
  assert.deepEqual(single.atoms.map((a) => a.id), ['consult', 'critique', 'compose']);
  assert.ok(!single.atoms.at(-1).worker.command.includes('--previous'));
  assert.deepEqual(validate(single, policy).errors, []);
});

test('fixAtoms makes one lane per owner, or one per model when competing, then a compose over all lanes', () => {
  const d = fixAtoms(campaign, 2, fixlist);
  assert.equal(d.need.id, 'HC-DEMO-R02-FIX');
  assert.deepEqual(d.atoms.map((a) => a.id), ['fix-light', 'fix-mesh', 'compose']);
  assert.deepEqual(d.atoms.at(-1).inputs, [{ from: 'fix-light' }, { from: 'fix-mesh' }]);
  assert.ok(d.atoms[1].contract.includes('models/'));
  assert.ok(d.atoms[1].contract.includes('2 problems'));
  assert.ok(d.atoms[1].worker.binds.some((b) => b.guest === '/repo' && b.host === campaign.repo));
  assert.deepEqual(validate(d, policy).errors, []);
  const compete = fixAtoms({ ...campaign, fix: { compete: true } }, 2, fixlist);
  assert.deepEqual(compete.atoms.map((a) => a.id), ['fix-light--opus', 'fix-light--codex', 'fix-mesh--opus', 'fix-mesh--codex', 'compose']);
  assert.deepEqual(validate(compete, policy).errors, []);
});

test('judgeAtoms, laneOf, patchPaths and inScope', () => {
  const d = judgeAtoms(campaign, 3, { MESH: ['opus', 'codex'] });
  assert.deepEqual(d.atoms.map((a) => a.id), ['judge', 'compose']);
  assert.deepEqual(validate(d, policy).errors, []);
  assert.deepEqual(laneOf('fix-mesh--codex'), { owner: 'MESH', variant: 'codex' });
  assert.deepEqual(laneOf('fix-light'), { owner: 'LIGHT', variant: null });
  const diff = 'diff --git a/models/x.obj b/models/x.obj\n--- a\n+++ b\ndiff --git a/old/n b/new/n\n';
  assert.deepEqual(patchPaths(diff), ['models/x.obj', 'old/n', 'new/n']);
  assert.ok(inScope('models/x.obj', ['models/']));
  assert.ok(inScope('light/a/b', ['light/**']));
  assert.ok(inScope('light', ['light/**']));
  assert.ok(!inScope('lighting/a', ['light/**']));
  assert.ok(!inScope('models2/x', ['models']));
});

test('scoreRound counts severities, weights, carried and new items, and owners', () => {
  const prev = { items: [{}, {}, {}, {}] };
  assert.deepEqual(scoreRound(fixlist, prev), {
    round: 2, open: 3, blockers: 1, major: 1, minor: 1, weighted: 8, new: 2, carried: 1, resolved: 2, previous_open: 4, by_owner: { MESH: 2, LIGHT: 1 },
  });
  const empty = scoreRound({ round: 1, items: [] });
  assert.equal(empty.previous_open, null);
  assert.equal(empty.weighted, 0);
  assert.equal(empty.resolved, 0);
});

test('decide stops on target, round limit or a plateau, and continues otherwise', () => {
  const row = (open, weighted, blockers = 0) => ({ open, weighted, blockers });
  assert.deepEqual(decide([], { maxRounds: 3 }), { stop: false, why: 'no rounds yet' });
  assert.equal(decide([row(2, 2)], { maxRounds: 9, targetOpen: 2 }).stop, true);
  assert.equal(decide([row(2, 6, 1)], { maxRounds: 9, targetOpen: 2 }).stop, false);
  assert.match(decide([row(9, 9), row(8, 8)], { maxRounds: 2 }).why, /round limit 2/);
  const plateau = decide([row(9, 9), row(5, 5), row(6, 6), row(5, 5)], { maxRounds: 9 });
  assert.equal(plateau.stop, true);
  assert.match(plateau.why, /no improvement .* for 2 rounds \(best 5\)/);
  assert.equal(decide([row(9, 9), row(5, 5), row(6, 6), row(4, 4)], { maxRounds: 9 }).stop, false);
  assert.equal(decide([row(9, 9), row(8, 8)], { maxRounds: 9, patience: 1 }).stop, false);
  assert.equal(decide([row(9, 9), row(9, 9)], { maxRounds: 9, patience: 1 }).stop, true);
});
