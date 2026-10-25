# C07 — Matched end-to-end campaign

> Reconstructed 2026-10-17. The original C07 was not available; this draft is rebuilt from
> Edition 3 (§1, §3, §11, §15), Edition 2 (§15), the white paper (pp. 14, 22), the diagram atlas (sheet 28), R14 §3–§4, R15 (RISK-12, RISK-19, RISK-22, RISK-23) and R16 (DEC-09, DEC-10, DEC-55). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

This record drafts the precommit for the matched end-to-end campaign that follows the six experiments: identical tasks, frozen evaluators, and four arms, including a conventional agent in a warm container measured with time to specify. The product proposition is confirmed only against that arm [E3 §15].

## Summary

- Arms: A warm native baseline, K kernel workcell, D child-isolate topology, G conventional agent in a warm container [R14 §3.1].
- One primary metric: independently accepted useful capabilities per unit of total cost, with prices declared before data [E3 §1].
- At least 30 tasks across five task classes, three replicate runs per arm per task in randomised order (R14 §3.3).
- Release confirmation uses fresh or rotated fixtures under the rule C18 sets.

## Record header

| Field | Content |
|---|---|
| Record | C07 |
| Status | Draft — not registered |
| Stage | 4 |
| Work packages | WP27, WP28 (activation half), WP30, WP22 (arm D), WP02 (M2, M8, M9), WP03; WP29 if built (Stage 6+ / optional); C03b, C06 and C18 decided; C05b decided, or recorded as "not run, no host" with placement "undecided, hosted by default" (DP-5), in which case arm K declares hosted inference; decision point DP-4 (the named person) recorded |
| Risk or decision addressed | RISK-22 (warm native baseline wins), RISK-23 (measurement artefacts), RISK-19 (legibility), RISK-12 (review throughput); DEC-09, DEC-10, DEC-55 |
| What cannot be known yet | The agent and its version for arm G; the price declaration; the task set; whether arm K runs on the kernel route or the compatibility lane (depends on C04; if C04 killed the kernel route, K is the compatibility lane and arm D is dropped as its duplicate); the named person (DP-4) |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c07-matched-e2e-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | Matched end-to-end campaign (after E3 X1–X6) |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | Does the Endoforge loop (arm K) produce more independently accepted useful capabilities per unit of total cost than a conventional agent in a warm container (arm G) on identical tasks with frozen evaluators? It decides whether the product proposition is confirmed |
| Hypothesis and predicted observable | Prospective target (Proposed, one fixed before data per R14 §3.3): K ÷ G on the primary is at least 2× (the white paper's example, at least 2× lower median time to an accepted small capability [W p.22], restated in the primary's units). The target is a prediction scored as met or not met; the decision rule in §3 is the weaker "K better than G" and is the one that decides the proposition. Both are reported. Observable: accepted capabilities and priced total cost per arm per task |
| Strongest rival | A warm native baseline or a warm agent container already captures most of the benefit; workcell gains are swamped by model time (about four fifths of the budget, Estimated [E3 §10]) and specification time |
| Claim-ladder rung | Rung 4 is attempted in the UI task class under the WP27 pass/fail rule: the DP-4 person states their own task (hashed) before the capability exists and completes it with the qualified capability without any intervention by the author; consent, task hash, capability identity and completion statement in the receipt. Rung 5 is not claimed by this campaign [E3 §17] |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Accepted useful capabilities per unit of total cost = independently accepted capabilities ÷ (tokens + CPU-seconds + repairs + evaluation + review minutes + failures, converted with the declared prices), per arm, as a ratio of totals per block; compared as K ÷ G |
| Decision rule | Read at no fewer than 30 task blocks and 16 blocks with admissible data in every arm. K better: lower 95 % bound of K ÷ G above 1.0. G better: upper bound below 1.0. Otherwise inconclusive, and it stays inconclusive [E3 §11]. Separately, the 2× target (§2) is scored met if the lower bound is above 2.0, otherwise not met; it does not alter the verdict. Interval method BCa over task blocks, declared |
| Secondary metrics | Median and p95 wall time from request to accepted capability including time to specify; CPU-seconds; peak and retained memory; reviewer minutes; searched escape rate in force; failed and unknown attempts; K ÷ A and K ÷ D on the primary; a legibility check (WP29 criterion c) |
| Multiplicity | Primary K ÷ G only. K ÷ A and K ÷ D are secondaries with Holm correction |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| A — Warm native baseline | Vetted function or declarative composition in an already-warm process; authoring time charged where it did not exist | Code digest TBD at freeze | Warm | Owned process | Arm cgroup |
| K — Kernel workcell | Stage 3 workcell: synthesized residual, kernel plus declarative glue, Wasmtime local lane (or compatibility lane if C04 killed the kernel route, named as such, with arm D then dropped); inference placement as C05b decided, or hosted if C05b was not run (DP-5); compiler host per DP-1 | Workcell, compiler, evaluator digests TBD at freeze | Warm machinery; fresh candidates | Wasmtime instance in workcell; compiler in the DP-1 cohort | Workcell and compiler-cohort cgroups; WP02 M9 assertions |
| D — Child-isolate topology | Compiler worker plus child V8 isolate inside an owned process and cgroup, TypeScript→JavaScript (WP22) | Lane digest TBD at freeze | Warm compiler | Owned process | Arm cgroup |
| G — Conventional agent | Pinned coding agent (model and harness version fixed) in a pre-warmed container with dependencies installed; same frozen evaluator; time to specify included | Container image digest and agent version TBD at freeze | Warm container | Container | Container cgroup |

Control arm: G (the arm the proposition must beat). Null arm: Harness-only null arm to measure the harness constant (WP02, S1).

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | One frozen evaluator per task shared by all arms, hashed into the precommit before any arm runs (TBD at freeze) |
| Acceptance boundary | WP09 gate order; an arm with a parity or containment failure outside its predeclared expected failures is inadmissible for that task; `outcome_unknown` above 1 % (2 % in any lifetime) makes an arm inadmissible |
| Independent validator | Independent oracle per task, run on each arm's own emitted artifact (M2); cost not charged |
| Parity rule | Arm verdict versus validator; disagreement is a parity failure, never yield |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | At least 30 tasks across five classes: a small generated tool; type-heavy code; a data transform; an interactive UI; adversarial loop, heap and output cases [A sheet 28]. Task list SHA-256 TBD at freeze |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | Release fixtures fresh or rotated under C18's rule; digest only; kept out of every proposer context [E3 §11] |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One task block (all arms, randomised order), with three replicate runs per arm |
| Planned n | 30 tasks × 4 arms × 3 replicates = 360 arm-runs (minimum) |
| Power calculation | To detect a 2× effect on a paired log scale at power 0.8: sd 0.8 needs 11 task pairs, sd 0.5 needs 5 (Derived from an assumed spread, R14 §3.3). Floor at 30 tasks because the lab pilot showed the P6-style metric is dominated by reject cost and contended variance (Pilot (not a result), R12 §4.3) |
| Minimum samples | 30 tasks; 16 blocks for any interval (WP02, S2) |
| Randomisation | PRNG `ifl-prng` from WP01 (`LAB/harness/lib/prng.mjs`); seed TBD at registration; schedule SHA-256 recorded before the first job |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Process-cold means a fresh process with page cache warm (caches cannot be dropped without root); disk compile caches disabled or pinned; warm state declared per arm [R14 §4] |
| Steady-state rule | Predeclared like-for-like rule (fixed probe set, whole-pass comparison), never consecutive windows of a mixed stream; non-converging lifetimes flagged and analysed with and without (WP02, M10) |
| Warm-up | At least 20 iterations per lifetime, covering every path the measured window uses [R14 §4] |
| Placement | Pinned quiet cores taken from the WP03 record (not the scheduler's preferred cores); driver on separate cores; SMT policy recorded; no `cpu.max` on timed runs [R14 §4] |
| Quiet gate | Lab thresholds (`LAB/tools/env-control/lib/gate.mjs`), refused blocks skipped (official). If the gate cannot pass on the shared desktop, only effects above the recorded upper-bound MDE may be claimed (EXECUTION-PLAN Stage 0) |
| Calibration | WP01 calibration receipt at the measured commit, same boot, within 12 h; path and SHA-256 TBD at registration; no waivers (official) |
| Accounting cross-check | Host-wide `/proc/stat` against arm cgroup CPU at every window boundary; out-of-cgroup work (including `systemd-coredump`) above 5 % of the arm's CPU invalidates the lifetime (threshold Proposed; WP02) |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | Budget, plateau, regression or ambiguous execution; an arm with any parity or containment failure outside its expected failures is inadmissible for that task |
| Kill criterion | Not a kill of the project. If G is better or the result is inconclusive, the product proposition is not confirmed; no claim of advantage over a conventional agent is made, and claims narrow to whatever K ÷ A and K ÷ D support |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | TBD at freeze from a pilot of 3 tasks |
| Model | Per-arm token ceilings TBD at freeze; same model family for K and G where possible, declared |
| People | Specifier and reviewer minutes recorded by the harness for K and G; the DP-4 named person for the rung-4 attempt (TBD at registration; default a Field OS user other than the author, fallback the author labelled "author-as-user, weak rung-4 evidence") |
| Price declaration | Declared before data: price per million tokens per model, per CPU-second, per person-minute (TBD at freeze; R14 open question) |

## 11. Environment identity

Main-rig (local lane): Ryzen 9 7950X, 16 cores / 32 threads, about 125 GiB RAM, kernel `7.2.5-3-omarchy`, shared desktop (as recorded 8 Oct 2026 [R12 §2]). Microcode, governor, frequency policy, SMT state, cgroup controllers, and Node, Wasmtime and compiler versions with binary hashes: TBD at registration, from the WP01 snapshot and the WP03 record. Repository head TBD at registration; dirty tree refused (official).

## 12. Artifact identity

Every arm's representative with full options (M8), container image, workcell, evaluators, task set: digests TBD at freeze.

## 13. Failure meaning

An executed campaign is not a validated claim. A K win holds only for these task classes, this host and these prices; it is not a general speedup, and it is not energy (CPU time is not energy). A G win does not refute the agent substrate's density case against warm sandboxes; it refutes the proposition as stated for these tasks.

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

- Edition 2 and the white paper made this the decisive experiment [W p.22; A sheet 28]; Edition 3 puts six experiments first and adds arm G [E3 §15].
- The white paper's arm B (Node/QuickJS adapter) is retired; its numbers are a baseline for C04 only.

## Open questions

- How should review time enter the denominator when review is batched across many capabilities (R01 open question)? Fixed in the price declaration before data.
- If C04 killed the kernel route, is a three-arm campaign (A, K-as-compatibility-lane, G) still the proposition Edition 3 states? This record says it tests the loop, not the lane, and names the lane in every claim.

## Sources

- Edition 3 §1, §3, §10, §11, §15; Edition 2 §15; white paper pp. 14, 22; atlas sheet 28.
- R14 §3–§4; R15 RISK-12, RISK-19, RISK-22, RISK-23; R16 DEC-09, DEC-10, DEC-55.
- `~/Work/isolate-factory-lab/harness/campaigns/primary-p6.json`; `CRITIQUE-2026-10-14.md` items 5, 7, 10; `CRITIQUE-2026-10-14-precampaign.md` M2, M8, M9.
