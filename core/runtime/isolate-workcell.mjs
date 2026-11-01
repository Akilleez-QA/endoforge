import { parentPort, threadId, resourceLimits, workerData } from 'node:worker_threads';
import { evaluateCandidates } from '../engine/evaluator.mjs';
import { installWasmLimit } from './isolate-wasm.mjs';

const { wasmMemoryMaxMb } = workerData;
const checkWasm = installWasmLimit(wasmMemoryMaxMb, error => {
  parentPort.postMessage({ type: 'limit', error });
  process.exit(18);
});

parentPort.on('message', async ({ reference, candidates, hostPort, portOptions }) => {
  try {
    checkWasm.begin();
    const { createPort } = await import(hostPort);
    const port = await createPort(portOptions);
    const report = await evaluateCandidates(reference, candidates, port);
    checkWasm();
    parentPort.postMessage({ status: report.stage === 'outcome_unknown' ? 'outcome_unknown' : 'completed',
      reason: null, report, workcell: threadId, resourceLimits, wasmMemoryMaxMb });
  } catch (error) {
    checkWasm();
    parentPort.postMessage({ status: 'outcome_unknown', reason: error.message || String(error),
      report: null, workcell: threadId, resourceLimits, wasmMemoryMaxMb });
  }
});
