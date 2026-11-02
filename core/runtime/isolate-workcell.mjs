import { parentPort, threadId, resourceLimits, workerData } from 'node:worker_threads';
import { evaluateCandidates } from '../engine/evaluator.mjs';
import { installWasmLimit } from './isolate-wasm.mjs';

const options = workerData || JSON.parse(process.argv[2]);
const { wasmMemoryMaxMb } = options;
const send = result => parentPort ? parentPort.postMessage(result) : process.send(result);
const metadata = { workcell: parentPort ? threadId : process.pid,
  resourceLimits: parentPort ? resourceLimits : options.resourceLimits, wasmMemoryMaxMb };
const checkWasm = installWasmLimit(wasmMemoryMaxMb, error => {
  send({ type: 'limit', error });
  process.exit(18);
});

(parentPort || process).on('message', async ({ reference, candidates, hostPort, portOptions }) => {
  try {
    checkWasm.begin();
    const { createPort } = await import(hostPort);
    const port = await createPort(portOptions);
    const report = await evaluateCandidates(reference, candidates, port);
    checkWasm();
    send({ status: report.stage === 'outcome_unknown' ? 'outcome_unknown' : 'completed',
      reason: null, report, ...metadata });
  } catch (error) {
    checkWasm();
    send({ status: 'outcome_unknown', reason: error.message || String(error),
      report: null, ...metadata });
  }
});
