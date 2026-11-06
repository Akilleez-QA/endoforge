import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TSRS_CORE_SHA256, TSRS_MODULE } from './pin.mjs';

const VENDOR = new URL('node_modules/@tsrs/wasm/', import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const loaded = new Map();
const SOURCE = /\.(?:ts|tsx|mts|cts)$/i;
const DECLARATION = /\.d\.(?:ts|mts|cts)$|\.d\.[^./]+\.ts$/i;
const EXTERNAL = /(?:^|\/)node_modules\//;
const text = value => typeof value === 'string' ? value : Buffer.from(value).toString('latin1').replaceAll('\0', '');

export const HOST_OPTIONS = Object.freeze(['--noCheck', 'false', '--noResolve', 'false', '--composite', 'false', '--incremental', 'false']);
const LIST_PROGRAM = Object.freeze(['--listFiles', '--traceResolution', 'false', '--explainFiles', 'false']);

function refuseInputs(files) {
  for (const path of Object.keys(files)) {
    if (/\.tsbuildinfo$/i.test(path)) throw new Error(`build info is not accepted as input: ${path}`);
    if (/[\r\n]/.test(path)) throw new Error(`a project path has a newline: ${JSON.stringify(path)}`);
  }
}

function checkedSources(files, program) {
  const sources = Object.keys(files).map(path => [posix.normalize(path), path]).filter(([path]) => SOURCE.test(path) && !DECLARATION.test(path));
  const outside = sources.filter(([path]) => !program.has(path) && !EXTERNAL.test(path)).map(([path]) => path);
  if (outside.length) throw new Error(`not a full check: project sources outside the program: ${outside.slice(0, 5).join(', ')}`);
  const checked = sources.filter(([path]) => program.has(path));
  if (!checked.length) throw new Error('not a full check: no TypeScript source in the program');
  const unchecked = checked.filter(([, path]) => /@ts-nocheck/i.test(text(files[path]))).map(([path]) => path);
  if (unchecked.length) throw new Error(`not a full check: @ts-nocheck in ${unchecked.slice(0, 5).join(', ')}`);
  return checked.length;
}

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
  refuseInputs(project.files);
  const files = project.tsconfig ? { ...project.files, [`${project.root}/tsconfig.json`]: JSON.stringify(project.tsconfig) } : project.files;
  const host = core.memoryFileSystem(files);
  const decoder = new TextDecoder();
  let stdout = '';
  let stderr = '';
  const started = performance.now();
  const result = core.runTsc(module,
    core.makeRequest(['-p', `${project.root}/tsconfig.json`, '--pretty', 'false', ...HOST_OPTIONS, ...LIST_PROGRAM, ...(emit ? [] : ['--noEmit'])], { cwd: project.root, json: true }),
    host, { env: {}, stdout: chunk => { stdout += decoder.decode(chunk, { stream: true }); }, stderr: chunk => { stderr += decoder.decode(chunk); } });
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
  const clean = !diagnostics.length;
  const sources = clean ? checkedSources(files, new Set(stdout.split('\n'))) : null;
  if (emit && clean && !host.written.size) throw new Error('emit produced no files');
  return {
    compiler: { name: TSRS_MODULE.name, sha256: TSRS_MODULE.sha256 },
    exitCode: result.exitCode,
    diagnostics,
    warm,
    compileMs: warm ? 0 : compileMs,
    wallMs,
    memoryBytes: result.memoryBytes,
    checkedSources: sources,
    artifact: emit && clean
      ? { files: written, sha256: Object.fromEntries(Object.entries(written).map(([path, value]) => [path, sha256(value)])) }
      : null,
  };
}
