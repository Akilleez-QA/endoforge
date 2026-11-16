import { realpathSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parentPort } from 'node:worker_threads';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { ARTIFACT_DIR, sha256, verifyArtifact } from './artifact.mjs';
import { KITESURF_COMMIT, KITESURF_CORE, WORKCELL } from './pin.mjs';

export const PROCESS_ONLY = 'browser jobs require process isolation';
export const NETWORK_REFUSED = 'browser workcells refuse network requests';
export const FIXED_TIME_MS = Date.UTC(2026, 0, 1);
const RANDOM_SEED = 0x6b697465;
const hostPort = fileURLToPath(import.meta.url);
const repository = fileURLToPath(new URL('../../', import.meta.url));
const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
let engine = null;
let instances = 0;

const requireProcess = () => { if (parentPort) throw new Error(PROCESS_ONLY); };
const refusedFetch = url => Promise.reject(new Error(`${NETWORK_REFUSED}: ${url}`));

export function refuseFetch(id, url) {
  throw new Error(`${NETWORK_REFUSED}: ${url}`);
}

export function browserCellFlags() {
  return [permissionFlag, `--allow-fs-read=${realpathSync(repository)}/*`, '--allow-worker'];
}

export function createBrowserPool({ isolation = 'process', size = 1, ...rest } = {}) {
  if (isolation !== 'process') throw new Error(PROCESS_ONLY);
  return new IsolatePool({ retireAfterJobs: 16, ...rest, hostPort, size, isolation, ...WORKCELL,
    warm: {}, cellFlags: browserCellFlags() });
}

function deterministic(run) {
  const { crypto } = globalThis, now = Date.now;
  let state = RANDOM_SEED;
  Date.now = () => FIXED_TIME_MS;
  crypto.getRandomValues = array => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      bytes[i] = state >>> 24;
    }
    return array;
  };
  try { return run(); } finally {
    Date.now = now;
    delete crypto.getRandomValues;
  }
}

async function instance() {
  const source = `${engine.glue}\nexport const __endoforgeInstance = ${++instances};\n`;
  const glue = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  deterministic(() => {
    glue.__setBridgeFetchResource(refuseFetch);
    glue.initSync({ module: engine.module });
    if (!glue.register_ua_fonts(...engine.fonts)) throw new Error('kitesurf refused the UA fonts');
  });
  return glue;
}

export async function warm({ dir = ARTIFACT_DIR } = {}) {
  requireProcess();
  if (engine) return;
  const artifact = verifyArtifact(dir);
  if (artifact.status !== 'ready') throw new Error(`kitesurf artifact not usable (${artifact.reason}): run make browser-setup`);
  const { wasm, glue, sans, sansItalic, serif, mono } = artifact.bytes;
  globalThis.fetch = refusedFetch;
  const started = performance.now();
  const module = new WebAssembly.Module(wasm);
  engine = { module, glue: glue.toString('utf8'), fonts: [sans, sansItalic, serif, mono].map(bytes => new Uint8Array(bytes)) };
  await instance();
  engine.readyMs = Math.round(performance.now() - started);
}

const dimension = value => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4096) throw new TypeError('width and height must be integers from 1 to 4096');
  return value;
};

export async function createPort({ html, width, height, baseUrl = 'https://kitesurf.local/' } = {}) {
  requireProcess();
  if (typeof html !== 'string') throw new TypeError('html must be a string');
  dimension(width);
  dimension(height);
  await warm();
  let last = null;
  return {
    async evaluate() {
      const glue = await instance();
      const started = performance.now();
      const png = deterministic(() => glue.ks_render_html_to_png(html, baseUrl, width, height));
      const renderMs = performance.now() - started;
      if (!png?.length) throw new Error('kitesurf returned no image');
      const view = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
      last = { sha256: sha256(view), bytes: png.length, width: view.readUInt32BE(16), height: view.readUInt32BE(20),
        renderMs: Math.round(renderMs * 10) / 10, readyMs: engine.readyMs, rssBytes: process.memoryUsage.rss() };
      return { stage: 'rendered', png, ...last };
    },
    evidence() {
      return last && { ...last, pin: { commit: KITESURF_COMMIT, wasm: KITESURF_CORE.sha256 } };
    },
  };
}
