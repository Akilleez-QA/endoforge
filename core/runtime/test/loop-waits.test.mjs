import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { createLoopPool } from '../x1/loop.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { scriptedProvider } from '../x1/transports.mjs';
import { candidate } from './fixtures/x1/candidate.mjs';
import { inputFor, modelFor, stageOf } from './fixtures/x1/scripted-model.mjs';
import { good } from './fixtures/x1/seeds.mjs';
import { python } from './fixtures/ledger-fixture.mjs';

const { files } = candidate();
const model = modelFor(inputFor(files['CONTRACT.md'], files['tests.json'], good.kernel, good.glue));
const need = 'integer add(a,b)', env = { ENDOFORGE_LOOP: 'agent' };
const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-waits-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const loopPool = (t, script, options = {}) => {
  const pool = createLoopPool({ primes: 1, provider: scriptedProvider(script), ...options });
  t.after(() => pool.close());
  return pool;
};
const continuations = directory => python(`
import json, sqlite3, sys
db = sqlite3.connect(json.load(sys.stdin)['ledger'])
print(json.dumps([dict(seq=r[0], state=r[1], stage=json.loads(r[2])['cell']['stage']) for r in db.execute('SELECT seq, state, body FROM x1_continuations ORDER BY seq')]))
`, { ledger: join(directory, 'ledger.sqlite') });
const kinds = directory => python(`
import json, sys
from core.ledger.ledger import Ledger
print(json.dumps([r['kind'] for r in Ledger(json.load(sys.stdin)['ledger']).records()]))
`, { ledger: join(directory, 'ledger.sqlite') });

const parkedThenSilent = t => {
  let release, parked;
  const gate = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { parked = resolve; });
  const pool = loopPool(t, async input => {
    if (stageOf(input.messages) === 'implementation') await gate;
    return model(input);
  });
  return { pool, release, reached, observe: stage => { if (stage === 'parked') parked(); } };
};

test('a candidate waiting on its model holds no cell, and a one-cell pool carries two at once', { timeout: 60000 }, async t => {
  const root = scratch(t), busy = [];
  let sending = 0, most = 0, pool;
  pool = loopPool(t, async input => {
    busy.push(pool.stats.busy);
    most = Math.max(most, ++sending);
    await sleep(1500);
    sending -= 1;
    return model(input);
  });
  const results = await Promise.all(['one', 'two'].map(name => runNeed({ need, directory: join(root, name), pool, env })));
  for (const result of results) assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(most, 2);
  assert(busy.includes(0));
  assert.deepEqual(await continuations(join(root, 'one')), [{ seq: 0, state: 'closed', stage: 'implementation' }]);
});

test('hold keeps the cell through the model turn', { timeout: 60000 }, async t => {
  const root = scratch(t), busy = [];
  const pool = loopPool(t, async input => { busy.push(pool.stats.busy); return model(input); }, { waits: 'hold' });
  const result = await runNeed({ need, directory: join(root, 'held'), pool, env });
  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.deepEqual(busy, [1, 1]);
});

test('a supervisor gone during the wait leaves a durable continuation that resumes, and the old attempt cannot commit after it', { timeout: 60000 }, async t => {
  const root = scratch(t), directory = join(root, 'addition'), silent = parkedThenSilent(t);
  const stale = runNeed({ need, directory, pool: silent.pool, env, observe: silent.observe });
  await silent.reached;
  assert.deepEqual(await continuations(directory), [{ seq: 0, state: 'waiting', stage: 'implementation' }]);
  assert.deepEqual(await kinds(directory), ['task', 'admitted_input', 'frozen_evaluator']);
  const seen = [];
  const second = loopPool(t, input => { seen.push(input.messages.length); return model(input); });
  const again = await runNeed({ need, directory, pool: second, env, resume: true });
  assert.equal(again.promoted, true, JSON.stringify(again));
  assert.deepEqual(seen, [3]);
  assert.equal(again.agent.turns, 2);
  silent.release();
  const late = await stale;
  assert.equal(late.promoted, false);
  assert.deepEqual(await continuations(directory), [{ seq: 0, state: 'closed', stage: 'implementation' }]);
  assert.deepEqual((await kinds(directory)).filter(kind => kind === 'receipt').length, 1);
});

test('a changed continuation record stops the resume before any model call', { timeout: 60000 }, async t => {
  const root = scratch(t), directory = join(root, 'addition'), silent = parkedThenSilent(t);
  runNeed({ need, directory, pool: silent.pool, env, observe: silent.observe });
  await silent.reached;
  assert.equal(await python(`
import json, sqlite3, sys
db = sqlite3.connect(json.load(sys.stdin)['ledger'])
db.execute("UPDATE x1_continuations SET body=replace(body, 'implementation', 'implementatioN') WHERE seq=0")
db.commit()
print(db.total_changes)
`, { ledger: join(directory, 'ledger.sqlite') }), 1);
  let calls = 0;
  const second = loopPool(t, input => { calls += 1; return model(input); });
  const changed = await runNeed({ need, directory, pool: second, env, resume: true });
  assert.equal(changed.promoted, false);
  assert.equal(calls, 0);
});

test('a deadline passed during the wait ends the attempt inconclusive with no job after the reply', { timeout: 60000 }, async t => {
  const root = scratch(t), directory = join(root, 'late');
  let atWait = null, pool;
  pool = loopPool(t, async input => {
    if (stageOf(input.messages) === 'implementation') { atWait = pool.busyMs; await sleep(6000); }
    return model(input);
  });
  await pool.ready();
  const expired = await runNeed({ need, directory, pool, env, deadline: Date.now() + 4000 });
  assert.equal(expired.promoted, false);
  assert.equal(expired.status, 'inconclusive');
  assert.notEqual(atWait, null);
  assert.equal(pool.busyMs, atWait);
  assert.deepEqual(await continuations(directory), [{ seq: 0, state: 'closed', stage: 'implementation' }]);
});
