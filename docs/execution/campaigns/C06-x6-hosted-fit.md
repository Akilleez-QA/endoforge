# C06 — E3 X6: hosted fit

> Reconstructed 2026-10-17. The original C06 was not available; this draft is rebuilt from
> Edition 3 (§13, §15), R12 (U05, U06), R14 X6, R15 (RISK-01, RISK-02, RISK-27) and R16 (DEC-50, DEC-59). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

This record drafts the precommit for Edition 3's sixth experiment: whether tsc-rs as WebAssembly, the harness and one module instance fit inside a Workers isolate, and at what latency relative to native [E3 §13, §15]. It decides whether the hosted lane compiles or only runs pre-checked artifacts.

## Summary

- Fit is deterministic per project: the worst frozen project (lab `w-check-stress`) run 10 times to rule out allocator variance [R14 X6].
- One primary metric: peak working set (JS heap plus maximum WebAssembly linear memory) against 128 MB. A predeclared guard: check latency ratio, isolate ÷ native, killing above 3×.
- The lab predeclared (P5, never measured) that a fresh check on `w-check-stress` exceeds 128 MiB. That is a Proposed prediction, not a result.
- Upstream platform limits must be rechecked and dated before the run (RISK-27).

## Record header

| Field | Content |
|---|---|
| Record | C06 |
| Status | Draft — not registered |
| Stage | 3 |
| Work packages | WP22 (pinned tsc-rs WASM), WP09 (the gates WP25 ports), WP25 (which owns the port of those gates to the Workers runtime; WP09 does not deliver it) |
| Risk or decision addressed | RISK-01 (tsc-rs age, provenance, parity), RISK-02 (Workers memory ceiling), RISK-27 (upstream drift); DEC-50, DEC-59 |
| What cannot be known yet | Current Workers and Dynamic Workers limits (Upstream, read 14 Oct 2026 [R12 U06]); account plan; whether the 4.2 MB module figure applies (it did not reproduce at v0.7.0 [R12 §3]) |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c06-x6-hosted-fit-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | E3 X6 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | Does a type-check of the worst frozen project, plus the harness and one module instance, fit in a 128 MB Workers isolate, and is it within 3× native latency? It decides whether the hosted lane compiles |
| Hypothesis and predicted observable | The lab's predeclared P5 (Proposed, never measured): a fresh check on `w-check-stress` exceeds 128 MiB. Observable: peak JS heap plus maximum linear memory per check |
| Strongest rival | The working set fits because the size build and a single check stay well below the ceiling; the binding limit is latency, not memory |
| Claim-ladder rung | Rung 1 for the hosted lane if the compiler runs inside the isolate under receipt [E3 §17] |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Peak working set of the check inside the isolate = maximum over the run of (JS heap used + WebAssembly linear memory), in MiB, for the worst-case project, against the platform limit as rechecked at registration (Upstream, "128 MB" in the provider's documentation [R12 U06]; whether the provider means 128 MiB or 128,000,000 bytes is recorded at recheck and the stricter reading is used) |
| Decision rule | Over the limit in any of 10 repeats: kill. Guard (predeclared, can only kill): median latency ratio isolate ÷ native over 30 paired runs per project, with a bootstrap 95 % interval; point estimate above 3×: kill |
| Secondary metrics | Latency ratio on the 50-file overlay project; Dynamic Worker creation cost per candidate; compressed Worker size against the 10 MB limit (lab builds 2.21 MB and 2.65 MB gzip, Recorded/Derived [R12 §3]) |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| W — Workers isolate | Factory Worker with tsc-rs WASM (size build; speed build as a sensitivity run), harness and one module instance; Dynamic Workers for candidates | Worker bundle SHA-256; tsc-rs module SHA-256 TBD at freeze | Compiled module warm; fresh check state | Workers isolate | Memory sensor per `LAB/adapters/checkers/tscrs-wasm/memory-sensor.mjs` method |
| N — Native | tsc-rs native and the TS7 native oracle on the Main-rig | Binary hashes TBD at freeze | Warm process | Owned process | Arm cgroup |

Control arm: N. Null arm: none.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | none |
| Acceptance boundary | Diagnostic parity with the TS7 native oracle on each project is required for a latency sample to count |
| Independent validator | TS7 native (DEC-59: Microsoft's native compiler is the parity oracle) |
| Parity rule | Any diagnostic difference between W and the oracle is a parity failure; the run is excluded and reported |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | `w-check-stress` (worst case), a 50-file overlay project, and `w-check-medium`, from the lab's frozen workloads (tree digests TBD at freeze) |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | none |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One check run (fit); one paired run (latency) |
| Planned n | Fit: 10 repeats on the worst case. Latency: 30 paired runs per project |
| Power calculation | Fit is deterministic per project; 10 repeats rule out allocator variance. Latency: ratio of medians with bootstrap CI from 30 pairs (R14 X6) |
| Minimum samples | none beyond planned n |
| Randomisation | PRNG `ifl-prng` from WP01 (`LAB/harness/lib/prng.mjs`); seed TBD at registration; schedule SHA-256 recorded before the first job |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Compiled module cached by the platform; check state fresh per run; declared |
| Steady-state rule | Predeclared like-for-like rule (fixed probe set, whole-pass comparison), never consecutive windows of a mixed stream; non-converging lifetimes flagged and analysed with and without (WP02, M10) |
| Warm-up | At least 20 iterations per lifetime, covering every path the measured window uses [R14 §4] |
| Placement | Hosted: not controllable, recorded (colo, time). Native: pinned per WP03 |
| Quiet gate | Native side per WP03; hosted side not gateable, recorded |
| Calibration | WP01 calibration receipt at the measured commit, same boot, within 12 h; path and SHA-256 TBD at registration; no waivers (official) |
| Accounting cross-check | Host-wide `/proc/stat` against arm cgroup CPU at every window boundary; out-of-cgroup work (including `systemd-coredump`) above 5 % of the arm's CPU invalidates the lifetime (threshold Proposed; WP02) |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | Platform limit change detected mid-run (stop; recheck R18; new campaign) |
| Kill criterion | Over the memory limit, or more than 3× native: the hosted lane consumes checked artifacts and never compiles [E3 §15] |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | Workers plan usage within paid-plan limits; native side minutes |
| Model | none |
| People | Operator time only |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Hosted: Cloudflare Workers with Dynamic Workers, plan and limits rechecked and dated at registration (R18 SRC-29 to SRC-35). Native comparison on the Main-rig as above.

## 12. Artifact identity

tsc-rs v0.7.0 lab builds (`LAB/adapters/checkers/tscrs-wasm/vendor/ts_rust.size.wasm`, `ts_rust.speed.wasm`; build info in `vendor/BUILD-INFO.txt`, commit `3644f32`), harness bundle, workload digests: TBD at freeze.

## 13. Failure meaning

A kill means the hosted lane runs pre-checked artifacts; it does not end the hosted lane. A fit does not establish multi-tenant security (isolates in one process are not a Spectre boundary [E3 §13]) or that the limits will stay where they are.

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

- Edition 3 keeps the hosted lane only pending this experiment (DEC-50).

## Open questions

- Does the size build's slower check (Upstream: the 5.2 MB build checks 13–18 % faster [R12 U05]) change the latency verdict? The speed build is a sensitivity run.

## Sources

- Edition 3 §13, §14, §15.
- R12 §3, U05, U06; R14 X6; R15 RISK-01, RISK-02, RISK-27; R16 DEC-50, DEC-59; R18 SRC-21 to SRC-42.
- `~/Work/isolate-factory-lab/harness/campaigns/secondary-p5-stress-memory.json`; `adapters/checkers/tscrs-wasm/memory-sensor.mjs`.
