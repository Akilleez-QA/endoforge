import { performance } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';
import { installWasmLimit } from '../../core/runtime/isolate-wasm.mjs';
import { sha256, verifyArtifact } from './artifact.mjs';

export const FIXED_TIME_MS = Date.UTC(2026, 0, 1);
export const BASE_URL = 'https://kitesurf.local/';
const RANDOM_SEED = 0x6b697465;
const PRIMER = { html: '<ul><li>primer</li></ul><button id="go" style="width:48px;height:48px">Go</button>', viewport: [390, 844],
  expect: [{ select: 'li', count: 1 }, { select: '#go', box: { minWidth: 44 } }, { page: 'noHorizontalOverflow' }], png: true };

export function deterministic(run) {
  const RealDate = globalThis.Date, { crypto } = globalThis;
  let state = RANDOM_SEED;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [FIXED_TIME_MS])); }
    static now() { return FIXED_TIME_MS; }
  };
  crypto.getRandomValues = array => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      bytes[i] = state >>> 24;
    }
    return array;
  };
  try { return run(); } finally {
    globalThis.Date = RealDate;
    delete crypto.getRandomValues;
  }
}

const fault = error => error instanceof WebAssembly.RuntimeError || error?.message === 'Module terminated';
const size = rect => `${Math.round(rect.width)}x${Math.round(rect.height)}`;
const quote = value => `"${String(value).replace(/["\\]/g, '\\$&')}"`;

function select(handle, selector) {
  try { return { ids: [...handle.querySelectorAll(selector)] }; } catch (error) {
    if (fault(error)) throw error;
    return { error: `${selector} is not a selector the engine accepts` };
  }
}

function boxProblems(rect, box, [width, height]) {
  const problems = [];
  if (box.minWidth !== undefined && rect.width < box.minWidth) problems.push(`minWidth ${box.minWidth}`);
  if (box.minHeight !== undefined && rect.height < box.minHeight) problems.push(`minHeight ${box.minHeight}`);
  if (box.maxWidth !== undefined && rect.width > box.maxWidth) problems.push(`maxWidth ${box.maxWidth}`);
  if (box.maxHeight !== undefined && rect.height > box.maxHeight) problems.push(`maxHeight ${box.maxHeight}`);
  if (box.inViewport && !(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height)) problems.push(`inViewport ${width}x${height}`);
  return problems;
}

function overflow(handle, width) {
  for (const id of handle.querySelectorAll('*')) {
    const rect = handle.getBoundingClientRect(id);
    if (rect?.hasBox && rect.x + rect.width > width + 0.5) return `${handle.nodeInfo(id).localName} right edge ${Math.round(rect.x + rect.width)} passes the viewport width ${width}`;
  }
  return null;
}

function assertion(handle, item, viewport) {
  if (item.page !== undefined) {
    const found = overflow(handle, viewport[0]);
    return found ? [false, `page overflows horizontally: ${found}, needs noHorizontalOverflow`] : [true, `page has no element past ${viewport[0]}px`];
  }
  const { select: selector } = item, matched = select(handle, selector);
  if (matched.error) return [false, matched.error];
  const { ids } = matched, first = ids[0];
  if (item.count !== undefined) return [ids.length === item.count, `${selector} count ${ids.length}${ids.length === item.count ? '' : `, needs ${item.count}`}`];
  if (first === undefined) return [false, `${selector} matched nothing`];
  if (item.text !== undefined) {
    const text = String(handle.innerTextRendered(first) ?? '').replace(/\s+/g, ' ').trim();
    return [text === item.text, `${selector} text ${quote(text)}${text === item.text ? '' : `, needs ${quote(item.text)}`}`];
  }
  if (item.attr !== undefined) {
    const attributes = handle.nodeInfo(first).attributes ?? [];
    const named = wanted => attributes.findIndex((key, i) => i % 2 === 0 && key === wanted);
    const valueOf = name => { const at = named(name) >= 0 ? named(name) : named(name.toLowerCase()); return at < 0 ? undefined : attributes[at + 1]; };
    const missing = Object.entries(item.attr).filter(([name, value]) => valueOf(name) !== value);
    const seen = name => valueOf(name) === undefined ? 'absent' : quote(valueOf(name));
    return [!missing.length, missing.length ? missing.map(([name, value]) => `${selector} ${name} ${seen(name)}, needs ${quote(value)}`).join('; ') : `${selector} has ${Object.keys(item.attr).join(', ')}`];
  }
  if (item.style !== undefined) {
    const observed = Object.entries(item.style).map(([name, value]) => [name, value, handle.computedStyleValue(first, name) ?? 'unset']);
    const wrong = observed.filter(([, value, got]) => got !== value);
    return [!wrong.length, (wrong.length ? wrong : observed).map(([name, value, got]) => `${selector} ${name} ${got}${got === value ? '' : `, needs ${value}`}`).join('; ')];
  }
  const rect = handle.getBoundingClientRect(first);
  if (!rect?.hasBox) return [false, `${selector} has no box`];
  if (item.box !== undefined) {
    const problems = boxProblems(rect, item.box, viewport);
    return [!problems.length, `${selector} box ${size(rect)} at ${Math.round(rect.x)},${Math.round(rect.y)}${problems.length ? `, needs ${problems.join(', ')}` : ''}`];
  }
  const other = select(handle, item.apart);
  if (other.error) return [false, other.error];
  if (!other.ids.length) return [false, `${item.apart} matched nothing`];
  const second = handle.getBoundingClientRect(other.ids[0]);
  if (!second?.hasBox) return [false, `${item.apart} has no box`];
  const across = Math.min(rect.x + rect.width, second.x + second.width) - Math.max(rect.x, second.x);
  const down = Math.min(rect.y + rect.height, second.y + second.height) - Math.max(rect.y, second.y);
  const overlap = across > 0 && down > 0;
  return [!overlap, overlap ? `${selector} and ${item.apart} overlap by ${Math.round(across)}x${Math.round(down)}, needs apart` : `${selector} and ${item.apart} are apart`];
}

const drain = () => new Promise(resolve => setImmediate(resolve));

export async function openEngine({ dir, toolingWasmModules }) {
  const artifact = verifyArtifact(dir);
  if (artifact.status !== 'ready') throw new Error(`kitesurf artifact not usable (${artifact.reason}): run make browser-setup`);
  const { wasm, glue: source, sans, sansItalic, serif, mono } = artifact.bytes;
  const digest = sha256(wasm);
  if (!toolingWasmModules.some(entry => entry.sha256 === digest)) throw new Error(`kitesurf wasm ${digest} is not admitted by the cell's toolingWasmModules: run make browser-setup for the pinned artifact`);
  const glue = await import(`data:text/javascript;base64,${source.toString('base64')}`);
  let fetched = [], restores = 0;
  glue.__setBridgeFetchResource((id, url) => { fetched.push(url); });
  const exports = deterministic(() => glue.initSync({ module: new WebAssembly.Module(wasm) }));
  if (!deterministic(() => glue.register_ua_fonts(...[sans, sansItalic, serif, mono].map(bytes => new Uint8Array(bytes))))) throw new Error('kitesurf refused the UA fonts');
  const live = new Set();
  const open = html => { const handle = new glue.DomHandle(html, BASE_URL); live.add(handle); return handle; };
  const close = handle => { handle.free(); live.delete(handle); };
  const run = ({ html, viewport, expect, png = false }) => deterministic(() => {
    const handle = open(html);
    try {
      handle.setViewport(...viewport);
      const results = expect.map(item => { const [pass, observed] = assertion(handle, item, viewport); return { assertion: item, pass, observed }; });
      return { results, ...(png ? { png: glue.ks_render_html_to_png(html, BASE_URL, ...viewport) } : {}) };
    } finally { close(handle); }
  });
  run(PRIMER);
  await drain();
  const image = new Uint8Array(exports.memory.buffer).slice(), imageSha256 = sha256(image);
  const restore = () => {
    if (live.size) throw new Error(`${live.size} engine handle(s) live at restore: restore refused`);
    const memory = new Uint8Array(exports.memory.buffer);
    memory.set(image);
    memory.fill(0, image.length);
    restores += 1;
  };
  return {
    open, close,
    growth: () => ({ pages: exports.memory.buffer.byteLength / 65536, externrefs: exports.__wbindgen_externrefs.length, glueImports: 1, restores, image: imageSha256 }),
    async check(request) {
      fetched = [];
      restore();
      const { results, png } = run(request);
      await drain();
      if (fetched.length) results.push({ assertion: { fetch: 'none' }, pass: false, observed: `document requested ${fetched.length} resource(s): ${fetched.join(', ')}, needs none` });
      return { status: 'completed', pass: results.every(result => result.pass), results, fetches: fetched.length, ...(png ? { png } : {}) };
    },
  };
}

async function serve({ dir, policy: { wasmMemoryMaxMb, toolingWasmModules } }) {
  let current = null;
  installWasmLimit(wasmMemoryMaxMb, error => {
    if (current !== null) parentPort.postMessage({ id: current, status: 'outcome_unknown', reason: `engine fault: ${error}` });
    process.exit(18);
  }, [], [], toolingWasmModules);
  globalThis.fetch = url => Promise.reject(new Error(`browser engine refuses network requests: ${url}`));
  const started = performance.now();
  let engine;
  try { engine = await openEngine({ dir, toolingWasmModules }); } catch (error) { return parentPort.postMessage({ type: 'ready', error: error.message }); }
  parentPort.postMessage({ type: 'ready', ...engine.growth(), readyMs: performance.now() - started });
  parentPort.on('message', async request => {
    const begin = performance.now();
    let reply;
    current = request.id;
    try { reply = await engine.check(request); } catch (error) {
      parentPort.postMessage({ id: request.id, status: 'outcome_unknown', reason: `engine fault: ${error?.message ?? error}` });
      process.exit(1);
    }
    current = null;
    parentPort.postMessage({ id: request.id, ...reply, ...engine.growth(), ms: performance.now() - begin }, reply.png ? [reply.png.buffer] : []);
  });
}

if (parentPort && workerData?.kitesurfEngine) await serve(workerData.kitesurfEngine);
