import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import { windows } from '../../../experiments/P-50-in-isolate/analyze.mjs';
import { IsolatePool } from '../isolate-pool.mjs';
import { ledger } from '../x1/ledger.mjs';
import { createLoopPool } from '../x1/loop.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider, SpawnClaudeTransport, WarmClaudeTransport } from '../x1/transports.mjs';
import { candidate } from './fixtures/x1/candidate.mjs';
import { forgeries } from './fixtures/x1/forgeries.mjs';
import { idOf, implementation, inputFor, modelFor, reply, specification, stageOf } from './fixtures/x1/scripted-model.mjs';
import { good, seeds } from './fixtures/x1/seeds.mjs';
import { python } from './fixtures/ledger-fixture.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const repository = here('../../../');
const fakeClaude = here('./fixtures/x1/fake-claude.mjs');
const asc = here('../../../tools/asc/node_modules/.bin/asc');
const stagePort = here('./fixtures/x1/loop-stage-port.mjs');
const forgePort = here('./fixtures/x1/forge-port.mjs');
const { files } = candidate();
const need = 'integer add(a,b)';
const env = { ENDOFORGE_LOOP: 'agent' };
const addInput = inputFor(files['CONTRACT.md'], files['tests.json'], good.kernel, good.glue);
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-review-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const agentPool = (t, script, options = {}) => {
  const pool = createLoopPool({ primes: 1, provider: scriptedProvider(script), ...options });
  t.after(() => pool.close());
  return pool;
};
const records = ledgerPath => python(`
import json, sys
from core.ledger.ledger import Ledger
print(json.dumps(Ledger(json.load(sys.stdin)['ledger']).records()))
`, { ledger: ledgerPath });
const baseEnv = root => ({ ...process.env, CODEX_HOME: join(root, 'h'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_ASC_CMD: asc, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, here('./fixtures/x1/fake-codex.mjs')]) });
const glueFor = (name, args, result) => JSON.stringify({ id: 'x', assumption: 'Inputs are synthetic integers for this check.', question: 'Do these synthetic exports answer the question?',
  exports: [{ name, label: `Call ${name}`, args: args.map(arg => ({ name: arg, kind: 'integer', unit: '1' })), result: { kind: 'integer', unit: '1' } }], traps: [] });
const weak = {
  'a wrong kernel under an unbounded tolerance': { tests: [{ name: 't', fn: 'add', args: [2, 3], expect: 5, tol: 1e308 }], kernel: seeds[1].kernel, glue: good.glue },
  'a test that asserts nothing': { tests: [{ name: 't', fn: 'add', args: [2, 3] }], kernel: 'export function add(a:i32,b:i32):void{}', glue: good.glue },
  'expectError met by a JavaScript type error, not a trap': { tests: [{ name: 't', fn: 'add', args: [2, 3], expectError: true }], kernel: 'export function add(a:i64,b:i64):i64{return a-b}',
    glue: JSON.stringify({ ...JSON.parse(good.glue), traps: [{ fn: 'add', when: 'inputs are out of range', message: 'Out of range input.' }] }) },
  'expect as an array': { tests: [{ name: 't', fn: 'add', args: [2, 3], expect: [5] }], kernel: good.kernel, glue: good.glue },
  'expect that parses to infinity': { raw: '[{"name":"t","fn":"add","args":[2,3],"expect":1e400}]', kernel: 'export function add(a:i32,b:i32):f64{return 1.0/0.0}', glue: good.glue },
  'an integer expectation past exact range': { raw: '[{"name":"t","fn":"big","args":[],"expect":9007199254740993}]', kernel: 'export function big():i64{return 9007199254740993}', glue: glueFor('big', [], {}) },
};
const inputOf = entry => inputFor('Synthetic contract for one kernel.', entry.raw ?? JSON.stringify(entry.tests), entry.kernel, entry.glue);

for (const [name, entry] of Object.entries(weak)) {
  test(`1, 12: both paths refuse ${name}`, { timeout: 60000 }, async t => {
    const root = scratch(t), current = new IsolatePool({ hostPort: here('../x1/host.mjs'), size: 1 });
    t.after(() => current.close());
    const pool = agentPool(t, modelFor(inputOf(entry)));
    const right = await runNeed({ need, directory: join(root, 'agent'), pool, env, limits: { maxTurns: 2, maxTokens: 64000 } });
    const input = inputOf(entry);
    const left = await runNeed({ need, directory: join(root, 'current'), pool: current,
      env: { ...baseEnv(root), FAKE_CODEX_CONTRACT: input.contract, FAKE_CODEX_TESTS: input.tests, FAKE_CODEX_KERNEL: input.kernel, FAKE_CODEX_GLUE: input.glue } });
    assert.equal(right.promoted, false, 'agent');
    assert.equal(left.promoted, false, 'current');
    assert.equal(existsSync(join(root, 'agent', 'ledger.sqlite')), false);
  });
}

test('1: expectError on a real trap still passes, in both paths', { timeout: 60000 }, async t => {
  const root = scratch(t), entry = { tests: [{ name: 'ok', fn: 'add', args: [2, 3], expect: 5 }, { name: 'high', fn: 'add', args: [11, 0], expectError: true }],
    kernel: 'export function add(a:i32,b:i32):i32{if(a>10){unreachable()}return a+b}', glue: JSON.stringify({ ...JSON.parse(good.glue), traps: [{ fn: 'add', when: 'a is above ten', message: 'Input is out of range.' }] }) };
  const pool = agentPool(t, modelFor(inputOf(entry)));
  const right = await runNeed({ need, directory: join(root, 'agent'), pool, env });
  assert.equal(right.promoted, true, JSON.stringify(right));
  const current = new IsolatePool({ hostPort: here('../x1/host.mjs'), size: 1 });
  t.after(() => current.close());
  const input = inputOf(entry);
  const left = await runNeed({ need, directory: join(root, 'current'), pool: current, env: { ...baseEnv(root), FAKE_CODEX_CONTRACT: input.contract, FAKE_CODEX_TESTS: input.tests, FAKE_CODEX_KERNEL: input.kernel, FAKE_CODEX_GLUE: input.glue } });
  assert.equal(left.promoted, true);
});

test('1: the freeze record says what is known, not a blanket confirmation', { timeout: 60000 }, async t => {
  const root = scratch(t), pool = agentPool(t, modelFor(addInput));
  assert.equal((await runNeed({ need, directory: join(root, 'addition'), pool, env })).promoted, true);
  const frozen = (await records(join(root, 'addition', 'ledger.sqlite'))).find(record => record.kind === 'frozen_evaluator');
  assert.notEqual(frozen.data.freeze.synthesis_context.candidate_blind, 'confirmed');
  assert.notEqual(frozen.data.confirmed_by, 'freeze-before-code supervisor');
  assert.notEqual(frozen.data.freeze.qualification, 'X1 acceptance boundary');
  assert.match(frozen.data.confirmed_by, /^none/);
  assert.match(frozen.data.freeze.qualification, /^none/);
});

for (const [name] of Object.entries(forgeries)) {
  test(`2: the agent path refuses a forged report: ${name}`, { timeout: 60000 }, async t => {
    const root = scratch(t), directory = join(root, 'addition');
    const pool = agentPool(t, modelFor(addInput), { hostPort: forgePort, cellEnv: { EF_FORGE: name } });
    process.env.EF_FORGE = name;
    await pool.ready();
    delete process.env.EF_FORGE;
    const result = await runNeed({ need, directory, pool, env });
    assert.equal(result.promoted, false, JSON.stringify(result.problem));
    const frozen = (await records(join(directory, 'ledger.sqlite'))).find(record => record.kind === 'frozen_evaluator');
    const replay = await ledger('promote', { reference: { ledger: join(directory, 'ledger.sqlite'), identity: frozen.id }, candidate: result.candidate, receipt: result.receipt, decisionPath: join(root, 'replay.json') });
    assert.equal(replay.decision, 'refuse');
  });
}

test('2: a kernel swapped with its module kept is refused on the agent path, and an unforged run promotes', { timeout: 60000 }, async t => {
  const root = scratch(t);
  const pool = agentPool(t, modelFor(addInput), { hostPort: forgePort, cellEnv: { EF_FORGE: 'a kernel swapped by the cell' } });
  process.env.EF_FORGE = 'a kernel swapped by the cell';
  await pool.ready();
  delete process.env.EF_FORGE;
  const result = await runNeed({ need, directory: join(root, 'swapped'), pool, env });
  assert.equal(result.promoted, false);
  assert.match(result.problem ?? '', /source/);
  const control = agentPool(t, modelFor(addInput), { hostPort: forgePort });
  assert.equal((await runNeed({ need, directory: join(root, 'control'), pool: control, env })).promoted, true);
});

test('3: a transport failure after admission loses the attempt, and the task promotes on resume', { timeout: 60000 }, async t => {
  const root = scratch(t), directory = join(root, 'addition');
  const first = agentPool(t, ({ turn }) => { if (turn === 0) return reply(specification(addInput)); throw Error('transport timed out'); });
  const lost = await runNeed({ need, directory, pool: first, env });
  assert.equal(lost.promoted, false);
  const second = agentPool(t, modelFor(addInput));
  const again = await runNeed({ need, directory, pool: second, env, resume: true });
  assert.equal(again.promoted, true, JSON.stringify(again));
  const kinds = (await records(join(directory, 'ledger.sqlite'))).filter(record => record.kind === 'receipt');
  assert.equal(new Set(kinds.map(record => record.id)).size, 2);
  assert.deepEqual(kinds.map(record => record.data.outcome_state), ['inconclusive', 'passed']);
});

test('3: a process cell killed after admission loses the attempt, and the task promotes on resume', { timeout: 60000 }, async t => {
  const root = scratch(t), directory = join(root, 'addition');
  process.env.EF_KILL_STAGE = 'admitted';
  const first = agentPool(t, modelFor(addInput), { isolation: 'process', hostPort: stagePort, cellEnv: { EF_KILL_STAGE: 'admitted' } });
  await first.ready();
  delete process.env.EF_KILL_STAGE;
  assert.equal((await runNeed({ need, directory, pool: first, env })).promoted, false);
  const second = agentPool(t, modelFor(addInput), { isolation: 'process' });
  const again = await runNeed({ need, directory, pool: second, env, resume: true });
  assert.equal(again.promoted, true, JSON.stringify(again));
});

test('3: resume returns a durable promotion without a model call', { timeout: 60000 }, async t => {
  const root = scratch(t), directory = join(root, 'addition');
  const first = agentPool(t, modelFor(addInput));
  const done = await runNeed({ need, directory, pool: first, env });
  assert.equal(done.promoted, true);
  let calls = 0;
  const second = agentPool(t, () => { calls += 1; return reply({ calls: [] }); });
  const again = await runNeed({ need, directory, pool: second, env, resume: true });
  assert.equal(again.promoted, true, JSON.stringify(again));
  assert.equal(again.decision, done.decision);
  assert.equal(calls, 0);
  assert.equal((await records(join(directory, 'ledger.sqlite'))).filter(record => record.kind === 'receipt').length, 1);
});

test('4: an expired deadline and a blank need stop before any model call, as on the current path', { timeout: 60000 }, async t => {
  const root = scratch(t);
  let calls = 0;
  const pool = agentPool(t, args => { calls += 1; return modelFor(addInput)(args); });
  const expired = await runNeed({ need, directory: join(root, 'expired'), pool, env, deadline: Date.now() - 60000 });
  const blank = await runNeed({ need: '   ', directory: join(root, 'blank'), pool, env });
  assert.equal(expired.promoted, false);
  assert.equal(blank.promoted, false);
  assert.equal(calls, 0);
  assert.equal(existsSync(join(root, 'expired', 'ledger.sqlite')), false);
  const current = new IsolatePool({ hostPort: here('../x1/host.mjs'), size: 1 });
  t.after(() => current.close());
  const left = await runNeed({ need, directory: join(root, 'current-expired'), pool: current, env: baseEnv(root), deadline: Date.now() - 60000 });
  const leftBlank = await runNeed({ need: '   ', directory: join(root, 'current-blank'), pool: current, env: baseEnv(root) });
  assert.equal(left.promoted, false);
  assert.equal(leftBlank.promoted, false);
});

test('4: a deadline reached between turns stops the attempt', { timeout: 60000 }, async t => {
  const root = scratch(t);
  const slow = async args => { await new Promise(resolve => setTimeout(resolve, 400)); return reply(args.turn === 0 ? specification(addInput) : implementation(addInput, idOf(args.messages))); };
  const pool = agentPool(t, slow);
  await pool.ready();
  const result = await runNeed({ need, directory: join(root, 'addition'), pool, env, deadline: Date.now() + 200 });
  assert.equal(result.promoted, false);
});

const warmTransport = (root, extra = {}) => new WarmClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, timeoutMs: 1000, base: { PATH: process.env.PATH, HOME: root }, ...extra,
  environment: { FAKE_CLAUDE_LOG: join(root, 'log'), ...extra.environment } });
const logOf = root => readFileSync(join(root, 'log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const say = (...texts) => texts.flatMap((text, index) => (index ? [{ role: 'assistant', content: 'ok' }, { role: 'user', content: text }] : [{ role: 'user', content: text }]));

test('5: the queue for a lane is bounded', { timeout: 30000 }, async t => {
  const root = scratch(t), warm = warmTransport(root, { queueTimeoutMs: 200, environment: { FAKE_CLAUDE_MODE: 'limit' } });
  t.after(() => warm.close());
  await warm.send({ session: 'a', messages: say('one') });
  const begin = Date.now();
  await assert.rejects(warm.send({ session: 'b', messages: say('two') }), /queue/);
  assert(Date.now() - begin < 1000);
});

test('5: a rate-limited lane is rechecked after it resets', { timeout: 30000 }, async t => {
  const root = scratch(t), warm = warmTransport(root, { queueTimeoutMs: 5000, environment: { FAKE_CLAUDE_MODE: 'limit', FAKE_CLAUDE_LIMIT_S: '0.5' } });
  t.after(() => warm.close());
  await warm.send({ session: 'a', messages: say('one') });
  warm.endSession('a');
  const begin = Date.now();
  await warm.send({ session: 'b', messages: say('two') });
  assert(Date.now() - begin >= 300);
});

test('5: a job stuck on the transport ends, and pool.close stays bounded', { timeout: 40000 }, async t => {
  const root = scratch(t), warm = warmTransport(root, { queueTimeoutMs: 300, environment: { FAKE_CLAUDE_MODE: 'limit' } });
  await warm.send({ session: 'a', messages: say('one') });
  warm.endSession('a');
  const pool = createLoopPool({ primes: 1, provider: warm, jobTimeoutMs: 1000 });
  t.after(() => warm.close());
  await pool.ready();
  const outcome = await Promise.race([runNeed({ need, directory: join(root, 'addition'), pool, env }).then(result => result.promoted), new Promise(resolve => setTimeout(() => resolve('stuck'), 10000))]);
  assert.equal(outcome, false);
  const closed = await Promise.race([pool.close().then(() => 'closed'), new Promise(resolve => setTimeout(() => resolve('stuck'), 5000))]);
  assert.equal(closed, 'closed');
});

test('6: ending a session with a turn pending retires the lane, and the next session gets its own reply', { timeout: 30000 }, async t => {
  const root = scratch(t), warm = warmTransport(root, { timeoutMs: 3000, environment: { FAKE_CLAUDE_MS: '300' } });
  t.after(() => warm.close());
  const pending = warm.send({ session: 'A', messages: say('A-turn') }).then(() => 'resolved', () => 'rejected');
  await new Promise(resolve => setTimeout(resolve, 50));
  warm.endSession('A');
  const first = await warm.send({ session: 'B', messages: say('B1') });
  assert.equal(JSON.parse(first.text).to, 'user: B1');
  assert.equal(await pending, 'rejected');
  assert(logOf(root).filter(line => line.start).length >= 2);
});

test('7: a bridge death does not poison the pool, and no specification turn is spent on a dead bridge', { timeout: 60000 }, async t => {
  const root = scratch(t);
  let calls = 0;
  const pool = agentPool(t, args => { calls += 1; return modelFor(addInput)(args); });
  assert.equal((await runNeed({ need, directory: join(root, 'first'), pool, env })).promoted, true);
  const pid = execFileSync('pgrep', ['-P', String(process.pid), 'python3'], { encoding: 'utf8' }).trim().split('\n').at(-1);
  process.kill(Number(pid), 'SIGKILL');
  await new Promise(resolve => setTimeout(resolve, 300));
  const after = await runNeed({ need, directory: join(root, 'second'), pool, env });
  assert.equal(after.promoted, true, JSON.stringify(after));
  assert.equal(pool.halted, false);
});

test('7: a bridge that cannot start halts the pool honestly, before any model call', { timeout: 60000 }, async t => {
  const root = scratch(t), bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'python3'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
  const path = process.env.PATH;
  let calls = 0;
  process.env.PATH = `${bin}:${path}`;
  t.after(() => { process.env.PATH = path; });
  const pool = createLoopPool({ primes: 1, provider: scriptedProvider(() => { calls += 1; return reply({ calls: [] }); }) });
  t.after(() => pool.close().catch(() => {}));
  const result = await runNeed({ need, directory: join(root, 'addition'), pool, env });
  assert.equal(result.promoted, false);
  assert.equal(calls, 0);
  assert.equal(pool.halted, true);
});

const clockPort = here('./fixtures/x1/clock-port.mjs');
test('8: host calls do not extend a job, and a cell spinning during a call is stopped', { timeout: 30000 }, async t => {
  const pool = new IsolatePool({ hostPort: clockPort, size: 1, jobTimeoutMs: 300, hostCall: async call => { if (call.kind === 'hang') return new Promise(() => {}); throw Error('unknown'); } });
  t.after(() => pool.close());
  await pool.ready();
  const run = options => pool.run({ ledger: 'caller', reference: {}, candidates: ['c'], portOptions: options });
  const begin = Date.now();
  const refreshed = await run({ mode: 'refresh', forMs: 3000 });
  assert.equal(refreshed.reason, 'deadline');
  assert(Date.now() - begin < 2000);
  const spinning = await Promise.race([run({ mode: 'spin' }).then(result => result.reason), new Promise(resolve => setTimeout(() => resolve('alive'), 5000))]);
  assert.equal(spinning, 'deadline');
});

test('8: the host limits model calls and tokens, whatever the cell asks', { timeout: 30000 }, async t => {
  const root = scratch(t);
  let calls = 0, remaining;
  const loud = args => { calls += 1; remaining = args.remaining; return args.turn === 0 ? reply(specification(addInput)) : reply('junk'); };
  const pool = agentPool(t, loud, { hostPort: here('./fixtures/x1/greedy-port.mjs') });
  await pool.ready();
  const result = await runNeed({ need, directory: join(root, 'addition'), pool, env, limits: { maxTurns: 3, maxTokens: 25 } });
  assert.equal(result.promoted, false);
  assert(calls <= 3, `served ${calls} calls`);
  assert(remaining <= 25);
});

test('8: a provider refuses a turn past its remaining budget', async t => {
  const root = scratch(t), warm = warmTransport(root);
  t.after(() => warm.close());
  await assert.rejects(warm.send({ session: 'a', messages: say('one'), remaining: 0 }), /budget/);
  await assert.rejects(warm.send({ session: 'a', messages: say('one'), remaining: 2 }), /budget/);
  const scripted = scriptedProvider(() => reply('x', 50));
  await assert.rejects(scripted.send({ session: 'a', messages: say('one'), remaining: 2 }), /budget/);
});

test('9: a process cell in a tight loop dies with a killed supervisor', { timeout: 40000 }, async t => {
  const root = scratch(t);
  const child = spawn(process.execPath, [here('./fixtures/x1/spin-driver.mjs'), root], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(resolve => child.stdout.once('data', resolve));
  const cells = execFileSync('pgrep', ['-P', String(child.pid), '-f', 'isolate-workcell'], { encoding: 'utf8' }).trim().split('\n').map(Number);
  assert(cells.length >= 1);
  child.kill('SIGKILL');
  await new Promise(resolve => setTimeout(resolve, 3000));
  const alive = cells.filter(pid => spawnSync('kill', ['-0', String(pid)]).status === 0);
  for (const pid of alive) process.kill(pid, 'SIGKILL');
  assert.deepEqual(alive, []);
});

test('10: the spawn transport refuses an API key source', { timeout: 30000 }, async t => {
  const root = scratch(t);
  const per = new SpawnClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, base: { PATH: process.env.PATH }, environment: { FAKE_CLAUDE_MODE: 'apikey' } });
  await assert.rejects(per.send({ messages: say('one') }), /subscription/);
  const none = new SpawnClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, base: { PATH: process.env.PATH }, environment: { FAKE_CLAUDE_MODE: 'noinit' } });
  await assert.rejects(none.send({ messages: say('one') }), /subscription/);
});

test('10: warm fails closed with no init, refuses key variables, and sends no prompt before init', { timeout: 30000 }, async t => {
  const root = scratch(t);
  const none = warmTransport(root, { environment: { FAKE_CLAUDE_MODE: 'noinit' } });
  t.after(() => none.close());
  await assert.rejects(none.send({ session: 'a', messages: say('secret-prompt') }), /subscription/);
  assert.equal(logOf(root).filter(line => line.text).length, 0);
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY']) {
    assert.throws(() => warmTransport(root, { environment: { [name]: 'synthetic' } }), /credential/);
    assert.throws(() => new SpawnClaudeTransport({ model: 'stub', command: fakeClaude, environment: { [name]: 'synthetic' } }), /credential/);
  }
  const keyed = warmTransport(root, { environment: { FAKE_CLAUDE_MODE: 'apikey', FAKE_CLAUDE_LOG: join(root, 'keyed') } });
  t.after(() => keyed.close());
  await assert.rejects(keyed.send({ session: 'a', messages: say('secret-prompt') }), /subscription/);
  assert(!readFileSync(join(root, 'keyed'), 'utf8').includes('secret-prompt'));
  const started = new WarmClaudeTransport({ model: 'stub', command: fakeClaude, base: { PATH: process.env.PATH }, environment: { FAKE_CLAUDE_LOG: join(root, 'cwd') } });
  t.after(() => started.close());
  await started.start();
  const { cwd } = JSON.parse(readFileSync(join(root, 'cwd'), 'utf8').split('\n')[0]);
  assert.notEqual(cwd, process.cwd());
  assert.deepEqual(statSync(cwd).isDirectory(), true);
});

test('11: the default cell is a separate process that cannot read the environment or other files', { timeout: 30000 }, async t => {
  const root = scratch(t), path = join(root, 'synthetic-file');
  writeFileSync(path, 'readable');
  process.env.SYNTHETIC_SECRET = 'synthetic';
  const pool = createLoopPool({ primes: 0, hostPort: here('./fixtures/x1/env-port.mjs') });
  await pool.ready();
  delete process.env.SYNTHETIC_SECRET;
  t.after(() => pool.close());
  const result = await pool.run({ ledger: 'caller', reference: {}, candidates: ['c'], portOptions: { path } });
  assert.equal(result.isolation, 'process');
  assert.notEqual(result.report?.file, 'readable');
  assert.equal(result.report?.env ?? null, null);
});

test('13: reaching the turn or token limit does not promote, even with a good kernel in the overlay', { timeout: 60000 }, async t => {
  const root = scratch(t);
  const noDone = args => {
    if (args.turn === 0) return reply(specification(addInput));
    return reply({ calls: implementation(addInput, idOf(args.messages)).calls.filter(call => call.name !== 'done') });
  };
  const pool = agentPool(t, noDone);
  const turns = await runNeed({ need, directory: join(root, 'turns'), pool, env, limits: { maxTurns: 2, maxTokens: 64000 } });
  assert.equal(turns.agent?.exit_reason, 'max_turns');
  assert.equal(turns.promoted, false);
  const costly = args => {
    if (args.turn === 0) return reply(specification(addInput), 10);
    return reply({ calls: implementation(addInput, idOf(args.messages)).calls }, 2000);
  };
  const expensive = agentPool(t, costly);
  const tokens = await runNeed({ need, directory: join(root, 'tokens'), pool: expensive, env, limits: { maxTurns: 5, maxTokens: 1000 } });
  assert.equal(tokens.promoted, false);
});

test('13: cache reads count against the token budget', async t => {
  const root = scratch(t), warm = warmTransport(root, { environment: { FAKE_CLAUDE_CACHE_READ: '100' } });
  t.after(() => warm.close());
  const answer = await warm.send({ session: 'a', messages: say('one') });
  assert.equal(answer.usage, 105);
});

test('14: the counter sees writes on an open file and memfd, not only opens', { timeout: 60000 }, async t => {
  const root = scratch(t), tracer = join(root, 'syscount'), log = join(root, 'log');
  execFileSync('gcc', ['-O1', '-o', tracer, here('../../../experiments/P-50-in-isolate/syscount.c')]);
  const run = spawnSync(tracer, [log, process.execPath, here('./fixtures/x1/tracer-child.mjs'), root], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const seen = windows(log);
  assert(seen.x.toAdmit.writes.length >= 2, JSON.stringify(seen.x.toAdmit.writes));
  assert(seen.y.toAdmit.writes.length >= 1);
  assert(seen.y.toAdmit.spawns.length >= 1);
  assert.deepEqual(seen.z.toAdmit.writes, []);
});

test('15: a generic pool does not need the X1 ledger policy', { timeout: 60000 }, async t => {
  const root = scratch(t), copy = join(root, 'copy');
  for (const part of ['core', 'tools/factory_quality', 'experiments/assemblyscript-toolchain.mjs']) cpSync(join(repository, part), join(copy, part), { recursive: true });
  mkdirSync(join(copy, 'tools/asc'), { recursive: true });
  cpSync(join(repository, 'tools/asc/pin.mjs'), join(copy, 'tools/asc/pin.mjs'));
  symlinkSync(join(repository, 'tools/asc/node_modules'), join(copy, 'tools/asc/node_modules'));
  const script = join(copy, 'ready.mjs');
  writeFileSync(script, `import { IsolatePool } from './core/runtime/isolate-pool.mjs';
const pool = new IsolatePool({ hostPort: './core/runtime/x1/host.mjs', size: 1 });
await pool.ready();
await pool.close();
console.log('ready');`);
  assert.equal(spawnSync(process.execPath, [script], { cwd: copy, encoding: 'utf8' }).stdout.trim(), 'ready');
});
