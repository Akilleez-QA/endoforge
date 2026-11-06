import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { freemem, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { fixture, hostPort as basePort } from '../../core/runtime/test/fixtures/ledger-fixture.mjs';
import { WORKCELL } from '../../tools/tscheck/pin.mjs';
import { TS_INVARIANT } from '../../tools/tscheck/port.mjs';

const [work, tsc, out] = process.argv.slice(2);
const hostPort = fileURLToPath(new URL('../../tools/tscheck/port.mjs', import.meta.url));
const breachPort = fileURLToPath(new URL('./breach-port.mjs', import.meta.url));
const cleanup = [];
const t = { after: fn => cleanup.push(fn) };
const scratch = mkdtempSync(join(tmpdir(), 'p43-'));
const JOB_MS = 120000;
const read = (dir, root, files = {}) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) read(path, root, files);
    else files[`/proj/${relative(root, path)}`] = readFileSync(path, 'utf8');
  }
  return files;
};
const projects = readdirSync(work).sort().flatMap(group => readdirSync(join(work, group)).sort()
  .filter(name => existsSync(join(work, group, name, 'proj', 'tsconfig.json'))).map(name => `${group}/${name}`));
const load = name => ({ root: '/proj', files: read(join(work, name, 'proj'), join(work, name, 'proj')) });
const digest = files => createHash('sha256').update(JSON.stringify(Object.entries(files).sort())).digest('hex');
const pct = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))];
const memAvailableGiB = () => Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))[1]) / 1048576;
const reports = file => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const key = d => `${d.file.replace(/^\/proj\//, '')}:${d.line}:${d.column}:${d.code}`;
const firstLine = text => text.split('\n')[0];
function oracle(name) {
  const r = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { cwd: join(work, name, 'proj'), encoding: 'utf8', timeout: JOB_MS, maxBuffer: 1 << 28 });
  const rows = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^(.+?)\((\d+),(\d+)\): (?:error|warning) TS(\d+): (.*)$/.exec(line);
    if (m) rows.push({ file: m[1], line: +m[2], column: +m[3], code: +m[4], text: m[5] });
  }
  return { exitCode: r.status, rows };
}
const { job } = await fixture(t, { invariants: ['identity', TS_INVARIANT] });
const result = { node: process.version, cpu: execFileSync('sh', ['-c', "grep -m1 'model name' /proc/cpuinfo | cut -d: -f2"], { encoding: 'utf8' }).trim(), load: [], parity: {}, warm: null, width: {}, breach: null };
const options = (name, project, reportFile, extra) => ({ basePort, projects: { pass: project }, reportFile, ...extra });

const arm = process.env.P43_ARM;
if (arm !== 'breach') {
const parityPool = new IsolatePool({ hostPort, size: 1, jobTimeoutMs: JOB_MS, prewarm: true, ...WORKCELL });
await parityPool.ready();
for (const name of projects) {
  const project = load(name);
  const file = join(scratch, `${name.replace('/', '-')}.jsonl`);
  const expected = oracle(name);
  const r = await parityPool.run(job(['pass'], options(name, project, file)));
  const row = reports(file)[0];
  const got = row?.diagnostics ?? [];
  const a = new Set(expected.rows.map(key)), b = new Set(got.map(key));
  const texts = new Set(expected.rows.map(d => `${key(d)} ${d.text}`));
  result.parity[name] = { inputSha256: digest(project.files), files: Object.keys(project.files).length, status: r.status, reason: r.reason ?? null,
    oracleDiagnostics: expected.rows.length, tsrsDiagnostics: got.length, oracleExit: expected.exitCode, tsrsExit: row?.exitCode ?? null,
    locationParity: !!row && a.size === b.size && [...a].every(k => b.has(k)),
    textParity: !!row && got.every(d => texts.has(`${key(d)} ${firstLine(d.text)}`)),
    wallMs: row?.wallMs ?? null, linearMiB: row ? Math.round(row.memoryBytes / 1048576) : null };
  console.log(name, JSON.stringify(result.parity[name]));
}
await parityPool.close();

const medium = load('medium/ill');
const warmFile = join(scratch, 'warm.jsonl');
const warmPool = new IsolatePool({ hostPort, size: 1, jobTimeoutMs: JOB_MS, ...WORKCELL });
for (let i = 0; i < 21; i++) await warmPool.run(job(['pass'], options('medium/ill', medium, warmFile)));
await warmPool.close();
const warmRows = reports(warmFile);
result.warm = { compileMs: warmRows[0].compileMs, coldCheckMs: warmRows[0].wallMs, warmP50Ms: pct(warmRows.slice(1).map(r => r.wallMs), .5), warmP95Ms: pct(warmRows.slice(1).map(r => r.wallMs), .95), linearMiB: Math.round(warmRows[0].memoryBytes / 1048576), rssMiB: Math.round(warmRows.at(-1).rssBytes / 1048576) };
console.log('warm', JSON.stringify(result.warm));

const expectedMedium = oracle('medium/ill').rows.length;
widen: for (const size of [1, 4, 8, 16, 28]) {
  result.width[size] = [];
  for (let rep = 0; rep < 3; rep++) {
    if (memAvailableGiB() < 30) { result.width[size].push({ stopped: 'MemAvailable below 30 GiB' }); break widen; }
    const file = join(scratch, `width-${size}-${rep}.jsonl`);
    const pool = new IsolatePool({ hostPort, size, jobTimeoutMs: JOB_MS, prewarm: true, ...WORKCELL });
    await pool.ready();
    let minAvail = memAvailableGiB();
    const sampler = setInterval(() => { minAvail = Math.min(minAvail, memAvailableGiB()); }, 200);
    const seed = Array.from({ length: size }, () => pool.run(job(['pass'], options('medium/ill', medium, file))));
    await Promise.all(seed);
    const started = performance.now();
    const jobs = Array.from({ length: 8 * size }, () => pool.run(job(['pass'], options('medium/ill', medium, file))));
    const settled = await Promise.all(jobs);
    const seconds = (performance.now() - started) / 1000;
    clearInterval(sampler);
    await pool.close();
    const rows = reports(file);
    const bad = settled.filter(r => r.status !== 'completed').length + rows.filter(r => r.diagnostics.length !== expectedMedium).length;
    const timed = rows.slice(size);
    result.width[size].push({ checksPerSecond: +(jobs.length / seconds).toFixed(1), checkP50Ms: pct(timed.map(r => r.wallMs), .5), checkP95Ms: pct(timed.map(r => r.wallMs), .95), minMemAvailableGiB: +minAvail.toFixed(1), cellRssMiB: Math.round(Math.max(...rows.map(r => r.rssBytes)) / 1048576), bad });
    console.log('width', size, rep, JSON.stringify(result.width[size].at(-1)));
    if (bad) break widen;
  }
}

}
const file = join(scratch, 'breach.jsonl');
const release = join(scratch, 'release');
const breachOptions = extra => ({ ...options('small/ill', load('small/ill'), file), checkPort: hostPort, ...extra });
const breachPool = new IsolatePool({ hostPort: breachPort, size: 8, jobTimeoutMs: JOB_MS, prewarm: true, ...WORKCELL });
await breachPool.ready();
const siblings = Array.from({ length: 7 }, () => breachPool.run(job(['pass'], breachOptions({ baseOptions: { release } }))));
const breached = await breachPool.run(job(['pass'], breachOptions({ breach: true })));
writeFileSync(release, 'go');
const healthy = await Promise.all(siblings);
const replacement = await breachPool.run(job(['pass'], breachOptions()));
await breachPool.close();
const reasons = healthy.map(r => r.reason ?? null);
result.breach = { status: breached.status, reason: breached.reason, error: breached.error ?? null, breachedWorkcell: breached.workcell, siblingWorkcells: healthy.map(r => r.workcell), siblingsLost: healthy.filter(r => r.status !== 'completed').length, siblingReasons: reasons, siblings: healthy.length, replacementStatus: replacement.status, replacementWorkcell: replacement.workcell };
console.log('breach', JSON.stringify(result.breach));

for (const fn of cleanup) await fn();
rmSync(scratch, { recursive: true, force: true });
result.freeMemGiBEnd = +(freemem() / 1073741824).toFixed(1);
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
