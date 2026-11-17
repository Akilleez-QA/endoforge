# P-75 the commit-time re-run off the supervisor's event loop: result

Status: **kept** (every keep bar met), 2026-11-17, reference machine (Apple M6 Mac mini, 16 GiB, Node v26.13.1, Python 3.15.2). Stand-in model only (arm A, zero latency): **no model calls, no tokens**, credential variables asserted unset. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed and pushed (f62ea40) before any acceptance row. Implementation measured: b966c08. Receipts: `receipt/accept-main/` and `receipt/accept-p75/` (`climb-{0,1,2}.json`, `guard-{0,1,2}.json`, `bytes.json`). Table: `summarize.py`.

**Width-64 throughput rose 11.4%** (44.3 → 49.3 needs/s, Welch t = 5.0, df ≈ 2.7, p ≈ 0.02). **Host event-loop utilisation fell from 0.45 to 0.34**, and width 1 didn't change (80.0 → 79.4 ms). The lever moves `runGates` at commit onto two worker threads. **Once the host stops binding, the single ledger writer is the binding resource:** it ran at 0.95–0.98 utilisation with 6.2–6.5 ms of service per request.

**The larger finding is about the harness.** P-73's and P-74's harness built the corpus inside the measuring process, and P-50's `buildCorpus` installs the WASM memory guard once per kernel. That put 21 stacked guard wrappers on the host's `WebAssembly`, which no production supervisor has. With that guard (`guard` rows), main's host loop runs at 0.65 utilisation and 39.8 needs/s, and P-75 lifts it 21.5% (to 48.3). Most of P-74's "the host binds" came from this artifact. The default rows here build the corpus in a child process (same corpus digest `3d4322be…`, `hostWasmGuard: false` asserted by `summarize.py`).

## Predictions against measurement (3 + 3 repeats, interleaved, fresh host process per plan)

| Quantity | main | P-75 | Predicted | |
|---|---|---|---|---|
| needs/s, width 64, child-built corpus | 43.95, 43.79, 45.05 (mean **44.3**) | 50.89, 47.69, 49.32 (mean **49.3**) | +0% to +5% (keep bar ≥ +3%, p < 0.05) | bar met; **above the predicted band** (+11.4%) |
| Host ELU, width 64 | 0.452, 0.458, 0.441 (**0.450**) | 0.345, 0.338, 0.337 (**0.340**) | ≤ main − 0.07 | met (−0.11) |
| Wall per need, width 1 (ms) | 80.6, 81.2, 78.3 (80.0) | 81.0, 78.0, 79.3 (79.4) | within ±3% | met (−0.7%) |
| Ledger bytes per need (`bytes`, width 1) | 1,007,503 | 1,008,746 | unchanged within 1% | met (+0.1%): `admit` 429 KB up and 430 KB back, `park` 66 KB, `commit` 51 KB up and 23 KB back |
| Host ELU, width 64, in-process guard | 0.654, 0.657, 0.654 | 0.365, 0.351, 0.345 | ≤ 0.42 | met |
| needs/s, width 64, in-process guard | 39.6, 39.7, 40.0 (39.8) | 48.5, 47.5, 48.9 (48.3) | +8% or more | met (+21.5%) |
| Tree RSS, width 64 (MB, mean) | 4,431 | 4,814 | within +10% | met (+8.6%; peak 5,277 → 5,161) |
| Binding stage after the lever | — | ledger writer at 0.95–0.98, one server | not the host loop | met |

The throughput prediction was too low because the pilots were single rows. Two pilot rows on main read 49.5 and 50.8 needs/s, while the acceptance rows read 43.8–45.1. Both arms ran under the same load gate (1-minute load ≤ 4 at each row's start: 2.3–3.8). The rows themselves push the load to 6–13.

Per-stage service against wait at width 64 (stage-rates, means of the three rows):

| Stage | main: utilisation, wait, service | P-75: utilisation, wait, service |
|---|---|---|
| Cells (12) | gross 1.00, net 0.55; wait 297 ms; job 86 ms | gross 1.00, net 0.50; wait 256 ms; job 77 ms |
| Cell compile | 0.17; 14.8 ms | 0.19; 14.9 ms |
| Ledger writer (1) | **0.94**; wait 107 ms; service 6.7 ms | **0.97**; wait 109 ms; service 6.3 ms |
| Host event loop | 0.45 | 0.34 |

At about 3.1 requests per need and 6.3 ms each, one writer saturates at about 50 needs/s, which is where P-75 now runs.

## Correctness guard

- Every row has `wrongVerdicts` = 0 and `errors` = 0. Both arms show the same two outcome classes, `true/true/passed/-` and `false/false/failed/-`. No row shows the re-run disagreement problem.
- Reconciliation was ≤ 0.35% of wall in every row.
- `make -k test` ran on both arms the same day, one test file at a time, each with `--test-timeout=120000` and a hard 600 s cap per file. **`core/runtime/test/isolate-host-call.test.mjs` was excluded on both arms**, because it hangs on macOS on main (`ps --ppid`, see P-74).
  - Both arms show the same 17 failing Node tests across 11 files, all pre-existing.
  - On the measured commit, P-75 added one failure, in `make check` and `test_check_trace`: the new test file had no row in the verification matrix. It is now traced to REQ-X1-006, and `make check` and `tests/` pass.
- Not changed: the gates (the same `gates.mjs` runs on the thread), the comparison and refusal in `checkAtCommit`, the frozen bundle bytes, the freeze rule and every ledger durability setting.

## Floors against observed (zero latency; P-73 floors; this round's observed, child-built corpus)

| Bucket | P-74 observed | P-75 observed | Floor (P-73, this machine) | Headroom now |
|---|---|---|---|---|
| Host event loop, width 64 | 0.84–0.86 (P-74 arm; main 0.66), with the 21-layer guard | **0.34** (main 0.45; guard rows 0.35 against 0.65) | 1.0 | not binding |
| Ledger writer, width 64 | 4 shards, then reverted | **0.97 utilisation**, 6.3 ms per request | 3.3 ms CPU per request after P-74's validation cut; 0.5 ms with its own sync settings | **binding next** |
| `ledger` + `freeze`, width 64 | 216 ms (sharded) | 361 ms (main 357) | same | queueing behind one writer |
| `ledger` + `freeze`, width 1 | 22.1 ms | 22.4 ms | 0.5 ms (own sync settings), 12.5 ms (unbatched full sync) | 1.8× to unbatched |
| `crossing`, width 64 | 1,214 ms | 866 ms (main 1,025) | — | cell wait behind the writer |
| `crossing`, width 1 | 21 ms | 19.3 ms | ~0.06 ms (7 crossings at 9.2 µs) | ~320× |
| `compile`, width 1 | 25–31 ms | 26.5 ms | not measured | U |
| `gate` + `promote`, width 1 | 20–21 ms | 10.9 ms | not measured | U |
| Wall per need, width 1 | 96.0 ms (load 7–15) | 79.4 ms (load ≤ 4) | sum of the floors above | — |
| Ledger bytes per need | ~1.1 MB | 1.01 MB (unchanged) | ~0.1 MB without the bundle round trip | 10× (payload, not time, at present) |

## Next binding ceiling and levers (ranked by this evidence)

1. **The single ledger writer** (0.97 utilisation). P-74's two writer changes are ready (2d3bb6b): one validation per row (−15% CPU per request, identical bytes) and `LedgerShards` with 4 writers. P-74 showed they cut ledger + freeze by 58%. They paid nothing there only because the host was carrying the stacked guard and the inline re-run. Re-apply them on top of P-75 and re-measure. Expect the next ceiling to be the cells (net 0.50 of 12), or the host again, at around 70–100 needs/s.
2. **Handles, not payloads.** Each need moves about 860 KB of bundle through the host and the writer (`admit` up and its `encoded` echo back), and `verifyFromMemory` re-hashes and re-parses it at every commit. It isn't binding now, but it is the largest host and writer CPU after the re-run. Pass a digest instead, and let the writer read the repository files it already reads for `frozen_drift`.
3. **The G8 sentence regex** (`nonFiniteExpectation`) is about half of `runGates`, in the cells and on the re-run threads. A same-semantics rewrite (two word tests on a line-free sentence) is a pure CPU cut. It belongs to the gates, so it needs the gate guard.

## Code delta

- **Product:** 1 new file and 3 edited, +79 / −9 lines.
  - `core/runtime/x1/rerun.mjs` (+51): `RERUN_THREADS = 2`, a constant, not a knob. The threads are lazy and unref'd, and a ref'd timer holds the process open only while a re-run is pending. A thread that dies answers `null`, which refuses.
  - `loop.mjs` (+5 / −6).
  - `core/runtime/test/x1-rerun.test.mjs` (+19).
  - `core/runtime/README.md`, `sources/SHA256SUMS`, and one matrix row in `docs/verification/verification-matrix.md`.
- **Processes:** unchanged. **Threads:** +2 in the supervisor. **Language crossings:** unchanged.
- No ban was added, so no check was needed.

## Other findings

- **The re-run disagreement after 4–5k needs (P-73) is probably the stacked guard.** The guard's `activeFlags` set never shrinks, and with 21 layers every instantiation scans it 21 times. Rows here stayed under 1,300 needs per process, so this was not reproduced either way. A guard installed once per process, as in a cell, still accumulates `activeFlags`, which is worth its own look.
- **The production supervisor runs the re-run without any WASM memory guard.** A kernel that declares a large memory is bounded only by the meter's fuel. The re-run thread now makes a per-thread `resourceLimits` bound possible, but this round doesn't add one, because it would be a gate change.
- **Worker gotcha:** `worker.unref()` must come after `worker.on('message', …)`, or adding the listener re-refs the port and the process never exits. The first version hung `gaps-x1runtime.test.mjs` for this reason.
- **Harness overhead on the host:** `ps` sampling every 2 s and the per-need `rmSync` are about 13% of non-idle host CPU in the profile. They are the same in both arms.

## Receipts and how to reproduce

- `run.mjs <out> <stamp> climb <rep>`: the acceptance rows `w64` and `w1`, with the corpus built in a child process.
- `P75_CORPUS=inprocess run.mjs <out> <stamp> guard <rep>`: the same width-64 row with the P-73/P-74 in-process build.
- `run.mjs <out> <stamp> bytes 0`: JSON bytes of each ledger request and answer, by action.
- `summarize.py`: the tables above.
