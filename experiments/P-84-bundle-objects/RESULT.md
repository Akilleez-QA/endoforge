# P-84 bundle objects: the frozen record names the implementation by digest and the bytes are stored once, on top of P-83: result

Status: **kept, with a test concern recorded**, 2026-11-18. Every keep bar is met, including GitHub Linux CI on PR #186 at 74e7541 (lint, test (22), test (26), coverage, rust-lane and secret-scan green). The concern: `loop-crash.test.mjs`'s random-kill case fails its timing precondition more often on the lever (7 of 12 runs against 2 of 12). Every failure, on both arms, is the same assertion, `round 5 finished before its kill`: the round's six remaining tasks finished inside the 566 ms kill delay. It is the test's precondition, not its property, and is shown below to come from the faster writer. Whether to keep the lever with the test as it is, or to make the test's kill land inside the round, is for the owner.

Reference machine: Apple M6 Mac mini, 12 cores (2 Super, 4 Performance, 6 Efficiency), 16 GiB, Node v26.13.1, Python 3.15.2. Stand-in model only (arm A, zero latency): **no model calls, no tokens**, and the harness asserts that the credential variables are unset. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed (2f8c0ce) before the lever and before any acceptance row.

- **Lever measured:** bd4f745, pushed before the acceptance rows. 74e7541 changes only the copied profile tool (ruff).
- **Base arm:** P-83 at d70da77 (`climb-r10-gate-scans`), run from a worktree with an uncommitted copy of this folder.
- **Receipts:**
  - acceptance rows: `receipt/accept-p83/` and `receipt/accept-p84/`, summarised in `receipt/summary.json` (`summarize.py`);
  - the writer profile: `receipt/profile/`;
  - recoverability: `receipt/replay/` (`rows.py`, `kill.py`);
  - correctness: `receipt/stream.json` (from `receipt/guard-p83/` and `receipt/guard-p84/`), `receipt/tests-p83.json`, `receipt/tests-p84.json` and `receipt/reruns.json`.

**Width-64 throughput rose 13.9%**, from 84.5 to 96.3 needs/s (Welch t = 11.3, **p ≈ 0.001**), above the predicted +4% to +10%; every P-84 row beats every P-83 row. **Width 1 fell 9.4%**, from 53.9 to 48.8 ms per need (t = −9.6, p ≈ 0.0001), inside the predicted −4% to −12%. **Writer CPU per need fell 52%** (15.2 → 7.2 ms) and the writers' in-flight share fell from 0.90 to 0.67. Needs/s per GB rose 18% (16.3 → 19.2).

## Step 1: the writer profile

5,000 requests from a P-83 width-64 capture, replayed one per batch through P-83's writer (`receipt/profile/`):

| Action | CPU per request (sync on / off) | Share | Where it goes |
|---|---|---|---|
| `admit` | 7.2–7.8 / 6.5–6.8 ms | 65–69% | Passes over the 423 KB frozen record, 406 KB of it the 14 implementation files as hex: JSON encode 2.67 ms (6 passes), SHA-256 1.20 ms (7), JSON decode 0.86 ms (3), `validate_frozen` 1.54 ms inclusive, SQLite 1.25 ms, repository reads 0.46 ms |
| `commit` | 2.4–3.3 / 2.0–2.3 ms | 23–26% | The bundle decoded twice 0.43 ms, repository files 0.20 ms, chain check on read 0.15 ms, SQLite 0.38 ms |
| `park` | 0.80–0.96 / 0.61–0.66 ms | 8–9% | Chain check on read (re-hashes the 424 KB row) 0.14 ms, SQLite 0.15 ms |

Every pass was over the same 406 KB of the repository's own files, identical in every need, and the same record crossed into the cells and the host (`verifyFromMemory`). Deduplicating passes ((b), (c)) would leave each remaining pass at 423 KB, so (a) was chosen: it shrinks every pass.

## The lever

- An admission by digest freezes `{files, implementation, configuration, residual, invariant_version}`: `implementation` maps each of the 14 names to the SHA-256 of its bytes, checked against the repository file first (as in P-77).
- `store_objects` writes each file once to `<journal directory>/objects/<sha256>`: staging file `F_FULLFSYNC`ed, linked, directory synced. It runs in `apply`, before the record is appended and before the batch reaches the syncer, so every object is durable before the frame that acknowledges the admit.
- `admission` answers with the record itself as the frame (`elided: []`); `frozen_drift` compares digests; `revise` carries them; `inflated` rebuilds the full P-83 bundle, checking every object.
- `validate_frozen` accepts the map (non-empty, valid names, lowercase 64-hex, disjoint from `files`). The cell's drift check compares digests. Records frozen from a tree, and records written before this round, are served and verified as before.
- Not changed: `F_FULLFSYNC` per journal frame, SQLite's sync settings, the frame format, recovery, every validation on append, the chain check on read, the identity scheme, the gates, the freeze rule, REQ-ISO-016, the cell count, the four writers.

## Predictions against measurement

4 + 4 interleaved rows, one per host process, each started at load ≤ 4.

| Quantity | P-83 | P-84 | Predicted | Verdict |
|---|---|---|---|---|
| needs/s, width 64 | 83.09, 82.69, 87.09\*, 85.16 (**84.5**) | 96.27, 96.57, 95.62, 96.56 (**96.3**) | +4% to +10% (bar ≥ +3%, p < 0.05) | **met, above the range** (+13.9%, t = 11.3, p ≈ 0.001) |
| Writer CPU per need, width 64 | 15.2 ms | **7.2 ms** | 6–9 ms | met (−52%) |
| Writer in-flight share | 0.899 (0.882–0.920) | **0.665** (0.651–0.689) | 0.55–0.80 | met |
| All CPU per need, width 64 | 123.0 ms (host 5.9, cells 102.0, writers 15.2) | 111.3 ms (host 5.3, cells 98.8, writers 7.2) | 112–120 ms | met (−9.5%) |
| Cells + host CPU per need | 107.8 ms | 104.1 ms | −1 to −4 ms | met (−3.7 ms) |
| Cores by role, width 64 | 10.39 (cells 8.62, writers 1.28) | 10.71 (cells 9.51, writers 0.70) | — | the freed writer cores went to the cells |
| `freeze` + `ledger` per need, width 64 | 128.3 + 174.7 = 303 ms | 51.4 + 73.3 = 125 ms | −20% to −50% | **beyond** (−59%) |
| Cell net utilisation / queue wait, width 64 | 0.922 / 100 ms | 0.988 / 131 ms | — | cells now saturated |
| Wall per need, width 1 | 54.5, 53.4, 54.3, 53.3 (**53.9 ms**) | 48.9, 49.9, 48.7, 47.8 (**48.8 ms**) | −4% to −12% (bar ≤ +3%) | **met** (−9.4%, t = −9.6, p ≈ 0.0001) |
| CPU per need, width 1 | 69.0 ms (writers 8.75) | 62.2 ms (writers 3.93) | — | −9.9% |
| `freeze`, width 1 | 9.4 ms | 5.2 ms | — | −44% |
| Tree RSS (window end), width 64 | 5.17 GB | 5.01 GB | −0% to −10% | met (−3.2%) |
| needs/s per GB, width 64 | 16.34 | **19.23** | must not fall | **met** (+17.7%) |
| Writer replay CPU per request (`rows.py`, sync on) | 2.76 ms (admit 5.80, commit 2.09, park 0.67) | 1.00 ms (admit 1.22, commit 1.44, park 0.44) | — | −64% |
| Frozen record / journal bytes for 5,000 requests | 434 KB / 935 MB | 18.6 KB / 267 MB | — | −96% / −71% |

\* P-83's `w64-r2` first ended at load 16.7 (83.65 needs/s), from its own cells. It is kept in the receipt (`loadedFirst`) and was re-run from load 3.4 under this round's rule (P-83's rule re-ran from load 13). Using the first run instead, P-83's mean is 83.6 and the gain is +15.1%.

- **Why it beat the prediction:** the model credited only the writers' and cells' CPU. The writers' admit latency also fell (`freeze` −60%), so the cells spend less of each job blocked, and the cores the writers gave back (1.28 → 0.70) went to the cells (8.62 → 9.51).
- **Per sampled-peak GB:** the sampled peak rose from 5.44 to 5.90 GB, so needs/s per peak GB went from 15.5 to 16.3 (+5%). The peak is the noisiest number in these receipts; the keep bar uses the precommitted window-end measure.

## Durability and recoverability

- **Durability is unchanged:** every journal frame is still `F_FULLFSYNC`ed before its answers leave; SQLite's settings, the frame format and recovery are untouched. The one new write, an object, is synced (file, then directory) on the main thread before the record that names it is appended, so it is durable before the frame that acknowledges it. An object is never rewritten, and each process makes a present object's directory entry durable once before it relies on it.
- **Replay** (`receipt/replay/rows-p8{3,4}.json`): the 5,000 captured requests through each arm's writer, P-84 with P-83's `x1` files so the digests match, translating later requests' identity and digest as the admits answer. P-84's rows, mapped back (each frozen record inflated from the store, identities, digests and chain hashes substituted, every chain hash and decision seal recomputed), give **rows `7c2fe7d4…`, the same as P-83's**, across `records`, `x1_continuations` and `x1_decisions` in 1,607 ledgers; the answers, mapped the same way, give **`f13f81f7…` on both**. 0 errors on both, 5,000 journal versions on both, and all 14 objects verify against their names.
- **Kill at each frame** (`receipt/replay/kill-p8{3,4}.json`): a writer process replays the first 160 requests and is `SIGKILL`ed after every second acknowledged frame (80 points, 0–6 ms delays), three ways: plain; with every ledger's WAL deleted, so recovery replays the journal; and with the WAL deleted and half a frame appended (a torn tail). 240 runs per arm and 19,200 acknowledged effects checked: **0 missing, 0 conflicts on both arms**, 80 torn tails quarantined on each, ~12,900 frames replayed on each. On P-84 every acknowledged frozen record passes the chain check and validation on read and inflates from the store.
- **Unit tests** (new): the record holds digests and inflates byte for byte to the payload freeze; objects are stored once; a tampered object never inflates; a changed repository file is drift; a writer killed after an admit, with the WAL lost, recovers from the journal a record that inflates from the store; malformed digest bundles are refused on append; an admission by digest verifies in the cell, and three forgeries are refused.

## Correctness guard

- **Rows:** every row on both arms has `wrongVerdicts` = 0 and `errors` = 0, with the same two outcome classes (`true/true/passed/-`, `false/false/failed/-`).
- **Request stream** (`stream.json`, width-1 capture rows): for the 222 needs both rows completed, all 222 `admit`, 253 `park` and 222 `commit` requests are identical, 0 differ, with `loop-port.mjs`'s two digests and the frozen identity mapped.
- **Suite,** one command per file on both arms, `isolate-host-call.test.mjs` excluded on both: **no failure on P-84 that P-83 does not have** (41 failing commands and 95 named failing tests on P-84, 44 and 97 on P-83, all pre-existing). P-83's three extra (`experiment_id.py check`, `experiments_index --check`, `unittest discover`'s allocation and index tests) are artefacts of the uncommitted folder in its worktree.
- **`ledger-writer.test.mjs`,** 4 runs per arm: its SIGKILL `half_frame` case failed 2 of 4 on P-83 and 3 of 4 on P-84; every other case passed every run. That case is the known macOS flake, failing on both arms; the round's own kill runs above pass on both.
- **`loop-crash.test.mjs`,** 12 runs per arm (`reruns.json`): the random-kill case failed **2 of 12 on P-83 and 7 of 12 on P-84**. All 9 failures are the same assertion, `round 5 finished before its kill`, under the test's fixed seed: round 5 kills the supervisor 566 ms after task 1 of 7, and the six remaining tasks, each a few ledger round trips, now finish inside that delay more often. Rounds 0–4, which check that no kill yields a promotion without its evidence, passed in every run on both arms. The case passes in GitHub Linux CI. So the extra failures come from the faster writer meeting a timing precondition, not from a promotion without evidence. But in those runs rounds 5–7 go unchecked on macOS, which is a real loss of coverage. That is the test concern above.
- `make check` and `make lint` pass on the lever, including `check_comments` (0 comment lines).

## Floors against observed (zero latency, P-84)

Width 1, per need (wall 48.8 ms):

| Bucket | Share | Observed | Floor | Distance |
|---|---|---|---|---|
| `compile` | 52% | 25.5 ms | 20.9 ms (P-83) | **1.22×** |
| `ledger` + `freeze` | 32% | 15.6 ms | about 11 ms (3.11 requests × 3.6 ms unbatched `F_FULLFSYNC`) | **1.4×** |
| `gate` | 7% | 3.4 ms | 2.8 ms | 1.2× |
| `crossing` | 5% | 2.5 ms | 4.1 ms (P-78) | ≤ 1× |

Width 64, throughput resources:

| Resource | P-84 | Floor | Distance |
|---|---|---|---|
| Cell slots | net 0.988; 131 ms queue wait | — | saturated |
| Machine CPU | 10.7 cores, 111 ms per need | 62 ms per need (width 1) | **1.79×** |
| Cell CPU per need | 98.8 ms | 55.3 ms (width 1) | **1.79×** |
| Ledger writers | 0.665 in flight, 7.2 ms CPU per need | 3.1 ms per need (replay, 1.00 ms × 3.11) | 2.3× CPU; no longer near the ceiling |

**The stop rule's floor condition is not met.** At width 1 every bucket of 5% or more is now within 1.5× of its floor (`ledger` + `freeze` 1.8× → 1.4×), but at width 64 machine CPU per need is 1.79× its width-1 value. **The stuck condition is not met:** this round gained +13.9% and P-83 +3.9%.

## Next binding ceiling

1. **The machine's capacity, through cell CPU per need at width 64** (98.8 ms, 1.79× width 1), now with the cells saturated (net 0.99). In order:
   - replacements: about 22 ms per need under load; removing them needs the owner's decision on REQ-ISO-016's interval;
   - `compile`: 20.9 ms at floor speed, 52% of width-1 wall; it needs the compiler's internals;
   - the rest of the cell's per-job work.
2. **The writers are out of the way** (0.67 in flight, 0.70 cores). Their remaining CPU per need is 2.3× replay; `commit` (1.4 ms in replay) is now the largest action.
3. **`loop-crash.test.mjs`'s fixed kill delays** assume a slower ledger. Making each round's kill land inside the round (for example, relative to its remaining tasks) would restore rounds 5–7 on macOS. It is a test change, so it waits for the owner.

## Code delta

- **Product:** `tools/x1_loop.py` +70 −7 (the store, `inflated`, digest admission, drift and revise); `core/ledger/frozen.py` +20 −7 (the optional `implementation` map); `core/runtime/x1/loop-port.mjs` +2 −2 (the drift check). No new option, process or language crossing; one new durable directory (`objects/` beside the journal).
- **Tests:** `tools/test_x1_handles.py` (+4 tests, one replaced), `core/ledger/test_frozen.py` (+1), `loop.test.mjs` (+1). Docs: `core/runtime/README.md`, the verification matrix; `sources/SHA256SUMS` regenerated.
- **Experiment tools:** `run.mjs` (P-83's, with the re-run from load ≤ 4), `summarize.py`, `stream.py` (P-83's, `loop-port.mjs` mapped), `rows.py` and `kill.py` (new), and P-79's `profile.py` and `sites.py` in `receipt/profile/`.

## Reproduce

- `run.mjs <out> <stamp> row <w64|w1> <rep>`; `run.mjs <out> explore capture` (width-64 capture); `run.mjs <out> <stamp> capture1`.
- `rows.py <repo> <capture> <scratch> <n> [--objects] [--sync]`: replay, CPU per action, and the mapped rows and answers digests. For P-84, `<repo>` is P-84's tree with P-83's `core/runtime/x1`.
- `kill.py <repo> <capture> <scratch> 160 2 [--objects]`: the kill-at-each-frame proof.
- `summarize.py`; `stream.py <capture P-83> <capture P-84>`.
