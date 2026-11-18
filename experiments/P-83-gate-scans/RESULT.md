# P-83 gate-scans: the non-finite reading reads each contract sentence once, on top of P-82: result

Status: **kept** (every keep bar met, including GitHub Linux CI on PR #185 at 85c78de: lint, test (22), test (26), coverage, rust-lane and secret-scan green), 2026-11-18. Reference machine: Apple M6 Mac mini, 12 cores (2 Super, 4 Performance, 6 Efficiency), 16 GiB, Node v26.13.1, Python 3.15.2. Stand-in model only (arm A, zero latency): **no model calls, no tokens**, and the harness asserts that the credential variables are unset. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`. It was committed (0c33e2f) before any acceptance row.

- **Lever measured:** 192ab2d, pushed before the acceptance rows; every P-83 receipt names it. 5b1f690 changes only `nfeq.mjs`, an experiment tool.
- **Base arm:** P-82 at c1aea68 (`climb-r9-release-successor`), run from a worktree with an uncommitted copy of this folder's `run.mjs` and PRECOMMIT.
- **Receipts:**
  - acceptance rows: `receipt/accept-p82/` and `receipt/accept-p83/` (`row-{w64,w1}-{0..3}.json`), summarised in `receipt/summary.json` (`summarize.py`);
  - step 1: `receipt/floors/` (`floor.mjs`, the width-1 cell profile, and the equivalence checks) and `receipt/explore-sizing/` (cell count 8 to 14);
  - correctness: `receipt/stream.json` (`stream.py`, from the capture rows in `receipt/guard-p82/` and `receipt/guard-p83/`), `receipt/tests-p82.json`, `receipt/tests-p83.json` and `receipt/reruns.json`.

**Width-64 throughput rose 3.9%**, from 80.8 to 83.9 needs/s (Welch t = 7.8, df ≈ 5.8, **p ≈ 0.0003**). That is inside the predicted +3% to +6%, and every P-83 row beats every P-82 row. **Width 1 fell 9.8%**, from 60.1 to 54.2 ms per need (t = −13.9, p ≈ 0.0002), beyond the predicted −3% to −7%.

Needs/s per GB rose from 17.2 to 17.5. The request stream is identical, there were 0 wrong verdicts, and there is no new test failure.

## Step 1: the floors

`floor.mjs` runs the 21 corpus kernels in one warm process, with no isolation, cell or ledger. It uses the cell's own `asc.main` call (`x1Flags`) and `runGates` on the cell's files, and takes the median of rounds 2–9.

| Bucket | Floor per call (P-82 → P-83) | Calls per need | Width 1, P-82 → P-83 | ÷ floor (P-83) | Width 64, P-82 → P-83 | ÷ floor (P-83) |
|---|---|---|---|---|---|---|
| `compile` | 20.4 → 20.9 ms (unchanged code) | 1 | 25.3 → 24.6 ms | **1.18×** | 78.0 → 79.8 ms | **3.8×** |
| `gate` | **2.79 → 1.39 ms** | 2 in the cell (+1 commit-time re-run on the host, counted in `promote`) | 7.5 → 3.3 ms | **1.2×** (floor 2.8 ms per need) | 25.1 → 15.6 ms | **5.6×** |

- The floor doesn't move with the WASM guard, the cell's heap flags or the permission model (20.3–20.5 ms and 2.7–3.0 ms on P-82). Under `taskpolicy -b` (efficiency cores, background clamp) it is 135 ms and 21 ms.
- At width 1 both buckets sit within 1.2× of their floors. At width 64 their wall is 3.8–5.6× the floor, while CPU per need is 1.84× width 1. Most of that wall is waiting for a core and running on efficiency cores, which falls only as CPU per need falls.

## Step 2: why this lever

- **(a) Pool size from the machine: measured flat, not chosen.** Exploratory rows on P-82 (2 per count, width 64, `receipt/explore-sizing/table.txt`):

  | Cells | needs/s |
  |---|---|
  | 8 | 79.5, 79.6 |
  | 10 | 80.3, 80.6 |
  | 12 | 80.6, 80.7 |
  | 14 | 81.3, 82.7 |

  Each added cell lengthens every job's service time in proportion (29 → 36 → 44 → 50 ms), so the cells complete about 250–258 jobs per second at every count. The machine's capacity binds, not the slot count. A rule derived from the measured cores could at best match 12, so no rule was written.
- **(b) V8 startup snapshot: bounded at ≤ +2%, not chosen.** Of a replacement's ~2 CPU-s, a snapshot can hold only the compiler's JS heap. The 235 ms load is about 2.5 ms CPU per need at width 64. The binaryen WebAssembly module and lazily compiled code are not kept, and `--build-snapshot` doesn't load the cells' ESM.
- **(c) Gate CPU without changing outputs: chosen.** A CPU profile of the cells at width 1 (`receipt/floors/profile-w1-p82*.txt`, 255 needs) put `nonFiniteExpectation` at 961 ms, more than half of `runGates` (1,784 ms). Its `promises` regular expression alone took 891 ms. The function read the shared sentences once per export, and a corpus contract has 13 exports and a 1,949-character line.

## Predictions against measurement

The rows ran 4 + 4 interleaved, one row per host process, in the order w64 P-82, w64 P-83, w1 P-82, w1 P-83.

| Quantity | P-82 | P-83 | Predicted | Verdict |
|---|---|---|---|---|
| needs/s, width 64 | 80.11, 80.58, 81.62, 80.78 (**80.8**) | 83.17, 84.22, 84.16, 84.20 (**83.9**) | +3% to +6% (bar ≥ +3%, p < 0.05) | **met** (+3.9%, t = 7.8, p ≈ 0.0003) |
| All CPU per need, width 64 | 129.7 ms (host 7.9, cells 106.5, writers 15.2) | 125.3 ms (host 5.8, cells 104.2, writers 15.2) | −3% to −7% | met (−3.4%) |
| Cores by role, width 64 | 10.47 (cells 8.61) | 10.52 (cells 8.75) | — | the same machine, more needs |
| Cell net utilisation, width 64 | 0.936 | 0.931 | — | unchanged |
| Cell queue wait, width 64 | 113.9 ms | 102.8 ms | — | −10% |
| `gate` per need, width 64 | 25.1 ms | 15.6 ms | 12–18 ms | met |
| `gate` per need, width 1 | 7.5 ms | 3.3 ms | 4.0–5.5 ms | beyond (better) |
| `compile` per need | 25.3 / 78.0 ms | 24.6 / 79.8 ms | unchanged ±5% at width 1 | met |
| Wall per need, width 1 | 61.2, 59.7, 60.1, 59.4 (**60.1 ms**) | 53.8, 54.5, 54.4, 54.1 (**54.2 ms**) | −3% to −7% (bar ≤ +3%) | **met, beyond the range** (−9.8%, t = −13.9, p ≈ 0.0002) |
| CPU per need, width 1 | 79.7 ms (cells 66.2) | 68.0 ms (cells 55.9) | — | −14.7% |
| Tree RSS (window end), width 64 | 4.69 GB | 4.81 GB | ±5% | met (+2.6%) |
| needs/s per GB, width 64 | 17.23 | 17.46 | must not fall | **met** (+1.3%) |
| Ledger stage utilisation, width 64 | 0.859 (0.848–0.879) | 0.898 (0.883–0.919) | ≤ 0.95 mean | met; rising with throughput |
| Stage verdict, width 64 | `cell (saturated)` × 4 | `cell (saturated)` × 4 | — | unchanged |

- **Width 1 gained more than predicted.** The cell's CPU per need fell 10.3 ms, against about 3 ms predicted from the warm floor (2 runs × 1.4 ms). At width 1 a cell retires every ~5 s and serves only about 85 needs, so most gate runs happen in a cell that is still warming. The likely explanation, not measured separately, is that the regular-expression passes cost more there than in the warm floor, and the old code ran them 13 times per contract. The host's commit-time re-run (`promote`) fell 3.1 → 1.8 ms for the same reason.
- **Load above 16 during two rows.** P-83's `w64-r0` ended at load 16.8 (85.04 needs/s), and `w64-r2` at 17.1 (84.23). Each re-ran at once and ended above 16 again (83.17 at 18.8, and 84.16 at 19.0). The load came from the rows' own 12 cells and 4 writers, with nothing else busy, the same as P-82's `w64-r2`.
  - The receipts keep the re-runs, which started at load 13.4–13.5 because the harness re-runs a loaded row straight away (P-77's finding).
  - The harness waited for load ≤ 16, and the next row started at load ≤ 4.
  - The discarded first runs were higher than the kept re-runs, so keeping the re-runs makes the measured gain smaller, not larger.
- **Per GB.** The precommitted measure (mean needs/s ÷ mean window-end tree RSS) rose 1.3%. The sampled peak rose from 5.37 to 5.81 GB, which put per sampled-peak GB at 15.1 → 14.4 (−4%). The peak is the noisiest number in these receipts: in the P-82 arm alone it ranges 4.99–5.83 GB, and the lever adds no memory. Both are recorded here; the keep bar uses the precommitted measure.

## Correctness guard

- **Rows:** every row on both arms has `wrongVerdicts` = 0 and `errors` = 0. Both arms show the same two outcome classes, `true/true/passed/-` and `false/false/failed/-`, at 14.2–14.3% failed in every row.
- **Request stream** (`stream.py`, width-1 capture rows, `stream.json`): for the 205 needs both rows completed, all 205 `admit`, 234 `park` and 205 `commit` requests are identical across arms, with 0 differing. `contract.mjs`'s two digests and the frozen identity are mapped, and `commit` is compared after dropping the timing fields. The `commit` requests carry the full gate report, so every gate's verdict and finding is identical.
- **Equivalence, re-run on the lever commit** (`receipt/floors/`):
  - `nonFiniteExpectation` agrees on all 20,046 cases (`nfeq.txt`);
  - `runGates` results are identical on the 42 corpus cases, apart from wall-time fields (`gateeq.txt`);
  - compiled WebAssembly digests are identical for all 18 kernels that compile (`floor-p82.json`, `floor-p83.json`).
- **Tests:**
  - The new test passes: `the non-finite reading of a sentence shared by every export is the reading each export would get alone`. It checks 400 seeded contracts against the per-export reading. So does the rest of `x1-contract.test.mjs` (52 of 52), and so does the guard's rewrite pin, `isolate-wasm-rewrite.test.mjs`.
  - `make -k test`, run one command per file on both arms, with `--test-timeout=120000` under a 600 s alarm and `isolate-host-call.test.mjs` excluded on both: **no failure on P-83 that P-82 does not have.** Each arm has 43 failing commands, the same ones. P-83 has 120 named failing tests and P-82 has 121. All are pre-existing: `loop-agent`, `loop-count`, `loop-review`, `isolate-pool`'s bridge-death and prewarm cases, `isolate-limits`, `tscheck`, the gap targets, and so on.
  - P-82 shows two more failing commands, both artefacts of the setup: `experiment_id.py check` and `test_allocations_are_complete` fail there because its worktree held an uncommitted copy of this folder, which is not in that tree's `ALLOCATED`.
- **`loop-crash.test.mjs`**, run 4 times on each arm (`reruns.json`): the random-kill case (`bridge and supervisor kills at random times never yield a promotion without its evidence`) failed 2 of 4 on P-82 and 1 of 4 on P-83. It also failed in the suite run on both arms. That is the same timing flake as P-79 to P-82, and it is no more frequent on the lever.
- `make check` and `make lint` pass on the lever, including `check_comments` (0 comment lines).
- **Not changed:** every gate and what it decides; the regular expressions; the freeze rule and its checks; the frozen record; durability; REQ-ISO-016 (`retireAfterJobs` 256); the cell count; isolation and permissions; and P-75 to P-82's levers.

## Floors against observed (zero latency, P-83)

Width 1, per need (wall 54.2 ms):

| Bucket | Share of wall | Observed | Physical floor | Distance |
|---|---|---|---|---|
| `compile` | 45% | 24.6 ms | 20.9 ms (warm `asc.main`, one process) | **1.18×** |
| `ledger` + `freeze` | 37% | 20.2 ms | about 11 ms (3.14 requests × 3.5 ms unbatched `F_FULLFSYNC`, P-79) | **1.8×** |
| `crossing` | 7% | 4.0 ms | 4.1 ms with no cell replacements (P-78) | 1.0× |
| `gate` | 6% | 3.3 ms | 2.8 ms (2 × 1.39 ms) | **1.2×** |
| `promote` | 3% | 1.8 ms | not measured (one re-run plus one bridge request) | — |

Width 64, throughput resources:

| Resource | P-83 | Floor | Distance |
|---|---|---|---|
| Cell slots | gross = net 0.93; 103 ms queue wait; flat from 8 to 14 cells | — | not the ceiling: the count doesn't move needs/s |
| Machine CPU | 10.5 cores, 125 ms per need | 68 ms per need (width 1) | **1.84×** |
| Cell CPU per need | 104 ms | 56 ms (width 1) | **1.86×** |
| Ledger writers | 0.898 in flight, 15.2 ms CPU per need | 11.4 ms CPU per need (replay, P-79) | 1.33× CPU; nearing saturation |

**The stop rule's floor condition is not met.** At width 1 every bucket of 5% or more is within 1.5× of its floor except `ledger` + `freeze` (1.8×). At width 64, machine CPU per need is 1.84× its width-1 value. **The stuck condition is not met** either: this round gained +3.9%, and P-82 gained +5.8%.

## Next binding ceiling

1. **The machine's capacity, through CPU per need at width 64** (125 ms, 1.84× width 1). The cell-count sweep shows that only less work per need moves needs/s. In the order of what's left:
   - **Replacements:** 23 starts per window at about 2 CPU-s each under load, about 22 ms per need (~18% of CPU). Removing them needs the owner's decision on REQ-ISO-016's interval; otherwise the cell start has to get lighter.
   - **`compile`:** 20.9 ms per need at floor speed, and 1.18× at width 1. It can't be cut without changing the compiler or its inputs. AssemblyScript probably re-parses its standard library on every `asc.main` (not profiled in detail), and caching that would need the compiler's internals.
   - **The rest of the cell's per-job work:** `verifyFromMemory` hashes the frozen record twice per need, which is an integrity check, so it stays. JSON passes and the unit and glue findings each take ~1 ms per need.
2. **The four ledger writers:** 0.898 mean in-flight utilisation (0.883–0.919), up from 0.859 as throughput rose. About +5% more throughput would push them past 0.95. They are latency-bound on `F_FULLFSYNC` batches, so `ledger` + `freeze` (290 ms wall per need at width 64, 1.8× the width-1 floor) would bind next.

## Code delta

- **Product:** `core/runtime/x1/contract.mjs` +15 −4 lines: `nonFiniteExpectation` reads each sentence once, and `glueFindings` computes the whole-contract precision once. `core/runtime/test/x1-contract.test.mjs` adds one test (+25 lines), and `sources/SHA256SUMS` was regenerated. No new option, process or language crossing.
- **Experiment tools:**
  - `run.mjs` and `exit-on-term.mjs` are P-82's, unchanged;
  - `summarize.py` is P-82's, for two arms;
  - `stream.py` is P-82's, with `contract.mjs`'s digests mapped;
  - `floor.mjs`, `nfeq.mjs` and `gateeq.mjs` are new.

## Receipts and how to reproduce

- `run.mjs <out> <stamp> row <w64|w1> <rep>` runs one acceptance row. `run.mjs <out> explore diag 64 <tag> cells=<n>` runs a sizing row (the `cells=` option was in the exploratory copy only, so add it to `diag` to rerun). `run.mjs <out> <stamp> capture1` runs a width-1 capture row.
- `node floor.mjs <repo root> <corpus.json> 10` measures the `compile` and `gate` floors. The corpus is `buildCorpus()` from `experiments/P-50-in-isolate/corpus.mjs`, written as JSON.
- `node nfeq.mjs <corpus.json> <root A URL> <root B URL>` and `node gateeq.mjs <corpus.json> <root A URL> <root B URL>` check the equivalence.
- `summarize.py` builds the acceptance table with Welch t and p. `stream.py <capture P-82> <capture P-83>` compares the request streams.
