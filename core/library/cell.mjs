import { parentPort } from 'node:worker_threads';
import { runGates } from '../runtime/x1/gates.mjs';
import { installWasmLimit } from '../runtime/isolate-wasm.mjs';
import { discriminate, fingerprint } from './discriminate.mjs';
const engine = { Module: WebAssembly.Module, Instance: WebAssembly.Instance };
const limit = installWasmLimit(64, error => { parentPort.postMessage({ job: null, breach: error }); process.exit(18); });
const summary = result => ({ promotable: result.promotable === true, gates: Object.fromEntries(Object.entries(result.gates).map(([name, gate]) => [name, gate.ok])),
  wasmSha256: result.gates.G2_compiles?.wasmSha256 ?? null, failed: (result.tests ?? []).filter(t => !t.pass).map(t => t.name).slice(0, 5),
  failing: (result.tests ?? []).filter(t => !t.pass && (t.trap || typeof t.got === 'number' || typeof t.got === 'boolean')).map(t => t.trap ? { fn: t.fn, args: t.args, trap: true } : { fn: t.fn, args: t.args, got: t.got }).slice(0, 16) });
const operations = {
  qualify({ candidate, capability, numbers, gate }) {
    limit.begin();
    const result = summary(runGates(candidate));
    limit();
    if (!result.promotable || gate === 'none') return { ...result, discrimination: null };
    const bytes = Buffer.from(candidate.compiled.wasm, 'base64');
    return { ...result, discrimination: discriminate({ bytes, tests: JSON.parse(candidate.files['tests.json']), capability, numbers, engine }) };
  },
  fingerprint({ wasm, capability, numbers }) {
    return fingerprint({ bytes: Buffer.from(wasm, 'base64'), capability, numbers, engine });
  },
};
parentPort.on('message', ({ job, op, input }) => {
  try { parentPort.postMessage({ job, result: operations[op](input) }); }
  catch (error) { parentPort.postMessage({ job, error: String(error.message || error) }); }
});
parentPort.postMessage({ ready: true });
