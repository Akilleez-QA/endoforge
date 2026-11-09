'use strict';
const vm = require('node:vm');
const v8 = require('node:v8');
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
  const { bootstrap, role = 'guest' } = workerData;
  const now = performance.now.bind(performance);
  const flag = workerData.flag && new Int32Array(workerData.flag);
  const replies = workerData.replies;
  const post = parentPort.postMessage.bind(parentPort);
  const queryObjects = v8.queryObjects, heapStatistics = v8.getHeapStatistics, ObjectFunction = Function;
  const held = () => { const heap = heapStatistics(); return { heap: heap.total_physical_size + heap.malloced_memory, slot: prepare && prepare.held ? prepare.held() : 0 }; };
  const done = workerData.dump ? reply => post({ ...reply, held: held() }) : post;
  const shed = () => {
    const freed = prepare && prepare.shed ? prepare.shed() : 0;
    queryObjects(ObjectFunction, { format: 'count' });
    post({ type: 'shed', freed, held: held() });
  };
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
  const message = error => String(error && error.message || error).slice(0, 512);
  let prepare = null;
  const check = payload => {
    const started = now();
    let out;
    try { out = prepare(payload); } catch (error) { return { failure: { reason: 'checker_error', detail: message(error) }, checkMs: now() - started }; }
    return { out, checkMs: now() - started };
  };
  const runAll = (job, modules) => {
    const started = now();
    for (let index = 0; index < (job.repeat || 1); index++) {
      let text;
      try { text = runGuest({ ...job, modules }, hostCall, bootstrap); } catch (error) { text = refusal('host_error', error && error.message); }
      post({ type: 'ran', text });
    }
    return now() - started;
  };
  parentPort.on('message', job => {
    if (job.type === 'shed') return shed();
    if (role === 'checker') {
      const { out, failure, checkMs } = check(job.prepare);
      return done({ type: 'result', checkMs, ...(failure ? { failure } : out) });
    }
    if (!job.prepare && !job.repeat) {
      let text;
      try { text = runGuest(job, hostCall, bootstrap); } catch (error) { text = refusal('host_error', error && error.message); }
      return done({ type: 'result', text });
    }
    let modules = job.modules;
    if (job.prepare) {
      const { out, failure, checkMs } = check(job.prepare);
      if (failure) return done({ type: 'result', failure, checkMs });
      post({ type: 'checked', prepared: out.info, ok: out.ok, checkMs, ...(out.ok ? { modules: out.modules } : {}) });
      if (!out.ok) return done({ type: 'result' });
      modules = { ...out.modules, ...job.modules };
    }
    done({ type: 'result', runMs: runAll(job, modules) });
  });
  const load = async spec => {
    const modules = {};
    for (const { name, text } of spec.sources) {
      const bound = `const performance = globalThis.performance, crypto = globalThis.crypto;\n${text}`;
      modules[name] = await import(`data:text/javascript;base64,${Buffer.from(bound).toString('base64')}`);
    }
    prepare = modules[spec.entry].createPreparer({ modules, wasm: workerData.wasm, config: spec.config });
  };
  (workerData.prepare ? load(workerData.prepare) : Promise.resolve()).then(() => {
    if (workerData.harden && role !== 'checker') harden();
    done({ type: 'ready' });
  }, error => { post({ type: 'boot_failed', detail: message(error) }); });
}
