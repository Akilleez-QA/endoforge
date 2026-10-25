// V8 instantiate latency and per-call cost.
// Usage: node node-bench.mjs <variant> [N=2000]
// Writes receipt/v8-instantiate-<variant>.jsonl (one {i, ns} per line) and prints a summary JSON.
import fs from "node:fs";
import { summarize } from "./stats.mjs";

const variant = process.argv[2] ?? "kernel-stub-1p";
const N = Number(process.argv[3] ?? 2000);
const bytes = fs.readFileSync(new URL(`./build/${variant}.wasm`, import.meta.url));
const imports = { env: { abort() { throw new Error("abort"); } } };

const t0 = process.hrtime.bigint();
const module = await WebAssembly.compile(bytes);
const compileNs = Number(process.hrtime.bigint() - t0);

// Warm-up (untimed): 50 instantiations so the first-touch costs are not in the sample.
for (let i = 0; i < 50; i++) new WebAssembly.Instance(module, imports);

const keep = new Array(N);
const samples = new Array(N);
for (let i = 0; i < N; i++) {
  const a = process.hrtime.bigint();
  keep[i] = new WebAssembly.Instance(module, imports);
  const b = process.hrtime.bigint();
  samples[i] = Number(b - a);
}
const out = fs.createWriteStream(new URL(`./receipt/v8-instantiate-${variant}.jsonl`, import.meta.url));
for (let i = 0; i < N; i++) out.write(JSON.stringify({ i, ns: samples[i] }) + "\n");
out.end();

// Per-call cost on one resident instance: 10,000 timed `step` calls after 1,000 untimed.
const inst = keep[0];
const { step, initState, stateSize, eventSize, memory } = inst.exports;
const statePtr = 0, eventPtr = stateSize();
initState(statePtr);
const dv = new DataView(memory.buffer);
function writeEvent(kind, unitFrom, unitTo, flags, v, v2) {
  dv.setUint32(eventPtr + 0, kind, true); dv.setUint32(eventPtr + 4, unitFrom, true);
  dv.setUint32(eventPtr + 8, unitTo, true); dv.setUint32(eventPtr + 12, flags, true);
  dv.setFloat64(eventPtr + 16, v, true); dv.setFloat64(eventPtr + 24, v2, true);
}
const kinds = [1, 2, 3, 4];
for (let i = 0; i < 1000; i++) { writeEvent(kinds[i & 3], 1, 0, i, i * 0.5, 1); step(statePtr, eventPtr); }
const CALLS = 10000;
const callNs = new Array(CALLS);
for (let i = 0; i < CALLS; i++) {
  writeEvent(kinds[i & 3], 1, 0, i, i * 0.5, 1);
  const a = process.hrtime.bigint();
  step(statePtr, eventPtr);
  const b = process.hrtime.bigint();
  callNs[i] = Number(b - a);
}
const callOut = fs.createWriteStream(new URL(`./receipt/v8-call-${variant}.jsonl`, import.meta.url));
for (let i = 0; i < CALLS; i++) callOut.write(JSON.stringify({ i, ns: callNs[i] }) + "\n");
callOut.end();
const massAfter = inst.exports.readMass(statePtr);
const checksum = inst.exports.readChecksum(statePtr);

const summary = {
  host: "v8-node", node: process.version, variant, moduleBytes: bytes.length, compileNs,
  instantiateNs: summarize(samples), callNs: summarize(callNs),
  sanity: { massAfterKg: massAfter, checksum, eventSize: eventSize() },
};
fs.writeFileSync(new URL(`./receipt/v8-bench-${variant}.json`, import.meta.url), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
