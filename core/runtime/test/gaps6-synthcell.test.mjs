import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
import { IsolatePool } from '../isolate-pool.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider } from '../x1/transports.mjs';

const fixtures = new URL('./fixtures/x1/', import.meta.url).pathname;
const reply = (path, value) => ({ text: JSON.stringify({ calls: [{ name: 'edit_file', path, content: JSON.stringify(value) }, { name: 'done' }] }), usage: 1 });
const provider = () => scriptedProvider(({ session }) => (session.startsWith('need')
  ? reply('sheet.json', { residual: ['Adds two integers.'], quantities: [], relations: [], invariants: [] })
  : reply('binding.json', { exports: [{ name: 'add', params: ['a', 'b'].map(name => ({ name, unit: '1', min: -10, max: 10, integer: true })), result: { kind: 'number', unit: '1' } }], reference: 'function add(a, b) { return a + b; }' })));

const setup = async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-gaps6-synthcell-'));
  const pool = new IsolatePool({ hostPort: new URL('../x1/host.mjs', import.meta.url).pathname, size: 1, isolation: 'thread', prewarm: true });
  await pool.ready();
  t.after(async () => { await pool.close(); await rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, join(fixtures, 'fake-codex.mjs')]), CODEX_HOME: join(root, 'none'),
    ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_CODEX_TERSE: '1', ENDOFORGE_ASC_CMD: join(fixtures, 'fake-asc.mjs'), ENDOFORGE_SYNTH: '1' };
  delete env.ENDOFORGE_LOOP;
  return { root, pool, env };
};

test('REQ-SYNTH-008: on the current path a 1 ms synthCell deadline refuses the candidate with cell_timeout', { timeout: 120000 }, async t => {
  const { root, pool, env } = await setup(t);
  const directory = join(root, 'late');
  const result = await runNeed({ need: 'integer add(a,b)', directory, pool, env, synthProvider: provider(), synthCell: { deadlineMs: 1 } });
  assert.equal(result.promoted, false, JSON.stringify(result));
  assert.equal(result.synthesis?.decision, 'refuse', JSON.stringify(result));
  assert.equal(result.synthesis.reason, 'cell_timeout');
  assert.equal(result.problem, 'synthesized evaluator refused the candidate');
  assert.equal(JSON.parse(await readFile(join(directory, 'synthesis.json'), 'utf8')).reason, 'cell_timeout');
});

test('REQ-SYNTH-008: on the current path a roomy synthCell judges in its own cell and promotes', { timeout: 120000 }, async t => {
  const { root, pool, env } = await setup(t);
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'roomy'), pool, env, synthProvider: provider(),
    synthCell: { deadlineMs: 60000, resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } } });
  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.ok(result.synthTimings, JSON.stringify(result));
  const verdict = JSON.parse(await readFile(join(root, 'roomy', 'synthesis.json'), 'utf8'));
  assert.equal(verdict.decision, 'pass');
  assert.notEqual(verdict.cell.thread, threadId);
});
