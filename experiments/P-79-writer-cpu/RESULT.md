# P-79 writer: profile each request first, then answer the request a cell holds for without waiting for its batch, on top of P-78: result

Status: **failed_with_test_concern** (prediction failed: throughput fell; the lever is reverted on the branch), 2026-11-17, reference machine (Apple M6 Mac mini, 12 cores: 2 Super, 4 Performance, 6 Efficiency; 16 GiB; Node v26.13.1; Python 3.15.2). Stand-in model only (arm A, zero latency): **no model calls, no tokens**, credential variables asserted unset. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed and pushed (e2189f0) before any acceptance row.

- Lever measured: the tree of de4babb. The receipts' `commit` field reads 886dd5a, which has the identical tree; it was reworded before the push.
- Lever reverted in a399391. The branch's product code is P-78's (8f63101).
- Receipts:
  - `receipt/accept-p78/` and `receipt/accept-p79/` (`row-{w64,w1}-{0..3}.json`);
  - `receipt/summary.json` (`summarize.py`);
  - `receipt/replay.json`;
  - `receipt/tests-p78.json` and `receipt/tests-p79.json`;
  - the profile in `receipt/explore-p78/` and `receipt/explore-p79/`.

**Width-64 throughput fell 2.9%** (77.5 → 75.3 needs/s, Welch t = −3.6, df ≈ 4.6, p ≈ 0.018), against a predicted +3% to +10%. `freeze` per need, which the lever was meant to cut by 15% to 35%, rose 14% (52.2 → 59.5 ms). The profile behind the lever was right about where the time goes: the writers are latency-bound on the admit a cell waits for, not CPU-bound. Its causal reading was wrong. Admits in larger batches are slow because those batches form when the machine is most contended, not because of the co-batched work.

## Profile first (exploratory, P-78 code)

### CPU per request

`profile.py` and `sites.py` replay 4,912 requests captured from a P-78 width-64 row through P-78's writer, one per batch: 1,563 admits, 1,786 parks and 1,563 commits across 1,563 ledgers.

| Action | CPU per request | Share of writer CPU | Where it goes |
|---|---|---|---|
| `admit` | 7.0–7.7 ms | 67% | Passes over the 422 KB frozen record (405 KB of it the 14 implementation files as hex): JSON encode 2.5 ms (6 passes), SHA-256 1.2 ms (7), JSON decode 0.9 ms (3), SQLite 1.2 ms, repository files read and hexed twice 0.43 ms |
| `commit` | 2.3–2.8 ms | 24% | The bundle decoded twice 0.44 ms, repository files 0.22 ms, chain check on read 0.15 ms, SQLite 0.41 ms |
| `park` | 0.7–0.8 ms | 8% | Chain check on read (re-hashes the 422 KB row) 0.15 ms, SQLite 0.17 ms |
| all | 3.6 ms | | 3.14 requests per need, so **11.4 ms per need** at replay |

Unbatched `F_FULLFSYNC` in replay: 3.5–3.6 ms.

### Wall per live request

`trace.py` reads a per-request timing patch to the writer (`explore-p78/trace.patch`, never committed) on exploratory width-64 rows. This table is from P-78:

| Per request | `admit` | `commit` | `park` |
|---|---|---|---|
| Applying its batch | 29.8 ms | 12.6 ms | 13.4 ms |
| Journal `F_FULLFSYNC` | 6.0 ms | 5.1 ms | 5.4 ms |
| In the writer | 37.0 ms | 19.2 ms | 20.4 ms |

- **The writers are not CPU-bound.**
  - Each writer's main thread is busy 0.48–0.52 of wall, and its syncer 0.19–0.22. Writer CPU is 1.15 cores of 4.
  - The 0.87–0.90 "utilisation" the harness reports is the share of time a request is in flight.
  - Live writer CPU is 14.7 ms per need, against the 11.4 ms replay floor (1.29×).
- **What binds is admit latency.** `admit` and `revise` are host calls from inside a cell job.
  - The cell holds its slot while it waits. Cell `blocked` time is 0.31 of 12 cells, about 48 ms per need, which matches the `freeze` bucket.
  - Meanwhile 45 jobs wait in the cell queue.
- 66% of admits share a batch, and those take 44 ms in the writer against 23 ms alone.
- Raising the writers' QoS to user-initiated changed nothing.
- Decision files are not on the path (0.1 ms).

## Lever (measured, then reverted)

`tools/ledger_writer.py` +7 and `tools/x1_loop.py` +1. The extension names `HOLDING = ("admit", "revise")`.
- With the syncer running, `Writer.batch` applies the ledger groups holding such a request first.
- It hands them to the syncer at once, then applies the rest of the batch.

Durability and order were kept:
- every answer still follows its frame's `F_FULLFSYNC`;
- groups are never split;
- the replay path is unchanged.

The test `test_a_request_a_cell_holds_for_is_synced_and_answered_before_the_rest_of_its_batch` passed, and failed against P-78's writer. It is reverted with the lever.

## Predictions against measurement (4 + 4, interleaved, one row per host process, each row started at load ≤ 4)

| Quantity | P-78 | P-79 | Predicted | Verdict |
|---|---|---|---|---|
| needs/s, width 64 | 77.60, 77.28, 76.97, 78.32 (**77.5**) | 75.25, 74.43\*, 74.75, 76.86 (**75.3**) | +3% to +10% (bar ≥ +3%, p < 0.05) | **failed** (−2.9%, p ≈ 0.018) |
| `freeze` per need, width 64 | 56.5, 54.4, 56.6, 41.1 (52.2 ms) | 61.8, 59.9, 62.5, 53.9 (59.5 ms) | −15% to −35% | **failed** (+14%) |
| `ledger` per need, width 64 | 72.8 ms | 94.7 ms | — | +30% |
| Writer CPU per need, width 64 | 14.70 ms | 14.78 ms | ±5% | met |
| Cell net utilisation / cell wait, width 64 | 0.660 / 187 ms | 0.617 / 186 ms | — | more cell time blocked |
| Wall per need, width 1 | 65.0, 64.3, 67.9, 66.8 (66.0 ms) | 66.3, 65.7, 67.0, 66.9 (66.5 ms) | unchanged (bar ≤ +3%) | met (+0.7%, p ≈ 0.6) |
| Journal syncs (trace rows) | 157/s, 1.52 requests per flush, 5.18 ms | 168/s, 1.39 requests per flush, 5.25 ms | ≤ +25%; ≤ 1.3× time | met (+7%, 1.01×) |
| Host ELU / tree RSS, width 64 | 0.418 / 5.2 GB | 0.419 / 5.2 GB | — | unchanged |

\* Row `w64-r1` ended above load 16, which was the row's own processes. The re-run started at 14.3 and also ended above 16, so the harness stopped that row. Its value (74.4) is kept, as the receipt records it. Without it, P-79's mean is 75.6 needs/s, still −2.5%.

**Why it failed** (P-79 trace row, `explore-p79/`): the admit's time to hand-off did not move.
- An admit alone: 17.0 → 17.6 ms.
- An admit with one other request: 25.0 → 25.2 ms, though the admit now ran first.
- An admit in a batch of three: 34.5 → 35.1 ms.
- So the "mixed-batch penalty" was never the co-batched requests' CPU, since a park is under 1 ms. Batches grow when the machine is busiest, and an admit applied then is slow on its own.

Meanwhile the split cost something:
- frames rose 7%;
- parks and commits waited longer in the writer (park 20.4 → 24.4 ms, commit 19.2 → 22.0 ms);
- the main thread spent longer per batch, so the next admit started later.

The precommit read a correlation as a cause.

## Correctness guard

- **Rows:** every row on both arms has `wrongVerdicts` = 0 and `errors` = 0. Both arms show the same two outcome classes, `true/true/passed/-` and `false/false/failed/-`, at 14.1–14.4% failed in every row.
- **Replay** (`replay.json`): the 4,912 requests through each arm's writer gave identical results.
  - One per batch (`rows.py`): rows `225a144f…`, answers `19c05cdd…` on both.
  - Batches of 8 with the syncer running (`batches.py`): rows `6052e46f…`, answers sorted by id `91653d27…` on both.
  - Frames in the batches-of-8 run rose 614 → 1,183, because replay batches arrive back to back.
- **`make -k test`**, one command per file on both arms. `isolate-host-call.test.mjs` was excluded on both (it hangs on macOS). Receipts: `tests-p78.json` and `tests-p79.json`.
  - 33 failing commands on P-78 against 39 on the lever.
  - **Test concern:** `core/runtime/test/loop-crash.test.mjs` failed on the lever in 2 of 4 runs and on P-78 in 0 of 4. The assertion was "round 5 finished before its kill": a timing precondition of the random-kill test, not a promotion without evidence. The lever changes when answers leave, so the concern is real for the lever and moot once it is reverted.
  - `ledger-writer.test.mjs`'s SIGKILL `half_frame` case failed on both arms in every re-run, 3 of 3 each. It is pre-existing, as in P-78; the suite run's pass on P-78 was the flake.
  - The other four new failures are artifacts of this round's uncommitted files at test time: `check-docs` (the missing RESULT.md link), `check_trace`, `experiments_index --check`, and `unittest discover` (`test_index_is_current`, `test_repository_trace_is_clean`).
- `make check` passes on the final commit.
- Not changed by the lever, nor by this round:
  - durability: `F_FULLFSYNC`, SQLite's sync settings, the frame format, recovery;
  - every validation on append, and the chain check on read;
  - park as its own checkpoint;
  - the gates, the freeze rule and the frozen record;
  - P-75 to P-78's levers. No shard was added.

## Floors against observed (zero latency; P-73's floors plus measured ones)

Width 1, per need (P-78 wall 66.0 ms):

| Bucket | Share of wall | P-78 (this round's baseline) | Physical floor | Distance |
|---|---|---|---|---|
| `compile` | 39% | 25.5 ms | not measured (AssemblyScript `-O3` through binaryen) | **unknown** |
| `crossing` | 15% | 9.7 ms | 0.06 ms of IPC; 4.1 ms with no cell replacements | **~160×** IPC; 2.4× no-replacement |
| `ledger` + `freeze` | 30% | 19.9 ms | 12.5 ms (unbatched `F_FULLFSYNC`; measured 3.5 ms per sync in replay, so 3.14 × 3.5 ≈ 11 ms) | **1.6–1.8×** |
| `gate` + `promote` | 16% | 10.7 ms | not measured | **unknown** |

Width 64, throughput resources:

| Resource | P-78 | Floor | Distance |
|---|---|---|---|
| Writer CPU per need | 14.7 ms | 11.4 ms (replay at 3.6 ms per request × 3.14) | **1.29×**; the writers are not CPU-saturated (1.15 of 4 cores) |
| Writer in-flight share | 0.85–0.90 | — | latency, not work: 37 ms per admit, against 7 ms of CPU and 6 ms of sync |
| Cell slots | 12, gross 0.999, net 0.66, queue 45 | 64 ms CPU per need (width 1, no retirement) | **binding**: 104 ms CPU per need (1.6×), plus about 48 ms per need blocked on admit |
| Machine | about 85–95% of 12 cores | 12 cores | binding |

**Stop rule not met.** `compile` and `gate` + `promote` have no measured floor, and `crossing` is far from its floor.

## Next binding ceiling and levers (ranked by this evidence)

1. **The cell slots, through admit latency.** Cells hold their slot about 48 ms per need while the writer answers an admit: 7 ms of admit CPU, inflated to 17–35 ms of wall on a full machine, plus a 6 ms sync. Candidate levers:
   - **Admit CPU, by exact deduplication.** Decode the bundle once, read the repository once (stat-checked), and hash each content once. That is about −1.2 ms per admit and −0.6 ms per commit at replay (−17% of writer CPU per need), with byte-identical rows and every validation kept.
   - **Release the cell while it waits on the host for `admit`,** as `waits: 'release'` already does for model turns. This is structural, and it changes cell-state handling.
   - **Store the 405 KB of implementation files once,** content-addressed (P-77 lever 2). Every pass over the frozen record shrinks about 25×, but row content changes, so it needs a recoverability proof.
2. **The rest of each cell start:** about 1 CPU-s per replacement, 14–18 replacements per window. Candidates are pre-warming the replacement and a V8 code cache (see P-78).
3. **Measure the `compile` floor** so the stop rule can be decided.

## Code delta

- **Product:** none net. The lever (+8 lines, plus a +20-line test and its trace entry) was committed, measured, and reverted.
- **Experiment tools** (new, exploratory):
  - `profile.py`: replay CPU per action and sync time;
  - `sites.py`: CPU and bytes by call site for JSON, SHA-256, SQLite and repository reads;
  - `trace.py`: per-request wall from the timing patch;
  - `batches.py`: replay in batches with the syncer running.
- `run.mjs`, `rows.py` and `summarize.py` are copied from P-78; only `summarize.py`'s arm names changed.

## Receipts and how to reproduce

- `run.mjs <out> <stamp> row <w64|w1> <rep>`: one acceptance row. `run.mjs <out> explore diag 64 <tag>`: an exploratory row; set `P79_TRACE=<dir>` with `explore-p78/trace.patch` applied for the timing trace.
- `rows.py <repo> <capture> <scratch> <n>` and `batches.py <repo> <capture> <scratch> <size>`: the replay digests.
- `profile.py` and `ONLY=<action> sites.py <repo> <capture> <scratch> <n>`: the CPU profile.
- `summarize.py`: the acceptance table with Welch t and p.
