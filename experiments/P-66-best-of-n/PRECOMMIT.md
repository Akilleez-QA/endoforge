# P-66 best of n against one smart attempt, and a router between them: precommit

Label: **Proposed** procedure, frozen 2026-11-07 before the first experiment call. Its SHA-256 is in [receipt/precommit.sha256](receipt/precommit.sha256), and [run.mjs](run.mjs) refuses to run when the file differs.

Question: at equal cost, do several cheap attempts in parallel beat one smart attempt, judged by failed candidates and time to the first promoted candidate? Craig's framing: there is a level of intelligence that is good enough for the work, and past it we spend on speed. Craig's later direction, which this file includes from the start: "for stuff like this we should have both and the correct one deployed where it makes sense by the system and not the user". So every arm stays a selectable strategy, and a router picks one per need from what the system knows before generation.

## What carries over from P-56-model-effort

The loop, needs, held-out checks and account handling are P-56's: the P-50 agent loop (`ENDOFORGE_LOOP=agent`, 6 turns and 64,000 tokens per stage, process cell), the 30 needs in [needs.mjs](../P-56-model-effort/needs.mjs) (20 R needs verbatim from the atomizer `baseline-20` runs, 10 fixed-interface H needs with 88 held-out tests), and [heldout.mjs](../P-56-model-effort/heldout.mjs). Two differences: the loop pools use `waits: 'hold'`, because under the default `release` mode since P-57 a run's returned `rounds` only cover checks from its last turn, so failed candidates would be undercounted (the model sees the same prompts either way); and each need's runs all start at one barrier, so concurrent runs of a need share conditions.

P-56's own rows are used only as the router's prior and for its "failed before" feature. They are not acceptance data: the loop on main has changed since (P-52 gates, P-57).

## Account and budget

Model calls only through `claude -p` (the warm transport) on the default subscription login: `CLAUDE_CONFIG_DIR=/home/akilleez/.claude`, with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` unset, which the runner checks. `claude auth status` must report `loggedIn` true and `authMethod` `claude.ai` before the run and before every need. The transport environment check from P-56 runs once. No API keys, no API billing, no second account.

**Budget: at most 600 model calls (transport turns)** for everything in this file. The runner counts each call and refuses any call past 600; a need with a refused call is incomplete and left out of every analysis. Smoke runs use a stand-in CLI and make no model calls. A halt: two consecutive needs each with two or more transport errors other than the loop's own token budget.

## Arms and runs

Per need, ten runs start together:

| Run | Model | Effort | Count |
|---|---|---|---|
| `sonnet-low` | sonnet (`claude-sonnet-5-5`) | low | 8 |
| `opus-high` | opus (`claude-opus-5-5`) | high | 1 |
| `sonnet-medium` | sonnet | medium | 1 |

Strategies, all computed from those runs:

- `bo1`, `bo2`, `bo4`, `bo8`: `sonnet-low` ×n in parallel; the first candidate the real gates promote wins and the others are cancelled at that moment. Each is evaluated exactly over every n-subset of the need's 8 recorded samples (8, 28, 70 and 1 subsets) and averaged. `bo1` is one cheap attempt and is included as a reference arm and a router option. The race is replayed from recorded timestamps, not run with real cancellation; the 8 samples ran concurrently, so `bo2` and `bo4` saw the contention of 10 concurrent runs rather than 2 or 4.
- `opus-high` ×1: the smart attempt (Opus at the highest effort P-56 ran).
- `sonnet-medium` ×1.
- `router`: picks one of the six above per need (below).

**Promoted** means promoted by the unchanged gates (G1–G7 and the ledger), as in P-56. For H needs, held-out results of the winning candidate are reported as escapes; they don't decide the race.

## Cost, defined before measuring

The proxy for subscription usage is **list-equivalent usage (LEU)**: each `claude -p` reply's increment in the CLI-reported `total_cost_usd`, which is the reply's input, output and cache tokens weighted by the model's list rates. It is not a charge; it's used because subscription usage counts Opus tokens above Sonnet tokens, which raw tokens and calls don't. Secondary proxies, reported but not deciding: calls, model-seconds (sum of reply durations) and tokens.

Cancellation: a cancelled run is charged every reply it began before the winner's promotion time, the in-flight reply in full (the transport can't recall a reply mid-turn). A lower bound counting only finished replies is reported beside it. A race with no promotion is charged all replies of all its runs. Failed candidates are implementation check rounds that failed, in any run of the race, at or before the cancellation time; a round's time is the end of the reply that triggered it (the last k replies of a run trigger its k rounds).

## Frozen-test errors: fixed or excluded first

P-56 found 30 of 38 failed candidates came from five specifications that froze a wrong value. Nothing on main flags a suspect frozen test: the evaluator-synthesis follow-up ("report a frozen test that two qualified, agreeing references contradict") is designed, not built. So this file classifies each failed run mechanically and identically for every arm, in [classify.mjs](classify.mjs), by rerunning the gates on its final candidate:

- H needs: **frozen-wrong** when a frozen test the final kernel fails is contradicted by the need's reference function (value outside max(tol, 1e-6·max(1,|ref|)), or trap against value).
- R needs: **frozen-wrong** when, for a frozen test the final kernel fails, at least two promoted candidates from other runs of the same need (any arm) export the same function and arity, agree with this kernel's output, disagree with the frozen expectation, and make up more than half of the usable siblings. This is the synthesis design with sibling kernels as the independent references.
- Otherwise the failure is ordinary.

**Decision view**: needs where any run's failure is frozen-wrong are excluded for every arm. **As-is view**: all complete needs. The decision rule and the router bar are judged on the decision view; the as-is view is reported beside them, because it shows what best of n buys when a specification is wrong.

[selftest.mjs](selftest.mjs) is the control: the race accounting, pass@k, the intraclass correlation and the decision rule on hand-made inputs, and the classifier flags a seeded wrong expectation by reference (H) and by two siblings (R) and does not flag it with one sibling.

## Needs, order and splits

All 30 needs, in an order shuffled with a seed of this file's hash ([order.mjs](order.mjs)). Splits alternate within kind in that order: the 1st, 3rd, 5th… H need and R need go to **fit**, the others to **held-out**. Needs run in order until the budget refuses a call. Expected: about 25 calls per need (P-56: 2.5 calls per `sonnet-low` run, 2.3 per `opus-high`, 2.4 per `sonnet-medium`), so about 23 complete needs, roughly 12 fit and 11 held-out, fewer in the decision view. The budget can't cover a larger held-out split; that's the size.

Minimum detectable difference, stated now: one need is about 4 points of pass rate on 23 needs, and 9 on 11 held-out needs, so the 5-point and 2-point tolerances amount to "no more needs failed than the best arm, or one more". Differences in pass rate under about 20 points are not statistically distinguishable at this size. For cost per promoted, P-56's per-run LEU CV was 0.24 (Sonnet) to 0.33 (Opus); a paired ratio over 23 needs has a standard error near 8%, so cost differences under about 25% are not reliably detected. `opus-high` against `bo1` (about 3×) is; `opus-high` against `bo4` may not be.

## Measures, per strategy (computed by [analyze.mjs](analyze.mjs))

1. Pass rate per need: share of needs with at least one promoted candidate (expected over subsets for best of n).
2. Time to first promoted candidate, p50 and p90, over promoted races, from the barrier.
3. Failed candidates per promoted candidate.
4. Cost per promoted candidate: total LEU over all races, including failed ones, divided by promoted races. Also calls, model-seconds and tokens per promoted, and the cancellation lower bound.
5. Escapes (H needs) and accepted rate.

## Decision rule (fixed arms, decision view, all complete needs)

The arm with the lowest cost per promoted candidate wins, provided its pass rate is within 5 points of the best arm's. Arms within 10% of that cost are tied, and the tie goes to the lowest p50 time to promotion. Computed over all six fixed strategies, and separately over the five arms named in the request (`bo2`, `bo4`, `bo8`, `opus-high`, `sonnet-medium`).

## Strongest rival and how it's discriminated

Rival: failures are correlated across samples of the same model, because the same misunderstanding repeats, so best of n saturates quickly. Discriminators, both views:

- pass@k for k = 1…8 from the 8 `sonnet-low` samples per need (unbiased estimator 1 − C(8−c,k)/C(8,k), averaged over needs), against the independence curve 1 − (1 − p̄)^k with p̄ the pooled sample success rate. Correlated failure puts the observed curve below independence and flattens it early; the k where it comes within 1 point of pass@8 is reported.
- Intraclass correlation of failure within a need (one-way ANOVA estimator), with a 95% bootstrap interval over needs. Near 0: failures are independent and best of n keeps paying; near 1: a need is either always passed or never.

## Router

Strategies: `bo1`, `bo2`, `bo4`, `bo8`, `opus-high`, `sonnet-medium`. Implemented in [router.mjs](router.mjs).

- **Features, known before generation**: kind (H fixed-interface kernel against R free-form need, which carries glue and often code tables and units), and past failure class from the ledger the system already has: whether any non-Haiku P-56 run on this need failed. These make four groups. Need-text measures (length, unit or code-table mentions) aren't used: four groups over about 12 fit needs is already thin.
- **Prior**: per group, from P-56's non-Haiku rows: `bo1` pass and cost from `sonnet-low`, `opus-high` and `sonnet-medium` from their own arms; `bo`n pass 1 − (1 − p)^n and cost n × `sonnet-low` cost, which is the independence assumption the rival disputes and which the fit split corrects. A group with no P-56 run of an arm uses that arm's overall rate. Prior weight: 2 needs, as Beta pseudo-counts for pass and a pseudo-mean for cost.
- **Fit**: every fit-split need adds its measured expected pass and LEU for every strategy to its group.
- **Choice**: estimated pass p̂ (Beta mean) and cost ĉ per strategy in the need's group; feasible strategies have p̂ at least the best p̂ minus 2 points; pick the lowest ĉ / p̂ among them.
- **Online, held-out**: needs come in a seeded random order; after each, the chosen strategy's estimate in that group is updated with that need's outcome (bandit feedback, only the chosen strategy). Exploration is bounded: with probability 0.1 a uniformly random other strategy is used instead. Scored as the mean over 1,000 seeds (order and exploration), with the 5–95% range. The greedy router (no exploration, held-out in run order) is reported too.
- **Oracle**: per held-out need, after the fact, the cheapest strategy among those with that need's highest pass.

**Router bar** (decision view, held-out needs only): the router's cost per promoted candidate is at most that of the best single fixed arm, the one the decision rule above picks on the same held-out needs, and its pass rate is within 2 points of the best fixed arm's pass rate there. Reported: its gap closed toward the oracle, (C_best − C_router) / (C_best − C_oracle), and every per-need routing decision, including where it picks `opus-high`.

## Predictions

1. `bo1`: pass 90–97% as-is and at least 95% in the decision view; cost per promoted about 0.06 LEU.
2. `bo2`: pass at least as high as `bo1`, cost 1.8–2.1× `bo1`, p50 time 10–25% lower than `bo1`.
3. `bo4`: cost 3.4–4.1× `bo1`, p50 time 15–35% lower than `bo1`.
4. `bo8`: cost 6.5–8.2× `bo1`, p50 time reduction against `bo1` no more than 5 percentage points larger than `bo4`'s (saturating).
5. `opus-high`: pass 97–100%, cost 2.5–3.5× `bo1`, p50 time 1.5–2.2× `bo1`'s.
6. `sonnet-medium`: pass within 5 points of the best, cost 1.05–1.3× `bo1`.
7. Winner over all six: `bo1`. Winner among the five named arms: `sonnet-medium`. Among cost-matched options near `opus-high`'s cost, `bo2`–`bo4` beat it on time and match it on pass.
8. Rival: observed pass@k sits below the independence curve and saturates by k = 2–4; failure intraclass correlation above 0.3 as-is. In the decision view there are too few failures for a stable estimate, and that's reported as such.
9. Router: picks `bo1` for most needs and something else only in the "failed before" groups; it meets the bar with cost within 5% of the best fixed arm and closes less than half the oracle gap.
10. Escapes on H needs: 0 for every strategy.

## What a miss means

Misses are reported as misses. No retuning of the rule, the needs, the classifier, the router or the arms after the first call. A failed run is a recorded failure; only the precommitted classifier decides the decision-view exclusion. Changes after this point go in a dated amendment at the end of this file, committed before the runs or analysis they affect.

## Load and timing

1-minute load average at each run's start and end. A run above 16 at either is labelled loaded; time to promotion is mostly remote model time, so loaded runs are reported but not used as acceptance figures for non-model time, which this experiment doesn't decide on.

## Stop condition

The run stops at the call budget (600), at the end of the need list, or at the halt rule. Analysis uses complete needs only.

## Limits

One account, one machine, one evening. The race is replayed, not run with live cancellation, and a cancelled call isn't refunded mid-reply. `opus-high` and `sonnet-medium` have one sample per need, so their pass rates are per-need 0/1 and the rival is tested on `sonnet-low` only. H needs and references were written by Opus 5.5, also an arm. The router is fitted and judged on about a dozen needs each; its result is a probe of the mechanism, not a stable policy.

## Amendment 1, 2026-11-07, during the main run and before the analysis

A check of `analyze.mjs` on the first four complete needs (all strategies passed all four) showed the gap-closed ratio is unstable when the best fixed arm is already almost the oracle: a denominator of a fraction of a cent turned a small cost difference into −1,082. Gap closed is now reported as undefined when C_best − C_oracle is under 1% of C_best. Nothing else changes: the router, the bar (still judged on the exploring router's mean), the rule and the classifier are as frozen. That check is the only look at results before this amendment.
