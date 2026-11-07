import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { installWasmLimit } from '../../core/runtime/isolate-wasm.mjs';
import { fixture, hostPort as basePort } from '../../core/runtime/test/fixtures/ledger-fixture.mjs';
import { TSRS_MODULE, WORKCELL } from '../../tools/tscheck/pin.mjs';
import { TS_INVARIANT } from '../../tools/tscheck/port.mjs';

const wasmPath = fileURLToPath(new URL('../../tools/tscheck/node_modules/@tsrs/wasm/tsrs.wasm', import.meta.url));
if (!isMainThread) {
  const bytes = readFileSync(wasmPath);
  const timed = fn => { const t = performance.now(); fn(); return Math.round(performance.now() - t); };
  const rows = { hashMs: timed(() => createHash('sha256').update(bytes).digest('hex')), validateMs: timed(() => WebAssembly.validate(bytes)),
    nativeCompileMs: timed(() => new WebAssembly.Module(bytes)) };
  installWasmLimit(WORKCELL.wasmMemoryMaxMb, () => process.exit(18), WORKCELL.trustedWasmModules);
  rows.guardedModuleMs = timed(() => new WebAssembly.Module(bytes));
  parentPort.postMessage(rows);
} else {
  const [work, out, arm, sizeText] = process.argv.slice(2);
  if (arm === 'split') {
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push(await new Promise((resolve, reject) => {
      const worker = new Worker(fileURLToPath(import.meta.url), { resourceLimits: WORKCELL.resourceLimits });
      worker.once('message', resolve); worker.once('error', reject);
    }));
    writeFileSync(out, `${JSON.stringify({ node: process.version, moduleBytes: statSync(wasmPath).size, rows }, null, 2)}\n`);
    process.exit(0);
  }
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
  const scratch = mkdtempSync(join(tmpdir(), 'p45-'));
  const file = join(scratch, 'reports.jsonl');
  const options = { basePort, projects: { pass: project }, reportFile: file };
  const shared = arm === 'shared' ? { sharedWasmModules: [{ sha256: TSRS_MODULE.sha256, path: wasmPath }] } : {};
  const begun = performance.now();
  const pool = new IsolatePool({ hostPort, size, jobTimeoutMs: 120000, ...WORKCELL, ...shared });
  await pool.ready();
  const readyMs = Math.round(performance.now() - begun);
  const firstStarted = performance.now();
  const first = await Promise.all(Array.from({ length: size }, () => pool.run(job(['pass'], options))));
  const firstBatchMs = Math.round(performance.now() - firstStarted);
  const started = performance.now();
  const rest = await Promise.all(Array.from({ length: 8 * size }, () => pool.run(job(['pass'], options))));
  const seconds = (performance.now() - started) / 1000;
  await pool.close();
  const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const pct = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))];
  const compile = rows.filter(row => !row.warm).map(row => row.compileMs);
  const summary = { node: process.version, arm, size, readyMs, firstBatchMs, totalToFirstBatchMs: readyMs + firstBatchMs, compiled: compile.length, compileP50Ms: pct(compile, .5), compileMaxMs: Math.max(...compile),
    checksPerSecond: +(rest.length / seconds).toFixed(1), checkP50Ms: pct(rows.filter(row => row.warm).map(row => row.wallMs), .5),
    peakRssMiB: Math.round(Number(/VmHWM:\s+(\d+)/.exec(readFileSync('/proc/self/status', 'utf8'))[1]) / 1024),
    diagnostics: [...new Set(rows.map(row => row.diagnostics.length))], completed: [...first, ...rest].filter(r => r.status === 'completed').length, jobs: first.length + rest.length,
    sharedWasmModules: first[0].sharedWasmModules ?? null };
  for (const fn of cleanup) await fn();
  rmSync(scratch, { recursive: true, force: true });
  writeFileSync(out, `${JSON.stringify(summary)}\n`, { flag: 'a' });
  console.log(JSON.stringify(summary));
}
