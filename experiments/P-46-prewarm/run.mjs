import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { fixture, hostPort as basePort } from '../../core/runtime/test/fixtures/ledger-fixture.mjs';
import { WORKCELL } from '../../tools/tscheck/pin.mjs';
import { TS_INVARIANT } from '../../tools/tscheck/port.mjs';

const [work, out, arm, sizeText] = process.argv.slice(2);
const size = Number(sizeText);
const hostPort = fileURLToPath(new URL('../../tools/tscheck/port.mjs', import.meta.url));
const cleanup = [];
const t = { after: fn => cleanup.push(fn) };
const read = (dir, root, files = {}) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) read(path, root, files);
    else files[`/proj/${relative(root, path)}`] = readFileSync(path, 'utf8');
  }
  return files;
};
const project = { root: '/proj', files: read(join(work, 'medium/ill/proj'), join(work, 'medium/ill/proj')) };
const { job } = await fixture(t, { invariants: ['identity', TS_INVARIANT] });
const scratch = mkdtempSync(join(tmpdir(), 'p46-'));
const file = join(scratch, 'reports.jsonl');
const options = { basePort, projects: { pass: project }, reportFile: file };
const warm = { prewarm: {}, warm: { warm: {} }, 'warm-probe': { warm: { probe: true } } }[arm];
const begun = performance.now();
const pool = new IsolatePool({ hostPort, size, prewarm: true, jobTimeoutMs: 120000, ...WORKCELL, ...warm });
await pool.ready();
const readyMs = Math.round(performance.now() - begun);
const timed = async count => {
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: count }, () => pool.run(job(['pass'], options))));
  return { ms: performance.now() - started, results };
};
const first = await timed(size);
const later = [];
for (let i = 0; i < 8; i++) later.push((await timed(size)).ms);
await pool.close();
const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const firstRows = rows.slice(0, size);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = { node: process.version, arm, size, readyMs, firstJobMs: Math.round(first.ms), laterMedianMs: Math.round(median(later)), readyPlusFirstMs: readyMs + Math.round(first.ms),
  firstCompileMs: Math.max(...firstRows.map(row => row.compileMs)), firstCheckMs: Math.max(...firstRows.map(row => row.wallMs)),
  completed: first.results.filter(r => r.status === 'completed').length, diagnostics: [...new Set(rows.map(row => row.diagnostics.length))] };
for (const fn of cleanup) await fn();
rmSync(scratch, { recursive: true, force: true });
writeFileSync(out, `${JSON.stringify(summary)}\n`, { flag: 'a' });
console.log(JSON.stringify(summary));
