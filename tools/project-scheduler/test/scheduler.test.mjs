import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate, commandFor, execute, schedule } from '../scheduler.mjs';

const SCHEDULER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scheduler.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'project-scheduler-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const piece = (id, files, extra = {}) => ({ id, command: ['true'], maxTokens: 10, files, ...extra });
const job = (id, project, pieces, recombine = {}) => ({ id, project, pieces, recombine: { command: ['true'], maxTokens: 5, ...recombine } });
const batch = (over = {}) => ({
  schema: 'endoforge/project-scheduler/1', concurrency: 2,
  projects: { alpha: { tokenBudget: 100, gpuPriority: 3 }, beta: { tokenBudget: 100 } },
  jobs: [job('j1', 'alpha', [piece('a', ['src/a.txt']), piece('b', ['src/b.txt'])])],
  ...over,
});
const quick = { capacity: () => 100, room: () => true, pause: () => new Promise((r) => setImmediate(r)) };

test('validate reserves every piece and the recombine step against the project budget', () => {
  const b = batch({ jobs: [
    job('j1', 'alpha', [piece('a', ['a.txt']), piece('b', ['b.txt'])]),
    job('j2', 'beta', [piece('a', ['x/c.txt'], { maxTokens: 20 }), piece('b', ['x/d.txt'])], { maxTokens: 7 }),
  ] });
  assert.deepEqual(validate(b), { alpha: 25, beta: 37 });
});

test('validate refuses each malformed batch with a named reason', () => {
  const cases = [
    [{ schema: 'other/1' }, /unknown scheduler schema/],
    [{ concurrency: 0 }, /concurrency must be positive/],
    [{ concurrency: 1.5 }, /concurrency must be positive/],
    [{ jobs: [] }, /jobs required/],
    [{ projects: { alpha: { tokenBudget: -1 } } }, /invalid project policy: alpha/],
    [{ projects: { alpha: null } }, /invalid project policy: alpha/],
    [{ projects: { 'bad name': { tokenBudget: 1 } } }, /invalid project policy/],
    [{ jobs: [job('j1', 'gamma', [piece('a', ['a']), piece('b', ['b'])])] }, /unknown project: gamma/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['a'])])] }, /pieces and recombine.command required/],
    [{ jobs: [{ ...job('j1', 'alpha', [piece('a', ['a']), piece('b', ['b'])]), recombine: { maxTokens: 1 } }] }, /recombine.command required/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['a']), piece('a', ['b'])])] }, /invalid piece/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['a'], { maxTokens: -2 }), piece('b', ['b'])])] }, /invalid piece/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['a'], { command: [] }), piece('b', ['b'])])] }, /invalid piece/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['../a']), piece('b', ['b'])])] }, /invalid files/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['/etc/a']), piece('b', ['b'])])] }, /invalid files/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['a/./b']), piece('b', ['b'])])] }, /invalid files/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['a\\b']), piece('b', ['b'])])] }, /invalid files/],
    [{ jobs: [job('j1', 'alpha', [piece('a', []), piece('b', ['b'])])] }, /invalid files/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['a'], { gpu: 'yes' }), piece('b', ['b'])])] }, /gpu must be boolean/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['a']), piece('b', ['b'])], { gpu: 1 })] }, /gpu must be boolean/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['a']), piece('b', ['b'])], { maxTokens: undefined })] }, /recombine.maxTokens required/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['a']), piece('b', ['b'])]), job('j1', 'alpha', [piece('c', ['c']), piece('d', ['d'])])] }, /invalid or duplicate job: j1/],
    [{ jobs: [null] }, /invalid job/],
    [{ jobs: [job('j1', 'alpha', [piece('a', ['src']), piece('b', ['src/b.txt'])])] }, /share/],
    [{ contracts: ['src/a.txt'] }, /inside contract src\/a.txt/],
    [{ projects: { alpha: { tokenBudget: 24 } } }, /alpha: token budget exceeded \(25\)/],
  ];
  for (const [over, reason] of cases) assert.throws(() => validate(batch(over)), reason, JSON.stringify(over));
});

test('pieces of different projects may name the same relative path; pieces of one project may not', () => {
  const crossProject = batch({ jobs: [
    job('j1', 'alpha', [piece('a', ['src/index.js']), piece('b', ['README.md'])]),
    job('j2', 'beta', [piece('a', ['src/index.js']), piece('b', ['README.md'])]),
  ] });
  assert.deepEqual(validate(crossProject), { alpha: 25, beta: 25 });
  const sameProject = batch({ jobs: [
    job('j1', 'alpha', [piece('a', ['src/index.js']), piece('b', ['README.md'])]),
    job('j2', 'alpha', [piece('a', ['src/other.js']), piece('b', ['src/index.js'])]),
  ] });
  assert.throws(() => validate(sameProject), /share src\/index.js/);
});

test('commandFor routes only GPU pieces through the queue with the project priority', () => {
  const b = batch();
  const plain = b.jobs[0].pieces[0];
  assert.deepEqual(commandFor(b, b.jobs[0], plain, {}), ['true']);
  const gpu = { ...plain, gpu: true, command: ['run', '--x'] };
  assert.deepEqual(commandFor(b, b.jobs[0], gpu, { ENDOFORGE_GPU_QUEUE: '/q.py' }),
    ['python3', '/q.py', '--name', 'alpha-j1-a', '--priority', '3', '--', 'run', '--x']);
  const betaJob = { ...b.jobs[0], project: 'beta' };
  assert.equal(commandFor(b, betaJob, gpu, { ENDOFORGE_GPU_QUEUE: '/q.py' })[5], '5');
  assert.throws(() => commandFor(b, b.jobs[0], gpu, {}), /ENDOFORGE_GPU_QUEUE/);
});

test('a GPU request without a queue is refused before any command runs', async () => {
  const calls = [];
  const b = batch({ jobs: [
    job('j1', 'alpha', [piece('a', ['a']), piece('b', ['b'])]),
    job('j2', 'beta', [piece('a', ['c']), piece('b', ['d'])], { gpu: true }),
  ] });
  await assert.rejects(schedule(b, { ...quick, env: {}, run: async (cmd, ctx) => { calls.push(ctx); return {}; } }), /ENDOFORGE_GPU_QUEUE/);
  assert.deepEqual(calls, []);
  const r = spawnSync(process.execPath, [SCHEDULER, writeBatch('gpu.json', b), '--check'], { encoding: 'utf8', env: { ...process.env, ENDOFORGE_GPU_QUEUE: '' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ENDOFORGE_GPU_QUEUE/);
});

test('an invalid batch runs nothing', async () => {
  const calls = [];
  await assert.rejects(schedule(batch({ concurrency: 0 }), { ...quick, run: async () => { calls.push(1); } }), /concurrency/);
  assert.equal(calls.length, 0);
});

test('schedule runs every piece, then recombines with ordered results and the recombine budget', async () => {
  const calls = [];
  const b = batch({ concurrency: 3, jobs: [job('j1', 'alpha', [piece('a', ['a']), piece('b', ['b']), piece('c', ['c'])], { maxTokens: 9 })] });
  const delays = { a: 30, b: 1, c: 15 };
  const report = await schedule(b, { ...quick, run: async (cmd, ctx) => {
    calls.push({ ...ctx, results: ctx.results && ctx.results.map((r) => r.piece) });
    await new Promise((r) => setTimeout(r, delays[ctx.piece] ?? 0));
    return { piece: ctx.piece };
  } });
  assert.deepEqual(report.reserved, { alpha: 39 });
  const [j] = report.jobs;
  assert.equal(j.state, 'succeeded');
  assert.deepEqual(j.results.map((r) => r.piece), ['a', 'b', 'c']);
  assert.deepEqual(j.output, { piece: 'recombine' });
  const last = calls.at(-1);
  assert.deepEqual(last, { project: 'alpha', job: 'j1', piece: 'recombine', maxTokens: 9, results: ['a', 'b', 'c'] });
  assert.ok(calls.slice(0, 3).every((c) => c.results === undefined && c.maxTokens === 10));
});

test('concurrency and the capacity dial bound the number of running commands', async () => {
  const jobs = ['j1', 'j2', 'j3'].map((id, i) => job(id, 'alpha', [piece('a', [`${id}/a`], { maxTokens: 1 }), piece('b', [`${id}/b`], { maxTokens: 1 })], { maxTokens: 1 }));
  for (const [concurrency, capacity, bound] of [[4, 100, 4], [4, 50, 2], [3, 1, 1]]) {
    let active = 0, peak = 0;
    const report = await schedule(batch({ concurrency, jobs }), { ...quick, capacity: () => capacity, run: async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return {};
    } });
    assert.equal(peak, bound, `concurrency ${concurrency} capacity ${capacity}`);
    assert.ok(report.jobs.every((j) => j.state === 'succeeded'));
  }
});

test('slots rotate across jobs so one job cannot take them all', async () => {
  const order = [];
  const jobs = ['j1', 'j2'].map((id) => job(id, 'alpha', [0, 1, 2].map((n) => piece(`p${n}`, [`${id}/${n}`], { maxTokens: 1 })), { maxTokens: 1 }));
  await schedule(batch({ concurrency: 1, jobs }), { ...quick, run: async (cmd, ctx) => { order.push(`${ctx.job}:${ctx.piece}`); return {}; } });
  assert.deepEqual(order.slice(0, 4), ['j1:p0', 'j2:p0', 'j1:p1', 'j2:p1']);
  assert.equal(order.length, 8);
});

test('no command starts while there is no headroom or the dial is drained', async () => {
  let rooms = 0, started = 0, waits = 0;
  const seen = [];
  const report = await schedule(batch(), { capacity: () => (waits < 2 ? 0 : 100), room: () => ++rooms > 3,
    pause: async () => { waits++; seen.push(started); },
    run: async () => { started++; return {}; } });
  assert.deepEqual(seen.slice(0, 5), [0, 0, 0, 0, 0]);
  assert.equal(rooms >= 4, true);
  assert.equal(started, 3);
  assert.equal(report.jobs[0].state, 'succeeded');
});

test('a failed piece fails its job, skips its recombine, never retries, and other jobs continue', async () => {
  const calls = [];
  const b = batch({ concurrency: 1, jobs: [
    job('j1', 'alpha', [piece('a', ['a']), piece('b', ['b'])]),
    job('j2', 'beta', [piece('a', ['c']), piece('b', ['d'])]),
  ] });
  const report = await schedule(b, { ...quick, run: async (cmd, ctx) => {
    calls.push(`${ctx.job}:${ctx.piece}`);
    if (ctx.job === 'j1' && ctx.piece === 'a') throw Error('boom');
    return {};
  } });
  assert.equal(calls.filter((c) => c === 'j1:a').length, 1);
  assert.ok(!calls.includes('j1:recombine'));
  assert.ok(calls.includes('j2:recombine'));
  const [j1, j2] = report.jobs;
  assert.equal(j1.state, 'failed');
  assert.equal(j1.error, 'boom');
  assert.equal(j2.state, 'succeeded');
});

test('a failed recombine fails the job', async () => {
  const report = await schedule(batch(), { ...quick, run: async (cmd, ctx) => {
    if (ctx.piece === 'recombine') throw Error('join failed');
    return {};
  } });
  assert.equal(report.jobs[0].state, 'failed');
  assert.equal(report.jobs[0].error, 'join failed');
  assert.equal(report.jobs[0].results.length, 2);
});

test('execute hands each command its identity, budget and results, and rejects a non-zero exit', async () => {
  const out = path.join(tmp, 'env.json');
  const script = `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({p: process.env.ENDOFORGE_PROJECT, j: process.env.ENDOFORGE_JOB, x: process.env.ENDOFORGE_PIECE, t: process.env.ENDOFORGE_TOKEN_BUDGET, r: JSON.parse(process.env.ENDOFORGE_RESULTS)}))`;
  assert.deepEqual(await execute([process.execPath, '-e', script], { project: 'alpha', job: 'j1', piece: 'recombine', maxTokens: 7, results: [{ piece: 'a' }] }), { code: 0 });
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), { p: 'alpha', j: 'j1', x: 'recombine', t: '7', r: [{ piece: 'a' }] });
  await assert.rejects(execute([process.execPath, '-e', 'process.exit(3)'], { project: 'a', job: 'b', piece: 'c', maxTokens: 1 }), /command failed: 3/);
  await assert.rejects(execute([path.join(tmp, 'no-such-binary')], { project: 'a', job: 'b', piece: 'c', maxTokens: 1 }), /ENOENT/);
});

function writeBatch(name, b) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(b));
  return file;
}

test('the command line checks, runs, reports and exits 1 on a failed job', () => {
  const env = { ...process.env, ENDOFORGE_THROTTLE: '0', WORKER_STATE_DIR: path.join(tmp, 'workers') };
  const log = path.join(tmp, 'log.txt');
  const append = (tag) => [process.execPath, '-e', `require('fs').appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(tag)} + ':' + process.env.ENDOFORGE_PIECE + ':' + (process.env.ENDOFORGE_RESULTS || '') + '\\n')`];
  const ok = batch({ jobs: [job('j1', 'alpha', [piece('a', ['a'], { command: append('piece') }), piece('b', ['b'], { command: append('piece') })], { command: append('join') })] });
  const file = writeBatch('ok.json', ok);
  let r = spawnSync(process.execPath, [SCHEDULER, file, '--check'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { reserved: { alpha: 25 } });
  assert.ok(!fs.existsSync(log));
  r = spawnSync(process.execPath, [SCHEDULER, file], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.jobs[0].state, 'succeeded');
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[2], 'join:recombine:[{"piece":"a","result":{"code":0}},{"piece":"b","result":{"code":0}}]');
  const bad = batch({ jobs: [job('j1', 'alpha', [piece('a', ['a'], { command: [process.execPath, '-e', 'process.exit(4)'] }), piece('b', ['b'])])] });
  r = spawnSync(process.execPath, [SCHEDULER, writeBatch('bad.json', bad)], { encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).jobs[0].error, 'command failed: 4');
  r = spawnSync(process.execPath, [SCHEDULER, writeBatch('invalid.json', batch({ concurrency: 0 }))], { encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /concurrency must be positive/);
  assert.equal(r.stdout, '');
});
