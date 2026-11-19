# P-77 handles, not payloads: the frozen bundle's implementation files cross as digests, on top of P-76: result

Status: **kept** (every keep bar met), 2026-11-17, reference machine (Apple M6 Mac mini, 12 cores, 16 GiB, Node v26.13.1, Python 3.15.2). Stand-in model only (arm A, zero latency): **no model calls, no tokens**, credential variables asserted unset. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed and pushed (bf10e11) before any acceptance row. Implementation measured: f513065. Baseline arm: P-76 (556c78c). Receipts: `receipt/accept-p76/` and `receipt/accept-p77/` (`row-{w64,w1}-{0..3}.json`, `bytes.json`), `receipt/replay.json`, `receipt/summary.json` (from `summarize.py`).

**Width-64 throughput rose 7.2%** (59.9 → 64.2 needs/s, Welch t = 3.7, df ≈ 3.1, p ≈ 0.03), at the top of the predicted +2% to +8%. Bytes through the writer fell 82% per need (988 → 181 KB) and host → cell job messages fell 82% (560 → 98 KB). The cell's hold on `admit` (the `freeze` bucket) fell 10% (59.8 → 53.7 ms), the host loop fell from 0.51 to 0.39 utilisation while carrying 7% more needs, and the four P-77 rows were tight (63.96–64.49). Width 1 is unchanged (79.0 → 78.6 ms). Ledger rows are byte-identical, and every answer assembles back into P-76's answer byte for byte.

## Predictions against measurement (4 + 4 repeats, interleaved, one row per host process, load ≤ 4 at each row's start except one re-run)

| Quantity | P-76 | P-77 | Predicted | |
|---|---|---|---|---|
| needs/s, width 64 | 61.23\*, 61.81, 59.90, 56.64 (mean **59.9**) | 64.49, 63.96, 64.06, 64.19 (mean **64.2**) | +2% to +8% (bar ≥ +3%, p < 0.05) | met (+7.2%, p ≈ 0.03) |
| Writer requests + answers per need | 988 KB | **181 KB** | ≤ 200 KB (bar −70%) | met (−82%) |
| `admit` per request, sent / answered | 419 / 420 KB | **17.3 / 17.6 KB** | — | −96% each way |
| Host → cell job messages per need | 560 KB (admission 481 KB) | **98 KB** (admission 20 KB) | ≤ 110 KB | met |
| `freeze` per need, width 64 | 60.7, 61.3, 59.0, 58.0 (59.8 ms) | 52.4, 52.1, 56.8, 53.3 (53.7 ms) | −5% to −20% | met (−10%) |
| Cell CPU per need, width 64 | 126.8, 130.1, 131.5, 136.2 (131 ms) | 126.5, 124.2, 122.8, 123.6 (124 ms) | −3% to −12% | met (−5%) |
| Host CPU per need, width 64 | 9.4 ms | **7.7 ms** | lower | −18%; ELU 0.51 → 0.39 |
| Writer CPU per need, width 64 | 15.9 ms | 15.0 ms | — | −6% |
| Wall per need, width 1 | 77.9, 79.9, 80.5, 77.5 (79.0 ms) | 77.7, 80.2, 80.4, 76.1 (78.6 ms) | within ±3% | met (−0.4%) |
| Writer CPU per request, replay of 3,558 requests | 3.65, 3.69, 3.23 (3.52 ms) | 3.12, 3.53, 3.19 (3.28 ms) | −0% to −10%; rows identical | met (−7%) |
| Ledger bytes on disk | — | unchanged | unchanged | rows byte-identical |
| Binding stage after the lever | cells and cores | cells (net 0.69–0.72) with the writers at 0.76–0.80 | cells and cores | met; the writers are close behind |

\* `w64-r0` on P-76 ended at load 16.6, so the harness re-ran it at once, as its rule says; the re-run started at load 13.2 (the rule waits only for load ≤ 16 on a re-run). It is the only row that started above 4. Dropping it, P-76's mean is 59.5 and the gain is +7.9%.

Cell stage at width 64 (stage-rates, means of four rows): wait for a cell 249 → 230 ms; net utilisation 0.70 → 0.71; arrivals 3.14 jobs per need on both. CPU by role (a new harness measure that survives cell retirement): cells 7.85 → 7.98 cores, host 0.56 → 0.50, writers 0.95 → 0.96, at 7% more needs.

## Correctness guard

- Every row on both arms has `wrongVerdicts` = 0 and `errors` = 0. Both arms show the same two outcome classes, `true/true/passed/-` and `false/false/failed/-`, in the same proportion (14.3% failed). Reconciliation was ≤ 0.33% of wall in every row. Per process: P-76 1,562–1,662 needs, P-77 1,736–1,741 (width-64 rows), all well under the 4–5k where the re-run disagreement appeared.
- **Replay** (`rows.py`): 3,558 writer requests captured from a P-76 width-64 row. The P-77 arm replays them converted to digests, through P-77's writer code with P-76's `x1` files (the frozen bundle holds those files, so identical rows need identical files). Every run on both arms gives rows `0d8b2f1d…` across 1,132 ledgers (`records`, `x1_continuations`, `x1_decisions`, `ledger_journal`), zero errors. The raw answers differ by design (`2ce6e740…` against `4cd1b61e…`: a frame instead of the echo). After each P-77 frame is assembled back, by putting each elided repository file into the frame, re-encoding and checking `evr:sha256` against the identity and `sha256(content)` against the digest, every run gives `163a894a…`, the same digest as P-76's answers parsed the same way. The bundle is recoverable byte-identical from its handles, and verdicts are identical.
- `make -k test` ran on both arms the same day, expanded to one command per test file or Python module (157 on P-76, 158 on P-77), each with `--test-timeout=120000` under a 600 s alarm. **`core/runtime/test/isolate-host-call.test.mjs` was excluded on both arms** (it hangs on macOS, `ps --ppid`). Receipt: `receipt/tests.json`.
  - P-77 shows **no failure that P-76 doesn't**: the same 34 failing commands with the same 56 named failing tests, all pre-existing (among them `loop-agent`, `loop-count`, `loop-review`, `isolate-pool`, `isolate-limits`, `ledger-writer`'s SIGKILL `half_frame` case, `tscheck`, the atomizer, conductor, kernel and `factory_runtime` gap targets, as in P-76).
  - The first P-77 run had one more: `check_trace` (and `tests/test_check_trace.py`) flagged the new `tools/test_x1_handles.py` as tracing to no requirement. It is now listed under REQ-X1-007 in `docs/verification/verification-matrix.md`, and both pass.
- `make check` passes on the final commit. The new checks pass: `tools/test_x1_handles.py` (4) and the frame test in `loop.test.mjs`.
- Not changed: the gates, the freeze rule, the frozen record and its identity, every validation on append, the chain and hash check on every read, the journal's `F_FULLFSYNC` per group commit, SQLite's sync settings, the decision file syncs, P-75's re-run and P-76's four writers.
- **One behaviour changes on purpose:** a cell whose runtime files differ from the repository used to be frozen with its own files and then rejected at commit as `frozen_drift`. Now the writer refuses its `admit` ("an implementation digest differs from the repository file"), earlier and with no frozen record. No corpus need reaches this path.

## The ban, as an enforced check

"No implementation payload in `admit`": the writer refuses an `admit` whose `files` holds any of `IMPLEMENTATION_FILES` ("implementation files travel as digests, not payloads"), and refuses a digest for any other name, which also keeps the repository read inside `core/runtime/x1`. `tools/test_x1_handles.py` pins the refusals, the digest check, rows identical to a payload freeze, and an answer under 32 KB with no `encoded`. `loop.test.mjs` pins the frame in the cell: under 32 KB, every file elided, verification against the cell's own copies, and three forgeries refused.

## Floors against observed (zero latency; P-73 floors)

| Bucket | P-76 observed | P-77 observed | Floor | Headroom now |
|---|---|---|---|---|
| Bundle bytes per need, all boundaries | ~2.5 MB (writer 988 KB, jobs 560 KB, host call ~840 KB) | **~0.4 MB** (writer 181 KB, jobs 98 KB, host call ~35 KB) | ~0.1 MB (oracle files, continuation, candidate) | 4× |
| `freeze` (cell held on `admit`), width 64 | 59.8 ms | 53.7 ms | 10 ms (width 1) | 5×: queueing for a writer and the cores |
| `freeze`, width 1 | 10.1 ms | 9.6 ms | one durable writer round trip (~0.5–12.5 ms) | 1× to unbatched |
| Cells, width 64 | gross 1.00, net 0.70, 131 ms CPU per need | gross 1.00, net 0.71, **124 ms** CPU per need | ~85 ms CPU per need (width 1) | 1.5×: core contention |
| Writers, width 64 | 0.72–0.81 of 4 | 0.76–0.80 of 4 | 3.3 ms CPU per request (replay) | close to binding |
| Host event loop, width 64 | 0.51 | 0.39 | 1.0 | not binding |
| Wall per need, width 1 | 79.0 ms | 78.6 ms | sum of the floors | — |
| Machine | 85–95% of 12 cores busy | same | 12 cores | binding |

## Next binding ceiling and levers (ranked by this evidence)

1. **The machine's 12 cores, through the cells.** About 9.5 cores of measured work per second (cells 8.0, writers 1.0, host 0.5) plus kernel time; the cells need 124 ms of CPU per need at width 64 against about 85 ms at width 1, so a third of the cell CPU is contention. Every remaining lever is CPU per need. The largest single item is likely **cell retirement**: `retireAfterJobs = 256` retires each cell about every 18 s at width 64, and a new cell loads the compiler and runs 8 warm-up gate rounds. That is a hygiene invariant, so measure its cost before proposing a change.
2. **The ledger writers (0.76–0.80 of 4).** At 64 needs/s they are within 25% of saturating; two P-77 rows already read `ledger (saturated)` at the busiest moment. `admit` still writes the 412 KB bundle into each need's SQLite file and the journal, and `commit` JSON-parses it twice (`frozen_drift`, `report_problem`). Storing the bundle once in a content-addressed table, with the record holding the digest, would change row content and the record identity scheme, so it needs a recoverability proof like this round's.
3. **The remaining payloads:** `park` 64 KB (the waiting cell's messages, which repeat the prompts) and `commit` 50 KB (the candidate with its WASM), each crossing host → writer once and cell → host once.
4. **The G8 sentence regex** (from P-76), about half of `runGates`, in the cells and the re-run threads. It is gate code, so it needs the gate guard.

## Code delta

- **Product:** 3 files, +63 / −16 lines.
  - `tools/x1_loop.py` (+30 / −7): `repository_files`, `admitted_files` (the ban and the digest check), `admission` (the frame); `admit`, `revise` and `frozen_drift` use them.
  - `core/runtime/x1/loop-port.mjs` (+32 / −8): `implementationDigests`, the frame assembly, `encodedOf`, and `verifyFromMemory` hashing the pieces and parsing only the frame.
  - `core/runtime/x1/loop.mjs` (+1 / −1): forwards `implementation`.
- **Tests:** `tools/test_x1_handles.py` (+85, new), `loop.test.mjs` (+21 / −4), the stage-port fixture (+1 / −1). `core/runtime/README.md` documents the contract; `sources/SHA256SUMS` regenerated.
- **Processes, threads, language crossings:** unchanged.
- **Harness:** `run.mjs` adds the `row` plan (one row per process), CPU by role that survives cell retirement (P-73–P-76's `cpuMsPerCandidate` lost retired cells and read negative at width 1), and job bytes. `rows.py` adds the digest conversion and the answer assembly.

## Receipts and how to reproduce

- `run.mjs <out> <stamp> row <w64|w1> <rep>`: one acceptance row per process.
- `run.mjs <out> <stamp> bytes` and `run.mjs <out> <stamp> capture`.
- `rows.py <repo> <capture> <scratch> <n> [--handles]`: replays a capture through that repository's writer and prints CPU per request, bytes, and the row, raw-answer and assembled-answer digests (`replay.json`).
- `summarize.py`: the acceptance table (`summary.json`).
