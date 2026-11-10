# P-65 amendment 1: the ledger verifiers pinned the gate set

Written 2026-11-07 after the first U2 run was stopped, before any amended arm ran. [PRECOMMIT.md](PRECOMMIT.md) is unchanged (sha256 6e235129…).

## What happened

U2 started at 18:29 on the precommitted tree (`e965cb5`). Its control arm promoted 0 of 177 pristine kernels, every one `gates_passed_decision_refused`. Offline, G9 refused none of them. The run was stopped before any sampled or glue row was read.

Cause: `tools/x1_loop.py` and `tools/library_verify_promotion.py` verify a promotion by requiring the report's gate set to equal a fixed set (G1 to G8). A report carrying `G9_units` fails that equality, so the ledger refuses every promotion. When G8 landed (`a162dd6`) it was added to both sets in the same commit; the precommitted tree missed this.

## Change

`G9_units` is added to both sets. No rule, threshold or gate behaviour changes.

## Rows

| Row | Tree | What ran | Pristine |
|---|---|---|---|
| U2 frozen | `e965cb5` | control only, then stopped | 0 / 177 (ledger refused every promotion) |
| U2a, U1a | this amendment's commit | the precommitted arms, unchanged otherwise | |

Predictions and bars apply to U2a and U1a.

# P-65 amendment 2: width 6 at the coordinator's request

Written 2026-11-07 at 19:00, mid-U2a, before any sampled or glue row was read.

Machine load reached 36 to 39, above heavy-run's cap of 28, and this arm's workers were the top CPU users. That pushed the concurrent timing lanes (P-61, P-62, P-64) into loaded rows. The coordinator asked for this arm's concurrency to be capped at about 6. U2a was stopped at 2,929 of 10,416 sampled rows (control complete, 177 of 177 promoted) and resumed at `P51_WIDTH=6` (`P65_WIDTH=6`). P-51's harness skips rows already written and clears a row's directory before rerunning it, so no row is judged twice. U1a runs at width 6 too.

Width sets how many candidates are in flight. It doesn't change any gate, evaluator or recorded reply, so escape counts are comparable with S2a at width 14. The pipeline's stage timings from U2a are loaded either way and aren't acceptance figures. Bar 4 (G9 cost) is taken from a separate short offline run at load 16 or below.

# P-65 amendment 3: run.sh names the amended rows

Written 2026-11-09 after the round-8 backfill review (R10). No row, figure or verdict changes.

[run.sh](run.sh) still took the step names `U1` and `U2` and wrote `$P65_OUT/U1` and `$P65_OUT/U2`, while [analyze.mjs](analyze.mjs) reads `U1a` and `U2a`. Those are the rows that amendment 1 makes the measured arms, and the ones hashed in [receipt/outside-git.sha256](receipt/outside-git.sha256). A rerun from the script would have written rows the analysis never read, and the analysis would have reported 0 of 0. The steps are now `U1a` and `U2a`. An unknown or missing step exits 2 with a usage line. [analyze.test.mjs](analyze.test.mjs) runs both steps against a stub P-51 harness, then runs `analyze`, and checks that it counts the rows they wrote.
