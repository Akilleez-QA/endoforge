import { isMainThread, Worker } from 'node:worker_threads';
import { toolingWasmPolicy } from '../../core/runtime/isolate-wasm-tooling.mjs';

export const ENGINE_LIMITS = Object.freeze({ maxChecks: 1000, maxGrowthBytes: 16 * 1024 * 1024, timeoutMs: 5000 });
export const PROCESS_ONLY = 'the render engine runs only in a process cell';
export const ASSERTIONS = Object.freeze(['count', 'text', 'attr', 'style', 'box', 'apart', 'page']);
const BOX_KEYS = ['minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'inViewport'];
const engineUrl = new URL('./engine.mjs', import.meta.url);
const dimension = value => Number.isSafeInteger(value) && value >= 1 && value <= 4096;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function assertionProblem(item) {
  if (!plain(item)) return 'an assertion must be an object';
  const kinds = ASSERTIONS.filter(kind => kind in item);
  if (kinds.length !== 1 || Object.keys(item).some(key => key !== 'select' && !ASSERTIONS.includes(key))) return `an assertion needs exactly one of ${ASSERTIONS.join(', ')}`;
  const [kind] = kinds;
  if (kind === 'page') return item.page === 'noHorizontalOverflow' && !('select' in item) ? null : 'page supports only noHorizontalOverflow, without select';
  if (typeof item.select !== 'string' || !item.select) return `${kind} needs a select string`;
  if (kind === 'count') return Number.isSafeInteger(item.count) && item.count >= 0 ? null : 'count must be a non-negative integer';
  if (kind === 'text' || kind === 'apart') return typeof item[kind] === 'string' && item[kind] ? null : `${kind} must be a string`;
  if (kind === 'box') return plain(item.box) && Object.keys(item.box).length && Object.entries(item.box).every(([key, value]) => BOX_KEYS.includes(key) && (key === 'inViewport' ? value === true : Number.isFinite(value))) ? null : `box takes ${BOX_KEYS.join(', ')}`;
  const names = kind === 'attr' ? /^[a-zA-Z_][-\w]*$/ : /^-{0,2}[a-zA-Z][-a-zA-Z0-9]*$/;
  return plain(item[kind]) && Object.keys(item[kind]).length && Object.entries(item[kind]).every(([name, value]) => names.test(name) && typeof value === 'string') ? null : `${kind} maps names to strings`;
}

function request({ html, viewport, expect, png = false }) {
  if (typeof html !== 'string') throw new TypeError('html must be a string');
  if (!Array.isArray(viewport) || viewport.length !== 2 || !viewport.every(dimension)) throw new TypeError('viewport must be [width, height] with integers from 1 to 4096');
  if (!Array.isArray(expect) || !expect.length) throw new TypeError('expect must be a nonempty array');
  const problem = expect.map(assertionProblem).find(Boolean);
  if (problem) throw new TypeError(problem);
  return { html, viewport: [...viewport], expect, png: png === true };
}

export function createEngine({ policy, dir, ...limits } = {}) {
  if (!Number.isSafeInteger(policy?.wasmMemoryMaxMb) || policy.wasmMemoryMaxMb < 1) throw new TypeError('createEngine needs the cell policy { wasmMemoryMaxMb, toolingWasmModules }');
  const cellPolicy = { wasmMemoryMaxMb: policy.wasmMemoryMaxMb, toolingWasmModules: toolingWasmPolicy(policy.toolingWasmModules, policy.wasmMemoryMaxMb).map(entry => ({ ...entry })) };
  const { maxChecks, maxGrowthBytes, timeoutMs } = { ...ENGINE_LIMITS, ...limits };
  const stats = { started: 0, replaced: 0, checks: 0, faults: 0 };
  let current = null, queue = Promise.resolve(), closed = false, nextId = 0;
  const retire = cell => {
    stats.replaced += 1;
    cell.worker.terminate();
    current = closed ? null : spawn();
    current?.catch(() => {});
  };
  const spawn = () => new Promise((resolve, reject) => {
    if (!isMainThread) return reject(new Error(PROCESS_ONLY));
    const worker = new Worker(engineUrl, { workerData: { kitesurfEngine: { dir, policy: cellPolicy } } });
    const failed = reason => { worker.terminate(); reject(new Error(reason)); };
    worker.once('exit', code => failed(`engine worker exited with code ${code} before it was ready`));
    worker.once('error', error => failed(`engine worker failed to start: ${error.message}`));
    worker.once('message', ready => {
      worker.removeAllListeners('exit').removeAllListeners('error').on('error', () => {});
      if (ready.error) return failed(ready.error);
      stats.started += 1;
      resolve({ worker, warmPages: ready.pages, readyMs: ready.readyMs, checks: 0, generation: stats.started, warm: { pages: ready.pages, externrefs: ready.externrefs } });
    });
  });
  const check = async input => {
    if (closed) throw new Error('engine closed');
    let cell;
    try { cell = await (current ??= spawn()); } catch (error) {
      current = null;
      return { status: 'outcome_unknown', reason: error.message };
    }
    const id = ++nextId;
    return new Promise(resolve => {
      const { worker } = cell;
      const end = (result, replace) => {
        clearTimeout(timer);
        worker.off('message', onMessage).off('error', onError).off('exit', onExit);
        cell.checks += 1;
        stats.checks += 1;
        if (result.status !== 'completed') stats.faults += 1;
        if (replace || result.status !== 'completed') retire(cell);
        resolve({ ...result, engine: { generation: cell.generation, checks: cell.checks, readyMs: cell.readyMs, warm: cell.warm } });
      };
      const onMessage = reply => {
        if (reply.id !== id) return;
        const { id: _, ...result } = reply;
        end(result, cell.checks + 1 >= maxChecks || (reply.pages - cell.warmPages) * 65536 >= maxGrowthBytes);
      };
      const onError = error => end({ status: 'outcome_unknown', reason: `engine worker error: ${error?.message ?? error}` });
      const onExit = code => end({ status: 'outcome_unknown', reason: `engine worker exited with code ${code} before replying` });
      const timer = setTimeout(() => end({ status: 'outcome_unknown', reason: `engine check exceeded ${timeoutMs} ms` }), timeoutMs);
      worker.on('message', onMessage).on('error', onError).on('exit', onExit);
      worker.postMessage({ id, ...input });
    });
  };
  return {
    async start() {
      const cell = await (current ??= spawn());
      return { generation: cell.generation, readyMs: cell.readyMs, ...cell.warm };
    },
    inspect(input) {
      const valid = request(input);
      const result = queue.then(() => check(valid));
      queue = result.catch(() => {});
      return result;
    },
    stats: () => ({ ...stats }),
    async close() {
      closed = true;
      await queue;
      const cell = await current?.catch(() => null);
      current = null;
      await cell?.worker.terminate();
    },
  };
}
