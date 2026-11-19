# P-85 physics floor: the random-kill test kills inside its round, and the machine's capacity for this work sets the width-64 floor, on top of P-84: precommit

Label: **Proposed** procedure, frozen 2026-11-18 before any measurement of this round. Round 12 of the climb loop: the objective is plumbing speed, with correctness as a light guard. **No model calls and no spending.** The model is P-73's in-process stand-in (arm A) at zero latency. Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset.

This round stacks on P-84 (draft PR #186, kept with a test concern), at `climb-r11-bundle-objects` e80094b. Its question is whether the loop has reached the limits of physics on this machine: the stop rule needs a physical floor for throughput at width 64, and P-84's RESULT compared width 64 only with width 1 (CPU per need 1.79×), which counts the machine's 12 unequal cores as 12 equal ones.

Reference machine: Apple M6 Mac mini, 12 cores (2 Super, 4 Performance, 6 Efficiency), 16 GiB, Node v26.13.1, Python 3.15.2.

## Part A: the random-kill case kills inside its round (one commit, test only)

`core/runtime/test/loop-crash.test.mjs`'s case `bridge and supervisor kills at random times never yield a promotion without its evidence` waits for task `after` of `after + 6` and then sleeps a fixed `floor(random() × 600)` ms before the kill. P-84's faster ledger finishes the round's six remaining tasks inside that delay (round 5: 566 ms), so the precondition `round 5 finished before its kill` fails (7 of 12 runs on P-84, 2 of 12 on P-83) and rounds 5–7 go unchecked.

- **Change:** the kill is placed by observed in-round events, not by wall-clock time. The test waits for task `after` to be logged, times task `after + 1` from its log line, then kills `floor(at × span)` ms into task `after + 2` (`at` is the same seeded draw that set the old delay, divided by 600), or at once when task `after + 2` is logged, whichever comes first. At least four of the round's tasks remain at every kill, on any machine speed. The log is polled every 2 ms instead of 20 ms.
- **Not changed:** every assertion (`finished before its kill`, the process to kill, the kill signal, the per-ledger record sets, promote ⇒ passed, the replayed promotion, at least one promoted line), the seed, the number of rounds, which process each round kills, and `after`. Two assertions are added: the round has not ended before tasks `after` and `after + 1`.
- **Prediction:** 12 of 12 local runs pass on P-84's code, every round of every run kills while the driver is still running (96 of 96), and the case passes on GitHub Linux CI (test (22), test (26), coverage).

## Part B: the machine's capacity for the cell's work (measurement only)

`capacity.mjs` runs N independent warm copies of the cell's per-need work in N processes: one `asc.main` compile with the cell's flags (`x1Flags`) and two `runGates` runs (the cell's two gate runs per need) on the cell's files, cycling through the 21 corpus kernels, with no ledger, isolation, permission model or cell protocol (P-83's `floor.mjs` loop). Each process starts at a common time after a warm-up, and counts only the jobs between its first and last job boundary inside the window. It reports aggregate jobs/s, CPU per job (all threads, from `process.cpuUsage`), and per-job compile and gate wall. User-level APIs only: no system settings, no sudo; QoS through `taskpolicy` on its own children.

- **Rows:** N = 1, 2, 4, 6, 8, 10, 12 at default QoS; N = 12 beside the measured non-cell load of P-84 at width 64 (the host's 0.51 cores and the four writers' 0.69: one duty-cycled hashing process at 0.51 and four at 0.17); N = 1 and N = 6 under `taskpolicy -b` (background: efficiency cores, clamped), and N = 1 under `taskpolicy -c utility`. N = 14 only if swap stays below 6 GB. Warm-up 12 s, window 40 s.
- **Interleaving and same-session reference:** two passes, the second in reverse order of N. Each pass also runs one P-84 width-64 row and one P-84 width-1 row with P-84's `run.mjs` from a worktree at e80094b, so the floor and the observed rate come from the same session. Every row starts at load ≤ 4; a row ending above load 16 is re-run once from load ≤ 4. Safety caps before every row: memory pressure not critical, swap below 7 GB, free disk at least 20 GB.

### Derivation, fixed before the data

- J_N = aggregate jobs/s at N; c_N = CPU per job at N. **Effective capacity** S_N = J_N / J_1, in single-job-at-width-1-speed units. **Inflation** φ_N = c_N / c_1.
- **Width-64 throughput ceiling:** X* = S / C₁, where C₁ is P-84's width-1 CPU per need (all roles; the mean of P-84's four acceptance rows and this round's two P-84 width-1 rows) and S = max(S_12 + the load's cores, max over N of S_N). The larger of the two is used, so the ceiling errs high and the verdict errs toward "not yet at the limit".
- **P-84's fraction of the ceiling:** X ÷ X*, with X the mean of P-84's four acceptance rows and this round's two width-64 rows (reported separately too). It factors into core occupancy (cores used ÷ 12) and the excess inflation R = CPU per need at width 64 ÷ (C₁ × φ at matching load).
- **Width-64 per-bucket distances (the stop rule's floor condition at width 64).** At width 64 the loop is closed with 64 needs in flight, so its wall per need is 64 / X by Little's law, and a bucket that is queueing (`crossing`'s wait for a cell slot, a request waiting in a writer batch) has no floor of its own: shrinking it moves the wait elsewhere unless the binding resource does less work. So the condition is judged on resources:
  1. throughput: X* / X;
  2. CPU per need by role, for each role that is at least 5% of CPU per need at width 64 (cells, writers; the host is reported too): observed ÷ (the role's width-1 CPU per need × φ at matching load).
  - Wall buckets at width 64 of at least 5% of wall are reported against floors scaled by the probe: `compile` and `gate` against the probe's per-job wall at N = 12 beside the load; `crossing`, `ledger` and `freeze` against 64 / X* times their width-1 share (Little's law at the ceiling). These are diagnostics, not the condition.
- **Predictions:** S_12 between 6.0 and 8.5 (2 Super + 4 Performance + 6 Efficiency, less shared-cache, bandwidth and thermal loss); φ_12 between 1.4 and 2.0; X* between 96 and 137 needs/s; P-84 at 0.70–1.00 of X*; R between 0.9 and 1.3; every resource distance ≤ 1.5×, so **the stop rule's floor condition is predicted met at width 64**. The probe's per-job compile wall at N = 12 beside the load: 30–45 ms against P-84's 79 ms per need at width 64 (predicted 1.7–2.6×, attributed to waiting for a core among more runnable threads than cores; tested by N = 14, if run, and by the CPU-by-role distance).

## Part C: one lever, only if Part B shows headroom

- **Trigger:** X* / X > 1.5, or the CPU distance of a role at 5% or more of CPU per need exceeds 1.5×. Otherwise Part C is "none".
- **If triggered:** one lever, picked by predicted gain from the measured gap, precommitted in an addendum committed before its rows, and run as P-84's 4 + 4 acceptance (P-84's `run.mjs` and keep bar: width-64 needs/s +3% with Welch p < 0.05, width 1 not worse than +3%, needs/s per GB not lower, the correctness guard, CI green). Never REQ-ISO-016's interval, the gates, the freeze rule or durability.
- **Prediction:** not triggered.

## Correctness guard (both arms: P-84 at e80094b, P-85 at this branch's head)

- No product code changes in Parts A and B; the guard is run anyway.
- `wrongVerdicts` = 0 and `errors` = 0 on every row, with the same outcome classes on both arms.
- **Request stream:** one width-1 capture row per arm (`capture1`, P-84's `stream.py`): every `admit`, `park` and `commit` request identical for the needs both completed.
- `make -k test`, one command per file on both arms (`filetests.py`), `isolate-host-call.test.mjs` excluded on both: no failure on P-85 that P-84 does not have.
- `make check` and `make lint` pass, including the no-comments check.
- `loop-crash.test.mjs`, 12 runs on P-85: 12 of 12 pass (Part A).

## Stop and rollback

- If Part A's case fails locally or on CI, or any assertion is shown weakened: fix the test before anything else; it is not reported as fixed until 12 of 12 locally and CI pass.
- Any wrong verdict, error, differing request stream or new suite failure: stop and revert to P-84.
- A safety cap hit stops the rows; the round reports what it has.
