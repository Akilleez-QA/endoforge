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
