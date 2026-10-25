# C11 — Batch evaluation: does CPU fall, or only move?

> Reconstructed 2026-10-17. The original C11 was not available; this draft is rebuilt from
> Edition 2 (§7, §8), Edition 3 (§9, §11), R06 (§1.5, §3, §5), R07 (§3, §5), R12 (§4.3) and R15 (RISK-23). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

The lab's fastloop work found that in a closed loop pools only move cost off the request path, while batching moved CPU; shared-program batching cut tsc-rs WASM CPU per candidate from 29.6 to 9.3 ms but exposed a cross-candidate leak (Pilot (not a result) [R06 §3; R07 §3]). This record tests, under the harness and with full host accounting, whether batched evaluation lowers total CPU per verified candidate or only moves it, and whether batch equals solo byte for byte.

## Summary

- Two arms: B (batched evaluation, 32 candidates per request with shared preparation) and S (solo).
- One primary metric: total CPU-seconds per verified candidate, including every helper process and out-of-cgroup work, B ÷ S.
- Guard: batch equals solo byte for byte in stream, reversed and shuffled orders.
- The lab's pilot figures are context only; none is a result.

## Record header

| Field | Content |
|---|---|
| Record | C11 |
| Status | Draft — not registered |
| Stage | 6 |
| Work packages | WP09, WP14, WP22 (if the compatibility-lane checker is batched), WP02 (accounting) |
| Risk or decision addressed | RISK-23 (measurement artefacts); R06 rank 5 |
| What cannot be known yet | Which evaluation stage is batched first (kernel evaluation or compatibility-lane checking); the batch size optimum |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c11-batch-movement-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | R06 rank 5; Stage 6 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | Does batching evaluations reduce total CPU per verified candidate by at least 10 %, with byte-identical results, once all helper and out-of-cgroup work is counted? It decides whether batching is adopted as a regime |
| Hypothesis and predicted observable | Proposed: shared preparation is paid once per batch, so total CPU falls. Observable: per-block CPU totals from cgroup readbacks plus host-wide cross-check |
| Strongest rival | The saving is accounting: CPU moves to helpers, other processes or the request-path-free part of the pipeline, and the total is unchanged; or hidden per-consumer state in the shared structure changes results (as the lab's 10-suggestion limit did [R07 §3]) |
| Claim-ladder rung | None; Stage 6 reduction |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Total CPU-seconds per verified candidate = (arm cgroup CPU + attributed out-of-cgroup CPU from host-wide cross-check) per block ÷ verified candidates in the block; compared as B ÷ S |
| Decision rule | Adopt batching if the upper 95 % bound of B ÷ S is below 0.9 and the parity guard passes in all three orders. Guard failure rejects regardless of CPU |
| Secondary metrics | Request-path latency per candidate; share of CPU moved out of the arm cgroup; per-stage CPU; batch-size sensitivity (16, 32) |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| B — Batched | 32 candidates per request, shared preparation, results mapped back per candidate; recheck-solo guard for known cross-candidate effects | Digest TBD at freeze | Warm | As the lane | Arm cgroup plus host-wide cross-check |
| S — Solo | One candidate per request | Same | Warm | Same | Same |

Control arm: S. Null arm: Harness-only null.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | Frozen per task; hash TBD at freeze |
| Acceptance boundary | WP09 gate order |
| Independent validator | Independent oracle; cost not charged |
| Parity rule | B versus S byte equality per candidate in stream, reversed and shuffled orders |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | An open-loop candidate stream from C03b or C07 (content-unique verified accepts counted, as the lab's P6 design); stream SHA-256 TBD at freeze |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | none |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One block (replicate lifetime per arm) |
| Planned n | 16 blocks minimum; 32 recommended (the lab's contended pilot) |
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
| Kill criterion | Not a product kill. Guard failure or no CPU fall: batching is not adopted; if latency alone improves, it may be used only as a latency measure and reported as such |
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

Evaluation code, batch mapper, stream: digests TBD at freeze. Lab references: `LAB-WT/fastloop/factory/bench/variants-h2h.mjs`, `LAB-WT/fastloop/docs/FASTLOOP.md` §2–§4.

## 13. Failure meaning

Parity in tested orders is evidence, not proof; the lab itself called its guards tested, not proven [R07 §3]. A CPU fall applies to this stream composition only.

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

- Edition 3 requires real host accounting for release confirmation [E3 §11]; this record makes accounting the primary.

## Open questions

- Is the shared-program regime sound beyond tested orders? A proof or a much larger randomised order set would be needed.

## Sources

- Edition 2 §7, §8; Edition 3 §9, §11.
- R06 §1.5, §3, §5; R07 §3, §5; R12 §4.3; R15 RISK-23.
- `~/Work/isolate-factory-lab-wt/fastloop/docs/FASTLOOP.md`.
