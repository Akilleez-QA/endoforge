import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { workerCommand } from '../lib/workers.mjs';
import { loadRouting, resolve } from '../lib/routing.mjs';
import { validate } from '../lib/validate.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const pool = process.env.ENDOFORGE_CODEX_POOL || fileURLToPath(new URL('../../runtime/agent-pool.mjs', import.meta.url));
if (!fs.existsSync(pool)) { console.log(`SKIP codex swarm: pool absent (${pool}); set ENDOFORGE_CODEX_POOL`); process.exit(0); }
// Outside /tmp because the isolate overlays /tmp after mounting toolchains.
const tmp = fs.mkdtempSync(path.join(here, 'swarm-'));
const policy = JSON.parse(fs.readFileSync(path.join(here, '../policy.json'), 'utf8'));
let failures = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}: ${e.message}`); } };
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function run(name, kinds, { limited = [], third = false, astra = false, guard, extra = [] } = {}) {
  const root = path.join(tmp, name), prefix = path.join(root, 'stub');
  const homes = [path.join(root, 'acct-a'), path.join(root, 'accts/acct-b'), ...(third ? [path.join(root, 'accts/acct-c')] : [])];
  for (const home of homes) {
    fs.mkdirSync(home, { recursive: true });
    fs.closeSync(fs.openSync(path.join(home, 'auth.json'), 'wx', 0o000));
    if (limited.includes(path.basename(home))) fs.writeFileSync(path.join(home, 'RATE_LIMITED'), '');
  }
  fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(prefix, 'bin/codex'), `#!/bin/sh
if [ -e "$CODEX_HOME/RATE_LIMITED" ]; then echo 'ERROR: 429 Too Many Requests; try again in 120 seconds' >&2; exit 1; fi
while [ "$#" -gt 0 ]; do
  case "$1" in -m) model="$2"; shift;; -c) effort="\${2#*=}"; shift;; -o) out="$2"; shift;; esac
  shift
done
${astra ? `if [ "$model" = gpt-6-astra ]; then echo "error: model 'gpt-6-astra' is not supported" >&2; exit 1; fi` : ''}
sleep 0.2
printf '\x60\x60\x60text\\nmodel=%s effort=%s home=%s\\n\x60\x60\x60\\n' "$model" "$effort" "\${CODEX_HOME##*/}" > "$out"
`, { mode: 0o755 });
  const atoms = kinds.map((kind, i) => ({ id: `a${i}`, kind, contract: 'Return the requested model evidence.', inputs: [], outputs: [{ name: 'result', path: 'result.txt' }], verify: { kind: 'manual' }, size: { work: 1, interface: 1 }, worker: { model: 'sonnet', tools: [], prompt: 'Return the result.' } }));
  // A script join keeps each model atom tiny while satisfying the compose contract.
  atoms.push({ id: 'join', kind: 'compose', contract: 'Join the completed model evidence.', inputs: atoms.map((a) => ({ from: a.id })), outputs: [{ name: 'done', path: 'done.txt' }], verify: { kind: 'manual' }, size: { work: 1, interface: 1 }, worker: { model: 'script', command: ['sh', '-c', 'echo done > /out/done.txt'] } });
  const doc = { schema: 'endoforge/atoms/1', need: { id: name, text: 'Return model evidence.' }, acceptance: [{ id: 'A1', statement: 'Outputs exist.', check: { kind: 'manual' } }], atoms };
  assert.deepEqual(validate(doc, policy).errors, []);
  const input = path.join(root, 'atoms.json'), output = path.join(root, 'run'); fs.writeFileSync(input, JSON.stringify(doc));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CODEX_POOL_') && !k.startsWith('ENDOFORGE_') && k !== 'CODEX_HOME'));
  Object.assign(env, { ENDOFORGE_CODEX_POOL: pool, CODEX_POOL_PRIMARY: homes[0], CODEX_POOL_ACCOUNTS_DIR: path.join(root, 'accts'), CODEX_POOL_STATE_DIR: path.join(root, 'pool-state'), CODEX_POOL_GUARD: 'none', CODEX_POOL_WAIT: '30', ATOMIZER_LEDGER_DIR: path.join(root, 'ledger'), ENDOFORGE_WORKER: 'codex', ENDOFORGE_TOOLCHAIN_CODEX: prefix });
  if (guard) { env.CODEX_POOL_GUARD = path.join(root, 'guard'); fs.writeFileSync(env.CODEX_POOL_GUARD, `#!/bin/sh\nexit ${guard}\n`, { mode: 0o755 }); }
  const result = spawnSync(process.execPath, [path.join(here, '../bin/schedule.mjs'), 'run', input, '--run-dir', output, '--no-augment', ...extra], { env, encoding: 'utf8', timeout: 60_000 });
  assert.ifError(result.error);
  const receipts = kinds.map((_, i) => read(path.join(output, 'receipt/atoms', `a${i}.json`)));
  return { ...result, receipts, summary: read(path.join(output, 'receipt/run.json')), output: (i) => fs.readFileSync(path.join(output, 'atoms', `a${i}`, 'out/result.txt'), 'utf8'), events: fs.readFileSync(path.join(root, 'ledger/events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) };
}
try {
  test('tool flags and explicit routed model', () => {
    const atom = { id: 'a', kind: 'other', contract: 'Return a file.', outputs: [{ path: 'file' }], worker: { model: 'codex', tools: [] } };
    const p = { ...policy, toolchain: { ...policy.toolchain, codex: tmp } }, doc = { need: { id: 'test', text: 'test' } }, sel = resolve(atom, 1, loadRouting());
    const command = () => workerCommand(doc, atom, [], p, repo, sel).cmd;
    assert(command().includes('-o')); assert(command().includes('read-only')); assert(command().includes('model_reasoning_effort=medium'));
    atom.worker.tools = ['shell']; assert(!command().includes('-o')); assert(command().includes('--dangerously-bypass-approvals-and-sandbox'));
  });
  test('failover and routing', () => {
    const r = run('routing', ['interface', 'review', 'other'], { limited: ['acct-a'] }); assert.equal(r.status, 0, r.stderr);
    assert.equal(r.summary.concurrency, 3);
    ['gpt-6.1-sol effort=low', 'gpt-6-astra effort=high', 'gpt-6.1-sol effort=medium'].forEach((s, i) => { assert(r.output(i).startsWith(`model=${s}`)); assert(!r.output(i).includes('acct-a')); });
    assert(r.receipts.some((a) => a.attempts.some((t) => t.failovers.some((f) => f.account === 'default' && f.class === 'rate'))));
    assert(r.receipts.every((a) => a.attempts.at(-1).account === 'acct-b'));
    assert(r.summary.lessons.failovers.some((f) => f.account === 'default' && f.class === 'rate'), JSON.stringify(r.summary.lessons));
    assert(r.events.filter((e) => e.event === 'attempt.end' && e.model === 'codex').every((e) => e.tier && e.codexModel && e.accounts.length));
  });
  test('exhaustion stops retries', () => {
    const r = run('exhaustion', ['other'], { limited: ['acct-a', 'acct-b'] }); assert.notEqual(r.status, 0);
    assert.equal(r.receipts[0].attempts.length, 1); assert.match(r.receipts[0].attempts[0].reason, /exhausted/);
    assert.deepEqual(r.summary.lessons.failedLaunches.map((f) => f.atom), ['a0']);
  });
  test('spread and unhealthy account exclusion', () => {
    const r = run('spread', Array(6).fill('other'), { third: true, extra: ['--concurrency', '3'] }); assert.equal(r.status, 0, r.stderr);
    assert(Object.keys(r.summary.codexAccounts).length >= 2); assert.equal(Object.values(r.summary.codexAccounts).reduce((a, b) => a + b, 0), 6);
    const s = run('spread-limited', Array(6).fill('other'), { third: true, limited: ['acct-c'], extra: ['--concurrency', '3'] }); assert.equal(s.status, 0, s.stderr);
    for (let i = 0; i < 6; i++) assert.match(s.output(i), /home=acct-[ab]\n$/);
  });
  test('astra rejection falls back within the attempt', () => {
    const r = run('fallback', ['review'], { astra: true }); assert.equal(r.status, 0, r.stderr);
    assert.match(r.output(0), /model=gpt-6.1-sol effort=high/); assert.equal(r.receipts[0].attempts.length, 1); assert.equal(r.receipts[0].attempts[0].modelFallback, true);
  });
  for (const guard of [75, 77]) test(`guard ${guard} stops without retry or failover`, () => {
    const r = run(`guard${guard}`, ['review'], { guard }); assert.notEqual(r.status, 0); const a = r.receipts[0].attempts;
    assert.equal(a.length, 1); assert.equal(a[0].exit, guard); assert.equal(a[0].accounts.length, 1); assert.deepEqual(a[0].failovers, []); assert(a[0].reason);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
process.exitCode = failures ? 1 : 0;
