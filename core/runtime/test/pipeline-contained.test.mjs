import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IsolatePool } from '../isolate-pool.mjs';
import { runNeed } from '../x1/pipeline.mjs';

const fixtures = new URL('./fixtures/x1/', import.meta.url).pathname;
const setup = async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-pipeline-contained-'));
  const pool = new IsolatePool({ hostPort: new URL('../x1/host.mjs', import.meta.url).pathname, size: 1, isolation: 'thread' });
  await pool.ready();
  t.after(async () => { await pool.close(); await rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, join(fixtures, 'fake-codex.mjs')]), CODEX_HOME: join(root, 'none'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_ASC_CMD: join(fixtures, 'fake-asc.mjs') };
  return { root, pool, env };
};
test('with no option the pipeline result has no contained field', async t => {
  const { root, pool, env } = await setup(t);
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'off'), pool, env });
  assert.equal(result.promoted, true);
  assert.equal('contained' in result, false);
});
test('with the option the report joins the result and does not change the decision', async t => {
  const { root, pool, env } = await setup(t);
  const seen = [];
  const route = { check: async candidate => { seen.push(Object.keys(candidate.files)); return { lane: 'compatibility', status: 'refused', reason: 'tests' }; } };
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'on'), pool, env, containedRoute: route });
  assert.equal(result.promoted, true);
  assert.equal(result.contained.reason, 'tests');
  assert.ok(seen[0].includes('kernel.ts'));
  const failing = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'throws'), pool, env, containedRoute: { check: async () => { throw new Error('route failed'); } } });
  assert.equal(failing.promoted, true);
  assert.deepEqual(failing.contained, { lane: 'compatibility', status: 'outcome_unknown', reason: 'route failed' });
});
