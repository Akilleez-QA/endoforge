import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const sha = data => createHash('sha256').update(data).digest('hex');
const stat = values => { const s = [...values].sort((a, b) => a - b), q = p => s[Math.max(0, Math.ceil(s.length * p) - 1)] ?? null;
  return { n: s.length, p50: q(.5), p95: q(.95), max: s.at(-1) ?? null }; };
const digest = sha(fs.readFileSync(path.join(here, 'PRECOMMIT.md')));
assert.equal(fs.readFileSync(path.join(here, 'receipt/precommit.sha256'), 'utf8').split(/\s/)[0], digest);
for (const name of ['P26_RECEIPT', 'P26_ASC', 'P26_OLD']) assert(process.env[name], `${name} required`);
await new Promise((resolve, reject) => execFile('flock', ['-n', '/tmp/ef-bench.lock', 'true'], e => e?.code === 1 ? resolve() : reject(Error('exclusive benchmark lock not held'))));
const output = path.join(here, 'receipt', process.env.P26_RECEIPT);
assert(!fs.existsSync(output), 'use a fresh receipt directory');
fs.mkdirSync(output, { recursive: true });
const scratch = fs.mkdtempSync('/tmp/ef-p26-');
const wasm = path.join(scratch, 'kernel.wasm');
execFileSync(process.execPath, [path.join(path.dirname(process.env.P26_ASC), '../bin/asc.js'), path.join(process.env.P26_OLD, 'P-01-kernel-instantiate/kernel/kernel.ts'),
  '-O3', '--runtime', 'stub', '--noAssert', '--initialMemory', '1', '--maximumMemory', '16', '-o', wasm]);
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
ledger.append(dict(version=0, kind='task', id='task', data=dict(intent='P-26', acceptance='timing only')))
ledger.append(dict(version=0, kind='admitted_input', id='input', data=dict(task='task', content='timing probe', origin='synthetic')))
frozen = FrozenEvaluators(ledger).freeze(p / 'frozen', task='task', admitted_input='input', confirmed_by='P-26 precommit',
    qualification='timing only', synthesis_context=dict(id='context', candidate_blind='confirmed', inputs=['input']),
    configuration=r['configuration'], residual='timing only', invariant_version='1')
ledger.append(dict(version=0, kind='candidate', id='probe', data=dict(task='task', admitted_input='input', content='timing probe', proposer='synthetic')))
print(json.dumps(dict(ledger=str(p / 'ledger.sqlite'), root=str(p / 'frozen'), identity=frozen['id'], digest=frozen['data']['freeze']['digest'])))
`;
const configuration = { gateInput: { version: 1, contract: { version: 1, signature: { version: 1, name: 'probe', inputs: [], output: { type: 'number', unit: '1' } }, refusals: [], tolerance: 0, sources: ['timing'] },
  cases: [{ id: 'c0', inputs: {} }], limits: { wallMs: 1000, memoryBytes: 1048576, fuel: 1000 }, allowedEffects: [] }, invariants: [], objectives: { cost: 'min' } };
let jobs = 0;
const reference = () => { const directory = fs.mkdtempSync(path.join(scratch, 'ref-'));
  return JSON.parse(execFileSync('python3', ['-B', '-c', fixture], { cwd: root, input: JSON.stringify({ directory, configuration }) })); };
async function run(pool, ref, portOptions) {
  const { digest: version, ...reference } = ref, id = `job-${++jobs}`, out = path.join(scratch, `${id}.json`);
  const receipts = [{ version: 0, kind: 'receipt', id, data: { task: 'task', candidate: 'probe', frozen_evaluator: reference.identity,
    precommit: { observable: 'timing', acceptance_boundary: 'timing only', oracle: reference.identity, oracle_version: version, artifact_identity: 'probe',
      environment: { runtime: 'workcell' }, failure_meaning: 'none', stop_condition: 'measured' },
    delivery_state: 'running', outcome_state: 'unobserved', observations: [] } }];
  const start = performance.now();
  const result = await pool.run({ reference, candidates: ['probe'], portOptions: { ...portOptions, out }, receipts, timing: true });
  const poolMs = performance.now() - start, cell = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  return { poolMs, gateMs: result.timings?.gate ?? null, cell };
}
const hostPort = path.join(here, 'port.mjs'), prewarm = typeof IsolatePool.prototype.ready === 'function';
const summary = { precommit: digest, node: process.version, undici: process.versions.undici, kernel: os.release(), cpu: os.cpus()[0].model,
  cores: os.cpus().length, prewarmAvailable: prewarm, before: { at: new Date().toISOString(), loadavg: os.loadavg() }, spawn: [], instantiate: [] };
const save = () => fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
for (const isolation of ['thread', 'process']) {
  for (const warm of prewarm ? [false, true] : [false]) {
    const reps = [];
    for (let rep = 0; rep < 10; rep++) {
      const constructed = performance.now(), pool = new IsolatePool({ hostPort, size: 1, isolation, ...(warm ? { prewarm: true } : {}) });
      try {
        const ref = reference();
        const readyMs = warm ? (await pool.ready(), performance.now() - constructed) : null;
        const first = await run(pool, ref, { workload: 'noop' }), second = await run(pool, ref, { workload: 'noop' });
        reps.push({ readyMs, first: first.poolMs, second: second.poolMs, firstGate: first.gateMs, secondGate: second.gateMs, ok: Boolean(first.cell && second.cell) });
      } catch (e) { reps.push({ error: e.message }); }
      finally { await pool.close(); }
    }
    const ok = reps.filter(r => r.ok);
    summary.spawn.push({ isolation, prewarm: warm, reps, first: stat(ok.map(r => r.first)), second: stat(ok.map(r => r.second)),
      spawnCost: stat(ok.map(r => r.firstGate - r.secondGate)) });
    save();
    console.log(JSON.stringify({ isolation, prewarm: warm, ok: ok.length, first: summary.spawn.at(-1).first.p50, second: summary.spawn.at(-1).second.p50 }));
  }
}
const direct = `import { createPort } from ${JSON.stringify(pathToFileURL(hostPort).href)};
try { await createPort({ workload: 'p01', wasm: process.argv[1], out: process.argv[2] }); } catch (e) { if (e.message !== 'measured') throw e; }`;
for (const isolation of ['thread', 'process']) {
  for (let rep = 0; rep < 3; rep++) {
    const pool = new IsolatePool({ hostPort, size: 1, isolation });
    let cell = null;
    try { cell = (await run(pool, reference(), { workload: 'p01', wasm })).cell; } finally { await pool.close(); }
    const out = path.join(scratch, `direct-${isolation}-${rep}.json`);
    execFileSync(process.execPath, ['--input-type=module', '-e', direct, wasm, out]);
    const plain = JSON.parse(fs.readFileSync(out, 'utf8'));
    summary.instantiate.push({ isolation, rep, cellUs: cell?.instantiateUs ?? null, directUs: plain.instantiateUs });
    save();
    console.log(JSON.stringify({ isolation, rep, cell: cell?.instantiateUs?.median, direct: plain.instantiateUs.median }));
  }
}
summary.after = { at: new Date().toISOString(), loadavg: os.loadavg() }; save();
fs.rmSync(scratch, { recursive: true, force: true });
console.log('done', output);
