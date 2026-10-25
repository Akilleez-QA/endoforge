# Campaign precommit template

> Reconstructed 2026-10-17. The original campaign template was not available; this version is
> rebuilt from Edition 3 (§6, §7, §8, §11, §15), the POODO precommit fields Edition 3 adopts, the
> isolate-factory-lab precommit schema (`ifl-precommit-v1`) and the Field OS test-bed precommit.
> Content follows Edition 3 where the sources differ.

## Purpose

A precommit is written, hashed and stored before the first measured job of a campaign. It fixes what will be measured, how it will be judged, what a failure means and when to stop, so that the result cannot move the criterion. Edition 3 adopts POODO's precommit record as the evaluation receipt of the design: observable, acceptance boundary, oracle and oracle version, artifact identity, environment, failure meaning, stop condition [E3 §8]. This template carries those fields plus the campaign controls the isolate lab found necessary. A change after the hash is recorded is a new campaign, not an edit.

## How to use it

1. Copy this file to `docs/execution/campaigns/<campaign-id>.md` and fill every field. Write "none" rather than leaving a field blank.
2. Produce the machine-readable form (`precommit.json`, canonical JSON: keys sorted, no whitespace, finite numbers) from the same content.
3. Record `sha256(precommit.json)` in `precommit.sha256` **before** any measured job starts. The harness must refuse to start if it cannot.
4. Every request, sample and summary in the receipt set cites that hash (`docs/templates/RECEIPT.md`).

## Fields

### 1. Identity

| Field | Content | Notes |
|---|---|---|
| Campaign id | `<name>-<UTC timestamp>-<6 hex>` | Unique; never reused after a change |
| Label | `official` \| `pilot` \| `smoke` \| `exploratory` | Pilot and smoke numbers are never results |
| Experiment | E3 X1–X6, the matched campaign, or a C01–C18 record | |
| Author and reviewer | Names; reviewer must not have authored the evaluator or the candidates | [E3 §8] context separation |
| Created at | UTC timestamp | Must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

### 2. Question and hypothesis (POODO: observable)

| Field | Content |
|---|---|
| Question | One sentence; the decision it drives |
| Hypothesis and predicted observable | What is expected, stated so it can be contradicted |
| Strongest rival | The best alternative explanation or framing, and what result would favour it |
| Claim-ladder rung | Which rung this could move, and which it cannot [E3 §17] |
| Predictions file cited | Path and SHA-256 of the predictions document in force |

### 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Definition, unit, numerator and denominator, how computed (for example a ratio of totals per block) |
| Decision rule | Threshold or margin; how the confidence interval is read; what counts as inconclusive |
| Secondary metrics | Listed; they cannot rescue a failed or inconclusive primary |
| Multiplicity | Number of predeclared comparisons and the correction (for example Holm) |

### 4. Arms

For each arm: id; representative implementation with **full options** (declared now, never chosen after data); artifact identity (tree digest of its code, its import closure and any binaries); warm or cold regime and retained state; isolation boundary; accounting boundary (which cgroup; assertion that every helper process stays in it). Name the control arm and the null arm, if any, used to measure the harness constant.

### 5. Evaluator and oracle (POODO: oracle and oracle version; acceptance boundary)

| Field | Content |
|---|---|
| Frozen evaluator hash | Tree digest of the evaluator code and configuration; the harness refuses to judge if the running code differs |
| Synthesized residual | Hash; context in which it was synthesized (candidate-blind); qualification evidence (seeded faults rejected, known-good anchor accepted, determinism); person who confirmed it and when [E3 §6] |
| Acceptance boundary | Gate order; what passes; how `outcome_unknown` is treated (its own stage, never a pass or reject); admissibility thresholds for unknowns |
| Independent validator | Identity, and the rule that its cost is not charged to any arm |
| Parity rule | What must match between arm and validator; a disagreement is a parity failure, never yield |

### 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | Path, tree digest, generator digest, stream or task list with order |
| Public fixtures | Digest |
| Holdouts | Digest only; where they live; who can read them; confirmation that no proposer context contains them; rotation or fresh seed for release runs [E3 §11] |
| Seeded faults (if any) | Generator identity, strata and their proportions, equivalence-filtering method, count per stratum |

### 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | For example a replicate process lifetime (block), a task, a seeded fault |
| Planned n | Per arm and per stratum |
| Power calculation | Effect size or bound targeted, variance source (pilot receipt hash or noise-baseline receipt hash), α, power, method (for zero-event bounds: the exact binomial bound, with the allowed number of events) |
| Minimum samples | Floors that apply regardless of the calculation (for example 16 blocks) |
| Randomisation | PRNG, seed, the generated schedule's hash |

### 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Definition of cold and warm for each arm; disk caches disabled or pinned |
| Steady-state rule | Window, comparison (like with like), tolerance, consecutive count, cap; what happens to a lifetime that does not converge |
| Warm-up | Declared count; must exercise every path the measured window uses |
| Placement | Pinned CPUs, controller CPUs, SMT policy, quota (none on timed runs) |
| Quiet gate | Thresholds; whether a refused block is skipped (official) or recorded (pilot) |
| Calibration | Calibration receipt path and hash; must be at the measured commit, same boot, within its validity window; waivers: none for `official` |
| Accounting cross-check | How out-of-cgroup work is detected and when it invalidates a lifetime |

### 9. Stop rules and kill criterion (POODO: stop condition)

| Field | Content |
|---|---|
| Stop rules | Budget exhausted; plateau; regression; ambiguous execution; environment gate failure; containment or authority violation |
| Kill criterion | The precommitted result that narrows the product or kills a direction (Edition 3 §15 wording where it applies) |
| Escalation | Who is told, and what pauses |

### 10. Budget

| Field | Content |
|---|---|
| Compute | CPU-seconds, wall-clock window, memory ceilings per attempt and per concurrency level |
| Model | Tokens and cost ceiling; model identity and version |
| People | Person-minutes for confirmation, grading or review |
| Price declaration | How tokens, CPU-seconds and person-minutes convert to one total cost, if the primary metric needs it |

### 11. Environment identity (POODO: environment)

Host name and class; CPU model, microcode, cores and SMT; memory; kernel; governor and frequency policy; runtime versions (Node, Wasmtime, compilers) with binary hashes; cgroup controllers available to the user manager; repository head and dirty status (official campaigns refuse a dirty tree); the environment snapshot schema used before and after.

### 12. Artifact identity (POODO: artifact identity)

Every artifact under test: name, path, SHA-256 or tree digest, build recipe and toolchain, upstream commit where relevant.

### 13. Failure meaning (POODO: failure meaning)

What a failed, inconclusive or invalid result means and does not mean; that a failed lane stays failed; that no result is generalised beyond the stated scope. State delivery state and outcome state separately: an executed campaign is not a validated claim.

### 14. Monitoring and rollback

What is watched during the run; how owned units are stopped; how receipts are retained on failure; that nothing outside the campaign's owned resources is touched.

### 15. Signatures and hash chain

| Field | Content |
|---|---|
| `precommit.sha256` | SHA-256 of the canonical `precommit.json` |
| Spec hash | SHA-256 of the campaign spec the harness ran |
| Parent hashes | Predictions document, calibration receipt, pilot receipt (if it set n), evaluator, workload |
| Approvals | Person approving the residual and the precommit, with timestamp; for trusted-base changes, the reviewer from a separate context [E3 §8] |
| Chain rule | Every `EvaluationRequest` and the `summary` cite the precommit hash; `SHA256SUMS` covers every file; a mismatch invalidates the receipt set |

## Field mapping

| This template | POODO precommit [E3 §8] | Lab `ifl-precommit-v1` | Field OS test bed |
|---|---|---|---|
| Question, hypothesis | Observable; prediction | `spec.purpose`, `predictionsCited` | Objective, Prediction |
| Primary metric, decision rule | Acceptance boundary | `statistics.primaryMetric`, `equivalenceMargin` | Measurement |
| Evaluator and oracle | Oracle and oracle version | `identities.evaluator`, `spec.validator` | Independent oracle, Model oracle |
| Arms, artifact identity | Artifact identity | `identities.arms`, `identities.harness`, `identities.workload` | Domain core |
| Fixtures and holdouts | — | `stream`, `identities.workload` | Input |
| Sample size | — | `samples`, `minimumSamples`, `randomisation` | — |
| Measurement rules | — | `machine`, `envControl`, `calibration`, `spec.warm.steadyState` | Measurement |
| Environment identity | Environment | `environmentSnapshot`, `identities.node`, `identities.repo` | Observed host |
| Stop rules, kill | Stop condition | spec gate refusals | Stop |
| Failure meaning | Failure meaning | `calibration.consequence` | Failure meaning |
| Monitoring and rollback | Monitoring, rollback, escalation | — | Rollback |
| Hash chain | — | `precommit.sha256`, `specSha256` | Precommit SHA-256 in the receipt |

## Machine-readable skeleton

```json
{
  "schema": "endoforge-precommit-v1",
  "campaignId": "",
  "label": "official|pilot|smoke|exploratory",
  "experiment": "",
  "createdAt": "",
  "createdBeforeFirstMeasuredJob": true,
  "question": "",
  "hypothesis": {"prediction": "", "strongestRival": "", "rung": 0},
  "predictionsCited": {"path": "", "sha256": ""},
  "metrics": {"primary": {"name": "", "definition": "", "decisionRule": "", "margin": null},
              "secondary": [], "multiplicity": ""},
  "arms": [{"id": "", "representative": {}, "artifacts": [{"path": "", "sha256": ""}],
            "regime": "", "isolation": "", "accounting": ""}],
  "control": "", "nullArm": null,
  "evaluator": {"treeSha256": "", "residual": {"sha256": "", "context": "candidate-blind",
                "qualification": {}, "confirmedBy": "", "confirmedAt": ""},
                "acceptance": {"gateOrder": [], "unknownPolicy": {}}, "validator": {}, "parity": ""},
  "fixtures": {"workload": {"path": "", "treeSha256": ""}, "publicSha256": "", "holdoutSha256": "",
               "seededFaults": null},
  "samples": {"unit": "", "planned": {}, "power": {}, "minimums": {},
              "randomisation": {"prng": "", "seed": "", "scheduleSha256": ""}},
  "measurement": {"cacheStates": {}, "steadyState": {}, "warmup": {}, "placement": {},
                  "quietGate": {}, "calibration": {"path": "", "sha256": ""}, "crossCheck": {}},
  "stop": {"rules": [], "kill": "", "escalation": ""},
  "budget": {"compute": {}, "model": {}, "people": {}, "prices": {}},
  "environment": {"snapshotSchema": "", "repo": {"head": "", "dirty": false}},
  "failureMeaning": "",
  "monitoringRollback": "",
  "chain": {"specSha256": "", "parents": {}, "approvals": []}
}
```

The skeleton is **Proposed**; the lab's working schema is `ifl-precommit-v1` (`~/Work/isolate-factory-lab/receipts/smoke-20261014T200656Z-99f032/precommit.json` is a complete example).

## Sources

- Edition 3 §6, §7, §8, §11, §15, §17.
- POODO skill: `~/.claude/skills/poodo/SKILL.md` (precommit before acting) and `references/epistemic-integrity.md` (precommitment and test integrity).
- `~/Work/isolate-factory-lab/receipts/smoke-20261014T200656Z-99f032/precommit.json`; `~/Work/isolate-factory-lab/docs/PREDICTIONS.md`; `~/Work/isolate-factory-lab/CRITIQUE-2026-10-14-precampaign.md` (M8, M9, M11, S2).
- `~/Work/field-ops/docs/specs/FIELD-OS-MAIN-RIG-TEST-BED-V1.md` (precommit table E-MAINRIG-001).
- R12, R13, R14 (this library).
