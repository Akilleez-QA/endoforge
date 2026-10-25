// P-02 worker: a separate V8 isolate that loads the AssemblyScript compiler once and compiles
// kernel sources it receives over postMessage, using in-memory readFile/writeFile/listFiles.
import { parentPort } from "node:worker_threads";
import v8 from "node:v8";
import fs from "node:fs";

// Count any real filesystem use so we can prove the compiler does not touch the host fs.
const fsCalls = {};
function wrap(obj, name, label) {
  const orig = obj[name];
  if (typeof orig !== "function") return;
  obj[name] = function (...args) { fsCalls[label] = (fsCalls[label] ?? 0) + 1; return orig.apply(this, args); };
}
for (const n of ["readFile", "readdir", "writeFile", "mkdir", "stat", "access"]) wrap(fs.promises, n, `promises.${n}`);
for (const n of ["readFileSync", "readdirSync", "writeFileSync", "mkdirSync", "statSync", "existsSync", "accessSync"]) wrap(fs, n, n);
const fsCallsAtStart = { ...fsCalls };

const before = new Set(process.moduleLoadList);
const tLoad0 = process.hrtime.bigint();
const asc = await import("assemblyscript/asc");
const loadNs = Number(process.hrtime.bigint() - tLoad0);
const newlyLoaded = process.moduleLoadList.filter((m) => !before.has(m));
const fsCallsAfterLoad = { ...fsCalls };

function rss() { return Number(/VmRSS:\s+(\d+) kB/.exec(fs.readFileSync("/proc/self/status", "utf8"))[1]) * 1024; }
// rss() itself uses readFileSync; exclude those from the compiler's count by sampling before/after.

parentPort.postMessage({ type: "ready", loadNs, ascVersion: asc.version, newlyLoaded, fsCallsAfterLoad, heap: v8.getHeapStatistics(), rss: rss() });

parentPort.on("message", async (msg) => {
  if (msg.type === "exit") { parentPort.close(); return; }
  const { name, source, pass, noEmit } = msg;
  const files = { [`${name}.ts`]: source };
  const outputs = {};
  const diagnostics = [];
  const stderr = asc.createMemoryStream();
  const stdout = asc.createMemoryStream();
  const args = [`${name}.ts`, "-O3", "--runtime", "stub", "--noAssert", "--noColors"];
  if (noEmit) args.push("--noEmit"); else args.push("--outFile", "out.wasm");
  const heapBefore = v8.getHeapStatistics();
  const rssBefore = rss();
  const fsBefore = JSON.stringify(fsCalls);
  const t0 = process.hrtime.bigint();
  const result = await asc.main(args, {
    stdout, stderr,
    readFile: (f) => (Object.prototype.hasOwnProperty.call(files, f) ? files[f] : null),
    writeFile: (f, contents) => { outputs[f] = contents; },
    listFiles: () => [],
    reportDiagnostic: (d) => diagnostics.push({ code: d.code, category: d.category, message: d.message, start: d.range?.start, end: d.range?.end }),
  });
  const wallNs = Number(process.hrtime.bigint() - t0);
  const fsAfter = JSON.stringify(fsCalls);
  const heapAfter = v8.getHeapStatistics();
  const rssAfter = rss();
  parentPort.postMessage({
    type: "result", name, pass, noEmit, wallNs,
    ok: !result.error, error: result.error ? String(result.error.message) : null,
    diagnostics, wasmBytes: outputs["out.wasm"]?.length ?? null,
    stats: { parseTime: result.stats.parseTime, initializeTime: result.stats.initializeTime, compileTime: result.stats.compileTime, optimizeTime: result.stats.optimizeTime, emitTime: result.stats.emitTime, validateTime: result.stats.validateTime, readCount: result.stats.readCount, writeCount: result.stats.writeCount },
    heapUsedBefore: heapBefore.used_heap_size, heapUsedAfter: heapAfter.used_heap_size, heapTotalAfter: heapAfter.total_heap_size, externalAfter: heapAfter.external_memory,
    rssBefore, rssAfter, fsCallsDuringCompile: fsBefore === fsAfter ? 0 : { before: JSON.parse(fsBefore), after: JSON.parse(fsAfter) },
  });
});
