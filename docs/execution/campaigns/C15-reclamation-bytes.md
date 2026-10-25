# C15 — Reclamation bytes after a campaign

> Reconstructed 2026-10-17. The original C15 was not available; this draft is rebuilt from
> Edition 2 (§3), Edition 3 (§9, §12), the white paper (p. 21), R06 (§1.7), R11, R15 (RISK-14) and R16 (DEC-06). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

Discarding a name is not freeing storage; after a campaign the factory must know what is live, retained, awaiting persistence and reclaimable, measured in bytes [E2 §3; W p.21]. This record runs long campaigns through the kernel workcell and measures what is not reclaimed after teardown, so that WP18's accounting can be trusted.

## Summary

- One primary metric: unreclaimed bytes per 1,000 candidates after teardown, with an upper bound.
- Accounting must balance: allocated = retained + reclaimed + leaked, with leaked reported.
- 16 lifetimes of 10,000 candidates each; memory sampled from counters the candidate cannot touch.
- The lab's isolated-vm thread plateau (bounded pool, not a leak, to 250 lifecycles) is the method precedent, not evidence for Wasmtime (Recorded, R12 §4.2).

## Record header

| Field | Content |
|---|---|
| Record | C15 |
| Status | Draft — not registered |
| Stage | 3 |
| Work packages | WP18, WP14, WP04, WP01 |
| Risk or decision addressed | RISK-14 (memory is not actually reclaimed); DEC-06 |
| What cannot be known yet | Wasmtime allocator behaviour on this host; the overlay retention policy for useful failures (R11 open question) |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c15-reclamation-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | Stage 3 acceptance support |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | After a campaign's teardown, how many bytes remain that should have been reclaimed, and does the accounting balance? It decides whether reclamation accounting is trusted for later campaigns |
| Hypothesis and predicted observable | Proposed: unreclaimed bytes are indistinguishable from zero and the accounting balances within 1 %. Observable: cgroup `memory.current`, `memory.stat`, store sizes and ledger scratch records before and after teardown |
| Strongest rival | Long-lived pools, allocator arenas or ledger scratch grow slowly and are counted as "bounded" by a plateau that is really a slope |
| Claim-ladder rung | Supports rung 2 for the kernel contract |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Unreclaimed bytes per 1,000 candidates = (post-teardown resident and stored bytes − pre-campaign baseline) ÷ (candidates ÷ 1,000), estimated as the slope across lifetimes with its 95 % upper bound |
| Decision rule | Trust reclamation accounting if the upper bound is below 1 MiB per 1,000 candidates (Proposed threshold) and the accounting balance error is below 1 %. Otherwise WP18 is not accepted and C04's memory secondary is reported with this caveat |
| Secondary metrics | Retained-memory slope within lifetimes; ledger scratch bytes expired versus retained; thread and handle counts (plateau versus slope, S8) |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| K — Kernel workcell | Wasmtime workcell with WP18 accounting | Digests TBD at freeze | Warm machinery; 10,000 fresh candidates per lifetime | Workcell | Workcell cgroup |

Control arm: none. Null arm: Idle workcell for the same duration (baseline drift).

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | Any frozen evaluator; not under test |
| Acceptance boundary | Not applicable to the primary; candidates are evaluated normally |
| Independent validator | Independent byte count from cgroup and filesystem counters, not from WP18's own report |
| Parity rule | WP18's reported totals versus the independent count |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | Kernel candidate stream from C04's task set; stream SHA-256 TBD at freeze |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | none |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One lifetime |
| Planned n | 16 lifetimes × 10,000 candidates |
| Power calculation | Slope estimated from 16 points; the bound's width depends on between-lifetime variance, unknown here, so a pilot of 4 lifetimes sets whether 16 suffices (Estimated) |
| Minimum samples | 16 lifetimes |
| Randomisation | PRNG `ifl-prng` from WP01 (`LAB/harness/lib/prng.mjs`); seed TBD at registration; schedule SHA-256 recorded before the first job |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Process-cold means a fresh process with page cache warm (caches cannot be dropped without root); disk compile caches disabled or pinned; warm state declared per arm [R14 §4] |
| Steady-state rule | Not applicable |
| Warm-up | Declared and excluded from the slope |
| Placement | Pinned quiet cores taken from the WP03 record (not the scheduler's preferred cores); driver on separate cores; SMT policy recorded; no `cpu.max` on timed runs [R14 §4] |
| Quiet gate | Lab thresholds (`LAB/tools/env-control/lib/gate.mjs`), refused blocks skipped (official). If the gate cannot pass on the shared desktop, only effects above the recorded upper-bound MDE may be claimed (EXECUTION-PLAN Stage 0) |
| Calibration | WP01 calibration receipt at the measured commit, same boot, within 12 h; path and SHA-256 TBD at registration; no waivers (official) |
| Accounting cross-check | Host-wide `/proc/stat` against arm cgroup CPU at every window boundary; out-of-cgroup work (including `systemd-coredump`) above 5 % of the arm's CPU invalidates the lifetime (threshold Proposed; WP02) |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | Memory ceiling reached (stop; that is a finding); budget |
| Kill criterion | Not a product kill. Failure blocks WP18 acceptance and the Stage 3 exit gate's reclamation item |
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

Workcell, accounting code, stream: digests TBD at freeze.

## 13. Failure meaning

A pass holds for this workcell version and stream; a runtime bump re-opens it. It is not a statement about the hosted lane.

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

- Edition 3 makes the attempt row a module instance [E3 §9]; this record checks that the attempt row really ends.

## Open questions

- Which useful failures are retained as counterexamples, and do they count as reclaimable? Declared at freeze.

## Sources

- Edition 2 §3; Edition 3 §9, §12; white paper p. 21.
- R06 §1.7; R11 (reclamation and ownership); R12 §4.2; R15 RISK-14; R16 DEC-06.
