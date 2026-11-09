import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { UsageGovernor } from '../usage-governor.mjs';
import { SpawnClaudeTransport, WarmClaudeTransport, defaultModel, spawnArguments, warmArguments } from '../x1/transports.mjs';
import { generate } from '../x1/generator.mjs';
import { subscribedHome } from './fixtures/subscription.mjs';

const fakeClaude = fileURLToPath(new URL('./fixtures/x1/fake-claude-usage.mjs', import.meta.url));
const fakeCodex = fileURLToPath(new URL('./fixtures/x1/fake-codex.mjs', import.meta.url));
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-gaps-transport-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const logOf = root => (existsSync(join(root, 'log')) ? readFileSync(join(root, 'log'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
const modelOf = argv => argv[argv.indexOf('--model') + 1];

test('G15: the warm transport admits every turn through a caller-supplied usage governor', async t => {
  const root = scratch(t), g = new UsageGovernor({ statePath: join(root, 'state.json'), scope: 'caller' });
  const warm = new WarmClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, governor: g,
    base: { PATH: process.env.PATH, HOME: subscribedHome(root) }, environment: { FAKE_CLAUDE_LOG: join(root, 'log') } });
  t.after(() => warm.close());
  await warm.send({ session: 'a', messages: [{ role: 'user', content: 'one' }] });
  assert.equal(g.metric().calls, 1);
  assert.equal(g.inFlight, 0);
  const instanceGovernor = new UsageGovernor({ statePath: join(root, 'state.json'), scope: 'instance' });
  const mixed = new WarmClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, governor: g, instances: [{ name: 'own', governor: instanceGovernor }],
    base: { PATH: process.env.PATH, HOME: subscribedHome(root) }, environment: { FAKE_CLAUDE_LOG: join(root, 'log') } });
  t.after(() => mixed.close());
  await mixed.send({ session: 'b', messages: [{ role: 'user', content: 'two' }] });
  assert.equal(instanceGovernor.metric().calls, 1);
  assert.equal(g.metric().calls, 1);
  const off = new WarmClaudeTransport({ model: 'stub', command: fakeClaude, cwd: root, governor: null,
    base: { PATH: process.env.PATH, HOME: subscribedHome(root) }, environment: { FAKE_CLAUDE_LOG: join(root, 'log') } });
  t.after(() => off.close());
  assert.deepEqual((await off.send({ session: 'c', messages: [{ role: 'user', content: 'three' }] })).usage, 5);
});

test('G16: both Claude transports pass a default --model, and the caller can override it', async t => {
  assert.equal(typeof defaultModel, 'string');
  assert(defaultModel.length > 0);
  assert.equal(modelOf(warmArguments({})), defaultModel);
  assert.equal(modelOf(spawnArguments({})), defaultModel);
  assert.equal(modelOf(warmArguments({ model: 'opus' })), 'opus');
  const root = scratch(t), base = { PATH: process.env.PATH, HOME: subscribedHome(root) }, environment = { FAKE_CLAUDE_LOG: join(root, 'log') };
  const per = new SpawnClaudeTransport({ command: fakeClaude, cwd: root, base, environment, governor: null });
  await per.send({ messages: [{ role: 'user', content: 'x' }] });
  const warm = new WarmClaudeTransport({ command: fakeClaude, cwd: root, base, environment, governor: null });
  t.after(() => warm.close());
  await warm.send({ session: 'a', messages: [{ role: 'user', content: 'y' }] });
  const starts = logOf(root).filter(line => line.start);
  assert.equal(starts.length, 2);
  for (const { argv } of starts) assert.equal(modelOf(argv), defaultModel);
  assert.equal(modelOf(new SpawnClaudeTransport({ model: 'haiku', command: fakeClaude, governor: null }).arguments), 'haiku');
  assert.equal(modelOf(new WarmClaudeTransport({ model: 'haiku', command: fakeClaude, governor: null }).arguments), 'haiku');
});

test('G17: a Claude transport whose command is a stand-in reports testDouble true', () => {
  for (const Transport of [WarmClaudeTransport, SpawnClaudeTransport]) {
    assert.equal(new Transport({ command: fakeClaude, governor: null }).testDouble, true);
    assert.equal(new Transport({ governor: null }).testDouble, false);
    assert.equal(new Transport({ command: '/usr/local/bin/claude', governor: null }).testDouble, false);
    assert.equal(new Transport({ command: fakeClaude, testDouble: false, governor: null }).testDouble, false);
  }
});

test('G18: a relative ENDOFORGE_CODEX_CMD resolves against the caller working directory, not candidate/', async t => {
  const root = scratch(t), wrapper = join(root, 'codex-stand-in');
  writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeCodex)} "$@"\n`);
  chmodSync(wrapper, 0o755);
  const local = path => `./${relative(process.cwd(), path)}`;
  const base = { ...process.env, CODEX_HOME: join(root, 'nonexistent-account'), ENDOFORGE_CODEX_TEST_DOUBLE: '1' };
  const bare = await generate({ need: 'integer add(a,b)', directory: join(root, 'bare'), env: { ...base, ENDOFORGE_CODEX_CMD: local(wrapper) } });
  assert.equal(bare.candidate.files['kernel.ts'].includes('a+b'), true);
  const listed = await generate({ need: 'integer add(a,b)', directory: join(root, 'listed'), env: { ...base, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, local(fakeCodex)]) } });
  assert.equal(listed.candidate.files['kernel.ts'].includes('a+b'), true);
  await assert.rejects(generate({ need: 'add', directory: join(root, 'missing'), env: { ...base, ENDOFORGE_CODEX_CMD: './no-such-codex' } }), /failed/);
});
