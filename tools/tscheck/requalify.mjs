import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { fixture, hostPort as basePort } from '../../core/runtime/test/fixtures/ledger-fixture.mjs';
import { TSRS_MODULE, TSRS_VERSION, WORKCELL } from './pin.mjs';
import { TS_INVARIANT } from './port.mjs';

const JOB_MS = 120000;
const hostPort = fileURLToPath(new URL('./port.mjs', import.meta.url));
const read = (dir, root, files = {}) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) read(path, root, files);
    else files[`/proj/${relative(root, path)}`] = readFileSync(path, 'utf8');
  }
  return files;
};
const key = d => `${(d.file ?? '').replace(/^\/proj\//, '')}:${d.line}:${d.column}:${d.code}`;
const firstLine = text => text.split('\n')[0];
const reports = file => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];

function oracle(tsc, directory) {
  const r = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { cwd: directory, encoding: 'utf8', timeout: JOB_MS, maxBuffer: 1 << 28 });
  const rows = [];
  for (const line of (r.stdout ?? '').split('\n')) {
    const m = /^(.+?)\((\d+),(\d+)\): (?:error|warning) TS(\d+): (.*)$/.exec(line);
    if (m) rows.push({ file: m[1], line: +m[2], column: +m[3], code: +m[4], text: m[5] });
    const global = /^(?:error|warning) TS(\d+): (.*)$/.exec(line);
    if (global) rows.push({ file: null, line: 0, column: 0, code: +global[1], text: global[2] });
  }
  return { exitCode: r.status, rows };
}

export function expectedOracleVersion(version = TSRS_VERSION) {
  return /-ts(.+)$/.exec(version)?.[1] ?? null;
}

export async function requalify({ work, tsc }) {
  const differences = [];
  const expected = expectedOracleVersion();
  const version = spawnSync(tsc, ['--version'], { encoding: 'utf8', timeout: JOB_MS }).stdout?.trim() ?? '';
  if (version !== `Version ${expected}`) differences.push({ project: null, kind: 'oracle-version', expected, got: version });
  const projects = existsSync(work) ? readdirSync(work).sort().filter(group => statSync(join(work, group)).isDirectory()).flatMap(group => readdirSync(join(work, group)).sort()
    .filter(name => existsSync(join(work, group, name, 'proj', 'tsconfig.json'))).map(name => `${group}/${name}`)) : [];
  if (!projects.length) differences.push({ project: null, kind: 'no-projects', work });
  const cleanup = [];
  const scratch = mkdtempSync(join(tmpdir(), 'ef-requalify-'));
  const rows = {};
  try {
    const { job } = await fixture({ after: fn => cleanup.push(fn) }, { invariants: ['identity', TS_INVARIANT] });
    const pool = new IsolatePool({ hostPort, size: 1, jobTimeoutMs: JOB_MS, prewarm: true, ...WORKCELL });
    try {
      await pool.ready();
      for (const name of projects) {
        const directory = join(work, name, 'proj');
        const expectedRows = oracle(tsc, directory);
        const file = join(scratch, `${name.replace('/', '-')}.jsonl`);
        const result = await pool.run(job(['pass'], { basePort, projects: { pass: { root: '/proj', files: read(directory, directory) } }, reportFile: file }));
        const report = reports(file)[0];
        const got = report?.diagnostics ?? [];
        const a = new Set(expectedRows.rows.map(key)), b = new Set(got.map(key));
        const texts = new Set(expectedRows.rows.map(d => `${key(d)} ${d.text}`));
        const found = [];
        if (result.status !== 'completed' || !report) found.push({ kind: 'not-completed', status: result.status, reason: result.reason ?? null });
        else {
          if (report.compiler.sha256 !== TSRS_MODULE.sha256) found.push({ kind: 'compiler', got: report.compiler.sha256 });
          if (report.exitCode !== expectedRows.exitCode) found.push({ kind: 'exit-code', oracle: expectedRows.exitCode, checker: report.exitCode });
          const missing = [...a].filter(k => !b.has(k)), extra = [...b].filter(k => !a.has(k));
          if (missing.length || extra.length) found.push({ kind: 'location', missing: missing.slice(0, 20), extra: extra.slice(0, 20) });
          const text = got.filter(d => !texts.has(`${key(d)} ${firstLine(d.text)}`)).map(key);
          if (!missing.length && !extra.length && text.length) found.push({ kind: 'text', keys: text.slice(0, 20) });
        }
        rows[name] = { diagnostics: expectedRows.rows.length, wallMs: report?.wallMs ?? null, differences: found.length };
        for (const difference of found) differences.push({ project: name, ...difference });
      }
    } finally { await pool.close(); }
  } finally {
    for (const fn of cleanup) await fn();
    rmSync(scratch, { recursive: true, force: true });
  }
  return { compiler: TSRS_MODULE.name, sha256: TSRS_MODULE.sha256, oracle: version, node: process.version, projects: rows, differences };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: { work, tsc, out } } = parseArgs({ options: { work: { type: 'string' }, tsc: { type: 'string' }, out: { type: 'string' } } });
  if (!work || !tsc) {
    console.error('usage: node tools/tscheck/requalify.mjs --work DIR --tsc PATH [--out FILE]');
    process.exit(2);
  }
  const report = await requalify({ work: resolve(work), tsc: resolve(tsc) });
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  const names = Object.keys(report.projects);
  console.log(`${report.compiler} against ${report.oracle || 'no oracle version'}: ${names.length} projects, ${report.differences.length} differences`);
  for (const difference of report.differences) console.log(JSON.stringify(difference));
  process.exitCode = report.differences.length ? 1 : 0;
}
