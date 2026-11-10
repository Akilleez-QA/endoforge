import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';

const ATOMIZER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = (name) => path.join(ATOMIZER, 'bin', name);
const DEFAULT_POLICY = path.join(ATOMIZER, 'policy.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atomizer-verify-policy-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const ledgerDir = path.join(tmp, 'ledger');
const claudeHost = path.join(tmp, 'claude-bin');
fs.mkdirSync(claudeHost, { recursive: true });
const env = () => {
  const e = { ...process.env, ATOMIZER_LEDGER_DIR: ledgerDir, ENDOFORGE_CLAUDE_ACCOUNTS: path.join(tmp, 'no-accounts'), ENDOFORGE_TOOLCHAIN_CLAUDE: claudeHost, ENDOFORGE_CODEX_POOL: path.join(tmp, 'no-codex-pool'), ENDOFORGE_THROTTLE: '0' };
  delete e.ENDOFORGE_CREDENTIAL_HOME; delete e.ENDOFORGE_WORKER;
  return e;
};
const run = (bin, args) => spawnSync(process.execPath, [BIN(bin), ...args], { encoding: 'utf8', env: env(), timeout: 180_000 });
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 1)); return p; };
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const policyFile = path.join(tmp, 'policies', 'alternate-policy.json');
fs.mkdirSync(path.dirname(policyFile), { recursive: true });
fs.writeFileSync(policyFile, `${JSON.stringify(readJson(DEFAULT_POLICY), null, 4)}\n`);
const policySha = sha256(policyFile);

test('the alternate policy is a different file from the default policy', () => {
  assert.notEqual(policySha, sha256(DEFAULT_POLICY));
});

test('fanout verifies each run against the policy it ran with', () => {
  const pair = readJson(path.join(ATOMIZER, 'test', 'fixtures', 'synthetic-pair.json'));
  const a = writeJson(path.join(tmp, 'fan', 'pair-a.json'), { ...pair, need: { ...pair.need, id: 'synthetic-policy-a' } });
  const b = writeJson(path.join(tmp, 'fan', 'pair-b.json'), { ...pair, need: { ...pair.need, id: 'synthetic-policy-b' } });
  const out = path.join(tmp, 'fanout');
  const r = run('fanout.mjs', [a, b, '--out-dir', out, '--parallel-runs', '2', '--per-run-concurrency', '2', '--policy', policyFile]);
  assert.equal(r.status, 0, r.stderr.slice(-800));
  const fan = readJson(path.join(out, 'fanout.json'));
  assert.deepEqual(fan.policy, { path: policyFile, sha256: policySha });
  assert.equal(fan.verified, 2);
  for (const id of ['synthetic-policy-a', 'synthetic-policy-b']) {
    const v = readJson(path.join(out, id, 'receipt', 'verify.json'));
    assert.equal(v.ok, true, JSON.stringify(v.fails));
    assert.deepEqual(v.policy, { path: policyFile, sha256: policySha });
  }
});

test('fanout without --policy verifies against the default policy', () => {
  const pair = readJson(path.join(ATOMIZER, 'test', 'fixtures', 'synthetic-pair.json'));
  const a = writeJson(path.join(tmp, 'fan-default', 'pair.json'), { ...pair, need: { ...pair.need, id: 'synthetic-policy-default' } });
  const out = path.join(tmp, 'fanout-default');
  const r = run('fanout.mjs', [a, '--out-dir', out, '--parallel-runs', '1', '--per-run-concurrency', '2']);
  assert.equal(r.status, 0, r.stderr.slice(-800));
  const v = readJson(path.join(out, 'synthetic-policy-default', 'receipt', 'verify.json'));
  assert.deepEqual(v.policy, { path: DEFAULT_POLICY, sha256: sha256(DEFAULT_POLICY) });
});

test('fanout and cutover refuse an unreadable policy before running anything', () => {
  const missing = path.join(tmp, 'policies', 'absent.json');
  const pair = path.join(ATOMIZER, 'test', 'fixtures', 'synthetic-pair.json');
  const f = run('fanout.mjs', [pair, '--out-dir', path.join(tmp, 'fanout-missing'), '--policy', missing]);
  assert.equal(f.status, 2, f.stderr.slice(-400));
  assert.match(f.stderr, /policy/);
  assert.ok(!fs.existsSync(path.join(tmp, 'fanout-missing', 'fanout.json')));
  const ladder = writeJson(path.join(tmp, 'ladder-missing', 'ladder.json'), { cases: [] });
  const c = run('cutover.mjs', [ladder, '--out-dir', path.join(tmp, 'cutover-missing'), '--policy', missing]);
  assert.equal(c.status, 2, c.stderr.slice(-400));
  assert.match(c.stderr, /policy/);
  assert.ok(!fs.existsSync(path.join(tmp, 'cutover-missing')));
  for (const [bin, args] of [['fanout.mjs', [pair, '--out-dir', path.join(tmp, 'fanout-bare'), '--policy']], ['cutover.mjs', [ladder, '--out-dir', path.join(tmp, 'cutover-bare'), '--policy']]]) {
    const b = run(bin, args);
    assert.equal(b.status, 2, `${bin}: ${b.stderr.slice(-400)}`);
    assert.match(b.stderr, /--policy needs a file/);
  }
});

test('cutover verifies each arm against the policy it ran with', () => {
  const ladderDir = path.join(tmp, 'ladder');
  fs.mkdirSync(ladderDir, { recursive: true });
  fs.writeFileSync(path.join(ladderDir, 'synthetic-policy-case.md'), '# Request synthetic-policy-case\n\nSynthetic case for the cutover policy test.\n');
  const ladder = writeJson(path.join(ladderDir, 'ladder.json'), { cases: [{ id: 'synthetic-policy-case', tier: 1 }] });
  const out = path.join(tmp, 'cutover');
  const r = run('cutover.mjs', [ladder, '--out-dir', out, '--arms', 'direct', '--experiment-id', 'cutover-policy', '--policy', policyFile]);
  assert.equal(r.status, 0, r.stderr.slice(-800));
  const runDir = path.join(out, 'synthetic-policy-case-r1', 'direct');
  assert.ok(fs.existsSync(path.join(runDir, 'receipt', 'run.json')), 'the direct arm did not schedule');
  const v = readJson(path.join(runDir, 'receipt', 'verify.json'));
  assert.deepEqual(v.policy, { path: policyFile, sha256: policySha });
  const start = fs.readFileSync(path.join(ledgerDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.event === 'cutover.start' && e.experimentId === 'cutover-policy');
  assert.deepEqual(start.policy, { path: policyFile, sha256: policySha });
});
