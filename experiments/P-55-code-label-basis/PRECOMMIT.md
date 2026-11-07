# P-55 code labels against a contract that states its result twice: precommit

Label: **Proposed** procedure, frozen 2026-11-06 before the rule change below has run on any corpus row. No model calls. This is a probe and decides nothing under DEC-64. It is a new run, not a retune of P-52: Craig chose "New precommitted run" over adjusting the rule to fit P-52's known result.

## Question

P-52 run C refused one pristine kernel of 177, `cand-r4/C-015`, at the G7 code-label rule, although it passes all 16 frozen tests. Does a general change to that rule promote all 177 pristine kernels, and how many glue and sampled escapes does it let back through?

## Diagnosis

Read from the rule ([contract.mjs](../../core/runtime/x1/contract.mjs), `glueProblems` at `d383c20`'s parent) and from the text of C-015's contract, which P-52 already named. No corpus outcome was used to choose the change.

- The rule builds a table from every `n = label` in the export's contract block and refuses when the glue's labels for two codes overlap the table's words better crossed than straight.
- C-015's contract states the result twice. Its table says `1 = denied: role right absent; 2 = denied: recorded qualification absent`. Its formula, `roleRight + 2 * recordedQualification`, with `0 = absent, 1 = present` for each input, gives 1 when the role right is present and the qualification absent, which is the table's label for 2. The two statements in the frozen contract contradict each other.
- The frozen tests follow the formula (`[0, 1, 0]` expects 1, named "role alone denied"). So do the kernel and the glue, whose notes say they follow the formula and tests.
- The rule read only the table. It did what it says; its premise, that the table is the contract's statement of what each code means, is false when the contract also gives a computation.

The rule's failure isn't specific to this kernel. Wherever a contract states the result as a computation from coded parameters, each code's meaning is fixed by that computation, the input code tables and the frozen tests, and the label table is a second, prose statement of the same thing. If they disagree, the contract is ambiguous on its face, and a regex gate has no basis for choosing which reading the glue must follow. P-52 already applies this principle elsewhere: non-finite results under excluded or silent contracts are recorded, not refused, and unit labels are advisory.

Also seen and **not** changed here, so that this run tests one change: the table also takes argument code tables (`0 = waiver, 1 = MOC approval`, `0 = absent, 1 = present`) in the same block, and the last entry per code wins. In C-015 the return codes come last, so it isn't the cause.

## Change under test

In G7's code-label check, a pair of result codes whose glue labels fit the contract's code table better swapped is a refusing problem only when the export's contract block doesn't also state the result as a computation from that export's parameters. A statement counts when a backticked span, or the text after `formula…:` on a line, contains one of the kernel's parameter names (the glue's argument names if the kernel declares none) and one of `+ - * / % < >`, and isn't a call signature (`name(`). With such a statement the disagreement goes to G7's `advisory` list and doesn't refuse. Without one, the rule refuses exactly as before.

- Code commit under test: `d383c20` ("Refuse a code-label swap only where the code table is the contract's only basis"). It changes `core/runtime/x1/contract.mjs` (`statesComputation`, `glueFindings`; `glueProblems` keeps its signature), `core/runtime/x1/gates.mjs` (G7 records the advisory), their tests and `sources/SHA256SUMS`. Nothing else differs from its parent.
- Its parent `e5b1870` merges `in-isolate-loop` at **`9f37c3e`** into P-52's final code `52c6927` (gates as in run C, `6194dad`). The merge brings the other lane's P-50 amendment 4: frozen tests must each assert a finite, bounded value or a trap (G1), `expectError` is met only by a WebAssembly trap or a kernel `abort`, freeze records say `none` for confirmation, and resumed runs read durable decisions. Those rules have not run on this corpus. Any pristine refusal they cause counts against the bar like any other, attributed by gate. If `in-isolate-loop` gains commits after this precommit, they are not merged before the runs finish.
- Rule development split: the rule was written from C-015's contract and the rule source. The only other corpus text read was the `cand-r1` contracts, P-52's development set, to estimate how often a code-table export also states a computation: 3 of 6 code-table exports in `cand-r1` (2 of 4 kernels). `cand-r2` to `cand-r6` and the 172 `base` kernels weren't read for this.

## Harness and arms

P-51's harness, unmodified: `experiments/P-51-escape-rate/run.mjs` with its `PRECOMMIT.md` digest check, `replay-codex.mjs`, `ENDOFORGE_CODEX_TERSE=scalar`, thread pool, width 14, P-51's `prep` rows (`mutants.jsonl`, `baselines.json`) and the P-42 corpus (`cand-r1` to `cand-r6`, 177 kernels; manifest hashes match P-51's `corpus-manifest.json`). AssemblyScript is the tree's pinned `tools/asc` 0.28.20. Heavy work runs under `HEAVY_SLOTS=4 heavy-run`, started only at a 1-minute load at or below 20.

| Arm | Rows | Before |
|---|---|---|
| `control`, pristine | 177 (118 P-21, 59 add) | run C 176 / 177 |
| `glue` | 917 (799 P-21, 118 add) | run C 295 / 799 P-21 escapes, 0 / 118 add |
| `binding` | 354 | P-51 0 / 354 promoted |
| `sampled` | 10,416 (7,883 P-21, 2,533 add) | run C 280 / 7,883 P-21, 46 / 2,533 add |
| `correlated` | 10,416 | old code at width 14 (P-52 `corr-old`) 7,273 / 7,883 P-21, 2,517 / 2,533 add; P-51 7,272 and 2,531 |
| `base`, pristine | 172 | never through the pipeline on new code; P-52's offline rule audit flagged 0 |

The `base` arm is the harness's `control` arm pointed at a corpus directory whose `cand-r1` to `cand-r6` are symbolic links to P-42's `base-r1` to `base-r6`. The harness only reads `cand-r*` names, so its rows carry `cand-r…` keys; the result relabels them. The `base` kernels were promoted under `exact`, not `scalar`, so the scalar test filter may drop tests from them or refuse one before any gate. Such a refusal is reported by stage, not excused.

Load: `load.mjs` samples the load average every 10 s together with how many rows each arm file holds, so every row and every timing is given the 1-minute load at the time it was written. Any timing at a load above 16 is labelled **loaded** and doesn't count as an acceptance figure. Timings aren't part of the bar.

## Predictions

| # | Arm | Prediction | Basis |
|---|---|---|---|
| 1 | `control` | 177 / 177 promoted | The change removes C-015's only refusal; the other 176 promoted in run C under the same gates |
| 2 | `glue` P-21 | 305 escapes, tolerance 297 to 316 | Run C's 295, plus C-015's own glue rows refused only by the false code-label refusal (2 to 3: two unit swaps and one label swap), plus label swaps on other kernels whose contracts state a computation. Run C has 18 such code-label catches outside C-015, 14 with no other G7 problem recorded and 4 whose receipt is truncated. At `cand-r1`'s rate of about half, about 7 escape; at most 18 |
| 3 | `glue` add | 0 / 118 escapes, tolerance 0 to 2 | Run C 0 |
| 4 | `sampled` P-21 | 280 escapes, tolerance 270 to 283 | C-015's 41 sampled mutants all fail its tests (P-51 promoted none), so the change adds none. The lower side allows for the merged G1 and trap rules catching more |
| 5 | `sampled` add | 46 / 2,533, tolerance 40 to 48 | Run C |
| 6 | `binding` | 0 / 354 promoted | P-51; the generator refuses them before any gate |
| 7 | `correlated` P-21 | 7,170 escapes, tolerance 7,050 to 7,280 | Old code at width 14 gave 7,273, with 52 transient refusals (counted as non-escapes) that P-52 removed, adding about 45. The non-finite probe judges by the contract, not the tests, so it should catch about as many as in the sampled arm, 100 to 170. The merged G1 rule may refuse some correlated tests before or at G1 |
| 8 | `correlated` add | 2,520 / 2,533, tolerance 2,490 to 2,533 | Old code 2,517 with 14 more refusals than P-51; P-51 2,531 |
| 9 | `base` | 172 / 172 promoted, tolerance at least 169 | Offline audit flagged 0; the scalar filter and the merged G1 rule haven't run on them |
| 10 | Any arm | At most 2 rows refused with all gates passing, and 0 inconclusive | P-52 removed the stall refusals; run C had none in 11,510 rows |
| 11 | `glue` | Every row that escapes and was refused in run C has a code-label advisory or was a C-015 row; none escapes for another reason | The change only moves code-label findings to the advisory list |

## Acceptance bar

Met only if all hold:

1. `control`: 177 of 177 pristine promoted.
2. `glue` P-21 escapes at most 316 (run C's 295 plus the 21 stated above).
3. `sampled` P-21 escapes at most 283 (run C's 280 plus 3).
4. `binding`: 0 promoted.
5. `correlated` P-21 escapes at most 7,280, no worse than the old code beyond its tolerance.

The `base` arm and predictions 3, 5, 8, 9 and 10 are reported against their predictions but aren't part of the bar.

## No changes after the first full-corpus run

No rule, gate, harness or prediction changes after the first arm starts. If a change follows, it is a separate run with its own label and its own rows, and the figures above stay as the result of this one. An arm that dies for a machine reason (out of memory, killed, host reboot) is resumed from its own file by the harness's existing resume, on the same commit, and that is recorded.

## Not claimed

No searched rate, no tier, no model-made fault rate. The computation test is a regex over contract English, like the rest of G7, and its error rate is part of what's measured. A contract whose table and computation agree also loses label-swap refusals under this change; that cost is what predictions 2 and 11 count.
