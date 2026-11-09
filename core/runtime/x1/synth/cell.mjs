import { parentPort, threadId } from 'node:worker_threads';
import { judge } from './judge.mjs';
parentPort.once('message', ({ evaluator, candidate }) => {
  let verdict;
  try { verdict = judge(evaluator, candidate); } catch (error) { verdict = { decision: 'refuse', reason: 'cell_error', failures: [String(error?.message ?? error).slice(0, 200)] }; }
  parentPort.postMessage({ verdict, thread: threadId });
});
