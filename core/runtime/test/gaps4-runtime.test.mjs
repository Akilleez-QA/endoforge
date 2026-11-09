import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { attachCgroup, prepareCgroup, releaseCgroup } from '../isolate-cgroup.mjs';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture } from './fixtures/ledger-fixture.mjs';

const thisFile = fileURLToPath(import.meta.url);
const stubPool = fileURLToPath(new URL('../stub-pool.mjs', import.meta.url));
const offheapPort = fileURLToPath(new URL('../../../experiments/P-44-offheap/port.mjs', import.meta.url));
const required = ['memory', 'cpu', 'pids'];
const MiB = 1048576;
const words = path => readFileSync(path, 'utf8').trim().split(/\s+/).filter(Boolean);
const text = path => readFileSync(path, 'utf8').trim();
const counter = (path, name) => Number(text(path).match(new RegExp(`^${name} (\\d+)$`, 'm'))?.[1]);
const until = async (condition, ms = 10000) => {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await sleep(10);
  }
  return true;
};

const contained = source => spawn(process.execPath, ['-e', `process.stdin.once('data', () => { ${source} });`], { stdio: ['pipe', 'pipe', 'inherit'] });
const finished = child => new Promise(resolve => {
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.on('close', (code, signal) => resolve({ code, signal, stdout }));
});
const inCell = (root, limits, source) => {
  const child = contained(source);
  const done = finished(child);
  const directory = attachCgroup(child.pid, root, limits);
  assert.ok(directory, 'attachCgroup returned null inside a delegated scope');
  child.stdin.end('go\n');
  return { child, done, directory };
};
const released = async directory => {
  releaseCgroup(directory);
  assert.equal(await until(() => !existsSync(directory)), true, `${directory} was not removed`);
};

if (process.env.EF_GAPS4_IN_SCOPE) {
  const limits = { memoryMax: 128 * MiB, cpuMax: '100000 100000', pidsMax: 64 };
  let root;

  test('prepareCgroup moves the supervisor out and enables every controller in the delegated scope', () => {
    root = prepareCgroup();
    assert.ok(root, 'prepareCgroup returned null inside a delegated scope');
    assert.deepEqual(required.filter(name => !words(join(root, 'cgroup.subtree_control')).includes(name)), []);
    assert.deepEqual(words(join(root, 'cgroup.procs')), []);
    assert.deepEqual(words(join(root, `ef-supervisor-${process.pid}`, 'cgroup.procs')), [String(process.pid)]);
    assert.equal(prepareCgroup(), root);
  });

  test('attachCgroup writes the stated limits and joins the process', async t => {
    const { child, done, directory } = inCell(root, { ...limits, cpuMax: '50000 100000', pidsMax: 32 }, 'setTimeout(() => {}, 30000);');
    assert.equal(text(join(directory, 'memory.max')), String(128 * MiB));
    assert.equal(text(join(directory, 'memory.oom.group')), '1');
    assert.equal(text(join(directory, 'cpu.max')), '50000 100000');
    assert.equal(text(join(directory, 'pids.max')), '32');
    if (existsSync(join(directory, 'memory.swap.max'))) assert.equal(text(join(directory, 'memory.swap.max')), '0');
    assert.deepEqual(words(join(directory, 'cgroup.procs')), [String(child.pid)]);
    releaseCgroup(directory);
    assert.equal((await done).signal, 'SIGKILL');
    await released(directory);
  });

  test('memory.max kills a process that allocates past it', { timeout: 60000 }, async t => {
    const { done, directory } = inCell(root, limits, `const kept = []; for (let i = 0; i < 64; i++) kept.push(Buffer.alloc(${16 * MiB}, 1)); console.log('survived');`);
    const result = await done;
    assert.equal(result.signal, 'SIGKILL');
    assert.equal(result.stdout, '');
    assert.ok(counter(join(directory, 'memory.events'), 'oom_kill') >= 1);
    await released(directory);
  });

  test('pids.max refuses process creation past it', { timeout: 60000 }, async t => {
    const source = `const { spawn } = require('node:child_process');
      let started = 0, failure = null;
      const next = () => {
        if (started >= 80) return console.log(JSON.stringify({ started, failure }));
        const sleeper = spawn('sleep', ['30'], { stdio: 'ignore' });
        sleeper.once('spawn', () => { started++; next(); });
        sleeper.once('error', error => { failure = error.code; console.log(JSON.stringify({ started, failure })); });
      };
      next();`;
    const { child, done, directory } = inCell(root, { ...limits, pidsMax: 24 }, source);
    let line = '';
    child.stdout.on('data', chunk => { line += chunk; });
    assert.equal(await until(() => line.includes('\n'), 30000), true, 'the contained process reported nothing');
    const report = JSON.parse(line);
    assert.equal(report.failure, 'EAGAIN');
    assert.ok(report.started < 24);
    assert.ok(counter(join(directory, 'pids.events'), 'max') >= 1);
    releaseCgroup(directory);
    await done;
    await released(directory);
  });

  test('cpu.max throttles a process that spins', { timeout: 60000 }, async t => {
    const wallMs = 1500;
    const { done, directory } = inCell(root, { ...limits, cpuMax: '10000 100000' },
      `const start = process.cpuUsage(), end = Date.now() + ${wallMs}; while (Date.now() < end); const used = process.cpuUsage(start); console.log(JSON.stringify(used));`);
    const result = await done;
    assert.equal(result.code, 0);
    const used = JSON.parse(result.stdout);
    assert.ok((used.user + used.system) / 1000 < wallMs * 0.6, `used ${(used.user + used.system) / 1000} ms of ${wallMs} ms`);
    assert.ok(counter(join(directory, 'cpu.stat'), 'nr_throttled') > 0);
    await released(directory);
  });

  test('a process-mode pool enforces memory.max, keeps serving, and leaves no cell groups behind', { timeout: 60000 }, async t => {
    const { job } = await fixture(t);
    const pool = new IsolatePool({ hostPort: offheapPort, size: 1, isolation: 'process',
      resourceLimits: { maxOldGenerationSizeMb: 24, maxYoungGenerationSizeMb: 4 }, cgroupLimits: { memoryMax: 128 * MiB } });
    const directory = mkdtempSync(join(tmpdir(), 'ef-gaps4-offheap-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const killed = await pool.run(job(['pass'], { alloc: { kind: 'arraybuffer', capMb: 1024, progress: join(directory, 'progress.json') } }));
    assert.equal(killed.cgroup, 'enabled');
    assert.equal(killed.status, 'outcome_unknown');
    assert.equal(killed.reason, 'worker_exit');
    assert.equal(killed.signal, 'SIGKILL');
    assert.equal(killed.receipts[0].record.data.outcome_state, 'inconclusive');
    const next = await pool.run(job(['pass'], {}));
    assert.equal(next.status, 'completed');
    assert.equal(next.cgroup, 'enabled');
    await pool.close();
    const cells = () => readdirSync(root).filter(name => name.startsWith('ef-workcell-'));
    assert.equal(await until(() => cells().length === 0), true, `left behind: ${cells()}`);
  });
} else {
  const scopeEnv = () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    return env;
  };
  const scoped = (args, options = {}) => spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', '-p', 'Delegate=yes', ...args],
    { encoding: 'utf8', env: scopeEnv(), timeout: 30000, ...options });
  const probeSource = `const fs = require('node:fs');
    const group = '/sys/fs/cgroup' + fs.readFileSync('/proc/self/cgroup', 'utf8').match(/^0::(.*)$/m)[1];
    console.log(JSON.stringify({ controllers: fs.readFileSync(group + '/cgroup.controllers', 'utf8').trim().split(/\\s+/) }));`;
  const delegatedScope = () => {
    const probe = scoped([process.execPath, '-e', probeSource]);
    if (probe.error) return { reason: `systemd-run is unavailable: ${probe.error.code ?? probe.error.message}` };
    if (probe.status !== 0) return { reason: `systemd-run --user --scope failed: ${probe.stderr.trim() || `exit ${probe.status}`}` };
    const missing = required.filter(name => !JSON.parse(probe.stdout).controllers.includes(name));
    return missing.length ? { reason: `the delegated scope lacks the ${missing.join(', ')} controllers` } : {};
  };

  test('delegated cgroup v2 limits are enforced in process mode inside a systemd scope', { timeout: 300000 }, t => {
    const { reason } = delegatedScope();
    if (reason) return t.skip(reason);
    const run = scoped([process.execPath, '--test', '--test-isolation=none', '--test-reporter=tap', thisFile],
      { env: { ...scopeEnv(), EF_GAPS4_IN_SCOPE: '1' }, timeout: 280000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /^# pass 6$/m, run.stdout);
    assert.match(run.stdout, /^# skipped 0$/m, run.stdout);
  });

  const replayWorld = (t, { atom = 'A1', recorded = true, binary = true } = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'ef-gaps4-stub-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const host = join(root, 'run', 'atoms', atom, 'out');
    const replay = join(root, 'replay');
    const state = join(root, 'state');
    mkdirSync(host, { recursive: true });
    mkdirSync(state);
    if (recorded) {
      mkdirSync(join(replay, 'atoms', atom, 'out', 'nested'), { recursive: true });
      writeFileSync(join(replay, 'atoms', atom, 'out', 'result.txt'), 'recorded result');
      writeFileSync(join(replay, 'atoms', atom, 'out', 'nested', 'deep.txt'), 'deep result');
    }
    const report = join(root, 'report.json');
    const specFile = join(root, 'spec.json');
    writeFileSync(specFile, JSON.stringify({ bwrapArgs: ['--ro-bind', join(root, 'in'), '/in', '--bind', host, '/out'], cmdHead: 'codex' }));
    const bin = join(root, 'next-pool');
    if (binary) {
      writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(process.env.TEST_REPORT, JSON.stringify({ argv: process.argv.slice(2), codexHome: process.env.CODEX_HOME,
  copied: fs.existsSync(process.env.TEST_RESULT), content: fs.existsSync(process.env.TEST_RESULT) ? fs.readFileSync(process.env.TEST_RESULT, 'utf8') : null }));
if (process.env.TEST_MODE === 'wait') {
  process.on('SIGTERM', () => { fs.writeFileSync(process.env.TEST_REPORT + '.terminated', 'yes'); process.exit(143); });
  setTimeout(() => process.exit(99), 8000);
} else if (process.env.TEST_MODE === 'self-kill') process.kill(process.pid, 'SIGKILL');
else process.exitCode = Number(process.env.TEST_EXIT || 0);
`);
      chmodSync(bin, 0o755);
    }
    const env = { ...process.env, ENDOFORGE_ISOLATE_SPEC: specFile, ENDOFORGE_STUB_REPLAY: replay, CODEX_POOL_STATE_DIR: state, CODEX_POOL_BIN: bin,
      TEST_REPORT: report, TEST_RESULT: join(host, 'result.txt'), ENDOFORGE_STUB_LATENCY_MS: '0' };
    return { root, host, state, report, specFile, env };
  };
  const runStub = (env, args = ['exec', '--flag']) => spawnSync(process.execPath, [stubPool, ...args], { encoding: 'utf8', env, timeout: 30000 });
  const refused = (world, result, pattern) => {
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, pattern);
    assert.equal(existsSync(world.report), false);
    assert.equal(existsSync(join(world.state, 'log')), false);
  };

  test('stub pool copies the recorded outputs into the /out bind before it runs the next pool', t => {
    const world = replayWorld(t);
    const result = runStub(world.env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(world.host, 'result.txt'), 'utf8'), 'recorded result');
    assert.equal(readFileSync(join(world.host, 'nested', 'deep.txt'), 'utf8'), 'deep result');
    const report = JSON.parse(readFileSync(world.report, 'utf8'));
    assert.deepEqual(report.argv, ['exec', '--flag']);
    assert.equal(report.copied, true);
    assert.equal(report.content, 'recorded result');
    assert.equal(report.codexHome, join(world.state, 'home'));
    assert.equal(existsSync(join(world.state, 'home')), true);
  });

  test('stub pool logs the account in the form the atomizer scheduler attributes by pid', t => {
    const world = replayWorld(t);
    const result = runStub(world.env);
    const lines = readFileSync(join(world.state, 'log'), 'utf8').split('\n').filter(line => line.includes(` pid=${result.pid} `));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].match(/(?:^| )account=(\S+)/)?.[1], 'stub');
    assert.equal(lines[0].match(/ class=(\S+)/)?.[1], 'ok');
    assert.doesNotMatch(lines[0], / failover=yes(?: |$)/);
  });

  test('stub pool waits the stated latency before the outputs appear', t => {
    const world = replayWorld(t);
    const started = Date.now();
    const result = runStub({ ...world.env, ENDOFORGE_STUB_LATENCY_MS: '200' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(Date.now() - started >= 200);
    assert.equal(JSON.parse(readFileSync(world.report, 'utf8')).copied, true);
  });

  test('stub pool returns the exit status of the next pool', t => {
    const world = replayWorld(t);
    assert.equal(runStub({ ...world.env, TEST_EXIT: '75' }).status, 75);
  });

  test('stub pool reports failure when the next pool dies on a signal', t => {
    const world = replayWorld(t);
    assert.equal(runStub({ ...world.env, TEST_MODE: 'self-kill' }).status, 1);
  });

  test('stub pool passes a timeout SIGTERM to the next pool', { timeout: 30000 }, async t => {
    const world = replayWorld(t);
    const stub = spawn(process.execPath, [stubPool, 'exec'], { env: { ...world.env, TEST_MODE: 'wait' }, stdio: 'ignore' });
    const exited = new Promise(resolve => stub.on('exit', (code, signal) => resolve({ code, signal })));
    t.after(() => stub.kill('SIGKILL'));
    assert.equal(await until(() => existsSync(world.report)), true);
    await sleep(200);
    stub.kill('SIGTERM');
    assert.deepEqual(await exited, { code: 143, signal: null });
    assert.equal(existsSync(`${world.report}.terminated`), true);
  });

  test('stub pool refuses a replay with no outputs for the atom', t => {
    const world = replayWorld(t, { recorded: false });
    refused(world, runStub(world.env), /stub-pool: replay lacks outputs for A1/);
  });

  test('stub pool refuses a launch spec with no /out bind', t => {
    const world = replayWorld(t);
    writeFileSync(world.specFile, JSON.stringify({ bwrapArgs: ['--ro-bind', '/a', '/in'] }));
    refused(world, runStub(world.env), /stub-pool: missing \/out bind/);
  });

  test('stub pool fails when the launch spec cannot be read', t => {
    const world = replayWorld(t);
    refused(world, runStub({ ...world.env, ENDOFORGE_ISOLATE_SPEC: join(world.root, 'absent.json') }), /stub-pool: /);
  });

  test('stub pool fails when the next pool cannot start', t => {
    const world = replayWorld(t, { binary: false });
    const result = runStub(world.env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /stub-pool: .*ENOENT/);
  });
}
