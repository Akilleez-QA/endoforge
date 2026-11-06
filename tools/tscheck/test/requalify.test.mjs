import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { typecheck } from '../checker.mjs';
import { MIN_PROJECTS, expectedOracleVersion } from '../requalify.mjs';

const command = fileURLToPath(new URL('../requalify.mjs', import.meta.url));
const source = 'export const n: number = "x";\n';
const clean = 'export const n: number = 1;\n';
const tsconfig = { compilerOptions: { strict: true, target: 'es2022', lib: ['es2022'], module: 'esnext', moduleResolution: 'bundler', types: [], noEmit: true }, files: ['./a.ts'] };

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ef-requalify-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  corpus(directory, MIN_PROJECTS);
  return directory;
}
function corpus(directory, count, text = source) {
  for (let index = 0; index < count; index++) {
    const proj = join(directory, 'work', 'synthetic', index ? `ill-${index}` : 'ill', 'proj');
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, 'a.ts'), text);
    writeFileSync(join(proj, 'tsconfig.json'), JSON.stringify(tsconfig));
  }
}
function bare(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ef-requalify-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function oracle(directory, { version = expectedOracleVersion(), stdout = '', exit = 2 } = {}) {
  const path = join(directory, 'tsc');
  writeFileSync(path, `#!/usr/bin/env node\nif (process.argv.includes('--version')) { console.log(${JSON.stringify(`Version ${version}`)}); process.exit(0); }\nprocess.stdout.write(${JSON.stringify(stdout)});\nprocess.exit(${exit});\n`);
  chmodSync(path, 0o755);
  return path;
}
const run = (directory, tsc, extra = []) => spawnSync(process.execPath, [command, '--work', join(directory, 'work'), '--tsc', tsc, ...extra], { encoding: 'utf8', timeout: 120000 });
const realDiagnostics = async () => {
  const { exitCode, diagnostics } = await typecheck({ root: '/proj', files: { '/proj/a.ts': source }, tsconfig });
  return { exit: exitCode, stdout: diagnostics.map(d => `${d.file.replace('/proj/', '')}(${d.line},${d.column}): error TS${d.code}: ${d.text.split('\n')[0]}\n`).join('') };
};

test('requalification refuses without its arguments', () => {
  assert.equal(spawnSync(process.execPath, [command], { encoding: 'utf8' }).status, 2);
});

test('the oracle version comes from the pinned version', () => {
  assert.equal(expectedOracleVersion('0.1.0-ts9.9.9'), '9.9.9');
  assert.equal(expectedOracleVersion('0.1.0'), null);
});

test('a matching oracle exits zero and writes a report', { timeout: 120000 }, async t => {
  const directory = setup(t);
  const out = join(directory, 'report.json');
  const result = run(directory, oracle(directory, await realDiagnostics()), ['--out', out]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(report.differences, []);
  assert.equal(report.projects['synthetic/ill'].diagnostics, 1);
});

test('any difference from the oracle exits nonzero and names the project', { timeout: 120000 }, async t => {
  const real = await realDiagnostics();
  const cases = {
    location: { ...real, stdout: 'a.ts(9,9): error TS9999: Not what the checker said.\n' },
    text: { ...real, stdout: real.stdout.replace(/: error (TS\d+): .*/, ': error $1: A different message.') },
    'exit-code': { ...real, exit: 0 },
  };
  for (const [kind, options] of Object.entries(cases)) {
    const directory = setup(t);
    const result = run(directory, oracle(directory, options));
    assert.equal(result.status, 1, kind + result.stdout + result.stderr);
    assert.match(result.stdout, /synthetic\/ill/);
    assert.match(result.stdout, new RegExp(`"kind":"${kind}"`));
  }
});

test('a wrong oracle version exits nonzero', { timeout: 120000 }, async t => {
  const directory = setup(t);
  const result = run(directory, oracle(directory, { ...await realDiagnostics(), version: '0.0.0' }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /oracle-version/);
});

test('one clean project with a stub oracle and a silently dropped sibling never passes', { timeout: 120000 }, t => {
  const directory = bare(t);
  corpus(directory, 1, clean);
  const sibling = join(directory, 'work', 'synthetic', 'no-tsconfig', 'proj');
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(sibling, 'a.ts'), source);
  const result = run(directory, oracle(directory, { exit: 0 }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /"kind":"too-few-projects"/);
  assert.match(result.stdout, /"kind":"no-diagnostics"/);
  assert.match(result.stdout, /"project":"synthetic\/no-tsconfig","kind":"skipped"/);
});

test('a full corpus of clean projects proves nothing about diagnostics', { timeout: 120000 }, t => {
  const directory = bare(t);
  corpus(directory, MIN_PROJECTS, clean);
  const result = run(directory, oracle(directory, { exit: 0 }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /"kind":"no-diagnostics"/);
  assert.doesNotMatch(result.stdout, /too-few-projects/);
});

test('one project short of the minimum never passes', { timeout: 120000 }, async t => {
  const directory = bare(t);
  corpus(directory, MIN_PROJECTS - 1);
  const result = run(directory, oracle(directory, await realDiagnostics()));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /"kind":"too-few-projects"/);
  assert.doesNotMatch(result.stdout, /no-diagnostics/);
});

test('anything skipped fails an otherwise matching run: a directory or a loose file', { timeout: 120000 }, async t => {
  for (const add of [
    directory => mkdirSync(join(directory, 'work', 'synthetic', 'empty')),
    directory => writeFileSync(join(directory, 'work', 'synthetic', 'loose.ts'), source),
    directory => writeFileSync(join(directory, 'work', 'loose.ts'), source),
  ]) {
    const directory = setup(t);
    add(directory);
    const result = run(directory, oracle(directory, await realDiagnostics()));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /"kind":"skipped"/);
  }
});

test('an empty workload never passes', { timeout: 60000 }, t => {
  const directory = setup(t);
  rmSync(join(directory, 'work', 'synthetic'), { recursive: true });
  const result = run(directory, oracle(directory));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no-projects/);
});
