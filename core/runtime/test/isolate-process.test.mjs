import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture, hostPort } from './fixtures/ledger-fixture.mjs';
import { poolBreach } from './fixtures/pool-breach.mjs';

for (const breach of ['heap', 'wasm_memory']) {
  test(`process ${breach}: one lost cell, zero lost siblings, native verdicts and verified chain`, { timeout: 240000 }, async t => {
    const result = await poolBreach(t, 'process', breach);
    const { failed, survivors, replacement, expected, chain } = result;
    assert.equal(result.distinctInitialWorkcells, 8);
    assert.equal(result.workcellsLost, 1);
    assert.equal(result.siblingsLost, 0);
    assert.equal(failed.status, 'rejected');
    assert.equal(failed.reason, breach);
    assert.equal(failed.error, breach === 'heap' ? 'ERR_WORKER_OUT_OF_MEMORY' : 'ERR_WORKCELL_WASM_MEMORY_LIMIT');
    assert.equal(failed.receipts[0].record.data.outcome_state, 'failed');
    assert.equal(failed.receipts[0].record.data.observations[0].status, 'rejected');
    assert.equal(failed.receipts[0].record.data.observations[0].reason, breach);
    assert(['enabled', 'unavailable'].includes(failed.cgroup));
    for (const good of [...survivors, replacement]) {
      assert.deepEqual(good.report, expected);
      assert.deepEqual(good.receipts.map(r => r.record.data.outcome_state), ['passed', 'failed']);
      assert.notEqual(good.workcell, failed.workcell);
      assert.equal(good.isolation, 'process');
    }
    assert(!survivors.some(r => r.workcell === replacement.workcell));
    assert.deepEqual(chain, { receipts: 17, verified: true });
  });
}

test('process close settles aborted barrier and release waits', { timeout: 60000 }, async t => {
  let pool, abort;
  t.after(async () => {
    if (!pool) return;
    writeFileSync(abort, 'abort');
    await pool.close();
  });
  const { job, directory } = await fixture(t);
  const barrier = join(directory, 'barrier'), release = join(directory, 'release');
  abort = join(directory, 'abort');
  mkdirSync(barrier);
  pool = new IsolatePool({ hostPort, isolation: 'process', size: 2 });
  const settled = [false, false];
  const jobs = [{ barrier, participants: 3 }, { release }].map((options, i) =>
    pool.run(job(['pass'], { ...options, abort })).then(result => { settled[i] = true; return result; }));
  await delay(200);
  assert.deepEqual(settled, [false, false]);
  writeFileSync(abort, 'abort');
  let timer;
  try {
    await Promise.race([pool.close(), new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('pool.close() hung after fixture wait abort')), 30000);
    })]);
  } finally { clearTimeout(timer); }
  assert.deepEqual(settled, [true, true]);
  for (const result of await Promise.all(jobs)) assert.equal(result.report, null);
});

const repository = fileURLToPath(new URL('../../../', import.meta.url));

function dryRun(...targets) {
  const env = { ...process.env };
  for (const key of ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES']) delete env[key];
  return execFileSync('make', ['-n', '--no-print-directory', ...targets], { cwd: repository, env, encoding: 'utf8' })
    .split('\n').map(line => line.trim()).filter(Boolean);
}

test('make isolate-test installs what its tests import before running them, on a fresh clone', () => {
  const lines = dryRun('isolate-test');
  const run = lines.findIndex(line => line.startsWith('node --test') && line.includes('core/runtime/test/'));
  assert(run >= 0, lines.join('\n'));
  const listed = lines[run].split(/\s+/);
  for (const [prefix, file] of [['tools/tscheck', 'gaps-compat.test.mjs'], ['tools/asc', 'gaps-x1runtime.test.mjs']]) {
    assert(listed.includes(`core/runtime/test/${file}`), file);
    const setup = lines.findIndex(line => /^npm ci\b/.test(line) && line.includes(`--prefix ${prefix}`));
    assert(setup >= 0 && setup < run, `npm ci --prefix ${prefix} must run before ${file}`);
  }
});

test('make rust-lane-test installs the lane tools first, and CI runs it on the pinned toolchain', () => {
  const lines = dryRun('rust-lane-test');
  const run = lines.findIndex(line => line.includes('tools.rust_lane.test_lane'));
  const setup = lines.findIndex(line => /^npm ci\b/.test(line) && line.includes('--prefix tools/rust_lane'));
  assert(run >= 0 && setup >= 0 && setup < run, lines.join('\n'));
  const ci = readFileSync(new URL('.github/workflows/ci.yml', `file://${repository}`), 'utf8');
  const job = ci.split(/\n(?=  [\w-]+:\n)/).find(block => /\n\s+run: make rust-lane-test\b/.test(block));
  assert(job, 'a CI job must run make rust-lane-test');
  const pinned = readFileSync(new URL('tools/rust_lane/build.py', `file://${repository}`), 'utf8').match(/rustc (\d+\.\d+\.\d+)/)[1];
  assert(job.includes(pinned), `the CI job must install Rust ${pinned}`);
  assert(job.includes('wasm32-unknown-unknown'));
  assert(/\n\s+run: make tools\b/.test(job), 'the CI job must install the pinned wasm-tools');
  assert(!/\bcontinue-on-error:\s*true/.test(job));
});

test('process fallback, validation and unknown exits', { timeout: 30000 }, async t => {
  assert.throws(() => new IsolatePool({ hostPort, isolation: 'other' }), /isolation/);
  assert.throws(() => new IsolatePool({ hostPort, cgroupLimits: { pidsMax: 0 } }), /cgroupLimits/);
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, isolation: 'process', size: 1, cgroupRoot: '/tmp/absent-ef-cgroup' });
  t.after(() => pool.close());
  const result = await pool.run(job(['exit']));
  assert.equal(result.status, 'outcome_unknown');
  assert.equal(result.reason, 'worker_exit');
  assert.equal(result.cgroup, 'unavailable');
  assert.equal(result.receipts[0].record.data.outcome_state, 'inconclusive');
  assert.equal((await pool.run(job())).status, 'completed');
});

test('process compile gate rejects missing and oversized imported or defined memory limits', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ isolation: 'process', size: 1, wasmMemoryMaxMb: 1,
    hostPort: fileURLToPath(new URL('./fixtures/wasm-port.mjs', import.meta.url)) });
  t.after(() => pool.close());
  for (const memory of [[0, 1], [1, 1, 17], [1, 17, 17]]) for (const imported of [false, true]) {
    const section = imported ? [1, 1, 101, 1, 109, 2, ...memory] : [1, ...memory];
    const bytes = [0, 97, 115, 109, 1, 0, 0, 0, imported ? 2 : 5, section.length, ...section];
    for (const action of ['compile', 'instantiate']) {
      const result = await pool.run(job(['pass'], { action, bytes }));
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason, 'wasm_memory');
      assert.equal(result.report, null);
      assert.equal(result.receipts[0].record.data.outcome_state, 'failed');
    }
  }
});
