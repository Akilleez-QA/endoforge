# P-66 best of n against one smart attempt, and a router between them: result

Status: **Recorded**, 2026-11-07, 18:17–18:43 EST, Claude Code 2.1.319 (`claude-sonnet-5-5`, `claude-opus-5-5`), Node v26.13.0, the P-50 agent loop at `e05b6fc`, one subscription account. Precommit: [PRECOMMIT.md](PRECOMMIT.md), committed at 18:17:14 before the first model call; hash chain in [receipt/precommit.sha256](receipt/precommit.sha256) (`72a8531a…` original, which the run checked; `bbf306de…` amendment 1, analysis only, committed at 18:23 during the run).

**At equal cost, several cheap attempts beat one smart attempt on time and tie it on pass rate. But one cheap attempt beats both on cost, and the decision rule picks it: `bo1`, Sonnet at low effort ×1.** In the decision view (24 needs), `bo1` promoted 99.5% of needs at 0.056 LEU per promoted candidate. `opus-high` cost 3.2× as much at 100%, with twice the p50 time. `bo2` and `bo4` bracket Opus's cost and halve its time, but they cost 1.9× and 3.8× `bo1` and save only 1–2 s of p50, because Sonnet's runs on one need finish within a few seconds of each other. The rival held only weakly: failures within a need were mildly correlated as-is (ICC 0.18, interval reaching 0). Best of n saturated by k = 2, because there was almost nothing left to fix, not because failures repeated. The router missed its bar: the precommitted 10% exploration cost 26% over `bo1` on held-out needs. Without exploration, the router routed to `bo1` everywhere in the decision view and matched it exactly.

## Run

27 needs started in the seeded order and 26 completed. The budget refused 2 calls on H03, the 27th, which is excluded everywhere. **Calls: 600 of 600**, plus 28 `claude auth status` checks, which aren't model calls. Every reply's init reported `apiKeySource: none`. The environment check saw the transport's child get the account directory and no credential-shaped variable ([env-check.json](receipt/env-check.json)). List-equivalent usage over all 270 runs: 18.58 (a price-list value, not a charge). Receipts: [rows](receipt/rows.jsonl), [analysis](receipt/analysis.json), [classification](receipt/classification.json), [console](receipt/console.txt), [auth](receipt/auth.jsonl), [end](receipt/end.json). Tables: `node table.mjs`.

**Load**: 8–38. 201 of 260 complete-need runs are labelled loaded (above 16 at start or end), from other lanes' work. The times below are almost all remote model time, but they are loaded figures.

## Frozen-test errors

Six runs failed, all `sonnet-low`, all after six implementation turns (`max_turns`):

| Need | Sample | Class | Evidence |
|---|---|---|---|
| H02 | 2 | frozen-wrong | `threePhaseHp(100,2000,1,1)` frozen 464.54495, reference and kernel 464.54368 |
| H02 | 5 | frozen-wrong | `threePhaseHp(1000,2000,1,1)` frozen 2322.717 (half), reference and kernel 4645.437 |
| H08 | 3 | frozen-wrong | `lineChargeLb(10,12,70)` frozen as a value; diameter 12 is outside 0–6, so the reference and kernel trap |
| H08 | 5 | frozen-wrong | `lineChargeLb(1000,6,100)` frozen 19,634,954 (×1000), reference and kernel 19,634.954 |
| H02 | 0 | other (a classifier miss) | frozen 4645.434102, reference and kernel 4645.436784: wrong at 5.8e-7 relative, inside the classifier's 1e-6 tolerance |
| CC-007 | 6 | other | a real kernel bug: `recirculationRatio(1,1200,100)` returns 1/12 for an expected 12, and six repairs didn't invert it |

So 5 of 6 failures were wrong frozen values, as in P-56. The precommitted classifier caught 4 and missed the fifth, whose error was smaller than its tolerance. The miss changes nothing, because H02 is excluded on the other two. The decision view drops H02 and H08 for every arm. One genuine code failure remains: CC-007.

## Arms, decision view (24 needs, the decision)

Cost is LEU, the CLI's `total_cost_usd` increments, counting cancelled runs' in-flight replies in full. "Lower bound" counts finished replies only. Times run from the barrier to the first promotion.

| Strategy | Pass rate | Cost per promoted | Lower bound | Calls per promoted | Model-s per promoted | Failed candidates per promoted | Time p50 / p90 s | Escapes |
|---|---|---|---|---|---|---|---|---|
| `bo1` | 99.5% | **0.0563** | 0.0563 | 2.16 | 23.4 | 0.08 | 23.1 / 29.4 | 0 |
| `bo2` | 100% | 0.1078 | 0.0819 | 4.01 | 43.4 | 0.07 | 21.9 / 26.7 | 0 |
| `bo4` | 100% | 0.2119 | 0.1326 | 7.80 | 83.1 | 0.13 | 21.3 / 24.9 | 0 |
| `bo8` | 100% | 0.4198 | 0.2355 | 15.42 | 160.7 | 0.25 | 20.3 / 24.2 | 0 |
| `opus-high` | 100% | 0.1790 | 0.1790 | 2.17 | 52.7 | 0.04 | 45.6 / 89.8 | 0 |
| `sonnet-medium` | 100% | 0.0655 | 0.0655 | 2.13 | 27.5 | 0.04 | 29.1 / 34.4 | 0 |

**Decision, as fixed**: the best pass rate is 100%, so every arm is within 5 points. `bo1` is cheapest, and the next arm, `sonnet-medium`, is 16% dearer, so there's no tie. **Winner: `bo1`.** Among the five arms named in the request: **`sonnet-medium`**. Under the secondary proxies the order is the same. Per promoted candidate, calls run 2.13 (`sonnet-medium`) to 2.16 (`bo1`), and model-seconds run 23.4 (`bo1`) and 27.5 (`sonnet-medium`) against 52.7 (`opus-high`).

**Cost-matched**: `opus-high` costs 3.2× `bo1`, which falls between `bo2` (1.9×) and `bo4` (3.8×). At that cost, both tie Opus on pass (100%) and take half its p50 time (21–22 s against 46 s) and under a third of its p90 (25–27 s against 90 s). On failed candidates, the single smart attempt is better: 0.04 per promoted against 0.07–0.13. So at equal cost, parallel cheap attempts win on time and Opus wins on failed candidates. Neither beats a single cheap attempt once cost is counted.

## As-is view (26 needs, reported)

| Strategy | Pass rate | Cost per promoted | Failed per promoted | Time p50 / p90 s |
|---|---|---|---|---|
| `bo1` | 97.1% | 0.0584 | 0.22 | 23.2 / 29.3 |
| `bo2` | 99.5% | 0.1091 | 0.16 | 22.1 / 26.5 |
| `bo4` | 100% | 0.2129 | 0.16 | 21.4 / 24.7 |
| `bo8` | 100% | 0.4219 | 0.31 | 20.3 / 24.2 |
| `opus-high` | 100% | 0.1755 | 0.04 | 44.1 / 89.8 |
| `sonnet-medium` | 100% | 0.0651 | 0.04 | 28.3 / 34.4 |

The rule still picks `bo1` (97.1%, within 5 points). This is where best of n earns something: on H02, where 3 of 8 runs froze a wrong value, `bo2` reaches 89% and `bo4` 100% against `bo1`'s 62.5%. Two independent specifications rarely share the same arithmetic slip. Opus and Sonnet-medium had no spec errors here.

## Rival: correlated failures and saturation

pass@k from the 8 `sonnet-low` samples per need, against the independence curve 1 − (1 − p̄)^k:

| k | 1 | 2 | 3 | 4 | 5–8 |
|---|---|---|---|---|---|
| As-is, observed | 97.1% | 99.45% | 99.93% | 100% | 100% |
| As-is, independent | 97.1% | 99.92% | 100% | 100% | 100% |
| Decision view, observed | 99.5% | 100% | 100% | 100% | 100% |

- As-is, the observed curve sits 0.5 points below independence at k = 2 and saturates at k = 2. Failure ICC within a need is **0.18** (95% bootstrap interval −0.005 to 0.29): failures cluster on H02 (3/8) and H08 (2/8), with CC-007 at 1/8 and every other need at 0/8. That is some correlation, a need-specific way of misreading, but well short of "the same misunderstanding repeats". Two-thirds of the samples on H02 still froze the right value.
- In the decision view, one failure in 192 samples leaves nothing to correlate: ICC 0.
- Discrimination: best of n saturates quickly here, but the curve says why. With p near 0.97 per sample, there is almost no failure mass for extra samples to remove. Where there is (H02, H08), extra samples do remove it. The rival's mechanism, correlated failures capping best of n, isn't what limits it on these needs. A harder set, with pass@1 near 0.5, would be the test that discriminates.

## Router

Fit on 13 needs, judged on 11 held-out needs (decision view). Every held-out need fell in the `clean-before` groups, because the only P-56 `failed-before` needs that ran (CC-036, H08) landed in fit or were excluded. CC-002 and CC-025 were never reached.

| On held-out (decision view) | Pass rate | Cost per promoted | Time p50 s |
|---|---|---|---|
| `bo1` (best fixed arm) | 98.9% | 0.0548 | 21.4 |
| `sonnet-medium` | 100% | 0.0634 | 27.1 |
| `opus-high` | 100% | 0.1649 | 44.1 |
| `bo2` / `bo4` / `bo8` | 100% | 0.104 / 0.204 / 0.404 | 20.3 / 19.1 / 18.2 |
| **router, ε = 0.1, mean of 1,000** | 99.0% [98.9, 100] | **0.0688** [0.0548, 0.1012] | 21.4 |
| router, greedy | 98.9% | 0.0548 | 21.4 |
| oracle | 100% | 0.0562 | 21.5 |

**Bar: missed.** Pass is within 2 points (99.0% against 100%), but cost is 0.0688 against 0.0548. The precommitted exploration (one need in ten routed at random, including `bo8` at 7× the cost) explains the whole gap. The greedy router chose `bo1` for all 11 held-out needs and equals the best fixed arm exactly, which would meet the bar.

**Gap to the oracle**: undefined under amendment 1. The oracle maximizes pass first, so it buys `sonnet-medium` on CC-001 and CC-007 (where `bo1` lost a sample). Its cost per promoted, 0.0562, is above `bo1`'s 0.0548. The only gap is 1.1 points of pass, which `bo1` gives up to save 2.5% of cost.

**Per-need decisions, decision view**: greedy `bo1` on all of CC-001, CC-007, H01, C-016, C-010, C-006, CC-011, C-007, H07, C-015 and H06. The oracle picks `sonnet-medium` for CC-001 and CC-007 and `bo1` elsewhere. With exploration, each need gets `bo1` 88–92% of the time and each alternative about 2%. **The router never chose `opus-high` except by exploration** (1.6–2.8% per need).

**As-is view (reported)**: the router learned from H02 in fit (`H:clean-before`, `bo1` 5/8) that `bo1` is risky on fixed-interface needs. It routed H01, H06 and H07 to `sonnet-medium` and kept `bo1` for R needs and for H08 (`H:failed-before`, whose P-56 prior favoured `bo1`). Greedy: 96.9% at 0.0586, against best fixed `bo1` at 96.9% and 0.0570, and the best pass rate 100%. With exploration: 97.2% at 0.0725. Both halves of the bar miss in this view: H08's two spec errors fell on a need the router sent to `bo1`. The router did move off `bo1` where its evidence pointed (H needs after H02), but that evidence didn't carry to the held-out H needs, which `bo1` passed 8/8.

What the features showed: "failed before in P-56" didn't predict failure here. CC-036, P-56's worst need, went 8/8 for `sonnet-low`, and H02, clean in P-56 apart from Haiku, failed 3/8. Spec errors look like per-sample arithmetic slips more than properties of a need. That's why per-need routing has little to work with on this set, and why best of n removes them.

## Predictions

1. `bo1` 90–97% as-is, at least 95% decision, about 0.06 LEU: **held** (97.1%, 99.5%, 0.056).
2. `bo2` pass at least `bo1`'s, cost 1.8–2.1×, p50 10–25% lower: **pass and cost held (1.91×); time missed** (5% lower).
3. `bo4` cost 3.4–4.1×, p50 15–35% lower: **cost held (3.76×); time missed** (8% lower).
4. `bo8` cost 6.5–8.2×, time reduction at most 5 points more than `bo4`'s: **held** (7.46×; 12% against 8%).
5. `opus-high` 97–100%, cost 2.5–3.5×, p50 1.5–2.2×: **held** (100%, 3.18×, 1.97×).
6. `sonnet-medium` within 5 points, cost 1.05–1.3×: **held** (100%, 1.16×).
7. Winner `bo1`; among named arms `sonnet-medium`; `bo2`–`bo4` beat `opus-high` on time and match it on pass: **held**.
8. As-is observed pass@k below independence, saturating by k = 2–4, ICC above 0.3; decision view too sparse: **saturation and "below" held (narrowly), ICC missed** (0.18), decision-view sparsity held.
9. Router mostly `bo1`, other picks only in `failed-before` groups, meets the bar, closes under half the gap: **mostly `bo1` held; "only in failed-before" missed** (as-is it picked `sonnet-medium` for `clean-before` H needs); **bar missed**; gap undefined.
10. Zero escapes: **held**, 0 for every strategy (every promoted H candidate passed its held-out tests).

## Findings beyond the bars

- **Since P-57, the default loop undercounts failed candidates.** With `waits: 'release'`, each parked turn runs in a new cell job, and the `rounds` returned at the end hold only the last job's checks. A run that failed five checks and passed the sixth reports one passing round. This experiment used `waits: 'hold'` to count them. Any experiment reading `rounds` under the default (P-57 onward) undercounts failed candidates. Fix: carry rounds in the parked continuation. Not done here: it's a loop change.
- **Best of n gives the system a free frozen-test check.** The R-need branch of the classifier is the evaluator-synthesis design ("two agreeing references contradict a frozen test") with sibling candidates as the references. In a best-of-n race those siblings exist anyway, so a frozen test that two sibling kernels and the failing kernel all contradict could be flagged before six doomed repair turns. It needs its own precommit.
- **Time savings are small because Sonnet is consistent.** Within a need, `sonnet-low` walls cluster within a few seconds (CC-011: 15–17 s across all 8). The minimum of n samples saves little: `bo8` cuts p50 by 12% for 7.5× the cost. Best of n buys speed only where single-run time varies a lot, and here it doesn't.

## What this does not show

- 26 needs, 11 held out; one need is 4 points of pass on the full set and 9 on the held-out split. These pass rates can't separate arms closer than about 20 points. The cost differences (1.9× and up) are well outside the ~25% detectable difference.
- The needs are easy for every arm once frozen values are right: pass@1 is 97–99.5%. That leaves little for best of n or a router to win, and the rival can't be tested properly. A harder set is the next step.
- The races are replayed from timestamps over subsets of 8 concurrent runs, not run with live cancellation. `bo2` and `bo4` saw 10-way concurrency.
- `opus-high` and `sonnet-medium` have one sample per need.
- Loaded: 201 of 260 runs above load 16.
- CC-002 and CC-025, two of P-56's spec-error needs, and H03 weren't reached within the budget.
- One account, one evening. H needs and references were written by Opus 5.5, also an arm.
