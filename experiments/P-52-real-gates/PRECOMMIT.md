# P-52 gates that measure the candidate: precommit

Label: **Proposed** procedure, frozen 2026-11-06 before any new gate has run on a mutant. No model calls. P-51's receipts, its harness and its corpus of 177 promoted kernels are the inputs. This is a probe and decides nothing under DEC-64.

## Question

P-51 found that five of the six results the promotion policy requires say nothing about the candidate, that a kernel that never returns is unbounded, that a stalled frozen check refuses a good candidate, and that non-finite inputs and glue labels go unchecked. If those checks measure the candidate, how far do the 441 of 7,883 sampled escapes and the 691 of 799 glue escapes fall, at what cost per candidate, and does every pristine kernel still promote?

## Changes under test

1. **Universal gates.** Interface, bounds, determinism and forbidden effects are answered from the candidate's module: two fresh instances in the cell, the second calling in reverse order, usage read from outside the guest, and a scan of imports and calls.
2. **Bounded execution.** Kernels run with metered fuel added to the module, so a loop or recursion stops deterministically. Wall time alone reads as an unknown outcome, because it can be the machine's load.
3. **Frozen check.** A stall or an unavailable store is retried, then reported as inconclusive, never as a final refusal. Redundant checks are removed so there are fewer spawns per candidate.
4. **Non-finite probe.** Every float parameter of every tested export is called directly with NaN and both infinities. The expected behaviour comes from the frozen contract: it allows non-finite results, requires a trap, excludes such inputs, promises finite results, or says nothing. Only the requiring and promising classes can refuse. An excluded or silent contract is recorded, not refused.
5. **Glue.** Argument names must equal kernel parameter names. Also checked where the frozen material gives a basis: argument and result kinds against the module's types, precision against decimals stated in the contract, unit labels against parameter names, and code labels against code tables in the contract.

## Rule development split

Rule text for items 4 and 5 is written after reading only the `cand-r1` contracts and kernels. `cand-r2` to `cand-r6` and the 172 `base` kernels aren't read for this purpose, so false alarms on them are out of sample. Rules aren't changed after the first full-corpus run. A later change would need a new row in the result, labelled as such, with both figures.

## Measures

- Rerun P-51's `control`, `sampled` and `glue` arms with its unmodified harness at width 14, on the 177 kernels and the receipts' existing mutant rows. Before: 441 of 7,883 P-21 sampled escapes, 691 of 799 P-21 glue escapes, 177 of 177 controls.
- Added non-model time per candidate, on the in-isolate path in one thread cell and on the existing path, old gates against new on the same kernels.
- Stall injection at width 14: `python3` is shimmed so a fixed share of frozen checks sleep past the timeout. Same rows and shim on old and new code. Count final refusals of candidates whose gates pass.
- Fuel, memory and wall time per pristine kernel, and time to refuse a kernel that never returns.
- False alarms for each glue and probe rule, on the 177 and on the 172 `base` kernels, split by development and held-out.

Fixed in advance: fuel 1,000,000,000 per run, memory 64 MiB per run, wall 30 s per run. These aren't tuned on results.

## Predictions

| # | Prediction | Failure means |
|---|---|---|
| 1 | Empty candidate, garbage wasm and nonexistent id are all refused by the universal gates | The gates still carry no information |
| 2 | On old code a kernel that never returns hangs its job with no result in 60 s. On new code it is refused in under 10 s | The hang was misdescribed, or the fuel is wrong |
| 3 | Old code gives at least one final refusal under stall injection; new code gives none | The stall isn't the mechanism, or the fix is incomplete |
| 4 | Non-finite probe catches 100 to 170 of the 183 non-finite-only escapes. Fewer than P-51's 157 is acceptable, since excluded and silent contracts can't refuse | The contract reading is wrong in one direction or the other |
| 5 | Finite-visible escapes stay within 5 of 258, and rounding within 2 of 107 | Gates are seeing more than expected, and the cause needs finding |
| 6 | Sampled P-21 escapes after: 271 to 341 of 7,883 | As 4 and 5 |
| 7 | Glue P-21 escapes after: 200 to 350 of 799, with all 239 reordered caught | The label checks catch less or more than their basis suggests |
| 8 | At least 175 of 177 pristine promote, and any refusal comes from the non-finite rule | A pristine refusal is a failure of a rule to report, not to tune away |
| 9 | Argument names flag 0 of 177 pristine and at most 2 of 172 `base` | The rule is too strict for real glue |
| 10 | Added time at most 5 ms per candidate at p50 on the in-isolate path, with no added spawn or file write up to commit | The checks cost more than the design's budget |
| 11 | At width 14, frozen spawns per candidate on the existing path fall from 5 to at most 3 | The reduction didn't land |

## Not claimed

No searched rate, no tier, no model-made fault rate. Most finite rounding escapes are test gaps, which belong to evaluator work; a gate can't see them and this probe won't claim them. Regex reading of contract English is a stopgap and its error rate is one of the measures.
