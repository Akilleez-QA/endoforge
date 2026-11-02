import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { availableParallelism, loadavg, homedir, tmpdir, release, arch } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { signature } from './port.mjs';

const here = fileURLToPath(new URL('./', import.meta.url)), root = fileURLToPath(new URL('../../', import.meta.url));
const receipt = join(here, 'receipt'), py = join(homedir(), 'work/cstack-venv-tmp/bin/python');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const precommit = hash(readFileSync(join(here, 'PRECOMMIT.md')));
assert.equal(readFileSync(join(receipt, 'precommit.sha256'), 'utf8').split(/\s/)[0], precommit);
const sanitize = value => JSON.stringify(value, null, 2).replaceAll(homedir(), '$HOME');
const save = (name, value) => writeFileSync(join(receipt, name), sanitize(value) + '\n');
const command = (bin, args, input, cwd = root) => new Promise((resolve, reject) => {
  const child = execFile(bin, args, { cwd, timeout: 120000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }, (error, stdout, stderr) => {
    if (error) return reject(Error(`${bin}: ${stderr || error.message}`));
    resolve(stdout.trim());
  });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
});
const bridge = async (action, directory, input = {}) => JSON.parse(await command(py, ['-B', join(here, 'bridge.py'), action, directory], JSON.stringify(input)));
const sources = ['run.mjs', 'bridge.py', 'port.mjs', '../../core/runtime/isolate-pool.mjs', '../../core/runtime/isolate-workcell.mjs',
  '../../core/runtime/isolate-ledger.mjs', '../../core/runtime/isolate-wasm.mjs', '../../core/runtime/isolate-cgroup.mjs',
  '../../core/engine/evaluator.mjs', '../../core/engine/gates.mjs', '../../core/engine/frozen.py',
  '../../core/ledger/ledger.py', '../../core/ledger/frozen.py', '../../core/ledger/record.schema.json', '../../tools/factory_quality/index.mjs'];

if (!process.argv.includes('--measure')) {
  const repositories = {};
  for (const repo of ['p19', 'cstack', 'poodo']) {
    const cwd = fileURLToPath(new URL(`../../../${repo}/`, import.meta.url));
    repositories[repo] = { revision: await command('git', ['rev-parse', 'HEAD'], undefined, cwd),
      status: await command('git', ['status', '--short'], undefined, cwd) };
  }
  const sourceHashes = Object.fromEntries(sources.map(path => [path, hash(readFileSync(join(here, path)))]));
  for (const path of ['cli.py', 'bootstrap.py', 'poodo_core/core.py', 'poodo_core/ports.py', 'adapters/endoforge_ledger.py',
    'adapters/math_stdio.py', 'examples/scalar-and-negative.json', 'contracts/SOURCE-PINS.json']) {
    sourceHashes[`cstack/${path}`] = hash(readFileSync(join(root, '../cstack', path)));
  }
  save('env.json', { captured: new Date().toISOString(), node: process.version, platform: process.platform,
    release: release(), arch: arch(), cpus: availableParallelism(), cstackPython: await command(py, ['--version']),
    enginePython: await command('python3', ['--version']), precommit, sourceHashes, repositories });
  const child = await command('flock', ['/tmp/ef-bench.lock', process.execPath, join(here, 'run.mjs'), '--measure']);
  console.log(child);
} else {
  assert(!readFileSync(join(receipt, 'env.json'), 'utf8').includes(homedir()));
  const env = JSON.parse(readFileSync(join(receipt, 'env.json')));
  assert.equal(env.precommit, precommit);
  for (const path of sources) assert.equal(hash(readFileSync(join(here, path))), env.sourceHashes[path]);
  const summary = { precommit, N: 30, started: new Date().toISOString(), loadBefore: loadavg(), runs: [],
    architecturalSuccess: false, standIns: ['candidate generation', 'promotion authority/local selection'] };
  save('env-before.json', { utc: summary.started, loadavg: summary.loadBefore });
  try {
    for (let index = 1; index <= 30; index++) for (const isolation of ['thread', 'process']) {
      const directory = mkdtempSync(join(tmpdir(), 'ef-p19-')), stages = {}, row = { index, isolation, directory, stages };
      let pool;
      const start = performance.now();
      const stage = async (name, fn) => {
        const began = performance.now();
        try { return await fn(); } finally { stages[name] = performance.now() - began; }
      };
      try {
        const intake = await stage('cstack_intake', () => bridge('intake', directory));
        const configuration = { gateInput: { version: 1,
          contract: { version: 1, signature, refusals: [], tolerance: 0, sources: ['cstack pinned exact_scalar'] },
          cases: intake.tests.map(({ id, inputs }) => ({ id, inputs })),
          limits: { wallMs: 1000, memoryBytes: 64 * 1024 * 1024, fuel: 100 }, allowedEffects: [] },
          invariants: ['exact_addition'], objectives: { sourceBytes: 'min' } };
        const frozen = await stage('freeze', () => bridge('freeze', directory, { tests: intake.tests, configuration }));
        const candidates = await stage('synthetic_generation', async () => {
          const entries = ['(a,b)=>a+b\n', '(a,b)=>a-b\n'].map(bytes => [hash(bytes), bytes]);
          for (const [id, bytes] of entries) writeFileSync(join(directory, id), bytes);
          await bridge('register', directory, Object.fromEntries(entries));
          return entries.map(([id]) => id);
        });
        const result = await stage('pool_evaluate_and_append', async () => {
          pool = new IsolatePool({ hostPort: join(directory, 'oracle/port.mjs'), size: 1, isolation });
          return pool.run({ reference: frozen.reference, candidates, portOptions: { directory },
            receipts: candidates.map((candidate, n) => ({ version: 0, kind: 'receipt', id: `receipt-${n}`, data: {
              task: 'task', candidate, frozen_evaluator: frozen.reference.identity,
              precommit: { observable: 'exact addition', acceptance_boundary: 'all frozen checks pass',
                oracle: frozen.reference.identity, oracle_version: frozen.digest, artifact_identity: candidate,
                environment: { isolation }, failure_meaning: 'reject candidate', stop_condition: 'one batch' },
              delivery_state: 'running', outcome_state: 'unobserved', observations: [] } })) });
        });
        assert.equal(result.status, 'completed');
        assert.deepEqual(result.report.frontier, [candidates[0]]);
        assert.deepEqual(result.report.attempts.map(a => [a.candidate, a.round, a.stage]),
          [[candidates[0], 0, 'passed'], [candidates[1], 0, 'rejected'], [candidates[0], 1, 'passed']]);
        assert.equal(result.report.attempts[1].firstFailure, 'invariant:exact_addition');
        const verification = await stage('verify_chains', () => bridge('verify', directory, result));
        const output = await stage('synthetic_promotion', async () => {
          const selected = candidates[0], path = join(directory, 'selected.mjs');
          copyFileSync(join(directory, selected), path);
          assert.equal(hash(readFileSync(path)), selected);
          const manifest = { candidate: selected, frozenEvaluator: frozen.reference.identity, synthetic: true,
            realPromotion: false, authority: 'No POODO lifecycle decision issuer is wired', artifact: 'selected.mjs' };
          writeFileSync(join(directory, 'selection.json'), JSON.stringify(manifest));
          return manifest;
        });
        row.result = result;
        row.verification = verification;
        row.output = output;
        row.tests = intake.tests;
        row.passed = true;
      } catch (error) { row.passed = false; row.error = String(error); }
      finally { await stage('shutdown', async () => { if (pool) await pool.close(); }); }
      row.totalMs = performance.now() - start;
      const name = `${isolation}-${String(index).padStart(2, '0')}`;
      save(`raw/${name}.json`, row);
      if (row.passed) {
        mkdirSync(join(receipt, 'output'), { recursive: true });
        copyFileSync(join(directory, 'selected.mjs'), join(receipt, 'output', `${name}.mjs`));
        save(`output/${name}.json`, row.output);
      }
      summary.runs.push({ index, isolation, stages, totalMs: row.totalMs, passed: row.passed });
      save('summary.json', summary);
      assert(row.passed, row.error);
    }
  } finally {
    summary.finished = new Date().toISOString();
    summary.loadAfter = loadavg();
    save('env-after.json', { utc: summary.finished, loadavg: summary.loadAfter });
    summary.modes = {};
    for (const mode of ['thread', 'process']) {
      const rows = summary.runs.filter(r => r.isolation === mode), metrics = {};
      for (const key of [...Object.keys(rows[0]?.stages || {}), 'totalMs']) {
        const values = rows.map(r => key === 'totalMs' ? r.totalMs : r.stages[key]).sort((a, b) => a - b);
        metrics[key] = { p50: values[Math.ceil(values.length * 0.5) - 1], p95: values[Math.ceil(values.length * 0.95) - 1] };
      }
      summary.modes[mode] = { count: rows.length, metrics, bottleneck: Object.keys(metrics).filter(k => k !== 'totalMs').sort((a, b) => metrics[b].p50 - metrics[a].p50)[0],
        screenPassed: rows.length === 30 && rows.every(r => r.passed) && metrics.totalMs.p95 <= 1000 };
    }
    save('summary.json', summary);
  }
  console.log(sanitize(summary.modes));
}
