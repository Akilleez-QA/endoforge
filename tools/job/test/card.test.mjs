// Job card, confirmation by card hash, and lesson retrieval from earlier jobs of the same kind.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from '../lib/validate.mjs';
import { renderCard, cardHash } from '../lib/card.mjs';
import { retrieveLessons, lessonsForAtom, notesLessons } from '../lib/lessons.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), BIN = path.join(HERE, '../bin/job.mjs');
const fx = (n) => JSON.parse(fs.readFileSync(path.join(HERE, '../fixtures', n), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'job-card-'));
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const job = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, ENDOFORGE_JOBS: path.join(tmp, 'jobs'), ...env } });

test('the card shows the verbatim goal, what governs what with thumbnails, atoms, checks and the invariants', () => {
  const j = fx('mrton.json'), card = renderCard(j, validate(j, { gate: 'decide', offline: true }));
  assert.match(card, /^> code red, a collaborator video today/m); assert.match(card, /> — Craig, 2026-10-26T06:05/);
  assert.match(card, /\| mr-btu \| reference \| model \| `\/mnt\/cold-steam\/factory-scratch\/mrton\/reference\/mr-btu` \|/);
  assert.match(card, /!\[mr-btu\]\(\/mnt\/cold-steam\/factory-scratch\/mrton\/reference\/mr-btu\/closeups\/body-views.jpg\)/);
  assert.match(card, /\| CHAR \(critical path\) x2 \| claude \| model, persona \| script, model-spec, mr-btu \|/);
  assert.match(card, /\| A2: .* \| likeness vs mr-btu \| yes \| yes \|/); assert.match(card, /I1 holds · I2 holds/);
  assert.match(card, new RegExp(`sha256 \`${cardHash(j).slice(0, 12)}\``));
});
test('the as-briefed card would have shown the miss at a glance', () => {
  const j = fx('mrton-as-briefed.json'), card = renderCard(j, validate(j, { gate: 'decide', offline: true }));
  assert.match(card, /> tough-guy swagger: a stylised lumberjack legend/); assert.match(card, /I1 BROKEN · I2 BROKEN · I3 BROKEN/);
  assert.match(card, /\| CHAR \(critical path\) x2 \| claude \| model, persona \| - \|/); assert.match(card, /- orient I2: atom CHAR works on model/);
});
test('the card hash covers what the user confirms, not proofs that arrive later', () => {
  const j = fx('mrton.json'), h = cardHash(j);
  assert.equal(cardHash({ ...j, proofs: {}, confirmed: null }), h);
  assert.notEqual(cardHash({ ...j, brief: { ...j.brief, objective: 'x' } }), h);
  assert.equal(cardHash({ ...j, gates: j.gates.map((g) => ({ ...g, approval: { by: 'Craig', via: 'direct' } })) }), h);
});

// Lesson retrieval: an earlier video job with a NOTES.md, an unrelated code job, and explicit LESSONS.md / lessons.json.
const jobs = path.join(tmp, 'jobs'), prev = path.join(jobs, 'rai-l2');
fs.mkdirSync(prev, { recursive: true });
fs.writeFileSync(path.join(prev, 'NOTES.md'), ['| # | What went wrong | Cost | Fix |', '|---|---|---|---|',
  '| 1 | The character model ignored the reference sheet | 25 min | Give the model atom its reference and a likeness check |',
  '| 2 | GPU queue link dangled after a reboot | 1 launch | gpu-queue recreates the target (#386) |'].join('\n'));
fs.writeFileSync(path.join(prev, 'job.json'), JSON.stringify({ schema: 'endoforge/job/1', id: 'rai-l2', kind: 'video', notes: path.join(prev, 'NOTES.md') }));
fs.mkdirSync(path.join(jobs, 'code'), { recursive: true });
fs.writeFileSync(path.join(jobs, 'code/NOTES.md'), '| 1 | flaky test in the suite | 5 min | rerun |\n');
fs.writeFileSync(path.join(jobs, 'code/job.json'), JSON.stringify({ schema: 'endoforge/job/1', id: 'code-x', kind: 'code', notes: path.join(jobs, 'code/NOTES.md') }));
const hc = path.join(tmp, 'hc'); fs.mkdirSync(hc);
fs.writeFileSync(path.join(hc, 'LESSONS.md'), '# Round 3 lessons\n\n## Open lessons with no tool change yet\n- `long-pole-char` (atomize, rounds 1–3, seen 3x): lane char took 900 s, 6x the median; split it\n\n## By hand\n');
fs.writeFileSync(path.join(hc, 'lessons.json'), JSON.stringify({ unattributed: { stage: 'attribution', lesson: '4 findings belong to no piece', tool: null }, closed: { lesson: 'x', tool: 'PR #391' } }));

test('lessons come from earlier jobs of the same kind; rows closed by a PR and other kinds are left out', () => {
  const j = { ...fx('mrton.json'), lessonsFrom: [path.join(hc, 'LESSONS.md'), path.join(hc, 'lessons.json')] };
  const l = retrieveLessons(j, { roots: [jobs] });
  assert.deepEqual(l.map((x) => x.key).sort(), ['hc:long-pole-char', 'hc:unattributed', 'rai-l2#1']);
  assert.equal(notesLessons(path.join(prev, 'NOTES.md'), 'p').find((x) => x.key === 'p#2').open, false);
});
test('each atom gets the lessons that name its id, aspects or files', () => {
  const j = { ...fx('mrton.json'), lessonsFrom: [path.join(hc, 'LESSONS.md')] }, l = retrieveLessons(j, { roots: [jobs] });
  assert.deepEqual(lessonsForAtom(j.atoms[0], l).map((x) => x.key).sort(), ['hc:long-pole-char', 'rai-l2#1']);
  assert.deepEqual(lessonsForAtom(j.atoms[4], l), []);
  assert.match(renderCard(j, validate(j, { gate: 'decide', offline: true }), l), /## Open lessons from earlier video jobs\n- \[rai-l2\] The character model ignored the reference sheet → Give the model atom/);
});
test('CLI: card records the retrieval; confirm needs this card\'s sha and the user\'s words; Decide then passes', () => {
  const f = path.join(tmp, 'mrton.json'), j = fx('mrton.json'); delete j.confirmed; delete j.proofs.lessons;
  fs.writeFileSync(f, JSON.stringify(j));
  assert(validate(j, { gate: 'decide', offline: true }).errors.some((e) => e.inv === 'I14'));
  const c = job(['card', f, '--offline']); assert.equal(c.status, 0, c.stderr);
  const sha = /card sha256 ([0-9a-f]{64})/.exec(c.stderr)[1];
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'mrton.proofs.json'), 'utf8')).lessons.count, 1);
  assert.equal(job(['confirm', f, '--sha', sha.slice(0, 12), '--by', 'Craig', '--words', 'go']).status, 1, 'not staged yet');
  assert.equal(job(['stage', f, '--offline'], { ENDOFORGE_NOTIFY: 'none' }).status, 0);
  assert.equal(job(['confirm', f, '--sha', 'deadbeef', '--by', 'Craig', '--words', 'go']).status, 1);
  assert.equal(job(['confirm', f, '--sha', sha.slice(0, 12), '--by', 'Craig']).status, 2);
  assert.equal(job(['confirm', f, '--sha', sha.slice(0, 12), '--by', 'Craig', '--words', 'go']).status, 0);
  assert.equal(job(['validate', f, '--gate', 'decide', '--offline']).status, 0);
  assert.equal(job(['confirm', f, '--sha', sha.slice(0, 12), '--by', 'Craig', '--words', 'CoS says go', '--via', 'relayed']).status, 0);
  const v = job(['validate', f, '--gate', 'decide', '--offline']); assert.equal(v.status, 1); assert.match(v.stdout, /REFUSED decide I1: the card was confirmed via relayed/);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all card tests passed');
process.exit(fails ? 1 : 0);
