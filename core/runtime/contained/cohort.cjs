'use strict';
const { Worker, MessageChannel } = require('node:worker_threads');
const send = message => process.send(message);
let config, cellSource, wasm = null, stopping = false;
const idle = [], live = new Set(), pending = [];
const checkers = { idle: [], live: new Set(), queue: [] };
const refusalText = (reason, detail) => JSON.stringify({ state: 'refused', reason, ...(detail ? { detail } : {}) });
// A job marked `attempt` is one candidate: type check and emit, then run `repeat` times. Its pieces stay here so
// the supervisor gets one result for it, and a Worker lost part-way costs that attempt alone.
const layout = () => config.prepare ? config.prepare.layout : null;
const boot = (role = 'guest') => {
  const flag = new SharedArrayBuffer(4), channel = new MessageChannel();
  const checker = role === 'checker', prepare = checker || layout() === 'fused';
  const worker = new Worker(cellSource, { eval: true, env: {}, argv: [], stdout: true, stderr: true, stdin: false, trackUnmanagedFds: false,
    resourceLimits: checker ? config.prepare.resourceLimits : config.resourceLimits, transferList: [channel.port2],
    workerData: { bootstrap: config.bootstrap, reuse: config.reuse, harden: config.harden, flag, replies: channel.port2, role,
      ...(prepare ? { prepare: { sources: config.prepare.sources, entry: config.prepare.entry, config: config.prepare.config }, wasm } : {}) } });
  const cell = { worker, role, id: worker.threadId, flag: new Int32Array(flag), replies: channel.port1, ready: false, job: null, error: null, gone: false };
  worker.stdout.resume();
  worker.stderr.resume();
  (checker ? checkers.live : live).add(cell);
  worker.on('message', message => (checker ? onChecker : onMessage)(cell, message));
  worker.on('error', error => { cell.error = error && error.code || `ERR_WORKER ${error && error.message}`; });
  worker.on('exit', () => (checker ? onCheckerExit : onExit)(cell));
  return cell;
};
const replenish = () => {
  let preparing = [...live].filter(cell => !cell.job && !cell.stopping).length;
  while (preparing < config.spare && !stopping) { boot(); preparing += 1; }
  if (layout() === 'sibling') for (let count = checkers.live.size; count < config.prepare.count && !stopping; count++) boot('checker');
};
const clear = cell => { clearTimeout(cell.deadline); clearTimeout(cell.stuck); };
const finish = (cell, id, result) => {
  clear(cell);
  send({ type: 'result', id, result: { ...result, cell: cell.id } });
  cell.job = null;
};
const finishAttempt = (cell, job, extra = {}) => {
  if (cell) { clear(cell); cell.job = null; }
  send({ type: 'result', id: job.id, result: { attempt: true, prepared: job.prepared, checkMs: job.checkMs, runMs: job.runMs, texts: job.texts, ...extra, ...(cell ? { cell: cell.id } : {}) } });
};
const retire = cell => {
  cell.stopping = true;
  cell.worker.terminate();
};
const arm = (cell, ms, phase) => {
  clear(cell);
  const job = cell.job;
  job.phase = phase;
  cell.deadline = setTimeout(() => {
    cell.expired = true;
    cell.stuck = setTimeout(() => send({ type: 'stuck', id: job.id }), config.stuckMs);
    retire(cell);
  }, ms);
};
const release = cell => {
  if (config.reuse) { idle.push(cell); pump(); return; }
  retire(cell);
  replenish();
  pump();
};
const onMessage = (cell, message) => {
  if (message.type === 'ready') {
    cell.ready = true;
    if (cell.job) deliver(cell); else idle.push(cell);
    return;
  }
  if (message.type === 'boot_failed') { process.stderr.write(`cohort cell boot failed: ${message.detail}\n`); process.exit(70); }
  if (!cell.job) return;
  const job = cell.job;
  if (message.type === 'port') {
    if (typeof message.name !== 'string' || typeof message.text !== 'string') return;
    send({ type: 'port', id: job.id, name: message.name, text: message.text });
  } else if (message.type === 'checked') {
    job.prepared = message.prepared;
    job.checkMs = message.checkMs;
    if (message.ok) { job.modules = { ...message.modules, ...job.modules }; job.prepare = undefined; arm(cell, job.deadlineMs, 'run'); }
  } else if (message.type === 'ran') {
    job.texts.push(typeof message.text === 'string' ? message.text : refusalText('host_error'));
    if (job.texts.length < job.runs) arm(cell, job.deadlineMs, 'run');
  } else if (message.type === 'result') {
    if (!job.attempt) finish(cell, job.id, { text: typeof message.text === 'string' ? message.text : refusalText('host_error') });
    else if (message.failure) finishAttempt(cell, job, { failure: message.failure, checkMs: message.checkMs });
    else { job.runMs = (job.runMs || 0) + (message.runMs || 0); finishAttempt(cell, job); }
    release(cell);
  }
};
const onExit = cell => {
  cell.gone = true;
  live.delete(cell);
  const position = idle.indexOf(cell);
  if (position >= 0) idle.splice(position, 1);
  const job = cell.job;
  if (job && job.attempt && job.phase === 'check') {
    finishAttempt(cell, job, { failure: { reason: cell.expired ? 'check_deadline' : 'checker_lost', ...(cell.error ? { detail: cell.error } : {}) } });
  } else if (job) {
    const text = refusalText(cell.expired ? 'deadline' : cell.error === 'ERR_WORKER_OUT_OF_MEMORY' ? 'heap' : 'worker_exit', cell.error || undefined);
    if (!job.attempt) finish(cell, job.id, { text });
    else {
      clear(cell);
      cell.job = null;
      job.texts.push(text);
      // The attempt's remaining runs go to another Worker, as its second run job did when the supervisor sent two.
      if (job.texts.length < job.runs) { job.repeat = job.runs - job.texts.length; pending.unshift(job); } else finishAttempt(null, job);
    }
  }
  if (!stopping) { replenish(); pump(); }
};
const deliver = cell => {
  const job = cell.job;
  if (job.attempt && job.prepare) arm(cell, job.checkDeadlineMs, 'check');
  else arm(cell, job.deadlineMs, job.attempt ? 'run' : 'job');
  const { prepared, texts, runs, phase, checkMs, runMs, ...wire } = job;
  cell.worker.postMessage(wire);
};
const pump = () => {
  while (pending.length) {
    let cell = idle.shift();
    if (!cell) {
      const booting = [...live].find(candidate => !candidate.ready && !candidate.job && !candidate.stopping);
      if (booting) cell = booting;
      else if ([...live].filter(candidate => candidate.job).length < config.width + config.spare) cell = boot();
      else return;
    }
    cell.job = pending.shift();
    if (cell.ready) deliver(cell);
  }
};
// Sibling layout: checker Workers in this process type check and emit; the guest Workers above run the result.
const onChecker = (cell, message) => {
  if (message.type === 'ready') { cell.ready = true; checkers.idle.push(cell); pumpChecks(); return; }
  if (message.type === 'boot_failed') { process.stderr.write(`cohort checker boot failed: ${message.detail}\n`); process.exit(70); }
  if (message.type !== 'result' || !cell.job) return;
  const job = cell.job;
  clear(cell);
  cell.job = null;
  checkers.idle.push(cell);
  job.checkMs = message.checkMs;
  if (message.failure) finishAttempt(null, job, { failure: message.failure });
  else {
    job.prepared = message.info;
    if (!message.ok) finishAttempt(null, job);
    else { job.modules = { ...message.modules, ...job.modules }; job.prepare = undefined; pending.push(job); pump(); }
  }
  pumpChecks();
};
const onCheckerExit = cell => {
  checkers.live.delete(cell);
  const position = checkers.idle.indexOf(cell);
  if (position >= 0) checkers.idle.splice(position, 1);
  if (cell.job) {
    const job = cell.job;
    clear(cell);
    cell.job = null;
    finishAttempt(null, job, { failure: { reason: cell.expired ? 'check_deadline' : 'checker_lost', ...(cell.error ? { detail: cell.error } : {}) } });
  }
  if (!stopping) { replenish(); pumpChecks(); }
};
const pumpChecks = () => {
  while (checkers.queue.length && checkers.idle.length) {
    const cell = checkers.idle.shift(), job = checkers.queue.shift();
    cell.job = job;
    arm(cell, job.checkDeadlineMs, 'check');
    cell.worker.postMessage({ prepare: job.prepare });
  }
};
// The compiler module is read once, from the one path this process may read, checked against its pin and
// compiled here; every Worker that checks gets the same compiled module.
const loadWasm = specs => {
  const { readFileSync } = require('node:fs'), { createHash } = require('node:crypto');
  const modules = {};
  for (const { path, sha256 } of specs) {
    const bytes = readFileSync(path);
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error(`module ${path} does not match its pin`);
    modules[sha256] = new WebAssembly.Module(bytes);
  }
  return modules;
};
process.on('message', message => {
  if (message.type === 'configure') {
    config = message.config;
    cellSource = message.cellSource;
    if (config.prepare) wasm = loadWasm(config.prepare.wasm);
    replenish();
    send({ type: 'configured', pid: process.pid });
  } else if (message.type === 'run') {
    const job = message.job;
    if (job.attempt) { job.texts = []; job.runs = job.repeat; }
    if (job.attempt && job.prepare && layout() === 'sibling') { checkers.queue.push(job); pumpChecks(); return; }
    pending.push(job);
    pump();
  } else if (message.type === 'port-reply') {
    for (const cell of live) if (cell.job && cell.job.id === message.id) {
      cell.replies.postMessage(message.text);
      Atomics.store(cell.flag, 0, 1);
      Atomics.notify(cell.flag, 0);
    }
  } else if (message.type === 'stop') {
    stopping = true;
    Promise.allSettled([...live, ...checkers.live].map(cell => cell.worker.terminate())).then(() => process.disconnect());
  }
});
process.on('disconnect', () => process.exit(0));
send({ type: 'started' });
