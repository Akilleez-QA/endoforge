# P-15 workcell-concurrency — result

Status: **Recorded (probe)**. One lifetime, main-rig (AMD Ryzen 9 7950X, 16C/32T, 124 GiB RAM, kernel 7.2.8-9-omarchy, Node 26.12.0), shared desktop with about 20 Codex/PR processes and their test suites running (no quiet gate). Bench pinned to cores 0-27 (4 left free). Precommit hashed 2026-11-01 13:12 ET before any measurement, then amended twice before the affected reps (sections "Amendment 1/2" in PRECOMMIT.md; original hash in `receipt/precommit-original.sha256`, final `67edbbc0…d2d919`). endoforge machinery from Akilleez-QA/endoforge main `cf44412`, copied unmodified. Built outside the lab checkout; nothing committed.

## What one unit is
One `worker_threads` Worker = one V8 isolate = one workcell (R02). Loaded once per isolate: assemblyscript 0.28.20 `asc` (binaryen 131.0.0-nightly.20260721), endoforge `tools/engine/gates.mjs` + `tools/factory_quality/index.mjs`, a JS port of `tools/ledger/ledger.py` `encode()`/`event_hash()`. Per candidate, all inside the isolate: private in-memory overlay with the kernel source, asc compile with zero fs, `WebAssembly.compile`, fresh instance per run, `runUniversalGates` (schema, interface, bounds, determinism, forbidden_effects) running the kernel (initState, 20 step events per case, convertUnit) on 5 frozen cases, ledger receipt appended to the isolate's own hash chain. Candidates: P-02 kernels k00-k19 (17 expected accept, k05/k11/k17 expected reject:compile) plus k00/k01 with an added env.clock import (expected reject:forbidden_effects). A completion counts only if the verdict matches and the host re-hashes the receipt chain successfully. No model calls.

## Results

Every rep in both arms: **0 incorrect verdicts, 0 broken receipt chains, 0 spawn failures, no memory kill.**

### Main ramp (15 s window, latency stop ON) — stopped at N=50
| N | rep | alive | spawn-to-ready med / p95 / max (ms) | latency n | med / p95 / min / max (ms) | correct/s | accepted-correct/s | peak RSS (GiB) | RSS per isolate (MiB) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1-3 | 1 | 224 / 206 / 201 (one per rep) | 411, 410, 415 | 36.8 / 45.5 / 19.8 / 185.9 (r1) | 27.4, 27.3, 27.6 | 21.2, 21.2, 21.4 | 0.49-0.54 | 445-496 |
| 10 | 1 | 10 | 459 / 476 / 476 | 1939 | 62.3 / 170.8 / 24.1 / 372.8 | 128.0 | 99.3 | 2.85 | 286 |
| 10 | 2 | 10 | 576 / 597 / 597 | 2298 | 61.7 / 100.5 / 24.8 / 406.6 | 152.7 | 118.5 | 3.15 | 317 |
| 10 | 3 | 10 | 452 / 468 / 468 | 2319 | 61.0 / 97.4 / 23.5 / 379.5 | 154.1 | 119.4 | 3.29 | 331 |
| 50 | 1 | 50 | 2162 / 2176 / 2177 | 1526 | 463.7 / 952.2 / 55.3 / 1481 | 99.3 | 77.1 | 12.18 | 248 |
| 50 | 2 | 50 | 2024 / 2086 / 2086 | 1236 | 598.3 / 1055 / 54.1 / 1527 | 80.2 | 62.3 | 12.46 | 254 |
| 50 | 3 | 50 | 2116 / 2163 / 2176 | 1360 | 539.4 / 1054 / 55.6 / 1771 | 88.9 | 68.9 | 12.33 | 251 |

Stop: N=50 p95 952 ms > 10x the N=1 p95 (46.0 ms). Host-only RSS before workers: 55 MiB. RSS per isolate = (peak − 55 MiB)/N.

### Residency arm (Amendment 2: 5 s window, latency stop OFF, memory stop ON)
| N | rep | alive | spawn-to-ready med / p95 / max (ms) | latency n | med / p95 (ms) | correct/s | accepted/s | peak RSS (GiB) | RSS/isolate (MiB) | min MemAvailable (GiB) |
|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 1/2/3 | 100 | 4341/4433/4434; 4073/4196/4220; 3941/4163/4187 | 203/253/231 | 2697/3551; 2222/3273; 2431/3649 | 30.6/33.2/33.8 | 24.0/26.4/26.5 | 13.3/14.6/13.6 | 135/149/139 | 62.8 |
| 150 | 1/2/3 | 150 | 4999/6400/6420; 5518/6367/6386; 4693/6249/6276 | 202/241/225 | 4961/7196; 4185/6106; 4159/5886 | 22.2/26.0/21.6 | 17.7/20.6/17.2 | 17.2/18.1/19.4 | 117/123/132 | 58.3 |
| 200 | 1/2/3 | 200 | 6541/8362/8371; 6282/8730/8769; 8270/9406/9416 | 206/209/208 | 7156/7995; 7119/7986; 6308/8113 | 15.3/17.4/12.3 | 11.9/13.7/9.7 | 23.2/22.2/24.0 | 119/113/123 | 53.5 |

No stop condition fired; 200 was the last precommitted step for this arm.

## What it does not show
- Not workerd, not Wasmtime, not Cloudflare hosted limits. workerd is not installed on main-rig (no binary found), so the requested workerd arm was not run. isolated-vm / node:vm arms were not run (Craig redirected to real endoforge workcells).
- Not a campaign: one lifetime, shared busy desktop, Codex jobs and their test suites competing for CPU; no calibration or replication beyond 3 reps.
- Does not show the ceiling on held isolates. 200 held fine; above 200 was not tried. The memory line was never reached.
- Codex slowdown was not measured directly; only the Codex process count (20 before, 19-20 after) and load average (rose to 140 at N=200, counting our runnable threads) were recorded.
- The ledger step is a JS port of encode/event_hash only; ledger.py schema validate() and provenance checks were not run. Receipts are hash-chain-verified, not schema-validated.
- At N=200 each workcell finished about one candidate in the 5 s window, so those latencies are mostly queueing for 28 cores.
- The gate port and contract are a frozen synthetic signature (convertUnit), not an evaluator-qualified task suite; tools/engine/evaluator.mjs evaluateCandidates and the Codex-backed agent-pool were not used. agent-pool.mjs is the Codex account pool (model calls), so it is out of scope and has no isolate cap to report.
- "RSS per isolate" is the bench process peak minus host-only RSS divided by N. It includes the shared Node/V8 overhead and each isolate's binaryen/asc heaps, and the N=1 figure (445-496 MiB) includes the compile working set.

## Interpretation
- **Max stable concurrent endoforge workcells under the precommitted rules: 10** (latency rule breaks at 50). **Held correctly: 200** (3/3 reps, every completion correct), not pushed further.
- **Headline (R01): best throughput is at N=10: 152-154 correct/s, 118-119 accepted-correct/s** ≈ 4.2 accepted-correct per core-second (28 cores) and ≈ 37 per GiB-second (3.2 GiB). At N=1: 21.3 accepted/s on one core, ≈ 41 per GiB-second. Going wider loses: N=50 gives 62-77 accepted/s, N=200 gives 10-14. This is R02 rule 4 measured. Each isolate is single-threaded, and past about the core count, extra isolates add contention (GC, binaryen, and the Codex load) rather than work.
- **Memory per workcell: about 115-150 MiB marginal at 100-200 wide**, 250-330 MiB at 10-50. That is near P-02's ~97 MB per loaded compiler plus gates and wasm. From the 75 GiB available at start, the 20% floor would allow roughly 400 held workcells. That is an extrapolation, not measured.
- Versus prior records: Oct 18 ran 20 concurrent agent isolates (model turns). This run held 200 non-model workcells and ran 10 at full efficiency. One full in-isolate pipeline (compile + instantiate + 5 gates + receipt) has a median of 36.8 ms. That is below P-02's 51 ms compile-only median, on a different Node version and load, so this is not a like-for-like comparison. P-01's 18.6 µs V8 instantiate is a negligible share of the 36.8 ms; compile dominates.
- The practical width for this machine with Codex running is about 10-28 workcells. A 28-wide step was not in the precommitted ramp, so the exact optimum between 10 and 50 is untested.
