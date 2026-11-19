# P-74 ledger writer: stop re-validating its own rows and shard it by ledger: result

Status: **failed** (prediction not met; lever not kept), 2026-11-17, reference machine (Apple M6 Mac mini, 16 GiB, Node v26.13.1, Python 3.15.2). Stand-in model only (arm A, zero latency): **no model calls, no tokens**, credential variables asserted unset. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed and pushed (5f702c8) before any acceptance row. Implementation measured: 2d3bb6b; it is reverted on this branch, so the branch carries only the record. Receipts: `receipt/accept-main/`, `receipt/accept-p74/` (`climb-{0,1,2}.json`, `replay.json`).

**The writer change worked on the writer and did nothing end to end.** Ledger + freeze per need at width 64 fell 58% (513 → 216 ms). The writer's CPU per request fell 15% (3.88 → 3.30 ms), with byte-identical rows and answers. The cells' net utilisation rose from 0.50 to 0.72. But throughput at width 64 stayed at 37.9 → 37.6 needs/s (−0.8%, Welch t = −0.25). The time the needs stopped spending in the ledger moved into the cell wait (`crossing`, 1,027 → 1,214 ms), and the host event loop went from 0.66 to 0.84–0.86 utilisation. **P-73's "ledger (saturated)" verdict was rule V counting waiting as service. The ledger was a symptom of the host process being the serial resource.** The next binding ceiling is the **host (supervisor) event loop**.

## Predictions against measurement (3 + 3 repeats, interleaved, fresh host process per repeat)

| Quantity | main | P-74 | Predicted | |
|---|---|---|---|---|
| needs/s, width 64, zero latency | 36.5, 39.3, 37.9 (mean **37.9**) | 39.4, 36.8, 36.7 (mean **37.6**) | +5% to +15% | **miss** (−0.8%, p ≈ 0.8) |
| `ledger` + `freeze` per need, width 64 (ms) | 549, 492, 499 (513) | 198, 226, 224 (**216**) | ≤ 230 (−50% or more) | met (−58%) |
| Ledger round trip per request, width 64 (ms; (ledger + freeze) ÷ 3.1) | ~165 | ~70 | ≤ 45 | **miss** |
| Writer CPU per request, replay of 2,467 captured requests (ms) | 4.20, 3.59, 3.85 (3.88) | 3.54, 3.22, 3.13 (**3.30**) | −12% to −20% | met (−15%) |
| Replay answer and row digests | `1fc378b6…`, `5d3c790a…` | identical | identical | met |
| Wall per need, width 1 (ms) | 99.4, 94.3, 94.3 (96.0) | 92.7, 93.6, 104.1 (96.8) | within ±3% | met (+0.8%, noise) |
| Cells' net utilisation, width 64 | 0.51, 0.50, 0.50 | 0.73, 0.72, 0.72 | ≥ 0.65 | met |
| Tree RSS, width 64 (MB) | 3,922–4,589 (4,313) | 3,051–4,745 (3,982) | within +15% | met |
| Stage-rates verdict, width 64 | ledger (net 1.00) | ledger (net 0.86–0.91 of 4 servers) | not decided | as stated |

Correctness guard:
- every kept row has `wrongVerdicts` = 0 and `errors` = 0, and the same two outcome classes in both arms (`true/true/passed`, `false/false/failed`);
- the replay digests are identical;
- reconciliation was ≤ 0.36% of wall in every row;
- `make -k test`, run on both arms the same day, one test file at a time, each with `--test-timeout=120000` and a hard 600 s cap per file. Main showed 17 failing Node tests across 12 files plus Python and tool targets. P-74 showed the same 17 tests, with three additions:
  - `check`, `core-test` (`test_sums_are_current`) and `promotion.test.mjs` (P-22's source digest check) all fail on `sources/SHA256SUMS`, which pins `isolate-ledger.mjs` and `isolate-pool.mjs`. Regenerating it with `tools/source_sums.py` clears all three (verified). A kept change would carry that regeneration;
  - `loop-crash.test.mjs` (random bridge and supervisor kills) failed on main only, so it is flaky, not fixed.

  No failure is caused by the lever.

Load during the acceptance rows was 7–15 (Chrome and other lanes), with no row above 16, in both arms alike.

## Why it failed (the mechanism)

- **The writer was never the serial resource at width 64.** On main, a traced pilot put 60–100 ms of a 140 ms round trip between Node's pipe write and the writer reading the line. The writer process was at about 60% CPU. Sharding removed that queue: four writers, each about 20% busy.
- **The host absorbed the freed time.** One Node thread carries everything:
  - every cell crossing;
  - the JSON of the 430 KB frozen bundle, sent and answered in each `admit`;
  - the commit-time re-run (isolate-wasm `rewrite`, `instance` and `take`: about 30% of the host's non-idle CPU in a `--cpu-prof` pilot);
  - the stand-in spec checks, such as one `finite` RegExp (about 9% of non-idle CPU).

  Its utilisation rose to 0.84–0.86 once the writer stopped holding the cells, and cell wait grew by about as much as the ledger shrank.
- **Rule V's verdict is misleading here.** It labels the ledger "saturated" because more requests are in flight than there are servers, even when those requests are waiting on the host, not on the writer.

## Floors against observed (zero latency, width 1 unless noted; P-73 floors, this round's observed)

| Bucket | P-73 observed | P-74 observed | Floor (P-73, this machine) | Headroom now |
|---|---|---|---|---|
| `ledger` + `freeze`, width 1 | 23.0 ms | 22.1 ms | 0.5 ms (own sync settings), 12.5 ms (unbatched full sync) | 1.8× to unbatched; ~44× to its sync settings (CPU) |
| `ledger` + `freeze`, width 64 | 495 ms | 216 ms | same | queueing, not service |
| Writer CPU per request | — | 3.3 ms (replay) | JSON + SHA-256 of a 430 KB bundle; no floor measured | U |
| `crossing`, width 1 | 19.5 ms | 21 ms | ~0.06 ms (7 crossings at 9.2 µs) | ~350× |
| `crossing`, width 64 | 1,048 ms | 1,214 ms | — | cell wait behind the host loop |
| `compile` | 28.3 ms | 25–31 ms | not measured | U |
| `gate` + `promote` | 15.3 ms | 20–21 ms | not measured | U |
| Host event loop, width 64 | — | 0.84–0.86 utilisation (main 0.66) | 1.0 | **binding next** |

## Next binding ceiling and levers (ranked by this evidence)

1. **The host event loop.** Move work off the single supervisor thread, or delete it:
   - (a) stop sending the 14 implementation files (≈420 KB as hex) in every `admit`, and stop echoing the 430 KB `encoded` record back. Pass a digest and let the writer read the repository files it already reads for `frozen_drift`, so the row bytes stay identical. In a pilot, the request half alone gave +4% and −60 ms of ledger time;
   - (b) run the commit-time re-run off the host thread (principle 8 keeps the re-run itself);
   - (c) handles instead of payload copies across the cell boundary (P-73 lever 10).
2. **Re-run this round after 1.** The two writer changes are ready (2d3bb6b): `LedgerShards` plus one validation per row. They pay only once the host stops binding. The validation half is a pure CPU cut (−15%, identical bytes) and could ride along with the next round.

## Code delta (measured commit 2d3bb6b, reverted here)

- About 80 lines added and 6 removed, in 6 files: `isolate-ledger.mjs` (+37, `LedgerShards`), `isolate-pool.mjs`, `stage-rates.mjs`, `ledger_writer.py` (+6, and `HANDLES` from 1024 to 256 so the total cap stays 1024), and two tests.
- Processes: +3 Python writers. Language crossings per request: unchanged (one pipe hop).
- No ban was added, so no check was needed. Durability is unchanged: `F_FULLFSYNC` per group commit, the same SQLite pragmas, and the same decision-file syncs.

## Other findings

- **P-73's re-run disagreement was avoided, not reproduced.** Each repeat used a fresh host process with at most about 1,300 needs, below the 4–5k onset, and no row showed it. The cause is still open.
- **Pre-existing hang on macOS.** `core/runtime/test/isolate-host-call.test.mjs` "a process cell dies with its supervisor, even in a hung kernel" calls `ps --ppid`, which is Linux-only (BSD `ps` refuses it). The test fails, but it leaves the supervisor holding a hung cell, so the file never exits. An unbounded `make test` stalled for hours on it. It reproduces on main and on P-74 alike: it fails, then hits the hard timeout, in both. The fix belongs in its own PR: `pgrep -P`, or `ps -A -o pid=,ppid=` filtered, plus a teardown that kills the cell.
- **Pre-existing test failure.** `core/runtime/test/ledger-writer.test.mjs` "SIGKILL of the writer at half_frame with the ledger files lost" fails on main as well as on P-74 (writer exits 1 on recovery).
- **Harness bug.** It counted the writer RSS by `comm` starting with `python`, but macOS reports `Python`, so `writerMb` and `writers` read 0 in every receipt. The tree RSS includes the writers.
- **Today's baseline is lower than P-73's 11.6/s at width 1.** 96 ms per need here against 86.5 ms there, because load was 7–15 during these rows.

## Receipts and how to reproduce

- `run.mjs climb <rep>` is the acceptance plan, run once per arm per repeat. `run.mjs capture` writes the writer requests of one width-64 row to `<output>/capture.jsonl`. That file is about 440 MB and holds local paths, so it isn't committed.
- `rows.py <repo> <capture> <scratch> <n>` replays the capture through that repository's writer and prints the CPU per request and the digests. `replay.json` holds the six runs.
