import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IsolatePool } from '../isolate-pool.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider } from '../x1/transports.mjs';
const fixtures = new URL('./fixtures/x1/', import.meta.url).pathname;
const reply = (path, value) => ({ text: JSON.stringify({ calls: [{ name: 'edit_file', path, content: JSON.stringify(value) }, { name: 'done' }] }), usage: 1 });
const provider = reference => scriptedProvider(({ session, messages }) => {
  if (session.startsWith('need')) return reply('sheet.json', { residual: ['Adds two integers.'], quantities: [], relations: [], invariants: [] });
  assert.ok(!messages[0].content.includes('kernel.ts') && !messages[0].content.includes('"expect"'));
  return reply('binding.json', { exports: [{ name: 'add', params: ['a', 'b'].map(name => ({ name, unit: '1', min: -10, max: 10, integer: true })), result: { kind: 'number', unit: '1' } }], reference });
});
const setup = async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-synth-pipeline-'));
  const pool = new IsolatePool({ hostPort: new URL('../x1/host.mjs', import.meta.url).pathname, size: 1, isolation: 'thread', prewarm: true });
  await pool.ready();
  t.after(async () => { await pool.close(); await rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, join(fixtures, 'fake-codex.mjs')]), CODEX_HOME: join(root, 'none'),
    ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_CODEX_TERSE: '1', ENDOFORGE_ASC_CMD: join(fixtures, 'fake-asc.mjs'), ENDOFORGE_SYNTH: '1' };
  return { root, pool, env };
};
test('with synthesis on, the evaluator is frozen in the oracle before code and a passing kernel promotes', async t => {
  const { root, pool, env } = await setup(t);
  const directory = join(root, 'x');
  const result = await runNeed({ need: 'integer add(a,b)', directory, pool, env, synthProvider: provider('function add(a, b) { return a + b; }') });
  assert.equal(result.promoted, true, JSON.stringify(result));
  const evaluator = JSON.parse(await readFile(join(directory, 'oracle', 'synth', 'evaluator.json'), 'utf8'));
  assert.ok(evaluator.checks.vectors.length > 10);
  assert.equal(JSON.parse(await readFile(join(directory, 'synthesis.json'), 'utf8')).decision, 'pass');
});
test('a kernel the frozen tests pass but the synthesized evaluator refuses is not promoted', async t => {
  const { root, pool, env } = await setup(t);
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'x'), pool, env, synthProvider: provider('function add(a, b) { return a > 5 ? a + b + 1 : a + b; }') });
  assert.equal(result.promoted, false);
  assert.equal(result.synthesis.decision, 'refuse');
  assert.ok(result.synthesis.failures.some(x => x.startsWith('value.reference')));
});
test('synthesis stays off by default', async t => {
  const { root, pool, env } = await setup(t);
  delete env.ENDOFORGE_SYNTH;
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'x'), pool, env, synthProvider: provider('function add() { return 0; }') });
  assert.equal(result.promoted, true);
  assert.equal(result.synthTimings, undefined);
});
