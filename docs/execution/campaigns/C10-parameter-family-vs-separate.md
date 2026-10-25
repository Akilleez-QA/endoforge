# C10 — Parameter family versus separate-program evaluation

> Reconstructed 2026-10-17. The original C10 was not available; this draft is rebuilt from
> Edition 2 (§5, §7), Edition 3 (§4, §10), R06 (§1.4, §5), R07 (§3, §5) and R15 (RISK-23). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

A threshold change should not cost a compile [E2 §5]. Some searches can use one executable with many parameter blocks [E2 §7]. This record measures whether evaluating a family of parameter-only variants through one executable saves CPU against compiling and evaluating each variant as a separate program, and whether every finalist still qualifies standalone [R07 §5].

## Summary

- Two arms on the same parameter-only variant stream: F (one executable, parameter blocks) and P (one program per variant).
- One primary metric: CPU-seconds per evaluated variant, F ÷ P, paired by block. Guard: verdict parity per variant, and standalone qualification of every finalist.
- Secondary of direct decision value: the fraction of real campaign candidates that are parameter-only (R06 open question), read from C03b and C07 streams.
- No lab measurement exists for this; it is ranked fourth in R06 on reasoning only.

## Record header

| Field | Content |
|---|---|
| Record | C10 |
| Status | Draft — not registered |
| Stage | 6 |
| Work packages | WP14, WP19, WP09; streams from C03b and C07 |
| Risk or decision addressed | RISK-23 (measurement artefacts); R06 rank 4; R07 §3, §5 |
| What cannot be known yet | The share of parameter-only variants in a real stream; the kernel tasks chosen |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c10-param-family-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | R06 rank 4; Stage 6 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | Does evaluating parameter-only variants as one executable with parameter blocks cut CPU per variant by at least 10 % without changing any verdict? It decides whether parameter families become an admission regime |
| Hypothesis and predicted observable | Proposed: F saves the compile per variant; the saving is large when compile dominates. Observable: per-block CPU totals and per-variant verdicts |
| Strongest rival | Compile is cheap for small kernels relative to evaluation, so the saving is under 10 %; or shared structure leaks state between variants |
| Claim-ladder rung | None; Stage 6 reduction |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | CPU-seconds per evaluated variant = arm cgroup CPU-seconds per block ÷ variants evaluated in the block; compared as F ÷ P, ratio of totals per block |
| Decision rule | Adopt families if the upper 95 % bound of F ÷ P is below 0.9 and the parity guard passes. Guard: any per-variant verdict difference, or any finalist failing standalone qualification, rejects the regime regardless of CPU |
| Secondary metrics | Compile count per accepted variant; wall time per variant; fraction of C03b and C07 candidates expressible as parameter-only |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| F — Parameter family | One compiled kernel; variants supplied as schema-validated parameter blocks | Kernel and schema digests TBD at freeze | Warm module; fresh instance per variant | Wasmtime workcell | Workcell cgroup |
| P — Separate programs | Each variant emitted as its own source, compiled and evaluated | Same compiler digest | Warm compiler; fresh compile per variant | Same | Same |

Control arm: P. Null arm: Harness-only null.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | Frozen per task; hash TBD at freeze |
| Acceptance boundary | WP09 gate order; finalists from F are re-run as standalone artifacts in the deployment configuration [R07 §5] |
| Independent validator | Independent oracle per variant; cost not charged |
| Parity rule | Per-variant verdict F versus P must match; standalone finalist verdict must match F's |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | Kernel tasks whose campaign variants differ only in parameters (thresholds, coefficients, units table entries); stream SHA-256 TBD at freeze |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | none |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One block (a replicate process lifetime per arm) |
| Planned n | 16 blocks minimum; 32 if the pilot's spread requires |
| Power calculation | Paired log-ratio of per-block totals. Floor of 16 blocks applies (WP02, S2); the lab's contended pilot recommended 32 (Pilot (not a result), R12 §4.3). Recorded noise upper bounds on this host (quiet gate failed): MDE at N = 30 of 1.3 % (wasm), 1.7 % (js), 3.6 % (process wall), 9.3 % (alloc) (Recorded upper bounds, R12 §4.2). A 10 % effect is detectable at the floor; effects under 2 % need n ≥ 100 and a passing quiet gate [R14 §4]. Final n set from a pilot whose receipt hash is cited |
| Minimum samples | 16 blocks |
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
| Stop rules | Budget exhausted; environment gate failure in more than a quarter of blocks; containment or authority violation; ambiguous execution (unknown rate above 1 %, or 2 % in any lifetime) makes the affected arm inadmissible |
| Kill criterion | Not a product kill. If the guard fails, parameter families are not admitted and every variant is a separate program |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | TBD at freeze from the pilot; ceilings per attempt from the WP03 record |
| Model | none |
| People | Author and reviewer time only |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Main-rig (local lane): Ryzen 9 7950X, 16 cores / 32 threads, about 125 GiB RAM, kernel `7.2.5-3-omarchy`, shared desktop (as recorded 8 Oct 2026 [R12 §2]). Microcode, governor, frequency policy, SMT state, cgroup controllers, and Node, Wasmtime and compiler versions with binary hashes: TBD at registration, from the WP01 snapshot and the WP03 record. Repository head TBD at registration; dirty tree refused (official).

## 12. Artifact identity

Kernels, parameter schemas, compiler, streams: digests TBD at freeze.

## 13. Failure meaning

A CPU saving here holds for parameter-only variants; it says nothing about variants that change structure. A parity failure is a defect in the family mechanism, not in the kernels.

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

- Edition 3's "generate less" lever includes parameter binding [E3 §10]; this record measures one form of it.

## Open questions

- How large is the parameter-only share in practice? If it is small, the regime is not worth its complexity whatever the CPU ratio.

## Sources

- Edition 2 §5, §7; Edition 3 §4, §10.
- R06 §1.4, §5; R07 §3, §5; R15 RISK-23.
