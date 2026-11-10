import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ATOMIZER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = (name) => path.join(ATOMIZER, 'bin', name);
const DEFAULT_POLICY = path.join(ATOMIZER, 'policy.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutover-policy-'));
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
const events = () => fs.existsSync(path.join(ledgerDir, 'events.jsonl')) ? fs.readFileSync(path.join(ledgerDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const base = readJson(DEFAULT_POLICY);
function policyFile(name, patch) {
  const file = path.join(tmp, `${name}.policy.json`);
  const text = JSON.stringify({ ...base, ...patch }, null, 1) + '\n';
  fs.writeFileSync(file, text);
  return { path: file, sha256: crypto.createHash('sha256').update(text).digest('hex') };
}
const need = path.join(tmp, 'ladder', 'policy-case.md');
fs.mkdirSync(path.dirname(need), { recursive: true });
fs.writeFileSync(need, '# Request policy-case\n\nSynthetic case for the cutover policy test.\n');
const ladder = path.join(tmp, 'ladder', 'ladder.json');
fs.writeFileSync(ladder, JSON.stringify({ cases: [{ id: 'policy-case', tier: 1 }] }));
const ifaceFixture = path.join(tmp, 'iface.txt');
fs.writeFileSync(ifaceFixture, 'E area(w:f64:m, h:f64:m) -> number:f64:m2\nM m1 area | width times height\nA none\nQ none\nR negative sizes\n');
const pairFixture = path.join(ATOMIZER, 'test', 'fixtures', 'synthetic-pair.json');

test('cutover passes --policy to every planning step and each arm records the policy its plan used', () => {
  const custom = policyFile('custom', { cutoverPolicyTest: 'custom' });
  assert.notEqual(custom.sha256, crypto.createHash('sha256').update(fs.readFileSync(DEFAULT_POLICY)).digest('hex'));
  const out = path.join(tmp, 'cutover-custom');
  const r = run('cutover.mjs', [ladder, '--out-dir', out, '--arms', 'direct,atomized,templated', '--policy', custom.path, '--experiment-id', 'cutover-policy-custom']);
  assert.equal(r.status, 0, r.stderr.slice(-800));
  const dir = path.join(out, 'policy-case-r1');
  assert.deepEqual(readJson(path.join(dir, 'direct-atoms.json')).policy, custom);
  assert.deepEqual(readJson(path.join(dir, 'atomized-plan', 'receipt', 'atomize.json')).policy, custom);
  assert.deepEqual(readJson(path.join(dir, 'templated-plan', 'receipt', 'atomize.json')).policy, custom);
  const c = readJson(path.join(dir, 'case.json'));
  for (const arm of ['direct', 'atomized', 'templated']) {
    assert.deepEqual(c[arm].planPolicy, custom, arm);
    assert.equal(c[arm].planPolicyMatches, true, arm);
  }
  for (const log of ['direct-schedule.log', 'direct-verify.log']) assert.ok(fs.existsSync(path.join(dir, log)), log);
  assert.deepEqual(readJson(path.join(dir, 'direct', 'receipt', 'verify.json')).policy, custom);
  const ev = events();
  assert.deepEqual(ev.find((e) => e.event === 'cutover.start' && e.experimentId === 'cutover-policy-custom').policy, custom);
  assert.ok(ev.some((e) => e.event === 'atomize.start' && e.policy?.sha256 === custom.sha256));
  assert.ok(ev.some((e) => e.event === 'plan.start' && e.policy?.sha256 === custom.sha256));
});

test('a cutover arm plans under the given policy, not the default: a policy the direct plan breaks stops that arm', () => {
  const tight = policyFile('tight', { maxAtoms: 0 });
  const out = path.join(tmp, 'cutover-tight');
  const r = run('cutover.mjs', [ladder, '--out-dir', out, '--arms', 'direct', '--policy', tight.path, '--experiment-id', 'cutover-policy-tight']);
  assert.equal(r.status, 0, r.stderr.slice(-800));
  const dir = path.join(out, 'policy-case-r1');
  const planned = readJson(path.join(dir, 'direct-atoms.json'));
  assert.equal(planned.valid, false);
  assert.match(planned.errors.join('\n'), /policy\.maxAtoms 0/);
  const c = readJson(path.join(dir, 'case.json'));
  assert.equal(c.direct.planValid, false);
  assert.deepEqual(c.direct.planPolicy, tight);
  assert.ok(!fs.existsSync(path.join(dir, 'direct')));
});

test('atomize.mjs validates its plan against --policy and records it', () => {
  const tight = policyFile('atomize-tight', { maxAtoms: 1 });
  const out = path.join(tmp, 'atomize-tight');
  const r = run('atomize.mjs', [need, '--out', out, '--fixture', pairFixture, '--repair', '0', '--policy', tight.path]);
  assert.equal(r.status, 1, r.stderr.slice(-400));
  const receipt = readJson(path.join(out, 'receipt', 'atomize.json'));
  assert.deepEqual(receipt.policy, tight);
  assert.match(receipt.attempts[0].errors.join('\n'), /exceed policy\.maxAtoms 1/);
  const ok = run('atomize.mjs', [need, '--out', path.join(tmp, 'atomize-default'), '--fixture', pairFixture, '--repair', '0']);
  assert.equal(ok.status, 0, ok.stderr.slice(-400));
  assert.equal(readJson(path.join(tmp, 'atomize-default', 'receipt', 'atomize.json')).policy.path, DEFAULT_POLICY);
});

test('plan-template.mjs validates its plan against --policy and records it', () => {
  const tight = policyFile('template-tight', { maxAtoms: 2 });
  const out = path.join(tmp, 'template-tight');
  const r = run('plan-template.mjs', [need, '--out', out, '--fixture', ifaceFixture, '--policy', tight.path]);
  assert.equal(r.status, 1, r.stderr.slice(-400));
  const receipt = readJson(path.join(out, 'receipt', 'atomize.json'));
  assert.deepEqual(receipt.policy, tight);
  assert.match(receipt.errors.join('\n'), /exceed policy\.maxAtoms 2/);
  const ok = run('plan-template.mjs', [need, '--out', path.join(tmp, 'template-default'), '--fixture', ifaceFixture]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr.slice(-400));
  assert.equal(readJson(path.join(tmp, 'template-default', 'receipt', 'atomize.json')).policy.path, DEFAULT_POLICY);
});

test('direct.mjs validates its plan against --policy and records it', () => {
  const custom = policyFile('direct-custom', { cutoverPolicyTest: 'direct' });
  const out = path.join(tmp, 'direct-custom.json');
  const r = run('direct.mjs', [need, '--out', out, '--policy', custom.path]);
  assert.equal(r.status, 0, r.stderr.slice(-400));
  const doc = readJson(out);
  assert.deepEqual(doc.policy, custom);
  assert.equal(doc.valid, true);
  const def = run('direct.mjs', [need, '--out', path.join(tmp, 'direct-default.json')]);
  assert.equal(def.status, 0, def.stderr.slice(-400));
  assert.equal(readJson(path.join(tmp, 'direct-default.json')).policy.path, DEFAULT_POLICY);
});

test('every planning step and cutover refuse a missing, unreadable or malformed --policy before planning', () => {
  const bad = path.join(tmp, 'bad.policy.json');
  fs.writeFileSync(bad, '[1, 2]');
  const absent = path.join(tmp, 'absent.policy.json');
  const cases = [
    ['atomize.mjs', [need, '--out', path.join(tmp, 'refuse-atomize'), '--fixture', pairFixture]],
    ['plan-template.mjs', [need, '--out', path.join(tmp, 'refuse-template'), '--fixture', ifaceFixture]],
    ['direct.mjs', [need, '--out', path.join(tmp, 'refuse-direct.json')]],
    ['cutover.mjs', [ladder, '--out-dir', path.join(tmp, 'refuse-cutover')]],
  ];
  for (const [bin, args] of cases) {
    for (const extra of [['--policy'], ['--policy', absent], ['--policy', bad]]) {
      const r = run(bin, [...args, ...extra]);
      assert.equal(r.status, 2, `${bin} ${extra.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, /policy/);
      assert.match(r.stderr, /usage: /);
      assert.doesNotMatch(r.stderr, /^\s+at |node:internal/m);
    }
  }
  assert.ok(!fs.existsSync(path.join(tmp, 'refuse-direct.json')));
  assert.ok(!fs.existsSync(path.join(tmp, 'refuse-cutover')));
});
