import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
const child = new URL('../isolate-wasm.mjs', import.meta.url).href;
const body = `
const { installWasmLimit } = await import(${JSON.stringify(child)});
const { parentPort, workerData } = await import('node:worker_threads');
const v8 = await import('node:v8'), vm = await import('node:vm');
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
const settled = async () => { await new Promise(setImmediate); gc(); await new Promise(setImmediate); gc(); return process.memoryUsage().heapUsed; };
const leb = n => { const o = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return o; };
const section = (id, bytes) => [id, ...leb(bytes.length), ...bytes];
const bytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, ...section(1, [1, 0x60, 1, 0x7f, 1, 0x7f]), ...section(3, [1, 0]), ...section(5, [1, 1, 1, 8]),
  ...section(7, [2, 4, 103, 114, 111, 119, 0, 0, 1, 109, 2, 0]), ...section(10, [1, 6, 0, 0x20, 0, 0x40, 0, 0x0b])]);
let breached = 0, early = 0;
const check = installWasmLimit(1, () => { breached++; }, [], []);
const module = new WebAssembly.Module(bytes);
const retained = new WebAssembly.Instance(module);
for (let job = 0; job < workerData.jobs; job++) {
  check.begin();
  for (let i = 0; i < 16; i++) new WebAssembly.Instance(module);
  await new Promise(setImmediate);
  if (job === 100) early = await settled();
}
check.begin();
const growthMb = (await settled() - early) / 1048576;
try { retained.exports.grow(100); } catch {}
check();
parentPort.postMessage({ breached, growthMb });
`;
const run = jobs => new Promise((resolve, reject) => {
  const worker = new Worker(`import(${JSON.stringify(`data:text/javascript,${encodeURIComponent(body)}`)}).catch(error => { throw error; });`, { eval: true, workerData: { jobs }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 8 } });
  worker.once('message', resolve);
  worker.once('error', reject);
});
test('flags from finished jobs do not pin instances', { timeout: 120000 }, async () => {
  const { breached, growthMb } = await run(600);
  assert.equal(breached, 1);
  assert(growthMb < 2, `retained heap grew ${growthMb} MiB over 500 jobs`);
});
test('a breach by an instance kept across jobs is still seen', { timeout: 30000 }, async () => {
  assert.equal((await run(1)).breached, 1);
});
test('a cell is replaced after its job allowance, between jobs, and no job is lost', { timeout: 60000 }, async t => {
  const { fixture, hostPort } = await import('./fixtures/ledger-fixture.mjs');
  const { IsolatePool } = await import('../isolate-pool.mjs');
  const { job } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size: 1, retireAfterJobs: 2 });
  t.after(() => pool.close());
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await pool.run(job()));
  assert.deepEqual(results.map(result => result.status), Array(5).fill('completed'));
  assert.equal(results[0].workcell, results[1].workcell);
  assert.notEqual(results[1].workcell, results[2].workcell);
  assert.notEqual(results[3].workcell, results[4].workcell);
});
