import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { EX_CONFIG, requireSubscription, SubscriptionRefused, subscriptionEnvironment, subscriptionProof, unsetArguments } from '../subscription-guard.mjs';
import { SpawnClaudeTransport } from '../x1/transports.mjs';
import { subscribedConfig, subscribedHome } from './fixtures/subscription.mjs';

const guard = fileURLToPath(new URL('../subscription-guard.mjs', import.meta.url));
const fakeClaude = fileURLToPath(new URL('./fixtures/x1/fake-claude.mjs', import.meta.url));
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-subscription-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const managedSettings = '/nonexistent/managed-settings.json';
const proof = (env, extra = {}) => subscriptionProof({ env, managedSettings, ...extra });

test('a subscription OAuth login is allowed', t => {
  const home = subscribedHome(scratch(t));
  const result = proof({ HOME: home });
  assert.deepEqual({ ...result }, { ok: true, configDir: join(home, '.claude'), subscriptionType: 'max' });
  const dir = subscribedConfig(join(home, 'accounts', 'one'), { subscriptionType: 'pro' });
  assert.equal(proof({ HOME: home, CLAUDE_CONFIG_DIR: dir }).subscriptionType, 'pro');
  assert.equal(subscriptionProof({ env: { HOME: home }, configDir: dir, managedSettings }).configDir, dir);
});

test('an API key or billing switch in the environment is refused', t => {
  const home = subscribedHome(scratch(t));
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'AWS_BEARER_TOKEN_BEDROCK']) {
    const result = proof({ HOME: home, [name]: 'synthetic' });
    assert.equal(result.ok, false, name);
    assert.match(result.reason, new RegExp(name));
  }
  assert.throws(() => requireSubscription({ env: { HOME: home, ANTHROPIC_API_KEY: 'synthetic' }, managedSettings }), error => error instanceof SubscriptionRefused && error.exitCode === EX_CONFIG);
});

test('an API key helper or env override in settings is refused', t => {
  const root = scratch(t);
  for (const [file, body, pattern] of [
    ['.claude/settings.json', { apiKeyHelper: '/bin/echo' }, /apiKeyHelper/],
    ['.claude/settings.local.json', { env: { ANTHROPIC_API_KEY: 'synthetic' } }, /ANTHROPIC_API_KEY/],
    ['.claude/settings.json', { forceLoginMethod: 'console' }, /forceLoginMethod/],
    ['.claude.json', { primaryApiKey: 'synthetic' }, /API key/],
    ['.claude.json', { oauthAccount: { billingType: 'api' } }, /billing type/],
  ]) {
    const home = subscribedHome(mkdtempSync(join(root, 'home-')));
    writeFileSync(join(home, file), JSON.stringify(body));
    const result = proof({ HOME: home });
    assert.equal(result.ok, false, file);
    assert.match(result.reason, pattern);
  }
  const home = subscribedHome(mkdtempSync(join(root, 'home-'))), project = join(root, 'project');
  mkdirSync(join(project, '.claude'), { recursive: true });
  writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify({ apiKeyHelper: '/bin/echo' }));
  assert.match(proof({ HOME: home }, { cwd: project }).reason, /apiKeyHelper/);
  const managed = join(root, 'managed.json');
  writeFileSync(managed, JSON.stringify({ apiKeyHelper: '/bin/echo' }));
  assert.match(subscriptionProof({ env: { HOME: home }, managedSettings: managed }).reason, /apiKeyHelper/);
});

test('missing, unreadable or ambiguous logins are refused', t => {
  const root = scratch(t);
  const cases = [
    ['missing', home => home, /missing/],
    ['empty', home => writeFileSync(join(home, '.claude', '.credentials.json'), ''), /not valid JSON/],
    ['no oauth', home => writeFileSync(join(home, '.claude', '.credentials.json'), '{}'), /no claude.ai OAuth/],
    ['no scope', home => subscribedHome(home, { scopes: ['user:profile'] }), /user:inference/],
    ['no type', home => subscribedHome(home, { subscriptionType: undefined }), /subscription type null/],
    ['free', home => subscribedHome(home, { subscriptionType: 'free' }), /"free"/],
    ['no token', home => subscribedHome(home, { accessToken: '', refreshToken: '' }), /no OAuth token/],
    ['bad settings', home => { subscribedHome(home); writeFileSync(join(home, '.claude', 'settings.json'), '{'); }, /not valid JSON/],
  ];
  for (const [name, arrange, pattern] of cases) {
    const home = mkdtempSync(join(root, 'home-'));
    mkdirSync(join(home, '.claude'), { recursive: true });
    arrange(home);
    const result = proof({ HOME: home });
    assert.equal(result.ok, false, name);
    assert.match(result.reason, pattern, name);
  }
  if (process.getuid?.() !== 0) {
    const home = subscribedHome(mkdtempSync(join(root, 'home-')));
    chmodSync(join(home, '.claude', '.credentials.json'), 0o000);
    assert.match(proof({ HOME: home }).reason, /unreadable/);
  }
});

test('the child environment carries no key or billing override', t => {
  const env = { PATH: '/usr/bin', HOME: '/home/x', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'u', ANTHROPIC_CUSTOM_HEADERS: 'h', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_OAUTH_TOKEN: 'o', AWS_BEARER_TOKEN_BEDROCK: 'b', CLAUDE_CONFIG_DIR: '/c' };
  assert.deepEqual(subscriptionEnvironment(env), { PATH: '/usr/bin', HOME: '/home/x', CLAUDE_CONFIG_DIR: '/c' });
  const argv = unsetArguments({ ANTHROPIC_EXTRA_SECRET: 'x' });
  assert.equal(argv[0], 'env');
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_EXTRA_SECRET']) assert(argv.includes(name), name);
  const root = scratch(t);
  const result = spawnSync('sh', ['-c', `${argv.map(a => `'${a}'`).join(' ')} env`], { env: { ...env, ANTHROPIC_EXTRA_SECRET: 'x' }, encoding: 'utf8', cwd: root });
  assert.doesNotMatch(result.stdout, /ANTHROPIC_|CLAUDE_CODE_OAUTH|CLAUDE_CODE_USE_|AWS_BEARER/);
});

test('the spawn transport refuses before launch and passes no key to the child', async t => {
  const root = scratch(t), home = subscribedHome(join(root, 'home')), log = join(root, 'log');
  const transport = environment => new SpawnClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, base: { PATH: process.env.PATH, HOME: home, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ...environment }, environment: { FAKE_CLAUDE_LOG: log } });
  await assert.rejects(transport({ ANTHROPIC_API_KEY: 'synthetic' }).send({ messages: [{ role: 'user', content: 'x' }] }), /refused \(exit 78\)/);
  assert.equal(existsSync(log), false);
  await transport({}).send({ messages: [{ role: 'user', content: 'x' }] });
  const seen = JSON.parse(readFileSync(log, 'utf8').split('\n')[0]).env;
  assert.deepEqual(seen.filter(name => /^ANTHROPIC_|CLAUDE_CODE_OAUTH|CLAUDE_CODE_USE_/.test(name)), []);
  const unsubscribed = subscribedHome(join(root, 'free'), { subscriptionType: 'free' });
  await assert.rejects(new SpawnClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, base: { PATH: process.env.PATH, HOME: unsubscribed } }).send({ messages: [{ role: 'user', content: 'x' }] }), /refused/);
});

test('the command-line check exits 78 when the login is not proven subscription', t => {
  const root = scratch(t), home = subscribedHome(join(root, 'home'));
  const run = env => spawnSync(process.execPath, [guard], { env: { PATH: process.env.PATH, HOME: home, ...env }, cwd: root, encoding: 'utf8' });
  assert.equal(run({}).status, 0);
  const refused = run({ ANTHROPIC_API_KEY: 'synthetic' });
  assert.equal(refused.status, 78);
  assert.match(refused.stderr, /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(refused.stdout + refused.stderr, /synthetic/);
  assert.equal(spawnSync(process.execPath, [guard, '--config-dir', join(root, 'none')], { env: { PATH: process.env.PATH, HOME: home }, cwd: root }).status, 78);
});

test('a cached proof adds no measurable latency', t => {
  const home = subscribedHome(scratch(t));
  const env = { HOME: home };
  const cold = performance.now();
  proof(env);
  const coldMs = performance.now() - cold;
  const rounds = 10000, warm = performance.now();
  for (let i = 0; i < rounds; i += 1) proof(env);
  const warmUs = (performance.now() - warm) * 1000 / rounds;
  console.log(`subscription guard: cold ${coldMs.toFixed(3)} ms, cached ${warmUs.toFixed(2)} us per launch`);
  assert(warmUs < 100, `cached check took ${warmUs} us`);
});
