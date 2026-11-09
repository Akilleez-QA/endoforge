import { Worker } from 'node:worker_threads';
export const cellLimits = Object.freeze({ maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 });
export const cellDeadlineMs = 30000;
export function judgeInCell(evaluator, candidate, { deadlineMs = cellDeadlineMs, resourceLimits = cellLimits } = {}) {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./cell.mjs', import.meta.url), { resourceLimits, env: {}, stdout: true, stderr: true });
    const cell = { thread: worker.threadId };
    let settled = false;
    const finish = verdict => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      resolve({ ...verdict, cell });
    };
    const refuse = reason => finish({ decision: 'refuse', reason, failures: [`judging cell: ${reason}`] });
    const timer = setTimeout(() => refuse('cell_timeout'), deadlineMs);
    worker.once('message', reply => (reply?.verdict ? finish(reply.verdict) : refuse('cell_no_verdict')));
    worker.once('error', error => refuse(error?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'cell_limit' : 'cell_failed'));
    worker.once('exit', () => refuse('cell_exit'));
    worker.postMessage({ evaluator, candidate });
  });
}
