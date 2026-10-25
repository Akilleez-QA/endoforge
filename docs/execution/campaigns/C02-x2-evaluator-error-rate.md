# C02 — E3 X2: evaluator error rate

> Reconstructed 2026-10-17. The original C02 was not available; this draft is rebuilt from
> Edition 3 (§6, §7, §8, §15), R14 X2, R15 (RISK-07, RISK-29) and R16 (DEC-43, DEC-44, DEC-49). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

This record drafts the precommit for Edition 3's second experiment: how often a synthesized evaluator is wrong, by request type, before and after a pass of invariant-library growth [E3 §15]. People grade the evaluators, not candidates. The result sets the starting autonomy tier for every domain.

## Summary

- Two synthesis passes of 100 tasks each: pass 1 with invariant library v0, then one library-growth step, then pass 2 on fresh tasks of the same types [R14 X2].
- One primary metric: evaluator error rate on determinate requests in pass 2. Kill: above 5 % [E3 §15].
- At n = 100, only 0–1 errors certify below 5 % and only 10 or more errors exceed it; 2–9 errors are indecisive (Derived, R14). The kill reads the point estimate; certification needs the bound.
- Edition 3 says "one pass" in the design and "two library passes" in the kill rule (E3-12). This record reads "two passes" as the two synthesis passes around one growth step, and says how to switch reading.
- **Seed task set (added 2026-10-17):** the X1 pilot's 20 contracts and their frozen executable tests (`campaigns/x1-spec-study/work/factory/<id>/`, hashes in `receipt/factory-summary.json`), the 41 persona verdicts and the two rejections (C-006 v1: unsafe default; CC-011: answered a question not asked) are the first 20 of pass 1's 100 tasks and the first graded examples. Before any grading, the residual-counting rule is tightened (§5): the pilot's two raters disagreed on the residual count for 7 of 10 blind items.

## Record header

| Field | Content |
|---|---|
| Record | C02 |
| Status | Draft — not registered |
| Stage | 1 (parallel with Stage 0) |
| Work packages | WP08 (study kit, including the hand-authored invariant list v0 and its growth step; no Stage 2 package is needed); WP06 when available (evaluator hashes re-entered in the ledger). WP10 later ports the list; it is not a dependency. Decision point DP-3 (second X3 domain) must be recorded before freeze, because the task set must cover it |
| Risk or decision addressed | RISK-07 (correlated evaluator error), RISK-29 (silent, credentialed evaluator error), RISK-12; DEC-43, DEC-44, DEC-49 |
| What cannot be known yet | The 80 non-seed tasks of pass 1 and all of pass 2, synthesis model and version, graders, the fraction of tasks that are determinate (the 20 seed tasks were 20/20 underdetermined by their specifier, so the determinate share of pass 1 may be low; Pilot (not a registered result), C01 §16). If the pass-2 determinate n falls below 100, pass 2 is extended with fresh tasks of the same types until it reaches 100 (§7); the kill rule is never read on fewer |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c02-x2-evaluator-error-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | E3 X2 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | How often is a synthesized task residual wrong (accepts a behaviour the request rules out, or rejects one it requires), by request type? It decides the starting autonomy tier for every domain |
| Hypothesis and predicted observable | Design assumption under test (Proposed): on determinate requests, after library growth, the error rate is at most 5 %, and library growth lowers it. Observable: two blind grades per evaluator |
| Strongest rival | Correlated error: the synthesizing model reads the request the same wrong way a candidate would, so errors persist regardless of library growth [E3 §6]. A pass-2 rate no lower than pass 1, or concentrated in one request type, favours it |
| Claim-ladder rung | Rung 3, error-rate half only [E3 §17]. It cannot move rung 3's escape-rate half (C03) |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Evaluator error rate = pass-2 determinate evaluators graded wrong after adjudication ÷ pass-2 determinate evaluators graded |
| Decision rule | Read only once at least 100 pass-2 determinate evaluators are graded. Kill if the point estimate exceeds 5 %, that is 6 or more errors in 100 (see §9); 6–9 errors is a kill labelled "point-estimate decision" because the interval straddles 5 %; 10 or more is a kill on the bound. A domain may be described as "below 5 %" only if its one-sided 95 % upper bound is below 5 % (needs 0 or 1 errors at n = 100). Between 2 and 5 errors of 100 the campaign passes the kill rule and the rate is reported as indecisive about 5 %: every domain then starts Confirmed and no autonomous tier is granted on this evidence (the tier comes from C03). What X2 can decide: whether any autonomous tier is possible now (the kill). What it cannot decide: a per-domain certification below 5 % with 25 tasks per type (upper bound 11.3 % at zero errors), or behaviour under search (C03) |
| Secondary metrics | Error rate by request type; pass 1 versus pass 2; Cohen's κ between graders; fraction of evaluators passing qualification (all seeded faults rejected, anchor accepted, deterministic); error direction (false accept versus false reject) |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| Σ — Candidate-blind synthesis | POODO-framed synthesis of the task residual in a fresh context with no candidate visible; model, version, temperature and prompt template TBD at freeze | Prompt template and SDK context SHA-256 TBD at freeze | Fresh context per task | Separate model context; no candidate in its inputs (input manifest hashed) | Tokens and wall time per synthesis recorded |

Control arm: none. Null arm: none.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | This campaign's subject. Each residual is hashed before any grader sees it; context id and input manifest stored (WP06 when available) |
| Acceptance boundary | Grading rubric (SHA-256 TBD at freeze): an evaluator is correct when it accepts every correct behaviour and rejects every incorrect behaviour the request implies, judged against the request text and the person's examples. Each evaluator is also run against its qualification set: seeded faults, a known-good anchor where one exists, determinism. **Residual-counting rule, fixed before grading:** a residual assertion is one executable test row that constrains the observable; rows that only pin the stated assumption and rows that only establish a trap or refusal at the domain edge are counted separately and are not residual size. Graders apply this rule before the correctness grade, because a wrong residual count was the commonest rater disagreement in the X1 pilot (7 of 10 blind items; C01 §16). A test file that cannot carry a value its tests need (the pilot's CC-001: JSON cannot carry NaN, and the WASM boundary read `null` as 0) is graded as an evaluator defect, not as a candidate failure (L-04) |
| Independent validator | Two graders per evaluator, blind to each other and to the synthesis transcript; a third person adjudicates disagreements |
| Parity rule | Grader disagreement is reported (κ) and adjudicated; the adjudication log is part of the receipt |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | Pass 1: 100 tasks, of which the first 20 are the X1 pilot's seed set: the 20 frozen contracts and their executable tests (contract and test hashes in `campaigns/x1-spec-study/receipt/factory-summary.json`; text under git-ignored `work/`, DEC-68), each carrying its stated assumption and recorded question, the 41 persona verdicts (16 accept, 24 accept-with-change, 1 reject after the re-runs) as prior grading evidence, and the two rejections as known-defect examples: C-006 v1 (an unsafe default equipment class for an A3 charge limit) and CC-011 (a cost formula for a price question; no kernel holds the price). These 20 are the pilot's self-specified contracts, not candidate-blind syntheses in the §4 sense, so they are graded as a labelled seed stratum and reported separately from the 80 fresh pass-1 tasks. Pass 2: 100 fresh tasks of the same request types, none visible during library growth, extended with further fresh tasks until 100 are determinate. Each task labelled with request type and determinate/ambiguous (two raters). Domain mix: refrigeration engineering claims and the DP-3 second X3 domain (each with enough determinate tasks that C03 can draw at least 105 per domain across C02's two passes and WP11's base candidates), plus at least one other request type (TBD at freeze). Task set SHA-256 TBD at freeze. The invariant list v0 used in pass 1 and the growth diff used before pass 2 are hand-authored files hashed into the precommit (WP08 deliverable 5); they are not WP10 |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | Pass-2 tasks are held out from the library-growth step; digest only until pass 2 starts |
| Seeded faults | Per-evaluator qualification: about 20 seeded faults per task from WP11 strata S1–S2 where the generator is ready, otherwise hand-seeded (swapped units, dropped rows, off-by-one, reversed inputs [E3 §6]); proportions TBD at freeze |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One task's evaluator |
| Planned n | 200 evaluators (100 per pass) plus the pass-2 extension needed to reach 100 determinate evaluators; primary on the determinate subset of pass 2 |
| Power calculation | One-sided 95 % exact bounds at n = 100: 0 errors → 2.95 %; 1 → 4.66 %; the lower bound exceeds 5 % only at 10 or more errors (Derived, R14 X2). Per request type, 25 tasks cannot certify below 5 % even with no errors (upper bound 11.3 %). At n = 400 the indecisive band narrows to 13–27 errors |
| Minimum samples | 100 determinate evaluators in pass 2 for any certification statement; fewer is reported as a screen only |
| Randomisation | PRNG `ifl-prng` from WP01 (`LAB/harness/lib/prng.mjs`); seed TBD at registration; schedule SHA-256 recorded before the first job |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Not applicable: this campaign makes no machine-timing claim |
| Steady-state rule | Not applicable: this campaign makes no machine-timing claim |
| Warm-up | Not applicable: this campaign makes no machine-timing claim |
| Placement | Not applicable: this campaign makes no machine-timing claim |
| Quiet gate | Not applicable: this campaign makes no machine-timing claim |
| Calibration | The grading rubric is calibrated on 10 practice evaluators (excluded from the analysis) with known defects before grading starts; the X1 pilot's two rejected contracts (C-006 v1, CC-011) and its CC-001 test-format defect are three of the ten |
| Accounting cross-check | Not applicable: this campaign makes no machine-timing claim |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | All evaluators graded; synthesis model unavailable or changed version mid-campaign (stop; restart is a new campaign) |
| Kill criterion | Above 5 % evaluator error on determinate requests after two library passes [E3 §15], read as 6 or more errors in at least 100 pass-2 determinate evaluators (§3): no autonomous tier anywhere; every domain starts Confirmed |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | TBD at freeze from the pilot; ceilings per attempt from the WP03 record |
| Model | Synthesis model and version TBD at freeze; token ceiling TBD at freeze (about 200 syntheses plus qualification) |
| People | Two graders × 200 evaluators at about 10 minutes each is about 67 person-hours, plus adjudication (Estimated) |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Not performance-relevant. Recorded at registration: the model identity and version used for any synthesis, the SDK and prompt-template hashes, the worksheet and analysis-script hashes, and the repository head (dirty tree refused).

## 12. Artifact identity

Task sets, rubric, synthesis prompt template, every residual (content-addressed), qualification sets, analysis script (WP08).

## 13. Failure meaning

A kill means a synthesized residual cannot yet carry promotion without a person; it does not mean synthesis is useless as a draft. A pass does not establish an escape rate (C03), and an error rate measured under random grading says nothing about behaviour under search [E3 §11]. If the alternative reading of "two library passes" (three synthesis passes) is adopted at review, a pass 3 of 100 fresh tasks is added before registration, not after.

## 14. Monitoring and rollback

This campaign makes no machine-timing claim, so there is no quiet gate or cgroup readback to watch. The study lead checks daily that every residual was hashed before any grader saw it and that no synthesis context manifest names a candidate. A partial grading set is kept as evidence and never stitched into another campaign [RECEIPT §1].

## 15. Signatures and hash chain

| Field | Content |
|---|---|
| `precommit.sha256` | TBD at registration |
| Spec hash | TBD at registration |
| Parent hashes | Predictions: this record. Calibration receipt: TBD at registration. Evaluator: TBD at freeze. Workload: TBD at freeze |
| Approvals | Person approving the precommit (and the residual, where one exists): TBD at registration |
| Chain rule | Every evaluation request and the summary cite the precommit hash; `SHA256SUMS` covers every file; a mismatch invalidates the receipt set |

## Edition 3 alignment

- New in Edition 3: specification as a subsystem with a measured error rate [E3 §6, §15].
- Uses POODO as proposer discipline and receipt schema, not as an evaluator (DEC-49; E3-21).
- Added 2026-10-17: the X1 pilot's "capability plus question" product (L-11) means most seed evaluators are correct only under a stated assumption; Edition 3 §6's "the person confirms a sentence" becomes "the person answers the recorded question", which C02 grades as part of the evaluator (does the question name the missing fact?). This is an Edition 4 input (`CRITIQUE-2026-10-17-reconcile.md`).

## Open questions

- How is "determinate" decided without biasing the sample? This record uses two raters before synthesis.
- Can the second X3 domain (DP-3) supply 100 determinate tasks with known-good anchors in time for freeze? If not, C02 runs on refrigeration alone and C03 registers for one domain, as `EXECUTION-PLAN.md` §7.1 says.
- Does the synthesis model also generate candidates in later campaigns? If so, correlated error is the dominant risk; C17 compares synthesis placements. In the X1 pilot the same agent wrote the contract, the tests and the kernel (DEC-71), which is the correlated case; the seed stratum is graded knowing that.
- Is "determinate" the right split when an agent specifier records an assumption and a question for every request (20/20 in the pilot)? This record keeps the two-rater determinate flag for the primary and adds "determinate given the stated assumption" as a secondary label for the seed stratum, so the pilot's contracts can be graded for correctness under their own assumption.


## Sources

- Edition 3 §6, §7, §8, §15.
- R14 X2; R15 RISK-07, RISK-29; R16 DEC-43, DEC-44, DEC-49, DEC-68, DEC-71; `docs/coverage/EDITION-3-ERRATA.md` E3-12, E3-21.
- C01 §16 (pilot); `campaigns/x1-spec-study/receipt/{factory-summary.json,persona-review-summary.md,notes.md}`; `docs/execution/LESSONS-LOG.md` L-04, L-11, L-13, L-14.
- `~/Work/isolate-factory-lab/tests/calibration/c6.mjs` (mutant-rejection pattern).
