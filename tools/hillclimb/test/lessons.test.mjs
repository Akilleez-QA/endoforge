// Lessons: seeded from each round's measurements, kept in a ledger, open until a tool or PR change is recorded.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autoLessons, mergeLedger, openLessons, lessonsMarkdown, competeLessons, lessonsCommand } from '../lib/lessons.mjs';

let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hillclimb-lessons-'));
const summary = {
  round: 1, smokes: { codex: { ok: false, exit: 2 }, claude: { ok: true } }, split: ['B7'], unattributed: 3,
  logins: ['claude:acct3', 'claude:acct2', 'codex:default'],
  lanes: [{ lane: 'b1', piece: 'B1', engine: 'claude', account: 'acct3', exit: 0, sec: 100 }, { lane: 'b2', piece: 'B2', engine: 'claude', account: 'acct3', exit: 1, sec: 120 },
    { lane: 'b3', piece: 'B3', engine: 'claude', account: 'acct3', exit: null }, { lane: 'b7', piece: 'B7', engine: 'claude', account: 'acct3', exit: 0, sec: 400 }],
  collect: [{ lane: 'b1', status: 'applied', stray: ['README.md'] }, { lane: 'b7', status: 'apply failed', stray: [] }],
  ratchet: { pass: false, score: 50, scoreDelta: 4, hard: 5, hardDelta: 1, reverted: ['B1'], perPiece: {} },
  wallClock: { T: 500, serial: 100, longPole: 'b7', longPoleSec: 400, medianAtomSec: 120, serialShare: 0.2 },
};
test('a round\'s measurements become keyed lessons, each tagged with its stage', () => {
  const keys = autoLessons(summary).map((l) => `${l.stage}:${l.key}`);
  for (const k of ['parallelize:smoke-codex', 'parallelize:lane-exit-b2', 'parallelize:lane-unfinished-b3', 'atomize:stray-b1', 'recombine:apply-b7',
    'recombine:regressed-b1', 'recombine:ratchet-fail', 'attribution:unattributed', 'atomize:split-b7', 'atomize:long-pole-b7', 'parallelize:idle-login']) assert(keys.includes(k), `${k} missing from ${keys}`);
  assert.deepEqual(autoLessons({ lanes: [], ratchet: { pass: true }, wallClock: { serialShare: 0.1 } }), []);
});
test('the ledger counts recurrences, and a closed lesson that recurs reopens', () => {
  let l = mergeLedger({}, [{ key: 'a', stage: 's', lesson: 'x' }], 1);
  l = mergeLedger(l, [{ key: 'a', stage: 's', lesson: 'x' }], 2);
  assert.deepEqual([l.a.count, l.a.first, l.a.last], [2, 1, 2]);
  l.a.tool = 'PR #1'; assert.equal(openLessons(l).length, 0);
  l = mergeLedger(l, [{ key: 'a', stage: 's', lesson: 'x' }], 3);
  assert.deepEqual([l.a.tool, l.a.reopened, l.a.was], [null, 3, 'PR #1']);
});
test('LESSONS.md has measurements, failures, this round\'s lessons and the open list', () => {
  const md = lessonsMarkdown({ round: 4, mode: 'fanout', rows: [['score', 9]], timings: { render: 30 }, failures: ['smoke codex: exit 2'], lessons: [{ key: 'k', stage: 'atomize', lesson: 'split' }],
    open: [{ key: 'old', stage: 'recombine', first: 1, last: 3, count: 2, lesson: 'still open' }] });
  for (const h of ['# Round 4 lessons (fanout)', '## Measurements', '| score | 9 |', '## Failed launches and retries', '- smoke codex: exit 2', '- `k` (atomize): split',
    '## Open lessons with no tool change yet', '- `old` (recombine, rounds 1–3, seen 2x): still open', '## By hand']) assert(md.includes(h), h);
});
test('compete rounds write LESSONS.md from score, render and the Endoforge receipts\' lessons', () => {
  const c = { workdir: path.join(tmp, 'w') }, dir = path.join(c.workdir, 'rounds/r02');
  const put = (f, v) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), JSON.stringify(v)); };
  fs.mkdirSync(c.workdir, { recursive: true }); fs.writeFileSync(path.join(c.workdir, 'scoreboard.json'), JSON.stringify([{ round: 1, weighted: 40 }, { round: 2, weighted: 44 }]));
  put('score.json', { round: 2, open: 20, previous_open: 18, weighted: 44, blockers: 1, new: 5, carried: 15, resolved: 3 }); put('render.json', { seconds: 31 });
  put('review-run/run/receipt/run.json', { wallMs: 60000, statuses: { a: 1, b: 1, c: 1 }, lessons: { failedLaunches: [{ atom: 'critique-codex', attempt: 1, exit: 1, reason: '429' }], retries: [{ atom: 'critique-codex', attempts: 2 }], slowestAtom: { atom: 'critique-opus', wallMs: 55000 } } });
  put('fix-summary.json', { violations: [{ owner: 'Y', path: 'x/y' }] });
  const open = competeLessons(c, 2, dir).map((l) => l.key).sort();
  assert.deepEqual(open, ['no-progress', 'review-failed-launch', 'review-serial', 'scope-y']);
  const md = fs.readFileSync(path.join(dir, 'LESSONS.md'), 'utf8');
  assert.match(md, /review critique-codex attempt 1: exit 1 \(429\)/); assert.match(md, /\| render \| 31 \|/); assert.match(md, /\| weighted \| 44 \|/);
});
test('lessons --close records the tool change; --add records one by hand', () => {
  const c = { workdir: path.join(tmp, 'w') }, flags = (o) => (k) => o[k] ?? null;
  assert.throws(() => lessonsCommand(c, flags({ '--close': 'scope-y' })), /--by/);
  const open = lessonsCommand(c, flags({ '--close': 'scope-y', '--by': 'PR #386' })).map((l) => l.key);
  assert(!open.includes('scope-y'));
  const added = lessonsCommand(c, flags({ '--add': 'sleep-blocked', '--stage': 'harness', '--text': 'use a background until-loop', '--round': '2' }));
  assert(added.some((l) => l.key === 'sleep-blocked' && l.stage === 'harness'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'w/lessons.json'), 'utf8'))['scope-y'].tool, 'PR #386');
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all lessons tests passed');
process.exit(fails ? 1 : 0);
