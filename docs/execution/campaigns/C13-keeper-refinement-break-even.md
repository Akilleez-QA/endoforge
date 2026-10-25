# C13 — Keeper refinement break-even

> Reconstructed 2026-10-17. The original C13 was not available; this draft is rebuilt from
> Edition 2 (§4, §6), Edition 3 (§5, §11, §12), R03, R05, R15 (RISK-26) and R16 (DEC-29, DEC-33, DEC-35). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

The arithmetic of where to spend refinement is optimization cost divided by saving per subsequent use, in the same units: 200 CPU-seconds to save one millisecond per execution needs 200,000 executions to repay the CPU alone [E3 §11]. This record refines one accepted, heavily used capability (for example an AssemblyScript kernel rewritten through the Rust native lane) and measures the saving per use, so that the break-even count is measured rather than assumed.

## Summary

- One primary metric: saving per use = CPU-seconds per execution, incumbent minus refined, paired by block.
- The break-even count n* = total refinement cost ÷ saving per use is computed from the primary and the recorded refinement cost, with its interval (Derived).
- The refined artifact gets a new identity and its own qualification; it inherits no correctness (DEC-33).
- Decision: the refinement budget rule, and whether this capability's projected uses exceed n*.

## Record header

| Field | Content |
|---|---|
| Record | C13 |
| Status | Draft — not registered |
| Stage | 6 |
| Work packages | WP21, WP28, WP31, WP09 |
| Risk or decision addressed | RISK-26 (refinement spend does not repay); DEC-29, DEC-33, DEC-35 |
| What cannot be known yet | Which capability (needs real use counts from Stage 5); refinement route; prices |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c13-refinement-break-even-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | Product loop (E3 §11); Stage 6 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | How much does a refined implementation save per use, and therefore how many uses repay its refinement? It decides the refinement budget rule |
| Hypothesis and predicted observable | Proposed: the refined artifact is faster per use; the predicted n* is written into the precommit from a pilot. Observable: paired CPU per execution and the recorded refinement cost |
| Strongest rival | The saving is within noise or the refinement cost is underestimated (model, review and re-qualification omitted), so n* exceeds any plausible use count |
| Claim-ladder rung | Could contribute to rung 5 only if, on the precommitted metric, the refined capability gives more accepted improvement at equal total cost than the incumbent baseline [E3 §17]; this record alone does not claim rung 5 |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Saving per use = CPU-seconds per execution of the incumbent minus the refined artifact, ratio of block totals converted to a per-execution difference, on the capability's recorded input distribution |
| Decision rule | Refine (and adopt the budget rule) only if the projected uses over the declared horizon exceed the upper 95 % bound of n* = (recorded refinement cost in priced units) ÷ (lower 95 % bound of saving per use). Otherwise the incumbent stays and the rule records the shortfall |
| Secondary metrics | Wall time per execution; peak memory; refinement cost broken down into tokens, CPU-seconds, review minutes and re-qualification; held-out acceptance of the refined artifact |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| I — Incumbent | The accepted capability as active | Artifact digest from the ledger | Warm | Workcell | Workcell cgroup |
| R — Refined | Rewrite through the Rust native lane (or an algorithmic product-loop change), qualified against the same frozen evaluator and held-out acceptance | New artifact digest TBD at freeze | Warm | Workcell | Workcell cgroup |

Control arm: I. Null arm: Harness-only null.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | The capability's frozen evaluator; hash from the ledger |
| Acceptance boundary | R must pass the frozen evaluator and held-out acceptance with a matched regression gate against I and a fixed reference [E3 §11] before any timing counts |
| Independent validator | Independent oracle on recorded inputs |
| Parity rule | Output equality on the recorded input distribution |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | Recorded input distribution of the chosen capability (private; digest only) |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | Held-out acceptance fixtures, rotated per C18's rule |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One block |
| Planned n | 16 blocks minimum |
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
| Kill criterion | Not a product kill. If projected uses do not exceed n*, the refinement is not adopted and the budget rule records the case |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | TBD at freeze from the pilot; ceilings per attempt from the WP03 record |
| Model | Refinement tokens recorded; ceiling TBD at freeze |
| People | Review minutes recorded |
| Price declaration | Declared before data, same units as C07 |

## 11. Environment identity

Main-rig (local lane): Ryzen 9 7950X, 16 cores / 32 threads, about 125 GiB RAM, kernel `7.2.5-3-omarchy`, shared desktop (as recorded 8 Oct 2026 [R12 §2]). Microcode, governor, frequency policy, SMT state, cgroup controllers, and Node, Wasmtime and compiler versions with binary hashes: TBD at registration, from the WP01 snapshot and the WP03 record. Repository head TBD at registration; dirty tree refused (official).

## 12. Artifact identity

Incumbent and refined artifacts, toolchains, input distribution digest: TBD at freeze.

## 13. Failure meaning

A break-even holds for one capability, one input distribution and one machine; qualification records do not transfer [E3 §12]. The language label is not rewarded, the measured improvement is.

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

- Edition 3 keeps Edition 2's break-even arithmetic and adds that a Rust rewrite is one refinement among several [E3 §11, §12].

## Open questions

- What horizon makes projected uses credible? Proposed: the capability's observed use rate over the preceding month, extrapolated no further than three months.

## Sources

- Edition 2 §4, §6; Edition 3 §5, §11, §12.
- R03; R05; R15 RISK-26; R16 DEC-29, DEC-33, DEC-35.
