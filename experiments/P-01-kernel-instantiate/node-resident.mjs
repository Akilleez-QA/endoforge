// V8 resident footprint per live instance. Fresh process per (variant, K).
// Usage: node --expose-gc node-resident.mjs <variant> <K> <repeat>
// Appends one JSON line to receipt/v8-resident.jsonl and prints it.
import fs from "node:fs";
import v8 from "node:v8";

const variant = process.argv[2];
const K = Number(process.argv[3]);
const repeat = Number(process.argv[4] ?? 0);
const bytes = fs.readFileSync(new URL(`./build/${variant}.wasm`, import.meta.url));
const imports = { env: { abort() { throw new Error("abort"); } } };
const module = await WebAssembly.compile(bytes);

function snap() {
  const m = process.memoryUsage();
  const h = v8.getHeapStatistics();
  const vmrss = Number(/VmRSS:\s+(\d+) kB/.exec(fs.readFileSync("/proc/self/status", "utf8"))[1]) * 1024;
  return { rss: m.rss, vmrss, heapUsed: m.heapUsed, external: m.external, arrayBuffers: m.arrayBuffers, mallocedMemory: h.malloced_memory };
}

// Warm-up so code and first-touch pages are already resident, then release them.
let warm = []; for (let i = 0; i < 20; i++) warm.push(new WebAssembly.Instance(module, imports));
warm = null; global.gc(); await new Promise((r) => setTimeout(r, 50)); global.gc();
const before = snap();

const live = new Array(K);
const t0 = process.hrtime.bigint();
for (let i = 0; i < K; i++) live[i] = new WebAssembly.Instance(module, imports);
const wallNs = Number(process.hrtime.bigint() - t0);
// Touch one byte of each instance's memory so the first page is actually committed (a store would do it anyway).
for (let i = 0; i < K; i++) live[i].exports.initState(0);
global.gc(); await new Promise((r) => setTimeout(r, 50)); global.gc();
const after = snap();

const delta = Object.fromEntries(Object.keys(before).map((k) => [k, after[k] - before[k]]));
const row = { host: "v8-node", variant, K, repeat, before, after, delta, bytesPerInstanceRss: delta.rss / K, bytesPerInstanceVmRss: delta.vmrss / K, bytesPerInstanceArrayBuffers: delta.arrayBuffers / K, wallNsTotal: wallNs, live: live.length };
fs.appendFileSync(new URL(`./receipt/v8-resident.jsonl`, import.meta.url), JSON.stringify(row) + "\n");
console.log(JSON.stringify({ variant, K, repeat, bytesPerInstanceRss: row.bytesPerInstanceRss, bytesPerInstanceArrayBuffers: row.bytesPerInstanceArrayBuffers, rssBefore: before.rss, rssAfter: after.rss }));
