# C04 — E3 X4: kernel route yield

> Reconstructed 2026-10-17. The original C04 was not available; this draft is rebuilt from
> Edition 3 (§5, §9, §15), R14 X4, R12 (F06), R15 (RISK-14, RISK-20, RISK-21) and R16 (DEC-46, DEC-47). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

This record drafts the precommit for Edition 3's fourth experiment: which route into the kernel contract yields the most accepted candidates per unit cost, and whether removing the interpreter layer is justified now [E3 §15].

## Summary

- The same 20 tasks generated in TypeScript (compatibility lane), AssemblyScript and Rust; MoonBit as an optional fourth arm if WP20 is ready (E3-02).
- Five generations per task per route (100 per route), paired by task, route order randomised; one generation per route cannot resolve a 20-point threshold (Derived, R14).
- One primary metric: first-pass yield per route against the X2-frozen evaluator. Kill: best in-isolate WASM route more than 20 points below TypeScript [E3 §15].
- Memory is measured as a per-candidate increment, not against the 150 MiB whole-unit peak (R12 F06; E3-14).

## Record header

| Field | Content |
|---|---|
| Record | C04 |
| Status | Draft — not registered |
| Stage | 3 |
| Work packages | WP19, WP21, WP22 (and WP20 for MoonBit, Stage 6+ / optional), WP18 (memory increment), WP16 (containment), WP23; C02 decided; C03a decided (Stage 2 exit: the runner refuses this precommit without a C03a receipt); decision points DP-1 and DP-2 recorded (`EXECUTION-PLAN.md` §7.1) |
| Risk or decision addressed | RISK-20 (kernel-route yield too low), RISK-21 (compatibility lane becomes default), RISK-14 (memory not reclaimed); DEC-46, DEC-47, DEC-30 |
| What cannot be known yet | Task set (drawn from X2's determinate tasks with frozen evaluators), model and version, token budget, whether MoonBit is ready. No yield for any route has been measured; Edition 3's yield column is Estimated [E3 §5] |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c04-x4-route-yield-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | E3 X4 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | Which route into the kernel contract has acceptable first-pass yield, and is the best in-isolate WebAssembly route within 20 points of TypeScript? It decides the default route |
| Hypothesis and predicted observable | Edition 3's estimate (Estimated, not a prediction of this campaign's result): TypeScript yield highest; AssemblyScript below TypeScript until measured; Rust high for pure functions with about half a repair round more [E3 §5]. Observable: first-pass pass/fail per generation against the frozen evaluator |
| Strongest rival | Models emit TypeScript constructs AssemblyScript lacks, so the in-isolate route loses more than 20 points and the kernel contract must wait [E3 §5, §15] |
| Claim-ladder rung | Supports rung 2 for the kernel contract [E3 §17]. Rung 1 only if DP-1 chose the in-Wasmtime alternative and a receipt shows the compiler running there; under the DP-1 default (compiler in a supervised V8 process beside the lane) this campaign does not move rung 1 and says so |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | First-pass yield per route = generations that pass the frozen evaluator without repair ÷ generations, per route; compared as (best in-isolate WASM route − TypeScript) in percentage points, paired by task |
| Decision rule | Kill if the point estimate of the difference is below −20 points. Report a cluster-bootstrap 95 % interval over tasks; if it straddles −20, label inconclusive and extend once to 10 generations per task per route before deciding |
| Secondary metrics | Tokens per accepted candidate; compile time; per-candidate memory as an increment over the host's idle working set; escape rate on a seeded subset (300 faults per route, diagnostic only); repair rounds to pass; containment admissibility per route |
| Multiplicity | Up to three WASM routes against TypeScript; "best route" chosen by point estimate; Holm correction across the WASM-versus-TypeScript comparisons for any per-route claim |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| T — TypeScript compatibility lane | tsc-rs WASM check (pinned module hash) + child V8 isolate in an owned process (WP22; host per DP-2, default workerd under bwrap in an owned cgroup) | tsc-rs module SHA-256 and lane code digest TBD at freeze | Warm compiler; fresh candidate | Owned process and cgroup | Arm cgroup |
| A — AssemblyScript | Compiler hosted per DP-1 (default: a supervised V8 process in its own sandbox and cgroup beside the Wasmtime lane; alternative: inside Wasmtime), release pinned (WP19); the compiled kernel executes in the Wasmtime workcell | Compiler host, compiler and workcell digests TBD at freeze | Warm compiler; fresh instance | Compiler in the DP-1 cohort; kernel as a Wasmtime instance in the workcell | Compiler cohort cgroup plus workcell cgroup, both charged to the arm |
| R — Rust | rustc and LLVM in the native lane (WP21); toolchain pinned | Toolchain and build-key digests TBD at freeze | Warm toolchain; fresh build | Native lane outside the isolate; module validated on entry | Native-lane cgroup, charged to the arm |
| M — MoonBit (optional) | Browser-hosted compiler inside the workcell (WP20), if ready before freeze | TBD at freeze | As A | As A | As A |

Control arm: T (the compatibility lane is the comparison the kill rule names). Null arm: A harness-only null measures the harness constant for compile-time and memory secondaries.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | One frozen residual per task from C02; shared by all routes; hash TBD at freeze |
| Acceptance boundary | WP09 gate order, then the task's invariants and residual; first pass means no repair turn; `outcome_unknown` is its own stage |
| Independent validator | Independent oracle per task (known-good implementation) confirms every pass; validator cost not charged to any arm |
| Parity rule | An arm pass that the validator rejects is a parity failure, never yield |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | 20 determinate tasks with frozen evaluators from C02, pure-function kernels suitable for all routes; task list SHA-256 TBD at freeze |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | none |
| Seeded faults | 300 seeded faults per route from WP11 (S1, S2), diagnostic only |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One generation (clustered by task) |
| Planned n | 5 generations × 20 tasks = 100 per route; 10 × 20 if the extension fires |
| Power calculation | At one generation per task per route the 95 % half-width on a yield difference near 50 % is about ±31 points; at five, about ±14 points before pairing gains (Derived, unpaired approximation, R14 X4) |
| Minimum samples | 5 generations per task per route |
| Randomisation | Route order randomised per task and generation; seed TBD at registration |

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
| Stop rules | Budget exhausted; containment failure outside predeclared expected failures (route inadmissible); model version change (stop; new campaign) |
| Kill criterion | Best in-isolate WebAssembly route more than 20 points below TypeScript: the compatibility lane stays default and the kernel contract waits [E3 §15] |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | TBD at freeze from the pilot; ceilings per attempt from the WP03 record |
| Model | Model, version, prompt template and token budget pinned per route (TBD at freeze); about 400 generations plus repairs |
| People | Author and reviewer time only |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Main-rig (local lane): Ryzen 9 7950X, 16 cores / 32 threads, about 125 GiB RAM, kernel `7.2.5-3-omarchy`, shared desktop (as recorded 8 Oct 2026 [R12 §2]). Microcode, governor, frequency policy, SMT state, cgroup controllers, and Node, Wasmtime and compiler versions with binary hashes: TBD at registration, from the WP01 snapshot and the WP03 record. Repository head TBD at registration; dirty tree refused (official).

## 12. Artifact identity

Each route's compiler or toolchain, the workcell, the WIT world (WP13), the task set, evaluators: digests TBD at freeze. tsc-rs build provenance from the lab: commit `3644f32`, size and speed builds (`LAB/adapters/checkers/tscrs-wasm/vendor/BUILD-INFO.txt`).

## 13. Failure meaning

A kill does not mean kernels are worse software; it means first-pass yield is too low now for the kernel contract to be the default. A pass does not make any route trustworthy (C03) or faster end to end (C07). Memory ratios against the 150 MiB figure are not reported because that figure is a whole-unit peak (R12 F06).

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

- Edition 3 §5 says the route comparison is "Experiment 1" and includes MoonBit; §15 makes it X4 without MoonBit (E3-02). This record follows §15 and adds MoonBit as optional.
- Footprint is measured as an increment, correcting E3-14.

## Open questions

- Which runtime hosts the AssemblyScript compiler on the Wasmtime lane (E3-10)? Decision point DP-1 with a default; WP19 records the choice before freeze. Probe P-02 may narrow the default (V8-hosted case only); it cannot show the Wasmtime alternative.
- Are 20 tasks representative of kernels people will request? X1's request pool should supply them.

## Sources

- Edition 3 §5, §9, §14, §15.
- R12 F06; R14 X4; R15 RISK-14, RISK-20, RISK-21; R16 DEC-30, DEC-46, DEC-47; errata E3-02, E3-10, E3-14.
- `~/Work/isolate-factory-lab/adapters/checkers/tscrs-wasm/vendor/BUILD-INFO.txt`.
