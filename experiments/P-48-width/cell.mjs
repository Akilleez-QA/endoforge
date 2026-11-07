import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { installWasmLimit } from '../../core/runtime/isolate-wasm.mjs';
import { WORKCELL } from '../../tools/tscheck/pin.mjs';

const config = workerData ?? JSON.parse(process.argv[2]);
const send = message => parentPort ? parentPort.postMessage(message) : process.send(message);
const channel = parentPort ?? process;
installWasmLimit(WORKCELL.wasmMemoryMaxMb, () => process.exit(18), WORKCELL.trustedWasmModules, config.shared ?? []);
let work;
if (config.kind === 'compiler') {
  const { typecheck } = await import('../../tools/tscheck/checker.mjs');
  const project = JSON.parse(readFileSync(config.projectFile, 'utf8'));
  await typecheck({ root: '/warm', files: { '/warm/a.ts': 'export const n: number = 1;\n' }, tsconfig: { compilerOptions: { strict: true, noLib: true, types: [] }, files: ['./a.ts'] } });
  work = async () => { const r = await typecheck(project); return { wallMs: r.wallMs, diagnostics: r.diagnostics.length }; };
} else if (config.kind === 'touch') {
  work = async () => {
    const started = performance.now();
    const memory = new WebAssembly.Memory({ initial: 1792, maximum: 1792 });
    const view = new Uint8Array(memory.buffer);
    for (let i = 0; i < view.length; i += 4096) view[i] = 1;
    return { wallMs: Math.round(performance.now() - started) };
  };
} else if (config.kind === 'frozen') {
  const { requireFrozen } = await import('../../core/engine/evaluator.mjs');
  work = async () => { const started = performance.now(); await requireFrozen(config.reference); return { wallMs: Math.round(performance.now() - started) }; };
} else {
  work = async () => {
    const started = performance.now();
    let x = 1;
    for (let i = 0; i < 2e8; i++) x = (x * 31 + i) | 0;
    return { wallMs: Math.round(performance.now() - started), x };
  };
}
channel.once('message', async () => {
  const rows = [];
  for (let i = 0; i < config.units; i++) rows.push(await work());
  send({ rows });
  if (!parentPort) process.exit(0);
});
send({ ready: true });
