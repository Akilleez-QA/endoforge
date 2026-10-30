#!/usr/bin/env node
// Repeated real or credential-free replay runs, with process-side and trace-side timing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { nowEpoch, readTrace, analyzeTrace, p } from '../lib/trace.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../../..');
const A = {}; for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i].replace(/^--/, ''); A[k] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const atoms = path.resolve(A.atoms ?? path.join(REPO, 'tools/atomizer/examples/C-005/atoms.json')), n = Number(A.n ?? 3), concurrency = A.concurrency == null ? undefined : Number(A.concurrency), mode = A.stub ? 'stub' : 'real', replay = A.replay ? path.resolve(A.replay) : null, stubLatency = String(A['stub-latency'] ?? '0'), scale = Number(A['stub-scale'] ?? 1);
if (!Number.isInteger(n) || n < 1 || (concurrency != null && (!Number.isInteger(concurrency) || concurrency < 1)) || !Number.isFinite(scale) || scale < 0 || (stubLatency !== 'recorded' && (!Number.isFinite(Number(stubLatency)) || Number(stubLatency) < 0)) || (A.stub && !replay)) { console.error('bench: use --n N [--concurrency N]; --stub requires --replay; latency and scale must be nonnegative'); process.exit(2); }
const out = path.resolve(A['out-dir'] ?? path.join(os.homedir(), '.cache/endoforge-bench', A.label ?? 'bench'));
fs.mkdirSync(out, { recursive: true });
const root = fs.mkdtempSync(path.join(out, new Date().toISOString().replace(/[:.]/g, '-') + '-')), stub = path.join(root, 'stub'), env = { ...process.env };
if (A.stub) {
  for (const d of ['prefix/bin', 'home', 'state']) fs.mkdirSync(path.join(stub, d), { recursive: true });
  fs.writeFileSync(path.join(stub, 'prefix/bin/codex'), `#!/bin/sh\necho '{"type":"thread.started"}'\necho '{"type":"turn.completed","usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0}}'\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(stub, 'codex-pool'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const spec = JSON.parse(fs.readFileSync(process.env.ENDOFORGE_ISOLATE_SPEC, 'utf8')), args = spec.bwrapArgs;
const i = args.findIndex((x, i) => x === '--bind' && args[i + 2] === '/out'), host = args[i + 1], id = path.basename(path.dirname(host));
fs.cpSync(path.join(${JSON.stringify(replay)}, 'atoms', id, 'out'), host, { recursive: true, filter: (src) => path.basename(src) !== 'auth.json' });
let ms = ${JSON.stringify(stubLatency)} === 'recorded' ? JSON.parse(fs.readFileSync(path.join(${JSON.stringify(replay)}, 'receipt/atoms', id + '.json'), 'utf8')).attempts.at(-1).wallMs * ${scale} : Number(${JSON.stringify(stubLatency)});
setTimeout(() => {
  fs.appendFileSync(path.join(process.env.CODEX_POOL_STATE_DIR, 'log'), 'ts=' + new Date().toISOString() + ' account=stub pid=' + process.pid + ' child=0 exit=0 class=ok failover=no attempt=1 model=stub guard=no\\n');
  const child = spawn(process.env.CODEX_POOL_BIN, process.argv.slice(2), { env: { ...process.env, CODEX_HOME: ${JSON.stringify(path.join(stub, 'home'))} }, stdio: 'inherit' });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
  child.on('error', () => process.exit(127)); child.on('exit', (code) => process.exit(code ?? 1));
}, ms);
`, { mode: 0o755 });
  Object.assign(env, { ENDOFORGE_WORKER: 'codex', ENDOFORGE_CODEX_POOL: path.join(stub, 'codex-pool'), ENDOFORGE_TOOLCHAIN_CODEX: path.join(stub, 'prefix'), CODEX_POOL_STATE_DIR: path.join(stub, 'state'), ATOMIZER_LEDGER_DIR: path.join(root, 'ledger') });
} else env.ENDOFORGE_WORKER ??= 'codex';
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const command = (bin, args) => spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], cwd: REPO });
const config = { atoms, n, concurrency: concurrency ?? null, mode, stubLatency, stubScale: scale, replay, label: A.label ?? null, traceAB: !!A['trace-ab'], noAugment: !!A['no-augment'], git: command('git', ['rev-parse', 'HEAD']).stdout?.trim() ?? null, node: process.version, host: { cpus: os.cpus().length }, load: os.loadavg() }, reps = [];
for (let i = 1; i <= n; i++) {
  const dir = path.join(root, `rep-${i}`); fs.mkdirSync(dir);
  const repEnv = { ...env, ...(A['trace-ab'] ? { ENDOFORGE_TRACE: i % 2 ? '1' : '0' } : {}) };
  const r = { dir, trace: repEnv.ENDOFORGE_TRACE !== '0', load: os.loadavg(), poolStatus: A.stub ? null : command(env.ENDOFORGE_CODEX_POOL || fileURLToPath(new URL('../../runtime/agent-pool.mjs', import.meta.url)), ['status']).stdout ?? null };
  const launch = (name, args) => {
    const fd = fs.openSync(path.join(dir, `${name}.log`), 'a'), t = nowEpoch();
    try { const child = spawnSync(process.execPath, [path.join(HERE, `${name}.mjs`), ...args], { cwd: REPO, env: repEnv, stdio: ['ignore', fd, fd] }); return { wallMs: nowEpoch() - t, exit: child.status, signal: child.signal, error: child.error?.message ?? null }; } finally { fs.closeSync(fd); }
  };
  r.schedule = launch('schedule', ['run', atoms, '--run-dir', dir, ...(concurrency == null ? [] : ['--concurrency', String(concurrency)]), ...(A['no-augment'] ? ['--no-augment'] : [])]);
  if (!A['no-verify']) r.verify = launch('verify', [dir]);
  const doc = read(path.join(dir, 'atoms.json')), run = read(path.join(dir, 'receipt/run.json')), verify = read(path.join(dir, 'receipt/verify.json')), compose = doc?.atoms.find((a) => ['compose', 'direct'].includes(a.kind));
  r.metrics = analyzeTrace(readTrace(path.join(dir, 'trace.jsonl')), doc?.atoms ?? [], { concurrency });
  r.wallMs = run?.wallMs ?? null; r.verifyOk = verify?.ok ?? null; r.promotable = compose ? read(path.join(dir, 'atoms', compose.id, 'out/gates.json'))?.promotable ?? null : null;
  r.accounts = Object.fromEntries((doc?.atoms ?? []).map((a) => [a.id, read(path.join(dir, 'receipt/atoms', `${a.id}.json`))?.attempts.flatMap((x) => x.accounts ?? []) ?? []]));
  r.ok = !r.schedule.error && r.schedule.exit === 0 && run?.allDone === true && (!r.verify || (!r.verify.error && r.verify.exit === 0 && r.verifyOk === true)); reps.push(r);
}
const stats = (xs) => { xs = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)); return { median: p(xs, 0.5), p90: p(xs, 0.9), min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null }; };
const fields = 'wallMs criticalPathMs wallOverCritical chain.queueMs chain.codexMs chain.nonCodexMs codexMs poolAcquireMs nonCodexBusyMs busyMs concurrency.avg parallelEfficiency processStartMs'.split(' ');
const phaseKeys = [...new Set(reps.flatMap((r) => Object.keys(r.metrics.phases ?? {})))];
const summary = Object.fromEntries([...fields, ...phaseKeys.map((k) => `phases.${k}`)].map((key) => [key, stats(reps.map((r) => key.startsWith('phases.') ? r.metrics.phases?.[key.slice(7)] : key.split('.').reduce((x, k) => x?.[k], r.metrics)))]));
summary.errors = Object.fromEntries(['atomsFailed', 'retries', 'failovers', 'modelFallbacks'].map((k) => [k, reps.reduce((s, r) => s + (r.metrics.errors?.[k] ?? 0), 0)])); summary.okReps = reps.filter((r) => r.ok).length;
if (A['trace-ab']) summary.traceAB = Object.fromEntries([true, false].map((on) => { const xs = reps.filter((r) => r.trace === on); return [on ? 'on' : 'off', { wallMs: stats(xs.map((r) => r.wallMs)), scheduleMs: stats(xs.map((r) => r.schedule.wallMs)) }]; }));
const date = new Date(), localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const file = path.join(root, `bench-${localDate}.json`); fs.writeFileSync(file, JSON.stringify({ config, reps, summary }, null, 1));
console.log([file, `mode=${mode} reps=${n} ok=${summary.okReps}`, ...['wallMs', 'criticalPathMs', 'chain.queueMs', 'chain.codexMs', 'chain.nonCodexMs', 'poolAcquireMs', 'concurrency.avg'].map((k) => `${k}: median=${summary[k].median} p90=${summary[k].p90}`), `errors=${JSON.stringify(summary.errors)}`].join('\n'));
process.exitCode = summary.okReps === n ? 0 : 1;
