// Conductor stage 2 on a scratch repo with stub workers: compiled-prompt launches across logins, the collect gate
// (a broken atom is reverted alone and relaunched with the exact error; a good one lands), the single-writer lock,
// the dial, the budget, and escalation after the last iteration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadJob } from '../../job/lib/load.mjs';
import { readEvents } from '../../job/lib/events.mjs';
import { cardHash } from '../../job/lib/card.mjs';
import { acquire, LockBusy } from '../../lib/lock.mjs';
import { loadState, initState } from '../lib/state.mjs';
import * as C from '../lib/commands.mjs';
import { conduct } from '../lib/daemon.mjs';
import { handlers } from '../lib/handlers.mjs';
import { collectAtom, collectLock } from '../lib/collect.mjs';
import { slotsFree } from '../lib/launch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), JOBCLI = path.join(HERE, '../../job/bin/job.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-launch-'));
let fails = 0; const pending = [];
const test = (name, fn) => { const done = (e) => { if (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } else console.log(`PASS ${name}`); };
  try { const r = fn(); if (r?.then) pending.push(r.then(() => done(), done)); else done(); } catch (e) { done(e); } };
const home = path.join(tmp, 'home');
for (const p of ['.codex/auth.json', '.claude-accts/a1/.credentials.json']) { fs.mkdirSync(path.dirname(path.join(home, p)), { recursive: true }); fs.writeFileSync(path.join(home, p), ''); }
Object.assign(process.env, { HOME: home, ENDOFORGE_NOTIFY: 'none', ENDOFORGE_JOBS: path.join(tmp, 'none'), ENDOFORGE_VOLATILE: '/nonexistent-volatile', FLEET_STATE_DIR: path.join(tmp, 'fleet') });
for (const k of Object.keys(process.env)) if (k.startsWith('CODEX_POOL_')) delete process.env[k];
const sh = (cwd, ...a) => { const r = spawnSync(a[0], a.slice(1), { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };

// The stub worker: finds its owned file in the compiled prompt; "bad" → good; "breaks" → a syntax error the first
// time, fixed once its prompt carries the gate's error; "stuck" → always broken.
const worker = path.join(tmp, 'worker.sh');
fs.writeFileSync(worker, `#!/bin/bash
for a in "$@"; do case "$a" in *READY*) echo READY; exit 0;; *"You own ONLY"*) brief="$a";; esac; done
f=$(printf '%s\\n' "$brief" | sed -n '/You own ONLY/{n;s/^- //p;q}')
case "$(cat "$f")" in
  bad) echo good > "$f";;
  breaks) if printf '%s' "$brief" | grep -q "reverted at the collect gate"; then echo good > "$f"; else echo "SYNTAX ERROR" > "$f"; fi;;
  stuck) echo "SYNTAX ERROR" > "$f";;
esac
echo stray > stray.txt
`, { mode: 0o755 });

function setup(name, contents, conductor = {}) {
  const d = path.join(tmp, name), repo = path.join(d, 'repo'); fs.mkdirSync(path.join(repo, 'game'), { recursive: true });
  for (const [f, v] of Object.entries(contents)) fs.writeFileSync(path.join(repo, 'game', f), v + '\n');
  sh(repo, 'git', 'init', '-q', '-b', 'main'); sh(repo, 'git', 'config', 'user.email', 't@t'); sh(repo, 'git', 'config', 'user.name', 't');
  sh(repo, 'git', 'add', 'game'); sh(repo, 'git', 'commit', '-q', '-m', 'seed');
  fs.writeFileSync(path.join(d, 'REQUEST.md'), 'Make every line read good.\n'); fs.writeFileSync(path.join(d, 'NOTES.md'), '# notes\n'); fs.writeFileSync(path.join(d, 'smoke.json'), '{}');
  const ids = Object.keys(contents).map((f) => f.replace('.txt', '').toUpperCase());
  const job = { schema: 'endoforge/job/1', id: name, kind: 'code', title: name, repo,
    goal: { verbatim: 'make every line read good, today', by: 'Craig' }, brief: { objective: 'o', acceptance: 'a', scope: 's', authority: 'au', assumptions: { stated: [], inferred: [] } },
    sources: [{ id: 'req', primary: true, path: path.join(d, 'REQUEST.md'), governs: ['text'], what: 'the request' }],
    criteria: [{ id: 'T1', statement: 'lines read good', satisfiedBy: ids, requires: ['edit'], check: { kind: 'tests', run: 'true' } }],
    atoms: ids.map((id, i) => ({ id, engine: i % 2 ? 'claude' : 'codex', aspects: ['text'], capabilities: ['edit'], files: [`game/${id.toLowerCase()}.txt`], sources: ['req'], checks: ['T1'] })),
    gates: [], resources: { capacityDial: true, throttle: 'endoforge', ownerBound: true, health: ['true'] }, ratchet: { kind: 'tests' },
    criticalPath: ids[0], rival: 'by hand', deadline: '2026-10-27T00:00:00Z', notes: path.join(d, 'NOTES.md'),
    proofs: { smoke: { engines: { codex: true, claude: true }, receipt: path.join(d, 'smoke.json') } },
    conductor: { launcher: 'local', codexPool: worker, claudeBin: worker, maxIterations: 2, gate: '! grep -q "SYNTAX ERROR" game/*.txt', ...conductor } };
  const f = path.join(d, 'job.json'); fs.writeFileSync(f, JSON.stringify(job));
  assert.equal(spawnSync(process.execPath, [JOBCLI, 'stage', f], { encoding: 'utf8' }).status, 0);
  C.go(loadJob(f), f, { sha: cardHash(loadJob(f)), by: 'Craig', words: 'go' });
  return { f, repo, d };
}
const run = (f, ticks = 300) => conduct(f, { load: loadJob, handlers, tickMs: 50, maxTicks: ticks });
const kinds = (f) => readEvents(loadJob(f), f).map((e) => e.kind);

test('a good atom lands; a broken one is reverted alone, relaunched with the exact error, and lands; a stuck one escalates', async () => {
  const { f, repo, d } = setup('mixed', { 'b1.txt': 'bad', 'b2.txt': 'breaks', 'b3.txt': 'stuck' });
  const s = await run(f);
  assert.equal(s.phase, 'streaming', 'stays in streaming while B3 waits for the coordinator');
  assert.deepEqual(Object.fromEntries(Object.entries(s.atoms).map(([k, v]) => [k, [v.status, v.iter]])), { B1: ['frozen', 1], B2: ['frozen', 2], B3: ['needs-coordinator', 2] });
  assert.deepEqual(['b1', 'b2', 'b3'].map((x) => fs.readFileSync(path.join(repo, 'game', `${x}.txt`), 'utf8').trim()), ['good', 'good', 'stuck']);
  const g = JSON.parse(fs.readFileSync(path.join(d, 'conductor/gates/B2-i1.gate.json'), 'utf8'));
  assert.equal(g.ok, false); assert.equal(g.stage, 'gate'); assert(!fs.existsSync(path.join(repo, 'stray.txt')));
  assert.match(fs.readFileSync(path.join(d, 'conductor/prompts/B2-i2.prompt'), 'utf8'), /reverted at the collect gate \(gate: sh -c ! grep -q "SYNTAX ERROR"/);
  assert.equal(sh(repo, 'git', 'log', '--format=%s', 'main').split('\n').filter((x) => / i\d /.test(x)).length, 2);
  const e = readEvents(loadJob(f), f).find((x) => x.kind === 'NEEDS-COORDINATOR');
  assert.match(e.summary, /B3: still failing after 2 iterations/); assert.equal(e.data.packet.history.length, 2);
  assert.deepEqual(kinds(f).filter((k) => ['SMOKE', 'FIRED'].includes(k)), ['SMOKE', 'FIRED']);
  assert.equal(new Set(Object.values(s.atoms).map((a) => a.lane.account)).size >= 1, true);
});
test('when every atom lands the job runs through gates and locks to done', async () => {
  const { f } = setup('clean', { 'b1.txt': 'bad', 'b2.txt': 'bad' });
  const s = await run(f); assert.equal(s.phase, 'done'); assert.equal(kinds(f).at(-1), 'DONE');
});
test('one writer: a collect waits for the integration lock and gives up typed as busy', () => {
  const { f } = setup('lock', { 'b1.txt': 'bad', 'b2.txt': 'bad' }), job = loadJob(f);
  const release = acquire(collectLock(job));
  try { assert.throws(() => collectAtom(job, f, { iter: 1, lane: { worktree: job.repo, base: 'HEAD', engine: 'x', account: 'y' } }, 'B1', { waitMs: 100 }), LockBusy); }
  finally { release(); }
});
test('the dial sizes the wave, and a spent budget asks the user (NEEDS-YOU)', async () => {
  fs.mkdirSync(path.join(tmp, 'fleet'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'fleet/CAPACITY'), '34 ramp');
  const j = { atoms: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] }; assert.equal(slotsFree(j, initState(j)), 1);
  fs.rmSync(path.join(tmp, 'fleet/CAPACITY'));
  const { f } = setup('budget', { 'b1.txt': 'bad', 'b2.txt': 'bad' });
  C.budget(loadJob(f), f, { launches: 1 });
  const s = await run(f, 40);
  assert.equal(s.budget.launches, 1); assert(kinds(f).includes('NEEDS-YOU'));
  assert.match(readEvents(loadJob(f), f).find((e) => e.kind === 'NEEDS-YOU').summary, /launch budget \(1\) is spent/);
});
test('stop ends the job and stops its lanes', async () => {
  const { f } = setup('stop', { 'b1.txt': 'bad' });
  C.stop(loadJob(f), f, { by: 'Craig', why: 'not today' });
  const s = await run(f, 5); assert.equal(s.phase, 'done'); assert.match(readEvents(loadJob(f), f).at(-1).summary, /stopped by Craig/);
});
await Promise.all(pending);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all conductor launch tests passed');
process.exit(fails ? 1 : 0);
