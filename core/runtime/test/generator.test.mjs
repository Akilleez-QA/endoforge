import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../x1/generator.mjs';
import { hash } from '../x1/host.mjs';
const fake = fileURLToPath(new URL('./fixtures/x1/fake-codex.mjs', import.meta.url));
test('labelled Codex test double: two exec stages, durable freeze before code and no account inspection', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-generator-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]),
    CODEX_HOME: join(root, 'nonexistent-account'), ENDOFORGE_CODEX_TEST_DOUBLE: '1' };
  const result = await generate({ need: 'integer add(a,b)', directory: join(root, 'addition'), env });
  assert.equal(result.testDouble, true);
  assert.equal(result.candidate.files['kernel.ts'].includes('a+b'), true);
  const frozen = JSON.parse(result.candidate.files['frozen.sha256']);
  assert.equal(frozen.contract, hash(result.candidate.files['CONTRACT.md']));
  assert.equal(frozen.tests, hash(result.candidate.files['tests.json']));
  assert.equal(await readFile(join(result.reference.root, 'tests.json'), 'utf8'), result.candidate.files['tests.json']);
  assert.equal((await readdir(result.reference.root)).includes('kernel.ts'), false);
  assert(result.timings.generate > 0 && result.timings.freeze > 0);
  for (const [mode, message] of [['early', /before freeze/], ['drift', /changed/], ['exit', /failed/]]) {
    await assert.rejects(generate({ need: 'add', directory: join(root, mode), env: { ...env, FAKE_CODEX_MODE: mode } }), message);
  }
  await assert.rejects(generate({ need: 'add', directory: join(root, 'unconfigured'), env: {} }), /required/);
});
