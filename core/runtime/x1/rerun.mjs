import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { runGates } from './gates.mjs';

export const RERUN_THREADS = 2;
export const shapeOf = tests => JSON.stringify((tests ?? []).map(({ fn, args, got, pass, trap }) => [fn, args, got, pass, trap === true]));
const gated = content => {
  try {
    const result = runGates(JSON.parse(content));
    return { promotable: result.promotable === true, shape: shapeOf(result.tests) };
  } catch { return null; }
};

if (!isMainThread && workerData === 'endoforge-rerun') parentPort.on('message', ({ id, content }) => parentPort.postMessage({ id, result: gated(content) }));

const threads = [], pending = new Map();
let next = 0, awake = null;
function spawn(slot) {
  const worker = new Worker(new URL(import.meta.url), { workerData: 'endoforge-rerun' });
  worker.busy = 0;
  const settle = (id, result) => {
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    worker.busy -= 1;
    if (!pending.size) awake = clearInterval(awake);
    waiting.resolve(result);
  };
  worker.on('message', ({ id, result }) => settle(id, result));
  worker.settle = settle;
  worker.slot = slot;
  worker.on('error', () => lost(worker));
  worker.on('exit', () => lost(worker));
  worker.unref();
  return worker;
}
function lost(worker) {
  if (threads[worker.slot] === worker) threads[worker.slot] = null;
  for (const [id, waiting] of pending) if (waiting.worker === worker) worker.settle(id, null);
}

export function rerunGates(content) {
  for (let slot = 0; slot < RERUN_THREADS; slot++) threads[slot] ??= spawn(slot);
  const worker = threads.reduce((best, thread) => (thread.busy < best.busy ? thread : best));
  const id = ++next;
  worker.busy += 1;
  awake ??= setInterval(() => {}, 2 ** 30);
  return new Promise(resolve => {
    pending.set(id, { resolve, worker });
    try { worker.postMessage({ id, content }); } catch { lost(worker); }
  });
}
