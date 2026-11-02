import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, terseRule, exactRule, scalarRule } from '../x1/generator.mjs';
import { filterScalarTests } from '../x1/scalar.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { hash } from '../x1/host.mjs';
import { IsolatePool } from '../isolate-pool.mjs';
const fake = new URL('./fixtures/x1/fake-codex.mjs', import.meta.url).pathname;
const contract = 'export function add(a: i32, b: f64): f64;\nexport function unknown(x): f64;';
const value = { name: 'value', fn: 'add', args: [2, 3.5], expect: 5.5, tol: 1e-12 };
const trap = { name: 'range', fn: 'add', args: [-11, 0.5], expectError: true };
const fractional = { name: 'fractional', fn: 'add', args: [1.5, 0], expectError: true };
const unknown = { name: 'unknown', fn: 'unknown', args: [1.5], expect: 1.5 };
const inputs = [[], '2', null, true, false, {}, [2]];
const invalid = inputs.map((v, i) => ({ name: `invalid-${i}`, fn: 'add', args: [v, 0], ...(i % 2 ? { expect: 0 } : { expectError: true }) }));
const testsText = JSON.stringify([value, trap, fractional, unknown, { ...unknown, name: 'unknown-trap', expectError: true }, ...invalid]).replace(/\]$/, ',{"id":"overflow","fn":"add","args":[1e400,0],"expectError":true}]');
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'ef-generator-scalar-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fake]), CODEX_HOME: join(root, 'none'),
    ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_CODEX_TERSE: 'scalar', FAKE_CODEX_RECORD: join(root, 'record'),
    FAKE_CODEX_CONTRACT: contract, FAKE_CODEX_TESTS: testsText };
  return { root, env };
}
test('scalar filters before freeze, preserves retained expectations', async t => {
  const { root, env } = await setup(t), directory = join(root, 'request');
  const out = await generate({ need: 'scalar functions', directory, env });
  const kept = JSON.parse(testsText).slice(0, 5).filter(t => t.name !== 'fractional');
  assert.deepEqual(JSON.parse(out.candidate.files['tests.json']), kept);
  for (const folder of ['candidate', 'oracle']) assert.equal(await readFile(join(directory, folder, 'tests.json'), 'utf8'), out.candidate.files['tests.json']);
  assert.equal(JSON.parse(out.candidate.files['frozen.sha256']).tests, hash(out.candidate.files['tests.json']));
  assert.equal(out.scalarFilter.droppedCount, 9);
  assert.deepEqual(out.scalarFilter.dropped.map(t => t.id), ['fractional', ...invalid.map(t => t.name), 'overflow']);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'scalar-filter.json'))), out.scalarFilter);
  const spec = JSON.parse(await readFile(`${env.FAKE_CODEX_RECORD}.specification.json`));
  const impl = JSON.parse(await readFile(`${env.FAKE_CODEX_RECORD}.implementation.json`));
  assert.ok(spec.instructions.endsWith(`${terseRule} ${exactRule} ${scalarRule}`));
  assert.ok(impl.instructions.endsWith(terseRule) && !impl.instructions.includes(scalarRule) && !impl.instructions.includes(exactRule));
  assert.equal(impl.frozen, undefined);
});
test('scalar rejects NaN and infinities and only drops fractional traps at declared integer positions', () => {
  const cases = [NaN, Infinity, -Infinity].map((n, i) => ({ name: String(i), fn: 'add', args: [n, 0], expect: 0 }));
  const out = filterScalarTests(contract, [value, trap, fractional, ...cases]);
  assert.deepEqual(out.tests, [value, trap]);
  assert.equal(out.report.droppedCount, 4);
  for (const type of ['integer', 'int', 'i32', 'u32']) {
    assert.equal(filterScalarTests(`add(a: ${type}, b: f64): f64`, [value, fractional]).report.droppedCount, 1);
  }
  assert.equal(filterScalarTests('add(a: f64, b: i32): f64', [fractional]).report.droppedCount, 0);
  assert.equal(filterScalarTests('add(a: i32[], b: f64): f64', [fractional]).report.droppedCount, 0);
});
test('scalar fails closed before implementation when any function lacks a value test and logs removals', async t => {
  const { root, env } = await setup(t);
  for (const [name, tests] of [['empty', [invalid[0]]], ['trap-only', [trap]], ['lost-function', [value, { ...invalid[0], fn: 'unknown' }]], ['untested-export', [value]]]) {
    const directory = join(root, name);
    const result = await runNeed({ need: 'scalar functions', directory, env: { ...env, FAKE_CODEX_TESTS: JSON.stringify(tests) } });
    assert.equal(result.promoted, false); assert.ok(result.error);
    assert.ok(result.scalarFilter.missingValueTests.length);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'scalar-filter.json'))), result.scalarFilter);
    await assert.rejects(access(join(directory, 'candidate', 'frozen.sha256')), { code: 'ENOENT' });
    await assert.rejects(access(`${env.FAKE_CODEX_RECORD}.implementation.json`), { code: 'ENOENT' });
  }
});
test('exact and default retain input bytes and original prompts, without scalar metadata', async t => {
  const { root, env } = await setup(t), outputs = [], prompts = [];
  for (const mode of ['0', 'exact', undefined]) {
    const parent = join(root, mode ?? 'default'); await mkdir(parent);
    const configured = { ...env, ENDOFORGE_CODEX_TERSE: mode };
    if (mode === undefined) delete configured.ENDOFORGE_CODEX_TERSE;
    const out = await generate({ need: 'scalar functions', directory: join(parent, 'request'), env: configured });
    outputs.push(out.candidate.files);
    assert.equal(out.candidate.files['tests.json'], testsText);
    assert.ok(!('scalarFilter' in out));
    await assert.rejects(access(join(parent, 'request', 'scalar-filter.json')), { code: 'ENOENT' });
    prompts.push(await Promise.all(['specification', 'implementation'].map(async stage => JSON.parse(await readFile(`${env.FAKE_CODEX_RECORD}.${stage}.json`)))));
  }
  assert.deepEqual(outputs[1], outputs[0]); assert.deepEqual(outputs[2], outputs[1]);
  assert.deepEqual(prompts[2], prompts[1]);
  for (const [i, suffix] of [` ${terseRule} ${exactRule}`, ` ${terseRule}`].entries()) {
    assert.deepEqual(prompts[1][i], { ...prompts[0][i], instructions: prompts[0][i].instructions + suffix });
  }
});
test('pipeline returns scalar drop evidence alongside a real gate receipt', async t => {
  const { root, env } = await setup(t);
  const pool = new IsolatePool({ hostPort: new URL('../x1/host.mjs', import.meta.url).pathname, size: 1 });
  t.after(() => pool.close());
  const result = await runNeed({ need: 'add', directory: join(root, 'request'), pool, env: { ...env,
    ENDOFORGE_ASC_CMD: new URL('./fixtures/x1/fake-asc.mjs', import.meta.url).pathname,
    FAKE_CODEX_CONTRACT: 'add(a: i32, b: i32): i32', FAKE_CODEX_TESTS: JSON.stringify([{ ...value, args: [2, 3], expect: 5 }, invalid[0], fractional]) } });
  assert.equal(result.promoted, true); assert.ok(result.receipt);
  assert.equal(result.scalarFilter.droppedCount, 2);
});
