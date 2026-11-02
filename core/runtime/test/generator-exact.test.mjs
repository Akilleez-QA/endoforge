import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, terseRule, exactRule } from '../x1/generator.mjs';
const fake = new URL('./fixtures/x1/fake-codex.mjs', import.meta.url).pathname;
test('exact terse mode adds the numeric derivation rule to the specification stage only', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-generator-exact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = join(root, 'record');
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]), CODEX_HOME: join(root, 'none'),
    ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_CODEX_TERSE: 'exact', FAKE_CODEX_RECORD: record };
  await generate({ need: 'integer add(a,b)', directory: join(root, 'x'), env });
  const spec = JSON.parse(await readFile(`${record}.specification.json`, 'utf8'));
  const impl = JSON.parse(await readFile(`${record}.implementation.json`, 'utf8'));
  assert.ok(spec.instructions.includes(terseRule) && spec.instructions.includes(exactRule));
  assert.ok(impl.instructions.includes(terseRule) && !impl.instructions.includes(exactRule));
});
