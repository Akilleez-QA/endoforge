import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNeed } from '../x1/pipeline.mjs';
const fake = new URL('./fixtures/x1/fake-codex.mjs', import.meta.url).pathname;
test('terse fallback retries a failed request once in normal mode in a sibling directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-pipeline-fallback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]), CODEX_HOME: join(root, 'none'),
    ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_CODEX_TERSE: 'fallback', FAKE_CODEX_MODE: 'glue', ENDOFORGE_ASC_CMD: join(root, 'none-asc') };
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'x'), pool: null, env });
  assert.equal(result.promoted, false);
  assert.equal(result.retried, true);
  assert.equal(result.first.promoted, false);
  assert.deepEqual((await readdir(root)).sort(), ['x', 'x-retry']);
});
