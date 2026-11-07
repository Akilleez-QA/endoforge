# P-56 evaluator synthesis: result

Status: **Recorded (probe)**, 2026-11-07, Node v26.13.0, 32 threads, width 14, under `heavy-run` on a shared desktop. Precommit: [PRECOMMIT.md](PRECOMMIT.md), sha256 in `receipt/precommit.sha256` (02faca94…), pushed before any synthesized evaluator judged a mutant. One amendment: [AMENDMENT.md](AMENDMENT.md). This is a probe and decides nothing under DEC-64.

**On the same tree, synthesis cut sampled P-21 escapes from 280 to 105 of 7,883 and glue escapes from 312 to 184 of 799 (S2), and all 177 pristine kernels promoted in S2. The glue half of the bar isn't met: 184 is above 156.** Rounding escapes fell from 107 to 12. The 29 escapes visible only on NaN or infinity are untouched, as predicted.

## Against the bar

S2 is the headline: two independent evaluators, checks only where both agree. S0 is the same tree with synthesis off, derived from S1a's rows (an escape under S1a, or a refusal with every gate passing and no ledger decision). Pipeline timings are **loaded**: load average 25 to 38 during both arms.

| Measure | S0 (off) | S1a (one) | S2a (two, agreed) | Bar (S2) |
|---|---|---|---|---|
| Pristine promoted | 177 / 177 | 176 / 177 | **177 / 177** | 177 / 177: **met** |
| Sampled P-21 escapes | 280 / 7,883 (3.55%) | 105 (1.33%) | **105 (1.33%)** | at most 140: **met** |
| Clopper-Pearson / bootstrap | 3.15–3.98% / 2.55–4.64% | 1.09–1.61% / 0.76–1.97% | 1.09–1.61% / 0.76–1.97% | |
| Glue P-21 escapes | 312 / 799 (39.0%) | 174 (21.8%) | **184 (23.0%)** | at most 156: **not met** |
| Sampled add escapes | 46 / 2,533 | 4 | 4 | |
| Glue add escapes | 0 / 118 | 0 | 0 | |

Harness errors: 0 in every arm. S0's pristine count is 177 because its one S1a refusal is the evaluator's.

## What changed, by class (sampled P-21)

| Class | S0 | S1a and S2a |
|---|---|---|
| wrong rounding | 107 / 649 | 12 |
| stale binding | 47 / 997 | 17 |
| boundary errors | 44 / 1,027 | 36 |
| wrong constants | 32 / 951 | 13 |
| off by one | 26 / 955 | 12 |
| wrong join | 20 / 800 | 15 |
| reversed inputs, dropped rows, swapped units | 4 | 0 |
| sign errors | 0 / 946 | 0 |

Finite-visible escapes fell from 251 to 76 of 7,700. Non-finite-only stayed at 29 of 183: synthesis doesn't probe NaN or infinity, and these contracts exclude such inputs or say nothing. S1a and S2a are identical on kernel faults: requiring two references to agree cost nothing here.

Glue P-21, S0 → S1a → S2a: result unit swapped 165 → 108 → 110, argument units swapped 103 → 42 → 46, code labels swapped 38 → 23 → 27, precision changed 6 → 1 → 1. Unit checks only judge where both the evaluator's unit and the glue's unit parse; the rest stay unknown and never refuse. Dual mode drops a unit both members don't state the same way, which is where S2 loses 10.

## The one pristine refusal (S1a)

`cand-r4/C-015`'s contract contradicts itself. Its code table says 1 = "denied: role right absent", but its formula `roleRight + 2 * recordedQualification` returns 1 when the qualification is absent. The kernel and glue follow the formula. The evaluator's reference followed the formula too (it passed M3), but its declared labels followed the table, so `codes.glue` refused the glue. This is the same kernel P-52's code-label rule refused, and it's the contract P-55 is about. S2a promoted it because member 1's need-sheet reply for this kernel held no parseable `sheet.json`, so S2a abstained; that isn't evidence that dual mode resolves the contradiction.

## Defects and the amendment

The first S1 run on the precommitted tree refused 11 of 177 pristine kernels where the offline evaluator refused 1. Cause: an open-sided range was written as `Infinity`, which JSON freezes as `null`. It was fixed in `afde8a5` with a test that fails on the old code. The run was stopped at 1,900 of 10,416 sampled rows: 20 of 1,516 P-21 rows escaped, against 65 under S0 on the same rows. Both arms were rerun on the amended tree as S1a and S2a; nothing else changed.

## Predictions

| # | Result |
|---|---|
| 1 | **Failed in part.** S0 sampled 280, matching P-52. Glue 312, 17 above P-52's 295: code-label swaps escape 38 of 54 against 23, after `d383c20` narrowed the code-label rule on `real-gates`. |
| 2 | **Held.** Member 0 bound 253 exports and 252 qualified (99.6%). Two kernels had no member-0 binding, because the need-sheet reply held no parseable `sheet.json`, so S1a abstained on them. |
| 3 | **Held.** S1a 105, inside 50–120. |
| 4 | **Held.** S2a 105, inside 55–130, equal to S1a. |
| 5 | **Held.** 29 of 29 stay. |
| 6 | **Held.** Rounding 12, at most 40. |
| 7 | **Failed in part.** S1a glue 174, above 80–170; S2a 184, inside 90–190. |
| 8 | **Held.** S1a 176, S2a 177. |
| 9 | **Held**, after the amendment. Offline and pipeline refusal sets agree on all 815 rows S0 lets through. Before it they disagreed, which is how the defect was found. |
| 10 | **Held.** Offline, stage time per candidate (compile, qualify, judge) is 495 ms p50 and 2.9 s p95 at load 2.8–6.2; judging alone is 0.6 ms p50. In the pipeline the freeze step's p50 rose from 283 ms (P-52 run C) to 1,753 ms in S1a and 3,006 ms in S2a, loaded (load 25–38). |

## Cost

702 of the 708 planned `claude -p` calls ran, on `sonnet`, one subscription account, and every one returned. Six need-sheet replies held no parseable `sheet.json`, so their bindings weren't sent; those members abstain. 2.55 M tokens, mean 6.1 s per call, 12 min wall at 6 concurrent (load 2–8). Per task that's four calls, about 14.4 k tokens. In the loop, the need sheet overlaps the specification turn; the binding adds one turn to the critical path.

## Finding for follow-up: frozen tests

In one kernel, `cand-r6/C-005`, both independent references disagreed with the same frozen test: the test expects a trap for a negative allowance, and both references return a value. M3 made that export unqualified, so the evaluator stepped back. The draft model-effort experiment (PR 103) found wrong frozen values cost about six repair turns each. The design doc now records the proposed follow-up: report a frozen test that two qualified, agreeing references contradict, before the implementation turn. Not built.

## Not verified

- A searched rate, the correlated arm and the binding arm: none ran. The binding reads the same contract as the kernel, so a misread contract is outside this probe.
- A person's confirmation. The confirming party was the task contract.
- The agent and in-isolate loops. Only the current path calls the stage.
- Any second model or second sampling of replies. Results are for one recorded sample.
- The experiment number. Draft PR 103 also uses P-56 (`P-56-model-effort`), so one of the two needs renumbering.
