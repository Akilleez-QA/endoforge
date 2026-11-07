import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCandidates, requireFrozen } from '../../engine/evaluator.mjs';
import { IsolatePool } from '../isolate-pool.mjs';
import { compile } from '../x1/compiler.mjs';
import { configuration, createPort, hash } from '../x1/host.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { candidate } from './fixtures/x1/candidate.mjs';
const here = path => fileURLToPath(new URL(path, import.meta.url));
const scratch = t => { const root = mkdtempSync(join(tmpdir(), 'ef-frozen-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const shim = (root, behaviour) => {
  const path = join(root, 'python3');
  writeFileSync(path, `#!/bin/sh\ncase "$*" in *core.engine.frozen*) ${behaviour} ;; esac\nPATH="${process.env.PATH}" exec python3 "$@"\n`);
  chmodSync(path, 0o755);
  return root;
};
const frozenBundle = c => ({ configuration, files: { 'CONTRACT.md': Buffer.from(c.files['CONTRACT.md']).toString('hex') } });
const stubReference = { ledger: 'l', root: 'r', identity: 'evr:x' };
const passing = () => {
  const c = candidate(), identity = hash(JSON.stringify(c)), base = createPort({ candidates: { [identity]: c } });
  return { identity, port: { ...base, residual: () => ({ passed: true, reason: 'pass' }), measure: () => ({ bytes: 1 }) } };
};
const frozenAnswer = c => ({ identity: 'evr:x', digest: 'd', bundle: frozenBundle(c) });
for (const at of [0, 1, 2]) test(`a stall at frozen check ${at} reads as unknown, never as a refusal`, async () => {
  const { identity, port } = passing(), c = candidate();
  let call = 0;
  const report = await evaluateCandidates(stubReference, [identity], port, { requireFrozen: async () => {
    if (call++ === at) throw Object.assign(new Error('frozen evaluator verification unavailable'), { unavailable: true });
    return frozenAnswer(c);
  } }).catch(error => ({ stage: 'outcome_unknown', thrown: error.message }));
  assert.equal(report.stage, 'outcome_unknown', JSON.stringify(report));
  assert.deepEqual(report.frontier ?? [], []);
});
test('real drift still rejects: a failed check is not unavailable', async () => {
  const { identity, port } = passing(), c = candidate();
  let call = 0;
  const report = await evaluateCandidates(stubReference, [identity], port, { requireFrozen: async () => {
    if (call++ === 1) throw new Error('frozen evaluator verification failed');
    return frozenAnswer(c);
  } });
  assert.equal(report.stage, 'rejected');
  assert.equal(report.attempts[0].firstFailure, 'frozen');
});
test('one candidate costs at most three frozen checks, with no check right after another', async () => {
  const { identity, port } = passing(), c = candidate();
  let calls = 0;
  const report = await evaluateCandidates(stubReference, [identity], port, { requireFrozen: async () => { calls++; return frozenAnswer(c); } });
  assert.equal(report.stage, 'completed');
  assert.equal(calls, 3);
});
test('drift between two rejected candidates is still seen before the next one', async () => {
  const { identity, port } = passing(), c = candidate(), rejected = { ...port, residual: () => ({ passed: false, reason: 'no' }) };
  let calls = 0;
  await evaluateCandidates(stubReference, [identity, 'other'], { ...rejected, describe: value => (value === 'other' ? port.describe(identity) : port.describe(value)), run: (value, ...rest) => port.run(identity, ...rest), scanEffects: () => [] }, { requireFrozen: async () => { calls++; return frozenAnswer(c); } });
  assert.equal(calls, 2);
});
test('requireFrozen retries a stall, then reports unavailable', { timeout: 30000 }, async t => {
  const root = shim(scratch(t), 'sleep 20'), path = process.env.PATH;
  process.env.PATH = `${root}${delimiter}${path}`;
  t.after(() => { process.env.PATH = path; });
  await assert.rejects(requireFrozen(stubReference, { timeoutMs: 100, attempts: 2 }), error => error.unavailable === true && /frozen/.test(error.message));
});
test('requireFrozen recovers when a retry succeeds', { timeout: 30000 }, async t => {
  const root = scratch(t), marker = join(root, 'stalled');
  const answer = JSON.stringify({ identity: 'evr:x' }).replace(/"/g, '\\"');
  shim(root, `if [ ! -e ${marker} ]; then : > ${marker}; sleep 20; fi; echo "${answer}"; exit 0`);
  const path = process.env.PATH;
  process.env.PATH = `${root}${delimiter}${path}`;
  t.after(() => { process.env.PATH = path; });
  assert.equal((await requireFrozen(stubReference, { timeoutMs: 300, attempts: 2 })).identity, 'evr:x');
});
test('a timed-out compiler is unavailable, and the gates read that as unknown', { timeout: 30000 }, async t => {
  const root = scratch(t), slow = join(root, 'asc');
  writeFileSync(slow, '#!/bin/sh\nsleep 20\n');
  chmodSync(slow, 0o755);
  const compiled = await compile({ 'kernel.ts': 'x' }, slow, { timeoutMs: 100 });
  assert.equal(compiled.unavailable, true);
  const c = { ...candidate(), compiled }, identity = hash(JSON.stringify(c));
  assert.equal(createPort({ candidates: { [identity]: c } }).describe(identity).status, 'outcome_unknown');
});
test('end to end: an unavailable frozen store gives an inconclusive decision, not a refusal', { timeout: 120000 }, async t => {
  const root = shim(scratch(t), 'exit 75'), path = process.env.PATH;
  process.env.PATH = `${root}${delimiter}${path}`;
  t.after(() => { process.env.PATH = path; });
  const pool = new IsolatePool({ hostPort: here('../x1/host.mjs'), size: 1 });
  t.after(() => pool.close());
  const env = { ...process.env, CODEX_HOME: join(root, 'account'), ENDOFORGE_CODEX_TEST_DOUBLE: '1',
    ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, here('./fixtures/x1/fake-codex.mjs')]), ENDOFORGE_ASC_CMD: here('./fixtures/x1/fake-asc.mjs') };
  const result = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'addition'), pool, env });
  assert.equal(result.promoted, false);
  assert.equal(result.inconclusive, true, JSON.stringify(result));
});
