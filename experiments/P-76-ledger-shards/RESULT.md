# P-76 the ledger writer, again: validate each row once and shard by ledger, on top of P-75: result

Status: **kept** (every keep bar met), 2026-11-17, reference machine (Apple M6 Mac mini, 12 cores, 16 GiB, Node v26.13.1, Python 3.15.2). Stand-in model only (arm A, zero latency): **no model calls, no tokens**, credential variables asserted unset. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed and pushed (24eab53) before any acceptance row. Implementation measured: 6597bc8 (P-74's 2d3bb6b re-applied unchanged, plus `sources/SHA256SUMS`). Baseline arm: P-75 (caf2dcf). Receipts: `receipt/accept-p75/` and `receipt/accept-p76/` (`climb-{0,1,2}.json`, `bytes.json`), `receipt/replay.json`. Table: `summarize.py`.

**Width-64 throughput rose 21.4%** (46.6 → 56.5 needs/s, Welch t = 6.8, df ≈ 4, p < 0.01). The ledger stopped binding: its host-side wait went from 110–116 ms to zero, and ledger + freeze per need fell 61% (375 → 146 ms). The cells' net utilisation rose from 0.51 to 0.71. Width 1 got slightly faster (80.0 → 77.6 ms). The host loop rose from 0.34 to 0.50 utilisation, carrying 21% more needs. The stage-rates verdict moved from `ledger (saturated)` to `cell (unsaturated)`.

P-74 measured the same commit as a failure. The difference is P-75: once the host loop stopped binding (and the harness stopped stacking 21 WASM guards on it), the writer was the real ceiling, and removing it pays. Rounds that stack can turn a failed lever into a kept one.

## Predictions against measurement (3 + 3 repeats, interleaved, fresh host process per plan, load ≤ 4 at each row's start: 2.9–3.9)

| Quantity | P-75 | P-76 | Predicted | |
|---|---|---|---|---|
| needs/s, width 64 | 46.38, 45.19, 48.16 (mean **46.6**) | 55.74, 55.00, 58.84 (mean **56.5**) | +8% to +20% (keep bar ≥ +3%, p < 0.05) | bar met; **just above the band** (+21.4%) |
| Ledger stage, width 64: utilisation per writer | 0.99, 0.94, 0.95 (one server) | 0.71, 0.72, 0.75 (four servers) | ≤ 0.80, wait ≤ 10 ms | met; wait 0 |
| Ledger service per request, width 64 | 6.8, 6.6, 6.3 ms | 16.3, 16.7, 16.4 ms per shard | 12–20 ms (CPU contention), no queue | met |
| Requests per need, width 64 | 3.14–3.16 | 3.12–3.14 | (unchanged; no coalescing) | unchanged |
| ledger + freeze per need, width 64 | 379, 381, 365 ms (375) | 145, 148, 144 ms (146) | −50% or more | met (−61%) |
| Wall per need, width 1 | 79.6, 82.7, 77.8 (80.0 ms) | 76.0, 78.5, 78.3 (77.6 ms) | within ±3% | −3.1%, faster (bar: no regression over 3%; met) |
| Host ELU, width 64 | 0.356, 0.342, 0.331 (0.343) | 0.487, 0.505, 0.504 (0.499) | 0.42–0.56 | met |
| Writer CPU per request, replay of 3,331 requests | 4.04, 4.03, 3.72 (3.93 ms) | 3.84, 3.37, 3.52 (3.58 ms) | −10% to −20%, digests identical | **−9%, just short of the band**; digests identical |
| Ledger bytes per need (`bytes`, width 1) | 1,009,428 | 1,009,723 | unchanged within 1% | met (+0.03%) |
| Tree RSS, width 64 (MB, mean) | 4,335 (peak 4,772–5,316) | 4,595 (peak 5,100–5,221) | within +15% | met (+6%); writers' RSS 405–553 → 873–1,022 MB |
| Binding stage after the lever | ledger writer | cells (12, gross 1.00, net 0.70–0.71) and the 12 cores | not the ledger | met |

The writer's own service time per request more than doubled with four of them (6.5 → 16.5 ms), because four Python processes now compete for 12 cores with 12 cells, the host and P-75's two re-run threads. Capacity still rose from about 1 / 6.5 ms ≈ 154 requests/s to 4 / 16.5 ms ≈ 242 requests/s, and the measured demand is 172–184 requests/s, so nothing queues for a writer.

Per-stage service against wait at width 64 (stage-rates, means of the three rows):

| Stage | P-75: utilisation, wait, service | P-76: utilisation, wait, service |
|---|---|---|
| Cells (12) | gross 1.00, net 0.51; wait 273 ms | gross 1.00, net 0.71; wait 264 ms |
| Ledger writer | **0.96** of 1; wait 113 ms; 6.6 ms per request | **0.73** of 4; wait 0; 16.5 ms per request |
| Host event loop | 0.34 | 0.50 |

## Correctness guard

- Every row has `wrongVerdicts` = 0 and `errors` = 0. Both arms show the same two outcome classes, `true/true/passed/-` and `false/false/failed/-`, in the same proportions (about 14.5% failed). No row shows the re-run disagreement problem.
- **Deviation from the precommit: the 1,300-needs-per-process cap was not held.** `climb` runs `w64` and then `w1` in one process for 25 s each, so a faster arm finishes more needs. Per process: P-75 1,535–1,621 needs, P-76 1,856–1,930 (the `w64` row alone: 1,220–1,294 and 1,529–1,603). Both arms stay well under the 4–5k needs where the re-run disagreement appeared, and no row shows it, so this doesn't change the verdict. A later round at higher rates should split `w64` and `w1` into separate processes, or cap needs instead of seconds.
- **Replay, byte-identical:** 3,331 writer requests captured from a P-75 width-64 row, replayed through each arm's writer three times. Every run on both arms gives answers `faf8367c…` and rows `3297ba34…` (`records`, `x1_continuations`, `x1_decisions`, `ledger_journal` across 1,060 ledgers), with zero errors.
- Reconciliation was ≤ 0.3% of wall in every row.
- `make -k test` ran on both arms the same day, one test file at a time, each with `--test-timeout=120000` and a hard 600 s cap per file. **`core/runtime/test/isolate-host-call.test.mjs` was excluded on both arms** (it hangs on macOS, `ps --ppid`).
  - P-76 shows **no failure that P-75 doesn't**: the same 16 failing Node tests across 10 files, all pre-existing, and the same failing Python and tool targets (`atomizer`, `factory-state`, `gap-tools`, `hardware`, `kernel`, `lib`, `portability`, `runtime`, `tscheck`).
  - P-75 showed one more, `bridge and supervisor kills at random times never yield a promotion without its evidence` (`loop-crash.test.mjs`, a randomized kill test), which passed on P-76.
  - P-75's `check` and `core-test` failed only because the harness copy in its worktree was an untracked `experiments/P-76-ledger-shards` folder that P-75's `experiments/ALLOCATED` doesn't list. On P-76 both pass, and `make check` passes on the final commit.
  - The new tests pass: the shard ordering test in `ledger-writer.test.mjs` and the one-validation test in `test_ledger_writer.py`. (`ledger-writer.test.mjs` still fails its pre-existing SIGKILL `half_frame` case on both arms.)
- Not changed: the gates, the freeze rule, every validation on append, the chain and hash check on every read, the journal's `F_FULLFSYNC` per group commit, SQLite's sync settings, the decision file syncs, and P-75's commit-time re-run.

## Requests per need: why they were not cut

The 3.1 requests per need are one `admit`, about 1.1 `park` and one `commit`. `park` is the durable checkpoint of a waiting cell, written before the next model turn so a crash can resume it. Folding it into `commit` would remove that checkpoint, which is a durability change, and `admit` has to be durable before the cell runs. With four writers the request count no longer binds. What each request carries is the larger cost (below).

## Floors against observed (zero latency; P-73 floors)

| Bucket | P-75 observed | P-76 observed | Floor (P-73, this machine) | Headroom now |
|---|---|---|---|---|
| Ledger writer, width 64 | 0.96 of 1, 6.6 ms per request, wait 113 ms | **0.73 of 4**, 16.5 ms per request (contended), wait 0 | 3.6 ms CPU per request (replay); 0.5 ms with its own sync settings | not binding |
| `ledger` + `freeze`, width 64 | 375 ms | **146 ms** | same | 1 writer round trip each |
| `ledger` + `freeze`, width 1 | 22.6 ms | 20.6 ms | 0.5 ms (own sync settings), 12.5 ms (unbatched full sync) | 1.6× to unbatched |
| Cells, width 64 | gross 1.00, net 0.51 | **gross 1.00, net 0.71**, wait 264 ms | net 1.0 | **binding next** |
| `crossing`, width 64 | 927 ms | 909 ms | — | queueing for a cell |
| `crossing`, width 1 | 18.2 ms | 18.0 ms | ~0.06 ms (7 crossings at 9.2 µs) | ~300× |
| `compile`, width 1 | 27.7 ms | 27.2 ms | not measured | U |
| `gate`, width 1 | 7.9 ms | 8.1 ms | not measured | U |
| Host event loop, width 64 | 0.34 | 0.50 | 1.0 | not binding (2×) |
| Wall per need, width 1 | 80.0 ms | 77.6 ms | sum of the floors above | — |
| Ledger bytes per need | 1.01 MB | 1.01 MB (unchanged) | ~0.1 MB without the bundle round trip | 10× |

## Next binding ceiling and levers (ranked by this evidence)

1. **The cells (12 of them, gross 1.00, net 0.71) on a 12-core machine.** A need waits 264 ms for a cell. 29% of cell occupancy is not cell work: the cell holds its slot while the host serves its `admit` and the model turns. The machine has 12 cores for 12 cells, 4 writers, the host and 2 re-run threads, so more cells would only contend. The lever is to cut work per need, not to add servers.
2. **Handles, not payloads.** Each need still moves about 860 KB of bundle (`admit` 429 KB up and 430 KB back as `encoded`), and the writer JSON-parses, hashes and validates it. It costs CPU in the host, the writer and the cell, which is now the shared resource. Pass a digest and let the writer read the repository files it already reads for `frozen_drift`, so the rows stay byte-identical. This should also shorten the cell's hold on `admit`, which is the 0.29 gap.
3. **The G8 sentence regex** (`nonFiniteExpectation`), about half of `runGates`, in the cells and on the re-run threads. It is a pure CPU cut, but it belongs to the gates, so it needs the gate guard.

## Code delta

- **Product:** 4 files, +46 / −6 lines.
  - `core/runtime/isolate-ledger.mjs` (+37): `LEDGER_SHARDS = 4` (a constant, not a knob) and `LedgerShards`.
  - `core/runtime/isolate-pool.mjs` (+2 / −2) and `core/runtime/stage-rates.mjs` (+2 / −1).
  - `tools/ledger_writer.py` (+6 / −2): the cache gains the rows a batch appended; `HANDLES` goes from 1024 to 256 per writer.
- **Tests:** `ledger-writer.test.mjs` (+18) adds the shard ordering test, and `test_ledger_writer.py` (+15) pins one validation per row.
- `sources/SHA256SUMS` regenerated for the two pinned files.
- **Processes:** +3 Python writer processes (4 in total). **Threads:** unchanged. **Language crossings per request:** unchanged.
- No ban was added, so no check was needed.

## Receipts and how to reproduce

- `run.mjs <out> <stamp> climb <rep>`: the acceptance rows `w64` and `w1` (P-75's harness unchanged, corpus built in a child process).
- `run.mjs <out> <stamp> bytes 0` and `run.mjs <out> capture capture`.
- `rows.py <repo> <capture> <scratch> <n>`: replays the capture through that repository's writer and prints the CPU per request and the digests (`replay.json`).
- `summarize.py`: the acceptance table.
