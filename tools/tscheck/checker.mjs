import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TSRS_CORE_SHA256, TSRS_MODULE } from './pin.mjs';
import { runCheck } from './check-core.mjs';

export { HOST_OPTIONS } from './check-core.mjs';

const VENDOR = new URL('node_modules/@tsrs/wasm/', import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const loaded = new Map();
async function load(vendor) {
  const modulePath = fileURLToPath(new URL('tsrs.wasm', vendor));
  const corePath = new URL('core.js', vendor);
  if (!existsSync(modulePath) || !existsSync(corePath)) throw new Error('tsrs is not installed: run make tscheck-setup');
  const bytes = readFileSync(modulePath);
  if (sha256(bytes) !== TSRS_MODULE.sha256) throw new Error('tsrs module hash does not match the pin');
  if (sha256(readFileSync(corePath)) !== TSRS_CORE_SHA256) throw new Error('tsrs core hash does not match the pin');
  const started = performance.now();
  const core = await import(corePath);
  return { core, module: new WebAssembly.Module(bytes), compileMs: Math.round(performance.now() - started) };
}

export async function warm({ vendor = VENDOR } = {}) {
  if (!loaded.has(String(vendor))) loaded.set(String(vendor), await load(vendor));
}

export async function typecheck(project, { emit = false, vendor = VENDOR, buildInfo } = {}) {
  if (emit && buildInfo !== undefined) throw new Error('emit needs a full check');
  const key = String(vendor);
  const warm = loaded.has(key);
  if (!warm) loaded.set(key, await load(vendor));
  const { core, module, compileMs } = loaded.get(key);
  const { wallMs, ...report } = runCheck({ core, module, compiler: TSRS_MODULE }, project, { emit, buildInfo });
  return { ...report, warm, compileMs: warm ? 0 : compileMs, wallMs };
}
