import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { HOST_OPTIONS, typecheck } from '../checker.mjs';
import { MIN_PROJECTS, expectedOracleVersion, oracleDigest, workloadDigest } from '../requalify.mjs';

const command = fileURLToPath(new URL('../requalify.mjs', import.meta.url));
const source = 'export const n: number = "x";\n';
const clean = 'export const n: number = 1;\n';
const tsconfig = { compilerOptions: { strict: true, target: 'es2022', lib: ['es2022'], module: 'esnext', moduleResolution: 'bundler', types: [], noEmit: true }, files: ['./a.ts'] };
const varied = [
  ['ill', source],
  ['undefined-name', 'export const n: number = missing;\n'],
  ['no-property', 'export const n: number = (1).nope;\n'],
  ['bad-argument', 'const f = (x: string) => x;\nexport const n = f(1);\n'],
  ['bad-arity', 'const f = (x: string) => x;\nexport const n = f();\n'],
  ['syntax', 'export const n: number = ;\n'],
];
const varietyMinimum = MIN_PROJECTS - varied.length;

function bare(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ef-requalify-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function project(directory, name, text, config = tsconfig) {
  const proj = join(directory, 'work', 'synthetic', name, 'proj');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'a.ts'), text);
  writeFileSync(join(proj, 'tsconfig.json'), JSON.stringify(config));
  return proj;
}
function setup(t) {
  const directory = bare(t);
  for (const [name, text] of varied) project(directory, name, text);
  for (let index = 0; index < varietyMinimum; index++) project(directory, `well-${index}`, `export const n${index}: number = ${index};\n`);
  return directory;
}
function corpus(directory, count, text = source) {
  for (let index = 0; index < count; index++) project(directory, index ? `ill-${index}` : 'ill', text);
}
async function answer(text) {
  const { exitCode, diagnostics } = await typecheck({ root: '/proj', files: { '/proj/a.ts': text }, tsconfig });
  return { exit: exitCode, stdout: diagnostics.map(d => `${d.file.replace('/proj/', '')}(${d.line},${d.column}): error TS${d.code}: ${d.text.split('\n')[0]}\n`).join('') };
}
const answers = async () => {
  const table = {};
  for (const [, text] of varied) table[text] = await answer(text);
  for (let index = 0; index < varietyMinimum; index++) table[`export const n${index}: number = ${index};\n`] = { exit: 0, stdout: '' };
  return table;
};
function oracle(directory, { version = expectedOracleVersion(), stdout = '', exit = 2, table, plain, log } = {}) {
  const path = join(directory, 'tsc');
  writeFileSync(path, `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
if (process.argv.includes('--version')) { console.log(${JSON.stringify(`Version ${version}`)}); process.exit(0); }
const argv = process.argv.slice(2);
const staleBefore = argv.includes('--tsBuildInfoFile') && existsSync(argv[argv.indexOf('--tsBuildInfoFile') + 1]);
const info = argv.indexOf('--tsBuildInfoFile') + 1;
if (info) writeFileSync(argv[info], '{}');
if (${JSON.stringify(log ?? null)}) appendFileSync(${JSON.stringify(log ?? '')}, JSON.stringify({ argv, stale: info > 0 && staleBefore }) + '\\n');
const table = ${JSON.stringify(table ?? null)};
const row = (!argv.includes('--noEmit') && ${JSON.stringify(plain ?? null)}) || (table && table[readFileSync('a.ts', 'utf8')]) || { stdout: ${JSON.stringify(stdout)}, exit: ${exit} };
process.stdout.write(row.stdout);
process.exit(row.exit);
`);
  chmodSync(path, 0o755);
  return path;
}
const driver = `
import { main, oracleDigest, workloadDigest } from ${JSON.stringify(new URL('../requalify.mjs', import.meta.url).href)};
const [options, ...argv] = process.argv.slice(1);
const given = JSON.parse(options);
const value = name => argv[argv.indexOf(name) + 1];
await main(argv, { ...given, pins: { oracle: given.oracle ?? oracleDigest(value('--tsc')), workload: given.workload ?? workloadDigest(value('--work')) } });
`;
const run = (directory, tsc, extra = [], options = {}) => spawnSync(process.execPath, ['--input-type=module', '-e', driver, JSON.stringify(options), '--work', join(directory, 'work'), '--tsc', tsc, ...extra], { encoding: 'utf8', timeout: 120000 });

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
  const result = run(directory, oracle(directory, { table: await answers() }), ['--out', out]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(report.differences, []);
  assert.equal(report.projects['synthetic/ill'].diagnostics, 1);
});

test('any difference from the oracle exits nonzero and names the project', { timeout: 120000 }, async t => {
  const table = await answers();
  const real = table[source];
  const cases = {
    location: { ...real, stdout: 'a.ts(9,9): error TS9999: Not what the checker said.\n' },
    text: { ...real, stdout: real.stdout.replace(/: error (TS\d+): .*/, ': error $1: A different message.') },
    'exit-code': { ...real, exit: 0 },
  };
  for (const [kind, row] of Object.entries(cases)) {
    const directory = setup(t);
    const result = run(directory, oracle(directory, { table: { ...table, [source]: row }, plain: undefined }));
    assert.equal(result.status, 1, kind + result.stdout + result.stderr);
    assert.match(result.stdout, /synthetic\/ill/);
    assert.match(result.stdout, new RegExp(`"kind":"${kind}"`));
  }
});

test('a wrong oracle version exits nonzero', { timeout: 120000 }, async t => {
  const directory = setup(t);
  const result = run(directory, oracle(directory, { table: await answers(), version: '0.0.0' }));
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
  const result = run(directory, oracle(directory, { table: { [source]: await answer(source) } }));
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
    const result = run(directory, oracle(directory, { table: await answers() }));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /"kind":"skipped"/);
  }
});

test('a workload manifest is not a skipped project', { timeout: 120000 }, async t => {
  const directory = setup(t);
  writeFileSync(join(directory, 'work', 'synthetic', 'manifest.json'), '{}');
  const result = run(directory, oracle(directory, { table: await answers() }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('an empty workload never passes', { timeout: 60000 }, t => {
  const directory = setup(t);
  rmSync(join(directory, 'work', 'synthetic'), { recursive: true });
  const result = run(directory, oracle(directory));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no-projects/);
});

test('the real pins refuse a stub oracle and any other workload, whatever they report', { timeout: 120000 }, async t => {
  const directory = setup(t);
  const tsc = oracle(directory, { table: await answers() });
  const result = spawnSync(process.execPath, [command, '--work', join(directory, 'work'), '--tsc', tsc], { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /"kind":"oracle-digest"/);
  assert.match(result.stdout, /"kind":"workload-digest"/);
});

test('a digest pin fires alone: the oracle one, then the workload one', { timeout: 120000 }, async t => {
  const table = await answers();
  const directory = setup(t);
  const oracleOff = run(directory, oracle(directory, { table }), [], { oracle: 'not-this' });
  assert.equal(oracleOff.status, 1);
  assert.match(oracleOff.stdout, /"kind":"oracle-digest"/);
  assert.doesNotMatch(oracleOff.stdout, /workload-digest/);
  const workloadOff = run(directory, oracle(directory, { table }), [], { workload: 'not-this' });
  assert.equal(workloadOff.status, 1);
  assert.match(workloadOff.stdout, /"kind":"workload-digest"/);
  assert.doesNotMatch(workloadOff.stdout, /oracle-digest/);
});

test('digests follow content: a changed file or oracle changes the digest, and a missing one has none', t => {
  const directory = setup(t);
  const before = workloadDigest(join(directory, 'work'));
  assert.equal(before, workloadDigest(join(directory, 'work')));
  writeFileSync(join(directory, 'work', 'synthetic', 'ill', 'proj', 'a.ts'), clean);
  assert.notEqual(workloadDigest(join(directory, 'work')), before);
  renameSync(join(directory, 'work', 'synthetic', 'ill'), join(directory, 'work', 'synthetic', 'renamed'));
  assert.notEqual(workloadDigest(join(directory, 'work')), before);
  assert.equal(workloadDigest(join(directory, 'absent')), null);
  const first = oracleDigest(oracle(directory, { exit: 0 }));
  assert.notEqual(oracleDigest(oracle(directory, { exit: 1 })), first);
  assert.equal(oracleDigest(join(directory, 'absent')), null);
  const package_ = join(directory, 'node_modules');
  mkdirSync(join(package_, 'typescript', 'bin'), { recursive: true });
  writeFileSync(join(package_, 'typescript', 'bin', 'tsc'), 'launcher');
  assert.equal(oracleDigest(join(package_, 'typescript', 'bin', 'tsc')), null, 'a package missing its native compiler has no digest');
});

test('twenty near-identical projects never pass, even matching a real answer', { timeout: 120000 }, async t => {
  const directory = bare(t);
  corpus(directory, MIN_PROJECTS);
  const result = run(directory, oracle(directory, { table: { [source]: await answer(source) } }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /"kind":"no-variety"/);
  assert.match(result.stdout, /"distinct":1/);
});

test('twenty broken tsconfigs never pass: a configuration error is not variety', { timeout: 120000 }, async t => {
  const directory = bare(t);
  const broken = { ...tsconfig, compilerOptions: { ...tsconfig.compilerOptions, target: 'nope' } };
  for (let index = 0; index < MIN_PROJECTS; index++) project(directory, `broken-${index}`, `export const n${index} = ${index};\n`, broken);
  const stdout = 'tsconfig.json(1,1): error TS6046: Argument for target must be one of the listed values.\n';
  const result = run(directory, oracle(directory, { stdout }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /"kind":"no-variety"/);
  assert.match(result.stdout, /"diagnosed":0/);
  assert.match(result.stdout, /"codes":0/);
});

test('each variety floor fires by itself', { timeout: 120000 }, async t => {
  const table = await answers();
  const fewer = (keep, floor) => {
    const directory = bare(t);
    let index = 0;
    for (const [name, text] of keep) project(directory, name, text);
    while (Object.keys(keep).length + index < MIN_PROJECTS) {
      project(directory, `pad-${index}`, `export const n${index}: number = ${index};\n`);
      index += 1;
    }
    return [directory, floor];
  };
  const noisy = Array.from({ length: MIN_PROJECTS }, (_, i) => [`bad-${i}`, `// ${i}\n${source}`]);
  const rows = {};
  for (const [name, text] of noisy) rows[text] = await answer(text);
  const [allBad] = fewer(noisy);
  const noClean = run(allBad, oracle(allBad, { table: rows }));
  assert.match(noClean.stdout, /"kind":"no-variety"/);
  assert.match(noClean.stdout, /"clean":0/);
  const [oneCode] = fewer(Array.from({ length: 4 }, (_, i) => [`bad-${i}`, `// ${i}\n${source}`]));
  const oneRows = { ...table };
  for (let i = 0; i < 4; i++) oneRows[`// ${i}\n${source}`] = await answer(`// ${i}\n${source}`);
  for (let i = 0; i < MIN_PROJECTS; i++) oneRows[`export const n${i}: number = ${i};\n`] = { exit: 0, stdout: '' };
  const single = run(oneCode, oracle(oneCode, { table: oneRows }));
  assert.match(single.stdout, /"kind":"no-variety"/);
  assert.match(single.stdout, /"codes":1/);
  const [twoBad] = fewer(Array.from({ length: 2 }, (_, i) => [`bad-${i}`, varied[i][1]]));
  const few = run(twoBad, oracle(twoBad, { table: oneRows }));
  assert.match(few.stdout, /"kind":"no-variety"/);
  assert.match(few.stdout, /"diagnosed":2/);
});

test('the oracle gets the host options once, and a plain run with none in a copy of the project', { timeout: 120000 }, async t => {
  const directory = setup(t);
  const log = join(directory, 'argv.log');
  const before = workloadDigest(join(directory, 'work'));
  const result = run(directory, oracle(directory, { table: await answers(), log }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.filter(call => call.stale), [], 'no project sees another project\'s build info');
  const hosted = calls.map(call => call.argv).filter(argv => argv.includes('--noEmit'));
  const plain = calls.map(call => call.argv).filter(argv => !argv.includes('--noEmit'));
  assert.equal(hosted.length, MIN_PROJECTS);
  assert.equal(plain.length, MIN_PROJECTS);
  for (const argv of hosted) for (let index = 0; index < HOST_OPTIONS.length; index += 2) {
    assert.equal(argv[argv.indexOf(HOST_OPTIONS[index]) + 1], HOST_OPTIONS[index + 1], HOST_OPTIONS[index]);
  }
  for (const argv of plain) assert.deepEqual(argv, ['-p', 'tsconfig.json', '--pretty', 'false']);
  assert.equal(workloadDigest(join(directory, 'work')), before, 'the plain run writes only to its copy');
});

test('a host option that changes the verdict shows: plain tsc disagrees with the hosted run', { timeout: 120000 }, async t => {
  for (const [name, plain] of Object.entries({ 'plain passes': { exit: 0, stdout: '' }, 'plain differs': { exit: 2, stdout: 'a.ts(1,1): error TS5069: Plain tsc said something else.\n' } })) {
    const directory = setup(t);
    const result = run(directory, oracle(directory, { table: await answers(), plain }));
    assert.equal(result.status, 1, name + result.stdout + result.stderr);
    assert.match(result.stdout, /"kind":"host-option-effect"/, name);
  }
});

test('a project the checker refuses shows as not completed, never compared', { timeout: 120000 }, async t => {
  const table = await answers();
  const directory = setup(t);
  writeFileSync(join(directory, 'work', 'synthetic', 'well-0', 'proj', 'left-out.ts'), source);
  const result = run(directory, oracle(directory, { table }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /"project":"synthetic\/well-0","kind":"not-completed"/);
});

test('a compiler that does not match the pin shows as not completed in every project', { timeout: 120000 }, async t => {
  const table = await answers();
  const directory = setup(t);
  const vendor = join(directory, 'vendor');
  mkdirSync(vendor);
  const source_ = new URL('../node_modules/@tsrs/wasm/', import.meta.url);
  cpSync(new URL('core.js', source_), join(vendor, 'core.js'));
  writeFileSync(join(vendor, 'tsrs.wasm'), Buffer.concat([readFileSync(new URL('tsrs.wasm', source_)), Buffer.of(0, 2, 1, 120)]));
  const result = run(directory, oracle(directory, { table }), [], { vendor: pathToFileURL(`${vendor}/`).href });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.stdout.match(/"kind":"not-completed"/g).length, MIN_PROJECTS);
});

test('a job lost after its report was written shows as not completed', { timeout: 120000 }, async t => {
  const table = await answers();
  const directory = setup(t);
  const port = join(directory, 'dying-port.mjs');
  writeFileSync(port, `import { createPort as base } from ${JSON.stringify(new URL('../../../core/runtime/test/fixtures/identity-port.mjs', import.meta.url).href)};
export async function createPort() { const port = await base(); return { ...port, measure() { process.exit(17); } }; }
`);
  const result = run(directory, oracle(directory, { table }), [], { port });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /"kind":"not-completed","status":"outcome_unknown"/);
});

test('a job that completes without running the checker shows as not completed', { timeout: 120000 }, async t => {
  const table = await answers();
  const directory = setup(t);
  const port = join(directory, 'failing-port.mjs');
  writeFileSync(port, `import { createPort as base } from ${JSON.stringify(new URL('../../../core/runtime/test/fixtures/identity-port.mjs', import.meta.url).href)};
export async function createPort() { const port = await base(); return { ...port, invariant() { return { passed: false, reason: 'synthetic' }; } }; }
`);
  const result = run(directory, oracle(directory, { table }), [], { port });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /"kind":"not-completed","status":"completed"/);
});
