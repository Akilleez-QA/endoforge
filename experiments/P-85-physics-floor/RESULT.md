# P-85 physics floor: the random-kill test kills inside its round, and the machine's capacity for this work sets the width-64 floor, on top of P-84: result

Status: **Part A fixed; Part B measured; Part C none (not triggered)**, 2026-11-18. The stop rule's floor condition is **met**: at width 1 every bucket of 5% or more is within 1.5× of its floor (P-84), and at width 64 every resource is within 1.5× of its floor measured on this machine. The climb is at the limit of physics for the runtime as it stands. What remains is owner decisions and structural changes, listed at the end.

Reference machine: Apple M6 Mac mini, 12 cores (2 Super, 4 Performance, 6 Efficiency), 16 GiB, Node v26.13.1, Python 3.15.2. Stand-in model only (arm A, zero latency): **no model calls, no tokens**. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed (a19bca1) before any measurement. Base: P-84 at e80094b (`climb-r11-bundle-objects`). No product code changed in this round.

- **Receipts:**
  - Part A: `receipt/loop-crash/` (12 local runs);
  - Part B: `receipt/sweep/` (probe rows, `capacity.mjs`, driven by `sweep.py`), `receipt/ref-p84/` (P-84's same-session reference rows), `receipt/summary.json` (`summarize.py`), `receipt/corpus.json` (the 21 kernels);
  - correctness: `receipt/stream.json`, `receipt/guard-p84/`, `receipt/guard-p85/`, `receipt/tests-p84.json`, `receipt/tests-p85.json`.

## Part A: the random-kill case kills inside its round

- **Change** (23f3936, test only, +13 −7): the kill is placed by observed tasks, not by a fixed delay. The test waits for task `after`, times task `after + 1` from the log, then kills a seeded fraction of that time into task `after + 2`, or at once when task `after + 2` is logged. The seeded draw is the one that set the old delay, so `after` and each round's target process are unchanged. At least four tasks remain at every kill. The log is polled every 2 ms.
- **Assertions:** none removed or weakened. `finished before its kill` is still asserted and now always holds. Two are added: the round has not ended before tasks `after` and `after + 1`.
- **Local, on P-84's code:** **12 of 12 runs pass** (the whole file, 39 of 39 tests per run), against 5 of 12 for the old case on P-84 (P-84's `reruns.json`). **96 of 96 kills land while the driver runs**; 94 land mid-task, and 2 land at the cap, when the next task logged first. Tasks took 85–104 ms each.
- **GitHub Linux CI:** green on a19bca1 and a17986d (test (22), test (26), coverage, lint, rust-lane, secret-scan). On CI, tasks took 171–893 ms, and every kill again landed inside its round.

## Part B: the machine's capacity for the cell's work

`capacity.mjs` runs N independent warm processes. Each one does the cell's per-need work: one `asc.main` compile with `x1Flags` and two `runGates` runs, cycling through the 21 corpus kernels, with no ledger, isolation or cell protocol. All processes start together after a 12 s warm-up. Over a 40 s window, each counts only the jobs between its first and last job boundary. Two interleaved passes ran, the second in reverse order; each row started at load ≤ 4. User-level APIs only: no system settings, no sudo.

| N (processes) | jobs/s | Cores used | CPU per job | φ (÷ N = 1) | Effective cores (jobs/s × c₁) | Compile wall per job | Gate wall per job (2 runs) |
|---|---|---|---|---|---|---|---|
| 1 | 42.9 | 1.50 | 34.95 ms | 1.00 | 1.50 | 21.0 ms | 2.34 ms |
| 2 | 81.8 | 3.08 | 37.7 ms | 1.08 | 2.86 | 22.0 ms | 2.48 ms |
| 4 | 133.5 | 6.26 | 46.9 ms | 1.34 | 4.67 | 26.9 ms | 3.10 ms |
| 6 | 175.3 | 9.19 | 52.4 ms | 1.50 | 6.13 | 30.6 ms | 3.67 ms |
| 8 | 189.7 | 10.64 | 56.1 ms | 1.61 | 6.63 | 37.6 ms | 4.59 ms |
| 10 | **199.4** | 11.37 | 57.0 ms | 1.63 | **6.97** | 44.6 ms | 5.52 ms |
| 12 | 198.4 | 11.46 | 57.8 ms | 1.65 | 6.93 | 54.0 ms | 6.48 ms |
| 12 + non-cell load (0.86 cores measured) | 184.2 | 10.53 | 57.2 ms | **1.635** | 6.44 (+0.86) | **58.1 ms** | **7.06 ms** |
| 14 (one pass; swap 5.0 GB) | 190.4 | 11.23 | 59.0 ms | 1.69 | 6.66 | 65.1 ms | 8.44 ms |
| 1, `taskpolicy -b` (efficiency cores, clamped) | 6.6 | 1.48 | 223 ms | 6.39 | 0.23 | 135 ms | 16.4 ms |
| 6, `taskpolicy -b` | 21.2 | 5.24 | 247 ms | 7.07 | 0.74 | 253 ms | 29.8 ms |
| 1, `taskpolicy -c utility` | 43.4 | 1.50 | 34.6 ms | 0.99 | 1.52 | 20.7 ms | 2.31 ms |

The two passes agree within 4% at every N. Rows N ≥ 12 and P-84's width-64 rows ended above load 16 from their own threads; each was re-run once from load ≤ 4, and the re-runs agree with the first runs (198.5 → 197.3 and 195.4 → 199.5 jobs/s at N = 12).

- **The machine is about 7 width-1-speed cores for this work, not 12.** Throughput stops rising at N = 10, with 11.4 cores busy. Each core-second then does 1.63× less work than at width 1. One compile stream uses 1.5 cores, because V8's background compiler and GC threads run beside it. So 4 processes already occupy 6.3 cores, and from 6 processes on the 6 efficiency cores carry part of the load.
- **The efficiency cores add little.** From N = 6 (6.13 effective cores) to N = 12 (6.93), the machine gains 0.8 effective cores. Pinned to the efficiency cores under background QoS, each stream runs 6.4× slower than at N = 1 (this is a lower bound: background QoS also clamps their frequency). Utility QoS changes nothing.
- **Precommit correction (units).** The precommit defined S_N = J_N / J_1, in job streams, and X* = S / C₁. One stream uses 1.5 cores, so that S is in streams, not cores: S_12 = 4.63, which gives X* = 74 needs/s. That is below the observed 96 needs/s, which is impossible for a ceiling, and it shows the unit error. The ceiling below uses CPU-time units, S = J_N × c₁ (equal to J_N / J_1 × 1.50 cores), with C₁ as precommitted (CPU per need, all threads, all roles). This S is larger, so the ceiling is higher and the verdict is harder to reach: the precommit's stated direction for any choice.

### The derived width-64 floor

- **C₁** (P-84's width-1 CPU per need, all roles: 4 acceptance rows plus 2 same-session rows): **62.3 ms**.
- **S** = max(S at N = 12 with the load, plus the load's 0.86 cores, = 7.30; the best S_N, 6.97 at N = 10) = **7.30**. Adding raw load cores to width-1-speed cores counts the load at full speed, so this S also errs high.
- **Throughput ceiling at width 64: X\* = 7.30 / 62.3 ms = 117 needs/s** (112 from the best probe row alone).

| P-84 at width 64 | needs/s | Fraction of X\* | X\* ÷ X | Core occupancy (cores ÷ 12) | Excess inflation R = CPU per need ÷ (C₁ × φ) |
|---|---|---|---|---|---|
| Acceptance rows (P-84, 4 rows) | 96.3 | **0.82** | **1.22×** | 0.89 | 1.09 |
| Same session (2 rows, both re-run from load ≤ 4) | 90.6 | 0.77 | 1.29× | 0.86 | 1.12 |
| Pooled (6 rows) | 94.4 | 0.81 | 1.24× | 0.88 | 1.10 |

The machine ran about 6% slower in this session than during P-84's acceptance, at equal width-1 wall (48.4 and 49.3 ms against 48.8). Both views are within 1.5×.

### Per-bucket distances at width 64 against floors scaled by capacity

**The condition: resources** (precommitted). At width 64 the loop is closed with 64 needs in flight, so wall per need is 64 / X by Little's law. A queueing bucket has no floor of its own, so the condition is judged on resources:

| Resource (share of CPU per need) | P-84 (acceptance / session) | Floor | Distance |
|---|---|---|---|
| Throughput | 96.3 / 90.6 needs/s | 117 needs/s | **1.22× / 1.29×** |
| Cells' CPU per need (89%) | 98.8 / 101.2 ms | 55.4 × 1.635 = 90.5 ms | **1.09× / 1.12×** |
| Writers' CPU per need (6.5%) | 7.2 / 7.4 ms | 3.95 × 1.635 = 6.5 ms | **1.12× / 1.15×** |
| Host CPU per need (4.8%, below 5%) | 5.3 / 5.5 ms | 3.0 × 1.635 = 4.9 ms | 1.09× / 1.11× |

**Wall buckets (diagnostics, as precommitted):**

| Bucket (share of width-64 wall) | P-84 (acceptance) | Scaled floor | Distance |
|---|---|---|---|
| Wall per need | 663.7 ms | 64 / X\* = 546 ms | 1.22× |
| `compile` (12%) | 79.0 ms | 58.1 ms (probe, N = 12 with the load) | **1.36×** (session 1.43×) |
| `gate` (2.2%, below 5%) | 14.8 ms | 7.06 ms | 2.1× |
| `crossing` (66%) | 440 ms | no floor of its own: 131 ms of it is the wait for a cell slot (cells net 0.99), the rest the job's cell-side work under load | — |
| `ledger` (11%) | 73.3 ms | 115 ms (Little's law at the ceiling × the width-1 share) | 0.64× |
| `freeze` (7.7%) | 51.4 ms | 58.6 ms | 0.88× |

- `compile`'s wall at width 64 (79 ms against 21 ms at width 1) is mostly physical. Twelve warm compile streams with nothing else running take 54 ms each, and 58 ms beside the measured non-cell load. The remaining 1.36× is the cells' other work (replacements, admission checks, the cell protocol) competing for the same cores.
- `gate` is 2.1× its probe floor. It is under 5% of wall, and its CPU is inside the cells' 1.09×.

### Predictions against measurement

| Quantity | Predicted | Measured | Verdict |
|---|---|---|---|
| S_12 | 6.0–8.5 | 6.93 effective cores (4.63 as precommitted, in streams: see the unit correction) | met in cores |
| φ_12 | 1.4–2.0 | 1.65 (1.635 with the load) | met |
| X\* | 96–137 needs/s | 117 (112) | met |
| P-84 ÷ X\* | 0.70–1.00 | 0.82 (session 0.77) | met |
| R | 0.9–1.3 | 1.09–1.12 | met |
| Every resource distance ≤ 1.5× | yes | yes (largest 1.29×) | met |
| Probe compile wall, N = 12 with the load | 30–45 ms; P-84 at 1.7–2.6× | 58.1 ms; P-84 at 1.36× | missed: the floor is higher, because one compile stream uses 1.5 cores |
| Part C triggered | no | no (X\* ÷ X = 1.22–1.29; roles 1.09–1.15) | met |

## Part C: none

Not triggered: X\* ÷ X is 1.22–1.29, and every role at 5% or more is within 1.15× of its scaled floor. No lever was run.

## Correctness guard

- **Rows:** every harness row has `wrongVerdicts` = 0 and `errors` = 0: P-84's four same-session rows and both capture rows. The outcome classes are the same two as P-84's (`true/true/passed/-`, `false/false/failed/-`), in the same proportions (about 86/14).
- **Request stream** (`receipt/stream.json`, width-1 capture rows on P-84 at e80094b and P-85): for the 226 needs both rows completed, **all 226 `admit`, 258 `park` and 226 `commit` requests are identical**, with 0 differing.
- **Suite,** one command per file on both arms (`filetests.py`), with `isolate-host-call.test.mjs` excluded on both: **no failure on P-85 that P-84 does not have.** Each arm has 42 failing commands, the same ones, and 118 named failing tests, the same ones; all are pre-existing (`loop-agent`, `loop-review`, `isolate-pool`, `isolate-limits`, `tscheck`, the gap targets and so on). `loop-crash.test.mjs` passed on both arms in this run.
- `make check` passes, and `make lint` passes with ruff 0.17.0 (`All checks passed!`, `check_comments`: 0 comment lines).

## Stop rule

- **Floor condition: met.** At width 1, every bucket of 5% or more is within 1.5× of its floor (P-84: `compile` 1.22×, `ledger` + `freeze` 1.4×, `gate` 1.2×, `crossing` ≤ 1×). At width 64, throughput is within 1.22× (1.29× this session) of the machine's measured ceiling, and the cells' and writers' CPU per need are within 1.09–1.15× of their floors scaled by the machine's measured inflation.
- **Verdict: at the limit of physics on this machine for the plumbing as it stands.** The 18–23% between P-84 and the ceiling is 11–14% idle cores (with 12 cells saturated, and P-83's pool sweep flat from 8 to 14 cells) times 9–12% CPU per need above pure contention.
- **What remains, owner decisions:**
  - REQ-ISO-016's retirement interval: about 22 ms of cell CPU per need at width 64 (P-81), the largest single item above the compile-and-gates floor;
  - the macOS durability question (`PRAGMA fullfsync`, open finding): a durability choice, not a speed lever;
  - the model-side structural experiments in the climb loop's "When stuck" menu, measured on pass rate.
- **What remains, structural changes** (none is a runtime lever inside 1.5×):
  - **the compiler:** `compile` is 52% of width-1 wall at 1.22× its floor, and its floor is `asc.main` itself. Moving it needs the compiler's internals (a resident, already parsed standard library) or a different compiler;
  - **V8's helper threads:** each compile stream uses 1.5 cores, so the machine saturates at 10 streams. Fewer helper threads is a V8 flag, which P-81 found neutral or worse;
  - **the efficiency cores:** they add 0.8 effective cores for this work. More throughput needs a machine with more performance cores, not more cells;
  - **less work per need:** for example, one gate run instead of two, or a smaller cell protocol. That changes what is checked, so it is the owner's call.

## Code delta

- Product: none.
- Test: `core/runtime/test/loop-crash.test.mjs` +13 −7.
- Experiment tools: `capacity.mjs`, `sweep.py` and `summarize.py` are new. The corpus is `receipt/corpus.json`.

## Reproduce

- `node capacity.mjs <repo root> <corpus.json> <N> <window s> [warm s] [load duties] [background|utility]`.
- `python3 sweep.py <repo> <P-84 worktree> <corpus.json> <out> pass1|pass2|n14`.
- `python3 summarize.py <sweep out> <P-84 worktree>/experiments/P-84-bundle-objects/receipt/p85-ref <P-84 receipt/summary.json>`.
