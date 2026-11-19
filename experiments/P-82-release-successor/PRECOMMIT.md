# P-82 release-successor: the freeze releases the cell, and a retiring cell's successor warms as a standby with one primer round, on top of P-78: precommit

Label: **Proposed** procedure, frozen 2026-11-18 before any measurement of the lever. Round 9 of the climb loop: the objective is plumbing speed, with correctness as a light guard. **No model calls and no spending.** The model is P-73's in-process stand-in (arm A) at zero latency. Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset, and the harness asserts that at start.

This round stacks on P-78 (draft PR #180, kept), at `climb-r5-cell-cpu` 48cd38f, which is P-78 (8f63101) plus the merged CI fixes for P-76 to P-78. P-79 (#181), P-80 (#182) and P-81 (#183) failed and were reverted; none is in the base arm.

## Question

On P-78 the machine does not bind on CPU (9.7 of 12 cores, P-81). The 12 cell slots bind: they are 0.998 occupied but do cell work only 0.66 of the time, held about 48 ms per need on `admit` (P-79/P-80), and the four ledger writers run at 0.87–0.91 in-flight utilisation. Two levers each acted on one hold of the same slot and each fell just short of the bar alone:

- P-80, `waits: 'release'` for the freeze (10c0cac): +3.8% at width 64 (p ≈ 0.058); cell net utilisation 0.64 → 0.96; cores 9.7 → 10.6 and CPU per need +6% (contention); width 1 unchanged.
- P-81, a standby successor started within 32 jobs of retirement, plus 1 primer round instead of 8 (6af4a68): +3.1% at width 64 (p ≈ 0.093); cell CPU −1.4%; width 1 −9.3% (p ≈ 0.0001); per GB −1.7%.

Does the two together clear the bar: release takes `admit` off the slot, and the successor takes the warming replacement off the slot and cuts the start CPU that release's extra contention exposes?

## Lever (one commit)

The two measured commits re-applied unchanged on 48cd38f (only `sources/SHA256SUMS` regenerated):

1. `core/runtime/x1/loop-port.mjs`, `core/runtime/x1/loop.mjs` (P-80): under `waits: 'release'` the cell's specification stage ends its job with the admit request beside its continuation; the host freezes with the same function that answers `hold`'s host call, parks the continuation, and the next job rechecks the admission through the existing resume checks. `hold` is unchanged. Test: `the freeze holds no cell under release, and holds it under hold` (`loop-waits.test.mjs`).
2. `core/runtime/isolate-pool.mjs` (P-81): a cell within 32 jobs of `retireAfterJobs` starts its successor as a standby; one standby at a time; a standby takes no job; when the cell retires, the standby takes its slot at once and the retiring cell spawns nothing; a standby that exits first is not respawned. `core/runtime/x1/loop-port.mjs`: `warm`'s default `primes` 8 → 1. Test: `the successor of a retiring cell warms as a standby, ...` (`isolate-flags.test.mjs`, REQ-ISO-016).

Not changed: `retireAfterJobs` (256) and REQ-ISO-016 (no cell runs more than 256 jobs; a standby runs none before it takes the slot), process isolation and the permission flags, the guard, the gates, the freeze rule and its checks, the frozen record, the rows, durability (every answer after its frame's `F_FULLFSYNC`), park as its own checkpoint, P-75 to P-78's levers. No new option.

## Predictions (P-78 arm = 48cd38f; P-82 arm = this branch's lever commit)

- **Throughput at width 64: +5% to +10%.** Reasoning: P-80's +3.8% was capped by CPU contention once the slots were freed (10.6 cores); P-81's slot effect is mostly redundant once release frees the slots, so its contribution under release is its CPU cut (primer, about 1.5 ms of cell CPU per need) and the warming hold that release does not touch. Additive would be about +7%; the range allows sub-additivity down to +5% and a little synergy up to +10%.
- Cell net utilisation at width 64: ≥ 0.90 (P-80 arm: 0.96).
- Cores at width 64: rise toward 10.5–11; all CPU per need within +6% of P-78 (P-80 alone: +6%).
- **Width 1: wall per need −4% to −10%** (P-81's −9.3%; P-80 neutral at width 1). Bar: not worse than +3%.
- Tree RSS at width 64 rises (P-80 +14%, P-81 +5%); **needs/s per GB must not fall** (this is a keep condition; it is at risk).
- **Writers:** release moves `admit` waits out of the cells, so the writers see the same requests faster. Predicted: ledger stage utilisation stays at or below 0.95 mean and `freeze` per need rises (P-80: 56 → 111 ms). If mean writer utilisation exceeds 0.95, or the stage verdict names `ledger` with writer CPU per need up more than 10%, the RESULT says the writers have become the binding ceiling.
- Correctness: identical outcome classes and proportions, 0 wrong verdicts, 0 errors.

## Decomposition (exploratory, not acceptance)

Two single-lever arms run in the same interleaving at width 64 only, 4 rows each: **P-80 only** (10c0cac on 48cd38f) and **P-81 only** (6af4a68 on 48cd38f, sums regenerated). They are not part of the keep decision. The RESULT reports each lever's gain against this round's P-78 rows and the interaction: combined gain minus the sum of the two single gains, with its Welch-style standard error. These arms run from uncommitted worktrees, and their receipts name the base commit with the lever diff applied.

## Oracle and keep bar

- **Keep only if all hold:**
  - width-64 needs/s rises by at least +3% with **Welch p < 0.05** over 4 + 4 interleaved rows;
  - width-1 wall per need is not worse than +3%;
  - needs/s per GB (mean needs/s ÷ mean tree RSS) does not fall;
  - the correctness guard below holds;
  - GitHub CI (Linux: lint, test (22), test (26), coverage) is green on the PR.
- **Correctness guard:**
  - `wrongVerdicts` = 0 and `errors` = 0 on every row, and the same outcome classes on both arms;
  - **request stream**: a width-1 capture row on each arm (`capture1`, P-80's `stream.py`). For the needs both rows completed, every `admit`, `park` and `commit` request is identical across arms after P-80/P-81's substitutions (the row's temporary directory; wall-time fields, cell pids and the evaluator digest in `commit`). `loop-port.mjs` is one of the 14 frozen implementation files and the lever changes it, so its digest and the frozen identity derived from the record differ by construction and are mapped;
  - both new tests pass, and the guard's rewrite pin (`isolate-wasm-rewrite.test.mjs`) passes;
  - `make check` passes;
  - `make -k test`, one command per file on both arms, excluding `isolate-host-call.test.mjs` on both (it hangs on macOS): no failure on P-82 that P-78 does not have;
  - `core/runtime/test/loop-crash.test.mjs` run 4 times on each arm: no more failures on P-82 than on P-78. The counts are reported.

## Procedure

- Harness: P-81's `run.mjs`, unchanged apart from its location (it checks this PRECOMMIT's digest); `summarize.py` extended to four arms, writer utilisation, tree RSS and per GB; `stream.py` with the lever's `loop-port.mjs` digest. Each arm runs the same `run.mjs` from its own tree (the P-78 and single-lever arms from uncommitted copies).
- Reference machine: Apple M6 Mac mini, 12 cores (2 Super, 4 Performance, 6 Efficiency), 16 GiB, Node v26.13.1, Python 3.15.2.
- `run.mjs <out> <stamp> row <w64|w1> <rep>`, reps 0–3. Order per rep: w64 P-78, w64 P-82, w64 P-80 only, w64 P-81 only, w1 P-78, w1 P-82. One row per process; a row waits for load ≤ 4 (up to 10 minutes) and re-runs at once if it ends above 16.
- Safety caps, checked before every row: stop if load stays above 16, memory pressure is critical, swap exceeds 7 GB (the round starts at about 5.0 GB), or free disk falls below 20 GB.

## Stop and rollback

- If the request stream differs, or any row has a wrong verdict or an error: stop, revert.
- If `loop-crash.test.mjs` fails more often on P-82 than on P-78: record `failed_with_test_concern` and revert unless the failure is shown unrelated.
- If the keep bar fails: record `failed` in RESULT.md and the PR, and revert the lever on the branch.
