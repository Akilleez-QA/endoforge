import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ledger } from '../x1/ledger.mjs';
import { python } from './fixtures/ledger-fixture.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const repository = here('../../../');
const driver = here('./fixtures/x1/loop-driver.mjs');
const crashSite = here('./fixtures/x1/crash_site');
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-loop-crash-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const launch = (options, env = {}, extra = [], script = driver) => new Promise(resolve => {
  const child = spawn(process.execPath, [script, JSON.stringify(options), ...extra], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.once('close', (code, signal) => resolve({ code, signal, output: output.trim(), result: output.trim() ? JSON.parse(output.trim().split('\n').pop()) : null }));
});
const state = directory => python(`
import json, sys
from pathlib import Path
from core.ledger.ledger import Ledger
r = json.load(sys.stdin)
path = Path(r['directory']) / 'ledger.sqlite'
records = Ledger(path).records() if path.exists() else []
print(json.dumps(dict(ids=[x['kind'] for x in records], evaluator=next((x['id'] for x in records if x['kind'] == 'frozen_evaluator'), None),
    outcome=next((x['data']['outcome_state'] for x in records if x['kind'] == 'receipt'), None))))
`, { directory });
const decision = directory => existsSync(join(directory, 'promotion.json')) ? JSON.parse(readFileSync(join(directory, 'promotion.json'))).decision : null;
const before = ['task', 'admitted_input', 'frozen_evaluator'];
const verifyRerun = async (root, directory, evaluator, isolation) => {
  const again = await launch({ root, action: 'resume', directory, isolation }, {}, [evaluator]);
  assert.equal(again.code, 0);
  assert.equal(again.result.promoted, true, JSON.stringify(again.result));
};

for (const isolation of ['thread', 'process']) {
  for (const stage of ['compile:read', 'gates:start', 'verdict']) {
    test(`${isolation}: SIGKILL in the cell at ${stage} never promotes`, { timeout: 60000 }, async t => {
      const root = scratch(t), directory = join(root, 'addition');
      const run = await launch({ root, directory, isolation }, { EF_KILL_STAGE: stage });
      const seen = await state(directory);
      if (isolation === 'thread') {
        assert.equal(run.signal, 'SIGKILL');
        assert.equal(run.result, null);
        assert.deepEqual(seen.ids, before);
        assert.equal(decision(directory), null);
        await verifyRerun(root, directory, seen.evaluator, isolation);
      } else {
        assert.equal(run.code, 0);
        assert.equal(run.result.promoted, false);
        assert.deepEqual(seen.ids, [...before, 'candidate', 'receipt']);
        assert.equal(seen.outcome, 'inconclusive');
        assert.equal(decision(directory), 'refuse');
      }
    });
  }
}

for (const stage of ['generated', 'committing']) {
  test(`SIGKILL of the supervisor at ${stage} loses only the attempt`, { timeout: 60000 }, async t => {
    const root = scratch(t), directory = join(root, 'addition');
    const run = await launch({ root, directory, kill: stage });
    assert.equal(run.signal, 'SIGKILL');
    const seen = await state(directory);
    assert.deepEqual(seen.ids, before);
    assert.equal(decision(directory), null);
    await verifyRerun(root, directory, seen.evaluator, 'thread');
  });
}

test('SIGKILL of the supervisor just after the commit request stays consistent and returns nothing', { timeout: 60000 }, async t => {
  const root = scratch(t), directory = join(root, 'addition');
  const run = await launch({ root, directory, kill: 'committing+sent' });
  assert.equal(run.signal, 'SIGKILL');
  assert.equal(run.result, null);
  await new Promise(resolve => setTimeout(resolve, 500));
  const seen = await state(directory);
  if (seen.ids.includes('candidate')) {
    assert.deepEqual(seen.ids, [...before, 'candidate', 'receipt']);
    assert.equal(seen.outcome, 'passed');
  } else assert.deepEqual(seen.ids, before);
});

const bridgeEnv = point => ({ PYTHONPATH: `${crashSite}:${repository}`, EF_BRIDGE_KILL: point });
for (const point of ['commit_start', 'after_register', 'after_receipt', 'before_commit']) {
  test(`SIGKILL of the bridge at ${point} leaves nothing of the attempt and the task can run again`, { timeout: 60000 }, async t => {
    const root = scratch(t), directory = join(root, 'addition');
    const run = await launch({ root, directory }, bridgeEnv(point));
    assert.equal(run.code, 0);
    assert.equal(run.result.promoted, false);
    assert.equal(run.result.error, 'pipeline stage failed; inspect local artifacts');
    const seen = await state(directory);
    assert.deepEqual(seen.ids, before);
    assert.equal(decision(directory), null);
    await verifyRerun(root, directory, seen.evaluator, 'thread');
  });
}

for (const point of ['after_commit', 'after_decision']) {
  test(`SIGKILL of the bridge at ${point} returns no promotion over complete durable records`, { timeout: 60000 }, async t => {
    const root = scratch(t), directory = join(root, 'addition');
    const run = await launch({ root, directory }, bridgeEnv(point));
    assert.equal(run.code, 0);
    assert.equal(run.result.promoted, false);
    const seen = await state(directory);
    assert.deepEqual(seen.ids, [...before, 'candidate', 'receipt']);
    assert.equal(seen.outcome, 'passed');
    assert.equal(decision(directory), point === 'after_decision' ? 'promote' : null);
  });
}

test('an implementation file changed after admission is refused at commit', { timeout: 60000 }, async t => {
  const root = scratch(t), copy = join(root, 'copy');
  for (const part of ['core', 'tools/factory_quality', 'experiments/assemblyscript-toolchain.mjs']) cpSync(join(repository, part), join(copy, part), { recursive: true });
  mkdirSync(join(copy, 'tools/asc'), { recursive: true });
  cpSync(join(repository, 'tools/asc/pin.mjs'), join(copy, 'tools/asc/pin.mjs'));
  symlinkSync(join(repository, 'tools/asc/node_modules'), join(copy, 'tools/asc/node_modules'));
  const directory = join(root, 'addition');
  const run = await launch({ root, directory, editFile: join(copy, 'core/runtime/x1/gates.mjs') }, {}, [],
    join(copy, 'core/runtime/test/fixtures/x1/loop-driver.mjs'));
  assert.equal(run.code, 0);
  assert.equal(run.result.promoted, false);
  assert.equal(run.result.problem, 'frozen_drift');
  assert.equal(decision(directory), 'refuse');
});

test('bridge and supervisor kills at random times never yield a promotion without its evidence', { timeout: 240000 }, async t => {
  const root = scratch(t);
  const promotedLines = [];
  for (let round = 0; round < 8; round++) {
    const directory = join(root, `round-${round}`), log = join(root, `round-${round}.jsonl`);
    mkdirSync(directory);
    const child = spawn(process.execPath, [driver, JSON.stringify({ root, directory, count: 40, log })], { stdio: 'ignore' });
    await new Promise(resolve => {
      const poll = setInterval(() => { if (existsSync(log)) { clearInterval(poll); resolve(); } }, 20);
      child.once('close', () => { clearInterval(poll); resolve(); });
    });
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1500));
    const target = round % 2 ? child.pid : await new Promise(resolve => execFile('pgrep', ['-P', String(child.pid), 'python3'], (_, stdout) => resolve(Number(String(stdout).trim().split('\n')[0]))));
    if (target) try { process.kill(target, 'SIGKILL'); } catch { }
    await new Promise(resolve => { if (child.exitCode !== null || child.signalCode) resolve(); else child.once('close', resolve); });
    if (existsSync(log)) for (const line of readFileSync(log, 'utf8').split('\n').filter(Boolean)) promotedLines.push(JSON.parse(line));
    for (const name of readdirSync(directory)) {
      const seen = await state(join(directory, name));
      assert(['', 'task,admitted_input,frozen_evaluator', 'task,admitted_input,frozen_evaluator,candidate,receipt'].includes(seen.ids.join(',')), seen.ids.join(','));
      if (decision(join(directory, name)) === 'promote') assert.equal(seen.outcome, 'passed');
    }
  }
  assert(promotedLines.length > 0);
  for (const line of promotedLines.filter(row => row.promoted)) {
    const seen = await state(line.target);
    assert.equal(seen.outcome, 'passed', line.target);
    assert.equal(decision(line.target), 'promote', line.target);
    const replay = await ledger('promote', { reference: { ledger: join(line.target, 'ledger.sqlite'), identity: seen.evaluator }, candidate: line.candidate, receipt: line.receipt,
      decisionPath: join(dirname(line.target), `${line.target.split('/').pop()}-replay.json`) });
    assert.equal(replay.decision, 'promote', line.target);
  }
});

const agentDecision = directory => python(`
import json, sqlite3, sys
from pathlib import Path
path = Path(json.load(sys.stdin)['directory']) / 'ledger.sqlite'
db = sqlite3.connect(path) if path.exists() else None
try:
    row = db.execute('SELECT body FROM x1_decisions').fetchone() if db else None
except sqlite3.OperationalError:
    row = None
print(json.dumps(json.loads(row[0])['decision'] if row else None))
`, { directory });
const agentNoRecords = async directory => { assert.deepEqual((await state(directory)).ids, []); assert.equal(await agentDecision(directory), null); };
for (const isolation of ['thread', 'process']) {
  for (const stage of ['model:wait', 'admitted', 'compile:read', 'gates:start', 'verdict']) {
    test(`agent, ${isolation}: SIGKILL in the cell at ${stage} never promotes`, { timeout: 60000 }, async t => {
      const root = scratch(t), directory = join(root, 'addition');
      const run = await launch({ root, directory, isolation, agent: true }, { EF_KILL_STAGE: stage });
      assert(run.signal === 'SIGKILL' || run.result?.promoted === false);
      const seen = await state(directory);
      if (stage === 'model:wait') await agentNoRecords(directory);
      else if (isolation === 'thread') { assert.deepEqual(seen.ids, before); assert.equal(await agentDecision(directory), null); }
      else { assert.deepEqual(seen.ids, [...before, 'candidate', 'receipt']); assert.equal(seen.outcome, 'inconclusive'); assert.equal(await agentDecision(directory), 'refuse'); }
    });
  }
}
for (const stage of ['model', 'admitting', 'admitted', 'committing']) {
  test(`agent: SIGKILL of the supervisor at ${stage} loses only the attempt, and the task resumes from the ledger`, { timeout: 60000 }, async t => {
    const root = scratch(t), directory = join(root, 'addition');
    const run = await launch({ root, directory, agent: true, kill: stage });
    assert.equal(run.signal, 'SIGKILL');
    const seen = await state(directory);
    assert(!seen.ids.includes('candidate'));
    assert.equal(await agentDecision(directory), null);
    if (seen.ids.length) {
      assert.deepEqual(seen.ids, before);
      const again = await launch({ root, directory, agent: true, resume: true });
      assert.equal(again.result.promoted, true, JSON.stringify(again.result));
    }
  });
}
for (const point of ['admit_start', 'admit_before_commit', 'commit_start', 'after_register', 'after_receipt', 'before_commit']) {
  test(`agent: SIGKILL of the bridge at ${point} leaves nothing of the attempt`, { timeout: 60000 }, async t => {
    const root = scratch(t), directory = join(root, 'addition');
    const run = await launch({ root, directory, agent: true }, bridgeEnv(point));
    assert.equal(run.result.promoted, false);
    const seen = await state(directory);
    assert.deepEqual(seen.ids, point.startsWith('admit') ? [] : before);
    assert.equal(await agentDecision(directory), null);
  });
}
for (const point of ['after_db_commit']) {
  test(`agent: SIGKILL of the bridge at ${point} returns no promotion over complete records`, { timeout: 60000 }, async t => {
    const root = scratch(t), directory = join(root, 'addition');
    const run = await launch({ root, directory, agent: true }, bridgeEnv(point));
    assert.equal(run.result.promoted, false);
    const seen = await state(directory);
    assert.deepEqual(seen.ids, [...before, 'candidate', 'receipt']);
    assert.equal(seen.outcome, 'passed');
    assert.equal(await agentDecision(directory), 'promote');
  });
}
