import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../isolate-pool.mjs';
import { hash } from '../x1/host.mjs';
import { generate } from '../x1/generator.mjs';
import { createLoopPool } from '../x1/loop.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider } from '../x1/transports.mjs';
import { candidate as additionCandidate } from './fixtures/x1/candidate.mjs';
import { good } from './fixtures/x1/seeds.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const fixtures = here('./fixtures/x1/');
const need = 'integer add(a,b)';
const { files } = additionCandidate();
const original = JSON.parse(files['tests.json']);
const wrongTests = JSON.stringify([...original, { name: 'wrong', fn: 'add', args: [4, 5], expect: 10 }]);
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-gaps3-generator-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const codexEnv = (root, loop, extra = {}) => ({ ...process.env, CODEX_HOME: join(root, 'unused-home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_LOOP: loop,
  ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, join(fixtures, 'fake-codex.mjs')]), FAKE_CODEX_KERNEL: good.kernel, FAKE_CODEX_GLUE: good.glue,
  ...(loop === 'current' ? { ENDOFORGE_ASC_CMD: join(fixtures, 'fake-asc.mjs') } : {}), ...extra });
const synthReply = (path, value) => ({ text: JSON.stringify({ calls: [{ name: 'edit_file', path, content: JSON.stringify(value) }, { name: 'done' }] }), usage: 1 });
const addBinding = reference => ({ exports: [{ name: 'add', params: ['a', 'b'].map(name => ({ name, unit: '1', min: -10, max: 10, integer: true })), result: { kind: 'number', unit: '1' } }], reference });
const synthProvider = references => scriptedProvider(({ session }) => {
  if (session.startsWith('need')) return synthReply('sheet.json', { residual: ['Adds two integers.'], quantities: [], relations: [], invariants: [] });
  return synthReply('binding.json', addBinding(references[Number(session.split('-')[1])] ?? references[0]));
});
const references = ['function add(a, b) { return a + b; }', 'function add(x, y) { const sum = y + x; return sum; }'];
const correctedText = JSON.stringify([...original, { name: 'wrong', fn: 'add', args: [4, 5], expect: 9 }]);
const correcting = (text = correctedText, sha = null) => async ({ reference }) => {
  const contract = readFileSync(join(reference.root, 'CONTRACT.md'), 'utf8');
  await writeFile(join(reference.root, 'tests.json'), text);
  await writeFile(join(reference.root, 'frozen.sha256'), sha ?? JSON.stringify({ contract: hash(contract), tests: hash(text) }));
  return { identity: 'evr:corrected', digest: 'd' };
};
const wrongOf = text => JSON.parse(text).find(entry => entry.name === 'wrong');

test('K1: the implementation turn reads the corrected frozen tests the freeze wrote to the oracle, not the original tests.json', async t => {
  const root = scratch(t), directory = join(root, 'run'), record = join(root, 'record');
  const generated = await generate({ need, directory, env: codexEnv(root, 'current', { FAKE_CODEX_TESTS: wrongTests, FAKE_CODEX_RECORD: record }), freeze: correcting() });
  assert.equal(readFileSync(join(directory, 'candidate', 'tests.json'), 'utf8'), correctedText);
  assert.equal(readFileSync(join(directory, 'candidate', 'frozen.sha256'), 'utf8'), readFileSync(join(directory, 'oracle', 'frozen.sha256'), 'utf8'));
  assert.equal(generated.candidate.files['tests.json'], correctedText);
  const prompt = JSON.parse(readFileSync(`${record}.implementation.json`, 'utf8'));
  assert.equal(prompt.frozen['tests.json'], correctedText);
  assert.match(prompt.instructions, /corrected/);
});

test('K1: without a correction the implementation prompt is unchanged and carries no corrected tests', async t => {
  const root = scratch(t), directory = join(root, 'run'), record = join(root, 'record');
  const generated = await generate({ need, directory, env: codexEnv(root, 'current', { FAKE_CODEX_RECORD: record }), freeze: async () => ({ identity: 'evr:x', digest: 'd' }) });
  assert.equal(generated.candidate.files['tests.json'], files['tests.json']);
  const prompt = JSON.parse(readFileSync(`${record}.implementation.json`, 'utf8'));
  assert.equal(prompt.frozen, undefined);
  assert.doesNotMatch(prompt.instructions, /corrected/);
});

test('K1: a correction whose tests do not match its frozen digest is refused before implementation', async t => {
  const root = scratch(t), directory = join(root, 'run'), record = join(root, 'record');
  await assert.rejects(generate({ need, directory, env: codexEnv(root, 'current', { FAKE_CODEX_TESTS: wrongTests, FAKE_CODEX_RECORD: record }),
    freeze: correcting(correctedText, JSON.stringify({ contract: 'x', tests: hash(wrongTests) })) }), /frozen/);
  assert.throws(() => readFileSync(`${record}.implementation.json`));
});

test('K1: on the current and isolate Codex paths a suspect revision reaches the implementation turn', { timeout: 180000 }, async t => {
  const root = scratch(t);
  const pool = new IsolatePool({ hostPort: here('../x1/host.mjs'), size: 1, isolation: 'thread' });
  await pool.ready();
  t.after(() => pool.close());
  const isolatePool = createLoopPool({ primes: 1 });
  t.after(() => isolatePool.close());
  for (const [loop, using] of [['current', pool], ['isolate', isolatePool]]) {
    const record = join(root, `${loop}-record`), directory = join(root, loop);
    const result = await runNeed({ need, directory, pool: using, synthProvider: synthProvider(references),
      env: codexEnv(root, loop, { ENDOFORGE_SYNTH: '1', ENDOFORGE_SYNTH_WIDTH: '2', FAKE_CODEX_TESTS: wrongTests, FAKE_CODEX_RECORD: record }) });
    assert.equal(result.promoted, true, `${loop}: ${JSON.stringify(result)}`);
    assert.ok(result.revision, loop);
    const oracle = readFileSync(join(directory, 'oracle', 'tests.json'), 'utf8');
    assert.equal(wrongOf(oracle).expect, 9, loop);
    assert.equal(readFileSync(join(directory, 'candidate', 'tests.json'), 'utf8'), oracle, loop);
    const prompt = JSON.parse(readFileSync(`${record}.implementation.json`, 'utf8'));
    assert.equal(wrongOf(prompt.frozen['tests.json']).expect, 9, loop);
  }
});
