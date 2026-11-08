import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DEFAULT_CEILING, EX_TEMPFAIL, UsageGovernor, UsageParked, governorFor, isParked, readRateLimit, watchdogEnvironment } from '../usage-governor.mjs';
import { SpawnClaudeTransport, WarmClaudeTransport } from '../x1/transports.mjs';
import { recorded, windowEvent } from './fixtures/usage-events.mjs';

const fakeClaude = fileURLToPath(new URL('./fixtures/x1/fake-claude-usage.mjs', import.meta.url));
const reset = 1794607200000;
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-usage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const clock = (at = reset - 86400000) => { const now = () => clock.at; clock.at = at; return now; };
const governor = (root, options = {}) => new UsageGovernor({ statePath: join(root, 'state.json'), now: clock(), ...options });
const logOf = root => (existsSync(join(root, 'log')) ? readFileSync(join(root, 'log'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
const messages = text => [{ role: 'user', content: text }];

test('the recorded P-64 rate_limit_event parses into its window, reset, status and overage fields', () => {
  const reading = readRateLimit(recorded);
  assert.deepEqual(reading, {
    status: 'allowed', type: 'seven_day', resetsAt: reset,
    windows: { seven_day: { utilization: 0.1, resetsAt: reset, status: 'allowed' } },
    overage: { status: 'rejected', reason: 'out_of_credits', using: false }, errorCode: null,
  });
  assert.equal(readRateLimit({ type: 'result' }), null);
  assert.deepEqual(readRateLimit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1794607200, utilization: 1, rateLimitType: 'five_hour' } }).windows,
    { five_hour: { utilization: 1, resetsAt: reset, status: 'rejected' } });
});

test('admission holds a projected ceiling with the per-call reserve, and parks with a distinct code', t => {
  const root = scratch(t), g = governor(root);
  assert.equal(g.ceiling, DEFAULT_CEILING);
  g.observe(windowEvent({ utilization: 0.8485 }));
  const first = g.admit();
  assert.throws(() => g.admit(), error => {
    assert(error instanceof UsageParked);
    assert(isParked(error));
    assert.equal(error.exitCode, EX_TEMPFAIL);
    assert.equal(error.code, 'USAGE_PARKED');
    assert.equal(error.outcome, 'outcome_unknown');
    assert.equal(error.resumeAt, reset);
    assert.equal(error.window, 'seven_day');
    return true;
  });
  first.release();
  g.observe(windowEvent({ utilization: 0.8495 }));
  assert.throws(() => g.admit(), UsageParked);
  const lenient = governor(root, { ceiling: 0.95 });
  lenient.observe(windowEvent({ utilization: 0.8495 }));
  lenient.admit().release();
});

test('allowed_warning and rejected park at any utilization until the reset, then admission resumes', t => {
  const root = scratch(t), g = governor(root);
  g.observe(windowEvent({ utilization: 0.2, status: 'allowed_warning' }));
  assert.throws(() => g.admit(), /allowed_warning/);
  g.observe(windowEvent({ utilization: 0.2, status: 'rejected' }));
  assert.throws(() => g.admit(), /rejected/);
  clock.at = reset + 1;
  g.admit().release();
});

test('a login drawing on usage credits is parked, so the governor never extends billing', t => {
  const root = scratch(t), g = governor(root);
  g.observe(windowEvent({ utilization: 0.2, overage: { isUsingOverage: true, overageStatus: 'allowed' } }));
  assert.throws(() => g.admit(), /usage credits/);
});

test('concurrent processes agree through one atomic state file, and config directories stay separate', t => {
  const root = scratch(t), statePath = join(root, 'state.json');
  const now = clock(), writer = new UsageGovernor({ statePath, scope: 'a', now }), reader = new UsageGovernor({ statePath, scope: 'a', now });
  const other = new UsageGovernor({ statePath, scope: 'b', now });
  reader.admit().release();
  writer.observe(windowEvent({ utilization: 0.9 }));
  assert.throws(() => reader.admit(), UsageParked);
  other.admit().release();
  assert.deepEqual(readdirSync(root), ['state.json']);
  const stored = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(stored.scopes.a.windows.seven_day.utilization, 0.9);
  assert.equal(governorFor(join(root, 'cfg'), { statePath }), governorFor(join(root, 'cfg'), { statePath }));
  assert.notEqual(governorFor(join(root, 'cfg'), { statePath }), governorFor(join(root, 'cfg2'), { statePath }));
});

test('an unreadable state file never blocks admission and is replaced on the next observation', t => {
  const root = scratch(t), g = governor(root);
  writeFileSync(join(root, 'state.json'), '{"scopes": [tor');
  g.admit().release();
  g.observe(windowEvent({ utilization: 0.3 }));
  assert.equal(JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')).scopes.default.windows.seven_day.utilization, 0.3);
  mkdirSync(join(root, 'blocked'));
  const unwritable = governor(root, { statePath: join(root, 'blocked') });
  assert.equal(unwritable.observe(windowEvent({ utilization: 0.9 })).windows.seven_day.utilization, 0.9);
  assert.throws(() => unwritable.admit(), UsageParked);
});

test('in-flight calls finish after a stop; only new launches are refused', t => {
  const root = scratch(t), g = governor(root);
  g.observe(windowEvent({ utilization: 0.5 }));
  const running = g.admit();
  g.observe(windowEvent({ utilization: 0.5, status: 'rejected' }));
  assert.equal(g.inFlight, 1);
  running.release();
  running.release();
  assert.equal(g.inFlight, 0);
  assert.throws(() => g.admit(), UsageParked);
});

test('the observed per-call cost replaces the prior once usage moves, and usage per accepted candidate is reported', t => {
  const root = scratch(t), g = governor(root, { perCallPrior: 0.0001 });
  g.observe(windowEvent({ utilization: 0.1 }));
  for (let i = 0; i < 16; i++) g.admit().release();
  g.recordAccepted(4);
  g.observe(windowEvent({ utilization: 0.11 }));
  const metric = g.metric();
  assert.equal(metric.calls, 16);
  assert.equal(metric.accepted, 4);
  assert(Math.abs(metric.spent - 0.01) < 1e-12);
  assert(Math.abs(metric.perCall - 0.000625) < 1e-12);
  assert(Math.abs(metric.perAccepted - 0.0025) < 1e-12);
  assert.equal(g.metric({ accepted: 2 }).perAccepted, metric.spent / 2);
  assert(Math.abs(g.perCall('seven_day') - 0.000625) < 1e-12);
  g.observe(windowEvent({ utilization: 0.848 }));
  assert(Math.abs(g.perCall('seven_day') - 0.748 / 16) < 1e-12);
  assert.throws(() => g.admit(), /projects to/);
});

test('ceiling and prior are validated, and the ceiling can come from the environment', t => {
  const root = scratch(t);
  assert.throws(() => governor(root, { ceiling: 0 }), /ceiling/);
  assert.throws(() => governor(root, { ceiling: 1.5 }), /ceiling/);
  assert.throws(() => governor(root, { perCallPrior: -1 }), /prior/);
  assert.equal(governor(root, { env: { ENDOFORGE_USAGE_CEILING: '0.7' } }).ceiling, 0.7);
  assert.throws(() => governor(root, { env: { ENDOFORGE_USAGE_CEILING: 'lots' } }), /ceiling/);
});

test('the retry watchdog is opt-in, bounded below the transport timeout, and passes its documented variables', () => {
  assert.deepEqual(watchdogEnvironment(undefined, { base: {} }), {});
  assert.deepEqual(watchdogEnvironment(true, { base: {}, timeoutMs: 1800000 }),
    { CLAUDE_CODE_RETRY_WATCHDOG: '1', CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS: '900000', CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS: '300000' });
  assert.deepEqual(watchdogEnvironment(undefined, { base: { CLAUDE_CODE_RETRY_WATCHDOG: '1', CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS: '60000', CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS: '120000' }, timeoutMs: 300000 }),
    { CLAUDE_CODE_RETRY_WATCHDOG: '1', CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS: '60000', CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS: '120000' });
  assert.deepEqual(watchdogEnvironment(false, { base: { CLAUDE_CODE_RETRY_WATCHDOG: '1' } }), {});
  assert.throws(() => watchdogEnvironment({ maxWaitMs: 300000 }, { base: {}, timeoutMs: 300000 }), /before the transport timeout/);
  assert.throws(() => watchdogEnvironment({ recheckMs: 1000 }, { base: {}, timeoutMs: 300000 }), /60000 to 10800000/);
});

test('the spawn transport records each stream, parks before spawning, and tags replies with usage', async t => {
  const root = scratch(t), statePath = join(root, 'state.json'), g = new UsageGovernor({ statePath, scope: 'spawn' });
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  const per = new SpawnClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, governor: g, watchdog: { maxWaitMs: 60000 },
    environment: { FAKE_CLAUDE_LOG: join(root, 'log'), FAKE_CLAUDE_RATE: JSON.stringify({ status: 'allowed', resetsAt, rateLimitType: 'seven_day', unifiedWindows: { seven_day: { utilization: 0.4, resetsAt, status: 'allowed' } } }) } });
  const reply = await per.send({ session: 'a', messages: messages('one') });
  assert.equal(reply.rateLimit.windows.seven_day.utilization, 0.4);
  assert.equal(g.inFlight, 0);
  assert.equal(g.metric().calls, 1);
  const env = logOf(root)[0].env;
  assert(env.includes('CLAUDE_CODE_RETRY_WATCHDOG') && env.includes('CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS'));
  const stopped = new SpawnClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, governor: g,
    environment: { FAKE_CLAUDE_LOG: join(root, 'log'), FAKE_CLAUDE_RATE: JSON.stringify({ status: 'allowed_warning', resetsAt, rateLimitType: 'seven_day', unifiedWindows: { seven_day: { utilization: 0.8, resetsAt, status: 'allowed_warning' } } }) } });
  await stopped.send({ session: 'b', messages: messages('two') });
  await assert.rejects(stopped.send({ session: 'c', messages: messages('three') }), error => isParked(error) && error.resumeAt === resetsAt * 1000);
  assert.equal(logOf(root).filter(line => line.start).length, 2);
  assert.equal(g.inFlight, 0);
  await per.close(); await stopped.close();
});

test('the warm transport routes around a parked instance and refuses at once when every instance is parked', async t => {
  const root = scratch(t), one = join(root, 'one'), two = join(root, 'two'), statePath = join(root, 'state.json');
  mkdirSync(one); mkdirSync(two);
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  governorFor(one, { statePath }).observe(windowEvent({ utilization: 0.9, resetsAt }));
  const warm = new WarmClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, usageState: statePath, queueTimeoutMs: 2000,
    instances: [{ name: 'one', configDir: one }, { name: 'two', configDir: two }], environment: { FAKE_CLAUDE_LOG: join(root, 'log') } });
  t.after(() => warm.close());
  const routed = await warm.send({ session: 'a', messages: messages('one') });
  assert.equal(JSON.parse(routed.text).seen, 1);
  assert.equal(logOf(root).filter(line => line.start).length, 1);
  warm.endSession('a');
  governorFor(two, { statePath }).observe(windowEvent({ utilization: 0.2, status: 'rejected', resetsAt }));
  await assert.rejects(warm.send({ session: 'b', messages: messages('two') }), error => isParked(error) && error.resumeAt === resetsAt * 1000);
  assert.equal(logOf(root).filter(line => line.text).length, 1);
});
