import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { IsolatePool } from '../../../core/runtime/isolate-pool.mjs';
import { fixture, hostPort as basePort } from '../../../core/runtime/test/fixtures/ledger-fixture.mjs';
import { typecheck } from '../checker.mjs';
import { WORKCELL } from '../pin.mjs';
import { TS_INVARIANT } from '../port.mjs';

const hostPort = fileURLToPath(new URL('../port.mjs', import.meta.url));
const compilerOptions = { strict: true, target: 'es2022', lib: ['es2022'], module: 'esnext', moduleResolution: 'bundler', types: [] };
const bad = 'export const n: number = "x";\n';
const good = 'export const n: number = 1;\n';
const project = (tsconfig, files = { '/proj/a.ts': bad }) => ({ root: '/proj', files, tsconfig });
const listed = (options = {}) => ({ compilerOptions: { ...compilerOptions, ...options }, files: ['./a.ts'] });
const composite = JSON.stringify({ compilerOptions: { ...compilerOptions, composite: true }, files: ['./a.ts'] });

const vendorDirectory = new URL('../node_modules/@tsrs/wasm/', import.meta.url);
const core = await import(new URL('core.js', vendorDirectory));
const compiled = new WebAssembly.Module(readFileSync(new URL('tsrs.wasm', vendorDirectory)));
const forgedInfo = (forgedProject, infoPath, extra = []) => {
  const host = core.memoryFileSystem({ ...forgedProject.files, '/proj/tsconfig.json': JSON.stringify(forgedProject.tsconfig) });
  core.runTsc(compiled, core.makeRequest(['-p', '/proj/tsconfig.json', '--pretty', 'false', ...extra], { cwd: '/proj', json: true }), host, { env: {}, stdout: () => {}, stderr: () => {} });
  const parsed = JSON.parse(Buffer.from(host.written.get(infoPath)).toString());
  delete parsed.semanticDiagnosticsPerFile;
  return JSON.stringify(parsed);
};

const overridden = {
  noCheck: project(listed({ noCheck: true })),
  incremental: project(listed({ incremental: true })),
  composite: project(listed({ composite: true })),
  'noCheck through extends': project({ extends: './base.json', files: ['./a.ts'] }, { '/proj/a.ts': bad, '/proj/base.json': JSON.stringify({ compilerOptions: { ...compilerOptions, noCheck: true } }) }),
  'noCheck in a tsconfig file with comments': { root: '/proj', files: { '/proj/a.ts': bad, '/proj/tsconfig.json': `// a comment\n${JSON.stringify(listed({ noCheck: true }))}` } },
};

const refused = {
  '.tsbuildinfo input': [project(listed({ incremental: true, tsBuildInfoFile: './.tsbuildinfo' }), { '/proj/a.ts': bad, '/proj/.tsbuildinfo': '{}' }), /build info/],
  'default-named build info input': [project(listed({ incremental: true }), { '/proj/a.ts': bad, '/proj/tsconfig.tsbuildinfo': '{}' }), /build info/],
  'build info input, any case': [project(listed(), { '/proj/a.ts': good, '/proj/X.TSBuildInfo': '{}' }), /build info/],
  '// @ts-nocheck': [project(listed(), { '/proj/a.ts': `// @ts-nocheck\n${bad}` }), /@ts-nocheck/],
  '// @TS-NOCHECK': [project(listed(), { '/proj/a.ts': `// @TS-NOCHECK\n${bad}` }), /@ts-nocheck/],
  '///@ts-nocheck': [project(listed(), { '/proj/a.ts': `///@ts-nocheck\n${bad}` }), /@ts-nocheck/],
  '@ts-nocheck after a block comment': [project(listed(), { '/proj/a.ts': `/* x */ // @ts-nocheck\n${bad}` }), /@ts-nocheck/],
  '@ts-nocheck after a shebang': [project(listed(), { '/proj/a.ts': `#!/usr/bin/env node\n// @ts-nocheck\n${bad}` }), /@ts-nocheck/],
  '@ts-nocheck in bytes': [project(listed(), { '/proj/a.ts': new TextEncoder().encode(`// @ts-nocheck\n${bad}`) }), /@ts-nocheck/],
  exclude: [project({ compilerOptions, include: ['*.ts'], exclude: ['a.ts'] }, { '/proj/a.ts': bad, '/proj/ok.ts': good }), /outside the program/],
  'include missing the source': [project({ compilerOptions, include: ['ok.ts'] }, { '/proj/a.ts': bad, '/proj/ok.ts': good }), /outside the program/],
  'files missing the source': [project({ compilerOptions, files: ['./ok.ts'] }, { '/proj/a.ts': bad, '/proj/ok.ts': good }), /outside the program/],
  'files through extends': [project({ extends: './base.json' }, { '/proj/a.ts': bad, '/proj/ok.ts': good, '/proj/base.json': JSON.stringify({ compilerOptions, files: ['./ok.ts'] }) }), /outside the program/],
  'empty files with references': [project({ compilerOptions, files: [], references: [{ path: './sub' }] }, { '/proj/sub/a.ts': bad, '/proj/sub/tsconfig.json': composite }), /outside the program/],
  'files redirected by references': [project({ compilerOptions, files: ['./sub/a.ts'], references: [{ path: './sub' }] }, { '/proj/sub/a.ts': bad, '/proj/sub/tsconfig.json': composite }), /outside the program/],
  'an import redirected by references to a forged declaration': [project({ compilerOptions, files: ['./b.ts'], references: [{ path: './sub' }] }, {
    '/proj/b.ts': 'import { n } from "./sub/a";\nexport const m: number = n;\n', '/proj/sub/a.ts': bad, '/proj/sub/a.d.ts': 'export declare const n: number;\n', '/proj/sub/tsconfig.json': composite }), /outside the program/],
  'only a declaration file, with skipLibCheck': [project({ compilerOptions: { ...compilerOptions, skipLibCheck: true }, files: ['./a.d.ts'] }, { '/proj/a.d.ts': bad }), /no TypeScript source/],
  'only JavaScript, unchecked': [project({ compilerOptions: { ...compilerOptions, allowJs: true }, include: ['*.js'] }, { '/proj/a.js': 'export const n = 1; n.foo;\n' }), /no TypeScript source/],
  'only JSON': [project({ compilerOptions: { ...compilerOptions, resolveJsonModule: true }, include: ['*.json'] }, { '/proj/a.json': '{}' }), /no TypeScript source/],
  'a path with a newline': [project(listed(), { '/proj/a.ts': good, '/proj/ok.ts\n/proj/b.ts': good, '/proj/b.ts': bad }), /newline/],
};

for (const [name, forged] of Object.entries(overridden)) {
  test(`a type error still fails with ${name}`, { timeout: 60000 }, async () => {
    const report = await typecheck(forged);
    assert.deepEqual(report.diagnostics.map(d => d.code), [2322]);
    assert.equal(report.exitCode, 2);
  });
}

test('a forged build info file under another name still fails', { timeout: 60000 }, async () => {
  const forged = project(listed({ incremental: true, tsBuildInfoFile: './info.json' }));
  forged.files = { ...forged.files, '/proj/info.json': forgedInfo(forged, '/proj/info.json', ['--noEmit']) };
  assert.deepEqual((await typecheck(forged)).diagnostics.map(d => d.code), [2322]);
});

test('noResolve can not drop an imported file from the check', { timeout: 60000 }, async () => {
  const report = await typecheck(project(listed({ noResolve: true }), { '/proj/a.ts': 'import { b } from "./b";\nexport const n: number = b;\n', '/proj/b.ts': 'export const b = "x";\n' }));
  assert.deepEqual(report.diagnostics.map(d => d.code), [2322]);
});

for (const [name, [forged, reason]] of Object.entries(refused)) {
  test(`${name} is refused and never passes`, { timeout: 60000 }, async () => {
    await assert.rejects(typecheck(forged), reason);
  });
}

test('a clean project reports how many sources it checked', { timeout: 60000 }, async () => {
  const report = await typecheck(project({ compilerOptions, files: ['./a.ts', './b.ts'] }, { '/proj/a.ts': good, '/proj/b.ts': good }));
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.checkedSources, 2);
});

test('an unused declaration file and an unimported node_modules source are not sources to cover', { timeout: 60000 }, async () => {
  const report = await typecheck(project(listed(), { '/proj/a.ts': good, '/proj/unused.d.ts': 'export declare const u: number;\n', '/proj/node_modules/x/index.ts': bad }));
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.checkedSources, 1);
});

test('a real error is a diagnostic even when coverage would have been refused', { timeout: 60000 }, async () => {
  const report = await typecheck(project({ compilerOptions, include: ['a.ts'] }, { '/proj/a.ts': bad, '/proj/other.ts': good }));
  assert.deepEqual(report.diagnostics.map(d => d.code), [2322]);
});

test('stated limits: suppression comments and skipLibCheck on a declaration file leave a pass', { timeout: 60000 }, async () => {
  for (const pragma of ['// @ts-ignore', '// @ts-expect-error']) {
    assert.deepEqual((await typecheck(project(listed(), { '/proj/a.ts': `${pragma}\n${bad}` }))).diagnostics, []);
  }
  const skipped = project({ compilerOptions: { ...compilerOptions, skipLibCheck: true }, files: ['./a.ts', './b.d.ts'] }, { '/proj/a.ts': good, '/proj/b.d.ts': bad });
  assert.deepEqual((await typecheck(skipped)).diagnostics, []);
  const weak = project({ compilerOptions: { ...compilerOptions, strict: false }, files: ['./a.ts'] }, { '/proj/a.ts': 'export const f = (x) => x;\n' });
  assert.deepEqual((await typecheck(weak)).diagnostics, []);
});

test('an emit that writes nothing is refused, not a clean artifact', { timeout: 60000 }, async () => {
  const quiet = project(listed({ noEmit: true, outDir: './out' }), { '/proj/a.ts': good });
  await assert.rejects(typecheck(quiet, { emit: true }), /emit produced no files/);
  const seeded = project(listed({ incremental: true, tsBuildInfoFile: './info.json', outDir: './out' }), { '/proj/a.ts': good });
  seeded.files = { ...seeded.files, '/proj/info.json': forgedInfo(seeded, '/proj/info.json') };
  const { artifact } = await typecheck(seeded, { emit: true });
  assert.deepEqual(Object.keys(artifact.files), ['/proj/out/a.js']);
});

test('through the pool, a forged project never gets a passed receipt', { timeout: 120000 }, async t => {
  const { job } = await fixture(t, { invariants: ['identity', TS_INVARIANT] });
  const pool = new IsolatePool({ hostPort, size: 1, ...WORKCELL });
  t.after(() => pool.close());
  const forgeries = [overridden.noCheck, refused['.tsbuildinfo input'][0], refused['// @ts-nocheck'][0], refused.exclude[0], refused['empty files with references'][0]];
  for (const forged of forgeries) {
    const result = await pool.run(job(['pass'], { basePort, projects: { pass: forged } }));
    assert.notEqual(result.receipts[0].record.data.outcome_state, 'passed');
  }
  const clean = await pool.run(job(['pass'], { basePort, projects: { pass: project(listed(), { '/proj/a.ts': good }) } }));
  assert.equal(clean.receipts[0].record.data.outcome_state, 'passed');
});

test('an emit that writes nothing leaves no clean artifact in the receipt', { timeout: 120000 }, async t => {
  const { job } = await fixture(t, { invariants: ['identity', TS_INVARIANT] });
  const pool = new IsolatePool({ hostPort, size: 1, ...WORKCELL });
  t.after(() => pool.close());
  const quiet = project(listed({ noEmit: true, outDir: './out' }), { '/proj/a.ts': good });
  const stopped = await pool.run(job(['pass'], { basePort, emit: true, projects: { pass: quiet } }));
  assert.equal(stopped.status, 'outcome_unknown');
  const data = stopped.receipts[0].record.data;
  assert.notEqual(data.outcome_state, 'passed');
  assert.deepEqual(data.observations[0].evidence?.typescript ?? [], []);
});

test('an emit over a prior build info file records the files it really wrote', { timeout: 120000 }, async t => {
  const { job } = await fixture(t, { invariants: ['identity', TS_INVARIANT] });
  const pool = new IsolatePool({ hostPort, size: 1, ...WORKCELL });
  t.after(() => pool.close());
  const seeded = project(listed({ incremental: true, tsBuildInfoFile: './info.json', outDir: './out' }), { '/proj/a.ts': good });
  seeded.files = { ...seeded.files, '/proj/info.json': forgedInfo(seeded, '/proj/info.json') };
  const result = await pool.run(job(['pass'], { basePort, emit: true, projects: { pass: seeded } }));
  assert.equal(result.status, 'completed', result.reason);
  const rows = result.receipts[0].record.data.observations[0].evidence.typescript;
  assert.ok(rows.length);
  for (const row of rows) assert.deepEqual(Object.keys(row.sha256), ['/proj/out/a.js']);
});

test('build info feedback keeps the host options and refuses a candidate build info file', { timeout: 60000 }, async () => {
  const seed = await typecheck(project(listed()), { buildInfo: null });
  assert.deepEqual(seed.diagnostics.map(d => d.code), [2322]);
  const quiet = await typecheck(project(listed({ noCheck: true })), { buildInfo: seed.buildInfo });
  assert.deepEqual(quiet.diagnostics.map(d => d.code), [2322], 'noCheck stays off with feedback');
  const forged = project(listed({ incremental: true, tsBuildInfoFile: './.tsbuildinfo' }), { '/proj/a.ts': bad, '/proj/.tsbuildinfo': '{}' });
  await assert.rejects(typecheck(forged, { buildInfo: null }), /build info/);
  const renamed = project(listed({ incremental: true, tsBuildInfoFile: './info.json' }));
  renamed.files = { ...renamed.files, '/proj/info.json': forgedInfo(renamed, '/proj/info.json', ['--noEmit']) };
  assert.deepEqual((await typecheck(renamed, { buildInfo: null })).diagnostics.map(d => d.code), [2322], 'only the host chooses the build info file');
  const coverage = project({ compilerOptions, include: ['ok.ts'] }, { '/proj/a.ts': bad, '/proj/ok.ts': good });
  await assert.rejects(typecheck(coverage, { buildInfo: null }), /outside the program/);
});

function vendorCopy(t, change) {
  const directory = mkdtempSync(join(tmpdir(), 'ef-tscheck-pin-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = new URL('../node_modules/@tsrs/wasm/', import.meta.url);
  cpSync(new URL('core.js', source), join(directory, 'core.js'));
  cpSync(new URL('tsrs.wasm', source), join(directory, 'tsrs.wasm'));
  change(directory);
  return pathToFileURL(`${directory}/`);
}

test('a valid module with other bytes is refused by the pin, before it compiles', { timeout: 120000 }, async t => {
  const vendor = vendorCopy(t, directory => {
    const path = join(directory, 'tsrs.wasm');
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.of(0, 2, 1, 120)]));
  });
  await assert.rejects(typecheck(project(listed(), { '/proj/a.ts': good }), { vendor }), /module hash/);
});

test('a working core with other bytes is refused by the pin, before it loads', { timeout: 120000 }, async t => {
  const vendor = vendorCopy(t, directory => {
    const path = join(directory, 'core.js');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n// other bytes\n`);
  });
  await assert.rejects(typecheck(project(listed(), { '/proj/a.ts': good }), { vendor }), /core hash/);
});
