# P-01 kernel-instantiate — result

Status: **Recorded (probe)**. One lifetime, one machine, shared desktop (load average 10.8 at start, 12.6 at end; see `receipt/env-before.json`, `receipt/env-after.json`). Precommit hash: `receipt/precommit.sha256` (`db9850e6…256c1b`), hashed 2026-10-17 before any measurement.

## Question

How long does it take to instantiate a pure WASM kernel module (compiled once), and how much resident memory does each live instance cost, under V8 (Node v26.8.1) and under Wasmtime (CLI v49.0.3; `wasmtime` crate v49.0.3 from a small Rust host)?

## Procedure as run

- Kernel: `kernel/kernel.ts`, 206 lines of AssemblyScript: a 240-byte fixed-layout state struct in caller-owned linear memory, `step(statePtr, eventPtr) -> ptr` reducer over 32-byte event records, `convertUnit` (mass/energy/temperature), `joinRecords` (weighted record join), FNV-1a checksum. Compiled with `asc 0.28.20 -O3`, binaryen 131.0.0-nightly.20260721 (`build.sh`).
- Module variants (sha256 in `receipt/wasm-sha256.txt`): all four are **1,594 bytes**, zero imports, 21 exports. `--runtime stub` vs the default incremental runtime makes **no size difference** for this kernel because it allocates no managed objects, so no GC code is pulled in; keeping assertions on (`kernel-stub-1p-assert`) also adds nothing because the kernel has no checked array/pointer operations. The intended `env.abort` import therefore does not appear in any variant. Note: without `--initialMemory`, asc emitted a module with **0 initial pages**; the 1-page and 16-page variants set it explicitly.
- V8: `WebAssembly.compile` once, 50 untimed warm-up instantiations, then N=2,000 `new WebAssembly.Instance` timed with `hrtime.bigint`, instances kept alive during the loop. Resident series: fresh `node --expose-gc` process per (variant, K, repeat), `global.gc()` before and after, `initState(0)` on every instance (touches one 4 KiB OS page). 3 repeats per cell. Call series: 1,000 untimed then 10,000 timed `step` calls.
- Wasmtime CLI: `wasmtime run --invoke stateSize <module>` spawned from Node, n=200 per series, with `/bin/true` as the spawn floor and a precompiled `.cwasm` (19,456 bytes) as the third series. First attempt used `--invoke 'stateSize()'`, which wasmtime 49 rejects ("no func export named `stateSize()`"); the partial receipts of that attempt are under `receipt/aborted-20261017T130635-cli-invoke-syntax-bug/` and the fixed script re-ran the whole `run.sh`.
- Wasmtime crate: `rust-host/` (`wasmtime = "=49.0.3"`, features cranelift/runtime/pooling-allocator, release). `Module::from_file` once; N=2,000 `Linker::instantiate` into fresh `Store`s timed with `Instant`; resident series read `/proc/self/status VmRSS` before and after holding K `(Store, Instance)` pairs, 3 repeats per cell, each in its own process. Both the default on-demand allocator and the pooling allocator were run. First cargo build failed (my code used `InstanceAllocationStrategy::Pooling` without the `pooling-allocator` feature, 57 s); the fixed build took 6 s more (`receipt/cargo-build*.log`), total well under the 15-minute budget.
- Post-hoc (not in PRECOMMIT, labelled as such): `node-resident-touched.mjs`, V8 K=1,000, every instance's whole linear memory written once, to show the bound when memory is actually used.

## Results

Module compile (once, not instantiate): V8 `WebAssembly.compile` 0.32 ms / 0.27 ms; Wasmtime `Module::from_file` 2.67 ms / 1.98 ms (1p / 16p).

### Instantiate latency (µs), n = 2,000 per row

| Host | Variant | median | p95 | min | max |
|---|---|---|---|---|---|
| V8 (Node 26.8.1) | stub, 1 page | **18.6** | 34.8 | 8.2 | 10,160 |
| V8 | stub, 16 pages | 17.5 | 169.4 | 7.9 | 13,090 |
| Wasmtime crate 49.0.3, on-demand | stub, 1 page | **5.0** | 9.2 | 2.8 | 20.9 |
| Wasmtime crate, on-demand | stub, 16 pages | 4.8 | 8.7 | 2.8 | 47.7 |
| Wasmtime crate, pooling | stub, 1 page | 4.0 | 8.1 | 0.56 | 20.0 |
| Wasmtime crate, pooling | stub, 16 pages | 4.3 | 8.8 | 0.55 | 46.6 |

V8's max values (10–13 ms) are single outliers in 2,000 (GC or page-fault pauses while 2,000 instances are kept alive); the 16-page V8 p95 of 169 µs shows the tail widening when each instance reserves 1 MiB.

### Per-call cost of `step` on one resident instance (ns), n = 10,000

| Host | median | p95 | min | max |
|---|---|---|---|---|
| V8 | 240 | 261 | 200 | 22,803 |
| Wasmtime crate | 210 | 281 | 190 | 21,189 |

Both hosts computed the same final state (`readMass` = 2,862,054.4566 kg after the same 11,000 events), so the two embeddings ran the same kernel semantics.

### Resident bytes per live instance (ΔRSS / K), median of 3 repeats, first page touched only

| Host | Variant | K=100 | K=1,000 | K=5,000 |
|---|---|---|---|---|
| V8 | stub, 1 page | 7,864 | **11,796** (11,272–12,059) | 11,325 (11,325–11,639) |
| V8 | stub, 16 pages | 10,486 | 10,224 | 10,433 |
| Wasmtime on-demand | stub, 1 page | 7,987 | **9,032** (9,028–9,101) | 9,122 (9,121–9,136) |
| Wasmtime on-demand | stub, 16 pages | 8,438 | 9,032 | 9,124 |
| Wasmtime pooling | stub, 1 page | 8,069 | 8,978 | 9,057 |
| Wasmtime pooling | stub, 16 pages | 8,069 | 8,974 | 9,060 |

Whole-process RSS for context: V8 baseline about 54 MB, 110.9 MB with 5,000 1-page instances; Wasmtime host baseline about 15.8 MB, 61.4 MB with 5,000. V8's `arrayBuffers` accounting grew only 44 bytes per instance; the linear memories are not in that counter.

### Post-hoc: every page of each instance's memory written (V8, K=1,000, 3 repeats)

| Variant | memory per instance | ΔRSS per instance |
|---|---|---|
| stub, 1 page (64 KiB) | 65,536 | 73,425–74,097 |
| stub, 16 pages (1 MiB) | 1,048,576 | 1,055,355–1,055,392 |

So resident cost = touched memory + roughly 7–10 KB of instance bookkeeping. Untouched reserved pages cost nothing in RSS on either host.

### Wasmtime CLI cold start (ms, process start included), n = 200

| Series | median | p95 | min | max |
|---|---|---|---|---|
| `/bin/true` (spawn floor) | 1.19 | 1.70 | 1.01 | 2.50 |
| `wasmtime run --invoke stateSize kernel.wasm` | **6.01** | 7.77 | 4.54 | 9.03 |
| same with precompiled `.cwasm --allow-precompiled` | 6.24 | 8.59 | 4.57 | 10.78 |

For a 1.6 KB module, Cranelift compile is not the dominant term; the ~5 ms above the spawn floor is wasmtime process start and engine setup, and precompiling does not help.

### Bad-sign check

- Instantiate median above 1 ms: **not observed** (18.6 µs V8, 5.0 µs Wasmtime; about 50x and 200x under the line).
- More than 2 MiB per resident instance at 1-page memory: **not observed** (about 12 KB V8, 9 KB Wasmtime with one page touched; about 74 KB with the whole page written).
- Cargo build over 15 minutes or failing: **not triggered** (one feature-flag error in my code, fixed; total about 63 s).

## What this does not show

- It does not measure a real Edition 3 kernel. The kernel is 1.6 KB with 21 exports and no imports; a kernel with a large data segment, many functions, or a table will compile and instantiate slower and hold more code memory. Compile (not instantiate) was measured once and is 0.3 ms (V8) and 2–2.7 ms (Wasmtime) here.
- It does not measure a Component Model / WIT instance, host-owned buffers, fuel/epoch interruption, or any sandbox (cgroups, seccomp, OS watchdog) that the local lane would add. Wasmtime ran with a default `Config` plus, in one series, the pooling allocator; no limits were set.
- The RSS numbers are process-level deltas with instances touching one page. They are not a per-isolate footprint for a V8 isolate (the V8 series instantiates into the main isolate), and they are not comparable to the 150 MiB whole-unit peaks in Edition 3 §14 (E3-14) because no job harness, startup or verification is included.
- No CI, no replication across days, no quiet gate. Load average was 10–13 throughout; medians are probably robust to that, p95 and max are not.
- The CLI cold-start series measures the `wasmtime` binary's process start on this machine; it is not a model of the local-lane host, which the crate series represents.
- The post-hoc touched-memory series was not precommitted and is reported as a labelled addendum.
- Nothing here bears on the compiler-location question (E3-10) or on route yield (X4).

## Interpretation

On this machine, instantiating a tiny import-free AssemblyScript kernel from an already-compiled module takes on the order of 5 µs under Wasmtime 49 and about 19 µs under Node 26's V8, with p95 under 10 µs and 35 µs respectively, and each live instance costs roughly 9–12 KB of resident memory plus whatever linear memory it actually touches (a fully written 64 KiB page costs about 74 KB; a fully written 1 MiB memory about 1.03 MiB). That is consistent with Edition 3 §5's "well under a millisecond" and "kilobytes to low megabytes" for this kernel shape, and it gives E3-13/E3-14 a per-instance incremental number that the earlier whole-unit peaks could not. The caveats are real: the kernel is small and import-free, both hosts ran without sandboxing or resource limits, and a single noisy lifetime on a loaded desktop says nothing about tails under contention or about the footprint of kernels that carry data or use the Component Model. The probe narrows the instantiate/footprint risk for kernels of this size; it does not settle it for the kernels X4 will produce.

## Files

- `PRECOMMIT.md`, `receipt/precommit.sha256`, `receipt/precommit-hashed-at.txt`
- `setup.sh` (pinned installs), `build.sh` (module variants), `run.sh` (measurement runner), `env.sh`, `stats.mjs`, `summarize.mjs`
- `kernel/kernel.ts` — the AssemblyScript kernel
- `node-bench.mjs` (V8 instantiate + call), `node-resident.mjs` (V8 resident), `cli-cold.mjs` (wasmtime CLI), `node-resident-touched.mjs` (post-hoc)
- `rust-host/Cargo.toml`, `rust-host/src/main.rs` — wasmtime crate host (`target/` git-ignored)
- `receipt/tool-versions.txt`, `receipt/Cargo.lock`, `receipt/wasm-sha256.txt`, `receipt/wasm-modules.json`
- `receipt/env-before.json`, `receipt/env-after.json`
- Raw samples: `receipt/v8-instantiate-*.jsonl`, `receipt/v8-call-*.jsonl`, `receipt/v8-resident.jsonl`, `receipt/wasmtime-instantiate-*.jsonl`, `receipt/wasmtime-pooling-instantiate-*.jsonl`, `receipt/wasmtime-resident.jsonl`, `receipt/wasmtime-call-*.jsonl`, `receipt/cli-cold-*.jsonl`, `receipt/posthoc-v8-resident-touched.jsonl`
- Summaries: `receipt/v8-bench-*.json`, `receipt/cli-cold.json`, `receipt/*.meta.json`, `receipt/summary.json`, `receipt/run.log`
- Build logs: `receipt/cargo-build-attempt1-failed.log`, `receipt/cargo-build.log`, `receipt/cargo-build*.time`
- Aborted first attempt: `receipt/aborted-20261017T130635-cli-invoke-syntax-bug/`
- `build/*.wasm`, `build/*.cwasm`, `node_modules/`, `.tools/` are git-ignored build/dependency artifacts (hashes recorded in receipt/)
