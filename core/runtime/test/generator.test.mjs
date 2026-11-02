import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, glueRules, glueTemplate, effortFor, terseRule, reviewRule, promptFor } from '../x1/generator.mjs';
import { runGates } from '../x1/gates.mjs';
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
test('implementation prompt carries the G7 glue rules and a conforming template', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-generator-rules-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = join(root, 'request');
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]),
    CODEX_HOME: join(root, 'nonexistent-account'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', FAKE_CODEX_RECORD: record };
  await generate({ need: 'integer add(a,b)', directory: join(root, 'addition'), env });
  const implementation = JSON.parse(await readFile(`${record}.implementation.json`, 'utf8'));
  assert.deepEqual(implementation.glueRules, glueRules);
  assert.deepEqual(implementation.glueTemplate, glueTemplate);
  const compiler = await readFile(new URL('../x1/compiler.mjs', import.meta.url), 'utf8');
  assert(compiler.includes("'--noAssert'") && /--noAssert[^.]*never use assert[^.]*abort\(\) or throw/.test(implementation.instructions));
  const gates = await readFile(new URL('../x1/gates.mjs', import.meta.url), 'utf8');
  for (const kind of ['number', 'code', 'boolean']) assert(gates.includes(`r.kind === '${kind}'`) && glueRules.some(rule => rule.includes(`kind ${kind}`)));
  for (const x of glueTemplate.exports) if (x.result.kind === 'number') assert(Number.isInteger(x.result.precision));
});
test('warm session resumes the specification thread and low effort applies only to short requests', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-generator-warm-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = join(root, 'request');
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]),
    CODEX_HOME: join(root, 'nonexistent-account'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', FAKE_CODEX_RECORD: record };
  const warm = await generate({ need: 'integer add(a,b)', directory: join(root, 'warm'), env });
  assert.deepEqual(warm.session, { effort: 'low', resumed: true, packed: false });
  const first = JSON.parse(await readFile(`${record}.specification.json`, 'utf8')).argv;
  const second = JSON.parse(await readFile(`${record}.implementation.json`, 'utf8')).argv;
  assert(first.includes('model_reasoning_effort="low"') && !first.includes('resume'));
  assert.deepEqual(second.slice(0, 2), ['exec', 'resume']);
  assert(second.includes('00000000-0000-4000-8000-000000000001'));
  const cold = await generate({ need: 'integer add(a,b)', directory: join(root, 'cold'), env: { ...env, ENDOFORGE_CODEX_SESSION: 'fresh', ENDOFORGE_CODEX_EFFORT: 'default' } });
  assert.deepEqual(cold.session, { effort: 'default', resumed: false, packed: false });
  assert(!JSON.parse(await readFile(`${record}.implementation.json`, 'utf8')).argv.includes('resume'));
  assert.equal(effortFor('x'.repeat(401)), null);
  assert.equal(effortFor("# R\n## The request, in the requester's words\n\n> How much does R-22 cost\n\n## Other\n" + 'y'.repeat(2000)), 'low');
  assert.equal(effortFor('anything', 'medium'), 'medium');
});
test('self-check resumes the thread once with gate failures and keeps the frozen specification', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-generator-repair-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = join(root, 'request');
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]), CODEX_HOME: join(root, 'nonexistent-account'),
    ENDOFORGE_CODEX_TEST_DOUBLE: '1', FAKE_CODEX_RECORD: record, FAKE_CODEX_MODE: 'repair' };
  const seen = [];
  const check = async candidate => { seen.push(JSON.parse(candidate.files['glue.json'])); return Object.keys(seen.at(-1)).length ? null : { gates: { G7_glue: { ok: false, why: 'glue: expected fields' } }, tests: [] }; };
  const off = await generate({ need: 'integer add(a,b)', directory: join(root, 'off'), env, check });
  assert.equal(off.repaired, false);
  assert.deepEqual(seen, []);
  const on = await generate({ need: 'integer add(a,b)', directory: join(root, 'on'), env: { ...env, ENDOFORGE_SELF_CHECK: '1' }, check });
  assert.equal(on.repaired, true);
  assert.equal(seen.length, 1);
  assert.equal(JSON.parse(on.candidate.files['glue.json']).id, on.candidate.id);
  const repair = JSON.parse(await readFile(`${record}.repair.json`, 'utf8'));
  assert.deepEqual(repair.failures.gates.G7_glue.ok, false);
  assert.deepEqual(repair.argv.slice(0, 2), ['exec', 'resume']);
  assert.equal(typeof runGates, 'function');
});

test('terse turns append one rule to every stage only when opted in', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-generator-terse-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = join(root, 'request');
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]),
    CODEX_HOME: join(root, 'nonexistent-account'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', FAKE_CODEX_RECORD: record };
  await generate({ need: 'integer add(a,b)', directory: join(root, 'off'), env });
  for (const stage of ['specification', 'implementation']) assert(!JSON.parse(await readFile(`${record}.${stage}.json`, 'utf8')).instructions.includes(terseRule));
  await generate({ need: 'integer add(a,b)', directory: join(root, 'on'), env: { ...env, ENDOFORGE_CODEX_TERSE: '1' } });
  for (const stage of ['specification', 'implementation']) assert(JSON.parse(await readFile(`${record}.${stage}.json`, 'utf8')).instructions.endsWith(terseRule));
});
test('packed session starts implementation fresh with the frozen files in the prompt', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-generator-packed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = join(root, 'request');
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]),
    CODEX_HOME: join(root, 'nonexistent-account'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', FAKE_CODEX_RECORD: record, ENDOFORGE_CODEX_SESSION: 'packed' };
  const out = await generate({ need: 'integer add(a,b)', directory: join(root, 'packed'), env });
  assert.equal(out.session.packed, true);
  const request = JSON.parse(await readFile(`${record}.implementation.json`, 'utf8'));
  assert(!request.argv.includes('resume'));
  assert.equal(request.frozen['tests.json'], out.candidate.files['tests.json']);
  assert.equal(request.frozen['CONTRACT.md'], out.candidate.files['CONTRACT.md']);
});
test('stable prefix puts the fixed prompt fields before the request fields only when opted in', () => {
  const prompt = { stage: 'implementation', need: 'n', id: 'i', glueSchema: {}, glueRules: [], instructions: 'x' };
  assert.deepEqual(Object.keys(promptFor(prompt, {})), Object.keys(prompt));
  const stable = promptFor(prompt, { ENDOFORGE_CODEX_PREFIX: 'stable' });
  assert.deepEqual(Object.keys(stable), ['instructions', 'glueRules', 'glueSchema', 'stage', 'need', 'id']);
  assert.deepEqual(stable, prompt);
});
test('reviewed terse turns append the review rule to every stage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-generator-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = join(root, 'request');
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]),
    CODEX_HOME: join(root, 'nonexistent-account'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', FAKE_CODEX_RECORD: record, ENDOFORGE_CODEX_TERSE: 'review' };
  await generate({ need: 'integer add(a,b)', directory: join(root, 'on'), env });
  for (const stage of ['specification', 'implementation']) {
    const { instructions } = JSON.parse(await readFile(`${record}.${stage}.json`, 'utf8'));
    assert(instructions.endsWith(reviewRule) && !instructions.includes(terseRule));
  }
});
