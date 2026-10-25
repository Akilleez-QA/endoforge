// POST-HOC series (not in PRECOMMIT; added after the main run): same as node-resident.mjs but every
// instance's whole linear memory is written once, so all pages are committed. Shows the upper bound
// per instance when the kernel actually uses its memory. Appends to receipt/posthoc-v8-resident-touched.jsonl.
import fs from "node:fs";
const variant = process.argv[2]; const K = Number(process.argv[3]); const repeat = Number(process.argv[4] ?? 0);
const bytes = fs.readFileSync(new URL(`./build/${variant}.wasm`, import.meta.url));
const module = await WebAssembly.compile(bytes);
const vmrss = () => Number(/VmRSS:\s+(\d+) kB/.exec(fs.readFileSync("/proc/self/status", "utf8"))[1]) * 1024;
let warm = []; for (let i = 0; i < 20; i++) warm.push(new WebAssembly.Instance(module, {}));
warm = null; global.gc(); await new Promise((r) => setTimeout(r, 50)); global.gc();
const before = vmrss();
const live = new Array(K);
for (let i = 0; i < K; i++) { live[i] = new WebAssembly.Instance(module, {}); new Uint8Array(live[i].exports.memory.buffer).fill(1); }
global.gc(); await new Promise((r) => setTimeout(r, 50)); global.gc();
const after = vmrss();
const row = { host: "v8-node", series: "posthoc-touched-all-pages", variant, K, repeat, rssBefore: before, rssAfter: after, bytesPerInstanceRss: (after - before) / K, memoryBytesPerInstance: live[0].exports.memory.buffer.byteLength };
fs.appendFileSync(new URL("./receipt/posthoc-v8-resident-touched.jsonl", import.meta.url), JSON.stringify(row) + "\n");
console.log(JSON.stringify(row));
