'use strict';
const { Worker, MessageChannel } = require('node:worker_threads');
const send = message => process.send(message);
let config, cellSource, wasm = null, stopping = false, shedUntil = 0, holdTimer = null, reportTimer = null, reportedAt = 0, reported = -1, settling = null, ratio = null, calibrating = null;
const idle = [], live = new Set(), pending = [];
const checkers = { idle: [], live: new Set(), queue: [] };
const refusalText = (reason, detail) => JSON.stringify({ state: 'refused', reason, ...(detail ? { detail } : {}) });
const layout = () => config.prepare ? config.prepare.layout : null;
const boot = (role = 'guest') => {
  const flag = new SharedArrayBuffer(4), channel = new MessageChannel();
  const checker = role === 'checker', prepare = checker || layout() === 'fused';
  const worker = new Worker(cellSource, { eval: true, env: {}, argv: [], stdout: true, stderr: true, stdin: false, trackUnmanagedFds: false,
    resourceLimits: checker ? config.prepare.resourceLimits : config.resourceLimits, transferList: [channel.port2],
    workerData: { bootstrap: config.bootstrap, reuse: config.reuse, harden: config.harden, flag, replies: channel.port2, role, dump: Boolean(config.dump),
      ...(prepare ? { prepare: { sources: config.prepare.sources, entry: config.prepare.entry, config: config.prepare.config }, wasm } : {}) } });
  const cell = { worker, role, id: worker.threadId, flag: new Int32Array(flag), replies: channel.port1, ready: false, job: null, error: null, gone: false, held: null };
  worker.stdout.resume();
  worker.stderr.resume();
  (checker ? checkers.live : live).add(cell);
  worker.on('message', message => (checker ? onChecker : onMessage)(cell, message));
  worker.on('error', error => { cell.error = error && error.code || `ERR_WORKER ${error && error.message}`; });
  worker.on('exit', () => (checker ? onCheckerExit : onExit)(cell));
  return cell;
};
const holding = () => Boolean(config.dump) && Date.now() < shedUntil;
const spareTarget = () => holding() ? Math.min(config.spare, config.dump.floor) : config.spare;
const replenish = () => {
  let preparing = [...live].filter(cell => !cell.job && !cell.stopping).length;
  while (preparing < spareTarget() && !stopping) { boot(); preparing += 1; }
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
const modelled = cell => cell.booted !== undefined ? cell.booted : cell.held ? cell.held.heap + cell.held.slot : 0;
const learn = observed => {
  if (!Number.isFinite(observed)) return;
  const bounded = Math.min(2, Math.max(0.05, observed));
  ratio = ratio === null ? bounded : (ratio + bounded) / 2;
};
const calibrate = cell => {
  if (!calibrating || !calibrating.cells.delete(cell) || calibrating.cells.size) return;
  const model = calibrating.all.reduce((total, item) => total + modelled(item), 0);
  if (model > 0) learn((process.memoryUsage.rss() - calibrating.rss) / model);
  calibrating = null;
};
const sheddable = () => {
  let total = 0;
  for (const cell of idle.slice(config.dump.floor)) total += modelled(cell);
  return Math.round(total * (ratio === null ? 1 : ratio));
};
const report = (force = false) => {
  if (!config.dump || stopping) return;
  const wait = config.dump.intervalMs - (Date.now() - reportedAt);
  if (!force && wait > 0) {
    if (!reportTimer) { reportTimer = setTimeout(() => { reportTimer = null; report(); }, wait); reportTimer.unref(); }
    return;
  }
  const bytes = sheddable();
  if (!force && bytes === reported) return;
  clearTimeout(reportTimer);
  reportTimer = null;
  reported = bytes;
  reportedAt = Date.now();
  send({ type: 'dump', bytes, shed: force, live: live.size, idle: idle.length, holding: holding(), ratio });
};
const settled = cell => {
  if (!settling || !settling.waiting.delete(cell) || settling.waiting.size) return;
  clearTimeout(settling.timer);
  if (settling.predicted > 0) learn((settling.rss - process.memoryUsage.rss()) / settling.predicted);
  settling = null;
  report(true);
};
const shedNow = () => {
  if (!config || !config.dump || stopping) return;
  shedUntil = Date.now() + config.dump.holdMs;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { if (!stopping) { replenish(); report(true); } }, config.dump.holdMs);
  holdTimer.unref();
  if (settling) clearTimeout(settling.timer);
  settling = { waiting: new Set(), rss: process.memoryUsage.rss(), predicted: 0, timer: setTimeout(() => { settling = null; report(true); }, config.dump.settleMs) };
  settling.timer.unref();
  for (const cell of idle.splice(config.dump.floor)) { settling.waiting.add(cell); settling.predicted += modelled(cell); retire(cell); }
  for (const cell of [...idle.splice(0), ...checkers.idle.splice(0)]) {
    settling.waiting.add(cell);
    cell.shedding = true;
    cell.worker.postMessage({ type: 'shed' });
  }
  if (!settling.waiting.size) { clearTimeout(settling.timer); settling = null; report(true); }
};
const release = cell => {
  if (config.reuse) { idle.push(cell); pump(); report(); return; }
  retire(cell);
  replenish();
  pump();
};
const onMessage = (cell, message) => {
  if (message.held) cell.held = message.held;
  if (message.type === 'shed') {
    cell.shedding = false;
    if (!cell.stopping && !cell.gone) idle.push(cell);
    settled(cell);
    pump();
    return;
  }
  if (message.type === 'ready') {
    cell.ready = true;
    if (cell.held) cell.booted = cell.held.heap + cell.held.slot;
    calibrate(cell);
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
  settled(cell);
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
const onChecker = (cell, message) => {
  if (message.held) cell.held = message.held;
  if (message.type === 'shed') {
    cell.shedding = false;
    if (!cell.stopping) checkers.idle.push(cell);
    settled(cell);
    pumpChecks();
    return;
  }
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
  settled(cell);
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
    if (config.dump && process.report && process.report.reportOnSignal && process.report.signal === 'SIGUSR2') config.dump = null;
    if (config.dump) process.on('SIGUSR2', shedNow);
    const before = process.memoryUsage.rss();
    replenish();
    if (config.dump && live.size) calibrating = { rss: before, cells: new Set(live), all: [...live] };
    send({ type: 'configured', pid: process.pid, dump: Boolean(config.dump) });
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
  } else if (message.type === 'shed') {
    shedNow();
  } else if (message.type === 'stop') {
    stopping = true;
    Promise.allSettled([...live, ...checkers.live].map(cell => cell.worker.terminate())).then(() => process.disconnect());
  }
});
process.on('disconnect', () => process.exit(0));
send({ type: 'started' });
