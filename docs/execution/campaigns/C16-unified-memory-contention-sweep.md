# C16 — Unified-memory contention sweep

> Reconstructed 2026-10-17. The original C16 was not available; this draft is rebuilt from
> Edition 2 (§12), Edition 3 (§10, §13), R09 (§2, §4), R15 (RISK-17) and the hardware qualification template. Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

Shared memory means shared demand: inference, compiler, evaluator and everything else draw on one sustainable bandwidth [E2 §12; R09 §2]. C05 measures one operating point. This record sweeps compile concurrency against inference batch on the target unified-memory host, so that the slice knows whether compilation may overlap inference or must be scheduled around it.

## Summary

- Grid: compile concurrency 0, 1, 2, 4, 8 × inference batch 1, 4; 10 repeats per cell; two 30-minute sustained cells for thermals.
- One primary metric: decode throughput retention at the slice's operating point (batch 4 with the planned compile concurrency).
- Runs only if C05 did not restrict local inference to short calls.
- Bandwidth is read from hardware counters; nothing is inferred from datasheets (Upstream figures are not Recorded).

## Record header

| Field | Content |
|---|---|
| Record | C16 |
| Status | Draft — not registered |
| Stage | Stage 6+ / optional (needs C05 part b and the DP-5 unified-memory host; not needed for rung 4; moved from 3 by the 17 Oct critique) |
| Work packages | WP03 (unified-memory host record), WP24, WP19 |
| Risk or decision addressed | RISK-17 (unified-memory bandwidth contention) |
| What cannot be known yet | The host; its sustainable bandwidth; the operating point (set by C05) |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c16-uma-contention-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | Follow-on to E3 X5 (C05) |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | How much decode throughput is retained when compilation runs concurrently at the slice's operating point, and where does contention begin? It decides whether compile and inference may overlap |
| Hypothesis and predicted observable | Proposed: retention at the operating point is at least 0.8. Observable: decode tokens/s per cell, compile wall time, bandwidth counters |
| Strongest rival | Bandwidth saturates early; any concurrent compilation cuts decode sharply, so the two must be serialised [R09 §2] |
| Claim-ladder rung | None; placement decision |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Decode throughput retention = decode tokens/s at batch 4 with the planned compile concurrency ÷ decode tokens/s at batch 4 with no compilation, median of 10 repeats each |
| Decision rule | Overlap allowed if the lower 95 % bound (bootstrap) of retention is at least 0.8 (Proposed). Below that, compile and inference are scheduled apart or pinned to separate resources |
| Secondary metrics | Full grid surface; compile wall-time ratio; sustained-cell thermal state and throttling; total accepted candidates per hour at each cell (if yield is stable) |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| U — Grid cells | Inference runtime and model from C05; WP19 compiler at the stated concurrency | Digests from C05 plus compiler digest | Resident model; warm compiler | Host processes | Host counters; cgroups for CPU |

Control arm: Concurrency 0 cell at each batch size. Null arm: none.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | Not used (throughput metric) |
| Acceptance boundary | Not applicable |
| Independent validator | Hardware counter readings cross-checked against the WP03 record's measured bandwidth |
| Parity rule | Not applicable |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | Fixed decode prompt set and fixed compile job set (C04 kernels); digests TBD at freeze |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | none |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One cell repeat |
| Planned n | 10 repeats × 10 cells = 100 runs, plus two 30-minute sustained runs |
| Power calculation | Ratio of medians with a bootstrap interval from 10 repeats per cell; spread unknown until the pilot (Estimated) |
| Minimum samples | 10 repeats per cell |
| Randomisation | PRNG `ifl-prng` from WP01 (`LAB/harness/lib/prng.mjs`); seed TBD at registration; schedule SHA-256 recorded before the first job |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Model resident; prompt cache warm; compile caches disabled so each job compiles |
| Steady-state rule | Predeclared like-for-like rule (fixed probe set, whole-pass comparison), never consecutive windows of a mixed stream; non-converging lifetimes flagged and analysed with and without (WP02, M10) |
| Warm-up | At least 20 iterations per lifetime, covering every path the measured window uses [R14 §4] |
| Placement | Per the WP03 record; GPU and CPU policies recorded |
| Quiet gate | Lab thresholds (`LAB/tools/env-control/lib/gate.mjs`), refused blocks skipped (official). If the gate cannot pass on the shared desktop, only effects above the recorded upper-bound MDE may be claimed (EXECUTION-PLAN Stage 0) |
| Calibration | WP01 calibration receipt at the measured commit, same boot, within 12 h; path and SHA-256 TBD at registration; no waivers (official) |
| Accounting cross-check | Host-wide `/proc/stat` against arm cgroup CPU at every window boundary; out-of-cgroup work (including `systemd-coredump`) above 5 % of the arm's CPU invalidates the lifetime (threshold Proposed; WP02) |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | Thermal throttling above the WP03 record's limit in a cell (cell flagged and repeated after cool-down); budget |
| Kill criterion | Not a product kill. Retention below 0.8 forces serialised scheduling of compile and inference |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | TBD at freeze from the pilot; ceilings per attempt from the WP03 record |
| Model | none |
| People | Author and reviewer time only |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Target unified-memory host per its WP03 record; identity TBD at registration.

## 12. Artifact identity

As C05 plus compile job set.

## 13. Failure meaning

Holds for this host, model and compiler only. CPU time and throughput are not energy.

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

- Edition 3 keeps unified memory as a lane-or-preference question for X5 [E3 §10, §15]; this record narrows the scheduling consequence.

## Open questions

- Does a discrete-GPU host beat the unified-memory host on accepted output per unit energy? Needs its own matched arm and a power meter (R09).

## Sources

- Edition 2 §12; Edition 3 §10, §13, §15.
- R09 §2, §4, §8; R15 RISK-17; `docs/templates/HARDWARE-QUALIFICATION.md`.
