# P-01 kernel-instantiate — precommit

Written and hashed before the first measurement. Status of any result: **Recorded (probe)**.

## Question

How long does it take to instantiate a pure WASM kernel module (compiled once), and how much resident memory does each live instance cost, under V8 (Node v26.8.1) and under Wasmtime (CLI v49.0.3 and the `wasmtime` crate v49.0.3 from a small Rust host)?

## Unknown it de-risks

- Edition 3 §5 claims instantiation is "well under a millisecond" and that per-kernel footprint is "kilobytes to low megabytes"; neither is recorded anywhere.
- Errata E3-13 ("tens of megabytes (recorded, Section 14)" is not in §14) and E3-14 (per-candidate memory compared against a whole-unit 150 MiB peak). This probe produces a per-instance incremental number that E3-14 says is missing.
- X4 footprint column (per-candidate memory).
- R03 §3: the Wasmtime local lane as the kernel host.

## Procedure (exact)

Setup (done before this file was hashed; not a measurement): `setup.sh` installs `assemblyscript@0.28.20` locally and the `wasmtime` v49.0.3 x86_64-linux CLI under `.tools/`; `build.sh` compiles `kernel/kernel.ts` (206 lines: a 240-byte fixed-layout state struct, a `step(statePtr, eventPtr) -> ptr` reducer, `convertUnit`, `joinRecords`, FNV checksum) with `asc -O3` into four variants: stub runtime 1 page, stub runtime 16 pages, default runtime 1 page, stub runtime with assertions. Sizes and sha256 are in `receipt/wasm-sha256.txt` and `receipt/wasm-modules.json`.

Measurements (`run.sh` calls, in order):

1. `env-before.json`.
2. **V8 instantiate latency** (`node-bench.mjs`): `WebAssembly.compile` once per variant; then N=2,000 `new WebAssembly.Instance(module, {})` calls, each timed with `process.hrtime.bigint()`; instances are discarded (kept in an array until the loop ends so GC does not run mid-sample, then released). Raw per-sample nanoseconds to `receipt/v8-instantiate-<variant>.jsonl`. Variants: stub-1p, stub-16p.
3. **V8 resident footprint**: in a fresh Node process per variant (`node-resident.mjs <variant> <K>`), record `process.memoryUsage()` (rss, external, arrayBuffers) and `v8.getHeapStatistics()` after warm-up and a forced `global.gc()` (`--expose-gc`), then instantiate K instances and keep them in an array, force GC, record again. K ∈ {100, 1,000, 5,000}. Bytes per instance = (rss_after − rss_before) / K. Each K in its own process so step deltas are not confounded. Repeated 3 times per (variant, K); the median of the three deltas is reported. Variants: stub-1p, stub-16p.
4. **V8 call cost**: 10,000 calls of `step` on one resident instance (stub-1p), each timed; per-call median/p95/min/max. A warm-up of 1,000 untimed calls precedes it.
5. **Wasmtime CLI cold start**: n=200 runs of `.tools/wasmtime run --invoke 'stateSize()' build/kernel-stub-1p.wasm`, process start included, timed around `spawnSync` with `hrtime.bigint`. Baseline: n=200 runs of `/bin/true` the same way, so the process-spawn floor is visible. Second CLI series: the same with a precompiled `.cwasm` (`wasmtime compile`) and `--allow-precompiled`, so compile time is separated from instantiate+process start.
6. **Wasmtime crate host** (`rust-host/`, Rust 1.98.1, `wasmtime = "=49.0.3"`, release profile): compile the module once via `Module::from_file`; N=2,000 `Instance::new` into fresh `Store`s, timed with `Instant`; raw samples to `receipt/wasmtime-instantiate-<variant>.jsonl`. Then K ∈ {100, 1,000, 5,000} instances kept alive (each in its own Store, in a Vec) with `/proc/self/status` VmRSS read before and after; bytes per instance = delta / K; 3 repeats per K, each in its own process. Also run the same with the default pooling-allocator-off `Config` (the default) and note which config was used. Cargo build has a 15 minute budget; if it fails or exceeds it, record that and fall back to CLI numbers only.
7. `env-after.json`.

## Metrics

- Instantiate latency: n, median, p95, min, max in microseconds, per host and variant.
- Resident bytes per instance: (ΔRSS)/K for K=100/1,000/5,000, per host and variant; V8 additionally reports Δexternal/ΔarrayBuffers.
- Call cost: per-call median/p95 in nanoseconds.
- CLI cold start: median/p95 ms, with the `/bin/true` floor alongside.
- Module sizes in bytes.

## Bad signs (pre-stated)

- Instantiate median above 1 ms on either host.
- More than 2 MiB resident per instance at 1-page memory on either host.
- Cargo build of the crate host failing or exceeding 15 minutes (recorded as a limitation, not a kernel result).

## Stop rule

Run each series once as written. If a process is OOM-killed at K=5,000, record the failure and report K=100 and K=1,000 only. No re-runs to "improve" a number; if a run is repeated because of a script bug, the earlier receipt files are kept under `receipt/aborted-*`.

## Known confounds

Shared desktop; load average at start is recorded in `env-before.json` and was about 8–16 during the preceding hour. No CPU pinning, no governor control. Numbers are one lifetime on one machine.
