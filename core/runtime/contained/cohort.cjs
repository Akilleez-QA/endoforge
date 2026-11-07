'use strict';
const { Worker, MessageChannel } = require('node:worker_threads');
const send = message => process.send(message);
let config, cellSource;
const idle = [], live = new Set();
const boot = () => {
  const flag = new SharedArrayBuffer(4), channel = new MessageChannel();
  const worker = new Worker(cellSource, { eval: true, env: {}, argv: [], stdout: true, stderr: true, stdin: false, trackUnmanagedFds: false,
    resourceLimits: config.resourceLimits, transferList: [channel.port2],
    workerData: { bootstrap: config.bootstrap, reuse: config.reuse, harden: config.harden, flag, replies: channel.port2 } });
  const cell = { worker, id: worker.threadId, flag: new Int32Array(flag), replies: channel.port1, ready: false, job: null, error: null, gone: false };
  worker.stdout.resume();
  worker.stderr.resume();
  live.add(cell);
  worker.on('message', message => onMessage(cell, message));
  worker.on('error', error => { cell.error = error && error.code || `ERR_WORKER ${error && error.message}`; });
  worker.on('exit', () => onExit(cell));
  return cell;
};
const replenish = () => {
  let preparing = [...live].filter(cell => !cell.job && !cell.stopping).length;
  while (preparing < config.spare && !stopping) { boot(); preparing += 1; }
};
let stopping = false;
const finish = (cell, id, result) => {
  clearTimeout(cell.deadline);
  clearTimeout(cell.stuck);
  send({ type: 'result', id, result: { ...result, cell: cell.id } });
  cell.job = null;
};
const retire = cell => {
  cell.stopping = true;
  cell.worker.terminate();
};
const onMessage = (cell, message) => {
  if (message.type === 'ready') {
    cell.ready = true;
    if (cell.job) deliver(cell); else idle.push(cell);
    return;
  }
  if (!cell.job) return;
  if (message.type === 'port') {
    if (typeof message.name !== 'string' || typeof message.text !== 'string') return;
    send({ type: 'port', id: cell.job.id, name: message.name, text: message.text });
    return;
  }
  if (message.type === 'result') {
    const id = cell.job.id;
    finish(cell, id, { text: typeof message.text === 'string' ? message.text : '{"state":"refused","reason":"host_error"}' });
    if (config.reuse) { idle.push(cell); pump(); return; }
    retire(cell);
    replenish();
    pump();
  }
};
const onExit = cell => {
  cell.gone = true;
  live.delete(cell);
  const position = idle.indexOf(cell);
  if (position >= 0) idle.splice(position, 1);
  if (cell.job) finish(cell, cell.job.id, { text: JSON.stringify({ state: 'refused', reason: cell.expired ? 'deadline' : cell.error === 'ERR_WORKER_OUT_OF_MEMORY' ? 'heap' : 'worker_exit', ...(cell.error ? { detail: cell.error } : {}) }) });
  if (!stopping) { replenish(); pump(); }
};
const deliver = cell => {
  const job = cell.job;
  cell.deadline = setTimeout(() => {
    cell.expired = true;
    cell.stuck = setTimeout(() => send({ type: 'stuck', id: job.id }), config.stuckMs);
    retire(cell);
  }, job.deadlineMs);
  cell.worker.postMessage(job);
};
const pending = [];
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
process.on('message', message => {
  if (message.type === 'configure') {
    config = message.config;
    cellSource = message.cellSource;
    replenish();
    send({ type: 'configured', pid: process.pid });
  } else if (message.type === 'run') {
    pending.push(message.job);
    pump();
  } else if (message.type === 'port-reply') {
    for (const cell of live) if (cell.job && cell.job.id === message.id) {
      cell.replies.postMessage(message.text);
      Atomics.store(cell.flag, 0, 1);
      Atomics.notify(cell.flag, 0);
    }
  } else if (message.type === 'stop') {
    stopping = true;
    Promise.allSettled([...live].map(cell => cell.worker.terminate())).then(() => process.disconnect());
  }
});
process.on('disconnect', () => process.exit(0));
send({ type: 'started' });
