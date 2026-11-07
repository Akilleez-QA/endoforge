# P-59 group-commit ledger writer: precommit

Label: **Proposed** procedure, frozen 2026-11-07 before any acceptance measurement. No model calls and no spending: every model is a scripted stub with a set delay.

Question: [P-57](../P-57-release-waits/RESULT.md) freed the cells during model waits and found the single ledger bridge to be the next width limit, at about 8 candidates a second. If the bridge keeps one durable crossing per request but makes it a group commit, with one journal `fdatasync` per batch across every task ledger in the batch, how many accepted candidates a second does the ledger carry, how many disk syncs, process spawns, CPU-seconds and how much memory does each candidate cost, and does every acknowledged event survive a SIGKILL in the middle of a batch?

## Where the time goes now (measured before this precommit)

P-57's harness at its own commit (`e965901`), `swarm-release` (64) and `swarm-release-256`, ledgers on btrfs NVMe, with the bridge under `cProfile` (wall clock) and an `LD_PRELOAD` counter of `fsync` and `fdatasync` ([synccount.c](synccount.c)). Receipts: [receipt/profile-before](receipt/profile-before/).

| | 64 candidates | 256 candidates |
|---|---|---|
| Bridge wall / idle in `read` | 14.7 s / 9.7 s | 35.2 s / 7.8 s |
| SQLite `commit` | 1.82 s, 201 calls | 10.54 s, 804 calls |
| `Connection.close` | 0.37 s, 128 calls | 4.61 s, 1,280 calls |
| `Ledger()` setup (`executescript`) | 1.00 s, 64 calls | 4.13 s, 544 calls |
| Disk syncs | 905 (14.1 per candidate) | 5,156 (20.1 per candidate) |
| Bridge CPU (user + sys) | 0.68 s (10.6 ms per candidate) | 4.17 s (16.3 ms per candidate) |
| Bridge peak RSS | 149 MiB | 151 MiB |
| Python spawns | 1 | 1 |

The bridge is not CPU-bound and does not spawn per request. It is sync-bound: 88% of its busy time at 256 is SQLite waiting on `fdatasync` in `commit`, the checkpoint in `close`, and the schema commit in `Ledger()`. Batching per ledger path gives nothing, because each task has its own ledger and a batch rarely holds two requests for one file, so every request pays its own sync. Past 64 open ledgers the bridge's handle cache evicts in insertion order and reopens, which re-runs schema setup, re-validates the whole chain and checkpoints on close: 544 setups and 1,280 closes for 256 ledgers.

## Design under test

`core/ledger/writer.py`, the persistent bridge's batch loop moved out of the inline Python in `isolate-ledger.mjs`. The crossing stays one JSON-lines request per ledger action from outside every cohort.

- **Group-commit journal.** Each batch (all lines available on stdin) is applied per ledger path in one `BEGIN IMMEDIATE` transaction with a savepoint per request, as now. Each ledger's SQLite writes are committed with `synchronous=NORMAL` in WAL mode, which does not sync. Every statement the batch wrote is captured, with its parameters, into one framed, SHA-256-checked record appended to the writer's journal segment; one `fdatasync` of the journal makes the whole batch durable; only then are decision files written and responses sent. A request is acknowledged only after the frame holding its writes is on disk.
- **Replay marker.** Each ledger's transaction also records `(writer, frame)` in a `ledger_journal` table, so recovery knows exactly which frames a ledger already holds after a power loss, which can only lose a suffix of SQLite's commits, and re-executes only the missing ones in order.
- **Recovery and torn tails.** On start, under a directory lock, the writer takes every journal segment whose owner's lock is released, scans its frames, replays what a ledger lacks, makes the ledgers durable, and retires the segment. A frame that is short or fails its checksum at the tail is a torn tail: its bytes are copied to a quarantine file beside the segment and the segment is cut at the last whole frame. A torn frame was never synced, so never acknowledged. A bad frame followed by a valid one is corruption, not a tail, and the writer refuses to start. A ledger whose rows disagree with an acknowledged frame is marked with a conflict file and refused, never rewritten.
- **Retirement.** A segment is retired at rotation (128 MiB) and at a clean close: one `syncfs` per filesystem the segment touched (per-file `fsync` where `syncfs` is missing), then the segment is deleted. Connections close without a checkpoint (`SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE`) and are kept in a least-recently-used cache of up to 1,024 ledgers, so eviction costs no sync.
- **Unacknowledged requests.** If the writer dies, every pending request rejects with `outcome_unknown` and is never resent; the restarted writer serves only new requests. SQLite commits before the journal sync, so after a SIGKILL a request's writes are all present or all absent in its ledger, and a rerun reconciles from the durable records as it does now.
- Ledgers not in WAL mode keep `synchronous=FULL`. `store_decision` (the non-agent path's `promotion.json`) keeps its own `fsync`, after the batch's journal sync.

## Arms

Under `HEAVY_SLOTS=4 heavy-run`, ledgers and journal on btrfs NVMe (`/mnt/cold-steam`), never tmpfs.

- **Capture.** One serial run of P-50's 21-kernel corpus through `createLoopPool({waits: 'release'})` records each candidate's ledger requests (`admit`, `park`, `commit`), in order, with their payloads and the number of model calls before each. Its digest is in the receipt.
- **`ledger-old`, `ledger-new`**: the captured streams replayed through `LedgerBridge` alone, each candidate in a fresh ledger directory, with no cells: before each request the candidate sleeps one seeded uniform 2–4 s model wait per model call recorded before it, which is P-57's distribution. `ledger-new` runs 4,096 candidates at width 1,024 (the corpus cycled). `ledger-old` runs the bridge of P-57's commit `e965901`, from a detached worktree, at 1,024 candidates and width 1,024, because at its expected rate the larger arm would take over 8 minutes.
- **`loop-*`**: P-57's five arms (`serial-hold`, `serial-release`, `swarm-hold`, `swarm-release`, `swarm-release-256`) re-run unchanged with the new writer, for P-57's bar.
- **`crash`**: 24 trials. Each starts a writer with 64 candidates in flight from the captured streams (no model sleeps), and the writer SIGKILLs itself in its batch number 3–20 (seeded) at one of four points: after SQLite commits and before the journal write; with half a frame written; after the journal sync and before any response; after half the responses. Each point runs 6 times, 3 of them with the SQLite writes treated as lost after the kill (every ledger file created in the trial deleted, the journal kept), which is the power-loss case SIGKILL alone can't reach. A new writer then recovers. A trial checks every acknowledged event against the ledgers.

## Measures

- **Accepted candidates/s**: candidates whose `commit` was acknowledged with the corpus-expected decision, divided by the arm's wall time from the first request to the last answer.
- **Non-model ms per candidate**: wall minus the time spent in model sleeps (ledger arms) or in the provider (loop arms), nearest-rank p50 and p95.
- **Disk syncs per candidate**: every `fsync`, `fdatasync` and `syncfs` call made by the writer process, counted by an `LD_PRELOAD` shim, including recovery and retirement, divided by candidates; and **syncs per batch** on the request path (journal syncs divided by batches, from the writer's own counters).
- **Process spawns per candidate**: Python processes started during the arm divided by candidates.
- **CPU-seconds per candidate** (user + sys) and **peak RSS** of the writer process, from `getrusage` at exit; for the loop arms, the summed process-tree RSS as in P-57.
- Batch size, journal bytes per candidate, and request latency by action, p50 and p95.
- Each arm records the 1-minute load at start and end; above 16 at either, its timings are labelled loaded and don't count for L1 or L5.

## Bar, fixed here

- **L1** `ledger-new` carries at least 64 accepted candidates/s (8× P-57's 8), with every decision equal to the corpus expectation.
- **L2** Disk syncs per candidate at most 1 in `ledger-new`, counting everything the writer process syncs; and at most 1 sync per batch on the request path.
- **L3** Across the 24 crash trials: zero acknowledged events lost or duplicated (each acknowledged `admit` has its task, input and frozen evaluator; each acknowledged `park` its continuation row with that digest and `seq`; each acknowledged `commit` its candidate, receipt and decision; record ids, sequences and chain verify with `Ledger.records()`); every unacknowledged request rejected as `outcome_unknown` and not resent; and its writes all present or all absent.
- **L4** Torn tails: a journal cut mid-frame, a corrupted last frame and trailing garbage are detected and quarantined with no acknowledged frame lost; corruption before a valid frame refuses to start; no torn or missing ledger is read as empty. The existing ledger chain tests pass unchanged.
- **L5** No regression on P-57: W1 to W6 hold in the `loop-*` arms against P-57's own thresholds, `swarm-release` non-model p50 is no worse than P-57's 1,677 ms, and `make loop-test` passes.

L3 or L4 failing means the writer does not become the default and the failure is named. L1, L2 or L5 missing is reported as measured, with no retuning.

## Predictions

1. `ledger-new` 110–170 accepted candidates/s: width 1,024 over a candidate life of about 6.3 s bounds it near 160.
2. `ledger-old` 6–10 candidates/s at width 1,024, with more reopen churn than P-57's 256 arm.
3. Disk syncs per candidate 0.05–0.5 in `ledger-new` (one journal sync per batch, batches of several requests, plus a few retirement `syncfs`), against 14–20 before.
4. Writer CPU 3–8 ms per candidate; peak writer RSS 150–400 MiB with up to 1,024 cached ledgers.
5. `ledger-new` request latency p50 under 20 ms for every action.
6. `swarm-release-256` non-model p50 falls from 18.4 s to 1–5 s and its throughput rises from 489 to 900–1,800 a minute: the four cells, about 35 candidates a second at best, become the limit again.
7. `swarm-release` (64) non-model p50 600–1,400 ms, the rest of P-57's 1,677 being queueing for cells in the bursts.
8. The crash trials pass with 6–12 torn tails quarantined, from the half-frame point.

## Limits

One shared desktop with other lanes writing to the same btrfs filesystem, so `syncfs` at retirement flushes their data too. Stub models with a fixed delay distribution. Synthetic kernels. A real power loss isn't tested; it is simulated by deleting the trial's ledger files after the kill, which is harsher than losing a WAL suffix but doesn't test the disk's own write ordering. RSS isn't PSS.

## Amendment 1, after implementation and before any acceptance measurement

Date: 2026-11-07. Development smoke runs (smaller or differently sized `ledger-new` runs and five crash trials, outside `receipt/`) changed four implementation details. The bar, arms, measures and predictions are unchanged.

- **SQLite sync mode.** A WAL ledger written by the writer uses `synchronous=OFF` with `wal_autocheckpoint=0` and no checkpoint on close, not `NORMAL`. `NORMAL` still synced twice at a new WAL's first commit and three or four times at the switch to WAL, about 7 syncs per new ledger. With no checkpoint run by the writer, `OFF` changes nothing else in WAL mode: a power loss leaves a valid prefix of SQLite's commits, which the journal replay completes. Where `setconfig` is missing (Python before 3.12), the writer falls back to `NORMAL`, since a checkpoint on close at `OFF` could damage the file.
- **Pipelined group commit.** The journal is written and synced on its own thread. Batches applied while a sync runs are coalesced into the next frame, and when requests have recently arrived closer together than 5 ms the thread waits up to 10 ms, or for 16 requests, before syncing. Answers still leave only after the sync of the frame holding their writes. A batch is capped at 128 requests.
- **Line reading.** The reader no longer concatenates its whole input buffer for every chunk, which was quadratic in a burst of large requests.
- **Chain read.** `Ledger._read` with a cache still checks every row's sequence, link and hash on each read; for a row whose sequence, hash and id equal an already verified cached row, it reuses the parsed record instead of decoding and re-encoding the body. Rows that differ are verified and validated in full, as before.
