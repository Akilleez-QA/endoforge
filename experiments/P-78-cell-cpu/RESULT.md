# P-78 cell CPU: measured first; a cell start made cheap (the WASM guard's rewrite copies bytes once), on top of P-77: result

Status: **kept** (every keep bar met), 2026-11-17, reference machine (Apple M6 Mac mini, 12 cores, 16 GiB, Node v26.13.1). Stand-in model only (arm A, zero latency): **no model calls, no tokens**, credential variables asserted unset. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed and pushed (f03ca94) before any acceptance row. Implementation measured: fe48b81. Baseline arm: P-77 (5d7b84f). Receipts: `receipt/accept-p77/` and `receipt/accept-p78/` (`row-{w64,w1}-{0..3}.json`), `receipt/summary.json` (from `summarize.py`), `receipt/tests.json`; the exploratory profile in `receipt/explore-p77/` and `receipt/profile/`.

**Width-64 throughput rose 20.7%** (63.6 → 76.7 needs/s, Welch t = 7.2, df ≈ 3.9, p ≈ 0.002), at the top of the predicted +8% to +20%. Cell CPU per need fell 17% (125 → 104 ms), inside the predicted −8% to −20%. **Width 1 fell 17%** (79.2 → 65.6 ms per need), well past the predicted −2% to −8%. That part of the prediction was wrong, and the miss was on the side of a larger gain: at width 1 a job waits on the warming replacement, so the cell start's wall time counts in full (`crossing` 19.9 → 9.6 ms). The four ledger writers now bind: the stage verdict is `ledger (saturated)` in all four P-78 rows, at 0.87–0.90 utilisation.

## Profile first: where cell CPU goes (exploratory, P-77 code)

Diagnostic rows ran on an unchanged P-77 worktree, one row per process, load ≤ 4 at the start of each. Turning retirement off was a diagnostic override only, and this round does not ship it.

| Per need | Width 1 | Width 64 |
|---|---|---|
| Cell CPU, as shipped (P-77) | 89.7 ms | 124.4 ms |
| Cell CPU with retirement off (diagnostic) | 63.8 ms | 86.1 ms |
| **Retirement's share of cell CPU** | **26 ms (29%)** | **38 ms (31%)** |
| Wall (width 1) or needs/s (width 64), retirement off | 78.7 → 62.0 ms | 63.1 → 87.6 needs/s (+39%; the writers saturate at 0.98) |
| Cell replacements | 3 per 25 s | 13 per 19 s window (~1 per 92 needs) |
| CPU per replacement | ~2 CPU-s | ~3.5 CPU-s |

- **Where a new cell's CPU goes** (per-cell `--cpu-prof`). On an idle machine a cell start takes 1.64 CPU-s and 1.05 s wall. Its main thread is busy for 1.05 s:
  - **0.54 s is the WASM guard rewriting the 8.9 MB pinned compiler module** (`isolate-wasm.mjs`: `rewrite`, `take`, `vector`);
  - 0.13 s is GC;
  - 0.06 s is JS parse;
  - about 0.2 s is the primers.

  V8's background WASM compile takes the rest. At width 64, in each cell's first 6 s, the rewrite takes 1.57 s of main-thread CPU plus about 0.4 s of GC. That makes it the largest category in a cell's whole profile, at 27% of main-thread time against 19% for the compiler itself (`receipt/profile/timeline.txt`, `w64-functions.txt`).
- **Contention inflation is 1.35×, not 1.5×.** With retirement off, cell CPU per need is 86 ms at width 64 against 64 ms at width 1. A third of what P-77 called contention was cells being replaced under load.
- **GC and the per-job work:** after warm-up, the jobs' main-thread time goes to the compiler (`asc` plus binaryen's WASM, about 45%), then GC (about 10–18%), then the G8 sentence regex (4–6%) and the gates (3%).
- **Efficiency cores:** QoS `background` on a width-1 cell gave 412 ms of cell CPU per need. macOS throttles background work far beyond the E-core speed ratio, so this is not a usable E-core measure. Nothing below depends on it.
- **Why not raise the interval:** REQ-ISO-016 bounds state carried across jobs, and the commit that added it records that a guarded cell dies near 16,000 instances. The interval stays at 256. The lever makes each replacement cheaper instead.

## Lever

`core/runtime/isolate-wasm.mjs`, +72 / −48: the guard's rewrite copies each byte once.
- The reader returns views rather than arrays, and sections stay `Uint8Array`s.
- Each function body is scanned against a 256-entry opcode table, with the same admitted opcodes and immediates and the same refusals, and is copied through as views around each rewritten `memory.grow`.
- The output is concatenated once.

Validation, the trusted and tooling digest checks, the caps, the helper bodies, the breach flags and every refusal are unchanged. The bytes handed to native compile are identical for all 21 modules a warm cell compiles: the compiler, the primers and the 17 P-15 kernels, with sequence digest `5fdee89d…` on both (`ident.mjs`). An idle cell's warm-up falls from 914 to 290 ms wall.

**Enforced check:** `core/runtime/test/isolate-wasm-rewrite.test.mjs` pins the rewritten compiler's SHA-256, and the digest of the whole sequence a warm cell compiles, to what the pre-P-78 rewrite produced. It is traced under REQ-ISO-008.

## Predictions against measurement (4 + 4, interleaved, one row per host process, every row started at load ≤ 4, no re-runs)

| Quantity | P-77 | P-78 | Predicted | |
|---|---|---|---|---|
| needs/s, width 64 | 64.44, 66.88, 58.83, 64.12 (mean **63.6**) | 78.33, 77.18, 76.15, 75.26 (mean **76.7**) | +8% to +20% (bar ≥ +5%, p < 0.05) | met (+20.7%, p ≈ 0.002) |
| Cell CPU per need, width 64 | 126.5, 119.0, 132.3, 123.9 (125.4 ms) | 109.3, 97.8, 102.8, 104.3 (103.5 ms) | −8% to −20% | met (−17%) |
| Wall per need, width 1 | 77.5, 78.6, 80.2, 80.5 (79.2 ms) | 67.1, 66.3, 64.2, 64.9 (65.6 ms) | −2% to −8% (bar: not worse than +3%) | bar met; prediction **exceeded** (−17%, t = −14) |
| `crossing` per need, width 1 | 19.9 ms | 9.6 ms | — | jobs wait less on a warming cell |
| Cell CPU per need, width 1 | 94.5 ms | 62.8 ms | — | −34% (sampling drops up to 1 s of each retired cell, so width 1 reads noisy) |
| Cell replacements per window, width 64 | 11–12 | 16–22 | — | more jobs per second, the same 256 per cell |
| Cell wait / net utilisation, width 64 | 235 ms / 0.72 | 186 ms / 0.64 | — | cells no longer bind |
| Ledger writers, width 64 | 0.68–0.78 | **0.87–0.90**, `ledger (saturated)` in every row | — | the writers bind next |
| Writer CPU per need, width 64 | 14.8 ms | 14.6 ms | — | unchanged |
| Host ELU, width 64 | 0.41 | 0.43 | — | not binding |
| Tree RSS at window end, width 64 / needs/s per GB | 5.14 GB / 12.7 | 5.42 GB / 14.7 | memory roofline not worse | met per GB; the sampled peak rose 5.4 → 6.4 GB with more replacements overlapping, and memory pressure was unchanged (level 58–61) |

## Correctness guard

- Every row on both arms has `wrongVerdicts` = 0 and `errors` = 0. Both arms show the same two outcome classes, `true/true/passed/-` and `false/false/failed/-`, in the same proportion (14.1–14.3% failed in every row of both arms). Reconciliation was ≤ 0.4% of wall in every row. Per process, P-78's width-64 rows ran 1,953–2,009 needs, under the 4–5k where the re-run disagreement appeared.
- **Content oracle:** the rewrite's output is byte-identical (above), so every WASM module a cell runs is unchanged.
- **Replay was not re-run.** No writer or `x1` file changed, `isolate-wasm.mjs` is not one of the frozen record's implementation files, and the rows and frozen identities are unchanged by construction. P-77's replay of 3,558 requests (rows `0d8b2f1d…`) still applies.
- `make -k test` ran on both arms the same day, expanded to one command per test file or Python module, each with `--test-timeout=120000` under a 600 s alarm. **`core/runtime/test/isolate-host-call.test.mjs` was excluded on both arms** (it hangs on macOS, `ps --ppid`). Receipt: `receipt/tests.json`.
  - P-78 shows **no failure that P-77 doesn't**: 34 failing commands on P-78 against 36 on P-77, with no new failing command and no new named failing test (43 named on P-78, 44 on P-77), all pre-existing (among them `loop-agent`, `loop-count`, `loop-review`, `isolate-pool`, `isolate-limits`, `ledger-writer`'s SIGKILL case, `tscheck`, and the gap targets, as in P-77).
  - The two commands that fail only on the P-77 arm (`tools/experiment_id.py check`, and `unittest discover`'s `test_allocations_are_complete`) are an artifact of the baseline worktree: it held this round's untracked harness folder, which `experiments/ALLOCATED` doesn't list on P-77. The code under test is unaffected.
  - The new `isolate-wasm-rewrite.test.mjs` passes. The guard's other tests (`isolate-tooling-wasm`, `isolate-trusted-cap`, `isolate-flags`, `isolate-shared-module`, `isolate-toolchain`) pass on both arms, and `isolate-limits` fails the same 4 tests on both.
- `make check` passes on the final commit.
- Not changed: `retireAfterJobs` (256) and REQ-ISO-016, process isolation, the permission flags, the gates, the freeze rule, the frozen record and its identity, every validation on append, the chain check on read, the journal's `F_FULLFSYNC`, SQLite's sync settings, P-75's re-run, P-76's writers and P-77's handles.

## Floors against observed (zero latency; P-73's floors, plus this round's measured cell floor)

Width 1, per need (P-78 wall 65.6 ms):

| Bucket | Share of wall | P-77 | P-78 | Physical floor | Distance |
|---|---|---|---|---|---|
| `compile` | 39% | 27.9 ms | 25.3 ms | not measured (compute: AssemblyScript `-O3` through binaryen) | **unknown** |
| `crossing` (cell time outside compile and gates, including waiting on a warming cell) | 15% | 19.9 ms | 9.6 ms | 7 crossings × 9.2 µs ≈ 0.06 ms; 4.1 ms with retirement off | **~160×** the IPC floor; 2.3× the no-replacement value |
| `ledger` + `freeze` | 30% | 20.1 ms | 19.9 ms | 12.5 ms (unbatched `F_FULLFSYNC`); 0.5 ms at its own SQLite settings | **1.6×** to unbatched full sync (40× to its settings: CPU, not disk) |
| `gate` + `promote` | 16% | 11.2 ms | 10.6 ms | not measured (compute; the re-run is principle 8's) | **unknown** |

Width 64, throughput resources:

| Resource | P-77 | P-78 | Floor | Distance |
|---|---|---|---|---|
| Cell CPU per need | 125 ms | 104 ms | 64 ms (width 1, retirement off: today's per-job work) | **1.6×**: about 18 ms is replacement, the rest contention |
| Ledger writers | 0.68–0.78 of 4 | **0.87–0.90 of 4 (binding)** | 3.3 ms CPU per request (P-77 replay) × 3.2 requests ≈ 10.5 ms per need | **1.4×** (14.6 ms) |
| Host event loop | 0.41 | 0.43 | 1.0 | not binding |
| Machine | 85–95% of 12 cores | same | 12 cores | binding through the writers and cells |

**Stop rule not met.** Three of the four width-1 buckets above 5% of wall are not shown to be within 1.5× of a floor:
- `crossing` is about 160× the IPC floor;
- `compile` has no measured floor;
- `gate` + `promote` has no measured floor.

`ledger` + `freeze` is at 1.6× unbatched durable sync, and the throughput resources are at 1.4× (writers) and 1.6× (cells).

## Next binding ceiling and levers (ranked by this evidence)

1. **The four ledger writers** (0.87–0.90, saturated in every P-78 row; with retirement off at P-77 they saturated at 88 needs/s). Writer CPU per need is 14.6 ms against the 10.5 ms replay floor.
   - P-77's lever 2 still stands: store the 412 KB bundle once, content-addressed, rather than in each need's SQLite file and the journal, and stop `commit` from JSON-parsing it twice. That changes row content, so it needs a recoverability proof like P-77's.
   - A fifth writer would be a knob, and needs the same per-GB check.
2. **The rest of each cell start:** about 1 CPU-s per replacement after this round (V8's compile of the compiler module, the primers and JS parse), at 16–22 replacements per 19 s.
   - The map's L2, compile once and instantiate per cell, is not available across processes in Node.
   - Measured candidates: pre-warm the replacement before the old cell retires (double buffering hides the 9.6 → 4.1 ms of width-1 `crossing`), and a V8 code cache for the compiler's JS produced by the supervisor and read-only to cells.
3. **GC in the cells** (10–18% of job main-thread time) and **the G8 sentence regex** (4–6%). The regex is gate code and needs the gate guard.
4. **`compile` floor:** measure AssemblyScript's own floor (a warm `asc.main` on the corpus kernels in one process, no gates) to make the stop rule decidable.

## Code delta

- **Product:** `core/runtime/isolate-wasm.mjs`, +72 / −48. Processes, threads and language crossings are unchanged.
- **Tests:** `core/runtime/test/isolate-wasm-rewrite.test.mjs` (+34, new), traced under REQ-ISO-008 in `docs/verification/verification-matrix.md`; `sources/SHA256SUMS` regenerated.
- **Harness** (`run.mjs`, from P-77):
  - counts cell spawns in the window;
  - adds an exploratory `diag` plan (retirement override, per-cell CPU profiles, QoS) and an `explore` stamp, which acceptance rows do not use.
- **Exploratory tools:**
  - `warm.mjs`: CPU and wall of a cell start;
  - `ident.mjs`: the digest of every module the guard hands to native compile;
  - `analyze.py` and `timeline.py`: CPU profiles by category and by cell age;
  - `exit-on-term.mjs`: lets a profiled cell write its profile when it retires.

## Receipts and how to reproduce

- `run.mjs <out> <stamp> row <w64|w1> <rep>`: one acceptance row per process. `run.mjs <out> explore diag <width> <tag> [retire=N] [profile=dir] [qos=…]`: an exploratory row.
- `summarize.py`: the acceptance table with Welch t, df and two-sided p (`summary.json`).
- `node ident.mjs <guard module path>` prints the sequence digest; `node warm.mjs 1 4` prints cell-start CPU and wall.
