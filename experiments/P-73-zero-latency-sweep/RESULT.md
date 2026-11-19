# P-73 zero-latency stand-in sweep: which ceiling binds below the model: result

Status: **Recorded (probe)**, 2026-11-17, on the reference machine (Apple M6 Mac mini, 2 Super + 4 Performance + 6 Efficiency cores, 16 GiB, Apple Fabric SSD, Node v26.13.1, Python 3.15.2, SQLite 3.54.1). Stand-in models only, **no model calls, no tokens**: every process ran with the four credential variables unset (each runnable asserts it), arm B spawned only the `fake-claude` fixture (16,657 fixture starts across the plans, counted in its own log), and no transport error occurred. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed and pushed (14434ac) before any acceptance row. Receipts: [receipt/accept/](receipt/accept/); `summarize.py` prints the tables from them.

**With the model at zero latency a need takes 86.5 ms on this machine (11.6 needs/s at width 1), and at width the single ledger writer binds first: about 37 needs/s, 8.4 ms of service per request, about 3.2 requests per need. It binds from width 6–8 at 100× and at zero latency, in both arms. The core-band knee is at width 6, as predicted, but it coincides with ledger saturation. The next roof under the writer is the 12 cells, at about 68 needs/s. Spawning a process per model call (arm B) costs 62 ms per need at width 1 and 36% of the throughput at width 64 and 100×. Part of that is the spawns slowing the writer: its service time goes from 8.4 to 14.7–18.8 ms. The ledger's own predictions for the non-model share were too high, because the non-model time here is 3× smaller than the 0.27 s they assumed. Memory doesn't bind: peak throughput needs 2.5–4.6 GB. Thread cells give 1.8× more candidates/s per GB. Band-aware QoS doesn't beat letting macOS place everything, and demoting the writer halves throughput. Under the hard caps the tiered sweep reached compression and swap (30 resident cells, swap at the 8 GB cap): the hot pool lost 26% of its throughput, and a cold cell took 120–240 ms longer on first use. One correctness finding: after about 4,000–5,000 needs in one host process, the independent re-run at commit started disagreeing with the cell report. The refusal is safe, but throughput fell 4–6×. The affected rows are excluded and reported.**

## What this does not show

- Stand-in models, P-50's 21 synthetic kernels (with the capability fence main now requires), one shared desktop machine. Other lanes ran during the plans: the 1-minute load reached 6–14 during several rows and 17.9–22 at the start of the memory plans (those rows are labelled). No acceptance row started above 16.
- Arm B's fixture is a 30-line Node script. Its 21 ms spawn-to-exit is a **lower bound** on a real `claude -p` start (P-64 measured 285 ms spawn to init and 1.68 s to `message_start`, partly remote).
- macOS has no hard CPU affinity, so "per band" means QoS hints (`taskpolicy -b`, `-t/-l`, `-c` clamps), not pinning. There's no user-interactive class reachable from the command line. Power and energy are **unmeasured** (`powermetrics` needs sudo and wasn't run).
- RSS is `ps` resident size, which counts shared pages in each process. CPU per candidate counts live descendants only, so arm B's reaped fixture children are missed.
- `crossing` is the time inside cell jobs not covered by any other bucket, minus compile and gates. That makes it an upper bound on message cost: it includes dispatch, cell bookkeeping and, at width, the wait for a free cell. The 5% reconciliation bar therefore checks host-side gaps, not the cell interior.
- The model bucket includes the repair turn the sibling (expected-refused) kernels get. That's why it is 2,267 ms at 10× rather than 2,180.
- Compile and gate times are compute, and no hardware floor was measured for them.
- The tiered-memory sweep stopped on the 8 GB swap cap at 30 resident cells. Host swap was already 5.1 GB from other workloads, so the swap tier's own ceiling is **unmeasured**.

## Predictions against measurement

| Prediction (precommit) | Measured | |
|---|---|---|
| A, width 1, non-model share 1.2% / 11% / 55% at 1× / 10× / 100× | 0.8% / 5.7% / 34.2% (non-model 165 / 137 / 119 ms per need) | **miss** (direction right, about 0.6× the size) |
| B, 100×, non-model share ≥ 70% | 41.4% at width 1 (161 ms non-model); 90.2% at width 64 | **miss** at width 1, met only at width |
| Width 64 binds on the model at 1× and 10× | `model (population)` in A and B at 1× and 10× | **met** |
| Width 64 at 100×: ledger (A) | `ledger (saturated)`, 33.9/s | **met** |
| Width 64 at 100×: spawn or cell (B) | `ledger (saturated)`, 21.6/s. Spawn slows the writer (service 14.7 ms against 9.3 in A) rather than binding on its own | **miss** |
| Core-band knee near width 6 | B (clean rerun): 7.1, 13.6, 21.9, **24.4**, 23.8, 23.3, 23.0, 20.5/s at widths 1–64. Peak at 6, flat after. The verdict turns `ledger` from width 8 | **met**, but confounded with ledger saturation |
| Pilot-informed expectation (not a prediction): A 0.4% / 3.8% / 28%; B about 38% at 100× | 0.8% / 5.7% / 34.2%; B 41.4% | close; the misses are from the cold-core penalty below |

Oracle bars: **reconciliation met in every row** (largest unattributed share 0.33% of wall). **Little's Law met in every row but two**: A and B at 1× and width 1, with 12.1% and 11.8%. Those windows held only 5 needs of 22 s each, so the steady window is too short for W. **Correctness met in every row kept** (promotion matched the corpus's expected outcome). The excluded rows are below. **Stage-rates verdicts** are in the tables.

**Cold-core penalty (measured, cause inferred).** Non-model time per need at width 1 is 165 ms at 1×, 137 ms at 10×, 119 ms at 100× and 86.5 ms at zero latency. Compile alone is 88 ms at 1× and 28 ms at zero latency. The longer the idle gap between bursts, the slower the burst. That fits cores and caches dropping to idle states while the stand-in model sleeps (power states are unmeasured). So the non-model share at today's model speed is pessimistic on this machine, and the 100× share sits closer to the zero-latency figure than a fixed-overhead model predicts.

## Per arm, scale and width (steady window)

Buckets are mean milliseconds per need. Verdicts use P-62's rule V. B's `spawnInit` is the fixture's spawn, init, stdio and exit.

| Arm | Scale | Width | needs/s | wall | spawnInit | model | freeze | compile | gate | crossing | ledger | promote | non-model | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 1× | 1 | 0.04 | 21,967 | 0 | 21,802 | 26 | 88 | 9 | 16 | 16 | 9 | 0.8% | model (population) |
| A | 1× | 64 | 2.56 | 23,201 | 0 | 22,694 | 62 | 72 | 13 | 282 | 69 | 9 | 2.2% | model (population) |
| A | 10× | 1 | 0.41 | 2,405 | 0 | 2,268 | 26 | 59 | 10 | 14 | 17 | 10 | 5.7% | model (population) |
| A | 10× | 64 | 23.9 | 2,635 | 0 | 2,285 | 61 | 46 | 12 | 107 | 110 | 13 | 13.3% | model (population) |
| A | 100× | 1 | 2.85 | 349 | 0 | 230 | 21 | 48 | 10 | 10 | 16 | 14 | 34.2% | model (population) |
| A | 100× | 64 | **33.9** | 1,873 | 0 | 268 | 164 | 48 | 11 | 947 | 418 | 17 | 85.7% | **ledger (saturated)** |
| A | 0 | 1 | 11.6 | 86.5 | 0 | 0 | 10 | 28 | 8 | 20 | 13 | 8 | 100% | cell (unsaturated) |
| A | 0 | 64 | **37.5** | 1,616 | 0 | 0 | 145 | 48 | 11 | 1,048 | 350 | 13 | 100% | **ledger (saturated)** |
| B | 1× | 1 | 0.04 | 22,043 | 66 | 21,810 | 27 | 83 | 8 | 18 | 17 | 14 | 1.1% | model (population) |
| B | 1× | 64 | 2.56 | 23,487 | 126 | 22,700 | 64 | 71 | 14 | 369 | 127 | 16 | 3.4% | model (population) |
| B | 10× | 1 | 0.41 | 2,482 | 67 | 2,266 | 25 | 67 | 10 | 14 | 17 | 15 | 8.7% | model (population) |
| B | 10× | 64 | 20.1 | 3,214 | 143 | 2,309 | 114 | 56 | 13 | 335 | 223 | 21 | 28.1% | model (population) |
| B | 100× | 1 | 2.55 | 390 | 57 | 229 | 16 | 35 | 9 | 7 | 15 | 22 | 41.4% | model (population) |
| B | 100× | 64 | **21.6** | 2,850 | 255 | 278 | 271 | 55 | 12 | 1,288 | 661 | 28 | 90.2% | **ledger (saturated)** |
| B | 0 | 1 | 5.55 | 180 | 62 | 0 | 12 | 32 | 9 | 18 | 15 | 33 | 100% | cell (unsaturated) |
| B | 0 | 64 | **17.1** | 3,605 | 341 | 0 | 335 | 55 | 13 | 1,989 | 831 | 40 | 100% | **ledger (saturated)** |

Stage view at the binding rows: ledger net utilisation 1.00 with a mean queue of 18–19 requests. The 12 cells are at gross 1.00 but net 0.50–0.55, because they hold jobs while they wait on the admit crossing (P-62's rival). The ledger's mean service time is 8.4 ms (A, 0), 9.3 (A, 100×), 14.7 (B, 100×) and 18.8 (B, 0).

## Ceilings, ranked (where each binds on this machine)

| Rank | Ceiling | Height | Binds | Evidence |
|---|---|---|---|---|
| 1 | Model (stand-in at today's speed) | 1 / 22 s per need in flight | 1× and 10×, every width | `model (population)`; non-model share ≤ 13% at width 64 and 10× |
| 2 | **Ledger writer** (P-59's group-commit writer, one Python thread) | ~118 requests/s ≈ **37 needs/s** (3.2 requests per need, 8.4 ms service) | from width 6–8 at 100× and zero latency, both arms | `ledger (saturated)`, net 1.00; throughput flat from width 6 |
| 3 | Per-call spawn (arm B) | −36% at width 64 and 100× against A (21.6 against 33.9/s); 62 ms per need at width 1 | as soon as models are fast; it also inflates the writer's service time 1.6–2.2× | B rows; ledger service 14.7–18.8 ms against 8.4–9.3 |
| 4 | **Cells** (12 process cells) | net 0.53–0.55 at 37/s, so about **68 needs/s** | next after the writer (inferred from net utilisation) | stage view |
| 5 | CPU bands | all bands: 32–42/s; Efficiency only (`-c background` on the whole tree): 6.0/s | only if work is pushed off the fast cores | QoS table |
| 6 | Memory (16 GiB) | 43/s needs 2.5 GB (thread) to 4.6 GB (process) | not before 2–5 | memory roofline |

**At 100× the binding ceiling is the ledger writer**, in both arms, from width 6–8.

## Floors against observed (the limit of physics per bucket)

Observed is per need at width 1, zero latency (A; B for `spawnInit`). The operations per need come from the receipts: 2.1 model calls, 3 cell jobs, 3.2 ledger requests.

| Bucket | Observed | Floor on this machine (median) | Floor × ops | Headroom |
|---|---|---|---|---|
| `spawnInit` | 61.8 ms | persistent session stdio JSON round trip 9.2 µs; Node spawn to first byte 17.0 ms; `/usr/bin/true` spawn to exit 0.57 ms; fixture spawn to init 20.0 ms, to exit 21.1 ms | 0.02 ms (warm session); 35.7 ms (spawn) | **~3,200×** to a warm session; 1.7× to the bare spawn |
| `crossing` | 19.5 ms | stdio round trip 9.2 µs; `postMessage` round trip 5.6 µs; SAB + Atomics handoff 3.0 µs; v8 serialize + deserialize 0.25 µs/KiB at 16 KiB, JSON 0.9 µs/KiB | ~0.06 ms (7 crossings at 9.2 µs) | **~300×** (900× with SAB) |
| `ledger` + `freeze` | 23.0 ms (13 + 10) | per-request durable floor: SQLite WAL + `F_FULLFSYNC` commit 3.9 ms; grouped (256 rows) 0.043 ms/row; rollback + `synchronous=FULL` (the ledger's own settings, no `fullfsync`) 0.155 ms; `fsync` 4 KiB 0.029 ms; `F_BARRIERFSYNC` 0.39 ms; `F_FULLFSYNC` 3.1 ms | 12.5 ms (unbatched full sync); 0.5 ms (its actual SQLite settings) | **1.8×** to unbatched `F_FULLFSYNC`; **~45×** to its own sync settings, so the writer's cost is CPU, not disk (inferred, matching P-59's one-thread roof) |
| `compile` | 28.3 ms | not measured (compute) | — | U |
| `gate` + `promote` | 15.3 ms | not measured (compute); `promote` is the independent re-run that principle 8 keeps | — | U |
| Payload transfer | — | `postMessage` copy: 1 KiB 6.2 µs, 64 KiB 10.5 µs, 1 MiB 62 µs; transfer 5 µs at any size | — | candidates are a few KiB, so payload bytes are not the cost; the per-crossing overhead is |
| Tooling WASM (binaryen, 8.9 MB) | — | compiled per worker: 5.6 ms and 1.84 MB each; one compiled `WebAssembly.Module` shared to 8 workers: 3.6 ms and 0.15 MB each | — | 12× less memory and 1.5× faster start per cell |

**Floor gaps, ranked by milliseconds per need recoverable** (zero latency, width 1):

1. `spawnInit`, arm B only: 62 ms per need, 3,200× above a warm session. It is 34–51% of an arm B need, and far more with a real `claude -p` (285 ms).
2. `crossing`: 19.5 ms, about 300× above the IPC floor. That is 23% of a need.
3. `ledger` + `freeze`: 23 ms, 1.8× above unbatched durable sync. Per need it is already near physics. The lever is batching, overlap and CPU per request, not the disk.
4. `compile` (28 ms) and `gate` + `promote` (15 ms): compute with no floor measured. They are cut by reuse (P-60), not by transport.

## Width, bands and QoS (zero latency)

Width sweep, cells = min(width, 12). The first sweep ran while other lanes were loading the host to 6–12. Its arm B rows from width 2 on, and the rerun's arm A rows from width 4 on, are **excluded** (see the correctness finding). Kept:

| Width | 1 | 2 | 4 | 6 | 8 | 12 | 24 | 64 |
|---|---|---|---|---|---|---|---|---|
| A needs/s (first sweep, load 6–12) | 9.4 | 20.2 | 27.1 | 24.3 | 24.6 | 25.9 | 17.2 | 20.7 |
| B needs/s (rerun, load 7–13) | 7.1 | 13.6 | 21.9 | **24.4** | 23.8 | 23.3 | 23.0 | 20.5 |
| B verdict | cell | cell | cell | cell | ledger | ledger | ledger | ledger |
| A at quiet load (predict, isolation, qos) | 11.6 | — | — | — | — | 32.0–42 | — | 37.5 |

QoS placement (arm A, width 12, zero latency, two repetitions each, interleaved):

| Placement | needs/s | vs default | verdict |
|---|---|---|---|
| default (macOS places all) | 32.7, 32.0 | — | ledger |
| band-aware: cells at tier 2 (`-t 2 -l 2`), parent and writer at the top class | 37.5, 27.1 | −0.3% (mean; spread ±16%) | ledger |
| cells on Efficiency only (`-b`) | 11.4, 10.6 | **−66%** | cell |
| writer on Efficiency only (`-b`) | 16.8, 14.4 | **−52%** | ledger (service 2.6–2.9× longer) |
| whole tree clamped to utility (`-c utility`) | 31.7, 28.7 | −7% | ledger |
| whole tree clamped to background, Efficiency band only (`-c background`) | 6.35, 5.58 | **−82%** | ledger |

Per band: the whole tree on the Efficiency band does 6/s; on all bands, 32–42/s. Band-aware placement **does not beat** letting macOS place everything: the difference is inside the run-to-run spread. The writer is latency-critical: demoting it alone costs half the throughput, so never give it a background class.

## Memory roofline (candidates/s per GB)

Fresh process per pool shape, 8 s of zero-latency work after warm-up, RSS of the whole tree:

| Cells | Process: tree GB | needs/s | /s per GB | Thread: tree GB | needs/s | /s per GB |
|---|---|---|---|---|---|---|
| 1 | 1.24 | 12.7 | 10.3 | 0.93 | 11.7 | 12.6 |
| 4 | 3.24 | 33.6 | 10.4 | 1.89 | 35.1 | **18.6** |
| 12 | 4.51 | 43.0 | 9.5 | 2.44 | 43.0 | 17.6 |
| 24 | 6.34 | 35.2 | 5.6 | 3.21 | 39.9 | 12.5 |

- **Per-cell resident floor**: process cells hold 218–354 MB RSS after passing work. Fewer compiles per cell means a smaller heap high-water, so the 24-cell pool's cells sit at 218–266 MB. Thread cells cost 104 MB (24 cells) to 154 MB (12) each at the margin.
- **What dominates**, from a child Node process: bare 47 MB → toolchain imported 49 MB → after one compile 279 MB (heap used 48, external 26, array buffers 8.6; the rest is code and the compiled binaryen module) → after 21 compiles 499 MB → after a forced GC still 499 MB, with heap used back at 27 MB. **Retained V8 heap high-water** (~220 MB) and the **toolchain's code plus compiled WASM** (~230 MB) dominate. Kitesurf, tsrs and Pyodide aren't loaded in this loop (no render, no lane), so they cost nothing here.
- **Shrinking by sharing**: thread cells, which share one process's code, cut the per-cell cost 2–3×. One shared compiled binaryen module saves 1.7 MB per cell (measured), which is small next to the heap. Lazy tooling isn't applicable: the toolchain is used by every job. Retiring cells earlier (`retireAfterJobs` is 256) or capping the heap would attack the 220 MB high-water. That is **unmeasured**.
- **Best within 16 GiB**: 4 thread cells give the most per GB (18.6/s per GB); 12 cells give the most throughput (43/s, 2.4–4.5 GB). Past 12, per-GB efficiency falls, because the writer caps throughput while memory keeps growing. At today's ceilings, 16 GiB is about 3.5× more than peak throughput needs (process) or 6.5× (thread).

## Tiered memory (RAM, compressed, swap)

Hard caps held, and no setting was changed. Attempt 1 started with host swap already at 8.85 GB used, from other workloads on the machine. That is above the 8 GB cap, so the run stopped after the hot-only row (41.0 needs/s, p95 388 ms; 3.7 GB compressor; load 17.9, so the row is labelled loaded). It added no ballast. Swap then fell from 8,745 to 8,681 MB over 60 s.

**Attempt 2** ran once host swap had fallen to 5.1 GB. It added idle ballast pools of 6 warm process cells next to a hot pool of 12 cells doing zero-latency work. It stopped on the swap cap at 18 ballast cells (30 resident cells in all). The pressure level reached *warn* (2) once and never *critical*, and free disk stayed at 74–78 GB:

| Step | Tier reached | Tree RSS GB | Compressor GB | Swap used GB | Hot needs/s | Hot p50 / p95 ms | Swap-ins during step |
|---|---|---|---|---|---|---|---|
| hot only (12 cells) | RAM | 4.45 | 4.86 | 5.28 | **38.2** | 273 / 404 | 1,341 |
| + 6 idle cells | RAM + compressed | 3.60 | 5.27 | 6.33 | 32.6 | 331 / 542 | 16,293 |
| + 12 idle cells | compressed | 3.89 | 4.58 | 6.95 | 28.9 | 369 / 635 | 6,371 |
| + 18 idle cells | compressed + swap | 3.27 | 5.05 | **8.55** (cap) | 28.1 | 397 / 619 | 17,383 |

- **Tree RSS fell as cells were added**, from 4.45 to 3.27 GB. macOS compressed and swapped the idle cells' pages, and the hot pool's throughput fell 26%. The p95 grew 53%, because the hot cells' pages were being evicted too.
- **Cold page-in** (one need per ballast cell after 60 s idle, 6 at a time per pool): 352–462 ms p50 cold against 221–250 ms warm, so **+120–240 ms per cell on first use**. The first pool came back from swap (10,437 swap-ins, about 163 MB). The other two came back from the compressor (24–30k decompressions, almost no swap-ins). Each ballast pool then ran 6-wide at 25.7–28.4 needs/s.
- **Tiered against a smaller all-RAM pool**: 12 hot cells all in RAM (38.2/s) beat 12 hot cells plus 18 idle warm cells left to compress and swap (28.1/s). While the writer caps throughput, idle warm cells buy nothing, and their paging taxes the hot pool. Tiering would pay only when the next need's cell isn't hot, and only if a page-in (120–240 ms) is cheaper than a cold start. A fresh 2-cell process pool took 1.28 s to `ready` in the pilot, so paging in is about 5–10× cheaper than a cold launch.
- **Throughput per tier**: RAM 38.2/s (8.6/s per GB of tree RSS); compressed 28.9–32.6/s; compressed plus swap 28.1/s. The swap tier's own ceiling wasn't reached inside the cap.
- **Release**: every pool closed, and swap fell from 7,601 to 6,577 MB over the next 60 s.

Host swap use came mostly from other workloads (5.1–8.9 GB before either attempt), so these figures are for this machine as it was being used, not a clean one.

## Levers 7–12, ranked by measured payoff

| Rank | Lever | Payoff measured here |
|---|---|---|
| 1 | **11 Contention tiers** (sharded or cheaper-per-request writer; group commit is already on main) | Lifts the binding ceiling: 37 → about 68 needs/s (the cell roof), **≈1.8×** at width from 100× on. At width 1, at most the 23 ms of ledger + freeze (27% at zero latency). |
| 2 | **8 Residency** (warm engine sessions, no spawn per call) | Arm B → A: **+57%** at width 64 and 100× (21.6 → 33.9/s), +108% at zero latency (17.1 → 37.5/s). −62 ms per need at width 1 (fixture). It also removes the 1.6–2.2× writer slowdown that spawns cause. |
| 3 | **9 Overlap** (async ledger behind a completion barrier) | Width 1: up to 23 ms per need (27% at zero latency, 11% at 100×). At width it adds nothing until lever 11 lifts the writer. |
| 4 | **10 Handles, in-process** | Width 1: up to 19.5 ms per need (23%), 300× above the IPC floor. At width the crossing bucket is mostly waiting for a cell. |
| 5 | **7 Captured graphs** | A subset of 10: one cell job per need instead of 3 would save about two thirds of the crossing, ≈13 ms (15%, inferred). |
| 6 | **12 Context and memory tiers** | Thread cells give 1.8× the candidates/s per GB, but no throughput: memory doesn't bind within 16 GiB at today's ceilings. |

**Climb order for the one-PR-per-ceiling loop:** (1) the ledger writer, sharded or less CPU per request (lever 11), aiming for the ~68/s cell roof; (2) warm sessions in place of spawn per call (lever 8); (3) overlap the ledger off the single-need critical path (lever 9); (4) one crossing per attempt, with handles (levers 10 and 7); then re-run this probe to find the cell roof's real height.

## Correctness finding: commit-time re-run disagreement in long-lived host processes

In two plans, after about 4,000–5,000 needs in one host process, most expected promotions failed with *independent re-run at commit disagrees with the cell report*. It hit 68–160 of 133–187 needs per row in the first sweep's arm B (width 2 on) and in the rerun's arm A (width 4 on). It was always fail-safe: refused, never wrongly promoted. Once it started, it persisted for the rest of the process, and CPU per candidate rose from 20–150 to 575–880 ms. A fresh process (the rerun's arm B, the QoS and isolation plans, and every memory plan) didn't show it in 6,000+ needs. The cause is **not established**. The leading suspect is host-side state that grows with the process's needs in the commit-time re-run (`checkAtCommit` → `runGates`). A candidate is the WASM memory limit hook that P-50's corpus builder installs in the harness process (`installWasmLimit`), whose `flags` set is walked on every check. That would make it a harness artifact rather than a loop bug, but this probe can't tell them apart. Excluded rows stay in the receipts (`sweep.json`, `sweep-rerun.json`), each with its outcome histogram. **Next probe:** run 10,000 needs in one process with and without the corpus builder's hook, and record the commit re-run's disagreement reason.

## Other findings

- The ledger connection sets `synchronous=FULL` without `PRAGMA fullfsync` (`core/ledger/ledger.py:133`). On macOS, SQLite then uses `fsync` (0.03 ms here), which doesn't force the drive cache to stable storage. `F_FULLFSYNC` costs 3.1 ms. `tools/durable.py` uses `F_FULLFSYNC` for its own files. Whether the ledger's macOS durability is what principle 12 intends is an owner question, not a speed lever.
- Arm B's `promote` bucket is 22–40 ms against A's 8–17. Each per-call child's exit and reap overlaps the commit. Inferred, not isolated.

## Receipts

`receipt/accept/`: `floors.json` (all microbenchmarks plus disk), `predict.json`, `sweep.json` (first sweep, including excluded rows), `sweep-rerun.json`, `qos.json` (resumed once after a harness fix: `taskpolicy` was applied to a transient `ps` child, so the `cells-utility` arm crashed; the fix filters cell PIDs to `node`), `qos-clamp-clamp-utility.json`, `qos-clamp-clamp-background.json`, `isolation.json`, `memory-composition.json`, `memory-pool-{process,thread}-{1,4,12,24}.json`, `memory-tiers-attempt1.json`, `memory-tiers.json`. The first Claude session running the driver exited mid-`predict`. The harness resumes by label, so rows already in a receipt were kept, and the interrupted row (`A-s0-w1`) was re-run from scratch. After the first sweep, the harness gained an outcome histogram and transport-error counts per row. Rows from before that change carry neither.
