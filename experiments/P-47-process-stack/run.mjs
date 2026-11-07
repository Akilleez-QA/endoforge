import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { fixture, hostPort as basePort } from '../../core/runtime/test/fixtures/ledger-fixture.mjs';
import { WORKCELL } from '../../tools/tscheck/pin.mjs';
import { TS_INVARIANT } from '../../tools/tscheck/port.mjs';

const [work, out] = process.argv.slice(2);
const probe = fileURLToPath(new URL('./probe.mjs', import.meta.url));
const names = ['js', 'json-parse', 'json-stringify', 'parser', 'wasm', 'clone'];
const result = { node: process.version, kernel: spawnSync('uname', ['-r'], { encoding: 'utf8' }).stdout.trim(), defaultStackKb: spawnSync('sh', ['-c', 'ulimit -s'], { encoding: 'utf8' }).stdout.trim(), naive: [], raised: [], pool: {} };
const shape = (label, r) => ({ label, status: r.status, signal: r.signal, output: r.stdout.trim().split('\n').at(-1).slice(0, 120) });
for (let rep = 0; rep < 3; rep++) for (const name of names) {
  result.naive.push(shape(name, spawnSync(process.execPath, ['--stack-size=261952', probe, name], { encoding: 'utf8', timeout: 60000 })));
  console.log(JSON.stringify(result.naive.at(-1)));
  for (const mb of [8, 64, 256]) {
    const kb = mb * 1024;
    result.raised.push({ mb, ...shape(name, spawnSync('/bin/sh', ['-c', 'ulimit -s "$1" && shift && exec "$@"', 'sh', String(kb), process.execPath, `--stack-size=${kb - 192}`, probe, name], { encoding: 'utf8', timeout: 60000 })) });
    console.log(JSON.stringify(result.raised.at(-1)));
  }
}
const hostPort = fileURLToPath(new URL('../../tools/tscheck/port.mjs', import.meta.url));
const breachPort = fileURLToPath(new URL('../P-43-tsrs-workcell/breach-port.mjs', import.meta.url));
const cleanup = [];
const t = { after: fn => cleanup.push(fn) };
const scratch = mkdtempSync(join(tmpdir(), 'p47-'));
const read = (dir, root, files = {}) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) read(path, root, files);
    else files[`/proj/${relative(root, path)}`] = readFileSync(path, 'utf8');
  }
  return files;
};
const load = name => ({ root: '/proj', files: read(join(work, name, 'proj'), join(work, name, 'proj')) });
const { job } = await fixture(t, { invariants: ['identity', TS_INVARIANT] });
const projects = [...readdirSync(join(work, 'dos')).sort().map(name => `dos/${name}`), 'medium/ill'];
const reports = file => readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const key = d => `${d.file}:${d.line}:${d.column}:${d.code}:${d.text}`;
const sweep = async isolation => {
  const pool = new IsolatePool({ hostPort, size: 1, isolation, jobTimeoutMs: 120000, prewarm: true, ...WORKCELL });
  await pool.ready();
  const rows = {};
  for (const name of projects) {
    const file = join(scratch, `${isolation}-${name.replace('/', '-')}.jsonl`);
    const r = await pool.run(job(['pass'], { basePort, projects: { pass: load(name) }, reportFile: file }));
    let report = null;
    try { report = reports(file)[0]; } catch { }
    rows[name] = { status: r.status, reason: r.reason ?? null, error: r.error ?? null, signal: r.signal ?? null, wallMs: report?.wallMs ?? null, diagnostics: report ? report.diagnostics.map(key).sort() : null };
    console.log(isolation, name, r.status, r.reason ?? '', r.signal ?? '', report?.wallMs ?? '', report?.diagnostics.length ?? '');
  }
  await pool.close();
  return rows;
};
const thread = await sweep('thread'), proc = await sweep('process');
result.pool.projects = Object.fromEntries(projects.map(name => [name, { thread: { ...thread[name], diagnostics: thread[name].diagnostics?.length ?? null }, process: { ...proc[name], diagnostics: proc[name].diagnostics?.length ?? null },
  identical: !!thread[name].diagnostics && JSON.stringify(thread[name].diagnostics) === JSON.stringify(proc[name].diagnostics) }]));
const compilerOptions = { strict: true, target: 'es2022', lib: ['es2022'], module: 'esnext', moduleResolution: 'bundler', types: [] };
const deep = { root: '/proj', files: { '/proj/a.ts': `export const n = ${Array(60000).fill('1').join(' + ')};\n` }, tsconfig: { compilerOptions, files: ['./a.ts'] } };
const { resourceLimits: { stackSizeMb, ...heap }, ...rest } = WORKCELL;
const small = new IsolatePool({ hostPort, size: 1, isolation: 'process', ...rest, resourceLimits: heap });
const noStack = await small.run(job(['pass'], { basePort, projects: { pass: deep } }));
await small.close();
const large = new IsolatePool({ hostPort, size: 1, isolation: 'process', ...WORKCELL });
const withStack = await large.run(job(['pass'], { basePort, projects: { pass: deep } }));
await large.close();
result.pool.deep = { withoutLimit: { status: noStack.status, reason: noStack.reason ?? null, signal: noStack.signal ?? null, outcome: noStack.receipts[0].record.data.outcome_state }, withLimit: { status: withStack.status, reason: withStack.reason ?? null, signal: withStack.signal ?? null, outcome: withStack.receipts[0].record.data.outcome_state } };
const release = join(scratch, 'release');
const small2 = { root: '/proj', files: { '/proj/a.ts': 'export const n: number = 1;\n' }, tsconfig: { compilerOptions, files: ['./a.ts'] } };
const breachOptions = extra => ({ basePort, projects: { pass: small2 }, checkPort: hostPort, ...extra });
const breachPool = new IsolatePool({ hostPort: breachPort, size: 2, isolation: 'process', prewarm: true, ...WORKCELL });
await breachPool.ready();
const sibling = breachPool.run(job(['pass'], breachOptions({ baseOptions: { release } })));
const breached = await breachPool.run(job(['pass'], breachOptions({ breach: true })));
writeFileSync(release, 'go');
const held = await sibling;
await breachPool.close();
result.pool.breach = { status: breached.status, reason: breached.reason, error: breached.error ?? null, sibling: held.status };
const deadlinePool = new IsolatePool({ hostPort, size: 1, isolation: 'process', jobTimeoutMs: 50, ...WORKCELL });
const late = await deadlinePool.run(job(['pass'], { basePort, projects: { pass: deep } }));
await deadlinePool.close();
result.pool.deadline = { status: late.status, reason: late.reason, signal: late.signal ?? null };
for (const fn of cleanup) await fn();
rmSync(scratch, { recursive: true, force: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ deep: result.pool.deep, breach: result.pool.breach, deadline: result.pool.deadline }));
