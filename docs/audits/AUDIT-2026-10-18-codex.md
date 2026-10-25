# Independent audit by Codex (GPT-6.1, reasoning high), 18 October 2026

Produced in a sealed read-only folder holding only the raw results (no web, no other paths, no orchestrator conclusions); 704,617 input tokens (627,456 cached), 9,198 output. Kept verbatim as data. Where it recommends a human trial (item 1), that conflicts with DEC-78 and is replaced in `docs/REPORT-2026-10-18.md` by agentic consumer completion.

1. **Measure speed to a completed task, and stop treating low acceptance as proof of a broken metric.**
   - **Evidence / response:** `loop1-consumer-use.json`: only **1/5** answered the question, **2/5** would be used; no human use. Speed experiments measure gated artefacts. `loop1-DECISION.md` instead prioritizes changing the ruler because clean acceptance is **1/20**.
   - **Miss / change:** The floor argument outruns its evidence: **1/20 → 7/20** can register the required +6 gain; statistical power is a separate question. Keep defect-sensitive acceptance, and measure completion time and total cost, including clarification, failed builds, repairs and consumption.
   - **Cheapest experiment:** Have one technician attempt five existing tasks with the delivered capabilities. Record completion, elapsed time and assistance required; compare these outcomes with the existing panel verdicts before rescoring 120 sheets.

2. **Check whether the proposed artefact can obtain its inputs and perform the requested action.**
   - **Evidence / response:** `loop1-DECISION.md`: **8/20 requests in each fresh set** are owner process rules that numeric kernels cannot answer. In `scores-s6.jsonl`, **all nine C-009 judgments** reject the commit-message checker; B/E require the caller to supply the attribution count being sought. D-04, broader artefacts, was deferred for renderer work.
   - **Miss / change:** Stratifying or refusing these requests protects measurement but leaves capability unrealized. Before synthesis, trace requested output back to available inputs and required effects. Route text checks, record queries and workflows to thin executable adapters rather than forcing numeric predicates.
   - **Cheapest experiment:** Give C-009 a wrapper accepting complete message text. Test ten messages end to end and compare usefulness, latency and tokens with the existing three arms. No general renderer is needed.

3. **Resolve consequential ambiguity before generating code; permit no clarification when none is needed.**
   - **Evidence / response:** `loop1-deviations.md` ranked D-02 first: expected **+4.5/20**, costing **17–23k extra tokens/request**. D-09 forecast **+3/20** for **0.8k**, without another turn—roughly **14–19× more expected gain per added token**, using its own forecasts. D-09 was deferred.
   - **Miss / change:** The ranking contradicted the stated gain-per-cost criterion. Across `scores-s5/s6.jsonl`, **136/351 judgments** reject assumption admissibility. Conversely, Codex marks C-002 **yes/yes/no** because elevation is an unnecessary question. Replace “always assume and ask” with an explicit ambiguity decision: harmless default, required input, source lookup, or no question.
   - **Cheapest experiment:** Revise only the stubs for six existing assumption failures and two complete conversions; hold generation and scoring fixed. Measure acceptance gained per added second/token.

4. **Build one traceable property-data core instead of repeatedly inventing thermodynamics.**
   - **Evidence / response:** `loop1-consumer-use.json`: CC-034 runs **2–9°F** off its reported chart. `loop0-persona-review.md` identifies **three duplicate pairs**. D-12 proposed invariant packs but was deferred.
   - **Contradiction / change:** The judges themselves lack consistent reference truth: `scores-s5.jsonl`, Opus on CC-034, requires approximately **−21.5°F at 15 psig**; `scores-s6.jsonl`, Sonnet on A/CC-005, rejects **−21.5°F** against **−25±3°F**. Resolve source, basis and tolerance once; share versioned tables, interpolation and validity limits across maker and evaluator while keeping independent checks.
   - **Cheapest experiment:** Adjudicate that single disputed lookup, then reuse the validated implementation across CC-034, CC-005 and CC-024. Check both accuracy and synthesis tokens saved.

5. **Validate executable contracts before freezing them—not merely arithmetic expectations.**
   - **Evidence / response:** `atomizer-RESULTS.md`: Infinity became `null`, causing failures in **4/5 requests**. `atomizer-CUTOVER.md` initially attributed **three R-02 failures** to arithmetic; replay found **one arithmetic error and two tests violating interface refusal rules**. S-09 changed **0/169 tests** despite the subsequent **6/6** success.
   - **Miss / change:** Another model arithmetic check does not establish evaluator correctness, and its causal benefit remains unproven. Use a typed contract representation for exceptional values, domains and refusal conditions; derive serialization and structural checks deterministically. D-11 already recognized part of this but remained deferred.
   - **Cheapest experiment:** Replay the three R-02 failures and the Infinity/NaN examples through a validator before any generation. Require it to catch representation and contract conflicts without rejecting valid boundary cases.

6. **Rebenchmark the router against the fastest current direct worker, with equal scope.**
   - **Evidence / response:** `baseline-rerun.json`: direct median **29.62 s**, **18/20 gated**, pool **101.1 s**. For the five S-01 requests, its derived median is **30.85 s**; `atomizer-SPEED.md` reports atomized **50.9 s**, **4/5 promotable**. These are different runs and specifications.
   - **Miss / change:** Summed-atom “speedup” is not improvement over direct execution. The claimed **40–60 s cutover** in `atomizer-CUTOVER.md` also outruns evidence: small requests never received templated planning, and the latest **6/6 wins** cover only **two distinct requests**. Route using measured completion, cost and scope—not an interpolated threshold.
   - **Cheapest experiment:** Run the five singles through current direct and templated arms against identical interfaces and independent acceptance procedures, at equal pool capacity; report retries and total tokens.

7. **Test localized repair before concluding that repair is ineffective.**
   - **Evidence / response:** `loop1-DECISION.md`: D-02 triggered **33 repairs**; both personas accepted **4/18 working** and **0/15 sealed** repairs; none became panel-clean. The full E path cost **94–99k tokens** and **159–188 s/request**. D-02 was recorded as lost.
   - **Miss / change:** This tests amended stubs, rewritten evaluators and replacement candidates—not small repairs. Regeneration can discard correct behavior while reviewers introduce another requirement. Classify each finding as implementation defect, contract defect, missing data or reviewer dispute; preserve unaffected behavior and repair only a demonstrable defect.
   - **Cheapest experiment:** Select three existing, reproducible defects. Compare a minimal patch with D-02-style regeneration under the same frozen requirement and regression checks; measure resolved findings per token and second.

8. **Use sequential panel decisions, with sampled full audits—an opportunity absent from the proposals.**
   - **Evidence / response:** `LESSONS.md` L-26 records **2.15M scoring tokens**. Derived from `scores-s5/s6.jsonl`, Opus and Codex already agree on **not-clean for 109/117 artefacts**; Sonnet cannot change those binary majorities. The program nevertheless scores every sheet three ways and proposes another full rescoring.
   - **Contradiction / change:** `oracle-calibration-hc01.md` claims every rater finds exactly the same three clean items; its table gives individual clean counts **4/5/4**. Three-item *panel* agreement is not individual calibration. Freeze a cross-family two-rater first stage; request the third judgment on disagreement, retaining randomized full-panel audits and ordinal measurements.
   - **Cheapest experiment:** Replay the existing scores: this preserves all **117 binary majority decisions** while avoiding **109/351 sheet judgments—31%**. Then meter one batch to establish actual token and latency savings.