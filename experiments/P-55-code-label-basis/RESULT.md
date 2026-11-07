# P-55 code labels against a contract that states its result twice: result

Status: **Recorded (probe)**, 2026-11-07, Node v26.13.0, width 14, under `HEAVY_SLOTS=4 heavy-run` on a shared desktop. Precommit: [PRECOMMIT.md](PRECOMMIT.md), sha256 `469b4949…` in `receipt/precommit.sha256`, committed and pushed in `2e996a4` before any arm ran. Code under test: `d383c20`, on the merge of `in-isolate-loop` at `9f37c3e` (`e5b1870`). No model calls. This is a probe and decides nothing under DEC-64.

**The bar is met: 177 of 177 pristine kernels promote, and the code-label change let 17 glue escapes back through (295 to 312 of 799), inside the stated allowance of 21. Sampled escapes are unchanged at 280. Two predictions failed: the correlated arm caught far more than predicted, and 4 of the 172 `base` kernels were refused by the harness's scalar test filter before any gate.** Nothing was changed after the first arm started.

## Against the bar

All arms ran once on the tree at `2e996a4` with P-51's harness as committed in `f0ca757` (byte-identical to the copy P-52 used), P-51's `prep` rows and the P-42 corpus. Gates digest `44b5dc3b…` in both environment files.

| Arm | Before | P-55 | Prediction | Bar | |
|---|---|---|---|---|---|
| `control`, pristine 177 | 176 / 177 (run C) | **177 / 177** | 177 | 177 | **met** |
| `glue` P-21 escapes | 295 / 799 (run C) | **312 / 799** | 305 (297–316) | ≤ 316 | **met**, prediction held |
| `glue` add escapes | 0 / 118 | 0 / 118 | 0 (0–2) | – | held |
| `sampled` P-21 escapes | 280 / 7,883 (run C) | **280 / 7,883** | 280 (270–283) | ≤ 283 | **met**, held |
| `sampled` add escapes | 46 / 2,533 | 46 / 2,533 | 46 (40–48) | – | held |
| `binding` promoted | 0 / 354 (P-51) | **0 / 354** | 0 | 0 | **met**, held |
| `correlated` P-21 escapes | 7,273 / 7,883 (old code, width 14) | **6,733 / 7,883** | 7,170 (7,050–7,280) | ≤ 7,280 | **met**; prediction **failed**, low side |
| `correlated` add escapes | 2,517 / 2,533 | 2,530 / 2,533 | 2,520 (2,490–2,533) | – | held |
| `base`, pristine 172 | not run on new code | **168 / 172** | 172 (≥ 169) | – | **failed** |
| Rows refused with all gates passing; inconclusive | 52; 0 (old correlated) | 0; 0 in 22,452 rows | ≤ 2; 0 | – | held |

## Predictions

| # | Result |
|---|---|
| 1 | **Held.** 177 of 177. `cand-r4/C-015` promotes; its code-label finding is in G7's advisory list. |
| 2 | **Held.** 312, inside 297–316, 7 above the point estimate. 17 rows escape that run C refused: C-015's own three (two unit swaps, one label swap) and 14 label swaps on other kernels whose contract block states a computation. Three of the 14 are in `cand-r1`, the development set; 11 are held out. |
| 3 | **Held.** 0 of 118. |
| 4 | **Held.** 280, the same 280 rows as run C. No row changed outcome. C-015's 41 sampled mutants are all refused at G4. |
| 5 | **Held.** 46. |
| 6 | **Held.** 0 of 354, all refused by the generator before any gate. |
| 7 | **Failed.** 6,733 against 7,050–7,280: 540 fewer escapes than old code, not about 100. 577 rows were newly caught: 420 at G8 (non-finite probe), 151 at G7, 6 by the generator. 50 rows the old code refused with all gates passing now escape, as predicted. The basis was wrong: it took the probe's catch from the sampled arm, where tests had already caught most finite-visible mutants. In the correlated arm the tests catch nothing, so every mutant whose difference also shows on NaN or infinity reaches the probe. The 151 at G7 are all the argument-name rule (recomputed offline): mutants that reorder kernel parameters, which in the sampled arm the tests caught first. |
| 8 | **Held.** 2,530. |
| 9 | **Failed.** 168 of 172. All four (`base-r1/add-6`, `base-r2/CC-026`, `base-r3/CC-009`, `base-r5/C-005`) were refused by the generator, before a candidate existed, with "scalar specification requires value tests for every function". The harness runs `ENDOFORGE_CODEX_TERSE=scalar`; these kernels were frozen under `exact`, and the scalar filter leaves at least one function without value tests (for `C-005` it drops all 30 tests). No gate and not the code-label rule refused a `base` kernel. The precommit named this risk and still set the floor at 169. |
| 10 | **Held.** 0 refused with gates passing and 0 inconclusive, in every arm. |
| 11 | **Held.** Every glue row that escapes now and was refused in run C has a code-label advisory under the committed rule, and nothing else in G7 (recomputed offline from the row's glue and the frozen contract). |

## Diagnosis and change

C-015's frozen contract gives its result twice. Its table says `1 = denied: role right absent; 2 = denied: recorded qualification absent`; its formula `roleRight + 2 * recordedQualification`, with `1 = present`, gives 1 when only the role right is present, which is the table's label for 2. The frozen tests, the kernel and the glue follow the formula. The code-label rule read only the table.

The change: a code-label swap refuses only when the export's contract block doesn't also state the result as a computation from its parameters (an expression in backticks, or after `formula…:`, with a parameter name and one of `+ - * / % < >`). With one, the disagreement goes to G7's advisory list. The reasoning is in the precommit: a contract that states its result both ways is ambiguous wherever the two disagree, and a regex gate can't tell which reading binds.

The cost is the 14 label swaps on other kernels whose contracts give a computation, most of which presumably state it consistently with the table. The rule can't tell agreement from disagreement, so those swaps are no longer refused. The table reader still mixes argument code tables into the result table; that wasn't changed here.

## Time and load

Each row is given the 1-minute load at the time it was written (`load.mjs`, samples every 10 s, `receipt/load-*.jsonl`). Timings at a load above 16 are **loaded**. Other lanes shared the machine: the run started at 3.6 and reached 37.6 during the correlated arm. The 20 limit was checked before each launch, not enforced during it; `heavy-run` governed the job.

| Arm | Load min / p50 / max | Rows at ≤ 16 | Gate ms p50 / p95, ≤ 16 | Gate ms p50 / p95, loaded |
|---|---|---|---|---|
| `control` | 3.6 / 5.9 / 6.6 | 177 | 256 / 596 | – |
| `glue` | 6.6 / 16.8 / 21.3 | 391 | 157 / 471 | 143 / 428 |
| `binding` | 21.2 / 21.2 / 21.3 | 0 | – | no gate step |
| `sampled` | 7.8 / 22.0 / 29.6 | 2,993 | 92 / 252 | 96 / 265 |
| `correlated` | 12.3 / 23.4 / 37.6 | 1,382 | 282 / 529 | 293 / 570 |
| `base` | 16.9 / 19.2 / 19.2 | 0 | – | 261 / 543 |

These are pipeline gate-step times through the pool, not the in-isolate benchmark P-52 used. They aren't part of the bar.

## Changes to the plan

- The first launch of the run script failed before any row: the run tree was made with `git archive` of `2e996a4`, which doesn't contain P-51's harness (it lives on `escape-rate-probe` and is git-excluded in this worktree). The harness was added from `f0ca757`, checked byte-identical to the copy P-52 used, and the run started again on empty output.
- The `base` arm's rows carry `cand-r…` keys because the harness reads only `cand-r*` directory names. `analyze.mjs` relabels them `base-r…`.

## Not verified

- Whether the contracts in the 14 newly escaping label swaps actually state the computation consistently with the table. Only C-015's contract was read for this.
- `base` kernels under `exact`, their own mode. The harness only runs `scalar`.
- `make test` covers the rule change with synthetic contracts only.

## Files

`analyze.mjs` writes [receipt/summary.json](receipt/summary.json). Row files stay outside git; their digests are in `receipt/rows.sha256`. Run on the tree at `2e996a4` plus `experiments/P-51-escape-rate` from `f0ca757`: `run.mjs` with `P51_CORPUS` set to the P-42 receipts (and, for `base`, a directory linking `cand-rN` to `base-rN`), `P51_PREP` set to P-51's prep, width 14.
