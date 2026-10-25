# C18 — Holdout adaptation under repeated scoring

> Reconstructed 2026-10-17. The original C18 was not available; this draft is rebuilt from
> Edition 3 (§11), R05, R14 §4, R15 (RISK-09) and the lab's workload holdout handling. Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

Scores obtained repeatedly from the same held-out set adapt the search to that set even without access to its contents; release confirmation therefore uses rotated or fresh fixtures [E3 §11]. No source says how often to rotate (R05 open question). C07's release run needs that rule before data. This record measures how fast a search adapts to a reused holdout, so the rotation interval is set by evidence.

## Summary

- 40 G = 0 search campaigns on slice tasks; each uses a fixed holdout for selection feedback; finalists are scored on the reused holdout and on fresh fixtures at rounds 1, 10 and 50.
- One primary metric: optimism gap at round 50 = holdout pass rate minus fresh-fixture pass rate for finalists, paired by campaign.
- 40 campaigns detect a 2-point gap with power 0.8 if the per-campaign spread is 5 points (Derived from an Estimated spread); a pilot of 8 resets n.
- Decision: the rotation interval used by C07 and every later release confirmation.

## Record header

| Field | Content |
|---|---|
| Record | C18 |
| Status | Draft — not registered |
| Stage | 4 (before C07's release run) |
| Work packages | WP12 (search driver), WP09, WP11 (fresh fixture generation) |
| Risk or decision addressed | RISK-09 (holdout adaptation); E3 §11 holdout rule |
| What cannot be known yet | Per-campaign gap spread; whether a model proposer (G > 0) adapts faster than G = 0 search |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c18-holdout-adaptation-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | E3 §11 holdout rule; Stage 4 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | After how many rounds of selection feedback from one holdout does the finalists' holdout pass rate overstate their fresh-fixture pass rate by more than 2 points? It decides the rotation interval for release fixtures |
| Hypothesis and predicted observable | Edition 3's claim (Proposed here as a prediction): the gap grows with rounds of feedback. Observable: paired pass rates on reused and fresh fixtures |
| Strongest rival | With G = 0 search and frozen evaluators the gap stays near zero, so rotation is needed only for model proposers |
| Claim-ladder rung | None; it protects the validity of rung 5 claims |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Optimism gap at round 50 = (finalists' pass rate on the reused holdout) − (finalists' pass rate on fresh fixtures from the same generator), percentage points, mean over campaigns |
| Decision rule | Rotation interval = the largest tested round count (1, 10, 50) whose gap has an upper 95 % bound at or below 2 points (Proposed threshold); if round 1 already exceeds it, every release confirmation uses fresh fixtures |
| Secondary metrics | Gap at rounds 1 and 10; gap by task class; fraction of finalists that pass the holdout but fail fresh fixtures |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| S — Search with holdout feedback | G = 0 adaptive search (WP12), selection using a fixed holdout's scores, frozen evaluator | Search driver digest TBD at freeze | Warm | As WP12 | As WP12 |

Control arm: Fresh fixtures (same generator, new seeds) scored once per finalist. Null arm: none.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | Frozen per task; hash TBD at freeze |
| Acceptance boundary | WP09 gate order |
| Independent validator | Fresh fixtures act as the independent check; generated with seeds never shown to the search |
| Parity rule | Not applicable |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | 40 slice tasks with fixture generators; task list SHA-256 TBD at freeze |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | The reused holdout per task (digest only; never in proposer context); fresh fixtures generated after each checkpoint round |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One search campaign (paired reused-versus-fresh at each checkpoint) |
| Planned n | 40 campaigns; pilot of 8 resets n |
| Power calculation | Paired mean difference, one-sided α = 0.05, power 0.8, to detect 2 points: per-campaign sd 5 points needs 39 campaigns; sd 3 needs 14 (Derived; sd Estimated) |
| Minimum samples | 14 campaigns |
| Randomisation | PRNG `ifl-prng` from WP01 (`LAB/harness/lib/prng.mjs`); seed TBD at registration; schedule SHA-256 recorded before the first job |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Process-cold means a fresh process with page cache warm (caches cannot be dropped without root); disk compile caches disabled or pinned; warm state declared per arm [R14 §4] |
| Steady-state rule | Not applicable |
| Warm-up | Not applicable |
| Placement | Pinned quiet cores taken from the WP03 record (not the scheduler's preferred cores); driver on separate cores; SMT policy recorded; no `cpu.max` on timed runs [R14 §4] |
| Quiet gate | Recorded, not gating |
| Calibration | WP01 calibration receipt at the measured commit, same boot, within 12 h; path and SHA-256 TBD at registration; no waivers (official) |
| Accounting cross-check | Containment asserted; not timing-relevant |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | All campaigns reach round 50; evaluator hash change (stop; new campaign) |
| Kill criterion | Not a product kill. The result fixes the rotation rule for C07; it cannot be changed after C07's precommit |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | Hours (G = 0) |
| Model | none |
| People | Author and reviewer time only |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Main-rig (local lane): Ryzen 9 7950X, 16 cores / 32 threads, about 125 GiB RAM, kernel `7.2.5-3-omarchy`, shared desktop (as recorded 8 Oct 2026 [R12 §2]). Microcode, governor, frequency policy, SMT state, cgroup controllers, and Node, Wasmtime and compiler versions with binary hashes: TBD at registration, from the WP01 snapshot and the WP03 record. Repository head TBD at registration; dirty tree refused (official).

## 12. Artifact identity

Search driver, fixture generators, tasks: digests TBD at freeze.

## 13. Failure meaning

A rule set with G = 0 search is a lower bound on adaptation; a model proposer may need a shorter interval and a new record.

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

- Edition 3 states the hazard and the remedy but no interval [E3 §11]; this record supplies the interval for the slice.

## Open questions

- Should the rotation rule be re-measured once a model proposer exists? Proposed: yes, as a new record.

## Sources

- Edition 3 §11.
- R05 (open questions); R14 §4 (holdout hygiene); R15 RISK-09.
- `~/Work/isolate-factory-lab/docs/WORKLOADS.md` (holdout handling).
