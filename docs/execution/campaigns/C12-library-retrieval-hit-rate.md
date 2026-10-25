# C12 — Library retrieval hit rate

> Reconstructed 2026-10-17. The original C12 was not available; this draft is rebuilt from
> Edition 3 (§10, §12), R04 (§5, §9), R15 (RISK-13, RISK-28) and R16 (DEC-52, DEC-61). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

Composable requests are the only class Edition 3 estimates at 0.5–2 s, because they need retrieval, binding and a contract check but no generation [E3 §10]. Retrieval is itself semantic search, a model call with the same trust properties as any other [E3 §12]. This record measures how often retrieval satisfies a request with a composition that passes the request's frozen evaluator, and how often it proposes a wrong one.

## Summary

- 100 requests against a library that holds a declared minimum of qualified capabilities (TBD at freeze).
- One primary metric: retrieval hit rate. Guard: false-composition rate, with zero false compositions in 59 proposals bounding it below 5 % (Derived).
- Ground truth for "composable" comes from two raters blind to retrieval output.
- Decision: whether retrieval may compose without generation, or only suggest.

## Record header

| Field | Content |
|---|---|
| Record | C12 |
| Status | Draft — not registered |
| Stage | 5 |
| Work packages | WP31, WP27, WP06 |
| Risk or decision addressed | RISK-28 (retrieval is itself a model call), RISK-13 (landfill library); DEC-52, DEC-61 |
| What cannot be known yet | Library size at the time; request source; whether retrieval uses a model or fingerprints alone |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c12-retrieval-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | Stage 5 library |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | What fraction of requests does retrieval satisfy with a composition that passes the frozen evaluator, and how often does it propose a composition that fails? It decides whether retrieval may compose without generation |
| Hypothesis and predicted observable | Proposed: a library built around contracts lets retrieval satisfy a useful share of requests with few false compositions. Observable: per-request retrieval outcome and evaluator verdict |
| Strongest rival | Retrieval false positives are frequent and credentialed by surface similarity; the library behaves as a landfill [E3 §12] |
| Claim-ladder rung | Contributes evidence toward rung 6 (lifetime economics); does not move it |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Retrieval hit rate = requests satisfied by a retrieved composition that passes the request's frozen evaluator ÷ requests submitted |
| Decision rule | Guard first: if the one-sided 95 % upper bound on the false-composition rate (compositions proposed as satisfying that fail the frozen evaluator or are rejected by the person ÷ compositions proposed) is at or above 5 %, retrieval may only suggest. If the guard passes, retrieval composes by default and the hit rate (with its 95 % interval) sets the expected saving |
| Secondary metrics | Hit rate among requests the raters judged composable (recall); tokens and wall time saved per hit against generation; retrieval latency; retrieval decisions per model call |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| R — Retrieval first | WP31 retrieval (fingerprint and contract match; model-assisted search if used, model TBD at freeze), then full qualification | Library snapshot digest TBD at freeze | Warm index | Workcell | Workcell cgroup |
| G0 — Generation only | The Stage 4 cycle without retrieval, for the cost comparison | Same digests | Warm | Workcell | Workcell cgroup |

Control arm: G0. Null arm: none.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | One frozen evaluator per request, synthesized before retrieval runs; hash TBD at freeze |
| Acceptance boundary | WP09 gate order; a retrieved composition is a candidate like any other and is qualified in full |
| Independent validator | Two raters, blind to retrieval output, label each request composable or not from the library catalogue |
| Parity rule | Rater disagreement reported (κ) and adjudicated |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | 100 requests from the library domain's users, collected after the library snapshot is frozen; request set SHA-256 TBD at freeze |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | none |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One request |
| Planned n | 100 requests |
| Power calculation | Hit rate: 95 % half-width about ±10 points at n = 100 near 50 % (Derived). Guard: zero false compositions in 59 proposals bounds the rate below 5 %; one in 93 does (Derived, exact binomial). If retrieval proposes fewer than 59 compositions, the guard cannot pass and retrieval stays suggest-only |
| Minimum samples | 59 proposed compositions for the guard |
| Randomisation | PRNG `ifl-prng` from WP01 (`LAB/harness/lib/prng.mjs`); seed TBD at registration; schedule SHA-256 recorded before the first job |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Not applicable: this campaign makes no machine-timing claim for the primary; latency secondaries use the default rules |
| Steady-state rule | Not applicable to the primary |
| Warm-up | Not applicable to the primary |
| Placement | Pinned quiet cores taken from the WP03 record (not the scheduler's preferred cores); driver on separate cores; SMT policy recorded; no `cpu.max` on timed runs [R14 §4] |
| Quiet gate | Lab thresholds (`LAB/tools/env-control/lib/gate.mjs`), refused blocks skipped (official). If the gate cannot pass on the shared desktop, only effects above the recorded upper-bound MDE may be claimed (EXECUTION-PLAN Stage 0) |
| Calibration | WP01 calibration receipt at the measured commit, same boot, within 12 h; path and SHA-256 TBD at registration; no waivers (official) |
| Accounting cross-check | Host-wide `/proc/stat` against arm cgroup CPU at every window boundary; out-of-cgroup work (including `systemd-coredump`) above 5 % of the arm's CPU invalidates the lifetime (threshold Proposed; WP02) |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | Budget exhausted; environment gate failure in more than a quarter of blocks; containment or authority violation; ambiguous execution (unknown rate above 1 %, or 2 % in any lifetime) makes the affected arm inadmissible |
| Kill criterion | Guard failure: retrieval may only suggest, never compose without generation and full qualification |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | TBD at freeze from the pilot; ceilings per attempt from the WP03 record |
| Model | Retrieval model calls if used; token ceiling TBD at freeze |
| People | Two raters, about 5 minutes per request (Estimated) |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Main-rig (local lane): Ryzen 9 7950X, 16 cores / 32 threads, about 125 GiB RAM, kernel `7.2.5-3-omarchy`, shared desktop (as recorded 8 Oct 2026 [R12 §2]). Microcode, governor, frequency policy, SMT state, cgroup controllers, and Node, Wasmtime and compiler versions with binary hashes: TBD at registration, from the WP01 snapshot and the WP03 record. Repository head TBD at registration; dirty tree refused (official).

## 12. Artifact identity

Library snapshot, index, fingerprint probe set, retrieval configuration: digests TBD at freeze.

## 13. Failure meaning

Results hold for this library snapshot and domain. A good hit rate is not lifetime economics: holding cost, re-qualification and churn are rung 6's question and need months.

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

- New in Edition 3: the library as inventory with a holding cost, and retrieval as a model call [E3 §12].

## Open questions

- What library size makes the measurement meaningful? Fixed at freeze from the number of accepted capabilities after C07.

## Sources

- Edition 3 §10, §12.
- R04 §5, §9; R15 RISK-13, RISK-28; R16 DEC-52, DEC-61.
