# C17 — Local versus hosted evaluator synthesis

> Reconstructed 2026-10-17. The original C17 was not available; this draft is rebuilt from
> Edition 3 (§6, §7, §10), R09, R14 X2, R15 (RISK-07, RISK-18) and R16 (DEC-43, DEC-56). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

Edition 3 sends short calls, including criterion drafting, to local inference, and keeps large generation on whichever model has the best yield [E3 §10]. Residual synthesis is the one component with nothing above it [E3 §8], so placing it locally is only acceptable if local residuals are not worse. This record compares evaluator error rates of locally and hostedly synthesized residuals on the same tasks, graded as in C02.

## Summary

- Paired by task: each task's residual synthesized twice, once locally and once hosted, both candidate-blind.
- One primary metric: difference in evaluator error rate, local minus hosted, on determinate tasks. Non-inferiority margin 5 points (Proposed).
- 246 tasks give power 0.8 for that margin if about 10 % of pairs are discordant (Derived from an Estimated discordance).
- Secondary of interest for RISK-07: whether a synthesizer from a different model family than the candidate generator lowers escapes.

## Record header

| Field | Content |
|---|---|
| Record | C17 |
| Status | Draft — not registered |
| Stage | Stage 6+ / optional (needs C02 and a local model; residual synthesis stays hosted until it runs; moved from 3 by the 17 Oct critique) |
| Work packages | WP08 (grading kit), WP24 (local inference), WP06, WP11 (qualification faults) |
| Risk or decision addressed | RISK-07 (correlated evaluator error), RISK-18 (inference dominates latency); DEC-43, DEC-56 |
| What cannot be known yet | Local and hosted models; the discordance rate (sets n); grader availability at this scale |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c17-synthesis-placement-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | Follow-on to E3 X2 and X5 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | Are locally synthesized task residuals no more than 5 points worse in error rate than hosted ones? It decides where residual synthesis runs |
| Hypothesis and predicted observable | Proposed: for thin residuals over a mature invariant library, local synthesis is non-inferior. Observable: blind grades of paired residuals |
| Strongest rival | Smaller local models misread requests more often, and their errors are silent and credentialed [E3 §7] |
| Claim-ladder rung | Rung 3 (error-rate half) for the local placement |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Difference in evaluator error rate = (local residuals graded wrong ÷ determinate tasks) − (hosted residuals graded wrong ÷ determinate tasks), paired by task |
| Decision rule | Local synthesis allowed if the one-sided 95 % upper bound of the difference is below 5 points (McNemar-based interval). Otherwise residual synthesis stays hosted |
| Secondary metrics | Synthesis latency per arm (time to frozen residual); qualification pass rate per arm; seeded-fault escapes when the synthesizer and candidate generator share a model family versus not |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| L — Local synthesis | Local model on the target host (from C05), POODO framing, candidate-blind context | Weights and template digests TBD at freeze | Resident model | Separate context | Tokens and wall time |
| H — Hosted synthesis | Hosted model (TBD at freeze), same template | Model identifier TBD at freeze | Provider cache recorded | Separate context | Tokens and wall time |

Control arm: H. Null arm: none.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | This campaign's subject; every residual hashed before grading |
| Acceptance boundary | As C02's grading rubric (reused by hash) |
| Independent validator | Two blind graders per residual, blind also to arm; adjudication |
| Parity rule | Grader disagreement reported (κ) |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | 246 determinate tasks of the slice domain and C02's request types, not used in C02; task set SHA-256 TBD at freeze |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | none |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One task (paired residuals) |
| Planned n | 246 tasks; a pilot of 40 estimates discordance and resets n before the official run |
| Power calculation | Paired proportions, one-sided α = 0.05, power 0.8: discordance 10 % with margin 5 points needs 246 tasks; 15 % needs 369; margin 3 points at 10 % needs 685 (Derived, normal approximation to McNemar; discordance Estimated) |
| Minimum samples | Pilot-reset n, not below 120 |
| Randomisation | PRNG `ifl-prng` from WP01 (`LAB/harness/lib/prng.mjs`); seed TBD at registration; schedule SHA-256 recorded before the first job |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Not applicable: this campaign makes no machine-timing claim for the primary |
| Steady-state rule | Not applicable: this campaign makes no machine-timing claim |
| Warm-up | Not applicable: this campaign makes no machine-timing claim |
| Placement | As C05 for latency secondaries |
| Quiet gate | Not applicable: this campaign makes no machine-timing claim |
| Calibration | Rubric practice set as C02 |
| Accounting cross-check | Not applicable: this campaign makes no machine-timing claim |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | All tasks graded; model version change (stop; new campaign) |
| Kill criterion | Not a product kill. Failure keeps residual synthesis hosted |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | TBD at freeze from the pilot; ceilings per attempt from the WP03 record |
| Model | Local and hosted synthesis tokens; ceilings TBD at freeze |
| People | Two graders × 492 residuals at about 10 minutes is about 164 person-hours (Estimated); this cost is why the pilot resets n |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Target unified-memory host per WP03 (local arm); hosted provider and model identifier TBD at registration.

## 12. Artifact identity

Prompt templates, model weights, rubric, task set: digests TBD at freeze.

## 13. Failure meaning

Non-inferiority holds for these models, this library version and these request types. It does not make either synthesizer trustworthy on its own; that is C02 and C03's question.

## 14. Monitoring and rollback

The runner watches the quiet gate, cgroup readbacks and unknown counts per block. Owned units are stopped through their cgroups. A partial receipt set is kept as evidence and never stitched into another campaign [RECEIPT §1]. Nothing outside the campaign's owned resources is touched.

## 15. Signatures and hash chain

| Field | Content |
|---|---|
| `precommit.sha256` | TBD at registration |
| Spec hash | TBD at registration |
| Parent hashes | Predictions: this record. Calibration receipt: TBD at registration. Evaluator: TBD at freeze. Workload: TBD at freeze |
| Approvals | Person approving the precommit (and the residual, where one exists): TBD at registration |
| Chain rule | Every evaluation request and the summary cite the precommit hash; `SHA256SUMS` covers every file; a mismatch invalidates the receipt set |

## Edition 3 alignment

- Edition 3 lets blind contexts run concurrently and overlap with generation (DEC-56); this record decides where one of them runs.

## Open questions

- Is grading capacity the binding constraint here, as review throughput is for the design (RISK-12)?

## Sources

- Edition 3 §6, §7, §8, §10.
- R09; R14 X2; R15 RISK-07, RISK-18; R16 DEC-43, DEC-56.
