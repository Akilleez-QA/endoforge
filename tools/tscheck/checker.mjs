import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TSRS_CORE_SHA256, TSRS_MODULE } from './pin.mjs';

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

export async function typecheck(project, { emit = false, vendor = VENDOR } = {}) {
  const key = String(vendor);
  const warm = loaded.has(key);
  if (!warm) loaded.set(key, await load(vendor));
  const { core, module, compileMs } = loaded.get(key);
  const files = project.tsconfig ? { ...project.files, [`${project.root}/tsconfig.json`]: JSON.stringify(project.tsconfig) } : project.files;
  const host = core.memoryFileSystem(files);
  const text = new TextDecoder();
  let stderr = '';
  const started = performance.now();
  const result = core.runTsc(module,
    core.makeRequest(['-p', `${project.root}/tsconfig.json`, '--pretty', 'false', ...(emit ? [] : ['--noEmit'])], { cwd: project.root, json: true }),
    host, { env: {}, stdout: () => {}, stderr: chunk => { stderr += text.decode(chunk); } });
  const wallMs = Math.round(performance.now() - started);
  if (result.exitCode === core.EXIT_CRASHED) throw new Error(`tsrs trapped: ${stderr.slice(0, 300)}`);
  const diagnostics = core.parseReply(result.reply).map(d => ({
    file: d.fileName ?? null,
    line: d.startPosition ? d.startPosition.line + 1 : 0,
    column: d.startPosition ? d.startPosition.character + 1 : 0,
    code: d.code,
    text: d.text,
  }));
  if (result.exitCode !== 0 && !diagnostics.length) throw new Error(`tsrs failed without diagnostics: ${stderr.slice(0, 300)}`);
  const written = Object.fromEntries(host.written);
  return {
    compiler: { name: TSRS_MODULE.name, sha256: TSRS_MODULE.sha256 },
    exitCode: result.exitCode,
    diagnostics,
    warm,
    compileMs: warm ? 0 : compileMs,
    wallMs,
    memoryBytes: result.memoryBytes,
    artifact: emit && !diagnostics.length
      ? { files: written, sha256: Object.fromEntries(Object.entries(written).map(([path, value]) => [path, sha256(value)])) }
      : null,
  };
}
