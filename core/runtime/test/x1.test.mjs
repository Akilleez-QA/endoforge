import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../isolate-pool.mjs';
import { configuration, hash } from '../x1/host.mjs';
import { runGates } from '../x1/gates.mjs';
import { ledger } from '../x1/ledger.mjs';
import { candidate } from './fixtures/x1/candidate.mjs';
export async function job(t, c) {
  const directory = await mkdtemp(join(tmpdir(), 'ef-x1-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reference = { ledger: join(directory, 'ledger.sqlite'), root: join(directory, 'oracle') };
  await mkdir(reference.root);
  for (const name of ['CONTRACT.md', 'tests.json', 'frozen.sha256']) await writeFile(join(reference.root, name), c.files[name]);
  for (const name of ['host.mjs', 'gates.mjs', 'glue.schema.json']) await writeFile(join(reference.root, name), await readFile(new URL(`../x1/${name}`, import.meta.url)));
  const frozen = await ledger('freeze', { reference, need: 'add integers', configuration });
  reference.identity = frozen.identity;
  const content = JSON.stringify(c), identity = hash(content);
  assert.equal(await ledger('register', { reference, content }), identity);
  return { reference, candidates: [identity], portOptions: { candidates: { [identity]: c } }, receipts: [{ version: 0, kind: 'receipt', id: 'receipt', data: {
    task: 'task', candidate: identity, frozen_evaluator: reference.identity,
    precommit: { observable: 'X1', acceptance_boundary: 'G1-G7', oracle: reference.identity, oracle_version: frozen.digest,
      artifact_identity: identity, environment: { runtime: 'workcell' }, failure_meaning: 'refuse', stop_condition: 'report' },
    delivery_state: 'running', outcome_state: 'unobserved', observations: [],
  } }] };
}
for (const isolation of ['thread', 'process']) test(`X1 native/pool gate parity: ${isolation}`, async t => {
  const pool = new IsolatePool({ hostPort: fileURLToPath(new URL('../x1/host.mjs', import.meta.url)), size: 2, isolation });
  t.after(() => pool.close());
  for (const mutation of ['pass', 'frozen', 'compile', 'exports', 'tests', 'glue']) {
    const c = candidate();
    if (mutation === 'frozen') c.files['CONTRACT.md'] += 'drift';
    if (mutation === 'compile') c.compiled.error = 'invalid source';
    if (mutation === 'exports') c.compiled.wasm = Buffer.from(Buffer.from(c.compiled.wasm, 'base64').toString('latin1').replace('add', 'sub'), 'latin1').toString('base64');
    if (mutation === 'tests') { const bytes = Buffer.from(c.compiled.wasm, 'base64'); bytes[bytes.length - 2] = 0x6b; c.compiled.wasm = bytes.toString('base64'); }
    if (mutation === 'glue') c.files['glue.json'] = '{}';
    const expected = runGates(c), result = await pool.run(await job(t, c));
    assert.equal(result.status, 'completed');
    const actual = JSON.parse(result.report.attempts[0].results.find(r => r.check === 'residual').reason);
    const verdicts = r => Object.fromEntries(Object.entries(r.gates).map(([k, v]) => [k, v.ok]));
    assert.deepEqual(verdicts(actual), verdicts(expected));
    assert.equal(actual.promotable, mutation === 'pass', mutation);
    const failed = { frozen: 'G1_frozen', compile: 'G2_compiles', exports: 'G3_exports', tests: 'G4_tests', glue: 'G7_glue' };
    assert.deepEqual(Object.entries(actual.gates).filter(([, v]) => !v.ok).map(([k]) => k), failed[mutation] ? [failed[mutation]] : []);
    assert.equal(result.receipts[0].record.data.outcome_state, mutation === 'pass' ? 'passed' : 'failed');
  }
});

for (const isolation of ['thread', 'process']) test(`original exports survive guarded memory/start instrumentation: ${isolation}`, async t => {
  const c = candidate();
  c.compiled.wasm = Buffer.from('0061736d01000000010a0260027f7f017f60000003030200010504010100010707010361646400000801010a0c020700200020016a0b02000b', 'hex').toString('base64');
  const pool = new IsolatePool({ hostPort: fileURLToPath(new URL('../x1/host.mjs', import.meta.url)), size: 1, isolation }); t.after(() => pool.close());
  assert.equal(runGates(c).promotable, true);
  assert.equal((await pool.run(await job(t, c))).receipts[0].record.data.outcome_state, 'passed');
});
