import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { ledgerRequest } from '../../core/runtime/isolate-ledger.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const sha = data => createHash('sha256').update(data).digest('hex');
const stat = values => { const s = [...values].sort((a, b) => a - b), q = p => s[Math.max(0, Math.ceil(s.length * p) - 1)] ?? null;
  return { n: s.length, p50: q(.5), p95: q(.95), max: s.at(-1) ?? null }; };
const digest = sha(fs.readFileSync(path.join(here, 'PRECOMMIT.md')));
assert.equal(fs.readFileSync(path.join(here, 'receipt/precommit.sha256'), 'utf8').split(/\s/)[0], digest);
assert(process.env.P25_LOADTEST && process.env.P25_RECEIPT, 'P25_LOADTEST and P25_RECEIPT required');
await new Promise((resolve, reject) => execFile('flock', ['-n', '/tmp/ef-bench.lock', 'true'], e => e?.code === 1 ? resolve() : reject(Error('exclusive benchmark lock not held'))));
const output = path.join(here, 'receipt', process.env.P25_RECEIPT);
assert(!fs.existsSync(output), 'use a fresh receipt directory');
fs.mkdirSync(output, { recursive: true });
const scratch = fs.mkdtempSync('/tmp/ef-p25-');
const fix = path.join(process.env.P25_LOADTEST, 'isofix');
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
ledger.append(dict(version=0, kind='task', id='task', data=dict(intent='P-25', acceptance='timing only')))
ledger.append(dict(version=0, kind='admitted_input', id='input', data=dict(task='task', content='timing probe', origin='synthetic')))
frozen = FrozenEvaluators(ledger).freeze(p / 'frozen', task='task', admitted_input='input', confirmed_by='P-25 precommit',
    qualification='timing only', synthesis_context=dict(id='context', candidate_blind='confirmed', inputs=['input']),
    configuration=r['configuration'], residual='timing only', invariant_version='1')
ledger.append(dict(version=0, kind='candidate', id='probe', data=dict(task='task', admitted_input='input', content='timing probe', proposer='synthetic')))
print(json.dumps(dict(ledger=str(p / 'ledger.sqlite'), root=str(p / 'frozen'), identity=frozen['id'], digest=frozen['data']['freeze']['digest'])))
`;
const verify = ledger => JSON.parse(execFileSync('python3', ['-B', '-c', 'import json,sys\nfrom core.ledger.ledger import Ledger\nprint(json.dumps(len(Ledger(sys.argv[1]).records())))', ledger], { cwd: root }));
const configuration = { gateInput: { version: 1, contract: { version: 1, signature: { version: 1, name: 'probe', inputs: [], output: { type: 'number', unit: '1' } }, refusals: [], tolerance: 0, sources: ['timing'] },
  cases: [{ id: 'c0', inputs: {} }], limits: { wallMs: 1000, memoryBytes: 1048576, fuel: 1000 }, allowedEffects: [] }, invariants: [], objectives: { cost: 'min' } };
let jobs = 0;
const reference = () => { const directory = fs.mkdtempSync(path.join(scratch, 'ref-'));
  return JSON.parse(execFileSync('python3', ['-B', '-c', fixture], { cwd: root, input: JSON.stringify({ directory, configuration }) })); };
const job = ref => {
  const { digest: version, ...reference } = ref, id = `job-${++jobs}`;
  return { id, reference, candidates: ['probe'], receipts: [{ version: 0, kind: 'receipt', id, data: { task: 'task', candidate: 'probe', frozen_evaluator: reference.identity,
    precommit: { observable: 'timing', acceptance_boundary: 'timing only', oracle: reference.identity, oracle_version: version, artifact_identity: 'probe',
      environment: { runtime: 'workcell' }, failure_meaning: 'none', stop_condition: 'measured' },
    delivery_state: 'running', outcome_state: 'unobserved', observations: [] } }] };
};
async function run(pool, ref) {
  const { id, ...data } = job(ref), out = path.join(scratch, `${id}.json`), start = performance.now();
  const result = await pool.run({ ...data, timing: true, portOptions: { workload: 'ramp', command, out } });
  const poolMs = performance.now() - start, cell = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  return { poolMs, status: cell?.status ?? null, checkMs: cell?.checkMs ?? null, gate: result.timings?.gate ?? null, ledger: result.timings?.ledger ?? null };
}
const environment = () => ({ at: new Date().toISOString(), loadavg: os.loadavg() });
const summary = { precommit: digest, node: process.version, kernel: os.release(), cpu: os.cpus()[0].model, cores: os.cpus().length, before: environment() };
const save = () => fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');

const micro = reference(), calls = [];
for (let i = 0; i < 200; i++) {
  const { id, ...data } = job(micro);
  let t = performance.now(); await ledgerRequest('prepare', data); const prepare = performance.now() - t;
  t = performance.now(); await ledgerRequest('append', data, { status: 'rejected', reason: 'measured', report: null }); const append = performance.now() - t;
  calls.push({ i, records: 4 + i, prepare, append });
}
summary.micro = { calls, prepare: stat(calls.map(c => c.prepare)), append: stat(calls.map(c => c.append)), records: verify(micro.ledger) };
save();
console.log(JSON.stringify({ micro: { prepare: summary.micro.prepare.p50, append: summary.micro.append.p50 } }));

const hostPort = path.resolve(here, '../P-20-pool-speed-rerun/addendum-port.mjs');
summary.ramp = [];
for (const [isolation, widths] of [['thread', [1, 4, 8, 16, 32]], ['process', [16]]]) {
  for (const parallel of widths) {
    const pool = new IsolatePool({ hostPort, size: parallel, isolation }), ref = reference(), rows = [];
    try {
      await Promise.all(Array.from({ length: parallel }, () => run(pool, ref)));
      const start = performance.now(), deadline = Date.now() + 10000;
      await Promise.all(Array.from({ length: parallel }, async () => { while (Date.now() < deadline) rows.push(await run(pool, ref)); }));
      const elapsed = (performance.now() - start) / 1000, ok = rows.filter(r => r.status === 0);
      summary.ramp.push({ isolation, parallel, checks: rows.length, fails: rows.length - ok.length, checksPerS: ok.length / elapsed,
        poolMs: stat(rows.map(r => r.poolMs)), checkMs: stat(ok.map(r => r.checkMs)), gateMs: stat(rows.map(r => r.gate)), ledgerMs: stat(rows.map(r => r.ledger)),
        records: null, load: os.loadavg()[0] });
    } catch (e) { summary.ramp.push({ isolation, parallel, error: e.message }); }
    finally { await pool.close(); }
    try { if (summary.ramp.at(-1).records === null) summary.ramp.at(-1).records = verify(ref.ledger); }
    catch (e) { summary.ramp.at(-1).verifyError = e.message; }
    save();
    const { poolMs, checkMs, gateMs, ledgerMs, ...line } = summary.ramp.at(-1);
    console.log(JSON.stringify({ ...line, check: checkMs?.p50, ledger: ledgerMs?.p50 }));
  }
}
summary.after = environment(); save();
fs.rmSync(scratch, { recursive: true, force: true });
console.log('done', output);
