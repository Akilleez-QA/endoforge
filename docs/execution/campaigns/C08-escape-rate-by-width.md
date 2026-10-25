# C08 — Searched escape rate at candidate widths 1, 4 and 16

> Reconstructed 2026-10-17. The original C08 was not available; this draft is rebuilt from
> Edition 3 (§7, §10, §11, §15), R05, R14 §2, R15 (RISK-08) and R16 (DEC-45, DEC-57). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

Edition 3 says candidate width is bounded by the evaluator's discriminating power before memory, and that parallel samples multiply the evaluator: sixteen candidates against a 1 % leak are sixteen chances to be credentialed wrong [E3 §11]. C03b measures the searched rate at width 16 only. This record measures it at widths 1, 4 and 16 so that each domain gets the widest width its evidence supports, instead of an all-or-nothing choice between 1 and 16.

## Summary

- Same frozen evaluator, same seeded fault families, same total proposal budget at each width; only width changes.
- Fixed-sequence testing: width 1 is certified first, then 4, then 16; testing stops at the first failure, so no multiplicity correction is needed.
- Per width per domain, a one-escape plan of 4,742 seeded faults certifies below 1 in 1,000 (Derived, R14 §2.1). C03b's width-16 cell is reused only if its evaluator hash and fault generator match and this record says so before data.
- Decision: the domain's maximum candidate width.

## Record header

| Field | Content |
|---|---|
| Record | C08 |
| Status | Draft — not registered |
| Stage | Stage 6+ / optional (X3b at width 16 is the slice's width decision; widths 1 and 4 refine it; moved from 4 by the 17 Oct critique) |
| Work packages | WP11, WP12, WP27; C03 decided |
| Risk or decision addressed | RISK-08 (evaluator overfitting under search); DEC-57 (width bounded by discriminating power), DEC-45 |
| What cannot be known yet | Evaluator hash, domain list, and whether C03b's cell is reusable. Whether width 4 buys useful yield is outside this record (yield arithmetic, Estimated: four candidates at 50 % first-pass yield give a 94 % chance one passes [E3 §10]) |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c08-width-sweep-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | Follow-on to E3 X3 (C03b) |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | What is the widest candidate width at which a domain's searched escape rate stays certifiably below 1 in 1,000? It decides the width limit per domain |
| Hypothesis and predicted observable | Edition 3's reasoning (Proposed): the searched escape rate rises with width because search pressure finds evaluator holes [E3 §11]. Observable: promotions of seeded faults per width |
| Strongest rival | Width does not matter at G = 0 because the evaluator has no holes the mechanical search can reach; any width difference comes from budget, not width. Equal total budget across widths controls for it |
| Claim-ladder rung | Rung 3 (searched half), refined per width |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Searched escape rate per width per domain = seeded faults promoted ÷ seeded faults present, with its exact one-sided 95 % upper bound, at widths 1, 4, 16 in fixed sequence |
| Decision rule | Maximum width = the largest width in the sequence 1 → 4 → 16 whose upper bound is below 1 in 1,000, provided every smaller width also certified. If width 1 fails, the domain stays Confirmed and width stays one [E3 §15] |
| Secondary metrics | Escape rate against width (dose-response); first-pass yield per width; escapes by stratum; attribution of the check each escape passed |
| Multiplicity | Fixed-sequence (hierarchical) procedure; each width tested at α = 0.05 only if all smaller widths certified |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| W1 | G = 0 search, width 1, frozen evaluator, total proposal budget B | Search driver and evaluator digests TBD at freeze | Warm machinery; fresh candidates | As C03 | As C03 |
| W4 | Same, width 4, total budget B | Same | Same | Same | Same |
| W16 | Same, width 16, total budget B | Same | Same | Same | Same |

Control arm: W1. Null arm: none.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | As C03: frozen per task; hash TBD at freeze |
| Acceptance boundary | As C03 |
| Independent validator | As C03: independent oracle labels every promoted candidate |
| Parity rule | As C03 |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | As C03 per domain: at least 100 tasks, seeded fault families present |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | The search driver never sees the seeded-fault list |
| Seeded faults | WP11 strata S1–S3 at C03's proportions; S4 as found; generator digest TBD at freeze |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One seeded fault present in a search (clustered by task) |
| Planned n | 4,742 per width per domain (one-escape plan); up to 14,226 per domain if all three widths run |
| Power calculation | Exact one-sided 95 %: 4,742 faults with at most one escape certify below 1 in 1,000; probability of certifying is 0.92 at a true rate of 1 in 10,000 and 0.76 at 1 in 5,000 (Derived, R14 §2.2) |
| Minimum samples | 100 tasks per domain |
| Randomisation | PRNG `ifl-prng` from WP01 (`LAB/harness/lib/prng.mjs`); seed TBD at registration; schedule SHA-256 recorded before the first job |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Process-cold means a fresh process with page cache warm (caches cannot be dropped without root); disk compile caches disabled or pinned; warm state declared per arm [R14 §4] |
| Steady-state rule | Not applicable (count metric) |
| Warm-up | Not applicable |
| Placement | Pinned quiet cores taken from the WP03 record (not the scheduler's preferred cores); driver on separate cores; SMT policy recorded; no `cpu.max` on timed runs [R14 §4] |
| Quiet gate | Recorded, not gating |
| Calibration | WP01 calibration receipt at the measured commit, same boot, within 12 h; path and SHA-256 TBD at registration; no waivers (official) |
| Accounting cross-check | Containment asserted; not timing-relevant |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | Fixed-sequence stop at the first width that fails; evaluator hash change (stop; new campaign) |
| Kill criterion | Searched escape rate above 1 in 1,000 at a width: that width and all wider ones are not allowed for the domain [E3 §15] |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | Hours per domain (as C03) |
| Model | none (G = 0) |
| People | About 1 person-day per domain for review |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Main-rig (local lane): Ryzen 9 7950X, 16 cores / 32 threads, about 125 GiB RAM, kernel `7.2.5-3-omarchy`, shared desktop (as recorded 8 Oct 2026 [R12 §2]). Microcode, governor, frequency policy, SMT state, cgroup controllers, and Node, Wasmtime and compiler versions with binary hashes: TBD at registration, from the WP01 snapshot and the WP03 record. Repository head TBD at registration; dirty tree refused (official).

## 12. Artifact identity

As C03, plus the search driver configuration per width.

## 13. Failure meaning

A width limit holds for one domain, one evaluator hash and G = 0 search. A model proposer is a stronger optimizer and may need a lower limit; that needs its own campaign.

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

- Edition 3 states the width rule but not how to measure it per width [E3 §11]; this record supplies the measurement.

## Open questions

- Should the budget be equal in candidates or in CPU-seconds? This record uses candidates; CPU-seconds is a secondary.

## Sources

- Edition 3 §7, §10, §11, §15.
- R05; R14 §2; R15 RISK-08; R16 DEC-45, DEC-57.
