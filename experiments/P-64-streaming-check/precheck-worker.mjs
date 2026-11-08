import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { compile, loadCompiler, x1Flags } from '../assemblyscript-toolchain.mjs';
import { ASC_PATH } from '../../tools/asc/pin.mjs';
import { runGates, testProblems } from '../../core/runtime/x1/gates.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';

const maximumKernelPages = 1024;
function declaredPages(bytes) {
  let p = 8;
  const uint = () => { let n = 0, shift = 0, b; do { b = bytes[p++]; n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; };
  while (p < bytes.length) {
    const section = bytes[p++], size = uint(), end = p + size;
    if (section === 5) {
      if (uint() !== 1) return null;
      const flags = uint(); uint();
      return flags & 1 ? uint() : null;
    }
    p = end;
  }
  return 0;
}
let cachedSource = null, cachedResult = null;
async function compiled(source) {
  if (source === cachedSource) return { result: cachedResult, ms: 0 };
  const begin = performance.now(), digest = hash(source);
  let result;
  try {
    const bytes = await compile({ name: 'kernel', source }, ASC_PATH, { flags: x1Flags });
    if (!bytes) result = { source: digest, error: 'compiler failed or timed out' };
    else {
      const pages = declaredPages(bytes);
      result = pages === null || pages > maximumKernelPages ? { source: digest, error: 'compiled memory exceeds the kernel limit' } : { source: digest, wasm: Buffer.from(bytes).toString('base64') };
    }
  } catch { result = { source: digest, error: 'compiler failed or timed out' }; }
  cachedSource = source; cachedResult = result;
  return { result, ms: performance.now() - begin };
}
const glueIndependent = ['G1_frozen', 'G2_compiles', 'G3_exports', 'G4_tests', 'G5_deterministic', 'G6_bounded', 'G8_nonfinite'];
const summary = result => result.promotable ? null : { gates: Object.fromEntries(Object.entries(result.gates).filter(([, gate]) => !gate.ok)), tests: (result.tests || []).filter(test => !test.pass).slice(0, 20) };

await loadCompiler(ASC_PATH);
let queue = Promise.resolve();
parentPort.on('message', message => { queue = queue.then(() => handle(message)); });
async function handle({ seq, kind, id, files }) {
  const begin = performance.now();
  try {
    if (kind === 'reset') { cachedSource = null; cachedResult = null; return parentPort.postMessage({ seq, kind, ms: 0 }); }
    if (kind === 'spec') {
      let tests = null, problems = [];
      if (!files['CONTRACT.md']?.trim()) problems.push('CONTRACT.md is empty');
      try { tests = JSON.parse(files['tests.json'] ?? ''); } catch { problems.push('tests.json is not JSON'); }
      if (tests !== null) problems.push(...testProblems(tests));
      const testsOnly = tests === null ? ['tests.json is not JSON'] : testProblems(tests);
      return parentPort.postMessage({ seq, kind, failed: problems.length > 0, refuse: testsOnly.length > 0, ms: performance.now() - begin, compileMs: 0 });
    }
    const { result: build, ms: compileMs } = await compiled(files['kernel.ts'] ?? '');
    const gates = runGates({ id, files, compiled: build });
    const failures = summary(gates);
    const refuse = Object.entries(gates.gates).some(([name, gate]) => glueIndependent.includes(name) && !gate.ok);
    parentPort.postMessage({ seq, kind, failed: Boolean(failures), refuse, failedGates: failures ? Object.keys(failures.gates) : [], ms: performance.now() - begin, compileMs });
  } catch (error) { parentPort.postMessage({ seq, kind, error: String(error?.message ?? error), ms: performance.now() - begin }); }
}
parentPort.postMessage({ ready: true });
