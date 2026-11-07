import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { IsolatePool } from '../../../core/runtime/isolate-pool.mjs';
import { fixture, hostPort as basePort } from '../../../core/runtime/test/fixtures/ledger-fixture.mjs';
import { TSRS_MODULE, WORKCELL } from '../pin.mjs';
import { TS_INVARIANT } from '../port.mjs';
import { typecheck } from '../checker.mjs';

const hostPort = fileURLToPath(new URL('../port.mjs', import.meta.url));
const compilerOptions = { strict: true, target: 'es2022', lib: ['es2022'], module: 'esnext', moduleResolution: 'bundler', types: [] };
const project = source => ({ root: '/proj', files: { '/proj/a.ts': source }, tsconfig: { compilerOptions, files: ['./a.ts'] } });
const clean = project('export const n: number = 1;\n');
const planted = project('export const n: number = "x";\n');
const options = extra => ({ basePort, projects: { pass: clean, dominated: planted }, ...extra });
const reports = file => readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));

async function setup(t, poolOptions = WORKCELL) {
  const { job, directory } = await fixture(t, { invariants: ['identity', TS_INVARIANT] });
  const pool = new IsolatePool({ hostPort, size: 1, ...poolOptions });
  t.after(() => pool.close());
  return { job, pool, directory };
}

test('in a pinned workcell the compiler passes clean code and rejects a planted error', { timeout: 120000 }, async t => {
  const { job, pool } = await setup(t);
  const result = await pool.run(job(['pass', 'dominated'], options()));
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.trustedWasmModules, [TSRS_MODULE]);
  const [good, bad] = result.report.attempts;
  assert.equal(good.stage, 'passed');
  assert.equal(bad.firstFailure, `invariant:${TS_INVARIANT}`);
  assert.match(bad.results.at(-1).reason, /a\.ts\(1,14\): TS2322/);
  assert.equal(result.receipts[0].record.data.outcome_state, 'passed');
  assert.equal(result.receipts[1].record.data.outcome_state, 'failed');
});

test('the module compiles once per workcell and each check has fresh state', { timeout: 120000 }, async t => {
  const { job, pool, directory } = await setup(t);
  const reportFile = join(directory, 'reports.jsonl');
  const first = await pool.run(job(['dominated'], options({ reportFile })));
  const second = await pool.run(job(['pass'], options({ reportFile })));
  assert.equal(second.workcell, first.workcell);
  const rows = reports(reportFile);
  assert.equal(rows[0].warm, false);
  assert.ok(rows[0].compileMs > 0);
  assert.ok(rows.slice(1).every(row => row.warm && row.compileMs === 0));
  assert.deepEqual(rows.at(-1).diagnostics, []);
});

test('without the pin the WASM guard stops the compiler', { timeout: 120000 }, async t => {
  const { wasmMemoryMaxMb, resourceLimits } = WORKCELL;
  const { job, pool } = await setup(t, { wasmMemoryMaxMb, resourceLimits });
  const result = await pool.run(job(['pass'], options()));
  assert.equal(result.status, 'outcome_unknown');
  assert.equal(result.reason, 'limit');
  assert.equal(result.error, 'ERR_WORKCELL_WASM_MEMORY_LIMIT');
});

test('a tampered or missing compiler is an unknown outcome, never a pass', { timeout: 120000 }, async t => {
  const { job, pool } = await setup(t);
  const dir = mkdtempSync(join(tmpdir(), 'ef-tscheck-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = new URL('../node_modules/@tsrs/wasm/', import.meta.url);
  cpSync(new URL('core.js', source), join(dir, 'core.js'));
  writeFileSync(join(dir, 'tsrs.wasm'), Buffer.concat([readFileSync(new URL('tsrs.wasm', source)), Buffer.of(0)]));
  for (const vendor of [pathToFileURL(`${dir}/`).href, 'file:///nonexistent/']) {
    const result = await pool.run(job(['pass'], options({ vendor })));
    assert.equal(result.status, 'outcome_unknown');
    assert.notEqual(result.receipts[0].record.data.outcome_state, 'passed');
  }
});

test('the pinned compiler growing past a lowered maximumPages stops its cell', { timeout: 120000 }, async t => {
  const { memoryBytes } = await typecheck(clean);
  const maximumPages = Math.floor(memoryBytes / 65536) - 1;
  const { job } = await fixture(t, { invariants: ['identity', TS_INVARIANT] });
  const pool = new IsolatePool({ hostPort, size: 1, ...WORKCELL, trustedWasmModules: [{ ...TSRS_MODULE, maximumPages }] });
  t.after(() => pool.close());
  const stopped = await pool.run(job(['pass'], options()));
  assert.equal(stopped.status, 'outcome_unknown');
  assert.equal(stopped.error, 'ERR_WORKCELL_WASM_MEMORY_LIMIT');
  assert.notEqual(stopped.receipts[0].record.data.outcome_state, 'passed');
});

test('deep input needs the stack limit, and a compiler past its deadline is stopped', { timeout: 240000 }, async t => {
  const deep = project(`export const n = ${Array(60000).fill('1').join(' + ')};\n`);
  const projects = { pass: deep };
  const { wasmMemoryMaxMb, trustedWasmModules, resourceLimits: { stackSizeMb, ...heap } } = WORKCELL;
  const small = await setup(t, { wasmMemoryMaxMb, trustedWasmModules, resourceLimits: heap });
  const trapped = await small.pool.run(small.job(['pass'], options({ projects })));
  assert.equal(trapped.status, 'outcome_unknown');
  const large = await setup(t);
  const passed = await large.pool.run(large.job(['pass'], options({ projects })));
  assert.equal(passed.status, 'completed');
  assert.equal(passed.report.attempts[0].stage, 'passed');
  const bounded = await setup(t, { ...WORKCELL, jobTimeoutMs: 50 });
  const stopped = await bounded.pool.run(bounded.job(['pass'], options({ projects })));
  assert.equal(stopped.status, 'outcome_unknown');
  assert.equal(stopped.reason, 'deadline');
});

test('a clean emit returns a hashed artifact and a failed one returns none', { timeout: 60000 }, async () => {
  const emitting = source => ({ ...project(source), tsconfig: { compilerOptions: { ...compilerOptions, outDir: './out' }, files: ['./a.ts'] } });
  const good = await typecheck(emitting('export const n: number = 1;\n'), { emit: true });
  const [path] = Object.keys(good.artifact.files);
  assert.match(path, /out\/a\.js$/);
  assert.equal(good.artifact.sha256[path].length, 64);
  assert.equal((await typecheck(emitting('export const n: number = "x";\n'), { emit: true })).artifact, null);
});

test('warm compiles in ready(), and the first job compiles nothing and keeps its verdicts', { timeout: 120000 }, async t => {
  const { job, directory } = await fixture(t, { invariants: ['identity', TS_INVARIANT] });
  const pool = new IsolatePool({ hostPort, size: 1, warm: {}, ...WORKCELL });
  t.after(() => pool.close());
  await pool.ready();
  const reportFile = join(directory, 'reports.jsonl');
  const result = await pool.run(job(['pass', 'dominated'], options({ reportFile })));
  assert.equal(result.status, 'completed');
  assert.equal(result.receipts[0].record.data.outcome_state, 'passed');
  assert.equal(result.receipts[1].record.data.outcome_state, 'failed');
  assert.ok(reports(reportFile).every(row => row.warm && row.compileMs === 0));
});

test('in process cells, deep input needs the stack limit as it does in threads', { timeout: 120000 }, async t => {
  const deep = project(`export const n = ${Array(60000).fill('1').join(' + ')};\n`);
  const { resourceLimits: { stackSizeMb, ...heap }, ...rest } = WORKCELL;
  const small = await setup(t, { ...rest, isolation: 'process', resourceLimits: heap });
  const trapped = await small.pool.run(small.job(['pass'], options({ projects: { pass: deep } })));
  assert.equal(trapped.status, 'outcome_unknown');
  const large = await setup(t, { ...WORKCELL, isolation: 'process' });
  const passed = await large.pool.run(large.job(['pass'], options({ projects: { pass: deep } })));
  assert.equal(passed.status, 'completed');
  assert.equal(passed.isolation, 'process');
  assert.equal(passed.report.attempts[0].stage, 'passed');
});

test('a clean emit binds its artifact hashes and compiler identity into the receipt, and a failed one binds nothing', { timeout: 120000 }, async t => {
  const { job, directory } = await fixture(t, { invariants: ['identity', TS_INVARIANT] });
  const pool = new IsolatePool({ hostPort, size: 1, ...WORKCELL });
  t.after(() => pool.close());
  const emitting = source => ({ ...project(source), tsconfig: { compilerOptions: { ...compilerOptions, outDir: './out' }, files: ['./a.ts'] } });
  const reportFile = join(directory, 'emit.jsonl');
  const projects = { pass: emitting('export const n: number = 1;\n'), dominated: emitting('export const n: number = "x";\n') };
  const result = await pool.run(job(['pass', 'dominated'], options({ projects, emit: true, reportFile })));
  assert.equal(result.status, 'completed');
  const [path, digest] = Object.entries(reports(reportFile).find(row => row.artifact).artifact.sha256)[0];
  assert.match(path, /out\/a\.js$/);
  const [good, bad] = result.receipts.map(receipt => receipt.record.data);
  assert.equal(good.outcome_state, 'passed');
  assert.equal(bad.outcome_state, 'failed');
  const rows = good.observations[0].evidence.typescript;
  assert.deepEqual(rows.map(row => [row.candidate, row.round]), [['pass', 0], ['pass', 1]]);
  for (const row of rows) {
    assert.deepEqual(row.compiler, { name: TSRS_MODULE.name, sha256: TSRS_MODULE.sha256 });
    assert.deepEqual(row.sha256, { [path]: digest });
  }
  assert.deepEqual(bad.observations[0].evidence, good.observations[0].evidence);
  const plain = await pool.run(job(['pass'], options({ projects })));
  assert.equal(plain.receipts[0].record.data.observations[0].evidence, undefined);
});

test('build info feedback matches a full check, is refused with emit, and can be forged', { timeout: 60000 }, async () => {
  const shared = 'export interface Rec { id: number }\n';
  const files = (a, b) => ({ '/proj/shared.ts': shared, '/proj/a.ts': a, '/proj/b.ts': b });
  const tsconfig = { compilerOptions, files: ['./shared.ts', './a.ts', './b.ts'] };
  const a = 'import type { Rec } from "./shared";\nexport const r: Rec = { id: 1 };\n';
  const b = 'export const n: number = "x";\n';
  const check = (nextFiles, buildInfo) => typecheck({ root: '/proj', files: nextFiles, tsconfig }, buildInfo === undefined ? {} : { buildInfo });
  const seed = await check(files(a, b), null);
  assert.equal(seed.diagnostics.length, 1);
  assert.ok(seed.buildInfo.length > 0);
  const edited = files(`${a}// edited\n`, b);
  const [full, incremental] = [await check(edited), await check(edited, seed.buildInfo)];
  assert.deepEqual(incremental.diagnostics, full.diagnostics);
  assert.equal(incremental.exitCode, full.exitCode);
  assert.equal(full.buildInfo, undefined);
  const newError = files(a, `${b}export const m: string = 1;\n`);
  assert.deepEqual((await check(newError, incremental.buildInfo)).diagnostics, (await check(newError)).diagnostics);
  await assert.rejects(typecheck({ root: '/proj', files: edited, tsconfig }, { emit: true, buildInfo: null }), /full check/);
  const parsed = JSON.parse(seed.buildInfo);
  delete parsed.semanticDiagnosticsPerFile;
  const forged = await check(files(a, b), JSON.stringify(parsed));
  assert.deepEqual(forged.diagnostics, [], 'forged build info hides the error, which is why it must never come from a candidate');
});
