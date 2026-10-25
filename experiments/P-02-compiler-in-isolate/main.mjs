// P-02 main thread: reads the 20 kernel sources, spawns one Worker (separate V8 isolate),
// drives 3 emit passes + 1 noEmit pass, and writes one JSON line per compile.
// Usage: node main.mjs [--out receipt/compile.jsonl] [--label host|bwrap]
// With --stdout, rows go to stdout instead (used under bwrap where the probe dir is read-only).
import fs from "node:fs";
import { Worker } from "node:worker_threads";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const toStdout = argv.includes("--stdout");
const label = opt("--label", "host");
const outPath = opt("--out", `receipt/compile-${label}.jsonl`);
const dir = new URL("./", import.meta.url);

const manifest = JSON.parse(fs.readFileSync(new URL("kernels/manifest.json", dir), "utf8"));
const sources = Object.fromEntries(manifest.map((m) => [m.name, fs.readFileSync(new URL(`kernels/${m.name}.ts`, dir), "utf8")]));

const sink = toStdout ? process.stdout : fs.createWriteStream(new URL(outPath, dir));
const emit = (row) => sink.write(JSON.stringify({ label, ...row }) + "\n");

const rssMain = () => Number(/VmRSS:\s+(\d+) kB/.exec(fs.readFileSync("/proc/self/status", "utf8"))[1]) * 1024;
emit({ type: "process", rssBeforeWorker: rssMain(), node: process.version, pid: process.pid, cwd: process.cwd(), sandbox: label });

const tSpawn = process.hrtime.bigint();
const worker = new Worker(new URL("worker.mjs", dir));
const plan = [];
for (const pass of [0, 1, 2]) for (const m of manifest) plan.push({ name: m.name, pass, noEmit: false });
for (const m of manifest) plan.push({ name: m.name, pass: 3, noEmit: true });
let idx = 0;
function next() {
  if (idx >= plan.length) { emit({ type: "done", rssAfterAll: rssMain(), compiles: plan.length }); worker.postMessage({ type: "exit" }); return; }
  const p = plan[idx++];
  worker.postMessage({ type: "compile", name: p.name, source: sources[p.name], pass: p.pass, noEmit: p.noEmit });
}
worker.on("message", (msg) => {
  if (msg.type === "ready") {
    emit({ type: "ready", spawnToReadyNs: Number(process.hrtime.bigint() - tSpawn), loadNs: msg.loadNs, ascVersion: msg.ascVersion, newlyLoadedBuiltins: msg.newlyLoaded.filter((m) => m.startsWith("NativeModule") || m.startsWith("Internal Binding")), newlyLoadedCount: msg.newlyLoaded.length, fsCallsAfterLoad: msg.fsCallsAfterLoad, workerHeapUsed: msg.heap.used_heap_size, workerHeapTotal: msg.heap.total_heap_size, rss: msg.rss });
    next();
  } else if (msg.type === "result") {
    const m = manifest.find((x) => x.name === msg.name);
    emit({ type: "compile", expectTypeError: m.expectTypeError, lines: m.lines, ...msg, type: "compile" });
    next();
  }
});
worker.on("error", (e) => { emit({ type: "worker-error", error: String(e && e.stack || e) }); process.exitCode = 1; });
worker.on("exit", (code) => { emit({ type: "worker-exit", code }); if (!toStdout) sink.end(); });
