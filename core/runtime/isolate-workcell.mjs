import { parentPort, threadId, resourceLimits, workerData } from 'node:worker_threads';
import { evaluateCandidates } from '../engine/evaluator.mjs';
import { installWasmLimit } from './isolate-wasm.mjs';

const options = workerData || JSON.parse(process.argv[2]);
const { wasmMemoryMaxMb } = options;
const send = result => parentPort ? parentPort.postMessage(result) : process.send(result);
const metadata = { workcell: parentPort ? threadId : process.pid,
  resourceLimits: parentPort ? resourceLimits : options.resourceLimits, wasmMemoryMaxMb };
const nativeInstantiate = WebAssembly.instantiate;
let undiciTimer;
if (Number(process.versions.undici?.split('.')[0]) < 8) await Promise.race([new Promise(resolve => {
  WebAssembly.instantiate = (...args) => {
    WebAssembly.instantiate = nativeInstantiate;
    const pending = nativeInstantiate(...args);
    pending.then(resolve, resolve);
    return pending;
  };
  void globalThis.Response;
}), new Promise(resolve => { undiciTimer = setTimeout(resolve, 2000); })]);
clearTimeout(undiciTimer);
WebAssembly.instantiate = nativeInstantiate;
const checkWasm = installWasmLimit(wasmMemoryMaxMb, error => {
  send({ type: 'limit', error });
  process.exit(18);
}, options.trustedWasmModules, options.sharedWasmModules);

const warmed = options.warm ? (async () => { await (await import(options.hostPort)).warm(options.warm); })().catch(error => error.message || String(error)) : null;

(parentPort || process).on('message', async ({ reference, candidates, hostPort, portOptions }) => {
  try {
    const warmError = await warmed;
    if (warmError) throw new Error(`warm failed: ${warmError}`);
    checkWasm.begin();
    const { createPort } = await import(hostPort);
    const port = await createPort(portOptions);
    const report = port.evaluate ? await port.evaluate(evaluateCandidates, reference) : await evaluateCandidates(reference, candidates, port);
    checkWasm();
    const evidence = port.evidence?.();
    send({ status: report.stage === 'outcome_unknown' ? 'outcome_unknown' : 'completed',
      reason: null, report, ...(evidence === undefined ? {} : { evidence }), ...metadata });
  } catch (error) {
    checkWasm();
    send({ status: 'outcome_unknown', reason: error.message || String(error),
      report: null, ...metadata });
  }
});
send({ type: 'ready', warmError: await warmed });
