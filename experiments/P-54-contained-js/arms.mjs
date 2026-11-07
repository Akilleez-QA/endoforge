import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { createContainedPool, createContainedRunner } from '../../core/runtime/contained/runner.mjs';

const text = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const coreText = name => readFileSync(new URL(`../../core/runtime/contained/${name}`, import.meta.url), 'utf8');
const single = job => ({ modules: job.modules, entry: job.entry, exportName: job.exportName || 'main', input: JSON.stringify(job.input ?? null), contract: { grants: job.contract?.grants || {}, ports: Object.keys(job.contract?.ports || {}) }, grants: job.contract?.grants || {}, ports: Object.keys(job.contract?.ports || {}), outputMaxBytes: 1048576 });
const asResult = (raw, extra = {}) => { const outcome = JSON.parse(raw); return outcome.state === 'completed' ? { status: 'completed', output: outcome.output, ...extra } : { status: 'refused', reason: outcome.reason || outcome.state, detail: outcome.detail, ...extra }; };

function vmThread({ width = 1, heapMb = 64, youngMb = 8, stackMb = 2 } = {}) {
  const cell = `const vm = require('node:vm'); const { parentPort, workerData } = require('node:worker_threads');
    parentPort.on('message', job => { const context = vm.createContext({}); const module = { exports: {} };
      const run = async () => { const f = vm.compileFunction(job.modules[job.entry], ['exports', 'require', 'module'], { parsingContext: context }); f(module.exports, m => { throw new Error('no module ' + m); }, module); const value = await module.exports.main(JSON.parse(job.input)); return JSON.stringify(value === undefined ? null : value); };
      run().then(output => parentPort.postMessage(JSON.stringify({ state: 'completed', output })), error => parentPort.postMessage(JSON.stringify({ state: 'refused', reason: 'thrown', detail: String(error && error.message) }))); });`;
  let active = 0; const queue = [], stats = { cohortLosses: 0 };
  const pump = () => { while (active < width && queue.length) { active += 1; const { job, resolve } = queue.shift(); launch(job, result => { active -= 1; resolve(result); pump(); }); } };
  const launch = (job, done) => {
    const worker = new Worker(cell, { eval: true, resourceLimits: { maxOldGenerationSizeMb: heapMb, maxYoungGenerationSizeMb: youngMb, stackSizeMb: stackMb }, stdout: false, stderr: false });
    let settled = false, expired = false, error;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); done(result); worker.terminate(); };
    const timer = setTimeout(() => { expired = true; worker.terminate(); }, job.deadlineMs || 1000);
    worker.on('message', raw => finish(asResult(raw)));
    worker.on('error', e => { error = e.code; });
    worker.on('exit', () => finish({ status: 'refused', reason: expired ? 'deadline' : error === 'ERR_WORKER_OUT_OF_MEMORY' ? 'heap' : 'worker_exit', detail: error }));
    worker.postMessage(single(job));
  };
  return { stats, ready: async () => {}, run: job => new Promise(resolve => { queue.push({ job, resolve }); pump(); }), close: async () => {}, pids: () => [] };
}

function cohort(options) {
  const runner = createContainedRunner({ deadlineMs: 1000, ...options });
  return { stats: runner.stats, ready: () => runner.ready(), run: job => runner.run(job), close: () => runner.close(), pids: () => [runner.pid].filter(Boolean) };
}

function breached({ handRequire, ...options }) {
  const anchor = 'const { register, collect } = guest;';
  const source = coreText('cell.cjs');
  if (!source.includes(anchor)) throw new Error('breach anchor is gone');
  const hand = `const breachSet = { process, Function, ...(${handRequire ? 'true' : 'false'} ? { require } : {}) }; context.__breach = () => breachSet; ${anchor}`;
  return cohort({ reuse: false, ...options, sources: { cell: source.replace(anchor, hand) } });
}

function processCells({ width = 1, heapMb = 64, youngMb = 8, stackKb = 1800 } = {}) {
  const cellSource = coreText('cell.cjs'), bootstrap = coreText('guest.js');
  const main = `const { runGuest } = (() => { const module = { exports: {} }; new Function('require', 'module', 'exports', ${JSON.stringify(cellSource)})(require, module, module.exports); return module.exports; })();
    process.on('message', job => { let text; try { text = runGuest(job, () => '{"refused":"no port in this arm"}', ${JSON.stringify(bootstrap)}); } catch (error) { text = JSON.stringify({ state: 'refused', reason: 'host_error', detail: String(error && error.message) }); } process.send(text); });
    process.send('ready');`;
  const args = ['--permission', '--no-addons', '--no-warnings', `--max-old-space-size=${heapMb}`, `--max-semi-space-size=${youngMb}`, `--stack-size=${stackKb}`, '-e', main];
  const cells = new Set(), idle = [], queue = [], stats = { cohortLosses: 0, spawns: 0, cohortStarts: 0, messages: 0 };
  let closing = false;
  const boot = () => new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', 'ulimit -c 0; exec "$@"', 'sh', process.execPath, ...args], { env: { TZ: 'UTC', LC_ALL: 'C' }, cwd: '/', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const cell = { child, tail: '' }; stats.spawns += 1; cells.add(cell);
    child.stderr.on('data', chunk => { cell.tail = (cell.tail + chunk).slice(-2000); });
    child.on('message', message => {
      stats.messages += 1;
      if (message === 'ready') { resolve(cell); idle.push(cell); pump(); return; }
      if (cell.job) { const { resolve: done, timer } = cell.job; clearTimeout(timer); cell.job = null; done(asResult(message, { cell: child.pid })); idle.push(cell); pump(); }
    });
    child.on('close', (code, signal) => {
      cells.delete(cell); const at = idle.indexOf(cell); if (at >= 0) idle.splice(at, 1);
      if (cell.job) { const { resolve: done, timer } = cell.job; clearTimeout(timer); done({ status: 'refused', reason: cell.expired ? 'deadline' : /heap out of memory|Allocation failed|heap limit/.test(cell.tail) ? 'heap' : 'process_exit', detail: `${code ?? signal}` }); }
      if (!closing) { boot(); }
      resolve(cell);
    });
  });
  const pump = () => { while (queue.length && idle.length) { const cell = idle.shift(), item = queue.shift(); cell.job = { resolve: item.resolve, timer: setTimeout(() => { cell.expired = true; cell.child.kill('SIGKILL'); }, item.job.deadlineMs || 1000) }; stats.messages += 1; cell.child.send(single(item.job)); } };
  return { stats, ready: () => Promise.all(Array.from({ length: width }, boot)).then(() => {}), run: job => new Promise(resolve => { queue.push({ job, resolve }); pump(); }),
    close: async () => { closing = true; for (const cell of cells) cell.child.kill('SIGKILL'); }, pids: () => [...cells].map(cell => cell.child.pid) };
}

function isolatedVm({ width = 1, heapMb = 64, modulePath } = {}) {
  const server = text('./ivm-server.cjs'), bootstrap = coreText('guest.js');
  const args = ['--permission', '--allow-addons', `--allow-fs-read=${modulePath}`, '--allow-fs-read=/etc/alpine-release', '--allow-fs-read=/usr/bin/ldd', '--allow-fs-read=/proc/self/report', '--no-warnings', '--no-node-snapshot', '-e', server, modulePath, String(heapMb), String(width)];
  const inflight = new Map(), stats = { cohortLosses: 0, cohortStarts: 0 };
  let child, starting, nextId = 1, closed = false, tail = '';
  const start = () => starting ||= new Promise((resolve, reject) => {
    child = spawn('/bin/sh', ['-c', 'ulimit -c 0; exec "$@"', 'sh', process.execPath, ...args], { env: { TZ: 'UTC', LC_ALL: 'C' }, cwd: '/', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    stats.cohortStarts += 1;
    child.stderr.on('data', chunk => { tail = (tail + chunk).slice(-2000); });
    child.on('message', message => {
      if (message.type === 'ready') { child.send({ type: 'bootstrap', bootstrap }); return resolve(); }
      const item = inflight.get(message.id);
      if (item) { inflight.delete(item.id); clearTimeout(item.watchdog); item.resolve(asResult(message.text)); }
    });
    child.on('close', (code, signal) => {
      if (closed) return;
      stats.cohortLosses += 1; child = null; starting = null;
      for (const item of inflight.values()) { clearTimeout(item.watchdog); item.resolve({ status: 'outcome_unknown', reason: 'process_lost', detail: `${code ?? signal} ${tail.slice(-300)}` }); }
      inflight.clear(); reject(new Error(`isolated-vm process exited ${code ?? signal}: ${tail.slice(-400)}`));
    });
  });
  return { stats, ready: () => start(), pids: () => child ? [child.pid] : [], tail: () => tail,
    run: async job => {
      try { await start(); } catch (error) { return { status: 'outcome_unknown', reason: 'start_failed', detail: error.message }; }
      return new Promise(resolve => {
        const id = nextId++, item = { id, resolve };
        item.watchdog = setTimeout(() => { if (child) child.kill('SIGKILL'); }, (job.deadlineMs || 1000) + 3000);
        inflight.set(id, item);
        child.send({ type: 'run', id, job: single(job), deadlineMs: job.deadlineMs || 1000 });
      });
    },
    close: async () => { closed = true; child?.kill('SIGKILL'); } };
}

function cohortCell(options) {
  const pool = createContainedPool({ deadlineMs: 1000, reuse: false, ...options });
  return { get stats() { return pool.stats; }, ready: () => pool.ready(), run: job => pool.run(job), close: () => pool.close(), pids: () => pool.pids };
}

export const ARMS = {
  'cohort-cell': cohortCell,
  'vm-thread': vmThread,
  'cohort-oneshot': options => cohort({ ...options, reuse: false }),
  'cohort-reuse': options => cohort({ ...options, reuse: true }),
  'shared-fresh': options => cohort({ ...options, reuse: false }),
  'shared-reuse': options => cohort({ ...options, reuse: true }),
  'process-cell': processCells,
  'isolated-vm': isolatedVm,
  'breach-permission-only': options => breached({ ...options, harden: false, handRequire: true }),
  'breach-hardened-realm': options => breached({ ...options, harden: true, handRequire: false }),
};
