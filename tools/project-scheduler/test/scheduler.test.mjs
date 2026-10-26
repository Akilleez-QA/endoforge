import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECTS, validate, commandFor, schedule } from '../scheduler.mjs';
const job = (project, id = project) => ({ id, project,
  pieces: ['A', 'B'].map((piece) => ({ id: piece, files: [`${id}/${piece}.txt`], command: ['true'], maxTokens: 10 })),
  recombine: { command: ['true'], maxTokens: 5 },
});
const batch = () => ({ schema: 'endoforge/project-scheduler/1', concurrency: 4,
  projects: Object.fromEntries(Object.keys(PROJECTS).map((p) => [p, { tokenBudget: 100 }])),
  jobs: Object.keys(PROJECTS).map((p) => job(p)),
});
const options = { capacity: () => 100, room: () => true };

test('reserve every atom and join; reject over-budget work before launch', async () => {
  const b = batch(); b.jobs.push(job('abi', 'abi2'));
  assert.equal(validate(b).abi, 50); b.projects.abi.tokenBudget = 49;
  let calls = 0;
  await assert.rejects(schedule(b, { ...options, run: async () => calls++ }), /abi: token budget exceeded/);
  assert.equal(calls, 0); b.projects.abi.tokenBudget = 50;
  b.jobs[0].pieces[0].maxTokens = -1; assert.throws(() => validate(b), /invalid piece/);
});

test('reuse fan-out ownership checks across projects and frozen contracts', () => {
  const b = batch(); b.jobs[1].pieces[0].files = ['abi/A.txt'];
  assert.throws(() => validate(b), /one writer per file/);
  b.jobs[1].pieces[0].files = ['reta/A.txt']; b.contracts = ['abi/'];
  assert.throws(() => validate(b), /contracts are read-only/);
  b.contracts = []; b.jobs[0].pieces[0].files = ['../elsewhere'];
  assert.throws(() => validate(b), /invalid files/);
});

test('GPU pieces and joins use the existing queue with project priority', () => {
  const b = batch(), j = b.jobs[0], p = { ...j.pieces[0], gpu: true };
  assert.deepEqual(commandFor(b, j, p).slice(-4), ['--priority', '1', '--', 'true']);
  b.projects.abi.gpuPriority = 3;
  assert.deepEqual(commandFor(b, j, { ...j.recombine, id: 'recombine', gpu: true }).slice(-4), ['--priority', '3', '--', 'true']);
});

test('parallel pieces join in declared order; all four projects get slots', async () => {
  const starts = [], released = [];
  const promise = schedule(batch(), { ...options, run: async (_, ctx) => {
    starts.push(`${ctx.project}:${ctx.piece}`);
    assert.equal(ctx.maxTokens, ctx.piece === 'recombine' ? 5 : 10);
    if (ctx.piece === 'A') await new Promise((resolve) => released.push(resolve));
    if (ctx.piece === 'recombine') assert.deepEqual(ctx.results.map((r) => r.piece), ['A', 'B']);
    return ctx.piece;
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, Object.keys(PROJECTS).map((p) => `${p}:A`));
  released.reverse().forEach((resolve) => resolve());
  assert((await promise).jobs.every((j) => j.state === 'succeeded'));
});

test('capacity shrink, drain, and headroom are rechecked before each start', async () => {
  let pct = 0, room = false, pauses = 0, active = 0, peak = 0;
  const report = await schedule(batch(), {
    capacity: () => pct, room: () => room,
    pause: async () => { pauses++; if (pauses === 1) pct = 25; else room = true; },
    run: async () => { active++; peak = Math.max(active, peak); await Promise.resolve(); active--; },
  });
  assert(pauses >= 2); assert.equal(peak, 1);
  assert(report.jobs.every((j) => j.state === 'succeeded'));
});

test('failed piece blocks its join and lets other projects finish', async () => {
  const joins = [];
  const report = await schedule(batch(), { ...options, run: async (_, ctx) => {
    if (ctx.project === 'abi' && ctx.piece === 'A') throw Error('fixture failure');
    if (ctx.piece === 'recombine') joins.push(ctx.project);
  } });
  assert.equal(report.jobs[0].state, 'failed'); assert.equal(report.jobs[0].error, 'fixture failure');
  assert.deepEqual(joins.sort(), ['campus', 'reta', 'service-forward']);
});

test('10,000 synthetic jobs in bounded windows keep concurrency capped', async () => {
  let calls = 0, active = 0, peak = 0;
  for (let window = 0; window < 100; window++) {
    const b = batch(); b.jobs = Array.from({ length: 100 }, (_, i) => job('campus', `j${i}`));
    b.projects.campus.tokenBudget = 2500;
    const report = await schedule(b, { ...options, run: async () => {
      calls++; active++; peak = Math.max(active, peak);
      await Promise.resolve(); active--;
    } });
    assert(report.jobs.every((j) => j.state === 'succeeded'));
  }
  assert.equal(calls, 30000); assert(peak <= 4);
});

test('CLI executes real commands with reservation and join context; failure exits nonzero', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'project-scheduler-'));
  try {
    const b = batch(); b.jobs = [job('abi')];
    for (const p of b.jobs[0].pieces) p.command = [process.execPath, '-e',
      'if (process.env.ENDOFORGE_TOKEN_BUDGET !== "10") process.exit(2)'];
    b.jobs[0].recombine.command = [process.execPath, '-e',
      'if (JSON.parse(process.env.ENDOFORGE_RESULTS).length !== 2) process.exit(3)'];
    const input = path.join(tmp, 'batch.json');
    const run = () => { fs.writeFileSync(input, JSON.stringify(b)); return spawnSync(process.execPath,
      ['tools/project-scheduler/scheduler.mjs', input], { encoding: 'utf8', env: {
        ...process.env, FLEET_STATE_DIR: tmp, ENDOFORGE_THROTTLE: '0',
      } }); };
    assert.equal(run().status, 0);
    b.jobs[0].pieces[0].command = [process.execPath, '-e', 'process.exit(7)'];
    const failed = run(); assert.equal(failed.status, 1); assert.match(failed.stdout, /command failed: 7/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a mid-flight drain lets admitted work settle and blocks new pieces until resume', async () => {
  let pct = 100, starts = 0, resumed = false;
  const b = batch(); b.concurrency = 1;
  const report = await schedule(b, { room: () => true, capacity: () => pct,
    pause: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      if (pct === 0) { assert.equal(starts, 1); resumed = true; pct = 100; }
    },
    run: async () => { starts++; if (starts === 1) pct = 0; },
  });
  assert(resumed); assert.equal(starts, 12);
  assert(report.jobs.every((j) => j.state === 'succeeded'));
});
