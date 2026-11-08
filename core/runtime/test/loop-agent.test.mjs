import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { IsolatePool } from '../isolate-pool.mjs';
import { ledger } from '../x1/ledger.mjs';
import { createLoopPool } from '../x1/loop.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider, SpawnClaudeTransport, WarmClaudeTransport } from '../x1/transports.mjs';
import { candidate } from './fixtures/x1/candidate.mjs';
import { idOf, implementation, inputFor, modelFor, reply, specification, stageOf } from './fixtures/x1/scripted-model.mjs';
import { good, seeds } from './fixtures/x1/seeds.mjs';
import { python } from './fixtures/ledger-fixture.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const fakeClaude = here('./fixtures/x1/fake-claude.mjs');
const { files } = candidate();
const input = seed => inputFor(files['CONTRACT.md'], files['tests.json'], seed.kernel, seed.glue);
const need = 'integer add(a,b)';
const env = { ENDOFORGE_LOOP: 'agent' };
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-agent-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const records = ledgerPath => python(`
import json, sys
from core.ledger.ledger import Ledger
print(json.dumps(Ledger(json.load(sys.stdin)['ledger']).records()))
`, { ledger: ledgerPath });
const agentPool = (t, script, options = {}) => {
  const pool = createLoopPool({ primes: 1, provider: scriptedProvider(script), ...options });
  t.after(() => pool.close());
  return pool;
};
const storedDecision = directory => python(`
import json, sqlite3, sys
db = sqlite3.connect(json.load(sys.stdin)['ledger'])
print(db.execute('SELECT body FROM x1_decisions ORDER BY rowid DESC').fetchone()[0])
`, { ledger: join(directory, 'ledger.sqlite') });
const gateVector = async directory => {
  const receipt = (await records(join(directory, 'ledger.sqlite'))).find(record => record.kind === 'receipt');
  if (!receipt) return null;
  const attempts = receipt.data.observations[0].report?.attempts ?? [];
  const x1 = attempts.flatMap(attempt => attempt.results).filter(check => check.check === 'residual').map(check => { try { return JSON.parse(check.reason); } catch { return null; } }).filter(Boolean);
  return { outcome: receipt.data.outcome_state, rounds: x1.map(result => Object.fromEntries(Object.entries(result.gates).map(([name, gate]) => [name, gate.ok]))) };
};

test('the agent loop promotes with only the ledger and the decision on disk', { timeout: 30000 }, async t => {
  const root = scratch(t), directory = join(root, 'addition'), pool = agentPool(t, modelFor(input(good)));
  const result = await runNeed({ need, directory, pool, env });
  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.deepEqual(readdirSync(directory).filter(name => !name.startsWith('ledger.sqlite')), []);
  assert.deepEqual((await records(join(directory, 'ledger.sqlite'))).map(record => record.kind), ['task', 'admitted_input', 'frozen_evaluator', 'candidate', 'receipt']);
  assert.equal(result.agent.exit_reason, 'stop');
  assert.equal(result.agent.turns, 2);
  const decision = await storedDecision(directory);
  assert.equal(decision.decision, 'promote');
  assert.equal(decision.sha256, result.decision);
  const replay = await ledger('promote', { reference: { ledger: join(directory, 'ledger.sqlite'), identity: decision.frozen_evaluator }, candidate: result.candidate, receipt: result.receipt, decisionPath: join(root, 'replay.json') });
  assert.equal(replay.decision, 'promote');
});

test('a failed check goes straight back to the next model turn in the same job', { timeout: 30000 }, async t => {
  const root = scratch(t), seen = [];
  const pool = agentPool(t, ({ messages, turn }) => {
    if (turn === 0) return reply(specification(input(good)));
    if (turn === 1) return reply(implementation(input(seeds[1]), idOf(messages)));
    seen.push(messages.at(-1).content);
    return reply({ calls: [{ name: 'edit_file', path: 'kernel.ts', content: good.kernel }, { name: 'done' }] });
  });
  const result = await runNeed({ need, directory: join(root, 'addition'), pool, env });
  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(result.agent.turns, 3);
  assert.match(seen[0], /G4_tests/);
});

test('turn and token limits stop the loop, and the attempt is a recorded failure', { timeout: 30000 }, async t => {
  const root = scratch(t);
  const pool = agentPool(t, ({ messages, turn }) => (turn === 0 ? reply(specification(input(good))) : reply({ calls: implementation(input(good), idOf(messages)).calls.filter(call => call.name !== 'done') })));
  const turns = await runNeed({ need, directory: join(root, 'turns'), pool, env, limits: { maxTurns: 3, maxTokens: 64000 } });
  assert.equal(turns.promoted, false);
  assert.equal(turns.agent.exit_reason, 'max_turns');
  assert.equal(turns.agent.turns, 4);
  assert.equal((await gateVector(join(root, 'turns'))).outcome, 'failed');
  const tokens = await runNeed({ need, directory: join(root, 'tokens'), pool, env, limits: { maxTurns: 3, maxTokens: 5 } });
  assert(tokens.modelMs >= 0);
  assert.equal(tokens.promoted, false);
  assert.equal(tokens.error, 'pipeline stage failed; inspect local artifacts');
  assert.equal(existsSync(join(root, 'tokens', 'ledger.sqlite')), false);
});

test('the model cannot change the frozen files, leave the overlay, or get past junk', { timeout: 30000 }, async t => {
  const root = scratch(t), results = [];
  const pool = agentPool(t, ({ messages, turn }) => {
    if (turn === 0) return reply(specification(input(good)));
    if (turn === 1) return reply('not json at all');
    if (turn === 2) { results.push(messages.at(-1).content); return reply({ calls: Array.from({ length: 17 }, () => ({ name: 'check' })) }); }
    if (turn === 3) { results.push(messages.at(-1).content); return reply({ calls: [{ name: 'edit_file', path: 'tests.json', content: '[]' }, { name: 'edit_file', path: '../../etc/passwd', content: 'x' }, { name: 'read_file', path: '/etc/passwd' }, { name: 'edit_file', path: 'kernel.ts', content: 'x'.repeat(70000) }] }); }
    if (turn === 4) { results.push(messages.at(-1).content); return reply(implementation(input(good), idOf(messages))); }
    return reply({ calls: [] });
  });
  const result = await runNeed({ need, directory: join(root, 'addition'), pool, env });
  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.match(results[0], /one JSON object/);
  assert.match(results[1], /too many calls/);
  assert.match(results[2], /path refused/);
  assert.match(results[2], /no such file/);
  assert.match(results[2], /file too large/);
  const replyDigest = (await records(join(root, 'addition', 'ledger.sqlite'))).find(record => record.kind === 'candidate');
  assert.equal(JSON.parse(replyDigest.data.content).files['tests.json'], files['tests.json']);
});

test('seeded bad kernels get the same verdict as the current path', { timeout: 120000 }, async t => {
  const root = scratch(t), asc = here('../../../tools/asc/node_modules/.bin/asc');
  const current = new IsolatePool({ hostPort: here('../x1/host.mjs'), size: 1, jobTimeoutMs: 4000 });
  t.after(() => current.close());
  mkdirSync(join(root, 'current')); mkdirSync(join(root, 'agent'));
  const baseEnv = { ...process.env, CODEX_HOME: join(root, 'h'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_ASC_CMD: asc, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, here('./fixtures/x1/fake-codex.mjs')]) };
  const script = seed => modelFor(input(seed));
  for (const seed of [good, ...seeds]) {
    const pool = createLoopPool({ primes: 1, jobTimeoutMs: 4000, provider: scriptedProvider(({ messages }) => {
      if (stageOf(messages) === 'implementation' && messages.length > 3) return reply({ calls: [{ name: 'done' }] });
      return script(seed)({ messages });
    }) });
    const left = await runNeed({ need, directory: join(root, 'current', seed.name), pool: current, env: { ...baseEnv, FAKE_CODEX_KERNEL: seed.kernel, FAKE_CODEX_GLUE: seed.glue } });
    const right = await runNeed({ need, directory: join(root, 'agent', seed.name), pool, env, limits: { maxTurns: 2, maxTokens: 64000 } });
    await pool.close();
    assert.equal(right.promoted, left.promoted, seed.name);
    assert.equal(right.promoted, seed === good, seed.name);
    if (!seed.slow) assert.deepEqual(await gateVector(join(root, 'agent', seed.name)), await gateVector(join(root, 'current', seed.name)), seed.name);
    else assert.equal((await gateVector(join(root, 'agent', seed.name))).outcome, 'failed');
  }
});

test('the job deadline stops compute and does not count the model wait', { timeout: 30000 }, async t => {
  const root = scratch(t);
  const slow = async args => { await new Promise(resolve => setTimeout(resolve, 1000)); return modelFor(input(good))(args); };
  const pool = agentPool(t, slow, { jobTimeoutMs: 800 });
  await pool.ready();
  const result = await runNeed({ need, directory: join(root, 'slow'), pool, env });
  assert.equal(result.promoted, true, JSON.stringify(result));
  assert(result.modelMs >= 1800);
});

test('a transport failure before admission leaves nothing, and after admission an inconclusive receipt', { timeout: 30000 }, async t => {
  const root = scratch(t);
  const early = agentPool(t, () => { throw Error('down'); });
  const first = await runNeed({ need, directory: join(root, 'early'), pool: early, env });
  assert.equal(first.promoted, false);
  assert.equal(existsSync(join(root, 'early')), false);
  const late = agentPool(t, ({ turn }) => { if (turn === 0) return reply(specification(input(good))); throw Error('down'); });
  const second = await runNeed({ need, directory: join(root, 'late'), pool: late, env });
  assert.equal(second.promoted, false);
  assert.equal(second.status, 'inconclusive');
  assert.deepEqual((await records(join(root, 'late', 'ledger.sqlite'))).map(record => record.kind), ['task', 'admitted_input', 'frozen_evaluator', 'candidate', 'receipt']);
});

test('only the reply text and usage reach the cell and its records', { timeout: 30000 }, async t => {
  const root = scratch(t), secret = 'synthetic-secret-value';
  const pool = agentPool(t, args => ({ ...modelFor(input(good))(args), credential: secret }));
  const result = await runNeed({ need, directory: join(root, 'addition'), pool, env });
  assert.equal(result.promoted, true);
  assert(!readFileSync(join(root, 'addition', 'ledger.sqlite')).includes(secret));
});

test('a tampered frozen record refuses the commit, with no promotion', { timeout: 30000 }, async t => {
  const root = scratch(t), directory = join(root, 'addition'), pool = agentPool(t, modelFor(input(good)));
  const result = await runNeed({ need, directory, pool, env, observe: stage => {
    if (stage !== 'committing') return;
    execFileSync('python3', ['-B', '-c', `
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('DROP TRIGGER no_update')
    db.execute("UPDATE records SET body=replace(body, 'X1 G1-G7', 'X1 G1-G6') WHERE seq=3")
`, join(directory, 'ledger.sqlite')]);
  } });
  assert.equal(result.promoted, false);
  assert.equal(result.error, 'pipeline stage failed; inspect local artifacts');
});

test('a swapped provider leaves the loop unchanged', { timeout: 30000 }, async t => {
  const root = scratch(t), log = join(root, 'claude.log');
  const provider = new WarmClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, base: { ...process.env, FAKE_CLAUDE_LOG: log } });
  const pool = createLoopPool({ primes: 1, provider });
  t.after(async () => { await pool.close(); await provider.close(); });
  const result = await runNeed({ need, directory: join(root, 'addition'), pool, env, limits: { maxTurns: 1, maxTokens: 64000 } });
  assert.equal(result.promoted, false);
  assert.equal(result.modelMs > 0, true);
});

const transport = (root, extra = {}) => new WarmClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, base: { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: 'synthetic' }, environment: { FAKE_CLAUDE_LOG: join(root, 'log') }, ...extra });
const logOf = root => readFileSync(join(root, 'log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const messages = (...texts) => texts.flatMap((text, index) => (index ? [{ role: 'assistant', content: 'ok' }, { role: 'user', content: text }] : [{ role: 'user', content: text }]));

test('the warm transport spawns once, sends only new turns and clears between sessions', async t => {
  const root = scratch(t), warm = transport(root);
  t.after(() => warm.close());
  await warm.start();
  await warm.send({ session: 'a', messages: messages('one') });
  await warm.send({ session: 'a', messages: messages('one', 'two') });
  warm.endSession('a');
  await warm.send({ session: 'b', messages: messages('three') });
  const log = logOf(root);
  assert.equal(log.filter(line => line.start).length, 1);
  assert.deepEqual(log.filter(line => line.text).map(line => [line.text, line.history]), [['user: one', 1], ['user: two', 2], ['user: three', 1]]);
  assert.equal(log.filter(line => line.clear).length, 2);
  const { argv, env: seen, cwd } = log[0];
  assert.equal(argv[argv.indexOf('--tools') + 1], '');
  for (const flag of ['--no-session-persistence', '--strict-mcp-config', '--safe-mode']) assert(argv.includes(flag));
  assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(cwd, root);
  assert(!seen.includes('ANTHROPIC_API_KEY'));
  assert(seen.includes('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'));
});

for (const mode of ['tools', 'apikey']) {
  test(`the warm transport refuses a session reporting ${mode}`, async t => {
    const root = scratch(t), warm = transport(root, { environment: { FAKE_CLAUDE_MODE: mode } });
    t.after(() => warm.close());
    await assert.rejects(warm.send({ session: 'a', messages: messages('one') }), /text-only subscription/);
  });
}

test('a dead lane takes no prompt: the next session gets a new process with the full history', async t => {
  const root = scratch(t), warm = transport(root, { environment: { FAKE_CLAUDE_LOG: join(root, 'log'), FAKE_CLAUDE_MODE: 'die' } });
  t.after(() => warm.close());
  await assert.rejects(warm.send({ session: 'a', messages: messages('one') }), /transport/);
  const live = transport(root);
  t.after(() => live.close());
  await live.send({ session: 'a', messages: messages('one') });
  const lane = await live.send({ session: 'a', messages: messages('one', 'two') });
  assert.equal(JSON.parse(lane.text).seen, 2);
});

test('a hung turn times out and kills its process; idle lanes are released', async t => {
  const root = scratch(t), hung = transport(root, { environment: { FAKE_CLAUDE_MODE: 'hang' }, timeoutMs: 200 });
  t.after(() => hung.close());
  await assert.rejects(hung.send({ session: 'a', messages: messages('one') }), /timed out/);
  const idle = transport(root, { idleMs: 100 });
  t.after(() => idle.close());
  await idle.send({ session: 'a', messages: messages('one') });
  idle.endSession('a');
  await new Promise(resolve => setTimeout(resolve, 300));
  await idle.send({ session: 'b', messages: messages('two') });
  assert.equal(logOf(root).filter(line => line.start).length, 2);
  assert.equal(idle.startups.length, 2);
});

test('instances keep one config directory each, route around a usage limit, and park when every instance is limited', async t => {
  const root = scratch(t), one = join(root, 'one'), two = join(root, 'two');
  mkdirSync(one); mkdirSync(two);
  assert.throws(() => transport(root, { instances: [{ configDir: join(root, 'absent') }] }), /must already exist/);
  const routed = transport(root, { instances: [{ name: 'one', configDir: one }, { name: 'two', configDir: two }],
    environment: { FAKE_CLAUDE_LOG: join(root, 'log'), FAKE_CLAUDE_MODE: 'limit' } });
  t.after(() => routed.close());
  await routed.send({ session: 'a', messages: messages('one') });
  routed.endSession('a');
  await routed.send({ session: 'b', messages: messages('two') });
  routed.endSession('b');
  await assert.rejects(routed.send({ session: 'c', messages: messages('three') }), error => error.code === 'USAGE_PARKED' && error.exitCode === 75 && error.outcome === 'outcome_unknown');
  assert.equal(logOf(root).filter(line => line.start).length, 2);
});

test('the spawn transport takes the full history with its tools off, once per turn', async t => {
  const root = scratch(t), per = new SpawnClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, environment: { FAKE_CLAUDE_LOG: join(root, 'log') } });
  await per.send({ session: 'a', messages: messages('one', 'two') });
  await per.send({ session: 'a', messages: messages('one', 'two', 'three') });
  assert.equal(per.spawns, 2);
  const log = logOf(root);
  assert.match(log.filter(line => line.text).at(-1).text, /one[\s\S]*two[\s\S]*three/);
  assert(log[0].argv.includes('--disable-slash-commands'));
});
