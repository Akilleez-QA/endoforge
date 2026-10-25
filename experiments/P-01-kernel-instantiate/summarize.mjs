// Build receipt/summary.json from the raw receipts.
import fs from "node:fs";
import { summarize } from "./stats.mjs";
const R = new URL("./receipt/", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, R), "utf8");
const exists = (f) => fs.existsSync(new URL(f, R));
const jsonl = (f) => read(f).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const nsCol = (f) => jsonl(f).map((r) => r.ns);
const toUs = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === "n" ? v : +(v / 1000).toFixed(3)]));
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor((a.length - 1) / 2)]; };

const out = { generatedAt: new Date().toISOString(), modules: JSON.parse(read("wasm-modules.json")), instantiateUs: {}, callNs: {}, residentBytesPerInstance: {}, cliColdMs: null, notes: [] };

for (const v of ["kernel-stub-1p", "kernel-stub-16p"]) {
  out.instantiateUs[`v8:${v}`] = toUs(summarize(nsCol(`v8-instantiate-${v}.jsonl`)));
  if (exists(`wasmtime-instantiate-${v}.jsonl`)) out.instantiateUs[`wasmtime-crate:${v}`] = toUs(summarize(nsCol(`wasmtime-instantiate-${v}.jsonl`)));
  if (exists(`wasmtime-pooling-instantiate-${v}.jsonl`)) out.instantiateUs[`wasmtime-crate-pooling:${v}`] = toUs(summarize(nsCol(`wasmtime-pooling-instantiate-${v}.jsonl`)));
}
out.callNs["v8:kernel-stub-1p"] = summarize(nsCol("v8-call-kernel-stub-1p.jsonl"));
if (exists("wasmtime-call-kernel-stub-1p.jsonl")) out.callNs["wasmtime-crate:kernel-stub-1p"] = summarize(nsCol("wasmtime-call-kernel-stub-1p.jsonl"));
out.v8CompileNs = Object.fromEntries(["kernel-stub-1p", "kernel-stub-16p"].map((v) => [v, JSON.parse(read(`v8-bench-${v}.json`)).compileNs]));

// Resident: group by (host, pooling, variant, K); report median-of-3 of bytes/instance, plus each repeat.
const rows = jsonl("v8-resident.jsonl").map((r) => ({ host: "v8", variant: r.variant, K: r.K, bpi: r.bytesPerInstanceRss, bpiAb: r.bytesPerInstanceArrayBuffers, rssBefore: r.before.rss, rssAfter: r.after.rss }));
if (exists("wasmtime-resident.jsonl")) for (const r of jsonl("wasmtime-resident.jsonl")) rows.push({ host: r.pooling ? "wasmtime-crate-pooling" : "wasmtime-crate", variant: r.variant, K: r.K, bpi: r.bytesPerInstanceRss, rssBefore: r.rssBefore, rssAfter: r.rssAfter });
const groups = {};
for (const r of rows) { const k = `${r.host}:${r.variant}:K=${r.K}`; (groups[k] ??= []).push(r); }
for (const [k, g] of Object.entries(groups)) {
  out.residentBytesPerInstance[k] = { n: g.length, medianBytesPerInstance: Math.round(median(g.map((r) => r.bpi))), repeats: g.map((r) => Math.round(r.bpi)), rssBeforeMedian: median(g.map((r) => r.rssBefore)), rssAfterMedian: median(g.map((r) => r.rssAfter)), ...(g[0].bpiAb !== undefined ? { medianArrayBuffersPerInstance: Math.round(median(g.map((r) => r.bpiAb))) } : {}) };
}
if (exists("cli-cold.json")) {
  const c = JSON.parse(read("cli-cold.json"));
  out.cliColdMs = Object.fromEntries(Object.entries(c.series).map(([k, s]) => [k, { n: s.n, median: +(s.median / 1e6).toFixed(3), p95: +(s.p95 / 1e6).toFixed(3), min: +(s.min / 1e6).toFixed(3), max: +(s.max / 1e6).toFixed(3) }]));
  out.cwasmBytes = c.cwasmBytes;
}
for (const v of ["kernel-stub-1p", "kernel-stub-16p"]) if (exists(`wasmtime-instantiate-${v}.meta.json`)) out[`wasmtimeCompileNs:${v}`] = JSON.parse(read(`wasmtime-instantiate-${v}.meta.json`)).compileNs;
if (exists("rust-host-missing.txt")) out.notes.push("Rust host was not built; wasmtime crate numbers absent.");
fs.writeFileSync(new URL("summary.json", R), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
