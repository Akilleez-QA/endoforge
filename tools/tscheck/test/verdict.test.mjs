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

const forged = `// @ts-nocheck\n${bad}`;
const pathForgeries = {
  'an upper-case .D.ts': '/proj/a.D.ts',
  'an upper-case .D.mts': '/proj/a.D.mts',
  'an upper-case .D.cts': '/proj/a.D.cts',
  'a mixed-case .D.x.ts': '/proj/a.D.x.ts',
  'an upper-case .TS': '/proj/a.TS',
  'a mixed-case .Tsx': '/proj/a.Tsx',
  'a fullwidth extension': '/proj/a.\uff54\uff53',
  'a fullwidth dot': '/proj/a\uff0ets',
  'a long-s extension': '/proj/a.t\u017f',
  'a trailing slash': '/proj/a.ts/',
  'a trailing backslash': '/proj/a.ts\\',
  'a backslash separator': '/proj\\a.ts',
  'a backslash parent walk': '/proj/node_modules/..\\a.ts',
  'a parent walk': '/proj/node_modules/../a.ts',
  'a parent walk through a sibling': '/proj/x/../a.ts',
  'a dot segment': '/proj/./a.ts',
  'a doubled slash': '/proj//a.ts',
  'a doubled leading slash': '//proj/a.ts',
  'a trailing dot': '/proj/a.ts.',
  'a trailing space': '/proj/a.ts ',
  'a trailing no-break space': '/proj/a.ts\u00a0',
  'a NUL': '/proj/a.ts\0',
  'an inner NUL': '/proj/a\0.ts',
  'a tab': '/proj/a\t.ts',
  'a carriage return': '/proj/a\r.ts',
  'a next-line control': '/proj/a\u0085.ts',
  'a line separator': '/proj/a\u2028.ts',
  'a paragraph separator': '/proj/a\u2029.ts',
  'a zero-width space': '/proj/a\u200b.ts',
  'a right-to-left override': '/proj/a\u202e.ts',
  'a byte order mark': '/proj/\ufeffa.ts',
  'a lone surrogate': '/proj/a\ud800.ts',
  'a decomposed name': '/proj/e\u0301.ts',
  'a path outside the root': '/other/a.ts',
  'a sibling of the root sharing its prefix': '/proj2/a.ts',
  'a relative path': 'proj/a.ts',
  'the root in another case': '/PROJ/a.ts',
};

for (const [name, key] of Object.entries(pathForgeries)) {
  test(`${name} in a file key is refused and never passes`, { timeout: 60000 }, async () => {
    const files = { '/proj/b.ts': good, [key]: forged };
    await assert.rejects(typecheck(project({ compilerOptions, include: ['**/*'] }, files)), /project path/);
  });
}

test('keys that differ only by case or Unicode form are refused', { timeout: 60000 }, async () => {
  await assert.rejects(typecheck(project(listed(), { '/proj/a.ts': good, '/proj/A.ts': good })), /project path/);
  await assert.rejects(typecheck(project(listed(), { '/proj/a.ts': good, '/proj/\uff41.ts': good })), /project path/);
});

test('a key that is both a file and a directory is refused', { timeout: 60000 }, async () => {
  await assert.rejects(typecheck(project(listed(), { '/proj/a.ts': good, '/proj/a.ts/x.ts': forged })), /project path/);
});

test('a build info name in any case or as a directory is refused', { timeout: 60000 }, async () => {
  for (const key of ['/proj/.tsbuildinfo/', '/proj/.tsbuildinfo/x.ts', '/proj/.TSBUILDINFO', '/proj/x.tsbuildinf\uff4f', '/proj/.tsbuildinfo\\']) {
    await assert.rejects(typecheck(project(listed(), { '/proj/a.ts': good, [key]: '{}' })), /build info|project path/, key);
  }
});

test('a root that is not canonical is refused', { timeout: 60000 }, async () => {
  for (const root of ['/', '', 'proj', '/proj/', '/proj/.', '/x/../proj', '/proj\\', '/proj\n', undefined]) {
    await assert.rejects(typecheck({ root, files: { [`${root}/a.ts`]: good }, tsconfig: listed() }), /project path/, String(root));
  }
});

test('file contents that are neither text nor bytes are refused', { timeout: 60000 }, async () => {
  await assert.rejects(typecheck(project(listed(), { '/proj/a.ts': good, '/proj/b.ts': { length: 0 } })), /project path/);
});

test('the checker classifies a name the way the compiler does', { timeout: 60000 }, async () => {
  for (const name of ['d.ts', 'a.d.tsx', 'x.d.y/a.ts', 'a.tsx', 'a.mts', 'a.cts']) {
    const report = await typecheck(project({ compilerOptions: { ...compilerOptions, skipLibCheck: true, jsx: 'preserve' }, include: ['**/*'] }, { [`/proj/${name}`]: bad }));
    assert.deepEqual(report.diagnostics.map(d => d.code), [2322], name);
    await assert.rejects(typecheck(project({ compilerOptions: { ...compilerOptions, skipLibCheck: true, jsx: 'preserve' }, include: ['**/*'] }, { [`/proj/${name}`]: forged })), /@ts-nocheck/, name);
  }
  for (const name of ['a.d.ts', 'a.d.mts', 'a.d.cts', 'a.d.x.ts', 'a.d.x.y.ts', 'a.d.ts.ts', 'a.d..ts', '.d.ts', 'a.d.d.ts', 'x.d.json.ts']) {
    const report = await typecheck(project({ compilerOptions: { ...compilerOptions, skipLibCheck: true }, include: ['**/*'] }, { '/proj/b.ts': good, [`/proj/${name}`]: bad }));
    assert.deepEqual(report.diagnostics, [], name);
    assert.equal(report.checkedSources, 1, name);
  }
});

test('a file of another extension is data: it never joins the program as a source', { timeout: 60000 }, async () => {
  for (const name of ['a.txt', 'a.ts.bak', 'a.tsrs', 'a.vue', 'a.css']) {
    const report = await typecheck(project({ compilerOptions, include: ['**/*'] }, { '/proj/b.ts': good, [`/proj/${name}`]: forged }));
    assert.deepEqual(report.diagnostics, [], name);
    assert.equal(report.checkedSources, 1, name);
  }
  for (const reference of ['./a.txt', './a.vue']) {
    const report = await typecheck(project(listed(), { '/proj/a.ts': `/// <reference path="${reference}" />\nexport {};\n`, [`/proj/${reference.slice(2)}`]: bad }));
    assert.deepEqual(report.diagnostics.map(d => d.code), [6054], reference);
  }
});

test('every way the compiler honours @ts-nocheck is refused, and look-alikes it ignores still fail', { timeout: 60000 }, async () => {
  const body = pragma => `${pragma}\n${bad}`;
  const utf16 = (text, big) => {
    const units = Buffer.from(text, 'utf16le');
    if (big) units.swap16();
    return new Uint8Array(Buffer.concat([Buffer.from(big ? [0xfe, 0xff] : [0xff, 0xfe]), units]));
  };
  for (const content of [body('\ufeff// @ts-nocheck'), body('\u2028// @ts-nocheck'), body('//\t@ts-nocheck'), body('// x\n// @ts-nocheck'), body('// @ts-nocheck\u0130'),
    utf16(body('// @ts-nocheck')), utf16(body('// @ts-nocheck'), true), new TextEncoder().encode(body('\ufeff// @ts-nocheck'))]) {
    await assert.rejects(typecheck(project(listed(), { '/proj/a.ts': content })), /@ts-nocheck/);
  }
  for (const pragma of ['// @t\u017f-nocheck', '// @ts-nochec\u212a', '//\u00a0@ts-nocheck', '//\u200b@ts-nocheck', '// @ts\u2011nocheck']) {
    assert.deepEqual((await typecheck(project(listed(), { '/proj/a.ts': body(pragma) }))).diagnostics.map(d => d.code), [2322], pragma);
  }
});

const hideFromStdout = { outDir: 'o\n/proj/x.ts\n', listEmittedFiles: true };
test('an excluded source can not join the program through stdout', { timeout: 60000 }, async () => {
  const injected = project({ compilerOptions: { ...compilerOptions, ...hideFromStdout }, files: ['./a.ts'] }, { '/proj/a.ts': good, '/proj/x.ts': bad });
  await assert.rejects(typecheck(injected, { emit: true }), /outside the program/);
  await assert.rejects(typecheck(injected), /outside the program/);
});

test('program membership ignores whatever the project prints', { timeout: 60000 }, async () => {
  for (const options of [{ listFiles: true }, { listEmittedFiles: true }, { explainFiles: true }, { traceResolution: true }, { diagnostics: true }, { extendedDiagnostics: true }, { listFiles: false }]) {
    const report = await typecheck(project({ compilerOptions: { ...compilerOptions, ...options }, files: ['./a.ts', './b.ts'] }, { '/proj/a.ts': good, '/proj/b.ts': good }));
    assert.deepEqual(report.diagnostics, [], JSON.stringify(options));
    assert.equal(report.checkedSources, 2, JSON.stringify(options));
  }
});

test('an emit can not name a path outside the canonical project', { timeout: 60000 }, async () => {
  for (const outDir of ['o\nx', '/elsewhere', '../up', 'o\u2028']) {
    await assert.rejects(typecheck(project(listed({ outDir }), { '/proj/a.ts': good }), { emit: true }), /project path/, JSON.stringify(outDir));
  }
});

test('a project that makes the compiler record no program never passes', { timeout: 60000 }, async () => {
  const solution = project({ compilerOptions, files: [], references: [{ path: './sub' }] }, { '/proj/sub/a.d.ts': good, '/proj/sub/tsconfig.json': composite });
  await assert.rejects(typecheck(solution), /no TypeScript source/);
});

test('the compiler can not be pointed at another program list', { timeout: 60000 }, async () => {
  const redirected = project(listed({ incremental: true, tsBuildInfoFile: './other', outFile: './.tsbuildinfo' }), { '/proj/a.ts': good });
  assert.notEqual((await typecheck(redirected)).diagnostics.length, 0);
  const other = project({ compilerOptions: { ...compilerOptions, incremental: true, tsBuildInfoFile: './elsewhere.json' }, files: ['./a.ts'] }, { '/proj/a.ts': good, '/proj/x.ts': bad });
  await assert.rejects(typecheck(other), /outside the program/);
});

for (const [name, options] of Object.entries({
  'composite alone': {},
  'declarationMap': { declarationMap: true },
  'emitDeclarationOnly': { emitDeclarationOnly: true },
  'isolatedDeclarations': { isolatedDeclarations: true },
})) {
  test(`a clean composite project with ${name} passes, as plain tsc does`, { timeout: 60000 }, async () => {
    const report = await typecheck(project(listed({ composite: true, ...options }), { '/proj/a.ts': good }));
    assert.deepEqual(report.diagnostics, []);
    assert.equal(report.exitCode, 0);
    assert.equal(report.checkedSources, 1);
  });
}

test('host-owned program bookkeeping never reaches an artifact or a result', { timeout: 60000 }, async () => {
  const report = await typecheck(project(listed({ outDir: './out' }), { '/proj/a.ts': good }), { emit: true });
  assert.deepEqual(Object.keys(report.artifact.files), ['/proj/out/a.js']);
  assert.deepEqual(Object.keys(report.artifact.sha256), ['/proj/out/a.js']);
  assert.equal(report.buildInfo, undefined);
});

test('only the top-level node_modules is exempt from coverage', { timeout: 60000 }, async () => {
  for (const key of ['/proj/src/node_modules/app/main.ts', '/proj/a/node_modules/b/c.ts', '/proj/node_modules_x/a.ts', '/proj/x/node_modules/a.tsx']) {
    await assert.rejects(typecheck(project(listed(), { '/proj/a.ts': good, [key]: bad })), /outside the program/, key);
  }
  const imported = project(listed(), { '/proj/a.ts': 'import { n } from "x";\nexport const m: number = n;\n', '/proj/node_modules/x/package.json': '{"name":"x","types":"./index.ts"}', '/proj/node_modules/x/index.ts': bad });
  assert.ok((await typecheck(imported)).diagnostics.some(d => d.code === 2322 || d.code === 2307));
});

test('through the pool, a stdout forgery leaves no pass and no evidence row', { timeout: 120000 }, async t => {
  const { job } = await fixture(t, { invariants: ['identity', TS_INVARIANT] });
  const pool = new IsolatePool({ hostPort, size: 1, ...WORKCELL });
  t.after(() => pool.close());
  const injected = project({ compilerOptions: { ...compilerOptions, ...hideFromStdout }, files: ['./a.ts'] }, { '/proj/a.ts': good, '/proj/x.ts': bad });
  const result = await pool.run(job(['pass'], { basePort, projects: { pass: injected }, emit: true }));
  const { data } = result.receipts[0].record;
  assert.notEqual(data.outcome_state, 'passed');
  assert.deepEqual(data.observations[0].evidence?.typescript ?? [], []);
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
