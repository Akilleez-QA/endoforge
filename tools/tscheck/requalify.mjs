import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { fixture, hostPort as basePort } from '../../core/runtime/test/fixtures/ledger-fixture.mjs';
import { TSRS_MODULE, TSRS_ORACLE_SHA256, TSRS_VERSION, TSRS_WORKLOAD_SHA256, WORKCELL } from './pin.mjs';
import { TS_INVARIANT } from './port.mjs';
import { HOST_OPTIONS } from './checker.mjs';

const JOB_MS = 120000;
export const MIN_PROJECTS = 20;
export const MIN_VARIETY = Object.freeze({ clean: 3, diagnosed: 3, codes: 5, distinct: MIN_PROJECTS });
const PINS = Object.freeze({ oracle: TSRS_ORACLE_SHA256[`${process.platform}-${process.arch}`] ?? null, workload: TSRS_WORKLOAD_SHA256 });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
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

function parseRows(stdout) {
  const rows = [];
  for (const line of (stdout ?? '').split('\n')) {
    const m = /^(.+?)\((\d+),(\d+)\): (?:error|warning) TS(\d+): (.*)$/.exec(line);
    if (m) rows.push({ file: m[1], line: +m[2], column: +m[3], code: +m[4], text: m[5] });
    const global = /^(?:error|warning) TS(\d+): (.*)$/.exec(line);
    if (global) rows.push({ file: null, line: 0, column: 0, code: +global[1], text: global[2] });
  }
  return rows;
}

function oracle(tsc, directory, scratch) {
  const info = join(scratch, 'oracle.tsbuildinfo');
  try {
    const r = spawnSync(tsc, ['-p', 'tsconfig.json', ...HOST_OPTIONS, '--tsBuildInfoFile', info, '--noEmit', '--pretty', 'false'], { cwd: directory, encoding: 'utf8', timeout: JOB_MS, maxBuffer: 1 << 28 });
    return { exitCode: r.status, rows: parseRows(r.stdout) };
  } finally { rmSync(info, { force: true }); }
}

function plainOracle(tsc, directory, scratch) {
  const copy = join(scratch, 'plain');
  cpSync(directory, copy, { recursive: true });
  try {
    const r = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: copy, encoding: 'utf8', timeout: JOB_MS, maxBuffer: 1 << 28 });
    return { exitCode: r.status, rows: parseRows(r.stdout) };
  } finally { rmSync(copy, { recursive: true, force: true }); }
}

export function oracleDigest(tsc) {
  try {
    const launcher = realpathSync(tsc);
    const root = dirname(dirname(launcher));
    const parts = launcher.endsWith('/typescript/bin/tsc')
      ? ['bin/tsc', 'lib/tsc.js', 'lib/getExePath.js', 'package.json', `../@typescript/typescript-${process.platform}-${process.arch}/lib/tsc`].map(name => [name, join(root, name)])
      : [['launcher', launcher]];
    return sha256(parts.map(([name, path]) => `${name}\0${sha256(readFileSync(path))}\n`).join(''));
  } catch { return null; }
}

function treeRows(directory, root = directory, rows = []) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) treeRows(path, root, rows);
    else rows.push(`${relative(root, path)}\0${sha256(readFileSync(path))}\n`);
  }
  return rows;
}

export function workloadDigest(work) {
  return existsSync(work) ? sha256(treeRows(work).join('')) : null;
}

function varietyOf(rows) {
  const located = rows.filter(row => row.file && !/(?:^|\/)tsconfig[^/]*\.json$/.test(row.file));
  return { located: located.length, codes: located.map(row => row.code) };
}

export function expectedOracleVersion(version = TSRS_VERSION) {
  return /-ts(.+)$/.exec(version)?.[1] ?? null;
}

export async function requalify({ work, tsc, vendor, port = basePort, pins = PINS }) {
  const differences = [];
  const expected = expectedOracleVersion();
  const version = spawnSync(tsc, ['--version'], { encoding: 'utf8', timeout: JOB_MS }).stdout?.trim() ?? '';
  if (version !== `Version ${expected}`) differences.push({ project: null, kind: 'oracle-version', expected, got: version });
  const gotOracle = oracleDigest(tsc);
  if (!pins.oracle || gotOracle !== pins.oracle) differences.push({ project: null, kind: 'oracle-digest', expected: pins.oracle, got: gotOracle });
  const gotWorkload = workloadDigest(work);
  if (gotWorkload !== pins.workload) differences.push({ project: null, kind: 'workload-digest', expected: pins.workload, got: gotWorkload });
  const projects = [];
  for (const group of existsSync(work) ? readdirSync(work).sort() : []) {
    if (!statSync(join(work, group)).isDirectory()) { differences.push({ project: group, kind: 'skipped' }); continue; }
    for (const name of readdirSync(join(work, group)).sort()) {
      if (name === 'manifest.json') continue;
      if (existsSync(join(work, group, name, 'proj', 'tsconfig.json'))) projects.push(`${group}/${name}`);
      else differences.push({ project: `${group}/${name}`, kind: 'skipped' });
    }
  }
  if (!projects.length) differences.push({ project: null, kind: 'no-projects', work });
  else if (projects.length < MIN_PROJECTS) differences.push({ project: null, kind: 'too-few-projects', minimum: MIN_PROJECTS, got: projects.length });
  const cleanup = [];
  const scratch = mkdtempSync(join(tmpdir(), 'ef-requalify-'));
  const rows = {};
  const variety = { clean: 0, diagnosed: 0, codes: new Set(), sources: new Set() };
  try {
    const { job } = await fixture({ after: fn => cleanup.push(fn) }, { invariants: ['identity', TS_INVARIANT] });
    const pool = new IsolatePool({ hostPort, size: 1, jobTimeoutMs: JOB_MS, prewarm: true, ...WORKCELL });
    try {
      await pool.ready();
      for (const name of projects) {
        const directory = join(work, name, 'proj');
        const expectedRows = oracle(tsc, directory, scratch);
        const plain = plainOracle(tsc, directory, scratch);
        const seen = varietyOf(expectedRows.rows);
        if (expectedRows.exitCode === 0 && !expectedRows.rows.length) variety.clean += 1;
        if (seen.located) variety.diagnosed += 1;
        for (const code of seen.codes) variety.codes.add(code);
        variety.sources.add(sha256(treeRows(directory).filter(row => !row.startsWith('tsconfig.json\0')).join('')));
        const file = join(scratch, `${name.replace('/', '-')}.jsonl`);
        const result = await pool.run(job(['pass'], { basePort: port, projects: { pass: { root: '/proj', files: read(directory, directory) } }, reportFile: file, ...(vendor ? { vendor: String(vendor) } : {}) }));
        const report = reports(file)[0];
        const got = report?.diagnostics ?? [];
        const a = new Set(expectedRows.rows.map(key)), b = new Set(got.map(key));
        const texts = new Set(expectedRows.rows.map(d => `${key(d)} ${d.text}`));
        const found = [];
        if (plain.exitCode !== expectedRows.exitCode || JSON.stringify(plain.rows) !== JSON.stringify(expectedRows.rows)) {
          found.push({ kind: 'host-option-effect', plain: { exitCode: plain.exitCode, codes: plain.rows.slice(0, 20).map(row => row.code) }, host: { exitCode: expectedRows.exitCode, codes: expectedRows.rows.slice(0, 20).map(row => row.code) } });
        }
        if (result.status !== 'completed' || !report) found.push({ kind: 'not-completed', status: result.status, reason: result.reason ?? null });
        else {
          if (report.exitCode !== expectedRows.exitCode) found.push({ kind: 'exit-code', oracle: expectedRows.exitCode, checker: report.exitCode });
          const missing = [...a].filter(k => !b.has(k)), extra = [...b].filter(k => !a.has(k));
          if (missing.length || extra.length) found.push({ kind: 'location', missing: missing.slice(0, 20), extra: extra.slice(0, 20) });
          const text = got.filter(d => !texts.has(`${key(d)} ${firstLine(d.text)}`)).map(key);
          if (!missing.length && !extra.length && text.length) found.push({ kind: 'text', keys: text.slice(0, 20) });
        }
        rows[name] = { diagnostics: expectedRows.rows.length, wallMs: report?.wallMs ?? null, differences: found.length };
        for (const difference of found) differences.push({ project: name, ...difference });
      }
      if (projects.length && !Object.values(rows).some(row => row.diagnostics > 0)) differences.push({ project: null, kind: 'no-diagnostics' });
      const measured = { clean: variety.clean, diagnosed: variety.diagnosed, codes: variety.codes.size, distinct: variety.sources.size };
      if (Object.entries(MIN_VARIETY).some(([name, minimum]) => measured[name] < minimum)) differences.push({ project: null, kind: 'no-variety', minimum: MIN_VARIETY, got: measured });
    } finally { await pool.close(); }
  } finally {
    for (const fn of cleanup) await fn();
    rmSync(scratch, { recursive: true, force: true });
  }
  return { compiler: TSRS_MODULE.name, sha256: TSRS_MODULE.sha256, oracle: version, node: process.version, projects: rows, differences };
}

export async function main(argv, options = {}) {
  const { values: { work, tsc, out } } = parseArgs({ args: argv, options: { work: { type: 'string' }, tsc: { type: 'string' }, out: { type: 'string' } } });
  if (!work || !tsc) {
    console.error('usage: node tools/tscheck/requalify.mjs --work DIR --tsc PATH [--out FILE]');
    process.exitCode = 2;
    return;
  }
  const report = await requalify({ work: resolve(work), tsc: resolve(tsc), ...options });
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  const names = Object.keys(report.projects);
  console.log(`${report.compiler} against ${report.oracle || 'no oracle version'}: ${names.length} projects, ${report.differences.length} differences`);
  for (const difference of report.differences) console.log(JSON.stringify(difference));
  process.exitCode = report.differences.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
