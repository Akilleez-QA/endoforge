# P-65 unit gate: result

Status: **Recorded (probe)**, 2026-11-07, Node v26.13.0, 32 threads, under `heavy-run` on a shared desktop. Precommit: [PRECOMMIT.md](PRECOMMIT.md), sha256 6e235129… in `receipt/precommit.sha256`, pushed at 18:20 EST (`e965cb5`) before any pipeline arm ran. Two amendments: [AMENDMENT.md](AMENDMENT.md). This is a probe and decides nothing under DEC-64.

**A static units gate, `G9_units`, cut glue P-21 escapes from 184 to 91 of 799 on P-56's corpus, seeds and recorded evaluator replies. That meets the 156 bar and the 92 stretch. Sampled escapes stayed at 105, all 177 pristine kernels promoted, and the gate costs 0.10 ms p50 per candidate. 45% of what it refuses the dual evaluators pass.**

## Classification first

The 184 S2a escapes, classified by diffing each mutant glue against its pristine glue (`classify.py`, `receipt/classification.json`). The rival, "the escapes are contract or spec errors, not unit swaps", doesn't fit: in all but 14 rows the pristine glue is right and the mutant contradicts the kernel's arithmetic, the field's kind or the parameter names. But "mostly unit swaps" was only half right. 156 rows are unit swaps by the mutator's op name, yet only 61 swap two parseable physical units. 86 have a non-physical label on at least one side (`status`, `approval action`, `unit code`). That is the evaluator's blind spot by construction: `units.glue` judges only where both units parse.

| Class | S2a | U2a | Dev (r1–r2) closed | Held-out (r3–r6) closed |
|---|---|---|---|---|
| Label vs physical | 50 | 13 | 11 / 13 | 26 / 37 |
| Label only | 36 | 27 | 2 / 10 | 7 / 26 |
| Time point vs duration (C-010) | 20 | 4 | 4 / 6 | 12 / 14 |
| Different dimension | 19 | 4 | 3 / 4 | 12 / 15 |
| Code labels, "never returned" swapped | 13 | **0** | 4 / 4 | 9 / 9 |
| Code labels, two live labels | 14 | 14 | 0 / 6 | 0 / 8 |
| Temperature point vs difference | 12 | 12 | 0 / 2 | 0 / 10 |
| Same dimension, scale | 10 | 7 | 1 / 3 | 2 / 7 |
| Generic physical (`selected unit`) | 9 | 9 | 0 / 3 | 0 / 6 |
| Precision | 1 | 1 | 0 | 0 / 1 |
| **Total** | **184** | **91** | **25 / 51 (49%)** | **68 / 133 (51%)** |

The 91 left, in kind: 14 live code-label swaps, which only a reading of the contract can settle; 12 bare-degree rows (`°F difference` → `°F`) that match how pristine glue writes differences in 5 kernels, so refusing them would refuse good kernels; 9 generic units; about 10 near-equivalent rewrites (`mass fraction` → `dimensionless`); and 27 label-only swaps whose labels share no token with any name.

## Against the bars

| Bar | Measured | |
|---|---|---|
| 1. Glue P-21 escapes ≤ 156; stretch ≤ 92 | **91 / 799** (11.4%; Clopper-Pearson 9.3–13.8%; need-cluster bootstrap 6.7–17.0%). S2a 184 | **met**, stretch **met** |
| 2. Sampled P-21 escapes ≤ 105 | **105 / 7,883** (1.33%; 1.09–1.61%), identical rows to S2a | **met** |
| 3. Pristine 177 / 177; C-015 refused under one evaluator | U2a **177 / 177**, zero false refusals. U1a 176 / 177, C-015 refused by the evaluator | **met** |
| 4. Gate ≤ 5 ms p50, no model calls | **0.10 ms p50**, 0.48 ms p95, 13 ms max over 11,682 candidates; load 15.4 at start, 19.5 at end (one-minute average) | **met** |
| 5. Independence, predicted 35–65% | **45.3%** (143 of 316 G9 refusals pass the dual evaluator) | **held** |

U1a (width 1, control only): 176 / 177 promote. The one refusal is `cand-r4/C-015`, refused by the evaluator with every gate including G9 passing (`gates_passed_decision_refused`), as P-56's S1a refused it. Its contract contradicts itself (P-55); G9 has no view on that.

## Independence

Over all P-21 mutant rows (sampled and glue), G9 refuses 316.

| G9 refusals the other side passes | Rows | Fraction |
|---|---|---|
| Dual evaluator (offline width 2) | 143 / 316 | 45.3% |
| Existing gates G1–G8 | 174 / 316 | 55.1% |
| Both | 93 / 316 | 29.4% |
| Glue surface only, vs the evaluator | 141 / 222 | 63.5% |
| Kernel surface only, vs the evaluator | 2 / 94 | 2.1% |

The reverse direction is lower still: of the evaluator's 7,334 P-21 refusals, G9 also refuses 173 (2.4%). The two methods overlap where both can parse a physical unit and diverge elsewhere. On kernel mutants G9 mostly catches structure the tests already see (`times_to_plus` 31, `swap_adjacent_params` 25: a product turned into a sum no longer balances), so it adds almost nothing there. On glue it is the only check that reads the kernel's arithmetic against the glue. Rules firing on the 316: D 168, N 126, L 41, K 35, C 29, R 7.

The 93 rows neither the evaluator nor G1–G8 refuse are exactly the 93 S2a escapes U2a closed. The cross-check found 0 disagreements: every U2a promotion is an S2a promotion that offline G9 passes, and every pipeline G9 verdict equals the offline one.

## Predictions

| # | Result |
|---|---|
| 1 | **Held.** Glue 91, inside 88–94, equal to offline. |
| 2 | **Held.** Sampled 105, inside 100–105. G9 refuses 94 kernel rows, none of them sampled escapes. |
| 3 | **Held** for U2a (177 / 177). U1a refuses only C-015, by the evaluator. |
| 4 | **Held.** 0.10 ms p50. |
| 5 | **Held.** 45.3%, inside 35–65%. |
| 6 | **Held.** Held-out 51% against dev 49%. |

## Rival and what discriminated it

Strongest rival: the escapes are contract or spec errors, so a units gate catches little. Two measurements separate it. The classification puts at most 14 rows (live code-label swaps) and C-015's contract on the spec side. And a gate that never reads the contract closed 93 rows, all of them invisible to an evaluator that does. If the escapes were spec errors, a contract-blind gate would close none. A weaker version holds: the 14 live label swaps and the 12 bare-degree rows are untouched by any rule that passes pristine glue.

## Defects and amendments

1. The first U2 control arm promoted 0 of 177: both Python ledger verifiers pinned the gate set to G1–G8, so a report carrying G9 failed verification. G9 was added to both sets (`cd0fce7`), as G8 was when it landed. Stopped before any mutant row ran; the frozen control row is kept in `U2-frozen` outside git.
2. Mid-U2a, load reached 36–39 with this arm's workers on top, pushing the timing lanes (P-61, P-62, P-64) into loaded rows. At the coordinator's request the arm was stopped at 2,929 of 10,416 sampled rows and resumed at **width 6** instead of 14 (`8db0fa7`). P-51's harness skips written rows, so none ran twice. Width changes no verdict, which the 0-disagreement cross-check confirms; it makes the pipeline's stage timings incomparable, and those were loaded anyway.

## Cost

No model calls in the gate. In the pipeline, the gate stage was 126 ms p50, 287 ms p95 at width 6 against S2a's 182 ms and 486 ms at width 14. Both are **loaded** (load 20–39) and include every gate, so they're not acceptance figures. Bar 4's figure is the separate offline run.

## Not verified

- A model-written fault. Seeded glue mutants aren't model faults, and the rule vocabulary (unit words, name tokens) was written against this corpus. The held-out split is weaker than a blind one, because the classification read all 184.
- Other kernels' naming habits. N and R lean on parameter names. A kernel that names `sampleDay` a millisecond timestamp (C-010 r4) is why time scale isn't checked on singular `Day`.
- The agent and in-isolate loops. G9 sits in `runGates`, so every path that runs gates gets it, but only the current path ran here.
