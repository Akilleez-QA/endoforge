#!/usr/bin/env node
// Fan out: run several atoms.json DAGs as one pool (N schedulers in parallel, each with its own concurrency), verify each, summarize.
// usage: node fanout.mjs <atoms.json...> --out-dir <dir> [--parallel-runs 4] [--per-run-concurrency 4]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emit, context, load, newId } from '../lib/ledger.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
function args(argv) { const o = { _: [] }; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) o[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else o._.push(a); } return o; }
const A = args(process.argv.slice(2));
if (!A._.length || !A['out-dir']) { console.error('usage: fanout.mjs <atoms.json...> --out-dir <dir> [--parallel-runs N] [--per-run-concurrency N]'); process.exit(2); }
const OUT = path.resolve(A['out-dir']); fs.mkdirSync(OUT, { recursive: true });
const PAR = Number(A['parallel-runs'] ?? 4), CONC = Number(A['per-run-concurrency'] ?? 4);
const runOne = (file) => new Promise((resolve) => {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')); const id = doc.need.id; const runDir = path.join(OUT, id);
  const t0 = Date.now();
  const sched = spawn(process.execPath, [path.join(HERE, 'schedule.mjs'), 'run', file, '--run-dir', runDir, '--concurrency', String(CONC), '--pool-id', POOL_ID], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; sched.stdout.on('data', (d) => { out += d; }); sched.stderr.on('data', (d) => { err += d; });
  sched.on('close', (code) => {
    fs.writeFileSync(path.join(runDir, 'schedule.log'), out + '\n' + err);
    const ver = spawn(process.execPath, [path.join(HERE, 'verify.mjs'), runDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let vout = ''; ver.stdout.on('data', (d) => { vout += d; }); ver.stderr.on('data', (d) => { vout += d; });
    ver.on('close', (vcode) => {
      spawn(process.execPath, [path.join(HERE, 'report.mjs'), runDir], { stdio: 'ignore' }).on('close', () => {
        let run = null, gates = null;
        try { run = JSON.parse(fs.readFileSync(path.join(runDir, 'receipt', 'run.json'), 'utf8')); } catch {}
        try { const c = doc.atoms.find((x) => x.kind === 'compose'); gates = JSON.parse(fs.readFileSync(path.join(runDir, 'atoms', c.id, 'out', 'gates.json'), 'utf8')); } catch {}
        resolve({ id, file, scheduleExit: code, verifyExit: vcode, wallMs: Date.now() - t0, allDone: run?.allDone ?? false, atoms: run?.atoms, sumAtomWallMs: run?.sumAtomWallMs, realizedSpeedup: run?.realizedSpeedup, tokens: run?.tokens, statuses: run?.statuses, promotable: gates?.promotable ?? null, gates: gates?.gates ? Object.fromEntries(Object.entries(gates.gates).map(([k, v]) => [k, v.ok])) : null });
      });
    });
  });
});
const POOL_ID = A['pool-id'] ?? newId('pool');
const files = A._.map((f) => path.resolve(f));
emit('pool.start', { poolId: POOL_ID, outDir: OUT, requests: files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')).need.id), parallelRuns: PAR, perRunConcurrency: CONC, context: context(), load: load() }); const results = []; const t0 = Date.now(); const queue = [...files]; const active = new Set();
await new Promise((done) => { const pump = () => { while (active.size < PAR && queue.length) { const f = queue.shift(); const p = runOne(f).then((r) => { active.delete(p); results.push(r); console.error(`${r.allDone ? 'done  ' : 'FAILED'} ${r.id}: wall ${(r.wallMs / 1000).toFixed(0)} s, speedup ${r.realizedSpeedup}x, promotable ${r.promotable}, verify exit ${r.verifyExit}`); if (!queue.length && !active.size) done(); else pump(); }); active.add(p); } }; pump(); });
const wallMs = Date.now() - t0; const sumAtom = results.reduce((s, r) => s + (r.sumAtomWallMs ?? 0), 0);
const tokens = results.reduce((s, r) => { for (const k of ['input', 'output', 'cacheRead', 'cacheCreate', 'calls']) s[k] += r.tokens?.[k] ?? 0; return s; }, { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, calls: 0 });
const summary = { at: new Date().toISOString(), requests: results.length, parallelRuns: PAR, perRunConcurrency: CONC, wallMs, sumAtomWallMs: sumAtom, pooledSpeedup: sumAtom ? +(sumAtom / wallMs).toFixed(2) : null, allDone: results.every((r) => r.allDone), promotable: results.filter((r) => r.promotable).length, verified: results.filter((r) => r.verifyExit === 0).length, tokens, results };
summary.poolId = POOL_ID;
fs.writeFileSync(path.join(OUT, 'fanout.json'), JSON.stringify(summary, null, 1));
emit('pool.end', { poolId: POOL_ID, wallMs, sumAtomWallMs: sumAtom, pooledSpeedup: summary.pooledSpeedup, promotable: summary.promotable, verified: summary.verified, tokens, perRequest: results.map((r) => ({ need: r.id, wallMs: r.wallMs, allDone: r.allDone, promotable: r.promotable, verifyExit: r.verifyExit, realizedSpeedup: r.realizedSpeedup })), load: load() });
console.log(JSON.stringify({ requests: summary.requests, wallMs, sumAtomWallMs: sumAtom, pooledSpeedup: summary.pooledSpeedup, promotable: summary.promotable, verified: summary.verified, tokens }));
