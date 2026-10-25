// Build receipt/summary.json from the raw P-02 receipts.
import fs from "node:fs";
import { summarize } from "./stats.mjs";
const R = new URL("./receipt/", import.meta.url);
const exists = (f) => fs.existsSync(new URL(f, R));
const jsonl = (f) => fs.readFileSync(new URL(f, R), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const ms = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === "n" ? v : +(v / 1e6).toFixed(3)]));
const out = { generatedAt: new Date().toISOString(), runs: {} };
for (const label of ["host", "bwrap"]) {
  const f = `compile-${label}.jsonl`;
  if (!exists(f)) { out.runs[label] = { present: false }; continue; }
  const rows = jsonl(f);
  const ready = rows.find((r) => r.type === "ready");
  const compiles = rows.filter((r) => r.type === "compile");
  const proc = rows.find((r) => r.type === "process");
  const done = rows.find((r) => r.type === "done");
  const errs = rows.filter((r) => r.type === "worker-error");
  const sel = (pred) => compiles.filter(pred).map((r) => r.wallNs);
  const clean = (r) => !r.expectTypeError;
  const run = {
    present: true, workerErrors: errs, completedCompiles: compiles.length, loadMs: ready ? +(ready.loadNs / 1e6).toFixed(1) : null, spawnToReadyMs: ready ? +(ready.spawnToReadyNs / 1e6).toFixed(1) : null,
    ascVersion: ready?.ascVersion, builtinsLoadedByAsc: ready?.newlyLoadedBuiltins, fsCallsAfterLoad: ready?.fsCallsAfterLoad,
    rssBeforeWorker: proc?.rssBeforeWorker, rssAfterCompilerLoad: ready?.rss, rssAfterAll: done?.rssAfterAll, workerHeapUsedAfterLoad: ready?.workerHeapUsed,
    compileMs: {
      "pass0-first-use-clean": ms(summarize(sel((r) => r.pass === 0 && clean(r)))),
      "pass0-first-compile-k00": compiles[0] ? +(compiles[0].wallNs / 1e6).toFixed(3) : null,
      "pass1-2-warm-clean": ms(summarize(sel((r) => (r.pass === 1 || r.pass === 2) && clean(r)))),
      "pass1-2-warm-typeerror": ms(summarize(sel((r) => (r.pass === 1 || r.pass === 2) && !clean(r)))),
      "pass3-noEmit-clean": ms(summarize(sel((r) => r.pass === 3 && clean(r)))),
      "pass3-noEmit-typeerror": ms(summarize(sel((r) => r.pass === 3 && !clean(r)))),
    },
    perKernelWarmMedianMs: Object.fromEntries([...new Set(compiles.map((r) => r.name))].map((n) => { const xs = compiles.filter((r) => r.name === n && (r.pass === 1 || r.pass === 2)).map((r) => r.wallNs / 1e6).sort((a, b) => a - b); const row = compiles.find((r) => r.name === n); return [n, { lines: row.lines, wasmBytes: row.wasmBytes, typeError: row.expectTypeError, medianMs: xs.length ? +xs[Math.floor((xs.length - 1) / 2)].toFixed(3) : null, ok: row.ok, diagnostics: row.diagnostics.length }]; })),
    workerHeapUsedBytes: { afterFirstCompile: compiles[0]?.heapUsedAfter, afterPass0: compiles[19]?.heapUsedAfter, afterPass1: compiles[39]?.heapUsedAfter, afterPass2: compiles[59]?.heapUsedAfter, afterNoEmitPass: compiles[79]?.heapUsedAfter, maxDuring: Math.max(...compiles.map((r) => r.heapUsedAfter)) },
    rssBytes: { afterFirstCompile: compiles[0]?.rssAfter, max: Math.max(...compiles.map((r) => r.rssAfter)) },
    fsCallsDuringCompiles: compiles.filter((r) => r.fsCallsDuringCompile !== 0).length,
    typeErrorKernelsFailedAsExpected: compiles.filter((r) => r.expectTypeError).every((r) => !r.ok && r.diagnostics.length > 0),
    cleanKernelsSucceeded: compiles.filter((r) => !r.expectTypeError && r.pass < 3).every((r) => r.ok && r.wasmBytes > 0),
    phaseMedianMsWarm: Object.fromEntries(["parseTime", "initializeTime", "compileTime", "optimizeTime", "emitTime", "validateTime"].map((k) => [k, ms(summarize(compiles.filter((r) => (r.pass === 1 || r.pass === 2) && clean(r)).map((r) => r.stats[k]))).median])),
  };
  out.runs[label] = run;
}
if (exists("bwrap-config.txt")) out.bwrapConfig = fs.readFileSync(new URL("bwrap-config.txt", R), "utf8");
if (exists("bwrap-stderr.txt")) out.bwrapStderr = fs.readFileSync(new URL("bwrap-stderr.txt", R), "utf8");
if (exists("deps-check.json")) out.depsCheck = JSON.parse(fs.readFileSync(new URL("deps-check.json", R), "utf8"));
fs.writeFileSync(new URL("summary.json", R), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
