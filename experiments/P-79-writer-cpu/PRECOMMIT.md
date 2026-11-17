# P-79 writer: profile each request first, then answer the request a cell is holding for without waiting for its batch, on top of P-78: precommit

Label: **Proposed** procedure, frozen 2026-11-17 before any acceptance measurement. Round 6 of the climb loop: the objective is plumbing speed, with correctness as a light guard. **No model calls and no spending.** The model is P-73's in-process stand-in (arm A) at zero latency. Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset, and the harness asserts that at start.

This round stacks on P-78 (draft PR #180, kept, branch `climb-r5-cell-cpu`), not on main.

## Question

P-78 measured 76.7 needs/s at width 64 and named the four ledger writers as the next ceiling: `ledger (saturated)` in every row at 0.87–0.90, writer CPU 14.6 ms per need against a 10.5 ms replay floor (1.4×). This round asks where a writer request's time goes before pulling a lever.

## What the profile showed (exploratory, before this precommit)

All runs below are on P-78's code (an unchanged worktree of `climb-r5-cell-cpu`, plus, for the trace rows only, an uncommitted timing patch to the writer) and are diagnostics, not acceptance rows. Receipts: `receipt/explore-p78/`.

**CPU per request, by replay** (`profile.py`, `sites.py`): 4,912 writer requests captured from a P-78 width-64 row (1,563 admits, 1,786 parks, 1,563 commits across 1,563 ledgers), replayed one request per batch through P-78's writer.

| Action | Share of requests | CPU per request | Share of writer CPU |
|---|---|---|---|
| `admit` | 32% | 7.2 ms | 67% |
| `commit` | 32% | 2.3–2.8 ms | 24% |
| `park` | 36% | 0.7–0.8 ms | 8% |
| all | | 3.4–3.7 ms | |

- `admit` writes the 422 KB frozen record (405 KB of it the 14 implementation files as hex). Its 7.2 ms is passes over that record: JSON encode 2.6 ms (six passes: the bundle, the identity, the row body, `validate_frozen`'s two re-derivations, the journal frame), SHA-256 1.2 ms (seven passes, about 0.15 ms each), JSON decode 0.9 ms (three), SQLite 1.2 ms (`COMMIT` 0.5, `INSERT` 0.4, `BEGIN` 0.15), reading and hex-encoding the repository's implementation files twice 0.45 ms. Schema conformance and Python overhead are small.
- `commit`: decoding the frozen bundle twice (`frozen_drift`, `report_problem`) 0.44 ms, the repository files once 0.21 ms, the chain check on read 0.15 ms, SQLite 0.4 ms.
- Exact, validation-preserving deduplication (decode the bundle once, read the repository once, hash each content once) would cut about 1.9 ms per need of the ~10.4 ms replay total.

**Where a live request's time goes** (two exploratory width-64 rows with a per-request timing trace in each writer; `trace.py`): 76.3 and 76.5 needs/s.

| Per request | `admit` | `commit` | `park` |
|---|---|---|---|
| Applying its batch (wall) | 29.8 ms | 12.6 ms | 13.4 ms |
| Waiting for the syncer | 0.8 ms | 1.1 ms | 1.3 ms |
| Journal `F_FULLFSYNC` | 6.0 ms | 5.1 ms | 5.4 ms |
| Answer written | 0.4 ms | 0.4 ms | 0.3 ms |
| **In the writer** | **37.0 ms** | 19.2 ms | 20.4 ms |

- **The writers are not CPU-bound.** Each writer's main thread is busy 0.48–0.52 of wall and its syncer 0.19–0.22; writer CPU is 1.15 cores of the 4. The 0.87 "utilisation" is the share of time a request is in flight, not work.
- **What binds is the admit's latency, because a cell waits on it.** `admit` (and `revise`) are host calls made from inside a cell job, so the cell holds its slot until the answer comes: the harness's cell `blocked` time is 0.31 of 12 cells (about 48 ms per need, matching the 46 ms `freeze` bucket), while the cell queue holds 45 jobs.
- **Two thirds of admits share a batch with other requests, and then wait for them.** A batch is applied whole, then handed to the syncer, then answered. 66% of admits arrive in a batch with others (a slow admit makes others pile up behind it); their time in the writer is 44 ms against 23 ms for an admit alone (apply 36 ms against 17 ms). A single admit's apply takes 17 ms of wall for about 7–10 ms of CPU: the machine is full.
- Journal syncs: 157 per second across the four writers, 1.05 batches per frame, 5.1 ms mean. Decision files are not on the path (0.1 ms).
- Raising the writer's QoS to user-initiated changed nothing (76.5 needs/s, the same apply times).

## Lever (one commit)

**A request that holds a cell is answered without waiting for the rest of its batch** (`tools/ledger_writer.py`, `tools/x1_loop.py`).
- The extension names the actions whose caller holds a cell while it waits: `HOLDING = ("admit", "revise")` in `tools/x1_loop.py`.
- When the writer runs with its syncer, `Writer.batch` applies the ledger groups that contain a holding action first, hands them to the syncer at once, and then applies the rest of the batch and hands that on as before. A batch with no holding action, or nothing else, is handled exactly as today. Without a syncer (the replay path) a batch is still applied and flushed as one.
- Each answer still leaves only after the journal frame holding its writes is synced with `F_FULLFSYNC` (REQ-LEDGER-002), and requests for one ledger keep their order: a group is never split. A batch with both kinds may now take two frames, so syncs per request may rise; the syncer still merges whatever is pending into one frame.

Ship the check: a test in `tools/test_ledger_writer.py` that, in a batch with a `note` for one ledger before an `admit` for another, the admit's writes are synced and its answer handed on before the note is applied, and that both answers follow their syncs. Traced under REQ-LEDGER-002.

Not changed: durability (`F_FULLFSYNC` on the journal, SQLite's sync settings, the frame format, recovery), every validation on append, the chain check on read, the rows written, the answers, the gates, the freeze rule, the frozen record and its identity, park as its own crash-resume checkpoint (not folded into commit), P-75's re-run, P-76's four writers (no shard added), P-77's handles, P-78's rewrite.

## Predictions (P-78 arm = `climb-r5-cell-cpu` at 8f63101; P-79 arm = this branch)

- `freeze` per need at width 64 (the host-measured admit): **−15% to −35%** (P-78 capture row: 46.3 ms).
- Throughput at width 64: **+3% to +10%**. Each ms an admit loses frees a cell for about a ms; 66% of admits lose about 20 ms.
- Writer CPU per need at width 64: unchanged, within ±5%.
- Wall per need at width 1: unchanged (bar: not worse than +3%); at width 1 an admit rarely shares a batch.
- Journal syncs (exploratory trace rows, one per arm after acceptance): at most +25% per request; mean sync time not above 1.3× P-78's.
- Correctness: identical outcome classes and proportions, 0 wrong verdicts, 0 errors.

## Oracle and keep bar

- Keep only if width-64 needs/s rises by **≥ 3% with Welch p < 0.05** over 4 + 4 interleaved rows, `freeze` per need falls, and width 1 is not worse than +3% wall.
- Correctness:
  - `wrongVerdicts` = 0 and `errors` = 0 on every row, and the same outcome classes on both arms;
  - **replay**: the 4,912 captured requests through each arm's writer give byte-identical rows and answers, both one request per batch (`rows.py`) and in batches of 8 with the syncer running (`batches.py`, answers compared sorted by id);
  - the new test passes;
  - `make check` passes;
  - `make -k test`, one command per file on both arms excluding `isolate-host-call.test.mjs` (hangs on macOS), shows no failure on P-79 that P-78 doesn't have.

## Procedure

- Same harness as P-78 (`run.mjs`, copied; acceptance rows do not use `diag` or the exploratory stamp), reference machine (Apple M6, 12 cores, 16 GiB, Node v26.13.1, Python 3.15.2).
- `run.mjs <out> <stamp> row <w64|w1> <rep>`, reps 0–3, order per rep: w64 P-78, w64 P-79, w1 P-78, w1 P-79. One row per process; a row waits for load ≤ 4 (up to 10 minutes) and re-runs at once if it ends above 16.
- Safety caps: stop if load stays above 16, memory pressure is critical, swap exceeds 8 GB or free disk falls below 20 GB.

## Stop and rollback

- If replay rows or answers differ, or any row has a wrong verdict or error: stop, revert.
- If the mean journal sync time rises above 1.5× P-78's in the trace rows: record it as a disk cost against the lever.
- If the keep bar fails: record `failed` in RESULT.md and the PR, and revert the lever on the branch.
