import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import * as poolModule from '../isolate-pool.mjs';
import { IsolatePool } from '../isolate-pool.mjs';
import { createCompatibilityPool, probeInWorkcell } from '../../../tools/compatibility/workcell.mjs';

const directory = mkdtempSync(join(tmpdir(), 'gaps6-hostcall-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));
const hostPort = join(directory, 'sync-port.mjs');
writeFileSync(hostPort, `
import * as pool from ${JSON.stringify(new URL('../isolate-pool.mjs', import.meta.url).href)};
export async function createPort(options) {
  return {
    evaluate() {
      const out = [];
      let call;
      try { call = pool.connectSyncHostCall(options.syncHostCall); }
      catch (error) { return { stage: 'completed', connect: error.message, keys: Object.keys(options) }; }
      const requests = options.flood ? Array.from({ length: options.flood }, (_, index) => ({ index })) : options.requests;
      for (const request of requests) {
        try { out.push({ value: call(request) }); } catch (error) { out.push({ error: error.message }); }
      }
      return { stage: 'completed', out, keys: Object.keys(options) };
    },
  };
}
`);
const job = (portOptions, over = {}) => ({ candidates: ['sync'], ledger: 'caller', portOptions, ...over });
const open = (t, options) => {
  const pool = new IsolatePool({ hostPort, size: 1, ...options });
  t.after(() => pool.close());
  return pool;
};

test('IsolatePool exports a synchronous host-call connector and validates the handler', () => {
  assert.equal(typeof poolModule.connectSyncHostCall, 'function');
  assert.throws(() => new IsolatePool({ hostPort, syncHostCalls: 'not a function' }), /syncHostCalls must be a function/);
  assert.throws(() => poolModule.connectSyncHostCall(undefined), /synchronous host call channel/);
});

for (const isolation of ['thread', 'process']) {
  test(`${isolation}: a cell calls the host synchronously and gets each reply before its next statement`, { timeout: 60000 }, async t => {
    const seen = [];
    const buffer = Uint8Array.of(10, 20, 30, 40);
    const pool = open(t, { isolation, syncHostCalls: async (request, context) => {
      seen.push({ request, context });
      if (request.op === 'slow') await sleep(50);
      if (request.op === 'fail') throw new Error('planted host failure');
      return { op: request.op, bytes: context.data.hostBuffer.slice(request.offset, request.offset + request.length), big: 7n };
    } });
    const requests = [{ op: 'read', offset: 1, length: 2 }, { op: 'slow', offset: 0, length: 4 }, { op: 'fail' }, { op: 'read', offset: 3, length: 1 }];
    const result = await pool.run(job({ requests }, { hostBuffer: buffer }));
    assert.equal(result.status, 'completed', result.reason);
    const { out, keys } = result.report;
    assert.deepEqual(keys.sort(), ['requests', 'syncHostCall']);
    assert.deepEqual([...out[0].value.bytes], [20, 30]);
    assert.ok(out[0].value.bytes instanceof Uint8Array);
    assert.equal(out[0].value.big, 7n);
    assert.deepEqual([...out[1].value.bytes], [10, 20, 30, 40]);
    assert.deepEqual(out[2], { error: 'planted host failure' });
    assert.deepEqual([...out[3].value.bytes], [40]);
    assert.deepEqual(seen.map(entry => entry.request.op), ['read', 'slow', 'fail', 'read']);
    assert.equal(seen[0].context.workcell, result.workcell);
    assert.deepEqual(seen[0].context.candidates, ['sync']);
  });

  test(`${isolation}: replies larger than the initial channel and repeated jobs on one cell`, { timeout: 60000 }, async t => {
    const pool = open(t, { isolation, syncHostCalls: request => new Uint8Array(request.size).fill(request.fill) });
    const cells = new Set();
    for (const fill of [1, 2, 3]) {
      const result = await pool.run(job({ requests: [{ size: 2 * 1048576, fill }, { size: 3, fill }] }));
      assert.equal(result.status, 'completed', result.reason);
      const [large, small] = result.report.out;
      assert.equal(large.value.length, 2 * 1048576);
      assert.ok(large.value.every(byte => byte === fill));
      assert.deepEqual([...small.value], [fill, fill, fill]);
      cells.add(result.workcell);
    }
    assert.equal(cells.size, 1);
  });

  test(`${isolation}: synchronous host calls are bounded per job`, { timeout: 60000 }, async t => {
    let served = 0;
    const pool = open(t, { isolation, syncHostCalls: () => ++served });
    const result = await pool.run(job({ flood: 4100 }));
    assert.equal(result.status, 'completed', result.reason);
    const { out } = result.report;
    assert.equal(out.filter(entry => entry.error === 'host-call-limit').length, 4);
    assert.equal(served, 4096);
  });
}

test('without syncHostCalls no channel reaches the port', { timeout: 60000 }, async t => {
  const pool = open(t, {});
  const result = await pool.run(job({ requests: [] }));
  assert.match(result.report.connect, /synchronous host call channel/);
  assert.deepEqual(result.report.keys, ['requests']);
});

test('the job timeout pauses while the host answers, and the total deadline still stops a hung handler', { timeout: 60000 }, async t => {
  const slow = open(t, { isolation: 'process', jobTimeoutMs: 1500, syncHostCalls: async () => { await sleep(2500); return 'late'; } });
  const answered = await slow.run(job({ requests: [{}] }));
  assert.equal(answered.status, 'completed', answered.reason);
  assert.deepEqual(answered.report.out, [{ value: 'late' }]);
  const hung = open(t, { isolation: 'thread', jobDeadlineMs: 1000, syncHostCalls: () => new Promise(() => {}) });
  const stopped = await hung.run(job({ requests: [{}] }));
  assert.equal(stopped.status, 'outcome_unknown');
  assert.equal(stopped.reason, 'deadline');
});

test('the compatibility workcell reads snapshots through host-buffer calls, not copies sent with the job', { timeout: 60000 }, async t => {
  const pool = createCompatibilityPool();
  t.after(() => pool.close());
  const meta = { contractVersion: '1.0.0', stateSchema: 'counter-v1', eventSchema: 'increment-v1', effectSchema: 'notify-v1' };
  const source = `export const reducer = { describe: () => (${JSON.stringify(meta)}),
    reduce(state, event, inputs) {
      const [buffer] = inputs;
      const tail = buffer.read(buffer.size() - 1n, 1);
      return { state: Uint8Array.of(Number(buffer.size()), tail.value[0]), effects: [] };
    } };`;
  const snapshot = new Uint8Array(1000).map((_, index) => index % 251);
  const receipt = await probeInWorkcell(pool, { reducer: { source, exportName: 'reducer' }, expected: meta,
    state: Uint8Array.of(1), event: Uint8Array.of(2), snapshots: [snapshot], limits: { inputBytes: 4096, readBytes: 8, outputBytes: 64, effects: 2 } });
  assert.equal(receipt.status, 'passed', receipt.reason);
  assert.deepEqual([...receipt.transition.state], [1000 % 256, 999 % 251]);
  assert.deepEqual(receipt.hostBuffers, { calls: 2, bytesRead: 1 });
});
