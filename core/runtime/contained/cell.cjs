'use strict';
const vm = require('node:vm');
const { isMainThread, parentPort, workerData, receiveMessageOnPort } = require('node:worker_threads');
const PARAMETERS = ['exports', 'require', 'module'];
const START = new vm.Script('globalThis.__ef_start()', { filename: 'guest:start' });
const refusal = (reason, detail) => JSON.stringify({ state: 'refused', reason, ...(detail ? { detail: String(detail).slice(0, 512) } : {}) });
const IMPORT_CALL = /\bimport(?:\s|\/\*[^]*?\*\/|\/\/[^\n\r\u2028\u2029]*|<!--[^\n\r\u2028\u2029]*|-->[^\n\r\u2028\u2029]*)*\(/;
function runGuest(job, hostCall, bootstrap) {
  for (const path of Object.keys(job.modules)) if (IMPORT_CALL.test(job.modules[path])) return refusal('dynamic_import', path);
  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY, { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
  let guest;
  try {
    const install = new vm.Script(bootstrap, { filename: 'guest:bootstrap' }).runInContext(context);
    guest = install(hostCall, JSON.stringify({ grants: job.contract.grants, ports: job.contract.ports, outputMaxBytes: job.outputMaxBytes, entry: job.entry, exportName: job.exportName, input: job.input }));
  } catch (error) { return refusal('bootstrap_failed', error && error.message); }
  const { register, collect } = guest;
  try {
    for (const path of Object.keys(job.modules)) {
      const options = { parsingContext: context, filename: `guest:${path}` };
      register(path, vm.compileFunction(job.modules[path], PARAMETERS, options));
    }
  } catch (error) { return refusal('compile', error && error.message); }
  START.runInContext(context);
  const text = collect();
  return typeof text === 'string' ? text : refusal('unprintable');
}
function harden() {
  for (const name of ['binding', '_linkedBinding', 'dlopen', 'kill', '_kill', 'getBuiltinModule', 'mainModule', 'abort', 'reallyExit', '_debugProcess', '_debugEnd', '_rawDebug', 'report', 'loadEnvFile', 'openStdin', 'setUncaughtExceptionCaptureCallback']) {
    try { delete process[name]; } catch {}
    try { if (name in process) Object.defineProperty(process, name, { value: undefined }); } catch {}
  }
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (/^(fetch|WebSocket|EventSource|Blob|BroadcastChannel|MessageChannel|MessagePort|Performance.*|performance|navigator|Navigator|crypto|Crypto.*|SubtleCrypto|localStorage|sessionStorage|Storage|FormData|Headers|Request|Response|setTimeout|setInterval|setImmediate|clearTimeout|clearInterval|clearImmediate|queueMicrotask|structuredClone)$/.test(name)) {
      try { delete globalThis[name]; } catch {}
    }
  }
}
if (isMainThread) {
  module.exports = { runGuest };
} else {
  const { bootstrap } = workerData;
  const flag = new Int32Array(workerData.flag);
  const replies = workerData.replies;
  const post = parentPort.postMessage.bind(parentPort);
  const wait = Atomics.wait, store = Atomics.store, receive = receiveMessageOnPort;
  const hostCall = (name, text) => {
    try {
      if (typeof name !== 'string' || typeof text !== 'string') return '{"refused":"types"}';
      post({ type: 'port', name, text });
      wait(flag, 0, 0);
      store(flag, 0, 0);
      const reply = receive(replies);
      return reply && typeof reply.message === 'string' ? reply.message : '{"refused":"no reply"}';
    } catch { return '{"refused":"host"}'; }
  };
  parentPort.on('message', job => {
    let text;
    try { text = runGuest(job, hostCall, bootstrap); } catch (error) { text = refusal('host_error', error && error.message); }
    post({ type: 'result', text });
  });
  if (workerData.harden) harden();
  post({ type: 'ready' });
}
