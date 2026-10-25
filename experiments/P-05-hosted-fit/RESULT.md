# P-05 hosted-fit — result

Label: **Recorded (probe)**. Run 2026-10-17 on the Main-rig (AMD Ryzen 9 7950X, 32 threads, 125 GiB, Linux 7.2.5-3-omarchy), a shared desktop with load average 15.2 before and 15.9 after the final run. Not a campaign; not an X6 verdict. Precommit sha256 `55071876…be55a1c9` (`receipt/precommit.sha256`), hashed before the first measurement.

**This is workerd 2026-09-30 (npm `workerd` 1.20260930.1, sha256 `6f34c231…`) running as one process on a desktop. It is not Cloudflare's production platform. Production accounts memory per isolate (JS heap plus WebAssembly allocations) with its own enforcer; here the only observable is the RSS of the whole workerd process, which includes V8 itself, the HTTP server, 17 threads and the compiled module. Memory accounting and enforcement differ; treat every memory figure below as an upper bound on the isolate's footprint, not as the footprint.**

## Question

Does tsc-rs as WebAssembly plus a minimal harness shim plus one kernel module instance fit a Cloudflare-Workers-like 128 MB isolate under workerd, and how does a 50-file overlay type-check compare to native?

## Procedure as run

- Artifacts: tsc-rs v0.7.0 (`3644f32`) built from source by the lab with Rust 1.95.0 — `ts_rust.size.wasm` 5,214,613 B sha256 `d96d8d53…`, `core.js` 14,114 B sha256 `6ee571b4…` — copied from `~/Work/isolate-factory-lab-cache/out-rust-1.95.0/` after `sha256sum -c SHA256SUMS` (`setup.sh`). Kernel: a 41-byte hand-assembled module exporting `add(i32,i32)->i32` (no `wat2wasm` on this machine), sha256 `f61fd62f…`.
- Worker (`worker/shim.js`, `worker/config.capnp`): ES module importing `core.js` (upstream `npm/wasm/core.js`, the same glue the lab adapter `isolate-factory-lab/adapters/checkers/tscrs-wasm/index.mjs` uses), the size build as a `wasm` module binding, and `kernel.wasm` as a second `wasm` module binding. The indexed in-memory HostFileSystem is copied verbatim from the lab's `adapters/checkers/tscrs-wasm/host.mjs`. `POST /check {files, cwd, args}` instantiates the kernel once, calls it, runs `core.runTsc(module, {fs, args, cwd, diagnosticsJson: true})` and returns diagnostics plus `performance.now()` deltas (workerd coarsens them to whole milliseconds). `v8Flags = ["--max-old-space-size=128"]`, `compatibilityDate = "2026-09-01"`, HTTP on `127.0.0.1:48517`.
- Overlays (`gen-overlay.mjs`, seed 20261017): 50 modules of 58–89 lines (131,497 B; JSON request body 138,384 B) with 2–3 cross-imports each and 5 deliberate `TS2322` errors; 5 modules (11,774 B) with 1 error. Options: `strict`, `target es2022`, `module esnext`, `moduleResolution bundler`, `lib ["es2022"]`, `types []`, `noEmit`, `skipLibCheck`. Default libs were used because WASM and native are the same tsc-rs commit and ship identical lib bytes (lab `CHECKERS.md`, "Lib diff").
- workerd: spawned by `run.mjs`; `/proc/<pid>/status` VmRSS and VmHWM sampled at idle (socket answering), after the first 5-file check, after the 5-file series and after the 50-file series. Latency: 3 warm-ups then n = 20 per project, host wall time around `fetch` and the in-isolate time.
- Limit probe: fresh workerd process each; `POST /alloc` grows a `WebAssembly.Memory` by 256 MiB and touches it; then, in another fresh process, allocates ~200 MiB of packed-double JS arrays on the V8 heap.
- Node comparator: same `core.js` + size `.wasm` on the caller thread via the lab's `host.mjs` `runOnce`, n = 20 after 3 warm-ups.
- Native comparator: `isolate-factory-lab/adapters/checkers/tscrs-wasm/vendor/native/tsc` (sha256 `e0245214…`, byte-identical to the cache `tsc`; the cache copy panics because its `noembed` build needs the lib files beside it, which only the lab copy has), `Version 7.1.0-dev`. Projects staged to tmpfs (`/dev/shm`), one process per check, `-p <dir> --pretty false --singleThreaded`, n = 20 after 3 warm-ups; also default threads (4 checkers) as a secondary.
- Sanity: diagnostics (file, line, code) are identical across workerd, Node and native for both projects (5-file: 1 × TS2322; 50-file: 5 × TS2322 at m07, m19, m23, m38, m49). The bundle was gzipped at level 9.
- Three full runs were made. Run 1's native diagnostics did not parse (relative paths) and run 2's JS-heap probe allocated typed arrays (off-heap), so both were development runs; run 2's summary is kept as `receipt/summary-run2-before-heap-probe-fix.json` because its memory figures differ from run 3 and that variance is a finding. Run 3 is the reported run (`receipt/summary.json`, `receipt/raw-samples.json`).

## Results

### Memory: workerd process RSS (MiB), run 3

| Stage | VmRSS | VmHWM (peak) | RssAnon | RssFile |
|---|---|---|---|---|
| Idle, socket answering (module embedded, not yet instantiated) | 77.1 | 77.1 | 39.3 | 37.8 |
| After the first 5-file check | 153.8 | 153.8 | 110.1 | 43.7 |
| After the 5-file series (3 + 20 checks) | 173.8 | 173.8 | 127.0 | 46.9 |
| After the 50-file series (3 + 20 checks) | 182.9 | 182.9 | 135.5 | 47.4 |

Run-to-run: run 1 ended at 176.9 / 176.9; run 2 ended at 244.8 with a peak of **351.6** MiB (after the 5-file series it was already 201.0 / 281.8). Peak depends on when V8 collects the previous request's linear memory (each `runTsc` is a new `WebAssembly.Instance`; the lab's CHECKERS.md documents this upstream design). The process had 17 threads throughout.

For scale: plain Node running the same module on its main thread had RSS 106.8 MiB after compiling the module and 186.2 MiB after the 50-file series. The footprint is tsc-rs WASM under V8, not workerd.

### Latency (ms, n = 20 after 3 warm-ups), run 3

| Runtime | 5-file median (p95, min–max) | 50-file median (p95, min–max) |
|---|---|---|
| WASM in workerd, host wall | 59.7 (73.0, 53.9–82.8) | **107.4** (134.1, 99.6–137.8) |
| WASM in workerd, in-isolate `performance.now()` | 57 (69, 52–81) | 105 (132, 97–135) |
| WASM in Node, caller thread | 43.8 (53.1, 38.8–59.9) | **87.5** (103.0, 84.3–106.1) |
| Native tsc-rs, `--singleThreaded`, process per check | 19.8 (22.1, 17.9–22.9) | **56.6** (64.9, 44.6–70.3) |
| Native tsc-rs, default threads (4 checkers) | 17.3 (20.2, 13.6–20.7) | 22.0 (27.1, 20.6–31.8) |

Ratios on the 50-file median: workerd / native-single **1.90**; Node / native-single **1.55**; workerd / Node **1.23**; workerd / native-default 4.87. On the 5-file median: workerd / native-single **3.01**; Node / native-single 2.21. Across the three runs the 50-file workerd/native-single ratio was 2.66, 2.53 and 1.90 (native single varied 40–57 ms with load; workerd 107–120 ms). HTTP and JSON transport cost about 2–3 ms (host wall minus in-isolate). The kernel instantiate-and-call was 0–1 ms (below the coarsened clock). workerd start to first answer: 73 ms; the first check (first instantiation) 167 ms wall.

### Bundle size

| File | Bytes | gzip -9 |
|---|---|---|
| `ts_rust.size.wasm` | 5,214,613 | 2,225,718 |
| `core.js` | 14,114 | 4,677 |
| `shim.js` | 5,363 | 2,084 |
| `kernel.wasm` | 41 | 61 |
| Total (concatenated, gzip -9) | 5,234,131 | **2,232,561** (2.23 MB) |

The speed build would be 6,518,285 B / 2,667,192 B gzip. Both are well under the 10 MB compressed limit.

### Limit enforcement

- `--max-old-space-size=128` **is enforced for the JS heap**, as a fatal, whole-process V8 out-of-memory: allocating ~200 MiB of on-heap arrays killed workerd (exit code 1; log: "Mark-Compact (reduce) 128.5 (129.1) -> 128.5 (129.1) MB … last resort; GC in old space requested"), and the client's `fetch` failed. Every isolate in that process would have died with it.
- **WebAssembly linear memory is not bounded** by that flag or by anything else in this configuration: a 256 MiB `WebAssembly.Memory` grow-and-touch returned HTTP 200 in 121 ms, the process stayed alive, and its RSS went from 76.2 to 332.8 MiB. This matches the lab's finding (R12 §4.2) that this workerd version's isolate limit enforcer is `NullIsolateLimitEnforcer`. workerd exposes no isolate heap statistics to the guest, so no in-isolate heap figure was obtained.

### Bad signs (E3 X6)

| Sign | Outcome |
|---|---|
| Working set over 128 MiB | **Yes**, as process RSS: 153.8 MiB after one 5-file check, 182.9 MiB after the 50-file series, peak 351.6 MiB in one run. (Idle process without an instance: 77 MiB.) |
| WASM more than 3× native | **No** on the 50-file check (1.90× single-threaded native; 2.53× and 2.66× in the two development runs). **At the line** on the 5-file check (3.01×). 4.9× against native with default threads. |
| Compressed bundle over 10 MB | No: 2.23 MB. |

## What this does not show

- It does not show what Cloudflare Workers would account against the 128 MB limit. Process RSS includes V8's own code and heap, the HTTP server, 17 threads' stacks and the compiled (not just embedded) 5.2 MB module; production counts the isolate's JS heap plus WASM allocations. The idle-to-loaded delta (77 → 154 MiB for one 5-file check; 77 → 183 MiB after the series) is the better proxy for what a single check adds, and it is already of the order of 75–105 MiB; the lab's P5 sensor measured 57–81 MiB per tsc-rs instance in development (R12 §4.3). None of this is a per-isolate measurement.
- It does not show behaviour under Cloudflare's enforcer, Dynamic Worker creation cost, cold starts, or anything about concurrency: one request at a time, one process.
- It does not show a quiet-machine latency. Load average was 11–18 across the runs; native single-threaded varied 40–57 ms median between runs; no CI is claimed.
- The 5-file and 50-file latencies include parsing and binding the embedded `es2022` lib on every check (the lab found this to be ~70 % of a solo tsc-rs WASM check; R12 §4.3); nothing here tests a retained-lib or incremental regime.
- It does not test the speed build, the worker-thread variant, or emit (`noEmit` was set).
- Diagnostics parity was checked by (file, line, code) on two small projects only.
- It says nothing about side channels, timers or trust partitioning (E3 §13 risk 3).

## Interpretation

Under these conditions the shim plus tsc-rs WASM plus a module instance runs correctly under workerd, agrees with native, and ships at 2.23 MB compressed. Its *process* working set after one check is already above 128 MiB and its peak in a request series reached 2.7× the limit when V8 deferred collection; if Cloudflare's accounting attributes even the idle-to-loaded delta to the isolate, a 50-file check sits in the 75–105 MiB band with a 128 MiB ceiling and no headroom for a bigger overlay or a second instance. The hosted lane's "fits or does not" question is therefore **not settled in its favour by this probe**: the memory bad sign fires on the only observable available here, and the first run of E3 Experiment 6 on the real platform should start by measuring the isolate's own heap through the platform's instrumentation, not RSS. Latency is the better news: single-threaded WASM is 1.9–2.7× native single-threaded on 50 files (inside the 3× line), 3.0× on 5 files, and workerd adds about 23 % over plain Node for the same module. The 128 MB column of E3 §13's lane table should keep its "Unproven" label; this probe narrows it to "process footprint exceeds; isolate footprint unmeasured". It also records that this workerd version enforces `--max-old-space-size` only as a process-fatal JS-heap OOM and does not bound WASM memory, so a self-hosted hosted lane would need its own enforcer (as the lab already concluded).

## Files

- `PRECOMMIT.md`, `receipt/precommit.sha256` — question, procedure, metrics, bad signs, stop rule; hashed before the first run.
- `setup.sh` — verified copies of the tsc-rs artifacts into `.tools/` and `worker/`; records `receipt/workerd.txt`, `receipt/native-tsc.txt`, `receipt/kernel.sha256`, `receipt/tscrs-artifacts.sha256`; hand-assembles `kernel.wasm`.
- `worker/shim.js`, `worker/config.capnp` — the Worker and its workerd config (`PORT` substituted at run time into `worker/config.run.capnp`, removed after).
- `gen-overlay.mjs` — deterministic 5- and 50-file overlays.
- `run.mjs` — the measurement; writes `receipt/env-before.json`, `receipt/env-after.json`, `receipt/summary.json`, `receipt/raw-samples.json` (all raw samples, memory samples, workerd log, limit probes), `receipt/run3-stdout.json`, `receipt/run3-stderr.log`, `receipt/loadavg-run3-start.txt`.
- `receipt/summary-run2-before-heap-probe-fix.json`, `receipt/raw-samples-run2.json` — development run 2, kept for the memory variance.
- `.gitignore` — the copied artifacts and `.tools/`.
