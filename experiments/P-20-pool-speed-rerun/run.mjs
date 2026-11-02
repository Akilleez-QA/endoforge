import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { threadId } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const old = path.resolve(here, '../P-15-workcell-concurrency');
const sha = data => createHash('sha256').update(data).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, data) => fs.writeFileSync(file, JSON.stringify(data) + '\n');
const signature = { version: 1, name: 'convertUnit', inputs: [{ path: 'value', type: 'number', unit: '1', domain: [0, 1000] }], output: { type: 'number', unit: '1' } };
const cases = [0, 1, 7.5, 250, 999].map((value, i) => ({ id: `c${i}`, inputs: { value } }));
const candidates = json(path.join(old, 'kernels/manifest.json')).map(k => ({ id: `${k.name}-na`, name: k.name,
  source: fs.readFileSync(path.join(old, `kernels/${k.name}.ts`), 'utf8'), expect: k.expectTypeError ? 'reject:compile' : 'accept' }));
for (const name of ['k00', 'k01']) {
  const c = candidates.find(c => c.name === name);
  candidates.push({ ...c, id: `${name}-effect`, source: c.source + '\n@external("env", "clock") declare function clock(): f64;\nexport function tick(): f64 { return clock(); }\n', expect: 'reject:forbidden_effects' });
}
let compiler, prepared, peakHeap = 0;
async function compile(c, ascPath) {
  compiler ||= await import(pathToFileURL(ascPath));
  const files = {}, overlay = { [`${c.name}.ts`]: c.source };
  const result = await compiler.main([`${c.name}.ts`, '-O3', '--runtime', 'stub', '--noColors', '--initialMemory', '1',
    '--maximumMemory', '16', '--noAssert', '--outFile', 'out.wasm'], {
    stdout: compiler.createMemoryStream(), stderr: compiler.createMemoryStream(),
    readFile: name => overlay[name] ?? null, writeFile: (name, data) => { files[name] = data; }, listFiles: () => [],
  });
  return result.error ? null : files['out.wasm'];
}
export async function createPort(options) {
  const { arm, ascPath, wasm, ready, telemetry, release } = options;
  if (arm !== 'precompiled') compiler ||= await import(pathToFileURL(ascPath));
  else if (!prepared) {
    prepared = new Map();
    for (const c of candidates) prepared.set(c.id, c.expect === 'reject:compile' ? null : await WebAssembly.compile(fs.readFileSync(path.join(wasm, `${c.id}.wasm`))));
  }
  const cell = `${process.pid}-${threadId}`;
  const sample = () => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); save(path.join(telemetry, `${cell}.json`), { cell, heap: peakHeap, rss: process.memoryUsage().rss }); };
  const readyFile = path.join(ready, `${cell}.json`);
  if (!fs.existsSync(readyFile)) save(readyFile, { cell, at: Date.now(), heap: process.memoryUsage().heapUsed });
  const deadline = Date.now() + 300000;
  while (!fs.existsSync(release)) { if (Date.now() > deadline) throw new Error('readiness timeout'); await delay(10); }
  let module;
  return {
    async describe(id) {
      const c = candidates.find(c => c.id === id);
      const bytes = arm === 'precompiled' ? null : await compile(c, ascPath);
      module = arm === 'precompiled' ? prepared.get(id) : bytes ? await WebAssembly.compile(bytes) : null;
      sample();
      return module ? signature : { ...signature, name: 'compile_failed' };
    },
    run(id, probes) {
      const start = performance.now(), effects = [];
      const e = new WebAssembly.Instance(module, { env: { abort() { effects.push('env.abort'); }, clock() { return 0; } } }).exports;
      const sp = 0, ep = e.stateSize();
      e.initState(sp);
      const view = new DataView(e.memory.buffer);
      let fuel = 0;
      const outputs = probes.map(c => {
        for (let i = 0; i < 20; i++) {
          view.setUint32(ep, i % 4, true); view.setUint32(ep + 4, 0, true);
          view.setUint32(ep + 8, 1, true); view.setUint32(ep + 12, 0, true);
          view.setFloat64(ep + 16, c.inputs.value + i, true); view.setFloat64(ep + 24, 1, true);
          e.step(sp, ep); fuel++;
        }
        const value = e.convertUnit(c.inputs.value, 0, 1) + e.readChecksum(sp);
        return { caseId: c.id, value: Number.isFinite(value) && !Object.is(value, -0) ? value : 0 };
      });
      sample();
      return { status: 'completed', outputs, usage: { wallMs: performance.now() - start, memoryBytes: e.memory.buffer.byteLength, fuel }, effects };
    },
    scanEffects: () => WebAssembly.Module.imports(module).map(i => `${i.module}.${i.name}`),
    residual: () => ({ passed: true, reason: 'fixed synthetic P-15 workload executed' }),
    measure: () => ({ cost: 1 }),
  };
}
const python = (code, input) => new Promise((resolve, reject) => {
  const child = execFile('python3', ['-B', '-c', code], { cwd: root, maxBuffer: 16 * 1024 ** 2, timeout: 300000 }, (error, out, err) => {
    if (error) reject(new Error(err || error.message)); else { try { resolve(JSON.parse(out)); } catch (e) { reject(e); } }
  });
  child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(input));
});
const fixture = `
import json, sys
from pathlib import Path
from core.ledger.ledger import Ledger
from core.ledger.frozen import FrozenEvaluators
r = json.load(sys.stdin)
p = Path(r['directory'])
root = p / 'frozen'
root.mkdir()
(root / 'residual.txt').write_text('fixed synthetic P-15 workload executed')
ledger = Ledger(p / 'ledger.sqlite')
ledger.append(dict(version=0, kind='task', id='task', data=dict(intent='P-20', acceptance='fixed verdicts')))
ledger.append(dict(version=0, kind='admitted_input', id='input', data=dict(task='task', content='synthetic kernels', origin='synthetic')))
frozen = FrozenEvaluators(ledger).freeze(root, task='task', admitted_input='input', confirmed_by='P-20 precommit',
    qualification='17 positive, 5 negative controls', synthesis_context=dict(id='context', candidate_blind='confirmed', inputs=['input']),
    configuration=r['configuration'], residual='fixed synthetic P-15 workload executed', invariant_version='1')
for c in r['candidates']:
    ledger.append(dict(version=0, kind='candidate', id=c['id'], data=dict(task='task', admitted_input='input', content=c['source'], proposer='synthetic')))
print(json.dumps(dict(reference=dict(ledger=str(p / 'ledger.sqlite'), root=str(root), identity=frozen['id']), digest=frozen['data']['freeze']['digest'])))
`;
const mem = () => Object.fromEntries(['MemTotal', 'MemFree', 'MemAvailable'].map(k => [k, Number(new RegExp(`${k}:\\s+(\\d+)`).exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) * 1024]));
function processes() {
  const uptime = Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
  return fs.readdirSync('/proc').filter(p => /^\d+$/.test(p)).flatMap(pid => {
    try {
      const text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'), end = text.lastIndexOf(')');
      const values = text.slice(end + 2).split(' '), elapsed = uptime - Number(values[19]) / 100;
      return [{ pid: +pid, ppid: +values[1], cpu: elapsed > 0 ? (Number(values[11]) + Number(values[12])) / elapsed : 0, name: text.slice(text.indexOf('(') + 1, end) }];
    } catch { return []; }
  });
}
function descendants(rows, pid) {
  const ids = new Set([pid]);
  for (let n = -1; n !== ids.size;) { n = ids.size; for (const r of rows) if (ids.has(r.ppid)) ids.add(r.pid); }
  return ids;
}
function environment() {
  const rows = processes(), ours = descendants(rows, process.pid);
  return { at: new Date().toISOString(), loadavg: os.loadavg(), memory: mem(),
    otherHeavyProcesses: rows.filter(r => !ours.has(r.pid) && r.cpu >= 20).length,
    codexProcesses: rows.filter(r => !ours.has(r.pid) && /codex/.test(r.name)).length };
}
const rss = pid => { try { return Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) * 1024; } catch { return 0; } };
const stat = a => { const s = [...a].sort((a, b) => a - b); return { n: s.length, p50: s[Math.max(0, Math.ceil(s.length * .5) - 1)] ?? null, p95: s[Math.max(0, Math.ceil(s.length * .95) - 1)] ?? null, max: s.at(-1) ?? null }; };
async function repetition(config) {
  const { N, arm, mode, directory } = config;
  for (const part of ['ready', 'telemetry']) fs.mkdirSync(path.join(directory, part));
  const options = { ...config, ready: path.join(directory, 'ready'), telemetry: path.join(directory, 'telemetry'), release: path.join(directory, 'release') };
  const configuration = { gateInput: { version: 1, contract: { version: 1, signature, refusals: [], tolerance: 0, sources: ['P-15 synthetic contract'] }, cases,
    limits: { wallMs: 1000, memoryBytes: 1048576, fuel: 1000 }, allowedEffects: [] }, invariants: [], objectives: { cost: 'min' } };
  const { reference, digest } = await python(fixture, { directory, configuration, candidates });
  let seq = 0;
  const job = c => ({ reference, candidates: [c.id], portOptions: options, receipts: [{ version: 0, kind: 'receipt', id: `job-${++seq}`, data: {
    task: 'task', candidate: c.id, frozen_evaluator: reference.identity,
    precommit: { observable: 'P-20 candidate', acceptance_boundary: 'fixed expected verdict', oracle: reference.identity, oracle_version: digest,
      artifact_identity: c.id, environment: { runtime: mode }, failure_meaning: 'candidate rejected', stop_condition: 'batch report' },
    delivery_state: 'running', outcome_state: 'unobserved', observations: [],
  } }] });
  const baselineRss = rss(process.pid), samples = [], jobs = [], before = environment();
  const pool = new IsolatePool({ hostPort: fileURLToPath(import.meta.url), size: N, isolation: mode,
    resourceLimits: { maxOldGenerationSizeMb: arm === 'precompiled' ? 128 : 1024, maxYoungGenerationSizeMb: 16 }, wasmMemoryMaxMb: arm === 'precompiled' ? 64 : 4096 });
  let abort, warmError, peakRss = baselineRss;
  const failures = [];
  const timer = setInterval(() => {
    const children = fs.readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean);
    const sample = { at: Date.now(), rss: rss(process.pid) + children.reduce((sum, pid) => sum + rss(pid), 0), memory: mem() };
    peakRss = Math.max(peakRss, sample.rss); samples.push(sample);
    if (sample.memory.MemAvailable < .2 * sample.memory.MemTotal) { abort = 'MemAvailable<20%'; save(path.join(directory, 'abort.json'), { abort }); process.kill(-process.pid, 'SIGKILL'); }
  }, 200);
  const inspect = (result, c, ms, warmup = false) => {
    try {
    const attempts = result.report?.attempts ?? [], accepted = c.expect === 'accept';
    const expectedFailure = c.expect === 'reject:compile' ? 'interface' : 'forbidden_effects';
    const expectedCount = accepted ? 2 : 1;
    assert.equal(result.status, 'completed', JSON.stringify({ status: result.status, reason: result.reason, error: result.error }));
    assert.equal(attempts.length, expectedCount);
    assert(attempts.every(a => a.candidate === c.id && a.stage === (accepted ? 'passed' : 'rejected') && a.firstFailure === (accepted ? null : expectedFailure)));
    const receipt = result.receipts[0];
    assert.equal(result.receipts.length, 1); assert.equal(receipt.record.data.candidate, c.id);
    assert.equal(receipt.record.data.outcome_state, accepted ? 'passed' : 'failed');
    assert.equal(receipt.record.data.frozen_evaluator, reference.identity);
    jobs.push({ id: receipt.record.id, candidate: c.id, warmup, accepted, ms, hash: receipt.hash, workcell: result.workcell, cgroup: result.cgroup });
    } catch (e) { failures.push({ candidate: c.id, status: result.status, reason: result.reason, error: result.error, report: result.report }); throw e; }
  };
  let runMs, readiness, allReadyMs, error = null;
  try {
    const started = Date.now();
    const warm = Array.from({ length: N }, (_, i) => pool.run(job(candidates[i % 22])).then(r => inspect(r, candidates[i % 22], 0, true)).catch(e => { warmError ||= e; }));
    while (fs.readdirSync(options.ready).length < N && !warmError) {
      if (Date.now() - started > 300000) throw new Error('readiness timeout'); await delay(10);
    }
    readiness = fs.readdirSync(options.ready).map(f => json(path.join(options.ready, f)).at - started);
    allReadyMs = Date.now() - started; fs.writeFileSync(options.release, 'ready');
    await Promise.all(warm); if (warmError) throw warmError;
    const start = performance.now(), deadline = Date.now() + config.windowMs;
    await Promise.all(Array.from({ length: N }, async (_, lane) => {
      let i = lane;
      while (Date.now() < deadline && !abort) {
        const c = candidates[i++ % 22], t = performance.now();
        inspect(await pool.run(job(c)), c, performance.now() - t);
      }
    }));
    runMs = performance.now() - start;
  } catch (e) { abort = true; error = e.message; fs.writeFileSync(options.release, 'stop'); }
  finally { await pool.close(); clearInterval(timer); }
  const chain = await python(`
import json, sys
from core.ledger.ledger import Ledger
records = Ledger(json.load(sys.stdin)['ledger']).records()
print(json.dumps(dict(verified=True, receipts=sum(r['kind']=='receipt' for r in records))))
`, reference);
  if (chain.receipts !== jobs.length) error ||= 'receipt count mismatch';
  const timed = jobs.filter(j => !j.warmup), heaps = fs.readdirSync(options.telemetry).map(f => json(path.join(options.telemetry, f)));
  return { N, arm, mode, windowMs: config.windowMs, before, after: environment(), error, chain, baselineRss, peakRss,
    rssPerCell: (peakRss - baselineRss) / N, heapPerCell: stat(heaps.map(h => h.heap)), readyUpperBoundMs: stat(readiness ?? []), allReadyMs,
    runMs, accepted: timed.filter(j => j.accepted).length, correct: timed.length, acceptedPerS: runMs ? timed.filter(j => j.accepted).length / (runMs / 1000) : null,
    latencyMs: stat(timed.map(j => j.ms)), failures, jobs, samples };
}
async function main() {
  const script = fileURLToPath(import.meta.url), receipt = process.env.P20_RECEIPT ?? path.join(here, 'receipt');
  fs.mkdirSync(receipt, { recursive: true });
  const digest = sha(fs.readFileSync(path.join(here, 'PRECOMMIT.md')));
  assert.equal(fs.readFileSync(path.join(here, 'receipt/precommit.sha256'), 'utf8').split(/\s/)[0], digest);
  if (!['locked', 'rep'].includes(process.argv[2])) {
    const child = spawn('flock', ['-x', '/tmp/ef-bench.lock', process.execPath, script, 'locked'], { stdio: 'inherit' });
    child.on('exit', code => process.exit(code ?? 1)); return;
  }
  await new Promise((resolve, reject) => execFile('flock', ['-n', '/tmp/ef-bench.lock', 'true'], error => error?.code === 1 ? resolve() : reject(new Error('exclusive benchmark lock not held'))));
  if (process.argv[2] === 'rep') { const config = json(process.argv[3]); save(path.join(config.directory, 'result.json'), await repetition(config)); return; }
  assert(!fs.existsSync(path.join(receipt, 'summary.json')) || !json(path.join(receipt, 'summary.json')).sweeps.length, 'use a fresh P20_RECEIPT directory');
  const scratch = fs.mkdtempSync('/tmp/ef-p20-run-'), ascPath = process.env.P20_ASC ?? '/tmp/ef-p20-setup/p15/node_modules/assemblyscript/dist/asc.js';
  const wasm = path.join(scratch, 'wasm'); fs.mkdirSync(wasm);
  const build = [];
  for (const c of candidates) {
    const bytes = await compile(c, ascPath); assert.equal(Boolean(bytes), c.expect !== 'reject:compile');
    if (bytes) fs.writeFileSync(path.join(wasm, `${c.id}.wasm`), bytes);
    build.push({ id: c.id, expected: c.expect, sourceSha256: sha(c.source), wasmSha256: bytes ? sha(bytes) : null });
  }
  fs.mkdirSync(path.join(receipt, 'raw'), { recursive: true });
  const summary = { precommit: digest, started: new Date().toISOString(), node: process.version, kernel: os.release(), cpu: os.cpus()[0].model,
    affinity: '0-27', assemblyscript: '0.28.20', binaryen: '131.0.0-nightly.20260721', build, sweeps: [] };
  save(path.join(receipt, 'summary.json'), summary);
  for (const arm of ['compile', 'residency', 'precompiled']) for (const mode of ['thread', 'process']) {
    const sweep = { arm, mode, before: environment(), reps: [], stop: null }; summary.sweeps.push(sweep);
    const widths = arm === 'residency' ? [100, 150, 200] : arm === 'precompiled' ? [1, 10, 20, 50] : [1, 10, 12, 16, 20, 24, 28, 32, 40, 50];
    let perCell = 0;
    for (const N of widths) {
      const memory = mem();
      if (memory.MemAvailable - perCell * N * 1.15 < .2 * memory.MemTotal) { sweep.stop = { N, reason: 'projected memory floor' }; break; }
      for (let rep = 1; rep <= 3; rep++) {
        const name = `${arm}-${mode}-N${N}-r${rep}`, directory = path.join(scratch, name); fs.mkdirSync(directory);
        const config = { N, arm, mode, directory, ascPath, wasm, windowMs: arm === 'residency' ? 5000 : 15000 };
        save(path.join(directory, 'config.json'), config);
        const before = environment();
        const child = spawn('taskset', ['-c', '0-27', process.execPath, script, 'rep', path.join(directory, 'config.json')], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
        let stderr = ''; child.stderr.on('data', data => { stderr += data; });
        const timeout = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 600000);
        const code = await new Promise(resolve => child.on('exit', resolve)); clearTimeout(timeout);
        let result = fs.existsSync(path.join(directory, 'result.json')) ? json(path.join(directory, 'result.json')) : { N, arm, mode, error: 'rep exited without result' };
        result = { ...result, rep, code, supervisorBefore: before, supervisorAfter: environment(), stderr: stderr.replaceAll(root, '$REPO').replaceAll(scratch, '$SCRATCH').slice(-2000) };
        save(path.join(receipt, `raw/${name}.json`), result);
        const { jobs, samples, ...compact } = result; sweep.reps.push(compact);
        perCell = Math.max(perCell, result.rssPerCell || 0);
        console.log(JSON.stringify({ arm, mode, N, rep, acceptedPerS: result.acceptedPerS, error: result.error }));
        save(path.join(receipt, 'summary.json'), summary);
        if (code !== 0 || result.error) { sweep.stop = { N, reason: result.error ?? `exit ${code}` }; break; }
      }
      if (sweep.stop) break;
    }
    sweep.after = environment(); save(path.join(receipt, 'summary.json'), summary);
  }
  summary.finished = new Date().toISOString(); save(path.join(receipt, 'summary.json'), summary);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
