import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { trustedWasmModules } from '../assemblyscript-toolchain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const sha = data => createHash('sha256').update(data).digest('hex');
const need = name => { assert(process.env[name], `${name} required`); return process.env[name]; };
const oldRoot = need('P20B_OLD_EXPERIMENTS'), loadtest = need('P20B_LOADTEST'), ascPath = need('P20_ASC'), cache = need('P20B_TSCRS_CACHE'), lab = need('P20B_LAB');
const stat = values => { const s = [...values].sort((a, b) => a - b), q = p => s[Math.max(0, Math.ceil(s.length * p) - 1)] ?? null;
  return { n: s.length, p50: q(.5), p95: q(.95), max: s.at(-1) ?? null }; };
const environment = () => ({ at: new Date().toISOString(), loadavg: os.loadavg(), memAvailable: Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) * 1024 });

const digest = sha(fs.readFileSync(path.join(here, 'PRECOMMIT.md')));
assert.equal(fs.readFileSync(path.join(here, 'receipt/precommit.sha256'), 'utf8').split(/\s/)[0], digest);
await new Promise((resolve, reject) => execFile('flock', ['-n', '/tmp/ef-bench.lock', 'true'], e => e?.code === 1 ? resolve() : reject(Error('exclusive benchmark lock not held'))));
const output = path.join(here, 'receipt', process.env.P20B_RECEIPT || 'addendum');
assert(!fs.existsSync(output), 'use a fresh receipt directory');
const scratch = fs.mkdtempSync('/tmp/ef-p20b-');
fs.mkdirSync(output, { recursive: true });

const kernelWasm = path.join(scratch, 'kernel-stub-1p.wasm');
execFileSync(process.execPath, [path.join(path.dirname(ascPath), "../bin/asc.js"), path.join(oldRoot, 'P-01-kernel-instantiate/kernel/kernel.ts'), '-O3', '--runtime', 'stub', '--noAssert', '--initialMemory', '1', '--maximumMemory', '16', '-o', kernelWasm]);
const p02 = path.join(oldRoot, 'P-02-compiler-in-isolate/kernels');
const kernels = fs.readdirSync(p02).filter(f => f.endsWith('.ts')).sort().map(f => [f.slice(0, -3), fs.readFileSync(path.join(p02, f), 'utf8')]);
const { PROJECTS } = await import(pathToFileURL(path.join(oldRoot, 'P-05-hosted-fit/gen-overlay.mjs')));
const projects = { five: PROJECTS.five(), fifty: PROJECTS.fifty() };
const p05 = { corePath: path.join(cache, 'core.js'), wasmPath: path.join(cache, 'ts_rust.size.wasm'), hostPath: path.join(lab, 'adapters/checkers/tscrs-wasm/host.mjs'), projects };
const fix = path.join(loadtest, 'isofix');
const command = ['bwrap', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--symlink', 'usr/bin', '/bin', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
  '--ro-bind', fix, '/src', '--chdir', '/src', '--unshare-all', '--die-with-parent', '--new-session', 'env', '-i', 'PYTHONDONTWRITEBYTECODE=1', '/usr/bin/python3', '-E', '-s', '-m', 'unittest', '-q', 'test_calc'];

const fixture = `
import json, sys
from pathlib import Path
from core.ledger.ledger import Ledger
from core.ledger.frozen import FrozenEvaluators
r = json.load(sys.stdin)
p = Path(r['directory'])
(p / 'frozen').mkdir()
(p / 'frozen' / 'residual.txt').write_text('timing only')
ledger = Ledger(p / 'ledger.sqlite')
ledger.append(dict(version=0, kind='task', id='task', data=dict(intent='P-20 addendum', acceptance='timing only')))
ledger.append(dict(version=0, kind='admitted_input', id='input', data=dict(task='task', content='timing probe', origin='synthetic')))
frozen = FrozenEvaluators(ledger).freeze(p / 'frozen', task='task', admitted_input='input', confirmed_by='P-20 addendum precommit',
    qualification='timing only', synthesis_context=dict(id='context', candidate_blind='confirmed', inputs=['input']),
    configuration=r['configuration'], residual='timing only', invariant_version='1')
ledger.append(dict(version=0, kind='candidate', id='probe', data=dict(task='task', admitted_input='input', content='timing probe', proposer='synthetic')))
print(json.dumps(dict(ledger=str(p / 'ledger.sqlite'), root=str(p / 'frozen'), identity=frozen['id'])))
`;
const configuration = { gateInput: { version: 1, contract: { version: 1, signature: { version: 1, name: 'probe', inputs: [], output: { type: 'number', unit: '1' } }, refusals: [], tolerance: 0, sources: ['timing'] },
  cases: [{ id: 'c0', inputs: {} }], limits: { wallMs: 1000, memoryBytes: 1048576, fuel: 1000 }, allowedEffects: [] }, invariants: [], objectives: { cost: 'min' } };
let jobs = 0;
const reference = () => { const directory = fs.mkdtempSync(path.join(scratch, 'ref-'));
  return JSON.parse(execFileSync('python3', ['-B', '-c', fixture], { cwd: root, input: JSON.stringify({ directory, configuration }) })); };
async function run(pool, ref, portOptions) {
  const out = path.join(scratch, `job-${++jobs}.json`), start = performance.now();
  const result = await pool.run({ reference: ref, candidates: ['probe'], portOptions: { ...portOptions, out } });
  const poolMs = performance.now() - start;
  if (!fs.existsSync(out)) return { poolMs, error: result.reason ?? result.status };
  return { poolMs, reason: result.reason, ...JSON.parse(fs.readFileSync(out, 'utf8')) };
}
const big = { resourceLimits: { maxOldGenerationSizeMb: 1024, maxYoungGenerationSizeMb: 16 }, wasmMemoryMaxMb: 4096, trustedWasmModules };
const hostPort = path.join(here, 'addendum-port.mjs');
const summary = { precommit: digest, node: process.version, kernel: os.release(), cpu: os.cpus()[0].model, cores: os.cpus().length,
  kernelWasmSha256: sha(fs.readFileSync(kernelWasm)), before: environment(), arms: [] };
const save = () => fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');

for (const mode of ['thread', 'process']) {
  for (const [arm, options, input] of [['p01', {}, { workload: 'p01', wasm: kernelWasm }], ['p02', big, { workload: 'p02', ascPath, kernels }], ['p05', big, { workload: 'p05', ...p05 }]]) {
    const reps = [];
    for (let rep = 1; rep <= 3; rep++) {
      const pool = new IsolatePool({ hostPort, size: 1, isolation: mode, ...options });
      try { const ref = reference(); reps.push({ rep, cold: await run(pool, ref, input), warm: arm === 'p01' ? null : await run(pool, ref, input) }); }
      catch (e) { reps.push({ rep, error: e.message }); }
      finally { await pool.close(); }
    }
    summary.arms.push({ arm, mode, reps, at: environment() }); save();
    console.log(JSON.stringify({ mode, arm, errors: reps.map(r => r.error ?? r.cold?.error ?? null) }));
  }
  const ramp = [];
  for (const parallel of [1, 4, 8, 16, 32, 48]) {
    const pool = new IsolatePool({ hostPort, size: parallel, isolation: mode }), ref = reference(), rows = [];
    try {
      await Promise.all(Array.from({ length: parallel }, () => run(pool, ref, { workload: 'ramp', command })));
      const start = performance.now(), deadline = Date.now() + 10000;
      await Promise.all(Array.from({ length: parallel }, async () => { while (Date.now() < deadline) rows.push(await run(pool, ref, { workload: 'ramp', command })); }));
      const elapsed = (performance.now() - start) / 1000, ok = rows.filter(r => r.status === 0);
      ramp.push({ parallel, checks: rows.length, fails: rows.length - ok.length, checksPerS: ok.length / elapsed, poolMs: stat(rows.map(r => r.poolMs)), checkMs: stat(ok.map(r => r.checkMs)), load: os.loadavg()[0] });
    } catch (e) { ramp.push({ parallel, error: e.message }); }
    finally { await pool.close(); }
    console.log(JSON.stringify({ mode, ...ramp.at(-1), poolMs: undefined, checkMs: undefined }));
  }
  summary.arms.push({ arm: 'ramp', mode, ramp, at: environment() }); save();
}

const shm = fs.mkdtempSync('/dev/shm/ef-p20b-'), native = {}, nativeTsc = path.join(lab, 'adapters/checkers/tscrs-wasm/vendor/native/tsc');
for (const [name, p] of Object.entries(projects)) {
  const dir = path.join(shm, name);
  for (const [file, text] of Object.entries(p.files)) { const dest = path.join(dir, file.slice(p.root.length)); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); }
  const one = () => { const start = performance.now(); spawnSync(nativeTsc, ['-p', dir, '--pretty', 'false', '--singleThreaded']); return performance.now() - start; };
  for (let i = 0; i < 3; i++) one();
  native[name] = stat(Array.from({ length: 20 }, one));
}
fs.rmSync(shm, { recursive: true, force: true });
const serial = [];
for (let i = 0; i < 20; i++) { const start = performance.now(), { status } = spawnSync(command[0], command.slice(1)); serial.push({ ms: performance.now() - start, status }); }
summary.native = { p05SingleThreaded: native, rampCheckDirect: stat(serial.filter(s => s.status === 0).map(s => s.ms)) };
summary.after = environment(); save();
console.log('done', output);
