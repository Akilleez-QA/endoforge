import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNeed } from '../x1/pipeline.mjs';
const fake = new URL('./fixtures/x1/fake-codex.mjs', import.meta.url).pathname;
test('terse fallback does not retry a stage error', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-pipeline-fallback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]), CODEX_HOME: join(root, 'none'),
    ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_CODEX_TERSE: 'fallback', FAKE_CODEX_MODE: 'glue', ENDOFORGE_ASC_CMD: join(root, 'none-asc') };
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'x'), pool: null, env });
  assert.equal(result.promoted, false);
  assert.equal(result.retried, false);
  assert.equal(result.retrySkipped, 'stage-error');
  assert.deepEqual(await readdir(root), ['x']);
});
test('terse fallback skips the retry when the first attempt used the time budget', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-pipeline-budget-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]), CODEX_HOME: join(root, 'none'),
    ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_CODEX_TERSE: 'fallback', FAKE_CODEX_MODE: 'glue', ENDOFORGE_ASC_CMD: join(root, 'none-asc'), ENDOFORGE_RETRY_BUDGET_MS: '1' };
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'x'), pool: null, env });
  assert.equal(result.promoted, false);
  assert.equal(result.retried, false);
  assert.equal(result.retrySkipped, 'budget');
  assert.deepEqual(await readdir(root), ['x']);
});
