# C14 — State-preserving live revision

> Reconstructed 2026-10-17. The original C14 was not available; this draft is rebuilt from
> Edition 2 (§9, §15), Edition 3 (§1, §4, §9), the diagram atlas (sheet 14), R04 (§3, §4) and R16 (DEC-06, DEC-08). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

The current version stays pinned while a better one is qualified, and activation is a guarded revision change that loses no state, focus or authority [E3 §1, §4]. Edition 2's first useful generated interface must show a state-preserving revision, restart and rollback [E2 §15]. This record measures how often a kernel revision loses state when activated, so that automatic activation is allowed or not on evidence.

## Summary

- Revisions of the slice capability are activated on a live session; post-activation state is compared with the state obtained by replaying recorded events through the new kernel (R04 open question).
- One primary metric: state-loss rate. Zero losses in 299 revisions bounds it below 1 % (Derived).
- Any authority loss fails the campaign regardless of rate.
- A subset of activations is killed mid-activation to check that exactly one revision is active after recovery.

## Record header

| Field | Content |
|---|---|
| Record | C14 |
| Status | Draft — not registered |
| Stage | Stage 6+ / optional (until it runs, kernel revisions activate only with the person's confirmation; moved from 4 by the 17 Oct critique) |
| Work packages | WP28, WP26, WP17, WP04 |
| Risk or decision addressed | RISK-19 (manufactured software not predictable); DEC-06 (three lifetimes), DEC-08 (portable unit is a contract plus checkpoint) |
| What cannot be known yet | The revision mix that real requests produce; the state schema of the slice capability |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c14-live-revision-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | E2 §15 milestone; Stage 4 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | Does activating a qualified kernel revision preserve state, focus and authority, and does recovery after a kill during activation leave exactly one active revision? It decides whether kernel revisions may activate automatically |
| Hypothesis and predicted observable | Proposed: replay-checked migration with CAS activation loses no state. Observable: state digests, focus target and authority set before and after each activation |
| Strongest rival | Schema-changing revisions lose or corrupt state in ways replay does not catch (for example derived fields, ordering) |
| Claim-ladder rung | Supports rung 4 (a person keeps using the capability across revisions); does not move it alone |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | State-loss rate = activated revisions whose post-activation state, focus or authority differs from the replayed expectation ÷ revisions activated |
| Decision rule | Automatic activation allowed for kernel revisions if zero authority losses and the upper 95 % bound of the state-loss rate is below 1 %. Otherwise every kernel revision needs the person's confirmation |
| Secondary metrics | Rollback success rate; activation latency; recovery outcome after kill-during-activation (exactly one active revision); time to restart from durable records |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| V — Live revision | WP28 activation with replay-checked migration, CAS on a named slot | Activation code digest TBD at freeze | Live session state | Workcell plus host renderer | Workcell cgroup |

Control arm: none. Null arm: none.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | Each revision is qualified against the capability's frozen evaluator before activation; hash from the ledger |
| Acceptance boundary | Pre-activation: qualification passes. Post-activation: state digest equals replay digest; focus target unchanged; authority set unchanged |
| Independent validator | Independent replay of the recorded event log through the new kernel in a separate process |
| Parity rule | Live state versus replay state, byte equality after canonicalisation |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | Revision mix (TBD at freeze, proportions declared): parameter changes, schema-compatible field additions, migrations requiring transforms, rendering-only glue changes; plus 30 kill-during-activation injections |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | none |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One activated revision |
| Planned n | 299 revisions (zero-loss plan); 473 allows one loss |
| Power calculation | Exact one-sided 95 %: 0 losses in 299 or at most 1 in 473 bounds the rate below 1 % (Derived) |
| Minimum samples | At least 50 schema-changing revisions |
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
| Accounting cross-check | Host-wide `/proc/stat` against arm cgroup CPU at every window boundary; out-of-cgroup work (including `systemd-coredump`) above 5 % of the arm's CPU invalidates the lifetime (threshold Proposed; WP02) |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | Any authority loss stops the run (it is decisive); budget |
| Kill criterion | Any authority loss, or the state-loss bound not below 1 %: kernel revisions require the person's confirmation per activation |
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

Capability kernels (each revision), glue, activation code, event logs: digests TBD at freeze.

## 13. Failure meaning

A pass covers this revision mix and this capability's state shape. It does not cover cross-tenant reuse or host contract changes, which re-qualify from scratch [E3 §13].

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

- Edition 3 keeps live revision and the pinned incumbent; it moves checkpoints to durable records, never a guest heap [E3 §9].

## Open questions

- Can replay cover effects that were emitted as data but executed by the host? Proposed: effects are replayed as data and compared, never re-executed.

## Sources

- Edition 2 §9, §15; Edition 3 §1, §4, §9; atlas sheet 14.
- R04 §3, §4; R16 DEC-06, DEC-08.
