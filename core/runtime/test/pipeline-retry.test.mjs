import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IsolatePool } from '../isolate-pool.mjs';
import { runNeed } from '../x1/pipeline.mjs';
const fixtures = new URL('./fixtures/x1/', import.meta.url).pathname;
const setup = async (t, extra) => {
  const root = await mkdtemp(join(tmpdir(), 'ef-pipeline-retry-'));
  const pool = new IsolatePool({ hostPort: new URL('../x1/host.mjs', import.meta.url).pathname, size: 1, isolation: 'thread', prewarm: true });
  await pool.ready();
  t.after(async () => { await pool.close(); await rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, join(fixtures, 'fake-codex.mjs')]), CODEX_HOME: join(root, 'none'),
    ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_CODEX_TERSE: 'fallback', FAKE_CODEX_MODE: 'terse-glue', ENDOFORGE_ASC_CMD: join(fixtures, 'fake-asc.mjs'), ...extra };
  return { root, pool, env };
};
test('gates reject the terse attempt and the normal retry is promoted', async t => {
  const { root, pool, env } = await setup(t, { ENDOFORGE_RETRY_BUDGET_MS: '60000' });
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'x'), pool, env });
  assert.equal(result.first.promoted, false);
  assert.equal(result.retried, true);
  assert.equal(result.promoted, true);
  assert.equal(result.retryCancelled, false);
  assert.deepEqual((await readdir(root)).sort(), ['x', 'x-retry']);
});
test('the retry is cancelled when the request deadline runs out', async t => {
  const { root, pool, env } = await setup(t, { ENDOFORGE_RETRY_BUDGET_MS: '3000', FAKE_CODEX_DELAY_MS: '10000' });
  const begin = Date.now();
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'x'), pool, env });
  assert.equal(result.retried, true);
  assert.equal(result.promoted, false);
  assert.equal(result.retryCancelled, true);
  assert.ok(Date.now() - begin < 8000);
});
