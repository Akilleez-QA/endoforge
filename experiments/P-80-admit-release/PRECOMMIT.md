# P-80 admit-release: the freeze releases the cell, as a model wait already does, on top of P-78: precommit

Label: **Proposed** procedure, frozen 2026-11-17 before any measurement of the lever. Round 7 of the climb loop: the objective is plumbing speed, with correctness as a light guard. **No model calls and no spending.** The model is P-73's in-process stand-in (arm A) at zero latency. Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset, and the harness asserts that at start.

This round stacks on P-78 (draft PR #180, kept, branch `climb-r5-cell-cpu`), the last kept round. P-79 (#181) failed and was reverted, so its writer change is not in either arm.

## Question

P-79's profile (on P-78's code) found the 12 cell slots bound by `admit` latency, not by work:
- cell gross utilisation 0.998, net 0.61–0.70: about 0.31 of the 12 cells sit blocked, about 48 ms per need, waiting for the host to answer `{kind: 'admit'}`;
- 45 jobs wait in the cell queue meanwhile (P-78 rows: cell wait 182–192 ms);
- the writer answers an admit in 17–37 ms of wall for about 7 ms of CPU, because the machine is full.

Under `waits: 'release'` (REQ-X1-002, the default) a cell already ends its job and parks its state when it waits for the model. The freeze is the one wait that still holds the cell. Does releasing it there too lift zero-latency throughput at width 64?

## Choosing between the two levers the round was offered

| Lever | Mechanism | End-to-end prediction at width 64 |
|---|---|---|
| (1) release the cell during `admit` | about 48 ms per need of blocked cell-slot time goes back to the queue | cell-slot ceiling rises from about 12 / (100 + 48) ms to about 12 / 100 ms (≈ 120/s); the machine then binds instead: about 123 ms of CPU per need (host 7.4, cells 101, writers 14.6 at P-78) on 12 cores of which 6 are efficiency cores, so roughly 85–90/s. **+5% to +15%** |
| (2) exact dedup of `admit`'s passes over the frozen record | about −1.2 ms CPU per admit, −2.5 ms writer CPU per need (−17%) | P-79 showed the writers are latency-bound on a full machine (1.15 of 4 cores) and that a faster admit is still inflated by contention: about −3 to −5 ms of the 48 ms blocked, and 0.2 cores freed. **+0% to +3%** |

Lever (1) predicts the larger gain and attacks the measured cause (a held slot), so this round pulls lever (1). Lever (2) stays on the list; it stacks with (1) later and is worth less once no cell waits on the admit.

## Lever (one commit)

**Under `waits: 'release'`, the specification stage's final turn ends the cell job with the admit request instead of calling the host for it** (`core/runtime/x1/loop-port.mjs`, `core/runtime/x1/loop.mjs`).

- Cell (`releasedCandidate`): when the specification stage stops, the cell writes `frozen.sha256` and hex-encodes the three frozen files as today, appends the implementation stage's prompt to its conversation (the prompt does not depend on the admission), and returns `{ waiting: state, admit: { files, implementation, oracle? } }`. The job ends with status `waiting`, and its evidence carries the admit request beside the continuation. No cell holds anything during the freeze.
- Host (`attemptAgent`): a waiting result that carries an admit request is frozen on the host by the same code that answers the host call today (moved into one function, `freeze`, used by both the `hold` path's host call and this one): the shadow-copy check of `CONTRACT.md` and `tests.json`, `testProblems`, evaluator synthesis, `admit`, `revise`, the compatibility freeze, library reuse. Then:
  - reuse granted: the attempt returns the library's reuse, as when the cell stopped with stage `reused`;
  - revision (restart): a fresh job starts the implementation stage from the corrected bundle, as before;
  - otherwise the continuation is parked (the task is now frozen) and the next model turn runs, exactly as for any later wait. The next job resumes in any free cell and `admitted()` rechecks the frozen identity, the implementation bytes and that the frozen files equal the continuation's overlay before it continues (REQ-X1-002's existing resume checks).
- One representation, no new path: the admit becomes one more released wait. The `hold` mode keeps its in-cell host call unchanged.
- Isolation: no cell ever mixes two jobs' state; the waiting job's state is the same serialized continuation a model wait parks, and it is resumed only through the existing rechecks.

Ship the check: a test in `core/runtime/test/loop-waits.test.mjs` that, under `release`, no `admit` host call reaches the pool's `hostCall` (the cell is released across the freeze), the ledger still holds `task`, `admitted_input`, `frozen_evaluator` and the attempt promotes. Traced under REQ-X1-002, whose text is extended to name the freeze.

Not changed: the gates, the freeze rule and its checks, the frozen record and its identity, the admit and park rows (same requests in the same order per need), durability, P-75 to P-78's levers.

## Predictions (P-78 arm = `climb-r5-cell-cpu` at 8f63101; P-80 arm = this branch)

- Throughput at width 64: **+5% to +15%** (P-78: 75.3–78.3 needs/s).
- Cell net utilisation at width 64: rises to within 0.10 of gross (P-78: 0.61–0.70 of 0.998), since only compile, gates and the crossing remain inside a job.
- Machine CPU at width 64: rises toward the 12 cores (P-78: 9.0–10.3 cores by role); if it does not, the gain is capped below +5%.
- `freeze` per need at width 64 (host-measured admit): not a target; it may rise up to +30% because the machine is busier.
- Wall per need at width 1: unchanged (bar: not worse than +3%).
- Correctness: identical outcome classes and proportions, 0 wrong verdicts, 0 errors.

## Oracle and keep bar

- Keep only if width-64 needs/s rises by **≥ 3% with Welch p < 0.05** over 4 + 4 interleaved rows, and width 1 is not worse than +3% wall.
- Correctness:
  - `wrongVerdicts` = 0 and `errors` = 0 on every row, and the same outcome classes on both arms;
  - **request stream**: a width-1 capture row on each arm (`capture1`); for the needs both rows completed, every `admit` and `park` request is byte-identical across arms after replacing the row's temporary directory, and every `commit` request is identical after removing timing fields;
  - the new test passes;
  - `make check` passes;
  - `make -k test`, one command per file on both arms excluding `isolate-host-call.test.mjs` (hangs on macOS), shows no failure on P-80 that P-78 doesn't have;
  - `core/runtime/test/loop-crash.test.mjs` run 4 times on each arm (P-79's flake): no more failures on P-80 than on P-78.

## Procedure

- Same harness as P-78 (`run.mjs`, copied; the only addition is the `capture1` guard plan; acceptance rows do not use `diag` or the exploratory stamp), reference machine (Apple M6, 12 cores: 2 Super, 4 Performance, 6 Efficiency; 16 GiB; Node v26.13.1; Python 3.15.2). The P-78 arm runs the same `run.mjs` from its own tree.
- `run.mjs <out> <stamp> row <w64|w1> <rep>`, reps 0–3, order per rep: w64 P-78, w64 P-80, w1 P-78, w1 P-80. One row per process; a row waits for load ≤ 4 (up to 10 minutes) and re-runs at once if it ends above 16.
- Safety caps: stop if load stays above 16, memory pressure is critical, swap exceeds 8 GB or free disk falls below 20 GB.

## Stop and rollback

- If the request stream differs, or any row has a wrong verdict or error: stop, revert.
- If `loop-crash.test.mjs` fails more often on P-80 than on P-78: record `failed_with_test_concern` and revert unless the failure is shown unrelated.
- If the keep bar fails: record `failed` in RESULT.md and the PR, and revert the lever on the branch.
