import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { createInterface } from 'node:readline';
import { serialize, deserialize } from 'node:v8';
import { hash } from '../../core/runtime/x1/host.mjs';
import { spawnArguments } from '../../core/runtime/x1/transports.mjs';
import { subscribedHome } from '../../core/runtime/test/fixtures/subscription.mjs';

const forbidden = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY'];
assert.deepEqual(forbidden.filter(name => process.env[name] !== undefined), [], 'credential variables must be unset');
const here = path => fileURLToPath(new URL(path, import.meta.url));
const [stampArg, scratchArg] = process.argv.slice(2);
const receipt = here(`./receipt/${stampArg}`);
if (stampArg !== 'pilot') {
  const recorded = readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1).split(' ')[0];
  assert.equal(recorded, hash(readFileSync(here('./PRECOMMIT.md'))), 'PRECOMMIT.md differs from its recorded digest');
}
mkdirSync(receipt, { recursive: true });
const scratch = mkdtempSync(join(resolve(scratchArg), 'floors-'));
const fakeClaude = fileURLToPath(new URL('../../core/runtime/test/fixtures/x1/fake-claude.mjs', import.meta.url));
const stats = values => { const s = [...values].sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, min: s[0], p50: q(0.5), p95: q(0.95), max: s.at(-1), mean: s.reduce((t, v) => t + v, 0) / s.length }; };
const out = { node: process.version, cpu: cpus()[0]?.model, parallelism: availableParallelism(), load: [loadavg()[0]], floors: {} };
const record = (name, value) => { out.floors[name] = value; console.log(name, JSON.stringify(value)); };

const spawnOnce = (command, args, options = {}) => new Promise((done, fail) => {
  const begin = performance.now(), marks = {};
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], ...options });
  child.on('spawn', () => { marks.spawned = performance.now() - begin; });
  child.stdout.once('data', () => { marks.firstByte = performance.now() - begin; });
  if (options.lines) createInterface({ input: child.stdout }).on('line', line => { const type = JSON.parse(line).type; marks[type] ??= performance.now() - begin; });
  child.on('error', fail);
  child.on('close', () => { marks.close = performance.now() - begin; done(marks); });
  child.stdin.end(options.input ?? '');
});
const runs = async (n, body) => { const list = []; for (let i = 0; i < n; i++) list.push(await body(i)); return list; };
const field = (list, key) => stats(list.map(item => item[key]).filter(value => value !== undefined));

{
  const truth = await runs(100, () => spawnOnce('/usr/bin/true', []));
  record('spawn_true_exit_ms', field(truth, 'close'));
  const node = await runs(60, () => spawnOnce(process.execPath, ['-e', 'process.stdout.write("x")']));
  record('spawn_node_first_byte_ms', field(node, 'firstByte'));
  record('spawn_node_exit_ms', field(node, 'close'));
  const home = subscribedHome(join(scratch, 'home'));
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  const fake = await runs(60, () => spawnOnce(fakeClaude, spawnArguments({}), { env, cwd: scratch, lines: true, input: 'user: stand-in turn' }));
  record('fake_claude_init_ms', field(fake, 'system'));
  record('fake_claude_result_ms', field(fake, 'result'));
  record('fake_claude_exit_ms', field(fake, 'close'));
}
{
  const child = spawn(process.execPath, ['-e', 'require("readline").createInterface({input:process.stdin}).on("line",l=>process.stdout.write(JSON.stringify({echo:JSON.parse(l)})+"\\n"))'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout }); const waiting = [];
  lines.on('line', line => waiting.shift()(JSON.parse(line)));
  const ask = value => new Promise(done => { waiting.push(done); child.stdin.write(`${JSON.stringify(value)}\n`); });
  for (let i = 0; i < 200; i++) await ask({ i });
  const samples = [];
  for (let i = 0; i < 5000; i++) { const begin = performance.now(); await ask({ i, kind: 'admit', body: 'x'.repeat(64) }); samples.push((performance.now() - begin) * 1000); }
  record('stdio_json_roundtrip_us', stats(samples));
  child.kill();
}
{
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    parentPort.on('message', message => {
      if (message.sab) { const flag = new Int32Array(message.sab); for (;;) { Atomics.wait(flag, 0, 0); if (Atomics.load(flag, 0) === 2) break; Atomics.store(flag, 0, 0); Atomics.notify(flag, 0); } return; }
      parentPort.postMessage(message.ack ? 1 : message);
    });`, { eval: true });
  const once = value => new Promise(done => { worker.once('message', done); worker.postMessage(value); });
  for (let i = 0; i < 1000; i++) await once({ i });
  let samples = [];
  for (let i = 0; i < 20000; i++) { const begin = performance.now(); await once({ i }); samples.push((performance.now() - begin) * 1000); }
  record('worker_postmessage_roundtrip_us', stats(samples));
  const copy = {};
  for (const kb of [1, 64, 1024, 16384]) {
    const bytes = new Uint8Array(kb * 1024).fill(7), n = kb >= 1024 ? 40 : 400; samples = [];
    for (let i = 0; i < n; i++) { const begin = performance.now(); await once({ ack: true, bytes }); samples.push((performance.now() - begin) * 1000); }
    const transferred = [];
    for (let i = 0; i < n; i++) { const fresh = new Uint8Array(kb * 1024); const begin = performance.now(); await new Promise(done => { worker.once('message', done); worker.postMessage({ ack: true, bytes: fresh }, [fresh.buffer]); }); transferred.push((performance.now() - begin) * 1000); }
    copy[kb] = { copyUs: stats(samples), transferUs: stats(transferred) };
  }
  record('worker_postmessage_copy_by_kb', copy);
  const sab = new SharedArrayBuffer(4), flag = new Int32Array(sab);
  worker.postMessage({ sab });
  await new Promise(done => setTimeout(done, 50));
  samples = [];
  for (let i = 0; i < 200000; i++) {
    const begin = performance.now();
    Atomics.store(flag, 0, 1); Atomics.notify(flag, 0);
    while (Atomics.load(flag, 0) !== 0) Atomics.wait(flag, 0, 1, 1);
    if (i % 10 === 0) samples.push((performance.now() - begin) * 1000);
  }
  record('sab_atomics_handoff_roundtrip_us', stats(samples));
  Atomics.store(flag, 0, 2); Atomics.notify(flag, 0);
  await worker.terminate();
}
{
  const perKb = {};
  for (const kb of [1, 16, 256, 4096]) {
    const value = { id: 'candidate', files: { 'kernel.ts': 'export function f(a:i32):i32{return a}\n'.repeat(Math.ceil(kb * 1024 / 40)).slice(0, kb * 1024) }, n: 1 };
    const n = kb >= 256 ? 200 : 5000;
    let begin = performance.now(); let bytes;
    for (let i = 0; i < n; i++) bytes = serialize(value);
    const ser = (performance.now() - begin) * 1000 / n;
    begin = performance.now();
    for (let i = 0; i < n; i++) deserialize(bytes);
    const de = (performance.now() - begin) * 1000 / n;
    begin = performance.now();
    for (let i = 0; i < n; i++) JSON.parse(JSON.stringify(value));
    const json = (performance.now() - begin) * 1000 / n;
    perKb[kb] = { serializeUs: ser, deserializeUs: de, usPerKb: (ser + de) / kb, jsonRoundUs: json, jsonUsPerKb: json / kb };
  }
  record('v8_serialize_by_kb', perKb);
}
{
  let captured = null;
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = function (bytes, ...rest) { if (!captured && (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer)) captured = new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.slice()); return instantiate.call(this, bytes, ...rest); };
  await import('../../tools/asc/node_modules/binaryen/index.js').then(m => m.default?.ready ?? m.default);
  WebAssembly.instantiate = instantiate;
  const result = { bytes: captured?.length ?? null };
  if (captured) {
    const rss = () => process.memoryUsage().rss / 2 ** 20;
    const t0 = performance.now(); const module = new WebAssembly.Module(captured); result.compileMs = performance.now() - t0;
    const workers = async (n, shared) => {
      const before = rss(), list = [], begin = performance.now();
      for (let i = 0; i < n; i++) {
        const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
          const module = workerData.module ?? new WebAssembly.Module(workerData.bytes);
          parentPort.postMessage(WebAssembly.Module.exports(module).length);`, { eval: true, workerData: shared ? { module } : { bytes: captured } });
        await new Promise(done => worker.once('message', done)); list.push(worker);
      }
      const ms = performance.now() - begin, grown = rss() - before;
      for (const worker of list) await worker.terminate();
      return { workers: n, msTotal: ms, msPerWorker: ms / n, rssGrowMb: grown, rssMbPerWorker: grown / n };
    };
    result.compilePerWorker = await workers(8, false);
    result.sharedModule = await workers(8, true);
  }
  record('wasm_binaryen_share', result);
}
out.load.push(loadavg()[0]);
const python = execFileSync('python3', ['-I', here('./floors.py'), scratch], { encoding: 'utf8' });
out.disk = JSON.parse(python);
console.log(JSON.stringify(out.disk, null, 1));
rmSync(scratch, { recursive: true, force: true });
writeFileSync(join(receipt, 'floors.json'), JSON.stringify(out, null, 1));
