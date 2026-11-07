import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../isolate-pool.mjs';
import { fixture } from './fixtures/ledger-fixture.mjs';

const hostPort = fileURLToPath(new URL('./fixtures/host-call-port.mjs', import.meta.url));

for (const isolation of ['thread', 'process']) {
  test(`${isolation}: a port reaches the supervisor only through its host call`, { timeout: 60000 }, async t => {
    const { job } = await fixture(t);
    const seen = [];
    const pool = new IsolatePool({ hostPort, isolation, size: 1, frozenThroughLedger: true,
      hostCalls: (request, context) => { seen.push({ request, context }); return { echoed: request.candidate }; } });
    t.after(() => pool.close());
    const result = await pool.run(job(['pass']));
    assert.equal(result.status, 'completed');
    assert.equal(result.receipts[0].record.data.outcome_state, 'passed');
    assert.deepEqual(result.evidence.seen[0], { echoed: 'pass' });
    assert.deepEqual(seen[0].context.candidates, ['pass']);
    assert.equal(seen[0].context.workcell, result.workcell);
  });
}

test('a failed host call is an unknown outcome, never a pass', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1, hostCalls: () => { throw new Error('controller gone'); } });
  t.after(() => pool.close());
  const result = await pool.run(job(['pass']));
  assert.equal(result.report.attempts[0].stage, 'outcome_unknown');
  assert.equal(result.receipts[0].record.data.outcome_state, 'inconclusive');
});

test('host calls are bounded per job', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1, hostCalls: () => ({}) });
  t.after(() => pool.close());
  const result = await pool.run(job(['pass'], { flood: 5000 }));
  assert.equal(result.receipts[0].record.data.outcome_state, 'inconclusive');
});

test('without hostCalls a port call is refused', { timeout: 60000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1 });
  t.after(() => pool.close());
  const result = await pool.run(job(['pass']));
  assert.equal(result.receipts[0].record.data.outcome_state, 'inconclusive');
});

test('frozen checks through the ledger bridge still refuse a changed evaluator tree', { timeout: 60000 }, async t => {
  const { job, reference } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1, frozenThroughLedger: true, hostCalls: () => ({}) });
  t.after(() => pool.close());
  assert.equal((await pool.run(job(['pass']))).receipts[0].record.data.outcome_state, 'passed');
  writeFileSync(join(reference.root, 'added.txt'), 'changed after freeze');
  t.after(() => rmSync(join(reference.root, 'added.txt'), { force: true }));
  const changed = await pool.run(job(['pass']));
  assert.equal(changed.status, 'outcome_unknown');
  assert.match(changed.reason, /digest differs/);
  assert.equal(changed.receipts[0].record.data.outcome_state, 'inconclusive');
});

test('a process cell dies with its supervisor, even in a hung kernel', { timeout: 60000 }, async t => {
  const { job, directory } = await fixture(t);
  const script = join(directory, 'supervisor.mjs');
  writeFileSync(script, `
import { IsolatePool } from ${JSON.stringify(new URL('../isolate-pool.mjs', import.meta.url).href)};
const pool = new IsolatePool({ hostPort: ${JSON.stringify(hostPort)}, isolation: 'process', size: 1, hostCalls: () => ({}), cgroupRoot: '/tmp/absent-ef-cgroup' });
await pool.ready();
process.stdout.write('ready\\n');
pool.run(JSON.parse(process.argv[2])).catch(() => {});
`);
  const child = spawn(process.execPath, [script, JSON.stringify(job(['hang']))], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(resolve => child.stdout.once('data', resolve));
  await sleep(500);
  const cells = () => execFileSync('ps', ['-o', 'pid=', '--ppid', String(child.pid)], { encoding: 'utf8' }).trim();
  const list = () => { try { return cells(); } catch { return ''; } };
  const pids = list().split(/\s+/).filter(Boolean).filter(pid => /isolate-workcell/.test(execFileSync('ps', ['-o', 'args=', '-p', pid], { encoding: 'utf8' })));
  assert.equal(pids.length, 1);
  child.kill('SIGKILL');
  const alive = pid => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
  const deadline = Date.now() + 5000;
  while (alive(pids[0]) && Date.now() < deadline) await sleep(50);
  assert.equal(alive(pids[0]), false);
});
