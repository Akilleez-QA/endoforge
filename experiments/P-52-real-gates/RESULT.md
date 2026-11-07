# P-52 gates that measure the candidate: result

Status: **Recorded (probe)**, 2026-11-06, Node v26.13.0, 32 threads, width 14, under `heavy-run` on a shared desktop. Precommit: [PRECOMMIT.md](PRECOMMIT.md), sha256 in `receipt/precommit.sha256` (3807bdc0…), committed before any new gate ran on a mutant. No model calls. This is a probe and decides nothing under DEC-64.

**Sampled P-21 escapes fell from 441 to 280 of 7,883 and glue escapes from 691 to 295 of 799, but one pristine kernel of 177 is refused, so the bar isn't met.** `cand-r4/C-015` passes every test and is refused by the code-label rule in G7, which reads its return-code labels as better swapped. The rule is wrong for that kernel. It's reported here and not tuned away. The rules were also amended once after the first full-corpus run, against the precommit; both rows are below.

## Against the bar

Run C is the final tree (`6194dad`), P-51's unmodified harness, the receipts' existing mutant rows, width 14. Its pipeline timings are **loaded** (load average 15–42 during the run) and aren't acceptance figures.

| Measure | Before (P-51) | Frozen rules, run A (`a162dd6`) | Final, run C (`6194dad`) | Bar |
|---|---|---|---|---|
| Sampled P-21 escapes | 441 / 7,883 | 271 / 7,883, offline evaluator; the pipeline run was stopped at 837 rows | **280 / 7,883**, 0 inconclusive | lower |
| Glue P-21 escapes | 691 / 799 | 215 / 799 | **295 / 799** | lower |
| Pristine kernels promoted | 177 / 177 | 172 / 177 | **176 / 177** | 177 / 177: **fail** |

Excluding the refused kernel's own mutants, run C's sampled figure is 280 of 7,842 and glue 295 of 792. The offline evaluator (`offline.mjs`, gates without the pool) gives 280 on the same rows, the same verdict on all 10,416. Run B (`9e64ed7`, the amended rules) gave 278 with 36 inconclusive. Those 36 were cells that ran out of heap, traced to guard flags pinning finished WASM instances; `6194dad` fixed it and run C had none.

## Defects

1. **Universal gates.** `x1/host.mjs` no longer answers from constants. [x1/measure.mjs](../../core/runtime/x1/measure.mjs) runs the kernel in two fresh instances, the second in reverse call order, reads fuel and memory from outside the guest, compares results, and scans imports and calls. 18 tests failed on the old gates, including the empty candidate, garbage WASM and a nonexistent id, and pass now.
2. **Non-terminating kernels.** On the old code a kernel that loops forever gave no result in 60 s through the pool. On the new code it's refused in 0.88 s (gate step 178 ms). [x1/meter.mjs](../../core/runtime/x1/meter.mjs) adds fuel at function entry and each loop header, 1,000,000,000 per run. Bulk memory operations are charged a fixed cost, so the pool's `jobTimeoutMs` stays as a backstop. A wall-only overrun reads as an unknown outcome, never a refusal.
3. **Frozen check.** A stall or an unavailable store is retried, then reported as `inconclusive`. Stall injection on the control arm at width 14, 2% of frozen checks sleeping 12 s, three runs each: the old code finally refused 11, 16 and 20 candidates whose gates passed; the new code refused none, only `C-015` as above. Frozen spawns per candidate fell from 5.0 (885 for 177) to 3.0 (529). Without injection, a rerun of P-51's correlated arm on the old code at width 14 had 52 such refusals (P-51 had 39). The correlated arm wasn't rerun on the new code. Run C had none in 11,510 rows.
4. **Non-finite probe.** Every float parameter of every tested export gets NaN and both infinities, judged by the contract class in [x1/contract.mjs](../../core/runtime/x1/contract.mjs). It caught 154 of the 183 non-finite-only escapes (P-51's probe: 157). The 29 left are 16 under contracts that exclude such inputs, 10 under silent contracts, and 3 under finite-result contracts. It also caught 7 finite-visible mutants. Pristine kernels flagged: 0 of 177 and 0 of 172 `base`, after the amendment; 1 (`C-010`) before it.
5. **Glue.** Argument names now must equal kernel parameter names: 0 of 177 and 0 of 172 `base` flagged. Realistic mislabelling, generated from the 177: a unit suffix dropped from a name, 310 of 310 caught; whole entries reordered, 255 of 255; names swapped with units kept, 255 of 255; units swapped with names kept, 0 of 103 by the name rule; the same wrong order in both kernel signature and glue, 31 of 255. The last is the realistic case for a model that misreads the order, and a name check mostly can't see it. G7 also checks argument and result kinds, precision against decimals in the contract (183 of 189 changed precisions caught), and code labels against code tables in the contract (31 of 54 swaps caught, 1 pristine refused). Unit labels against names stay on record, not refusing, after the amendment.

## Rule amendment

The precommit said rules wouldn't change after the first full-corpus run. Run A refused five pristine kernels: the unit rule read `KgS` and `FromKw` name endings as wrong units (`cand-r4/CC-007`, `cand-r6/CC-007`, `cand-r5/CC-025`), an exclusion written under the last export didn't reach the others (`cand-r3/C-010`), and the code-label rule refused `C-015`. Commit `9e64ed7` made the unit check advisory and read exclusions across the contract. That fixed four of the five and left `C-015`. All five kernels were held out from rule development. The cost of the amendment is in the glue arm: unit swaps escape 266 of 268 after it, against 189 of 268 under the frozen rules.

## Predictions

| # | Result |
|---|---|
| 1 | **Held.** Empty, garbage and nonexistent candidates are refused by the universal gates. |
| 2 | **Held.** No result in 60 s on old code; refused in 0.88 s on new. |
| 3 | **Held.** Old: 11, 16, 20 final refusals; new: 0. |
| 4 | **Held.** 154 of 183, inside 100–170. |
| 5 | **Failed in part.** Finite-visible escapes 251 against 258, outside the predicted 5: the probe caught 7 guard and join mutants whose difference shows on both finite and non-finite inputs. Rounding held at 107 of 107. |
| 6 | **Held.** 280, inside 271–341. |
| 7 | **Held.** 295, inside 200–350, with all 239 reordered caught (180 P-21, 59 add). |
| 8 | **Failed.** 176 of 177 meets the count, but the refusal comes from the code-label rule, not the non-finite rule. Under the frozen rules, 172. |
| 9 | **Held.** 0 of 177, 0 of 172. |
| 10 | **Held.** About 1 ms added per candidate at p50, no added spawn or write before commit (`make loop-test`'s syscall counter). |
| 11 | **Held.** 5.0 to 3.0. |

## Time

In-isolate path, one thread cell, 177 kernels, passes 2 and 3, old `6122dc8` against new `6194dad` interleaved, load average 3–8 ([receipt](receipt/timing.json)).

| | Old p50 / p95 | New p50 / p95 |
|---|---|---|
| Pipeline gate step, ms, two passes | 4.6 / 7.1, 4.7 / 7.7 | 4.2 / 6.4, 5.3 / 9.2 |
| Two universal-gate calls, ms | 0.10 / 0.19, 0.09 / 0.18 | 1.11 / 1.97, 1.12 / 1.99 |
| Two residual gate runs, ms | 1.15 / 1.87, 1.06 / 1.62 | 1.06 / 1.74, 1.10 / 1.82 |

The added cost is the universal gates, about 1 ms at p50 and 1.8 ms at p95. In the pipeline gate step it's within run-to-run noise. Before `2fa5e68` reused the compiled kernel across gate rounds, the same benchmark showed about 7 ms, at a load that wasn't recorded.

## What remains

Sampled P-21 escapes after, by class: wrong rounding 107, stale binding 47, boundary errors 44, wrong constants 32, off by one 26, wrong join 20, reversed inputs 2, swapped units 1, dropped rows 1. Of these, 29 are non-finite-only under contracts that exclude such inputs or say nothing, which the probe can't refuse without reading more into the contract than it says. The other 251 differ only on finite inputs the tests don't cover. That is test gaps, the evaluator's work; the gates can't see them and this probe doesn't claim them. Rounding in particular is unchanged at 107 of 649.

Glue escapes after: result unit swapped 164, argument units swapped 102, code labels swapped 23, precision changed 6. Units have no basis to refuse on until the frozen material states units in a form a gate can read, and the name heuristic refused good kernels.

## Not verified

- The correlated and binding arms on the new code.
- The 172 `base` kernels through the pipeline; only the offline rule audit ran on them.
- Run C's own load profile beyond the samples taken; its pipeline times are loaded.
- Regex reading of contract English beyond this corpus. It produced the one remaining false refusal.
