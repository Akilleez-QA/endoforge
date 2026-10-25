// Wasmtime CLI cold start, process start included. n=200 per series.
// Series: /bin/true floor; wasmtime run (compile+instantiate+call); wasmtime run of precompiled .cwasm.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { summarize } from "./stats.mjs";

const N = Number(process.argv[2] ?? 200);
const WT = new URL("./.tools/wasmtime", import.meta.url).pathname;
const WASM = new URL("./build/kernel-stub-1p.wasm", import.meta.url).pathname;
const CWASM = new URL("./build/kernel-stub-1p.cwasm", import.meta.url).pathname;

// Precompile once (setup for series 3, not timed).
spawnSync(WT, ["compile", "-o", CWASM, WASM], { stdio: "inherit" });

const series = {
  "bin-true": ["/bin/true", []],
  "wasmtime-run-wasm": [WT, ["run", "--invoke", "stateSize", WASM]],
  "wasmtime-run-cwasm": [WT, ["run", "--allow-precompiled", "--invoke", "stateSize", CWASM]],
};
const result = { host: "wasmtime-cli", version: spawnSync(WT, ["--version"], { encoding: "utf8" }).stdout.trim(), n: N, series: {} };
for (const [name, [cmd, args]] of Object.entries(series)) {
  // 5 untimed warm-ups (page cache).
  for (let i = 0; i < 5; i++) spawnSync(cmd, args, { stdio: "ignore" });
  const ns = [];
  let lastOut = "";
  for (let i = 0; i < N; i++) {
    const a = process.hrtime.bigint();
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    const b = process.hrtime.bigint();
    if (r.status !== 0) throw new Error(`${name} failed: ${r.stderr}`);
    ns.push(Number(b - a));
    lastOut = (r.stdout || "").trim();
  }
  fs.writeFileSync(new URL(`./receipt/cli-cold-${name}.jsonl`, import.meta.url), ns.map((v, i) => JSON.stringify({ i, ns: v })).join("\n") + "\n");
  result.series[name] = { ...summarize(ns), lastStdout: lastOut };
  console.log(name, JSON.stringify(result.series[name]));
}
result.cwasmBytes = fs.statSync(CWASM).size;
fs.writeFileSync(new URL("./receipt/cli-cold.json", import.meta.url), JSON.stringify(result, null, 2));
