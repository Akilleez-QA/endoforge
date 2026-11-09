import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from '../../atomizer/lib/validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(HERE, '..');
const REPO = path.resolve(TOOL, '../..');
const HILLCLIMB = path.join(TOOL, 'bin/hillclimb.mjs');
let fails = 0;
const test = async (name, fn) => { try { await fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hillclimb-runner-'));

await test('hc-patch.sh with no arguments prints its usage and exits 2', () => {
  const r = spawnSync('sh', [path.join(TOOL, 'scripts/hc-patch.sh')], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /usage: hc-patch\.sh init <repo>/);
  assert.doesNotMatch(r.stderr, /unbound variable/);
});

await test('hc-patch.sh with a command but no repo prints its usage and exits 2', () => {
  const r = spawnSync('sh', [path.join(TOOL, 'scripts/hc-patch.sh'), 'init'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /usage:/);
});

await test('hc-patch.sh init and diff still produce a repo-relative patch', () => {
  const repo = path.join(tmp, 'patch-repo'), work = path.join(tmp, 'patch-work');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true }); fs.mkdirSync(work);
  fs.writeFileSync(path.join(repo, 'src/a.txt'), 'one\n');
  const env = { ...process.env, HC_WORK: work };
  assert.equal(spawnSync('sh', [path.join(TOOL, 'scripts/hc-patch.sh'), 'init', repo, 'src'], { env }).status, 0);
  fs.writeFileSync(path.join(work, 'edit/src/a.txt'), 'two\n');
  const out = path.join(tmp, 'p.diff');
  assert.equal(spawnSync('sh', [path.join(TOOL, 'scripts/hc-patch.sh'), 'diff', repo, out], { env }).status, 0);
  const diff = fs.readFileSync(out, 'utf8');
  assert.match(diff, /^diff --git a\/src\/a\.txt b\/src\/a\.txt$/m);
  assert.match(diff, /^\+two$/m);
});

await test('the default runner is a file in this repository, not a home-directory launcher', async () => {
  assert.ok(!fs.readFileSync(HILLCLIMB, 'utf8').includes('.local/bin/endoforge'), 'hillclimb.mjs still names a home-directory runner');
  const { defaultRunner, RUNNER } = await import('../lib/runner.mjs');
  assert.ok(RUNNER.startsWith(REPO + path.sep), RUNNER);
  assert.ok(fs.existsSync(RUNNER), RUNNER);
  assert.deepEqual(defaultRunner(), [process.execPath, RUNNER]);
});

await test('the default runner maps the runner contract onto the atomizer scheduler', async () => {
  const { scheduleArgv } = await import('../lib/runner.mjs');
  const argv = scheduleArgv(['a.json', '--out', '/o', '--concurrency', '4', '--timeout', '60', '--policy', '/p.json'], '/s.mjs');
  assert.deepEqual(argv, [process.execPath, '/s.mjs', 'run', path.resolve('a.json'), '--run-dir', '/o/run', '--concurrency', '4', '--timeout-ms', '60000', '--policy', '/p.json']);
  assert.equal(scheduleArgv(['--out', '/o'], '/s.mjs'), null);
  assert.equal(scheduleArgv(['a.json'], '/s.mjs'), null);
  const r = spawnSync(process.execPath, [path.join(TOOL, 'bin/run-atoms.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: run-atoms\.mjs/);
});

await test('a custom campaign runner keeps the documented contract; the default one also gets the campaign policy', async () => {
  const { runnerArgv, RUNNER } = await import('../lib/runner.mjs');
  assert.deepEqual(runnerArgv({ runner: ['my-run'] }, 'a.json', '/o', '/p.json'), ['my-run', 'a.json', '--out', '/o', '--concurrency', '3', '--timeout', '14400']);
  assert.deepEqual(runnerArgv({ concurrency: 2 }, 'a.json', '/o', '/p.json'), [process.execPath, RUNNER, 'a.json', '--out', '/o', '--concurrency', '2', '--timeout', '14400', '--policy', '/p.json']);
});

await test('plan-review works from a directory that contains neither the round nor the tool', () => {
  const work = path.join(tmp, 'campaign'), elsewhere = path.join(tmp, 'elsewhere');
  fs.mkdirSync(path.join(work, 'rounds/r01'), { recursive: true }); fs.mkdirSync(elsewhere);
  const campaign = {
    schema: 'endoforge/hillclimb/1', id: 'runner-test', goal: 'stills read more clearly at a glance than last round',
    workdir: work, render: [{ id: 'still', command: ['true'] }], owners: { A: { describe: 'lighting', scope: ['scene'] } },
    critique: { count: 3 }, stop: { maxRounds: 1 },
  };
  const f = path.join(work, 'campaign.json'); fs.writeFileSync(f, JSON.stringify(campaign));
  const r = spawnSync(process.execPath, [HILLCLIMB, 'plan-review', f], { cwd: elsewhere, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const atomsFile = r.stdout.trim();
  assert.equal(atomsFile, path.join(work, 'rounds/r01/review.atoms.json'));
  const policy = JSON.parse(fs.readFileSync(path.join(work, 'rounds/r01/review.policy.json'), 'utf8'));
  assert.ok(policy.bindRoots.includes(path.resolve(work)));
  assert.ok(policy.bindRoots.includes(TOOL));
  const shared = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/atomizer/policy.json'), 'utf8'));
  assert.ok(validate(JSON.parse(fs.readFileSync(atomsFile, 'utf8')), policy).ok);
  assert.deepEqual(policy.bindRoots.slice(0, shared.bindRoots.length), shared.bindRoots);
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('hillclimb runner: all passed');
