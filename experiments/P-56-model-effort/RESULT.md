# P-56 model and effort through the in-isolate loop: result

Status: **Recorded**, 2026-11-07, 00:21–02:07 EST, Claude Code 2.1.319, Node v26.13.0, the P-50 agent loop at `9f37c3e` plus reporting-only changes, one subscription account. Precommit: [PRECOMMIT.md](PRECOMMIT.md), hash chain in [receipt/precommit.sha256](receipt/precommit.sha256) (`2bee25bd…` original, `78c124f6…` amendment 1, `70341c45…` amendment 2, which the main run checked).

**The decision rule recommends `sonnet-low`**: Sonnet 5.5 at low effort, 27.4 s of wall time per accepted capability, against 49.6 s for `opus-high`. Six of eight arms are good enough; both Haiku arms fail on quality. The three fastest good-enough arms, `sonnet-low`, `opus-low` and `sonnet-medium`, can't be told apart on speed with one rep (paired bootstrap over needs, 95% intervals of about ±6 s around differences of 1–2 s), and the tie went to cost under the rule. What is clear is that effort above low or medium bought nothing measurable here: `opus-medium`, `sonnet-high` and `opus-high` accepted 30 of 30, as did `sonnet-medium`, and took 10–21 s more per capability.

## Main run, 30 needs × 8 arms × 1 rep

Receipts: [rows](receipt/rows.jsonl), [analysis](receipt/main/analysis.json), [console](receipt/main/console.txt), [environment](receipt/main/environment.json). Accepted means promoted by the unchanged gates and, for H needs, clean on the held-out tests. Seconds per accepted is the sum of wall time over all 30 runs of the arm, failures included, divided by accepted.

| Arm | Accepted | First pass | Failed candidates (per accepted) | Check rounds after the first | Escapes / H promoted | s per accepted | Wall p50 / p95 s | Model p50 s | Non-model p50 / p95 s | Turns p50 | Output tokens p50 | List-equivalent $ | Gates (Q/E/F) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `haiku-low` | 25/30 (83%) | 77% | 2 (0.08) | 0.10 | 0/7 | 38.4 | 28.7 / 56.9 | 28.2 | 0.32 / 0.54 | 2 | 6284 | 0.17 | **fail** / pass / pass |
| `haiku-high` | 25/30 (83%) | 83% | 0 (0.00) | 0.00 | 0/7 | 81.7 | 64.9 / 106.0 | 64.6 | 0.29 / 0.59 | 2 | 15716 | 0.35 | **fail** / pass / pass |
| `sonnet-low` | 28/30 (93%) | 93% | 12 (0.43) | 0.47 | 0/10 | **27.4** | 24.0 / 42.7 | 23.4 | 0.30 / 0.49 | 2 | 3376 | 1.73 | pass / pass / pass |
| `sonnet-medium` | 30/30 (100%) | 93% | 3 (0.10) | 0.37 | 0/10 | 29.0 | 27.1 / 37.0 | 26.6 | 0.30 / 0.56 | 2 | 3850 | 2.00 | pass / pass / pass |
| `sonnet-high` | 30/30 (100%) | 97% | 1 (0.03) | 0.60 | 0/10 | 46.0 | 44.1 / 69.2 | 43.7 | 0.32 / 0.52 | 3 | 6163 | 3.05 | pass / pass / pass |
| `opus-low` | 29/30 (97%) | 97% | 6 (0.21) | 0.70 | 0/10 | 28.6 | 27.3 / 38.0 | 27.0 | 0.29 / 0.50 | 3 | 3066 | 3.24 | pass / pass / pass |
| `opus-medium` | 30/30 (100%) | 100% | 0 (0.00) | 0.40 | 0/10 | 39.5 | 35.6 / 64.7 | 35.4 | 0.33 / 0.56 | 2 | 4173 | 4.41 | pass / pass / pass |
| `opus-high` | 30/30 (100%) | 97% | 1 (0.03) | 0.30 | 0/10 | 49.6 | 43.6 / 89.8 | 43.3 | 0.31 / 0.66 | 2 | 5149 | 5.24 | pass / pass / pass |

Decision, as fixed: best accepted rate 100%, so quality needs 90%; lowest escape rate 0, so escapes need at most 5%; lowest failed candidates per accepted 0, so at most 0.5. Good enough, fastest first: `sonnet-low` 27.4, `opus-low` 28.6, `sonnet-medium` 29.0, `opus-medium` 39.5, `sonnet-high` 46.0, `opus-high` 49.6. The first three are within 10%, and the tie goes to list-equivalent cost per accepted capability: `sonnet-low` $0.062, `sonnet-medium` $0.067, `opus-low` $0.112. **Recommended: `sonnet-low`.**

"Check rounds after the first" counts every check after the first, passing ones included: a model that checks, then finishes in a later turn, is checked again. Repair proper is the failed-candidate column.

Paired bootstrap over the 30 needs (5,000 resamples), difference in seconds per accepted: `sonnet-low` − `sonnet-medium` −1.6 [−6.4, 5.2]; `sonnet-low` − `opus-low` −1.2 [−7.6, 6.0]; `sonnet-medium` − `opus-low` 0.4 [−5.0, 4.8]; `sonnet-low` − `opus-medium` −12.0 [−16.9, −5.7]. This wasn't precommitted and doesn't change the decision; it says how much the ranking among the first three can be trusted, which is not much.

## Pilot, 10 needs × 8 arms × 1 rep

Receipts: [analysis](receipt/pilot/analysis.json), [console](receipt/pilot/console.txt), [environment](receipt/pilot/environment.json). 80 runs, 183 calls, load 3.3–13. The pilot's own rule would also have recommended `sonnet-low` (21.5 s per accepted). It disagreed with the main run on `sonnet-medium`, which failed 2 of 10 in the pilot (12 failed candidates) and accepted 30 of 30 in main: with one rep, any one arm's rank among the fast three moves with which need it happens to get wrong. Pooled pilot and main, for reference only: `sonnet-low` 38/40 at 25.9 s, `opus-low` 39/40 at 26.8 s, `sonnet-medium` 38/40 at 29.9 s, `opus-medium` 40/40 at 37.3 s, `sonnet-high` 40/40 at 43.1 s, `opus-high` 40/40 at 46.7 s, `haiku-low` 35/40 at 36.5 s, `haiku-high` 32/40 at 87.4 s.

## What failed, and why

Every rejection in main, from the rows and each run's ledger:

- **A wrong frozen test, then six failed candidates.** `sonnet-low` on CC-036 froze `kwToHp(6.2) = 8.314471` (correct is 8.314337) and on CC-002 froze a dew point of 56.44 °F where its own formula gives 56.94; `opus-low` on CC-025 froze a value that its kernel missed by 5e-9 with no tolerance. In each, the kernel was then rewritten six times against a test no correct kernel could pass, and the attempt ended at `max_turns`. The pilot's two `sonnet-medium` failures were the same: one frozen expectation off in the fifth or sixth digit. So 30 of the 38 failed code candidates in main and pilot together came from five specifications, not from bad code. Failed candidates here measure the specification stage's arithmetic as much as code quality.
- **The loop's token budget.** Haiku produced single specification turns of 10–27k output tokens. Eight of the ten Haiku rejections in main ended with "model token budget exceeded" (64,000 per stage, cache reads included), and the other two used their six specification turns without a specification that passed its own check, so no evaluator was frozen. Higher effort didn't help Haiku: same acceptance, twice the time, 2.5× the output tokens.
- **No escapes.** Every H run the gates promoted passed its held-out tests: 74 promotions in main and 110 with the pilot, 0 escapes. The fixed-interface needs state the formula and the trap rule, and once the frozen tests were right, the kernels were right. The escape gate didn't discriminate between arms, so the decision rests on quality and speed.

## Predictions

1. Haiku arms fail at least one gate; `haiku-low` fails quality: **held**. Both fail quality at 83%.
2. Within each model, high effort is at least 30% slower than low and gains at most 5 points: **held for Haiku and Opus** (+113%, 0 points; +73%, +3 points), **failed for Sonnet** (+68%, but +7 points, 93% to 100%).
3. `opus-low` within 5 points of `opus-high`: **held**, 97% and 100%.
4. A Sonnet arm at low or medium effort is recommended: **held**, `sonnet-low`.
5. Escape rate under 10% for every non-Haiku arm: **held**, 0% for every arm, Haiku included.
6. Non-model p50 under 2 s and model time over 90% of wall: **held**, 0.29–0.33 s p50, model time 98.7–99.5% of wall per arm.
7. Median turns per run between 2 and 4: **held**, 2 or 3.

## Account and budget

- Auth: `claude auth status` passed (`loggedIn` true, `authMethod` `claude.ai`, subscription `max`) before the pilot, before main, and every 20 runs, 16 checks in [auth.jsonl](receipt/auth.jsonl). Every one of the 320 runs' turns reported init `apiKeySource: none` and the expected model ID (`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`). The environment check saw the transport's child get the account directory and no credential-shaped variable, with `ANTHROPIC_PROBE_UNUSED` set in the parent ([env-check.json](receipt/pilot/env-check.json)). Setup calls are in [setup.json](receipt/setup.json).
- Calls: 183 in the pilot and 598 in main, 781 of the 2,400 budgeted ([calls.json](receipt/calls.json)), plus 7 setup calls outside the budget (1 auth check, 3 one-word effort probes, a 3-turn transport probe). No usage limit was reached and no halt fired.
- List-equivalent cost as the CLI reports it: $5.63 pilot, $20.20 main. It's a subscription, so this is the price-list value of the usage, not a charge.

## Load

The main run started at load 17.5 and ran at 6–51, mostly 20–37, from other agents' work; 238 of 240 main runs are labelled loaded (above 16 at start or end). Model time is remote, and is 99% of wall. Non-model time, 0.29–0.33 s p50, is about twice the pilot's 0.16–0.19 s, which ran at 3–13; those figures are loaded and don't count as the loop's unloaded cost.

## What this does not show

- One rep per need and arm. Sizing used the pilot's wall-time variance, which asked for one rep; acceptance differences of one or two needs, which decide the order among the fastest three arms, need more. The budget had room for three reps.
- One account on one day; the service's latency varies over the day. The interleaved order spreads it over arms but doesn't remove it.
- R needs have no ground truth, so escapes are measured on ten H needs only, which the H wording makes easy to get right once the specification is right. A harder held-out set, or seeded faults per Edition 3 §7, would test whether the escape gate can separate arms at all.
- The H needs and their references were written by Opus 5.5, also an arm.
- The loop's limits are part of the result: 6 turns and 64,000 tokens per stage. A model that thinks at length, like Haiku at either effort here, is measured against that budget.
- `xhigh` and `max` weren't run; no arm needed them to pass.

## Next

- A specification that freezes an expectation off in the fifth digit costs six implementation turns that can't succeed. A cheaper check is to evaluate each frozen numeric expectation against the contract's own formula before freeze, or to stop repairing once the same frozen test fails with unchanged output twice. Either is a loop change with its own precommit, not part of this result.
