# P-84 bundle objects: the frozen record names the implementation by digest and the bytes are stored once, on top of P-83: precommit

Label: **Proposed** procedure, frozen 2026-11-18 before any acceptance measurement of the lever. Round 11 of the climb loop: the objective is plumbing speed, with correctness as a light guard. **No model calls and no spending.** The model is P-73's in-process stand-in (arm A) at zero latency. Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset, and the harness asserts that at start.

This round stacks on P-83 (draft PR #185, kept), at `climb-r10-gate-scans` d70da77.

## Step 1: the writer profile (measured before this precommit)

A width-64 capture row on P-83 (`run.mjs … explore capture`, 87.6 needs/s while capturing) gave 5,000 writer requests: 1,607 admits, 1,827 parks and 1,566 commits across 1,607 ledgers. P-79's `profile.py` and `sites.py` replay them one per batch through P-83's writer (receipt: `receipt/profile/`).

| Action | CPU per request (sync on / off) | Share | Where it goes |
|---|---|---|---|
| `admit` | 7.2–7.8 / 6.5–6.8 ms | 65–69% | Passes over the 423 KB frozen record, 406 KB of which is the 14 implementation files as hex: JSON encode 2.67 ms (6 passes), SHA-256 1.20 ms (7 passes), JSON decode 0.86 ms (3 passes), `validate_frozen` 1.54 ms inclusive, SQLite 1.25 ms, repository files read and hexed twice 0.46 ms |
| `commit` | 2.4–3.3 / 2.0–2.3 ms | 23–26% | The bundle decoded twice (`frozen_drift`, `report_problem`) 0.43 ms, repository files 0.20 ms, chain check on read (re-hashes the 424 KB row) 0.15 ms, SQLite 0.38 ms |
| `park` | 0.80–0.96 / 0.61–0.66 ms | 8–9% | Chain check on read 0.14 ms, SQLite 0.15 ms |
| all | 3.35–3.87 / 2.95–3.13 ms (three runs each; the third ran beside `kill.py`) | | 3.11 requests per need: **10.4–12.0 ms per need** at replay; live writer CPU at width 64 is 15.2 ms (P-83) |

Unbatched `F_FULLFSYNC` in replay: 3.6 ms mean (5.1 ms in the third run). The journal carries every row's SQL statements, so each admit also writes the 423 KB record into the journal (once more JSON-escaped) as well as into the need's SQLite file: 935 MB of journal for the 5,000 requests.

The same record crosses into the cells: `verifyFromMemory` puts the 406 KB of hex back into the frame, hashes the 423 KB encoding twice and parses the 422 KB content, once per call. A cell calls it at admission and for each evaluation, and the host calls it once more per commit (`frozenEvaluator`). Warm, that is about 0.56 ms per call for a corpus record against 0.01 ms for a 4–19 KB one.

**Every pass over the frozen record is a pass over the same 406 KB of implementation bytes,** which are the repository's own 14 files, identical in every need. Deduplicating passes (candidate (b)/(c), P-79's estimate −17% writer CPU) leaves each remaining pass at 423 KB. Removing the bytes from the record shrinks every pass, in the writers, the journal, SQLite, the cells and the host, by about 23×.

## Lever (one commit): candidate (a), the implementation by digest, bytes stored once

- `tools/x1_loop.py`:
  - `admit` with `implementation` digests (every agent-mode admission since P-77) freezes a bundle `{files, implementation, configuration, residual, invariant_version}`: `files` holds the oracle files as before, and `implementation` maps each of the 14 names to the SHA-256 of its bytes. The digests are still checked against the repository files first, as in P-77.
  - Before the record is appended, `store_objects` writes each file's bytes once to `<journal directory>/objects/<sha256>`: a staging file written and `F_FULLFSYNC`ed, linked into place, then the directory synced. This happens in `apply`, on the main thread, before the batch reaches the syncer, so every object is durable before the frame that acknowledges the admit. An object already present is never rewritten; a process remembers the objects it has made durable.
  - `admission` answers with the record itself as the frame (4–19 KB) and `elided: []`.
  - `frozen_drift` compares the frozen digests with the repository files' digests; `revise` carries the digests into the revised record.
  - `inflated(record)` rebuilds the full P-83 bundle from the store, checking each object against its digest: the recoverability path.
  - A record frozen from a tree (`reference.root`, the older pipeline) and every record written before this round keep the files themselves and are served and verified exactly as before.
- `core/ledger/frozen.py`: `validate_frozen` accepts the optional `implementation` map (non-empty, valid relative names, lowercase 64-hex digests, no name also in `files`); `frozen_record` takes `implementation=`. Every other check on append is unchanged.
- `core/runtime/x1/loop-port.mjs`: the cell's drift check compares `bundle.implementation` with its own files' digests when the bundle names them by digest, and the hex as before otherwise (+2 −2 lines).
- Tests: `tools/test_x1_handles.py` (the record holds digests and inflates to the payload freeze byte for byte, objects are stored once, a tampered object never inflates, a changed repository file is drift, and a writer killed after an admit recovers from the journal a record that inflates from the store); `core/ledger/test_frozen.py` (valid and malformed digest bundles); `loop.test.mjs` (an admission by digest verifies in the cell; three forgeries refused). `core/runtime/README.md`, the verification matrix and `sources/SHA256SUMS` updated.

Not changed: durability (`F_FULLFSYNC` per journal frame, SQLite's sync settings, the frame format, recovery, the decision file syncs); every validation on append and the chain check on read; the identity scheme (`evr:` + SHA-256 of the encoded data, which now commits to the implementation through its digests); the gates and what they decide; the freeze rule and its edit-after-failure check; REQ-ISO-016 (`retireAfterJobs` 256); the cell count; the four writers (no fifth); isolation and permissions; P-75 to P-83's levers. No new option.

**Row content changes by design:** the frozen record and every hash derived from it (its identity and content digest, the receipts and decisions that name them, the chain hashes and decision seals after it). The guard below proves the old rows are recoverable from the new ones and the store.

## Predictions (P-83 arm = d70da77; P-84 arm = this branch's lever commit)

Prototype replay of the same 5,000 requests (`rows.py`, one per batch, sync on; P-84 runs P-84's writer with P-83's `x1` files so the digests match, and translates each later request's frozen identity and digest as the admits answer): **2.76 → 1.02 ms CPU per request (−63%)**, the frozen record 434 → 18.6 KB, journal bytes 935 → 267 MB. The model: needs/s at width 64 is set by the machine's capacity (P-83's flat pool sweep), so it rises as CPU per need falls.

- **Writer CPU per need at width 64: 15.2 → 6–9 ms.** Replay saves about 5.4 ms per need; live costs ~1.3× replay.
- **Cells and host:** `verifyFromMemory` and the host's `frozenEvaluator` stop hashing and parsing 423 KB: −1 to −4 ms CPU per need together.
- **All CPU per need at width 64: 125 → 112–120 ms (−4% to −10%).**
- **Throughput at width 64: +4% to +10%.**
- Writer in-flight utilisation: 0.898 → 0.55–0.80.
- `ledger` + `freeze` wall per need at width 64: −20% to −50%.
- **Width 1: wall per need −4% to −12%** (54.2 ms): about 5 ms of writer CPU leaves each need's `admit` and `commit` path, and each `F_FULLFSYNC` carries less data. Bar: not worse than +3%.
- Tree RSS: −0% to −10% (the writers' record caches shrink). **needs/s per GB must not fall.**
- Correctness: identical outcome classes and proportions, 0 wrong verdicts, 0 errors.

## Oracle and keep bar

- **Keep only if all of these hold:**
  - width-64 needs/s rises by at least +3%, with **Welch p < 0.05** over 4 + 4 interleaved rows, **or** throughput is equal within noise and writer CPU per need falls by at least 25% (an equal-speed structural win);
  - width-1 wall per need is not worse than +3%;
  - needs/s per GB (mean needs/s ÷ mean window-end tree RSS) does not fall;
  - durability is unchanged and the recoverability proof below holds;
  - the correctness guard below holds;
  - GitHub CI (Linux: lint, test (22), test (26), coverage) is green on the PR.
- **Recoverability proof** (row content changes):
  - **Replay** (`rows.py`): the 5,000 captured requests through each arm's writer. P-84's rows, mapped back by inflating each frozen record from the store, substituting the old identity, digest and chain hashes, recomputing each chain hash and decision seal, must give the **same rows digest** as P-83's (`records`, `x1_continuations`, `x1_decisions`; `ledger_journal` holds statement digests and is compared by count), and P-84's answers, mapped the same way, the same answers digest. 0 errors on both. Every object verifies against its name.
  - **Kill at each frame** (`kill.py`): a writer process replays the first 160 requests one at a time and is `SIGKILL`ed after every second acknowledged frame (80 points, with 0–6 ms delays), in three variants: plain; with every ledger's WAL deleted (so recovery must replay the journal); and with the WAL deleted and half a frame appended to the journal (a torn tail). After recovery, every acknowledged admit's frozen record must be present, pass the chain check and validation on read, and (P-84) inflate from the store; every acknowledged commit's receipts and park's continuation must be present. Run on both arms: 0 missing, 0 conflicts.
  - The new unit tests above, including the kill-and-recover test.
- **Correctness guard:**
  - `wrongVerdicts` = 0 and `errors` = 0 on every row, with the same outcome classes on both arms;
  - **request stream:** a width-1 capture row on each arm (`capture1`, `stream.py`). For the needs both rows completed, every `admit`, `park` and `commit` request is identical after the usual substitutions (the row's directory; wall-time fields, cell pids and the evaluator digest in `commit`), with `loop-port.mjs`'s two digests and the frozen identity mapped;
  - `ledger-writer.test.mjs` (its `half_frame` case is known flaky on macOS on both arms; counted on both), `test_ledger_writer.py`, the journal recovery tests, `tools/test_x1_*.py`, `core/ledger` tests and `loop.test.mjs` pass apart from failures P-83 also has;
  - `make check` and `make lint` pass, including the no-comments check;
  - `make -k test`, one command per file on both arms, with `isolate-host-call.test.mjs` excluded on both (it hangs on macOS): no failure on P-84 that P-83 does not have;
  - `core/runtime/test/loop-crash.test.mjs`, run 4 times on each arm: no more failures on P-84 than on P-83. The counts are reported.

## Procedure

- **Harness:** P-83's `run.mjs`, unchanged apart from its location (it checks this PRECOMMIT's digest) and the re-run rule below. `summarize.py` is P-83's, for the two arms. `stream.py` is P-83's, with `loop-port.mjs`'s two digests mapped. `rows.py` and `kill.py` are new. Each arm runs the same `run.mjs` from its own tree; the P-83 arm runs from an uncommitted copy in a worktree at d70da77.
- **Reference machine:** Apple M6 Mac mini, 12 cores (2 Super, 4 Performance, 6 Efficiency), 16 GiB, Node v26.13.1, Python 3.15.2.
- **Rows:** `run.mjs <out> <stamp> row <w64|w1> <rep>`, reps 0–3. The order per rep is w64 P-83, w64 P-84, w1 P-83, w1 P-84. One row per process. A row waits for load ≤ 4 (up to 10 minutes). A row that ends above load 16 is recorded in the receipt (`loadedFirst`) and re-run once from load ≤ 4: the one harness change from P-83, whose re-run waited only for load ≤ 16 and so started at 13.
- **Safety caps**, checked before every row: stop if load stays above 16, memory pressure is critical, swap exceeds 7 GB (the round starts at about 4.9 GB), or free disk falls below 20 GB.

## Stop and rollback

- If the request stream differs, the replay's mapped rows or answers differ, any kill point loses an acknowledged effect, or any row has a wrong verdict or an error: stop and revert.
- If `loop-crash.test.mjs` fails more often on P-84 than on P-83: record `failed_with_test_concern`, and revert unless the failure is shown to be unrelated.
- If the keep bar fails: record `failed` in RESULT.md and the PR, and revert the lever on the branch.
