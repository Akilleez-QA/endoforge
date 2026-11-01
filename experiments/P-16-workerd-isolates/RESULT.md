# P-16 workerd workcell isolates — result

Status: **Recorded (probe)**. One lifetime, 2026-11-01 18:43-18:53 ET, main-rig (AMD Ryzen 9 7950X, 16C/32T, 124 GiB RAM). workerd 1.20261101.1 (`workerd 2026-11-01`, binary sha256 `f8d099c6…6d183e74`, `receipt/workerd.txt`). Shared desktop with Codex workers; 1-minute load 10-16. Precommit sha256 `961e5542…6d0e30`, hashed 18:23:55 ET before the first rep (`receipt/precommit.sha256`).

## Procedure as run
As precommitted. One workerd process per rep, N services (one V8 isolate each), one socket per service, `v8Flags = ["--max-old-space-size=128"]`, pinned to cores 0-27. Each isolate holds endoforge `gates.mjs` and `factory_quality/index.mjs` (unmodified, same copy as P-15) and the 22 candidates as wasm module bindings built once by asc 0.28.20 (`build.mjs`, `receipt/build.txt`). Per request the isolate instantiates the module, runs the 5 universal gates and appends a hash-chained receipt. The host drains and re-hashes every chain.

## Results: throughput arm
Every rep: **0 incorrect verdicts, 0 broken chains, 0 request errors, all N isolates ready.**

| N | accepted-correct/s (r1 / r2 / r3) | latency p50 / p95 (ms, median rep) | spawn-to-all-ready (ms) | idle RSS (MiB) | peak RSS (MiB) | peak RSS / N (MiB) |
|---|---|---|---|---|---|---|
| 1 | 1713 / 1852 / 1854 | 0.37 / 0.67 | 30-78 | 52-55 | 170-173 | 170-173 |
| 10 | 1950 / 1351 / 2568 | 2.95 / 9.02 | 79-96 | 77-83 | 346-455 | 35-46 |
| 20 | 1728 / 1561 / 959 | 8.30 / 18.59 | 162-264 | 105-109 | 531-610 | 27-31 |
| 50 | 1881 / 1915 / 1820 | 19.29 / 27.41 | 344-421 | 192-200 | 1174-1177 | 23.5 |

Raw per-rep records: `receipt/raw/N*-r*.json`; summary: `receipt/summary.json`; log: `receipt/run.log`.

## Results: limit arm (N = 10, breach in isolate w0)

| Breach | Reps | Breacher | workerd process | Survivors w1-w9 answering correctly after | RSS before → after (MiB) |
|---|---|---|---|---|---|
| 200 MiB JS heap (on-heap arrays) | 3/3 | connection reset | **exited, code 1, 204-219 ms after start of breach** | **0 / 9** | 76-78 → process gone |
| 256 MiB WebAssembly.Memory grow + touch | 3/3 | HTTP 200, allocation succeeded | alive | 9 / 9 | 77-79 → 347-349 |

Outcome against the precommitted definitions: JS heap = **enforced-fatal** (the limit holds by killing the process and every other isolate in it); wasm = **unenforced** (a single isolate took 270 MiB over a 128 MiB flag with no error). Both match P-05; P-16 adds that the fatal case takes 9 healthy neighbours with it.

## Compared with P-05 and P-15
- P-05 (workerd 1.20260930.1, one isolate, one request at a time): JS heap breach killed the process; wasm 256 MiB accepted, RSS 76 → 333 MiB, run peak 351.6 MiB. P-16 reproduces both on workerd 1.20261101.1 with 10 isolates: no change in enforcement across the five-week version gap.
- P-15 (node worker_threads, compile in isolate): 21 accepted/s at N = 1, best 99-119 at N = 10. P-16 runs about 1,700-1,900 accepted/s from N = 1, because asc compile (most of P-15's 36.8 ms) is outside the isolate here. The two throughput figures are not comparable.
- Width does not buy throughput in standalone workerd: accepted/s stays at about 1,800 from N = 1 to N = 50 while p50 latency grows about 50-fold. All isolates live in one workerd process and this run shows them interleaving rather than running in parallel; the thread count was not recorded. Parallelism needs more workerd processes, not more isolates per process.
- Memory per extra isolate is small: about 21 MiB per isolate from N = 10 to N = 50 ((1175 - 410) / 40), against about 115-150 MiB marginal in P-15, which also holds asc and binaryen.

## What it does not show
- Not Cloudflare production: its per-isolate enforcer and accounting differ from standalone workerd; this is the open-source runtime only.
- Not in-isolate compile: workerd forbids runtime wasm code generation, so asc ran once on the host and compile rejects were fixed at build time.
- The OOM message itself was not captured: the stored log tail (1500 chars) holds only the stack trace; the evidence is exit code 1 and all 10 sockets failing.
- Not tested: limits other than `--max-old-space-size`, multiple workerd processes, breach while other isolates are mid-request, N between 20 and 50 or above 50.
- One lifetime, 3 reps, shared desktop; N = 10 and N = 20 reps vary up to 2.7x, so per-N throughput differences are noise.

## Interpretation
Standalone workerd cannot contain a single endoforge workcell's memory breach: a JS-heap breach kills every isolate in the process and a wasm breach is not limited at all. A workerd-based pool needs its own enforcer: one process per workcell (or per small group) with an OS memory limit, plus a wasm memory cap set inside the kernel instantiate path. Isolate density is cheap (about 21 MiB each) but does not add throughput within one process.
