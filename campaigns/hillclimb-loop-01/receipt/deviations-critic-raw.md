<!-- Deviation critic output, Codex CLI (config), reasoning high, sealed read-only directory; call deviation-na-all-0-critic-0001-mvdaart3; 2026-10-18T03:52:17.393Z -->

# Loop-1 deviation critique

**My first choice is D-02: turn ordinary output-review findings into one bounded repair cycle.** Loop 0’s binding problem was producing the right capability, not compiling it. Removing output review before showing that contract-time review catches the same defects is the draft’s largest unsupported bet.

All forecasts below are subjective, prospective estimates. Loop-0 evidence is pilot or probe evidence; it does not establish these effects on fresh requests.

## Comparison and decision rules

A “point” below means a percentage point: **+30 points means six additional clean promotions among 20 requests.** Forecasts compare each proposal with an otherwise identical control using the draft’s all-new configuration, except where explicitly stated.

Every proposed test uses the same 20 working requests, randomized and interleaved, and all three sealed oracles under the draft’s unchanged scoring and canary rules. Production agents receive ordinary production-review feedback only. They receive no oracle criteria, verdicts, canary contents, or sealed-request contents.

I use this common **win rule, W**:

- Net gain of at least **six clean promotions out of 20**.
- A two-sided exact paired sign test below 0.05 on clean improvements versus regressions. Six improvements and zero regressions qualify; a net gain of six does not always qualify.
- All existing guardrails and canary requirements pass.
- The preselected contrast replicates on the final 20 sealed requests before standardization.

The method’s observation that identical runs can differ by **20 points 23% of the time** makes a four-request advantage insufficient. Small forecast effects below are worth investigating, but will usually remain inconclusive in one loop. Only one contrast should be registered as the adoption test; the other factors are exploratory.

## D-02 — Repair the named change before promotion

1. **What the spec says.** `factory-README.md`, “Promotion to the user,” promotes a gated capability with accept-with-change as `promoted-pending-change`. The draft instead removes output personas in R-new and makes promotion equal gated.

2. **What the data says.** `loop0-factory-summary.json`, `counts`: **3** promoted-with-assumption, **15** promoted-pending-change, **1** gated persona rejection, **1** gate rejection. The hc-01 panel found the same **3/10** items clean under both strict and median rules. L-14 reports that handing ordinary persona findings into a rebuild repaired one rejection but failed to repair the other.

3. **The change.** Give every gated challenger one ordinary, blind output-persona review. Convert its actionable findings into a structured amendment: affected behavior, required change, and executable acceptance condition. Permit **one** repair campaign. For a contract change, retain the old frozen campaign, create a new contract/evaluator revision, freeze it, and generate one replacement candidate. Review that replacement once. Unresolved findings remain unresolved; renaming their status earns no clean credit.

4. **Predicted effect.** **+30 points; P(gain ≥30 points) = 0.40.** My expected gain is **4.5 requests/20**. This is aggressive: contract-time personas may already remove much of the repairable backlog.

5. **Cost relative to the draft.** Approximately **+17k tokens/request**, assuming half need repair: 5.9k initial review plus half of a roughly 22k amendment/evaluator, replacement, and re-review cycle. About **2.5 additional model calls/request** on average. At an 80% repair rate, budget roughly **+23k**, not +17k.

6. **One-loop test.** Clone the same 20 all-new artifacts into review-only and review-plus-repair branches. Shared artifacts before repair reduce generation noise. Score the final deliverables blind; apply **W**. Record repair cost and repair success separately, but do not adopt on those readable production metrics.

## D-04 — Admit a declarative workflow without requiring a new numeric kernel

1. **What the spec says.** E3 §5 permits declarative views, bindings, interaction tests, and result schemas. The operational protocol narrows every request to an AssemblyScript function over numbers (`factory-README.md`, steps 5–6). That operational restriction is the departure to remove.

2. **What the data says.** L-14 records **two** rebuilt persona rejections: one became usable with changes; the other still lacked the source the requester needed. The factory summary shows workflow gaps too: C-012 needs a pre-write report and confirmation; C-015 needs a visible action-to-qualification record. A numeric predicate alone does not deliver those workflows.

3. **The change.** Add a `declarative-workflow` artifact class: registered form fields, units, source bindings, result rendering, confirmation states, and calls to existing qualified functions. Allow **zero new kernel code**. Test it through the real renderer. Missing sources remain missing; a form asking the requester for the answer they sought does not count as completing the request.

4. **Predicted effect.** **+15 points; P(gain ≥15 points) = 0.30.** Expected gain: **1.5/20**, primarily on process and binding requests.

5. **Cost relative to the draft.** Budget **+6k tokens/request averaged across the set**, with workflow drafting inside existing generator calls and at most one additional call on routed requests. Renderer implementation and verification are additional fixed costs that the supplied receipts do not price.

6. **One-loop test.** Compare numeric-only and optional-workflow routing on all 20 working requests, preserving every request in the denominator. The panel operates the delivered workflow. Apply **W**. Do not substitute five specially harvested interface requests for the registered workload.

## D-06 — Compile the glue; preserve G7 as the checker

1. **What the spec says.** `factory-README.md`, step 6, makes each worker author the complete glue object. G7 then checks export descriptions, arity, precision, labels, assumptions, questions, and observed traps.

2. **What the data says.** L-14 reports **17/17** glue backfills with **zero kernel edits** and unchanged kernel hashes. This supports separating mechanical delivery construction from computation. It does **not** show that G7 is dispensable.

3. **The change.** Replace free-form glue authoring with a deterministic compiler. The model supplies semantic fields; code obtains export names and arities from the module and fills schema structure from registered templates. Missing semantic fields cause rejection. Keep G7 unchanged on the resulting artifact.

4. **Predicted effect.** **+5 points; P(gain ≥5 points) = 0.20.** Expected gain: **0.2/20**. The principal forecast is lower cost, not a large clean-rate improvement.

5. **Cost relative to the draft.** **−2k tokens/request**, with no additional model turn. Compiler engineering is a fixed, presently unpriced cost.

6. **One-loop test.** Use the same kernels and semantic payloads to produce worker-authored and compiled glue. Have the panel score both rendered deliveries. Apply **W** for adoption. Lower tokens with equal observed clean counts is an efficiency lead, not sufficient evidence of non-inferiority at n=20.

## D-07 — Buy one readable contrast before buying a stage screen

1. **What the spec says.** E3 §11 permits bounded search-policy challengers. The method prefers a factorial screen; the draft generates **80 artifacts** and derives **16 corners**.

2. **What the data says.** L-11 reports **18/20** first-pass gate successes. The method forecasts specification/review effects above generation/gate effects, while acknowledging the **23%** phantom rate for a 20-point difference. The draft budgets **2.9M tokens** for its screen against a **7.1M** total.

3. **The change.** Replace the stage screen with two complete manifests on the same 20 requests: incumbent and one preselected deviation. Preserve A/A, three-oracle scoring, and sealed confirmation. Do not allocate requests adaptively using oracle scores. This sharpens D-07 into a fixed primary comparison; loop 0 cannot validate an oracle-driven sequential allocator because it lacks replicated fresh-request oracle outcomes.

4. **Predicted effect.** Direct clean-rate effect: **0 points**; **P(gain ≥5 points) = 0.10**. Forecast total loop-token reduction: approximately **18%; P(reduction ≥15%) = 0.70**. This changes the cost of learning, not the capability itself.

5. **Cost relative to the draft.** Using draft smoke costs, 20 incumbent runs plus 20 all-new runs cost approximately  
   `20 × (26k + 55.6k) = 1.632M`, versus **2.9M**: a projected saving of **1.268M tokens**, before changes in judging cost.

6. **One-loop test.** Run the two manifests on 20 requests and score with three sealed oracles. The production deviation must satisfy **W**. For the design change itself, success means completing that same powered contrast for at least 15% fewer total tokens. That result cannot establish that the discarded interaction information was worthless.

## D-08 — Allow defaults only when the decision survives the ambiguity

*Original proposal.*

1. **What the spec says.** E3 §4 says to ask when underdetermined. The operational protocol nevertheless builds under a stated assumption and permits promotion-with-assumption (`factory-README.md`, step 9). The draft’s stub names an assumption and consequence tier but supplies no executable admissibility rule.

2. **What the data says.** L-11 found **20/20** requests underdetermined by the first rater and **9/10** by the second. The factory summary includes a diagnostic target of **10°F ±3°F** supplied by assumption, and an absent confirmer replaced with an owner. These are decisions disguised as missing parameters.

3. **The change.** Require an ambiguity table before freezing: missing fact, plausible alternatives, effect on the headline answer/action, and who can supply it. Permit a default only when alternatives preserve the proposed action and remain within the stated numerical tolerance. Otherwise require an explicit input or an unknown/refusal path. Ask about an observable fact the requester can supply, rather than an academic convention. Production briefs get this general policy, not copies of canary examples.

4. **Predicted effect.** **+20 points; P(gain ≥20 points) = 0.55.** Expected gain: **3/20**. Blanket refusal could instead reduce clean promotion; the panel must still judge task completion under its unchanged criteria.

5. **Cost relative to the draft.** **+0.8k tokens/request**, inserted into the existing stub and contract-revision calls; **zero additional turns**.

6. **One-loop test.** Hold reviewers, evaluator procedure, generator, gates, and output review constant; vary only the ambiguity policy. Apply **W**. Also report how many requests became conditional or refused, so apparent caution cannot hide lost useful capabilities.

## D-09 — Generate the second candidate only after the first fails

*Original proposal.*

1. **What the spec says.** E3 §10 says parallel candidates buy yield. E3 §11 says width must follow evaluator discriminating power. The draft pays for **two blind candidates on every G-new request**, selecting the first passing candidate.

2. **What the data says.** L-11: **18/20** first-pass gate successes, with two compile repairs. P-04b: Opus-low passed **12/12** type checks and Sonnet **11/12**. These are insufficient behavioral checks, but they give little support for unconditional width two.

3. **The change.** Generate one candidate, run its self-check and gates, and request a second independently framed candidate only after failure. Keep the same escalation ceiling. Choose neither candidate using oracle feedback.

4. **Predicted effect.** Clean rate: **−5 points; P(loss ≥5 points) = 0.25**. Expected change: **−0.2/20**. The intended benefit is lower cost with little quality loss, not better clean rate.

5. **Cost relative to the draft.** At a 90% first-candidate pass rate, save approximately **0.9 calls or 8.7k tokens/request** using the draft’s 9.7k candidate cost. Wall time rises on fallback requests because the second call becomes serial.

6. **One-loop test.** Generate both candidates for measurement, with their order preassigned. Construct width-two and conditional-width-one policies from those receipts and account for the calls each policy would make. Score both selected deliveries. A quality adoption requires **W**; a cheaper observed tie is a carry-forward hypothesis, not a one-loop win.

## D-10 — Qualify the evaluator’s representation before spending a generator turn

*Original proposal.*

1. **What the spec says.** E3 §6 requires qualified evaluators, but `factory-README.md`, step 3, accepts JSON test fixtures and step 7 repairs only kernel/glue. The draft adds property instances but does not explicitly require a representation-validation phase.

2. **What the data says.** L-11 and the factory summary attribute the sole initial gate rejection to **15/16 tests passing**: JSON could not represent NaN, and `null` became a valid zero input. L-04 records evaluator crashes on malformed output. L-05 reports **68.8%** mutant escape with universal gates alone.

3. **The change.** Add a versioned typed fixture representation for NaN, infinities, signed zero, and expected traps. Before candidate evaluation, validate fixture decoding, exception totality, and return schemas; run representation probes independent of candidate results. Reject an invalid evaluator with its own verdict. Never “repair” valid code to satisfy a malformed fixture.

4. **Predicted effect.** **+5 points; P(gain ≥5 points) = 0.45.** Expected gain: **0.6/20**. That is a forecast from one observed representation failure, not an estimated population rate.

5. **Cost relative to the draft.** Approximately **+0.6k tokens/request** for typed metadata and diagnostics; **zero additional routine turns**. Host-side checks add non-model work. Independent evaluator failures may require a separately metered restart.

6. **One-loop test.** Have the evaluator author emit equivalent legacy and typed procedures before any candidate exists. Run matched candidate generation against each frozen procedure. Score deliveries with the three oracles; apply **W**. More fixture checks passing alone is not a win.

## D-11 — Instantiate qualified invariant packs instead of resynthesizing covered evaluators

*Original proposal.*

1. **What the spec says.** E3 §§6 and 12 make reusable invariants the compounding asset. The factory protocol still writes per-request tests, while draft retrieval supplies prior request, interface, assumption, and **kernel** to the stub and generator.

2. **What the data says.** L-05: invariants reduced toy mutant escape from **68.8% to 35.4%**, killing **19/23** semantic faults where universal gates killed **0/23**. L-06: a disagreement input killed **58/68** escapees. L-13 identified **three duplicate pairs** across dew point, power conversion, and subcooling classification.

3. **The change.** For narrowly covered families, retrieve a versioned invariant pack and instantiate its procedure deterministically, replacing the evaluator drafting call. Packs contain applicability predicates, dimensional and metamorphic checks, boundary generators, and qualified anchors. Keep task-specific residual synthesis for uncovered behavior. Do not retrieve old defaults or code merely because a request looks similar.

4. **Predicted effect.** **+15 points; P(gain ≥15 points) = 0.35.** Expected gain: **1.4/20**. The toy escape figures support the mechanism, not this clean-rate magnitude.

5. **Cost relative to the draft.** At roughly one-third coverage, save about **3k tokens/request**, principally by avoiding the draft’s **9.3k** evaluator call on covered requests. Pack authoring and qualification are fixed costs and must be charged to the loop.

6. **One-loop test.** Freeze packs using open development material before working requests are read. Compare pack instantiation with fresh evaluator synthesis on all 20 requests, retaining uncovered requests in the denominator. Apply **W**. Report covered-family results separately without selecting the adoption denominator afterward.

## Ranking by expected gain per total cost

Cheap prompt changes look disproportionately attractive if the denominator excludes A/A, judging, and confirmation. For loop 1, those costs already dominate the budget.

The following ranking uses an explicit planning model:

- Unmodified draft challenger: **7 clean requests/20**, an assumption—not a measurement.
- Equal expected rates on the working and sealed sets: **14 clean promotions/40**.
- Draft total cost: **7.1M tokens**.
- Each proposal’s variable cost applies to those 40 requests.
- Expected gains are the means stated above; they are not the threshold multiplied by its probability.

| Rank | Proposal | Expected clean change per 20 | Projected loop tokens | Expected clean promotions per million tokens |
|---:|---|---:|---:|---:|
| 1 | D-02 Bounded repair | +4.5 | 7.780M | **2.96** |
| 2 | D-08 Decision-stable defaults | +3.0 | 7.132M | **2.80** |
| 3 | D-11 Invariant-pack instantiation | +1.4 | 6.980M | **2.41** |
| 4 | D-07 One primary contrast | 0 | 5.832M | **2.40** |
| 5 | D-04 Declarative workflows | +1.5 | 7.340M | **2.32** |
| 6 | D-10 Typed evaluator representation | +0.6 | 7.124M | **2.13** |
| 7 | D-06 Compiled glue | +0.2 | 7.020M | **2.05** |
| 8 | D-09 Conditional width | −0.2 | 6.752M | **2.01** |
| — | Unmodified draft | — | 7.100M | **1.97** |

These are conditional rankings. Unpriced workflow or invariant-pack engineering lowers D-04 or D-11. Additional oracle scoring lowers any proposal that creates extra distinct artifacts. Token rankings also need checking against model-specific list-price cost and wall guardrails.

**If only one deviation enters loop 1, choose D-02.** It attacks the largest observed backlog and tests whether findings can become useful capability rather than metadata. D-08 is the runner-up and the better choice if measured repair costs exceed the available budget.

Make D-02 concrete by replacing one hybrid S×G artifact branch with the repaired all-new branch. Retain incumbent, unrepaired all-new, and repaired all-new. Register repaired versus unrepaired as the primary contrast; treat the remaining stage comparisons as exploratory. Repair changes artifacts, so it must be modeled as a generation branch, not another post hoc R filter.

The central interaction hypothesis is:

> Contract-time review and output repair are substitutes for some intent defects, but complements for defects revealed by actual calls.

Record repair frequency under S-old and S-new to investigate that interaction. Adoption still depends exclusively on the sealed primary comparison.

## Disposition of the remaining seeds

- **D-01, app-derived demand:** carry forward. L-09 documents the current pool, but the supplied packet contains no prospective telemetry cohort. Changing request sources between arms would confound demand with factory quality.
- **D-03, collapse review:** reject as written. Oracle criteria cannot become production acceptance tests under the fixed honesty rules. Moving ordinary personas earlier is testable; removing output review needs evidence that D-02 can supply.
- **D-05, telemetry as rung-4 evidence:** defer. A call, an answered follow-up, and no escalation can support a use claim, but do not alone establish successful completion. No such telemetry is supplied.
- **D-06, remove G7:** reject removal; retain the compiled-glue variant above. The **17/17** backfills support mechanizing presentation, not abandoning its check.

## Blind spots

**The objective still lacks a representative denominator.** L-09 says the reserve is almost entirely chatbot calculations, including **36** keyword-selected calculation requests from March–April 2025 transcripts. Fresh reserve items can test generalization within that pool. They cannot establish current demand for manufactured tools, repeated use, or superiority to answering the question directly.

**The median panel has a structural majority.** Two Claude oracles can overrule the cross-family oracle. In hc-01, persona false acceptance was **0/9**, **1/9**, and **5/9** depending on the oracle. Unanimity on the three clean items is useful, but it does not resolve disagreement elsewhere. None of these deviations fixes the ruler; strict-versus-median disagreement should remain visible.

**The screen’s labels overstate causal separation.** S includes interface choice, assumption choice, personas, revision, and evaluator synthesis. G includes model, width, self-check, and escalation. All-old additionally shares authoring context between tests and code. A stage main effect cannot identify which constituent caused the gain.

**The scoring surface remains partly artifact-controlled.** Edge probes over every *stated* range do not guarantee checks over omitted applicability conditions or dependencies. A capability can avoid declaring the bound that would expose its weakness. None of the proposals fully solves independent domain coverage.

**Total cost is not yet a stable scalar.** P-04b shows **56.4 seconds** for Opus-low versus **65.6 seconds** for Sonnet, while their list-price costs favor Sonnet. Cached input, thinking, output, subscription scarcity, engineering, and review are different resources. The draft’s **8M-token** target is a budget; it is not yet an economic objective.

**The human-use claim remains out of reach.** Five selected all-new promotions exercised by consumer agents establish limited agent-corroborated use. They do not establish comparative success on failed requests, actual technician effort, or the lifetime economics of retaining the resulting inventory.