# P-74 ledger writer: stop re-validating its own rows and shard it by ledger: precommit

Label: **Proposed** procedure, frozen 2026-11-17 before any acceptance measurement. Round 1 of the climb loop: the objective is plumbing speed, with correctness as a light guard. **No model calls and no spending.** The model is P-73's in-process stand-in (arm A) at zero latency. Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset, and the harness asserts that at start.

## Question

P-73 (draft PR #175, unmerged) found that at zero latency the single ledger writer binds first: about 37 needs/s at width 64, 8.4 ms of service per request, 3.2 requests per need, with the cells next at about 68 needs/s. Which change to the writer moves that ceiling the most, without changing a single ledger row?

## What the pilots showed (profile before choosing)

Pilots on `origin/main` (18819c8), 20 s rows at width 64, plus a replay of 2,508 captured writer requests through the writer in one thread under `cProfile`:

- **Requests are big.** Per need: one `admit` of about 430 KB (the frozen bundle carries the 14 x1 implementation files as hex), 1.1 `park` of 67 KB and one `commit` of 52 KB. The `admit` answer carries the frozen record back (430 KB).
- **CPU per request is 3.4–4.0 ms** in the replay, single-threaded, excluding the journal's `F_FULLFSYNC` (3.3 ms, which runs on the group-commit thread). The JSON encoder, the decoder and SHA-256 dominate.
- **The writer re-validates rows it has just written.** `Writer.apply` keeps a per-ledger read cache, but rows appended in a batch never enter it. So the next request on that ledger re-parses, re-encodes and re-validates every new row, including the 430 KB frozen evaluator (`validate_frozen`). Extending the cache with the rows the writer appended after the commit cut replay CPU by 14–17%, with byte-identical rows and answers.
- **Latency comes from the one main thread queueing.** A traced pilot split the 140 ms mean round trip per request into 60–100 ms between Node's write and the writer reading the line, 20–40 ms inside the batch, and about 10 ms in the queue plus the journal sync. The writer process ran at about 60% CPU (both threads together). Requests wait their turn behind earlier batches on one serial thread, which shares its GIL with the journal thread.
- **The writer's latency holds the cells.** The `admit` runs inside a cell job, so the cells sit at 1.00 gross and about 0.5 net utilisation while they wait for it.
- **Sharding works, the in-process alternatives don't.** Four independent writer processes, routed by ledger path, cut the ledger bucket from about 345 to 115 ms per need in pilots. An in-process Node writer (`node:sqlite`) is ruled out: Node can't issue `F_FULLFSYNC`, which the journal relies on, so it would weaken durability.

## Lever (two parts, one PR)

1. **One validation per row** (`tools/ledger_writer.py`). After a successful commit, extend the handle's read cache with the `(seq, hash, id, record)` of each row this batch appended. A request that rolls back removes its rows from the list. `_read` still re-checks every row's sequence, link and event hash against the bytes on disk on every request. Only the JSON parse, re-encode and `validate` of rows this process has just validated are skipped, which is exactly the path `_read` already takes for cached rows. A unit test pins the call count.
2. **Shard the writer by ledger** (`core/runtime/isolate-ledger.mjs`). `LedgerShards` runs `LEDGER_SHARDS = 4` `LedgerBridge` writers, and it is a constant, not a knob. It routes each request by a hash of its ledger path, so every ledger has exactly one writer and keeps its order. All writers share the one journal directory, which already supports concurrent writers through per-writer segment names and the recovery lock. `IsolatePool` uses it. `loopStages` declares `LEDGER_SHARDS` ledger servers. To keep the memory roofline, the per-writer handle cap `HANDLES` drops from 1024 to 256, so the total stays at 1024.

Unchanged: the gates, the freeze rule, every validation on append, the chain check on read, the journal's `F_FULLFSYNC` per group commit, SQLite's sync settings, the decision file syncs and the commit-time re-run. `fullfsync` is neither added nor removed.

## Arms and procedure

- **main**: `origin/main` (18819c8) in its own detached worktree, with this folder's harness copied in, untracked.
- **P-74**: this branch.

Harness: P-73's `run.mjs`, copied unchanged except for three additions. It records the host event-loop utilisation and the writers' RSS, sums the RSS over every writer process, and gains the plans `climb` and `capture`. Same corpus (P-50's 21 kernels with the capability fence), same machine, Node v26.13.1, Python 3.15.2.

Plan `climb <rep>`, three repeats per arm, interleaved main, P-74, main, P-74, main, P-74. Each repeat is a fresh host process, so a process handles at most about 1,300 needs, well clear of P-73's re-run disagreement at 4–5k needs. Each repeat runs two rows:
- `w64`: width 64, 12 process cells, zero latency, 25 s with 6 s warm-up;
- `w1`: width 1, 25 s with 5 s warm-up.

Replay (`rows.py`): one capture of the writer requests from a main `capture` row at width 64, 20 s, replayed through each arm's writer in one thread, three times each. It reports CPU and wall per request, plus the SHA-256 of every answer and of every row in every ledger (`records`, `x1_continuations`, `x1_decisions`, `ledger_journal`).

## Predictions

| Quantity | main (expected) | P-74 predicted |
|---|---|---|
| Writer CPU per request, replay (ms) | 3.4–4.0 | **−12% to −20%** |
| Answer and row digests, replay | — | **identical** to main |
| Ledger round trip per request at width 64 (ledger bucket ÷ requests per need) | ~100 ms | **≤ 45 ms** |
| `ledger` + `freeze` bucket per need, width 64 (ms) | ~470 | **≤ 230** (−50% or more) |
| needs/s, width 64, zero latency | ~44 today (P-73: 37.5 at higher load) | **+5% to +15%** |
| Wall per need, width 1 (ms) | ~86.5 | **within ±3%** (no queue to remove at width 1; cache saves under 1 ms) |
| Cells' net utilisation, width 64 | ~0.55 | **≥ 0.65** |
| Tree RSS at width 64 | — | within +15% (3 extra writer processes, same total handle cap) |
| Stage-rates verdict at width 64 | ledger (saturated) | **ledger or cell, not decided**: rule V counts every in-flight request as service, so 4 servers with about 9 in flight can still read as saturated. The next ceiling is judged from the buckets and utilisations, not the label alone |

Next binding ceiling, predicted: the **host event loop** (one Node thread carrying every crossing, the JSON of the 430 KB bundle in both directions, and the commit-time re-run), which shows up as cell wait (`crossing`), not as ledger time.

## Oracle and bars

- **Keep** if all of these hold:
  - needs/s at width 64 rises by at least 5% on the mean, with Welch's t across the 3 + 3 repeats at p < 0.05;
  - the ledger + freeze bucket shrinks by at least 30%;
  - width 1 doesn't regress by more than 3%;
  - correctness holds:
    - in every kept row, every promotion matches the corpus's expected outcome (`wrongVerdicts` = 0, `errors` = 0);
    - the outcome histograms have the same set of outcome classes as main;
    - the replay digests are identical;
    - `make test` shows no failure on P-74 that main doesn't also show (both run on this machine, same day).
- Reconciliation (unattributed share) stays under 5% of wall in every row, the same as P-73.

## Stop rules

- Stop before a row if the 1-minute load is above 16 (the harness waits up to 10 minutes and then stops), memory pressure is critical, swap is over 8 GB, or free disk is under 20 GB.
- No real model call can happen: the credential variables are asserted unset and the stand-in is in-process.
- A row that ends with the load above 16 is re-run once and labelled.

## What a miss means

- **Throughput below +5%, or not significant:** the writer was not the binding resource at width 64. Then P-73's `ledger (saturated)` verdict came from rule V counting waiting as service, and the lever is **not kept** (`failed`). Its bucket effect is still reported.
- **Ledger bucket shrinks but throughput doesn't move:** the next ceiling binds immediately. Name it from the buckets.
- **Any digest difference or wrong verdict:** `failed_with_test_concern`, not kept.

## Limits known now

- One shared desktop machine with other workloads running (Chrome used 2–3 cores during the pilots). The repeats are interleaved for that reason.
- The replay runs the writer in one thread with synchronous flushes, so it measures CPU per request, not the two-thread group-commit timing.
- Four shards is chosen from pilots (4 and 8 gave the same throughput). No sweep is run.
