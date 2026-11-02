import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { IsolatePool } from '../isolate-pool.mjs';
import { LedgerBridge } from '../isolate-ledger.mjs';
import { evaluateCandidates } from '../../engine/evaluator.mjs';
import { createPort } from './fixtures/identity-port.mjs';
import { fixture, hostPort, python } from './fixtures/ledger-fixture.mjs';

test('native evaluator parity, rejection evidence, and a shared tamper-evident ledger', { timeout: 60000 }, async t => {
  const { reference, job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 4 });
  t.after(() => pool.close());
  const candidates = ['pass', 'dominated', 'interface', 'effects', 'invariant'];
  const expected = await evaluateCandidates(reference, candidates, await createPort());
  assert.deepEqual(expected.frontier, ['pass']);
  assert.deepEqual(expected.attempts.slice(2, 5).map(a => a.firstFailure), ['interface', 'forbidden_effects', 'invariant:identity']);
  const jobs = Array.from({ length: 8 }, () => pool.run(job(candidates)));
  const results = await Promise.all(jobs);
  for (const result of results) {
    assert.deepEqual(result.report, expected);
    assert.equal(result.receipts.length, candidates.length);
    assert.deepEqual(result.receipts.map(r => r.record.data.outcome_state), ['passed', 'passed', 'failed', 'failed', 'failed']);
  }
  assert(new Set(results.map(r => r.workcell)).size > 1);
  const verified = await python(`
import json, sqlite3, sys
from core.ledger.ledger import Ledger
r = json.load(sys.stdin)
rows = Ledger(r['ledger']).records()
receipts = [row for row in rows if row['kind'] == 'receipt']
with sqlite3.connect(r['ledger']) as db:
    hashes = dict(db.execute('SELECT id, hash FROM records'))
    if any(hashes[item['record']['id']] != item['hash'] for item in r['receipts']):
        raise ValueError('returned digest differs')
    db.execute('DROP TRIGGER no_update')
    db.execute("UPDATE records SET body=replace(body, 'synthetic request holds', 'tampered') WHERE id=?", (receipts[-1]['id'],))
try:
    Ledger(r['ledger']).records()
except ValueError as error:
    print(json.dumps(dict(count=len(receipts), detected=str(error))))
else:
    raise ValueError('tampering was accepted')
`, { ledger: reference.ledger, receipts: results.flatMap(r => r.receipts) });
  assert.equal(verified.count, 40);
  assert.match(verified.detected, /chain failed/);
  await assert.rejects(pool.run(job()), /chain failed/);
});

for (const size of [1, 4, 16]) {
  test(`concurrency ${size}: identical reports, FIFO queue and bounded workcells`, { timeout: 90000 }, async t => {
    const { reference, job, directory } = await fixture(t);
    const barrier = join(directory, 'barrier');
    mkdirSync(barrier);
    const pool = new IsolatePool({ hostPort, size });
    t.after(() => pool.close());
    const expected = await evaluateCandidates(reference, ['pass', 'effects'], await createPort());
    let peakBusy = 0, peakWorkers = 0, queued = false;
    const interval = setInterval(() => {
      const stats = pool.stats;
      peakBusy = Math.max(peakBusy, stats.busy);
      peakWorkers = Math.max(peakWorkers, stats.workers);
      queued ||= stats.queued > 0;
    }, 5);
    t.after(() => clearInterval(interval));
    const jobs = Array.from({ length: size * 2 }, (_, i) =>
      pool.run(job(['pass', 'effects'], i < size ? { barrier, participants: size } : {})));
    const closing = pool.close();
    await assert.rejects(pool.run(job()), /closing/);
    const results = await Promise.all(jobs);
    for (const result of results) assert.deepEqual(result.report, expected);
    assert.equal(new Set(results.map(r => r.workcell)).size, size);
    assert.equal(peakBusy, size);
    assert.equal(peakWorkers, size);
    assert(queued);
    await closing;
    assert.deepEqual(pool.stats, { size, workers: 0, busy: 0, queued: 0 });
    assert.equal(pool.close(), closing);
  });
}

for (const [candidate, reason] of [['heap', 'limit'], ['exit', 'worker_exit']]) {
  test(`${candidate}: only the failed workcell exits, replacement serves queued work`, { timeout: 60000 }, async t => {
    const { job, directory } = await fixture(t);
    const resourceLimits = { maxOldGenerationSizeMb: 24, maxYoungGenerationSizeMb: 4 };
    const pool = new IsolatePool({ hostPort, size: 2, resourceLimits });
    t.after(() => pool.close());
    const release = join(directory, 'release');
    const failedJob = pool.run(job([candidate]));
    const survivorJob = pool.run(job(['pass'], { release }));
    const replacementJob = pool.run(job());
    const failed = await failedJob;
    writeFileSync(release, 'go');
    const [survivor, replacement] = await Promise.all([survivorJob, replacementJob]);
    assert.equal(failed.status, 'outcome_unknown');
    assert.equal(failed.reason, reason);
    if (candidate === 'heap') assert.equal(failed.error, 'ERR_WORKER_OUT_OF_MEMORY');
    assert.equal(failed.report, null);
    assert.equal(failed.receipts[0].record.data.delivery_state, 'outcome_unknown');
    assert.equal(failed.receipts[0].record.data.outcome_state, 'inconclusive');
    for (const result of [survivor, replacement]) {
      assert.equal(result.status, 'completed');
      assert.deepEqual(result.report.frontier, ['pass']);
      assert.equal(result.resourceLimits.maxOldGenerationSizeMb, 24);
      assert.equal(result.resourceLimits.maxYoungGenerationSizeMb, 4);
    }
    assert.notEqual(failed.workcell, survivor.workcell);
    assert.notEqual(failed.workcell, replacement.workcell);
    assert.notEqual(survivor.workcell, replacement.workcell);
    assert.equal(pool.stats.workers, 2);
  });
}

test('validation, frozen drift and host errors fail closed; defaults are lazy', async t => {
  assert.throws(() => new IsolatePool({ hostPort, size: 0 }), /size/);
  assert.throws(() => new IsolatePool({ hostPort, resourceLimits: { maxOldGenerationSizeMb: 0 } }), /limits/);
  process.execArgv.push('--max-old-space-size=32');
  try { assert.throws(() => new IsolatePool({ hostPort }), /overrides/); }
  finally { process.execArgv.pop(); }
  const defaults = new IsolatePool({ hostPort });
  assert.equal(defaults.stats.size, availableParallelism());
  assert.equal(defaults.stats.workers, 0);
  await defaults.close();
  const { reference, job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1 });
  t.after(() => pool.close());
  const bad = job();
  bad.receipts[0].data.precommit.oracle_version = 'wrong';
  await assert.rejects(pool.run(bad), /digest/);
  const unknown = await pool.run(job(['throw']));
  assert.equal(unknown.status, 'outcome_unknown');
  assert.equal(unknown.report.attempts[0].firstFailure, 'interface');
  writeFileSync(join(reference.root, 'residual.txt'), 'changed');
  const drift = await pool.run(job());
  assert.equal(drift.status, 'outcome_unknown');
  assert.match(drift.reason, /frozen/);
  assert.equal(drift.receipts[0].record.data.outcome_state, 'inconclusive');
});

const wasmPort = fileURLToPath(new URL('./fixtures/wasm-port.mjs', import.meta.url));
const wasmUint = value => {
  const bytes = [];
  do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
  return bytes;
};
const wasmSection = (id, bytes) => [id, ...wasmUint(bytes.length), ...bytes];
const wasmMemory = ({ initial = 1, maximum, imported = false, start = false, exportMemory = true } = {}) => {
  const memory = maximum === undefined ? [0, ...wasmUint(initial)] : [1, ...wasmUint(initial), ...wasmUint(maximum)];
  return [0, 97, 115, 109, 1, 0, 0, 0,
    ...wasmSection(1, start ? [1, 0x60, 0, 0] : [1, 0x60, 1, 0x7f, 1, 0x7f]),
    ...(imported ? wasmSection(2, [1, 3, 101, 110, 118, 6, 109, 101, 109, 111, 114, 121, 2, ...memory]) : []),
    ...wasmSection(3, [1, 0]),
    ...(imported ? [] : wasmSection(5, [1, ...memory])),
    ...wasmSection(7, start ? [1, 6, 109, 101, 109, 111, 114, 121, 2, 0] :
      [exportMemory ? 2 : 1, ...(exportMemory ? [6, 109, 101, 109, 111, 114, 121, 2, 0] : []), 4, 103, 114, 111, 119, 0, 0]),
    ...(start ? wasmSection(8, [0]) : []),
    ...wasmSection(10, start ? [1, 7, 0, 0x41, 17, 0x40, 0, 0x1a, 0x0b] : [1, 6, 0, 0x20, 0, 0x40, 0, 0x0b])];
};

test('WASM configuration refuses invalid caps', () => {
  for (const wasmMemoryMaxMb of [0, -1, 1.5, NaN, Infinity, 4097, '64']) {
    assert.throws(() => new IsolatePool({ hostPort, wasmMemoryMaxMb }), /wasmMemoryMaxMb/);
  }
});

test('heap breach while a neighbor is mid-job preserves accepted and rejected verdicts', { timeout: 30000 }, async t => {
  const { reference, job, directory } = await fixture(t);
  const barrier = join(directory, 'heap-barrier'), release = join(directory, 'heap-release');
  mkdirSync(barrier);
  const pool = new IsolatePool({ hostPort, size: 2,
    resourceLimits: { maxOldGenerationSizeMb: 24, maxYoungGenerationSizeMb: 4 } });
  t.after(() => pool.close());
  const expected = await evaluateCandidates(reference, ['pass', 'effects'], await createPort());
  const failedJob = pool.run(job(['heap'], { barrier, participants: 2 }));
  const survivorJob = pool.run(job(['pass', 'effects'], { barrier, participants: 2, release }));
  const replacementJob = pool.run(job(['pass', 'effects']));
  const failed = await failedJob;
  writeFileSync(release, 'go');
  const [survivor, replacement] = await Promise.all([survivorJob, replacementJob]);
  assert.equal(failed.reason, 'limit');
  assert.equal(failed.error, 'ERR_WORKER_OUT_OF_MEMORY');
  assert.equal(failed.receipts[0].record.data.outcome_state, 'inconclusive');
  for (const result of [survivor, replacement]) {
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.report, expected);
    assert.deepEqual(result.receipts.map(r => r.record.data.outcome_state), ['passed', 'failed']);
  }
  assert.notEqual(failed.workcell, survivor.workcell);
  assert.notEqual(failed.workcell, replacement.workcell);
  assert.notEqual(survivor.workcell, replacement.workcell);
});

test('WASM declarations and growth terminate only the breacher, including swallowed internal traps', { timeout: 180000 }, async t => {
  const { reference, job, directory } = await fixture(t);
  const pool = new IsolatePool({ hostPort: wasmPort, size: 2, wasmMemoryMaxMb: 1 });
  t.after(() => pool.close());
  const expected = await evaluateCandidates(reference, ['pass', 'effects'], await createPort());
  const cases = [
    { action: 'initial' }, { action: 'maximum' }, { action: 'grow' }, { action: 'grow-coercion' }, { action: 'shared-grow' },
    ...['compile', 'module', 'module-constructor', 'instantiate', 'instance', 'instantiate-module', 'compile-streaming', 'instantiate-streaming']
      .map(action => ({ action, bytes: wasmMemory({ maximum: 17 }) })),
    { action: 'instantiate', bytes: wasmMemory({ initial: 17, maximum: 17 }) },
    { action: 'compile', bytes: wasmMemory() },
    { action: 'instantiate', bytes: wasmMemory({ imported: true }), imports: true },
    { action: 'instantiate', bytes: wasmMemory({ maximum: 16 }), exportGrow: true },
    { action: 'instantiate', bytes: wasmMemory({ maximum: 16 }), swallow: true },
    { action: 'instance', bytes: wasmMemory({ maximum: 16 }) },
    { action: 'instance', bytes: wasmMemory({ maximum: 16, exportMemory: false }) },
    { action: 'instantiate-module', bytes: wasmMemory({ maximum: 16, imported: true }), imports: true },
    { action: 'instantiate', bytes: wasmMemory({ maximum: 16, start: true }) },
  ];
  for (const [index, options] of cases.entries()) {
    await t.test(`${index}: ${options.action}`, async () => {
      const release = join(directory, `wasm-release-${index}`);
      const barrier = join(directory, `wasm-barrier-${index}`);
      mkdirSync(barrier);
      const failedJob = pool.run(job(['pass'], { ...options, barrier, participants: 2 }));
      const survivorJob = pool.run(job(['pass', 'effects'], { barrier, participants: 2, release, action: 'instance', bytes: wasmMemory({ maximum: 16 }), pages: 1, checkMemory: 2 }));
      const replacementJob = pool.run(job(['pass', 'effects'], { action: 'instance', bytes: wasmMemory({ maximum: 16 }), pages: 1 }));
      const failed = await failedJob;
      writeFileSync(release, 'go');
      const [survivor, replacement] = await Promise.all([survivorJob, replacementJob]);
      assert.equal(failed.status, 'outcome_unknown');
      assert.equal(failed.reason, 'limit');
      assert.equal(failed.error, 'ERR_WORKCELL_WASM_MEMORY_LIMIT');
      assert.equal(failed.report, null);
      assert.equal(failed.wasmMemoryMaxMb, 1);
      assert.equal(failed.receipts[0].record.data.outcome_state, 'inconclusive');
      assert.equal(failed.receipts[0].record.data.observations[0].wasmMemoryMaxMb, 1);
      for (const result of [survivor, replacement]) {
        assert.equal(result.status, 'completed');
        assert.deepEqual(result.report, expected);
        assert.equal(result.wasmMemoryMaxMb, 1);
      }
      assert.notEqual(failed.workcell, survivor.workcell);
      assert.notEqual(failed.workcell, replacement.workcell);
      assert.notEqual(survivor.workcell, replacement.workcell);
      assert.equal(pool.stats.workers, 2);
    });
  }
});

test('WASM default cap rejects omitted maxima; explicit smaller maxima preserve bounded execution', { timeout: 30000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort: wasmPort, size: 1 });
  t.after(() => pool.close());
  const bounded = await pool.run(job(['pass'], { action: 'instantiate', bytes: wasmMemory(), pages: 1023, checkMemory: 1024 }));
  assert.equal(bounded.status, 'outcome_unknown');
  assert.equal(bounded.wasmMemoryMaxMb, 64);
  const explicit = await pool.run(job(['pass'], { action: 'instantiate', bytes: wasmMemory({ maximum: 1024 }), pages: 1023, checkMemory: 1024 }));
  assert.equal(explicit.status, 'completed');
  const smaller = await pool.run(job(['pass'], { action: 'instance', bytes: wasmMemory({ maximum: 2 }), pages: 2, expectedOldPages: -1, checkMemory: 1 }));
  assert.equal(smaller.status, 'completed');
  assert.notEqual(smaller.workcell, bounded.workcell);
});

test('WASM cap encoding handles signed LEB boundaries', { timeout: 30000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort: wasmPort, size: 1, wasmMemoryMaxMb: 4 });
  t.after(() => pool.close());
  const result = await pool.run(job(['pass'], { action: 'instantiate', bytes: wasmMemory({ maximum: 64 }), pages: 63, checkMemory: 64 }));
  assert.equal(result.status, 'completed');
  const breached = await pool.run(job(['pass'], { action: 'instance', bytes: wasmMemory({ maximum: 64 }), pages: 64 }));
  assert.equal(breached.reason, 'limit');
  assert.equal(breached.error, 'ERR_WORKCELL_WASM_MEMORY_LIMIT');
});

test('WASM guard refuses unsupported, malformed and externally compiled modules without unchecked fallback', { timeout: 30000 }, async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort: wasmPort, size: 1, wasmMemoryMaxMb: 1 });
  t.after(() => pool.close());
  const header = [0, 97, 115, 109, 1, 0, 0, 0];
  const simd = [...header, ...wasmSection(1, [1, 0x60, 0, 0]), ...wasmSection(3, [1, 0]),
    ...wasmSection(5, [1, 1, 1, 16]),
    ...wasmSection(10, [1, 21, 0, 0xfd, 0x0c, ...Array(16).fill(0), 0x1a, 0x0b])];
  assert.equal(WebAssembly.validate(Uint8Array.from(simd)), true);
  const module = await WebAssembly.compile(Uint8Array.from(wasmMemory({ maximum: 16 })));
  for (const options of [
    { action: 'module', bytes: simd }, { action: 'compile', bytes: header.slice(0, 4) },
    { action: 'foreign-module', module }, { action: 'foreign-instantiate', module },
  ]) {
    const result = await pool.run(job(['pass'], options));
    assert.equal(result.status, 'outcome_unknown');
    assert.equal(result.report.attempts[0].firstFailure, 'interface');
    assert.equal(result.receipts[0].record.data.outcome_state, 'inconclusive');
  }
  for (const bytes of [header, [...header, ...wasmSection(5, [1, 1, 1, 16])]]) {
    const result = await pool.run(job(['pass'], { action: 'instantiate', bytes }));
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.report.frontier, ['pass']);
  }
});

test('64 concurrent jobs at width 16 remain verifiable by a fresh Ledger', { timeout: 60000 }, async t => {
  const { reference, job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 16 });
  t.after(() => pool.close());
  const results = await Promise.all(Array.from({ length: 64 }, () => pool.run(job())));
  assert.equal(results.flatMap(result => result.receipts).length, 64);
  const verified = await python(`
import json, sys
from core.ledger.ledger import Ledger
rows = Ledger(json.load(sys.stdin)['ledger']).records()
print(json.dumps(sum(r['kind'] == 'receipt' for r in rows)))
`, { ledger: reference.ledger });
  assert.equal(verified, 64);
});

test('a second writer between batches extends the verified chain', async t => {
  const { reference, job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1 });
  const other = new IsolatePool({ hostPort, size: 1 });
  t.after(() => Promise.all([pool.close(), other.close()]));
  const first = await pool.run(job());
  const external = await other.run(job());
  const last = await pool.run(job());
  const verified = await python(`
import json, sqlite3, sys
from core.ledger.ledger import Ledger
r = json.load(sys.stdin)
Ledger(r['ledger']).records()
with sqlite3.connect(r['ledger']) as db:
    rows = list(db.execute('SELECT previous, hash FROM records ORDER BY seq DESC LIMIT 3'))
print(json.dumps(rows))
`, { ledger: reference.ledger });
  assert.equal(verified[0][1], last.receipts[0].hash);
  assert.equal(verified[0][0], external.receipts[0].hash);
  assert.equal(verified[1][0], first.receipts[0].hash);
});

test('bridge death rejects pending runs and all later requests without respawning', async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1 });
  t.after(() => pool.close());
  const pending = Array.from({ length: 8 }, () => pool.run(job()));
  const settled = Promise.allSettled(pending);
  const children = readFileSync(`/proc/self/task/${process.pid}/children`, 'utf8').trim().split(/\s+/);
  const bridges = children.filter(pid => readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'python3');
  assert.equal(bridges.length, 1);
  process.kill(Number(bridges[0]), 'SIGKILL');
  const results = await settled;
  assert(results.every(result => result.status === 'rejected'));
  for (const result of results) assert.match(result.reason.message, /bridge failed/);
  await assert.rejects(pool.run(job()), /bridge failed/);
});

test('schema-invalid tampering with a recomputed chain invalidates the validation cache', async t => {
  const { reference, job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1 });
  t.after(() => pool.close());
  await pool.run(job());
  await python(`
import json, sqlite3, sys
from core.ledger.ledger import encode, event_hash
with sqlite3.connect(json.load(sys.stdin)['ledger']) as db:
    db.execute('DROP TRIGGER no_update')
    previous = '0' * 64
    for seq, body in list(db.execute('SELECT seq, body FROM records ORDER BY seq')):
        record = json.loads(body)
        if seq == 1:
            record['data']['acceptance'] = 17
        body = encode(record)
        digest = event_hash(seq, previous, body)
        db.execute('UPDATE records SET body=?, previous=?, hash=? WHERE seq=?', (body, previous, digest, seq))
        previous = digest
print('{}')
`, { ledger: reference.ledger });
  await assert.rejects(pool.run(job()), /schema/);
});

test('a failing request leaves neighboring requests in its batch usable', async t => {
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 4 });
  t.after(() => pool.close());
  const bad = job();
  bad.receipts[0].data.precommit.oracle_version = 'wrong';
  const results = await Promise.allSettled([pool.run(job()), pool.run(bad), pool.run(job())]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.match(results[1].reason.message, /digest/);
  assert.equal((await pool.run(job())).receipts.length, 1);
});

test('a request failing after its first insert rolls back its entire savepoint', async t => {
  const { reference, job } = await fixture(t);
  const bridge = new LedgerBridge();
  t.after(() => bridge.close());
  const bad = job(['pass', 'effects']), good = job();
  const results = await Promise.allSettled([
    bridge.request('append', bad, { status: 'completed', report: { attempts: [
      { candidate: 'pass', stage: 'passed' }, { candidate: 'effects' },
    ] } }),
    bridge.request('append', good, { status: 'completed', report: { attempts: [{ candidate: 'pass', stage: 'passed' }] } }),
  ]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled']);
  const receipts = await python(`
import json, sys
from core.ledger.ledger import Ledger
rows = Ledger(json.load(sys.stdin)['ledger']).records()
print(json.dumps([r['id'] for r in rows if r['kind'] == 'receipt']))
`, { ledger: reference.ledger });
  assert.deepEqual(receipts, [good.receipts[0].id]);
});
