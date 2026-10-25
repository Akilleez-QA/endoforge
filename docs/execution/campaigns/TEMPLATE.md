# Campaign record template (execution copy)

> Reconstructed 2026-10-17. The original campaign record template was not available; this skeleton
> copies the field structure of `docs/templates/CAMPAIGN-PRECOMMIT.md` and adds the record header the
> C01–C18 drafts use. Content follows Edition 3 where the sources differ.

## Purpose

This is the blank form for a campaign record in `docs/execution/campaigns/`. It repeats only the structure of [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); the meaning of every field, the rules for hashing, and the field mapping to POODO, the lab schema and the Field OS test bed live there and are not repeated. Copy this file to `C<nn>-<slug>.md`, fill every field ("none" rather than blank), and keep the status line accurate.

## Summary

- Field numbering 1–15 matches the precommit template exactly.
- A record is a **draft** until its `precommit.json` is hashed by the campaign runner (WP01); then its status becomes "Registered" with the hash, and the record may no longer change.
- The frozen evaluator hash is written "TBD at freeze" until WP06 records it.
- Values that are only known at registration (campaign id, timestamps, seeds, environment snapshots) are written "TBD at registration".

## Record header

| Field | Content |
|---|---|
| Record | C<nn> |
| Status | Draft — not registered |
| Stage | `EXECUTION-PLAN.md` stage number |
| Work packages | WPnn that must be complete before registration |
| Risk or decision addressed | RISK-nn (R15), DEC-nn (R16) |
| What cannot be known yet | Fields that stay TBD, and why |

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | |
| Label | |
| Experiment | |
| Author and reviewer | |
| Created at | |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | |
| Hypothesis and predicted observable | |
| Strongest rival | |
| Claim-ladder rung | |
| Predictions file cited | |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | |
| Decision rule | |
| Secondary metrics | |
| Multiplicity | |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| | | | | | |

Control arm: . Null arm: .

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | |
| Acceptance boundary | |
| Independent validator | |
| Parity rule | |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | |
| Public fixtures | |
| Holdouts | |
| Seeded faults | |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | |
| Planned n | |
| Power calculation | |
| Minimum samples | |
| Randomisation | |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | |
| Steady-state rule | |
| Warm-up | |
| Placement | |
| Quiet gate | |
| Calibration | |
| Accounting cross-check | |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | |
| Kill criterion | |
| Escalation | |

## 10. Budget

| Field | Content |
|---|---|
| Compute | |
| Model | |
| People | |
| Price declaration | |

## 11. Environment identity

## 12. Artifact identity

## 13. Failure meaning

## 14. Monitoring and rollback

## 15. Signatures and hash chain

| Field | Content |
|---|---|
| `precommit.sha256` | TBD at registration |
| Spec hash | TBD at registration |
| Parent hashes | |
| Approvals | |
| Chain rule | As in the precommit template §15 |

## Edition 3 alignment

## Open questions

## Sources
