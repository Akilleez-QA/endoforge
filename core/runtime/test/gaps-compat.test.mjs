import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMPAT_POLICY, compatLedger } from '../contained/promotion.mjs';
import { createContainedRoute } from '../../../tools/tscheck/contained-route.mjs';
import { TSRS_MODULE } from '../../../tools/tscheck/pin.mjs';
import { python } from './fixtures/ledger-fixture.mjs';

const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));
const TESTS = [{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }, { name: 'neg', fn: 'add', args: [-4, 1], expect: -3 }, { name: 'flag', fn: 'positive', args: [7], expect: true }];
const GOOD = 'export function add(a: i32, b: i32): i32 { return a + b; }\nexport function positive(a: i32): boolean { return a > 0; }\n';
const candidate = (kernel, tests = TESTS) => ({ files: { 'kernel.ts': kernel, 'tests.json': JSON.stringify(tests) } });

const setup = async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-compat-'));
  const route = createContainedRoute({ width: 1, deadlineMs: 500 });
  t.after(async () => { await route.close(); await rm(root, { recursive: true, force: true }); });
  const ledgerPath = join(root, 'ledger.sqlite');
  const frozen = await route.freeze({ ledger: ledgerPath, need: 'compatibility reducer', tests: JSON.stringify(TESTS) });
  return { root, route, ledgerPath, frozen };
};

const cli = args => new Promise(resolve => {
  const child = execFile('python3', ['-B', '-m', 'tools.compat_policy', ...args], { cwd: REPOSITORY, timeout: 30000 }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  child.stdin.end('');
});

const forge = (ledgerPath, frozen, candidateId, id, report) => compatLedger('receipt', { ledger: ledgerPath, candidate: candidateId, frozen_evaluator: frozen.identity, report, id });

test('G3: a clean, twice-identical, test-passing TypeScript candidate is promoted through the ledger under its own policy', { timeout: 120000 }, async t => {
  const { root, route, ledgerPath, frozen } = await setup(t);
  assert.equal(COMPAT_POLICY, 'COMPAT-TS-CHECK-RUN2-TESTS/v1');
  assert.notEqual(COMPAT_POLICY, 'X1-G1-G8/v1');
  const decisionPath = join(root, 'promotion.json');
  const result = await route.promote(candidate(GOOD), { ledger: ledgerPath, frozen: frozen.identity, decisionPath });
  assert.equal(result.report.status, 'completed');
  assert.equal(result.report.comparedRuns, 2);
  assert.equal(result.decision.decision, 'promote');
  assert.equal(result.decision.policy, COMPAT_POLICY);
  assert.equal(result.decision.lane, 'compatibility');
  assert.equal(result.decision.scope, 'qualification');
  assert.equal(result.decision.frozen_evaluator, frozen.identity);
  assert.equal(result.decision.compiler, TSRS_MODULE.sha256);
  assert.match(result.decision.chain_tip, /^[0-9a-f]{64}$/);
  assert.match(result.decision.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(await readFile(decisionPath, 'utf8')), result.decision);
  const again = await compatLedger('promote', { ledger: ledgerPath, candidate: result.candidate, receipt: result.receipt });
  assert.equal(again.decision, 'promote');
  assert.equal(again.sha256, result.decision.sha256);
  const stored = await python(`
import json, sqlite3, sys
r = json.load(sys.stdin)
with sqlite3.connect(r['ledger']) as db:
    rows = db.execute('SELECT receipt, candidate, policy FROM compat_decisions').fetchall()
print(json.dumps(rows))
`, { ledger: ledgerPath });
  assert.deepEqual(stored, [[result.receipt.id, result.candidate, COMPAT_POLICY]]);
});

test('G3: type errors, failing tests and changed tests are refused, never promoted', { timeout: 120000 }, async t => {
  const { route, ledgerPath, frozen } = await setup(t);
  const typed = await route.promote(candidate('export function add(a: i32, b: i32): i32 { return "x"; }\nexport function positive(a: i32): boolean { return a > 0; }\n'), { ledger: ledgerPath, frozen: frozen.identity });
  assert.equal(typed.report.reason, 'typescript');
  assert.equal(typed.decision.decision, 'refuse');
  const wrong = await route.promote(candidate('export function add(a: i32, b: i32): i32 { return a - b; }\nexport function positive(a: i32): boolean { return a > 0; }\n'), { ledger: ledgerPath, frozen: frozen.identity });
  assert.equal(wrong.report.reason, 'tests');
  assert.equal(wrong.decision.decision, 'refuse');
  const fewer = await route.promote(candidate(GOOD, TESTS.slice(0, 1)), { ledger: ledgerPath, frozen: frozen.identity });
  assert.equal(fewer.report.status, 'completed');
  assert.equal(fewer.decision.decision, 'refuse');
});

test('G3: the policy re-scores the recorded output and refuses forged or tampered evidence', { timeout: 120000 }, async t => {
  const { route, ledgerPath, frozen } = await setup(t);
  const good = await route.promote(candidate(GOOD), { ledger: ledgerPath, frozen: frozen.identity });
  assert.equal(good.decision.decision, 'promote');
  const report = good.report;
  const promote = receipt => compatLedger('promote', { ledger: ledgerPath, candidate: good.candidate, receipt });
  const lying = JSON.stringify([{ out: 5 }, { out: 0 }, { out: true }]);
  const forgeries = {
    once: { ...report, comparedRuns: 1 },
    lyingOutput: { ...report, output: lying, outputSha256: (await python('import hashlib, json, sys; print(json.dumps(hashlib.sha256(json.load(sys.stdin).encode()).hexdigest()))', lying)) },
    badDigest: { ...report, outputSha256: '0'.repeat(64) },
    otherCompiler: { ...report, compiler: { ...report.compiler, sha256: 'f'.repeat(64) } },
    diagnostics: { ...report, diagnostics: [{ code: 2322 }] },
    otherLane: { ...report, lane: 'kernel' },
    noArtifact: { ...report, artifact: undefined },
  };
  const control = await forge(ledgerPath, frozen, good.candidate, 'control', report);
  assert.equal((await promote(control)).decision, 'promote');
  for (const [name, forged] of Object.entries(forgeries)) {
    const written = await forge(ledgerPath, frozen, good.candidate, `forged-${name}`, forged);
    assert.equal((await promote(written)).decision, 'refuse', name);
  }
  assert.equal((await promote({ ...good.receipt, hash: '0'.repeat(64) })).decision, 'refuse');
  await python(`
import json, sqlite3, sys
r = json.load(sys.stdin)
with sqlite3.connect(r['ledger']) as db:
    db.execute('DROP TRIGGER no_update')
    db.execute('UPDATE records SET hash=? WHERE id=?', ('f' * 64, r['id']))
print('{}')
`, { ledger: ledgerPath, id: good.receipt.id });
  assert.equal((await promote(good.receipt)).decision, 'refuse');
});

test('G3: an unknown route outcome is inconclusive, and the policy tool explains itself with no arguments', { timeout: 120000 }, async t => {
  const { ledgerPath, frozen, route } = await setup(t);
  const registered = await compatLedger('register', { ledger: ledgerPath, files: candidate(GOOD).files });
  const written = await forge(ledgerPath, frozen, registered, 'lost', { lane: 'compatibility', route: 'typescript', status: 'outcome_unknown', reason: 'cohort_exit' });
  const decision = await compatLedger('promote', { ledger: ledgerPath, candidate: registered, receipt: written });
  assert.equal(decision.decision, 'inconclusive');
  assert.equal(decision.policy, COMPAT_POLICY);
  await assert.rejects(route.promote(candidate(GOOD), { ledger: ledgerPath }), /frozen/);
  const bare = await cli([]);
  assert.equal(bare.code, 2);
  assert.match(bare.stderr, /usage: python3 -m tools\.compat_policy (freeze|register|receipt|promote)/);
  assert.doesNotMatch(bare.stderr, /Traceback/);
});
