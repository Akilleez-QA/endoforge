# P-76 the ledger writer, again: validate each row once and shard by ledger, on top of P-75: precommit

Label: **Proposed** procedure, frozen 2026-11-17 before any acceptance measurement. Round 3 of the climb loop: the objective is plumbing speed, with correctness as a light guard. **No model calls and no spending.** The model is P-73's in-process stand-in (arm A) at zero latency. Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset, and the harness asserts that at start.

This round stacks on P-75 (draft PR #177, kept, branch `climb-r2-host-handles`), not on main.

## Question

P-75 moved the commit-time re-run off the supervisor's event loop and measured 49.3 needs/s at width 64, with the host loop at 0.34 utilisation. It named the single ledger writer as the next ceiling: 0.95–0.98 utilisation, 6.2–6.5 ms of service per request, about 3.1 requests per need, so one writer saturates at about 50 needs/s. P-74 (draft PR #176, failed and reverted) had two writer changes that cut ledger + freeze by 58% but moved no throughput, because the host was binding then (partly the harness's 21 stacked WASM guards). Now that the host is not binding, do those two changes lift width-64 throughput?

## What the pilots showed (profile before choosing)

Single 20 s pilot rows at width 64, P-75 (caf2dcf) against P-75 plus P-74's 2d3bb6b applied unchanged (it applies cleanly):

| | P-75 | P-75 + writer changes |
|---|---|---|
| needs/s | 50.9 (load 1.2 at start), 52.3 (load 3.7) | 55.3 (load 7.9), 58.3 (load 3.8) |
| ledger stage | 1 server, 0.99–1.00 utilisation, wait 111 ms, queue 18–19 | 4 servers, 0.71–0.73 each, no host-side wait |
| ledger + freeze per need | 368–383 ms | 121–128 ms |
| cells’ net utilisation (12) | 0.45–0.48 | 0.74–0.75 |
| host ELU | 0.35–0.36 | 0.50–0.51 |
| writer RSS (sum) | 205 MB, 1 process | 433 MB, 4 processes |

With four shards each writer's service per request rises to about 16 ms (four Python processes now share the 12 cores with 12 cells and the host), but no request waits for a writer. The stage-rates verdict moves from `ledger (saturated)` to `cell (unsaturated)`.

**Cutting requests per need was considered and not chosen.** The 3.1 requests are one `admit`, about 1.1 `park` and one `commit`. `park` is the durable checkpoint of a waiting cell, written before the next model turn so a crash can resume. Folding it into `commit` would remove that checkpoint, which is a durability change, and `admit` must be durable before the cell runs. The bytes per request (`admit` 430 KB up and back) are the larger lever, and they are the next round's handles-not-payloads lever, not this one.

## Lever (two parts, one commit: P-74's 2d3bb6b re-applied)

1. **One validation per row** (`tools/ledger_writer.py`). After a successful commit, the handle's read cache gains the `(seq, hash, id, record)` of each row this batch appended; a request that rolls back drops its rows. `_read` still checks every row's sequence, link and event hash against the bytes on disk on every request. Only the JSON parse, re-encode and `validate` of rows this process has just validated are skipped. A unit test pins the call count.
2. **Shard the writer by ledger** (`core/runtime/isolate-ledger.mjs`). `LedgerShards` runs `LEDGER_SHARDS = 4` `LedgerBridge` writers, a constant, not a knob, routed by a hash of the ledger path, so each ledger has exactly one writer and keeps its order. All writers share the one journal directory, which already supports concurrent writers. `IsolatePool` uses it, and `loopStages` declares `LEDGER_SHARDS` ledger servers. The per-writer handle cap `HANDLES` drops from 1024 to 256, so the total stays at 1024.

Unchanged: the gates, the freeze rule, every validation on append, the chain check on read, the journal's `F_FULLFSYNC` per group commit, SQLite's sync settings, the decision file syncs, and P-75's commit-time re-run on its two threads. `sources/SHA256SUMS` is regenerated for the two pinned files (P-74 showed that is required).

## Arms and procedure

- **P-75**: `origin/climb-r2-host-handles` (caf2dcf) in its own detached worktree, with this folder's harness copied in, untracked.
- **P-76**: this branch.

Harness (the oracle): P-75's `run.mjs`, copied unchanged (corpus built in a child process, `hostWasmGuard: false` asserted by `summarize.py`). Plan `climb <rep>` runs `w64` (width 64, 12 process cells, 25 s with 6 s warm-up) then `w1` (width 1, 25 s with 5 s warm-up).

Order: P-75 `climb 0`, P-76 `climb 0`, P-75 `climb 1`, P-76 `climb 1`, P-75 `climb 2`, P-76 `climb 2`. Each is a fresh host process, so a process handles under 1,300 needs. Before each row the harness waits until the 1-minute load is at or below 4 (up to 10 minutes) and records it. After the repeats, `bytes` runs once per arm.

Replay (P-74's `rows.py`, copied): one capture of writer requests from a P-75 `capture` row (width 64, 20 s), replayed through each arm's writer in one thread, three times each. It reports CPU per request and the SHA-256 of every answer and every row in every ledger.

## Predictions

| Quantity | P-75 (expected) | P-76 predicted |
|---|---|---|
| needs/s, width 64 | 45–51 | **+8% to +20%** |
| Ledger stage, width 64: busiest writer's utilisation | 0.95–0.99, one server | **≤ 0.80**, four servers, wait ≤ 10 ms |
| Ledger service per request, width 64 (utilisation × servers ÷ completions) | 6–7 ms | **12–20 ms** per shard (CPU contention), but no queue |
| ledger + freeze per need, width 64 | 330–380 ms | **−50% or more** |
| Wall per need, width 1 (ms) | 78–82 | **within ±3%** (the validation cut is ~0.5 ms per request) |
| Host ELU, width 64 | 0.33–0.36 | **0.42–0.56** (more needs through the same loop) |
| Writer CPU per request, replay | ~3.9 ms | **−10% to −20%**, digests identical |
| Ledger bytes per need | 1.01 MB | unchanged within 1% |
| Tree RSS, width 64 | ~4.8 GB | within +15% |
| Binding stage after the lever | ledger writer | not the ledger: the cells (net 0.7–0.8 of 12) or the machine's 12 cores |

## Oracle and bars

- **Keep** if all of these hold:
  - needs/s at width 64 rises at least 3% on the mean, with Welch's t across the 3 + 3 repeats at p < 0.05;
  - the busiest writer's utilisation at width 64 falls below 0.85;
  - width 1 doesn't regress more than 3%;
  - correctness holds:
    - every row has `wrongVerdicts` = 0 and `errors` = 0, and the same set of outcome classes as P-75;
    - the replay's answer and row digests are identical between arms;
    - `make -k test`, run one file at a time with `--test-timeout=120000` and a hard 600 s cap per file, shows no failure on P-76 that P-75 doesn't also show. `core/runtime/test/isolate-host-call.test.mjs` is excluded on both arms (it hangs on macOS, `ps --ppid`);
    - `make check` passes.
- Reconciliation (unattributed share) must stay under 5% of wall in every row.

## Stop rules

- Stop before a row if the 1-minute load is above 16, memory pressure is critical, swap is over 8 GB, or free disk is under 20 GB. (Swap was 6.1 GB of 7 GB at precommit; it is checked before every row.)
- Load above 4 at the start of a row: wait, as stated above. A row that ends with the load above 16 is re-run once and labelled.
- No real model call can happen: the credential variables are asserted unset, and the stand-in is in-process.

## What a miss means

- **The writer stops binding but throughput doesn't move:** the cells or the cores bind. `failed`, not kept; the next ceiling is named from the buckets.
- **Throughput rises past the bar:** kept. The next ceiling is named the same way.
- **Any wrong verdict, new error, new outcome class, digest difference or new test failure:** `failed_with_test_concern`, not kept.

## Limits known now

- One shared desktop machine with 12 cores; the rows push the load to 10–14 themselves. The start-of-row load gate covers only the other workloads.
- The pilots are single rows; P-75's pilots read about 10% higher than its acceptance rows.
