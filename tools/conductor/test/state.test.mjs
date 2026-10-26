// Conductor stage 1: locks, the durable state machine, the commands, and the daemon's phase loop with escalation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquire, withLock, LockBusy, writeJSONAtomic } from '../../lib/lock.mjs';
import { initState, loadState, updateState, nextPhase, transition, stateFile } from '../lib/state.mjs';
import * as C from '../lib/commands.mjs';
import { conduct } from '../lib/daemon.mjs';
import { loadJob } from '../../job/lib/load.mjs';
import { readEvents } from '../../job/lib/events.mjs';
import { cardHash } from '../../job/lib/card.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), JOB = path.join(HERE, '../../job/bin/job.mjs'), EF = path.join(HERE, '../../runtime/endoforge');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-'));
let fails = 0; const pending = [];
const test = (name, fn) => { const done = (e) => { if (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } else console.log(`PASS ${name}`); };
  try { const r = fn(); if (r?.then) pending.push(r.then(() => done(), done)); else done(); } catch (e) { done(e); } };
const coord = path.join(tmp, 'coordinator.txt'), hook = path.join(tmp, 'coord.sh');
fs.writeFileSync(hook, `#!/bin/sh\nread -r l; echo "$ENDOFORGE_EVENT_KIND" >> ${coord}\n`, { mode: 0o755 });
process.env.ENDOFORGE_NOTIFY = 'none'; process.env.ENDOFORGE_JOBS = path.join(tmp, 'none'); process.env.ENDOFORGE_COORDINATOR_HOOKS = hook;
const env = { ...process.env, ENDOFORGE_RUNTIME_ENV: 'none' };
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, '../../job/fixtures/mrton.json'), 'utf8'));
function setup(name, edit = () => {}) {
  const d = path.join(tmp, name); fs.mkdirSync(d); const j = structuredClone(fixture); delete j.confirmed; j.resources.health = ['true']; edit(j);
  const f = path.join(d, 'job.json'); fs.writeFileSync(f, JSON.stringify(j)); return f;
}
const cli = (...a) => spawnSync(process.execPath, [JOB, ...a], { env, encoding: 'utf8' });
const stageAndGo = (f) => { assert.equal(cli('stage', f, '--offline').status, 0); return C.go(loadJob(f), f, { sha: cardHash(loadJob(f)), by: 'Craig', words: 'go' }); };
const kinds = (f) => readEvents(loadJob(f), f).map((e) => e.kind);

test('locks: one holder, a busy waiter fails with 75, a dead owner\'s lock is reclaimed', () => {
  const t = path.join(tmp, 'shared.json'), rel = acquire(t);
  assert.throws(() => acquire(t, { waitMs: 50 }), (e) => e instanceof LockBusy && e.exitCode === 75);
  rel(); withLock(t, () => writeJSONAtomic(t, { a: 1 })); assert.deepEqual(JSON.parse(fs.readFileSync(t, 'utf8')), { a: 1 });
  fs.mkdirSync(`${t}.lock`); fs.writeFileSync(`${t}.lock/owner`, JSON.stringify({ pid: 2 ** 22 + 7, host: os.hostname() }));
  acquire(t, { waitMs: 50 })();
});
test('state writes from many processes at once lose nothing (single writer)', () => {
  const f = setup('race'), script = `import { updateState } from ${JSON.stringify(path.join(HERE, '../lib/state.mjs'))}; import { loadJob } from ${JSON.stringify(JOB)};
    const f = process.argv[1], j = loadJob(f); for (let i = 0; i < 15; i++) updateState(j, f, (s) => { s.budget.launches++; });`;
  const ps = Array.from({ length: 4 }, () => spawnSync(process.execPath, ['--input-type=module', '-e', script, f], { encoding: 'utf8' }));
  assert(ps.every((p) => p.status === 0), ps.map((p) => p.stderr).join(''));
  assert.equal(loadState(loadJob(f), f).budget.launches, 60);
});
test('the phase machine: next phases skip undeclared finals and compose; illegal moves throw; stop may end anywhere', () => {
  const j = { atoms: [] }; assert.equal(nextPhase('locks', j), 'done'); assert.equal(nextPhase('locks', { conductor: { finals: {} } }), 'finals');
  const s = initState(j); assert.throws(() => transition(s, j, 'fired'), /illegal transition staged → fired/);
  s.stopped = { by: 'Craig' }; transition(s, j, 'done', 'stop'); assert.equal(s.phase, 'done');
});
test('go: only the user\'s direct words on the staged card move staged → go', () => {
  const f = setup('go'), j = loadJob(f), sha = cardHash(j);
  assert.throws(() => C.go(j, f, { sha, by: 'Craig', words: 'go' }), /never staged/);
  assert.equal(cli('stage', f, '--offline').status, 0);
  assert.throws(() => C.go(loadJob(f), f, { sha, by: 'CoS', words: 'Craig said go', via: 'relayed' }), /relayed approval never counts/);
  assert.throws(() => C.go(loadJob(f), f, { sha: 'deadbeef00', by: 'Craig', words: 'go' }), /not this card/);
  assert.throws(() => C.go(loadJob(f), f, { sha, by: 'Craig' }), /own words/);
  assert.equal(C.go(loadJob(f), f, { sha, by: 'Craig', words: 'go' }).phase, 'go');
});
test('lock, budget, pause and resume change the durable state; raising the budget is spend', () => {
  const f = setup('cmds'), j = loadJob(f);
  assert.throws(() => C.lock(j, f, 'CHAR', { by: 'Craig' }), /own words/);
  C.lock(j, f, 'CHAR', { by: 'Craig', words: 'that is him, lock it' });
  assert.equal(loadState(j, f).atoms.CHAR.status, 'locked'); assert(kinds(f).includes('GATE'));
  assert.throws(() => C.budget(j, f, { launches: 500 }), /own words/);
  assert.equal(C.budget(j, f, { launches: 50 }).budget.maxLaunches, 50);
  assert.equal(C.budget(j, f, { launches: 300, by: 'Craig', words: 'ok, 300' }).budget.maxLaunches, 300);
  assert(C.pause(j, f, 'reboot').paused); assert.equal(C.resume(j, f).paused, false);
});
test('the daemon runs phase handlers to done, asks for a taste lock by NEEDS-YOU, and ends with DONE', async () => {
  const f = setup('daemon', (j) => { j.conductor = { locks: ['CHAR'] }; }); stageAndGo(f);
  const settle = (ctx) => { ctx.update((s) => { for (const a of Object.values(s.atoms)) if (a.status !== 'locked') a.status = 'frozen'; }); return { advance: true }; };
  const handlers = { go: () => ({ advance: true }), smoke: () => ({ advance: true }), fired: () => ({ advance: true }), streaming: settle };
  const s1 = await conduct(f, { load: loadJob, handlers, maxTicks: 3, wait: async () => {} });
  assert.equal(s1.phase, 'locks'); assert.equal(kinds(f).filter((k) => k === 'NEEDS-YOU').length, 1, 'asked once, not every tick');
  C.lock(loadJob(f), f, 'CHAR', { by: 'Craig', words: 'locked' });
  const s2 = await conduct(f, { load: loadJob, handlers, maxTicks: 3, wait: async () => {} });
  assert.equal(s2.phase, 'done'); assert.equal(kinds(f).at(-1), 'DONE');
  assert.deepEqual(s2.log.map((l) => l.to), ['go', 'smoke', 'fired', 'streaming', 'gates', 'locks', 'done']);
});
test('the daemon resumes from disk, honours pause, and stop ends the job', async () => {
  const f = setup('resume'); stageAndGo(f);
  let calls = 0; const handlers = { go: () => (++calls, { advance: true }), smoke: () => null };
  C.pause(loadJob(f), f);
  assert.equal((await conduct(f, { load: loadJob, handlers, maxTicks: 2, wait: async () => {} })).phase, 'go'); assert.equal(calls, 0);
  C.resume(loadJob(f), f);
  assert.equal((await conduct(f, { load: loadJob, handlers, maxTicks: 1, wait: async () => {} })).phase, 'smoke');
  assert.equal((await conduct(f, { load: loadJob, handlers, maxTicks: 1, wait: async () => {} })).phase, 'smoke', 'a new daemon picks up where the last one stopped');
  let stopped = false; C.stop(loadJob(f), f, { by: 'Craig', why: 'enough for today' });
  const s = await conduct(f, { load: loadJob, handlers: { ...handlers, onStop: () => { stopped = true; } }, maxTicks: 1, wait: async () => {} });
  assert.equal(s.phase, 'done'); assert(stopped); assert.match(readEvents(loadJob(f), f).at(-1).summary, /stopped by Craig: enough for today/);
});
test('a phase without a handler wakes the coordinator once (NEEDS-COORDINATOR, not the phone)', async () => {
  const f = setup('nohandler'); stageAndGo(f);
  await conduct(f, { load: loadJob, handlers: { go: () => ({ advance: true }) }, maxTicks: 3, wait: async () => {} });
  assert.equal(kinds(f).filter((k) => k === 'NEEDS-COORDINATOR').length, 1);
  assert.equal(fs.readFileSync(coord, 'utf8').trim().split('\n').filter((k) => k === 'NEEDS-COORDINATOR').length, 1);
  assert(!readEvents(loadJob(f), f).find((e) => e.kind === 'NEEDS-COORDINATOR').push);
});
test('endoforge job status shows the conductor\'s phase and atoms; endoforge conduct makes a restartable unit', () => {
  const f = setup('status'); stageAndGo(f);
  const s = spawnSync(EF, ['job', 'status', f], { env, encoding: 'utf8' });
  assert.equal(s.status, 0, s.stderr); assert.match(s.stdout, /conductor: .* phase go/); assert.match(s.stdout, /CHAR +pending/); assert.match(s.stdout, /STAGED/);
  const u = spawnSync(EF, ['conduct', f, '--dry-run'], { env, encoding: 'utf8' });
  assert.match(u.stdout, /systemd-run --user --unit=endoforge-conductor-mrton-l1 --slice=heavy.slice --property=Restart=on-failure .* run /);
  assert.equal(cli('pause', f).status, 0); assert(loadState(loadJob(f), f).paused);
});
await Promise.all(pending);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all conductor state tests passed');
process.exit(fails ? 1 : 0);
