import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadJob } from '../../job/lib/load.mjs';
import { readEvents } from '../../job/lib/events.mjs';
import { conduct } from '../lib/daemon.mjs';
import { handlers, idle } from '../lib/handlers.mjs';
import { applyPatch } from '../lib/escalate.mjs';
import { loadState, updateState, reopen } from '../lib/state.mjs';
import { scratch } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), CONDUCT = path.join(HERE, '../bin/conduct.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-relaunch-'));
const setup = scratch(tmp);
const run = (f, ticks = 200) => conduct(f, { load: loadJob, handlers, tickMs: 30, maxTicks: ticks }).then(async () => { await idle(); return loadState(loadJob(f), f); });
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('a relaunch patch on a done job reopens it to streaming with a recorded transition, and the conductor runs the atom again', async () => {
  const { f, repo } = setup('reopen', { 'b1.txt': 'bad', 'b2.txt': 'bad' });
  const first = await run(f);
  assert.equal(first.phase, 'done');
  assert.deepEqual(Object.values(first.atoms).map((a) => a.status), ['frozen', 'frozen']);
  const iter0 = first.atoms.B1.iter, launches0 = first.budget.launches;

  const r = applyPatch(f, { key: 'redo:B1', note: 'redo B1 with the new finding', relaunch: ['B1'] }, { offline: true });
  assert.equal(r.ok, true, r.why);
  assert.equal(r.reopened, true);
  const mid = loadState(loadJob(f), f);
  assert.equal(mid.phase, 'streaming', 'the relaunch reopened the done job');
  assert.equal(mid.atoms.B1.status, 'relaunch');
  assert.equal(mid.atoms.B2.status, 'frozen');
  const t = mid.log.at(-1);
  assert.equal(t.from, 'done'); assert.equal(t.to, 'streaming'); assert.match(t.why, /redo:B1/); assert.match(t.why, /B1/);
  assert(readEvents(loadJob(f), f).some((e) => e.kind === 'GATE' && /reopened from done/.test(e.summary) && /endoforge conduct/.test(e.summary)), 'the reopen asks for the conductor to be started again');

  const second = await run(f);
  assert.equal(second.phase, 'done');
  assert.equal(second.atoms.B1.status, 'frozen');
  assert.equal(second.atoms.B1.iter, iter0 + 1, 'B1 ran another iteration');
  assert.equal(second.atoms.B2.iter, first.atoms.B2.iter, 'B2 was not relaunched');
  assert.equal(second.budget.launches, launches0 + 1);
  assert.equal(fs.readFileSync(path.join(repo, 'game/b1.txt'), 'utf8').trim(), 'good');
  const reopenAt = second.log.findIndex((x) => x.from === 'done' && x.to === 'streaming');
  assert(reopenAt > 0);
  assert.deepEqual(second.log.slice(reopenAt).map((x) => x.to), ['streaming', 'gates', 'locks', 'done']);
});

test('the daemon the unit runs (conduct.mjs run) picks up a reopened job instead of returning at done', () => {
  const { f } = setup('unitrun', { 'c1.txt': 'bad' });
  updateState(loadJob(f), f, (s) => { s.phase = 'done'; Object.assign(s.atoms.C1, { status: 'frozen', iter: 1 }); });
  assert.equal(applyPatch(f, { key: 'redo:C1', relaunch: ['C1'] }, { offline: true }).ok, true);
  const dry = spawnSync(process.execPath, [CONDUCT, 'unit', f, '--dry-run'], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stdout, new RegExp(`conduct\\.mjs run ${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  const r = spawnSync(process.execPath, [CONDUCT, 'run', f, '--tick', '0.03', '--max-ticks', '300'], { encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0, r.stderr);
  const s = loadState(loadJob(f), f);
  assert.equal(s.atoms.C1.status, 'frozen'); assert.equal(s.atoms.C1.iter, 2, 'the run launched the relaunched atom');
  assert.equal(s.phase, 'done');
});

test('a relaunch reopens a job parked past streaming (gates) too, so the atom is launched rather than waited on', async () => {
  const { f } = setup('gates', { 'd1.txt': 'bad' });
  updateState(loadJob(f), f, (s) => { s.phase = 'gates'; Object.assign(s.atoms.D1, { status: 'frozen', iter: 1 }); });
  assert.equal(applyPatch(f, { key: 'redo:D1', relaunch: ['D1'] }, { offline: true }).ok, true);
  const s = loadState(loadJob(f), f);
  assert.equal(s.phase, 'streaming'); assert.deepEqual([s.log.at(-1).from, s.log.at(-1).to], ['gates', 'streaming']);
});

test('a patch without a relaunch leaves a done job done, and a stopped job is not reopened behind the stop', () => {
  const { f } = setup('stay', { 'e1.txt': 'bad' });
  updateState(loadJob(f), f, (s) => { s.phase = 'done'; s.atoms.E1.status = 'frozen'; });
  assert.equal(applyPatch(f, { key: 'note-only', note: 'n' }, { offline: true }).ok, true);
  assert.equal(loadState(loadJob(f), f).phase, 'done');
  updateState(loadJob(f), f, (s) => { s.stopped = { by: 'operator', why: 'enough', at: new Date().toISOString() }; });
  const r = applyPatch(f, { key: 'redo:E1', relaunch: ['E1'] }, { offline: true });
  assert.equal(r.ok, false); assert.match(r.why, /stopped by operator/);
  const s = loadState(loadJob(f), f);
  assert.equal(s.phase, 'done'); assert.equal(s.atoms.E1.status, 'frozen');
});

test('reopen refuses a phase at or before streaming and records the transition', () => {
  const job = { conductor: {} }, s = { phase: 'done', log: [], stopped: null };
  reopen(s, job, 'why');
  assert.deepEqual([s.phase, s.log[0].from, s.log[0].to, s.log[0].why], ['streaming', 'done', 'streaming', 'why']);
  assert.throws(() => reopen({ phase: 'fired', log: [] }, job, 'x'), /cannot reopen/);
  assert.throws(() => reopen({ phase: 'done', log: [], stopped: { by: 'u' } }, job, 'x'), /stopped/);
});

test('a reopen that lands while a later phase is advancing is not overwritten by that advance', async () => {
  const { f } = setup('race', { 'g1.txt': 'bad' });
  updateState(loadJob(f), f, (s) => { s.phase = 'gates'; s.atoms.G1.status = 'frozen'; });
  const s = await conduct(f, { load: loadJob, tickMs: 1, maxTicks: 1, handlers: {
    gates: () => { assert.equal(applyPatch(f, { key: 'redo:G1', relaunch: ['G1'] }, { offline: true }).ok, true); return { advance: true, why: 'every atom frozen or locked' }; },
    streaming: () => null } });
  assert.equal(s.phase, 'streaming'); assert.equal(s.atoms.G1.status, 'relaunch');
  assert.deepEqual(s.log.map((x) => [x.from, x.to]).at(-1), ['gates', 'streaming']);
});
