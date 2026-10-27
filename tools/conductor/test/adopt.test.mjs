// Conductor stage 4: escalation packets and the coordinator's patch (through the gates), and adopting a job that is
// running on the prototype scripts (fanout.py + beatloop.py layout) and running it to DONE.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadJob } from '../../job/lib/load.mjs';
import { readEvents } from '../../job/lib/events.mjs';
import { cardHash } from '../../job/lib/card.mjs';
import * as C from '../lib/commands.mjs';
import { conduct } from '../lib/daemon.mjs';
import { handlers, idle } from '../lib/handlers.mjs';
import { loadState } from '../lib/state.mjs';
import { applyPatch, mergePatch } from '../lib/escalate.mjs';
import { scratch, sh } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), CONDUCT = path.join(HERE, '../bin/conduct.mjs'), JOBCLI = path.join(HERE, '../../job/bin/job.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-adopt-'));
let fails = 0; const pending = [];
const test = (name, fn) => { const done = (e) => { if (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } else console.log(`PASS ${name}`); };
  pending.push(Promise.resolve().then(fn).then(() => done(), done)); };
// The worker does what the coordinator's note says; without a note, b3 stays wrong.
const setup = scratch(tmp, `#!/bin/bash
for a in "$@"; do case "$a" in *READY*) echo READY; exit 0;; *"You own ONLY"*) brief="$a";; esac; done
f=$(printf '%s\\n' "$brief" | sed -n '/You own ONLY/{n;s/^- //p;q}')
if printf '%s' "$brief" | grep -q "COORDINATOR: write good"; then echo good > "$f"; exit 0; fi
case "$f" in *b3.txt) echo meh > "$f";; *) echo good > "$f";; esac
`);
const check = [{ id: 'reads', run: 'for f in ${files}; do [ "$(cat $f)" = good ] || exit 1; done' }];
const run = (f, ticks = 300) => conduct(f, { load: loadJob, handlers, tickMs: 50, maxTicks: ticks }).then(async () => { await idle(); return loadState(loadJob(f), f); });
const kinds = (f) => readEvents(loadJob(f), f).map((e) => e.kind);

test('merge patch follows RFC 7396', () => {
  assert.deepEqual(mergePatch({ a: 1, b: { c: 2, d: 3 }, e: [1] }, { b: { c: null, x: 1 }, e: [2], f: 'y' }), { a: 1, b: { d: 3, x: 1 }, e: [2], f: 'y' });
});
test('a stuck atom wakes the coordinator with a packet; its patch goes through the gates and the job runs to DONE', async () => {
  const { f } = setup('patch', { 'b1.txt': 'x', 'b3.txt': 'x' }, { gate: null, maxIterations: 1, checks: check });
  let s = await run(f, 120);
  assert.equal(s.atoms.B3.status, 'needs-coordinator'); assert.equal(s.atoms.B1.status, 'frozen');
  const ev = readEvents(loadJob(f), f).find((e) => e.kind === 'NEEDS-COORDINATOR'), packet = JSON.parse(fs.readFileSync(ev.data.packet, 'utf8'));
  assert.equal(packet.atom.id, 'B3'); assert.equal(packet.job.goal, 'make every line read good, today'); assert.deepEqual(packet.atom.owes.map((c) => c.id), ['T1']);
  // a patch that breaks the gates (two atoms sharing a file) is refused, and the manifest is untouched
  const before = fs.readFileSync(f, 'utf8'), bad = loadJob(f).atoms.map((a) => ({ ...a, files: ['game/b1.txt'] }));
  const refused = applyPatch(f, { key: packet.key, manifest: { atoms: bad } }, { offline: true });
  assert(!refused.ok); assert.match(refused.why, /I5: atoms B1 and B3 share game\/b1.txt/); assert.equal(fs.readFileSync(f, 'utf8'), before);
  // the judgment: a note for the atom, relaunch it with fresh iterations
  const p = path.join(tmp, 'reply.json'); fs.writeFileSync(p, JSON.stringify({ key: packet.key, note: 'COORDINATOR: write good', relaunch: ['B3'], resetIterations: true }));
  const r = spawnSync(process.execPath, [CONDUCT, 'patch', f, p], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  s = await run(f, 200);
  assert.equal(s.phase, 'done'); assert.equal(s.atoms.B3.status, 'frozen'); assert(s.escalations.every((e) => e.resolved));
  assert.equal(kinds(f).filter((k) => k === 'NEEDS-COORDINATOR').length, 1, 'the coordinator was woken exactly once');
});
test('a patch that changes the confirmed card holds every launch until the user\'s new go', async () => {
  const { f } = setup('regive', { 'b1.txt': 'x', 'b3.txt': 'x' }, { gate: null, maxIterations: 1, checks: check });
  let s = await run(f, 120); const key = s.escalations[0].key;
  const crit = loadJob(f).criteria.map((c) => ({ ...c, statement: 'every line reads good (tightened by the coordinator)' }));
  const r = applyPatch(f, { key, manifest: { criteria: crit }, note: 'COORDINATOR: write good', relaunch: ['B3'], resetIterations: true }, { offline: true });
  assert(r.ok && r.holdForGo); assert.equal(kinds(f).at(-1), 'NEEDS-YOU');
  s = await run(f, 20); assert.equal(s.atoms.B3.status, 'relaunch', 'nothing launches before the new go');
  assert.equal(spawnSync(process.execPath, [JOBCLI, 'stage', f], { encoding: 'utf8' }).status, 0);
  C.go(loadJob(f), f, { sha: cardHash(loadJob(f)), by: 'Craig', words: 'yes, tighter is right' });
  s = await run(f, 200); assert.equal(s.phase, 'done');
});
test('adopt a job mid-run from the prototype layout (fanout.py lanes + beatloop state) and run it to DONE', async () => {
  const d = path.join(tmp, 'legacy'), repo = path.join(d, 'int'), lanes = path.join(d, 'lanes'), logs = path.join(d, 'logs');
  fs.mkdirSync(path.join(repo, 'game'), { recursive: true });
  for (const x of ['b1', 'b2', 'b3']) fs.writeFileSync(path.join(repo, 'game', `${x}.txt`), 'x\n');
  sh(repo, 'git', 'init', '-q', '-b', 'main'); sh(repo, 'git', 'config', 'user.email', 't@t'); sh(repo, 'git', 'config', 'user.name', 't'); sh(repo, 'git', 'add', 'game'); sh(repo, 'git', 'commit', '-q', '-m', 'seed');
  const base = sh(repo, 'git', 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'game/b2.txt'), 'good\n'); sh(repo, 'git', 'commit', '-qam', 'B2 frozen earlier');
  // two lanes that finished on the old tool, not yet collected
  for (const [atom, round] of [['B1R2', 't2i3b1'], ['B3R2', 't2i2b3']]) {
    const wt = path.join(lanes, `${round}-${atom.toLowerCase()}`); sh(repo, 'git', 'worktree', 'add', '-q', '-B', `mrton/${round}`, wt, base);
    fs.writeFileSync(path.join(wt, 'game', `${atom.slice(0, 2).toLowerCase()}.txt`), 'good\n');
    fs.mkdirSync(path.join(logs, round), { recursive: true }); fs.writeFileSync(path.join(logs, round, 'round.json'), JSON.stringify({ base, lanes: {} }));
  }
  // a third lane the old tool already collected (its change is on the integration branch): resumed at its check
  fs.writeFileSync(path.join(lanes, 't2i1b2-b2r2.collected'), '');
  fs.writeFileSync(path.join(d, 'SCRIPT.md'), '| 1 | 0:00 | the plant | Hi | Hello |\n'); fs.writeFileSync(path.join(d, 'NOTES.md'), '# notes\n');
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ title: 'Legacy demo', goal: ['make it good', 'its all in the script'], sources: {}, house: 'black stage', contract: 'pose fields',
    governing: { script: { path: path.join(d, 'SCRIPT.md'), governs: 'every beat' } }, checks: ['each beat reads good'],
    atoms: { B1R2: { files: ['game/b1.txt'], engine: 'codex', part: 1, brief: 'x' }, B2R2: { files: ['game/b2.txt'], engine: 'claude', part: 2, brief: 'x' }, B3R2: { files: ['game/b3.txt'], engine: 'codex', part: 3, brief: 'x' } } }));
  fs.writeFileSync(path.join(d, 'beatloop-t2.json'), JSON.stringify({ B1R2: { round: 't2i3b1', iter: 3, status: 'running', history: [{ iter: 2, pass: false }] },
    B2R2: { round: 't2i1b2', iter: 1, status: 'running' }, B3R2: { round: 't2i2b3', iter: 2, status: 'running' } }));
  fs.writeFileSync(path.join(d, 'checks.json'), JSON.stringify([{ id: 'FID', statement: 'each beat reads good', run: check[0].run }]));
  const ctl = path.join(d, 'systemctl'); fs.writeFileSync(ctl, '#!/bin/sh\ncase "$2" in is-active) echo inactive;; show) echo;; esac\n', { mode: 0o755 });
  process.env.ENDOFORGE_SYSTEMCTL = ctl;
  fs.writeFileSync(path.join(d, 'baseline.json'), '{"score": 4, "hard": 2}');
  fs.writeFileSync(path.join(d, 'map.json'), JSON.stringify({ by: 'Craig', layout: { unit: 'old-{round}-{atom}', worktree: '{lanes}/{round}-{atom}', base: '{logs}/{round}/round.json#base',
    prompt: '{logs}/{round}/{ATOM}.prompt', log: '{logs}/{round}/{ATOM}.log', collected: '{lanes}/{round}-{atom}.collected' }, atoms: [{ when: { field: 'part' }, capabilities: ['edit'] }] }));
  const adopt = (dir, ...extra) => spawnSync(process.execPath, [CONDUCT, 'adopt', path.join(d, dir, 'job.json'), '--legacy', path.join(d, 'manifest.json'), '--loop-state', path.join(d, 'beatloop-t2.json'),
    '--lanes', lanes, '--logs', logs, '--repo', repo, '--map', path.join(d, 'map.json'), '--notes', path.join(d, 'NOTES.md'), '--deadline', '2026-10-27T00:00:00Z', '--checks', path.join(d, 'checks.json'), ...extra], { encoding: 'utf8', env: process.env });
  const draft = adopt('draft', '--kind', 'video');                                   // what the old manifest cannot say is listed, not invented
  assert.equal(draft.status, 0, draft.stderr); assert.match(draft.stdout, /before the go, fill in:\n- decide I10: ratchet/); assert.match(draft.stdout, /video: a video needs a numeric eval gate/);
  const jf = path.join(d, 'job', 'job.json'), a = adopt('job', '--kind', 'generic', '--baseline', path.join(d, 'baseline.json'));
  assert.equal(a.status, 0, a.stderr); assert.match(a.stdout, /adopted 3 atoms .* B1R2 launched, B2R2 checking, B3R2 launched/); assert(!/fill in/.test(a.stdout), a.stdout);
  let s = loadState(loadJob(jf), jf); assert.equal(s.phase, 'staged'); assert.equal(s.atoms.B1R2.iter, 3); assert.equal(s.atoms.B1R2.lane.base, base);
  const job = loadJob(jf); job.resources.health = ['true']; Object.assign(job.conductor, { launcher: 'local', codexPool: path.join(tmp, 'worker.sh'), claudeBin: path.join(tmp, 'worker.sh') }); fs.writeFileSync(jf, JSON.stringify(job));
  const st = spawnSync(process.execPath, [JOBCLI, 'stage', jf], { encoding: 'utf8', env: process.env }); assert.equal(st.status, 0, st.stdout + st.stderr);
  C.go(loadJob(jf), jf, { sha: cardHash(loadJob(jf)), by: 'Craig', words: 'migrate it' });
  s = await run(jf, 200);
  assert.equal(s.phase, 'done', JSON.stringify(s.atoms)); assert.deepEqual(Object.values(s.atoms).map((x) => x.status), ['frozen', 'frozen', 'frozen']);
  assert.deepEqual(['b1', 'b2', 'b3'].map((x) => fs.readFileSync(path.join(repo, 'game', `${x}.txt`), 'utf8').trim()), ['good', 'good', 'good']);
  assert.equal(s.budget.launches, 0, 'nothing was relaunched: the running lanes were collected where they stood');
  assert(fs.existsSync(path.join(lanes, 't2i3b1-b1r2')), 'the old tool\'s worktrees are left as they were');
  assert.equal(kinds(jf).filter((k) => k === 'NEEDS-COORDINATOR').length, 0);
  delete process.env.ENDOFORGE_SYSTEMCTL;
});
await Promise.all(pending);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all conductor adopt tests passed');
process.exit(fails ? 1 : 0);
