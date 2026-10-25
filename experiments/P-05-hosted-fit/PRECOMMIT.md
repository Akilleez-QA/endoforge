# P-05 hosted-fit — precommit

Label: **Recorded (probe)**. Not a campaign; not an X6 verdict.

## Question

Does tsc-rs as WebAssembly, plus a minimal harness shim, plus one kernel module instance, fit inside a Cloudflare-Workers-like 128 MB isolate when run under **workerd on this desktop**, and how does a 50-file overlay type-check under it compare to the same check native?

## Unknown it de-risks

- Edition 3 §13 risk 2 ("The Workers memory ceiling… Neither number exists yet") and Experiment 6 (hosted fit: working set against 128 MB; 50-file overlay check against native; bad sign = over the memory limit or more than 3× native) [`sources/text/Endoforge-Edition-3.txt` §13, X6 table].
- R12 §4.3 notes a tsc-rs WASM check spends ~70 % of a solo check on parsing the embedded lib and that per active attempt memory was 57–81 MiB in the lab's development measurement; R12 §4.2 records that workerd's limit enforcer is null at the tested version.
- Errata E3-18/E3-20 (the 128 MB ceiling and 10 MB compressed size limit are stated without an evidence label).
- RISK-02 in the experiments README table.

## Procedure

1. **Artifacts.** Copy `ts_rust.size.wasm`, `ts_rust.speed.wasm` (recorded only) and `core.js` from `~/Work/isolate-factory-lab-cache/out-rust-1.95.0/` into `.tools/`, verifying against the cache `SHA256SUMS`. Reuse the lab's workerd binary by path (`isolate-factory-lab/adapters/executors/workerd/node_modules/@cloudflare/workerd-linux-64/bin/workerd`); record `workerd --version` and its sha256. Build a minimal kernel `.wasm` by hand-assembling bytes (no `wat2wasm` on this machine): one exported `add(i32,i32)->i32`.
2. **Worker.** `worker/shim.js` is an ES module Worker: imports `core.js` (the upstream runtime-independent glue the lab adapter uses), the tsc-rs size build as a `wasm` module binding and the kernel `.wasm` as a second `wasm` module binding. `POST /check` with JSON `{files, cwd, args}` instantiates the kernel once, calls it, builds an in-memory indexed HostFileSystem (copied from the lab's `adapters/checkers/tscrs-wasm/host.mjs`), runs `core.runTsc(module, …)` and returns diagnostics plus in-isolate timing (`performance.now()`, which workerd coarsens). `POST /alloc` grows a WASM memory or a JS array by a requested size, to test whether a configured limit is enforced.
3. **Config.** `worker/config.capnp`: one worker service, an HTTP socket on `127.0.0.1:<port>`, `v8Flags = ["--max-old-space-size=128"]`, `compatibilityDate = "2026-09-01"`.
4. **Overlays.** `gen-overlay.mjs` (seeded, deterministic) writes a 50-file project (~50–100 lines each, cross-imports, 5 deliberate type errors) and a 5-file project (1 deliberate error). Compiler options: `strict`, `target es2022`, `module esnext`, `moduleResolution bundler`, `lib ["es2022"]`, `types []`, `noEmit`, `skipLibCheck`. Both WASM and native are the same tsc-rs commit and embed/ship identical lib bytes (lab CHECKERS.md "Lib diff"), so default libs are used.
5. **Measurement under workerd.** Spawn workerd with the config. Sample `/proc/<pid>/status` VmRSS and VmHWM at (a) idle after the socket answers, (b) after the first 5-file check (module loaded and instantiated once), (c) after the 50-file latency series. Latency: 3 warm-ups then n = 20 requests for the 5-file project, then 3 warm-ups and n = 20 for the 50-file project; record host wall time per request and the in-isolate time. gzip -9 the bundle (shim + core.js + size .wasm + kernel .wasm) and record compressed size against 10 MB.
6. **Limit enforcement.** `POST /alloc` asking for 256 MiB of WASM linear memory, then 200 MiB of JS heap in a fresh workerd process; record whether workerd refused, crashed the process or returned success, and RSS after.
7. **Node comparator.** The same `core.js` + size `.wasm` in plain Node (caller thread), n = 20 after 3 warm-ups, for both projects.
8. **Native comparator.** `tscrs-wasm/vendor/native/tsc` (sha256 `e0245214…`, byte-identical to the cache `tsc`, with the libs it needs beside it) on the same projects staged to a tmpfs directory, `tsc -p <dir> --singleThreaded --pretty false`, process per check, n = 20 after 3 warm-ups. Also n = 20 with default threads, as a secondary.
9. Sanity: diagnostics (count and codes) must agree across workerd, Node and native for both projects, otherwise the comparison is void.

## Metrics

- RSS (VmRSS) and peak (VmHWM) of the workerd process at idle, after load, after 50-file series; against 128 MiB.
- Latency median, p95, min, max, n for each (runtime × project) cell; WASM-in-workerd / native and WASM-in-node / native ratios on the 50-file median.
- Compressed bundle size against 10 MB.
- Whether a configured limit was enforced (yes/no, and how it failed).

## Bad signs (E3 X6)

- workerd RSS or peak above 128 MiB after the 50-file check.
- WASM-in-workerd 50-file median latency more than 3× native single-threaded.
- Compressed bundle above 10 MB.

## Stop rule

Stop and record if workerd fails to load the module, if the shim cannot complete a 50-file check, or if any one request exceeds 60 s. Shared desktop: load average is recorded before and after; no quiet gate.

## What this cannot show

This is workerd 2026-09-30 on a desktop, not Cloudflare's production platform. Production memory accounting (per-isolate, including WASM) and enforcement differ from a single workerd process's RSS, which includes the V8 runtime, the HTTP server and the module compilation cache. RSS is an upper bound on the isolate's footprint, not the isolate's footprint.
