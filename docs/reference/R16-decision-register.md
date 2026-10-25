# R16 — Decision register

> Reconstructed 2026-10-17. The original R16 was not available; this version is rebuilt from
> Edition 3 (§1–§18), Edition 2 (opening passage, §1–§15, App. B), the white paper (pp. 1–25),
> the diagram atlas (sheets 01–30), the isolate-factory-lab records (`docs/` on main and its
> worktrees under `~/Work/isolate-factory-lab-wt/`) and the Field OS worker-fabric design council
> (`~/Work/field-ops-github-review/docs/research/2026-10-07-worker-fabric-design-council.md`).
> Content follows Edition 3 where the editions differ.

## Purpose

This register records the architectural and methodological decisions behind Endoforge in the order they were made, so that a reader can see which decisions still govern and which were reversed. Edition 3 governs; where it reverses an earlier decision, the earlier entry is marked **Superseded by DEC-nn** and the later entry says what it replaced. Decisions made in the isolate lab and the Field OS design council are recorded as historical entries, with their scope stated. Every decision here is **Proposed** architecture or method unless the entry says otherwise: a decision is not evidence that the decided design works.

## Summary

- The design moved in three steps: a TypeScript-centred in-isolate workshop (white paper and atlas, 14 Oct 2026), a language-agnostic production funnel (Edition 2, 16 Oct), and a pure WebAssembly kernel plus declarative glue with QuickJS removed (Edition 3, 17 Oct) [E2 opening passage; E3 §2].
- Edition 3 reverses six earlier positions: locality as the headline (DEC-36 → DEC-41), QuickJS as the inner boundary (DEC-04 → DEC-46), "trusted harness not generated" (DEC-05 → DEC-48), V8 as the local lane (DEC-12 → DEC-50), physical limits as a design driver (DEC-37 → DEC-51) and retained code as the compounding asset (DEC-34 → DEC-52).
- Edition 3 adds decisions with no predecessor: two separate products, specification as a subsystem, trust as a measured escape rate, autonomy tiers, and six experiments before the next architecture document (DEC-42 to DEC-45, DEC-54).
- Many decisions hold across all three documents unchanged: three lifetimes, outcome unknown as a state, a portable contract plus checkpoint, the warm-baseline rule, identity separation and break-even refinement.
- The lab's decisions (DEC-15 to DEC-27) are historical and lab-scoped. They govern the lab's G = 0 campaigns, not Endoforge's architecture.

## Index

| ID | Date | Decision (short) | Status |
|---|---|---|---|
| DEC-01 | 2026-10-07 | Field OS: generated jobs in separately terminable Node/guest execution; workerd for reviewed services | Superseded by DEC-46 (for Endoforge) |
| DEC-02 | 2026-10-07 | Field OS: split model and execution lifetimes; waiting releases compute | Active |
| DEC-03 | 2026-10-14 | TypeScript-centred workshop: tsc-rs WASM checker, TS → JS candidates | Superseded by DEC-28, then DEC-46 |
| DEC-04 | 2026-10-14 | Inner candidate boundary is a nested QuickJS/WASM guest | Superseded by DEC-46 |
| DEC-05 | 2026-10-14 | Trusted factory harness is "not generated" | Superseded by DEC-48 |
| DEC-06 | 2026-10-14 | Three lifetimes: durable, warm, attempt | Active |
| DEC-07 | 2026-10-14 | Outcome unknown is a state; recovery records ambiguity | Active |
| DEC-08 | 2026-10-14 | Portable unit is a contract plus checkpoint, not a live heap | Active |
| DEC-09 | 2026-10-14 | Unit of success: accepted useful capability per total resources | Active |
| DEC-10 | 2026-10-14 | Decisive test is a matched end-to-end campaign against a warm baseline | Active (extended by DEC-55) |
| DEC-11 | 2026-10-14 | A trusted native adapter is an explicit escape lane | Active |
| DEC-12 | 2026-10-14 | Local lane on V8 / Node / workerd plus WASM | Superseded by DEC-50 |
| DEC-13 | 2026-10-14 | Evaluation is a ladder: cheap deterministic rejection first | Active |
| DEC-14 | 2026-10-14 | Hard gates before a vector of objectives; no single score | Active |
| DEC-15 | 2026-10-14 | Lab: test the general concept; Field OS is method, not system under test | Active (lab scope) |
| DEC-16 | 2026-10-14 | Lab: G = 0 mechanical loop; deterministic seeded mutations | Active (lab scope) |
| DEC-17 | 2026-10-14 | Lab: one pre-registered primary metric with a ±10% equivalence margin | Active (lab scope) |
| DEC-18 | 2026-10-14 | Lab: TS7 native is the canonical oracle; independent validator outside arms | Active (lab scope) |
| DEC-19 | 2026-10-14 | Lab: arm C representative is tsc-rs WASM on a worker thread | Active (lab scope) |
| DEC-20 | 2026-10-14 | Lab: primary denominator is content-unique, verified, non-marginal accepts | Active (lab scope) |
| DEC-21 | 2026-10-14 | Lab: P10 "zero I/O" claim narrowed to what calibrated sensors detect | Active (lab scope) |
| DEC-22 | 2026-10-14 | Lab: arm D unbounded-allocation failure declared before any campaign | Active (lab scope) |
| DEC-23 | 2026-10-14 | Lab: an arm must execute its own artifact on holdouts; `outcome_unknown` is its own stage | Active (lab scope) |
| DEC-24 | 2026-10-14 | Lab: UI instruments are data; generated reducers run only in fresh QuickJS guests | Active (lab scope) |
| DEC-25 | 2026-10-14 | Lab: UI primary metric is p95 input → next paint | Superseded by DEC-26 |
| DEC-26 | 2026-10-14 | Lab: UI primary metric is main-thread interaction cost | Superseded by DEC-27 |
| DEC-27 | 2026-10-14 | Lab: UI primary metric is total interaction CPU, with a latency guard | Active (lab scope) |
| DEC-28 | 2026-10-16 | Language-agnostic broad funnel into a common WASM execution system | Superseded in part by DEC-46 |
| DEC-29 | 2026-10-16 | Rust is a refinement route, not the price of admission | Active |
| DEC-30 | 2026-10-16 | Route by total feedback cost | Active |
| DEC-31 | 2026-10-16 | External-build routes are a named compatibility lane | Active |
| DEC-32 | 2026-10-16 | Capability contract, artifact identity and qualification record are separate | Active |
| DEC-33 | 2026-10-16 | Promotion and refinement are distinct; a rewrite gets a new identity | Active |
| DEC-34 | 2026-10-16 | Retained software is the compounding asset | Superseded by DEC-52 |
| DEC-35 | 2026-10-16 | Three improvement loops measured separately; promotion against incumbent and fixed reference | Active |
| DEC-36 | 2026-10-16 | The in-isolate RAM-resident workcell is the production core | Superseded by DEC-41 |
| DEC-37 | 2026-10-16 | Reason upward from physical limits | Superseded by DEC-51 |
| DEC-38 | 2026-10-16 | Small Endoforge-native ledger; Mononoke is a source of mechanisms, not a dependency | Active |
| DEC-39 | 2026-10-16 | Separate history identities from computation identities | Active |
| DEC-40 | 2026-10-16 | Build the whole cycle narrowly, then deepen | Superseded in sequencing by DEC-54 |
| DEC-41 | 2026-10-17 | Thesis reordered: change-proportional work leads; locality is an enabler | Active |
| DEC-42 | 2026-10-17 | Two products, one substrate, separate evidence bars | Active |
| DEC-43 | 2026-10-17 | Specification is a subsystem; evaluator synthesized before any candidate | Active |
| DEC-44 | 2026-10-17 | Trust is a measured escape rate; autonomy tiers per domain | Active |
| DEC-45 | 2026-10-17 | Tiers are set against the searched escape rate, not the sampled one | Active |
| DEC-46 | 2026-10-17 | Candidate is a pure WASM kernel plus declarative glue; QuickJS leaves | Active |
| DEC-47 | 2026-10-17 | Route roles; WebAssembly text and Rust-first generation are not routes | Active |
| DEC-48 | 2026-10-17 | The model may author the trusted base under time, context and privilege boundaries | Active |
| DEC-49 | 2026-10-17 | POODO is proposer discipline and receipt schema, not an evaluator | Active |
| DEC-50 | 2026-10-17 | Wasmtime local lane leads; hosted lane kept pending X6 | Active |
| DEC-51 | 2026-10-17 | Physical limits reduced to two engineering consequences | Active |
| DEC-52 | 2026-10-17 | The library is inventory: contracts are the asset, code is the liability | Active |
| DEC-53 | 2026-10-17 | Six dependency risks are named and tracked | Active |
| DEC-54 | 2026-10-17 | Six experiments before the next architecture document | Active |
| DEC-55 | 2026-10-17 | Add a conventional-agent-in-warm-container arm | Active |
| DEC-56 | 2026-10-17 | Overlap evaluator synthesis with generation | Active |
| DEC-57 | 2026-10-17 | Candidate width bounded by evaluator discriminating power | Active |
| DEC-58 | 2026-10-17 | Cohorts of different trust get different processes; no fine-grained timers | Active |
| DEC-59 | 2026-10-17 | tsc-rs pinned by module hash and re-qualified; Microsoft native compiler is the parity oracle | Active |
| DEC-60 | 2026-10-17 | License is a provenance field from first admission | Active |
| DEC-61 | 2026-10-17 | Unqualified capabilities are retired, not kept | Active |
| DEC-62 | 2026-10-17 | A capability is explained by its contract and evidence | Active |
| DEC-63 | 2026-10-17 | Modest positioning: a trust-and-economics architecture | Active |
| DEC-64 | 2026-10-17 | Probes are evidence for narrowing, never for deciding X1–X6 | Active |
| DEC-65 | 2026-10-17 | Model-term measurement uses the subscription CLI only; no API arm | Active |
| DEC-66 | 2026-10-17 | X1 pool: 60 requests, frozen with seed 20261017; owner vouches rule 1 in chat | Active |
| DEC-67 | 2026-10-17 | LOW-confidence candidates and classification hints stay out of the X1 pool | Active |
| DEC-68 | 2026-10-17 | Private request text stays in git-ignored work/; receipts carry digests only | Active |
| DEC-69 | 2026-10-17 | Session hand-offs go through repository files, not session messages | Active |
| DEC-70 | 2026-10-17 | R19 frontier proposals are deferred to Edition 4 except as X1/X5 secondaries | Active |
| DEC-71 | 2026-10-17 | X1 runs as a dark-factory pilot: agents specify, build and qualify; a person only confirms | Active |
| DEC-72 | 2026-10-17 | Freeze the evaluator procedure, not its examples; properties-first for non-deterministic work | Active |
| DEC-73 | 2026-10-17 | The factory hill-climb: whole stack moves on a fast loop; a sealed oracle, canaries and a person decide adoption; interactions by design | Superseded in part by DEC-74 |
| DEC-74 | 2026-10-17 | No human step in the loop: a two-model sealed oracle panel replaces the human touchpoint; the claim ceiling is agent-corroborated use | Active |
| DEC-75 | 2026-10-17 | The spec is the incumbent, not the law: a mandatory deviation step every loop; the spec's own choices move on the fast loop; the claim ladder's evidence sources widened to production telemetry | Active |
| DEC-76 | 2026-10-18 | Loop 1 outcome: the all-new bundle with D-02 is not adopted (no evidence at n = 20, cost and wall guardrails breached); the incumbent stands; the ruler is at the floor and is loop 2's first work | Active |
| DEC-77 | 2026-10-18 | Oracle protocol v1.1: one model round per sealed rater (Codex without its tools), scoring verdicts derived from Q1-Q3; a slow-loop change made on a failed canary replay, without a council, open to the owner's veto | Active |
| DEC-78 | 2026-10-18 | All review is agentic: persona reviews, scoring, calibration and use checks are agent personas only; no human reviewer, audit or verdict anywhere; claim limits stated by the machine evidence available | Active |
| DEC-79 | 2026-10-18 | Evals, not judges: persona agents write executable evals in parallel with the generator, blind to its code; gates run them; no agent scores artefacts after the fact; eval quality by cross-family eval writers, consistency validation, canaries and mutation testing | Active |
| DEC-80 | 2026-10-18 | Eval design after P-08: writers see the request and bare signature only; interface evals (an input path for every decision-relevant fact) are mandatory, gated by decision stability; physical validity is a sourced deterministic library; frozen evals are challengeable only by outcome-independent evidence | Active |
| DEC-81 | 2026-10-18 | Endoforge stays domain-general: no domain data in it; value references for evals come from a reference provider the consuming project supplies (for refrigeration, its own CoolProp-generated tables) | Active |

## Field OS design council (historical, 7 Oct 2026)

These two entries come from the Field OS worker-fabric design council, which the white paper cites as its source of alternatives and rationale [W p.24, R2]. They governed Field OS, not Endoforge.

### DEC-01 — Generated jobs run in separately terminable guest execution

- **Date:** 2026-10-07.
- **Decision:** Arbitrary generated jobs start in separately terminable Node/guest execution. workerd remains attractive for reviewed dense services. The native/declarative baseline is preserved.
- **Rationale:** The runtime review changed the engine commitment; workerd, snapshots, compiler WASM, RAM boot and VM pooling each need their own discriminator rather than being bundled as one claimed revolution.
- **Alternatives rejected:** Running generated jobs as workerd services; dropping the native/declarative baseline (the strongest dissent argued the baseline may be cheaper, and the decision kept it).
- **Status:** Superseded by DEC-46 for Endoforge candidates. Still describes the recorded Field OS adapter [E3 §14].
- **Source:** `field-ops-github-review/docs/research/2026-10-07-worker-fabric-design-council.md`, "Council openings, rebuttal, and decision"; W p.24 [R2].

### DEC-02 — Split model and execution lifetimes

- **Date:** 2026-10-07.
- **Decision:** Journal waits and release idle execution compute (council item 15, "Adopt").
- **Rationale:** A waiting task should not hold an execution slot.
- **Alternatives rejected:** Not recorded beyond the council's option table.
- **Status:** Active. Restated as "waiting releases compute" [W p.6; A sheet 23; E2 §3; E3 §9].
- **Source:** design council option table, item 15.

## White paper and diagram atlas (14 Oct 2026)

### DEC-03 — TypeScript-centred in-isolate workshop

- **Date:** 2026-10-14.
- **Decision:** The workshop isolate holds virtual files, a TypeScript compiler compiled from Rust to WebAssembly (tsc-rs), a controlled evaluator, tests and instrumentation. Generated TypeScript is checked and emitted as JavaScript [W pp. 2, 4; A sheets 03, 05].
- **Rationale:** Load the machinery once; keep the build-and-test loop local so source does not cross a remote build service, compiler process, checkout and deployment pipeline for every revision [W p.2].
- **Alternatives rejected:** Environment-centric paths that reconnect a workspace per change [A sheet 02]. Treating the candidate as Rust because its compiler is Rust was explicitly ruled out as a misreading [W p.4].
- **Status:** Superseded by DEC-28 (Edition 2 broadened it into a language-agnostic funnel), then by DEC-46 (Edition 3 kernel plus glue). Edition 2 calls TypeScript "an initial route" [E2 opening passage].
- **Source:** W pp. 2, 4, 12–13; A sheets 03, 05.

### DEC-04 — Inner candidate boundary is a nested QuickJS/WASM guest

- **Date:** 2026-10-14.
- **Decision:** Generated JavaScript runs in a fresh QuickJS/WASM guest (or a proven inner sandbox) inside the factory isolate, never via eval in the trusted harness [A sheet 03; W p.14]. A child V8 isolate (Dynamic Worker) and native execution are distinct topologies, not interchangeable with it [A sheet 04].
- **Rationale:** Keep the inner loop local without giving candidate code access to the harness, the final oracle or host authority [A sheet 03]. Executing directly in a privileged realm is not an isolation boundary [W p.14].
- **Alternatives rejected:** Request-time eval in the harness realm [W p.14].
- **Status:** Superseded by DEC-46. Edition 3: "the QuickJS layer leaves the architecture"; the module boundary replaces the nested interpreter and three-level nesting collapses to two [E3 §2, §5].
- **Source:** W pp. 4, 14; A sheets 03–04.

### DEC-05 — The trusted factory harness is not generated

- **Date:** 2026-10-14.
- **Decision:** The trusted factory harness (loop policy, VFS imports, diagnostics, quotas, result serialization) is "Not generated" [A sheet 03].
- **Rationale:** Not stated in the atlas beyond the label. Edition 3 reads it as a proxy for three properties: time of authorship, context separation and privilege [E3 §8].
- **Alternatives rejected:** Not recorded.
- **Status:** Superseded by DEC-48.
- **Source:** A sheet 03. Edition 3 attributes the rule to Edition 2 [E3 §8]; the available Edition 2 text does not state it (see `docs/coverage/EDITION-3-ERRATA.md`). It may have been in the lost Edition 2 reference library.

### DEC-06 — Three lifetimes

- **Date:** 2026-10-14.
- **Decision:** Separate durable task state, evictable warm machinery and disposable per-attempt state; eviction raises latency but never erases the task or changes its truth [W p.6; A sheet 07].
- **Rationale:** High logical task counts without one resident environment per task [W p.6].
- **Alternatives rejected:** Keeping a live guest heap or a live promise as the task record [W p.6].
- **Status:** Active. Edition 2 restated it [E2 §8]; Edition 3 keeps it and changes only the attempt row (a module instance replaces a nested interpreter plus VFS) [E3 §9].
- **Source:** W p.6; A sheet 07; E2 §8; E3 §9.

### DEC-07 — Outcome unknown is a state

- **Date:** 2026-10-14.
- **Decision:** An attempt is potentially executed after authorization; recovery fences future work, verifies the exact owned closure and records ambiguity rather than inventing success [W p.19; A sheets 21–22].
- **Rationale:** A process name, PID or leftover file is not proof of owned execution or durable completion [A sheet 22].
- **Alternatives rejected:** Inferring success from leftover output; silent retry of an ambiguous external effect [A sheets 21–22].
- **Status:** Active [E3 §9]. Field OS recorded five named recovery boundaries behaving this way (**Recorded**, W3/W4 receipt) [E3 §14].
- **Source:** W p.19; A sheets 21–22; E3 §9.

### DEC-08 — Portable unit is a contract plus checkpoint

- **Date:** 2026-10-14.
- **Decision:** The portable unit is a capsule plus a capability contract (later: a capability contract plus a checkpoint). Browser, local, site and cloud hosts implement it differently; live heaps, credentials, native objects and GPU allocations are not assumed to move [W pp. 5, 21; A sheet 16].
- **Rationale:** Portability is an adapter contract, not a promise that hosts are identical [A sheet 16].
- **Alternatives rejected:** Migratable live heaps [W p.21].
- **Status:** Active [E2 §13; E3 §13].
- **Source:** W pp. 5, 21; A sheet 16; E2 §13; E3 §13.

### DEC-09 — Unit of success

- **Date:** 2026-10-14.
- **Decision:** Measure time and total resources per accepted useful capability, not checks per second, isolates created or the fastest successful candidate [W p.11; A sheet 15].
- **Rationale:** Speedups of one stage do not multiply into whole-loop speedups [W p.11].
- **Alternatives rejected:** Tokens, isolate counts or single fast type checks as objectives [A sheet 15].
- **Status:** Active. Edition 2: north-star unit [E2 §1]. Edition 3: "an independently accepted useful capability per unit of total cost" [E3 §1].
- **Source:** W p.11; A sheet 15; E2 §1; E3 §1.

### DEC-10 — Decisive test is a matched end-to-end campaign against a warm baseline

- **Date:** 2026-10-14.
- **Decision:** The decisive experiment is a matched end-to-end campaign with arms A (warm native/declarative baseline), B (current Node/QuickJS adapter), C (strict in-isolate WASM compiler plus evaluator), D (compiler Worker plus Dynamic Worker) and E (native/container fallback). Already-warm native pools are a required baseline, not a cold-VM straw man [W p.22; A sheets 02, 28].
- **Rationale:** Isolated benchmarks cannot establish the full claim [W p.22].
- **Alternatives rejected:** Comparing against a fictional cold operating system per candidate [E2 §15].
- **Status:** Active; extended by DEC-55 [E3 §15].
- **Source:** W p.22; A sheets 02, 28; E2 §15; E3 §15.

### DEC-11 — Trusted native adapter as an explicit escape lane

- **Date:** 2026-10-14.
- **Decision:** A trusted native adapter remains for browser automation, native packages, full POSIX behaviour, GPU work, or libraries that cannot fit the chosen ABI. It is an explicit escape to a different execution class [W p.5].
- **Rationale:** Not every existing package or application will run unchanged inside an isolate [W p.5].
- **Alternatives rejected:** Asserting universal in-isolate compatibility [W p.5].
- **Status:** Active. Edition 3 keeps a native Rust lane beside the Wasmtime lane and a named compatibility lane [E3 §5, §13].
- **Source:** W p.5; A sheet 04 (option C).

### DEC-12 — Local lane on V8 / Node / workerd plus WASM

- **Date:** 2026-10-14.
- **Decision:** The local/self-hosted lane is a supervised runtime on V8 / Node / workerd plus WASM, with OS sandbox, cgroups and watchdog [A sheet 16].
- **Rationale:** The TypeScript checker and generated JavaScript both run on V8 [W p.4].
- **Alternatives rejected:** Not recorded.
- **Status:** Superseded by DEC-50.
- **Source:** A sheet 16; W p.4.

### DEC-13 — Evaluation is a ladder

- **Date:** 2026-10-14.
- **Decision:** Cheap deterministic rejection first (contract and syntax, type and interface), then deterministic tests, interaction and integration, held-out acceptance, and a cost and regression gate [A sheet 11; W p.10].
- **Rationale:** Spend expensive evaluation only on survivors [A sheet 11].
- **Alternatives rejected:** A single score [A sheet 11].
- **Status:** Active [E2 §3; E3 §11].
- **Source:** A sheet 11; W p.10.

### DEC-14 — Hard gates before a vector of objectives

- **Date:** 2026-10-14.
- **Decision:** Validity first; among eligible candidates compare a vector of outcomes rather than hiding trade-offs in one score; Pareto frontier for deployment profiles [W p.10; E2 §6].
- **Rationale:** A faster implementation that doubles memory may suit a workstation and not an appliance [W p.10].
- **Alternatives rejected:** Weighting correctness against speed [W p.10].
- **Status:** Active [E3 §11].
- **Source:** W p.10; E2 §6; E3 §11.

## Isolate-factory lab (historical, 14 Oct 2026)

These decisions governed the lab at `~/Work/isolate-factory-lab`. They are lab-scoped. The lab's conclusions cover only the mechanical inner loop at G = 0 (`docs/PREDICTIONS.md`, "Scope label"). The lab's design cites the section numbers of *The In-Isolate Software Factory* report (R18 SRC-05), not the 25-page white paper.

### DEC-15 — Test the general concept; Field OS is the method, not the system under test

- **Date:** 2026-10-14.
- **Decision:** The lab tests the general in-isolate factory concept. Field OS (commit `58d6826`) is the prior measurement method reused, not the system under test. Arms A–E compare a native control, a warm native checker workshop, an in-isolate checker with a QuickJS guest, child V8 isolates and fresh bwrap processes; bwrap replaces containers because Docker is unavailable to the user.
- **Rationale:** Report the whole loop, not supporting microbenchmarks.
- **Alternatives rejected:** Docker-based sandboxing (unavailable).
- **Status:** Active (lab scope).
- **Source:** `isolate-factory-lab/docs/LAB-DESIGN.md`.

### DEC-16 — G = 0 mechanical loop

- **Date:** 2026-10-14.
- **Decision:** Candidates come from deterministic seeded mutations with no LLM, so the inner mechanical loop is measured with zero model calls. Model cost is reported only as a **Derived** sensitivity until a separate precommitted G > 0 campaign.
- **Rationale:** Isolate the substrate from model luck.
- **Alternatives rejected:** Mixing model calls into the first campaigns.
- **Status:** Active (lab scope). Edition 3 makes the model term its own experiment [E3 §15 X5].
- **Source:** `LAB-DESIGN.md`; `PREDICTIONS.md`; `END-STATE-AND-TEST-PLAN.md` (E8).

### DEC-17 — One pre-registered primary metric

- **Date:** 2026-10-14 (PREDICTIONS v1).
- **Decision:** Primary metric: CPU-seconds per unique, holdout-verified accepted candidate, in the stateless regime, on a fixed open-loop candidate stream, at one pinned physical core per arm, with a block-bootstrap 95% CI and a ±10% equivalence margin. Pinned cores, no `cpu.max` quota on timed runs; arms never run concurrently; a symmetric retraction rule.
- **Rationale:** Adopted after an independent methodology critique found that the mutation stream, unequal warm state, unmatched work, undefined parity, unequal accounting and an asymmetric retraction rule could each decide the headline.
- **Alternatives rejected:** PREDICTIONS v0 (commit `939c891`): per-arm adaptive streams, a cold-E comparison the critique called a straw man, an asymmetric retraction rule.
- **Status:** Active (lab scope).
- **Source:** `PREDICTIONS.md`; `docs/CRITIQUE-2026-10-14.md`.

### DEC-18 — TS7 native is the canonical oracle

- **Date:** 2026-10-14.
- **Decision:** Parity is the set of (file, line, col, code, category) matching the TS7 native oracle. TS6 is a separate parity class and may represent arm C only at full TS7 parity. An independent final validator (TS7 native plus node under bwrap) sits outside every arm and is not charged to any arm.
- **Rationale:** An arm that fails the oracle has no admissible timing.
- **Alternatives rejected:** Treating TS6 output as equivalent.
- **Status:** Active (lab scope). Consistent with DEC-59.
- **Source:** `PREDICTIONS.md`; `docs/CHECKERS.md`.

### DEC-19 — Arm C representative is tsc-rs WASM on a worker thread

- **Date:** 2026-10-14 (PREDICTIONS v1.2).
- **Decision:** Arm C's checker is `tscrs-wasm`, speed build, on a dedicated worker thread with a 256 MB stack. Native comparators come from the same commit (`3644f32`).
- **Rationale:** On the caller thread tsc-rs WASM overflowed the default V8 stack on the lab's DoS inputs; on the worker thread it handled them.
- **Alternatives rejected:** The caller-thread variant (reported only as exploratory, because it fails stack-DoS containment).
- **Status:** Active (lab scope).
- **Source:** `PREDICTIONS.md` v1.2.

### DEC-20 — Content-unique primary denominator

- **Date:** 2026-10-14 (PREDICTIONS v1.3; operationalised in v1.6).
- **Decision:** The denominator is the content-unique, holdout-verified, non-marginal accepts on which arm and validator agree; behaviour-unique counts are secondary.
- **Rationale:** Behaviour-unique dedupe collapsed S-small to 3 items, which makes the CI uninformative; identical streams keep the ratio between arms unbiased. The pre-campaign critique (M1) found the code still counted behaviour-unique accepts.
- **Alternatives rejected:** Behaviour-unique counting as primary.
- **Status:** Active (lab scope).
- **Source:** `PREDICTIONS.md` v1.3; `CRITIQUE-2026-10-14-precampaign.md` M1; `isolate-factory-lab-wt/precampaign-fix/docs/PREDICTIONS.md` v1.6.

### DEC-21 — P10 narrowed to what calibrated sensors detect

- **Date:** 2026-10-14 (PREDICTIONS v1.1, v1.4).
- **Decision:** "Zero filesystem I/O" is claimed only as no storage bytes, no unexplained character I/O, and no file descriptor opened and held across the warm window. It is not claimed as "no filesystem syscalls".
- **Rationale:** cgroup `io.stat` is not delegated to user units; strace and bpftrace need root; calibration C4 showed the sensors cannot see open-close without data, `stat` calls or mmap reads.
- **Alternatives rejected:** The broader claim.
- **Status:** Active (lab scope).
- **Source:** `PREDICTIONS.md` v1.1, v1.4.

### DEC-22 — Arm D unbounded-allocation failure declared

- **Date:** 2026-10-14 (PREDICTIONS v1.5).
- **Decision:** An unbounded allocation loop not stopped in-process by isolated-vm or worker_threads on Node 26.8.1 is a predeclared expected failure for arm D, recorded as a result, not a pass.
- **Rationale:** Executors QA-01 observed it; the hosting process is killed by its cgroup, so the blast radius is the whole arm.
- **Alternatives rejected:** Declaring it after a campaign.
- **Status:** Active (lab scope).
- **Source:** `PREDICTIONS.md` v1.5; `docs/EXECUTORS.md`.

### DEC-23 — Arms verify their own artifacts; `outcome_unknown` is its own stage

- **Date:** 2026-10-14 (PREDICTIONS v1.6, branch `precampaign-fix`).
- **Decision:** A sample is verified only if the arm executes its own emitted artifact on every holdout fixture, charged to the arm. `outcome_unknown` is a separate stage and an admissibility flag, never a pass or fail. Only fixes that change or unblock the primary answer go into v1.6; the rest are deferred to a backlog by coordinator decision.
- **Rationale:** The pre-campaign critique (M2, M3) found holdouts verified on the validator's emit and unknown outcomes scored as correct rejects.
- **Alternatives rejected:** Requiring emitted-digest equality instead (offered by the critique as an alternative fix).
- **Status:** Active (lab scope).
- **Source:** `isolate-factory-lab-wt/precampaign-fix/docs/PREDICTIONS.md` v1.6; `docs/BACKLOG.md`.

### DEC-24 — UI instruments are data; reducers run in fresh guests

- **Date:** 2026-10-14.
- **Decision:** An instrument definition is data (component tree, bindings, reducers, layout parameters), never arbitrary DOM code. Generated reducers run only in fresh QuickJS guests (worker guest by default). Mutation targets must first exist as reviewed extensions of the trusted component library.
- **Rationale:** Keep generated presentation out of the renderer; keep library extensions reviewed like any other code.
- **Alternatives rejected:** Generated DOM code; unreviewed library extensions.
- **Status:** Active (lab scope). It prefigures Edition 3's glue-as-data (DEC-46).
- **Source:** `docs/UI-HILLCLIMB.md` (precommit and v2 amendment); commit `631862d`.

### DEC-25 — UI primary metric: p95 input → next paint

- **Date:** 2026-10-14 (UI-HILLCLIMB v1).
- **Decision:** Holdout p95 interaction latency (input → next paint), elite/seed ratio, block bootstrap.
- **Status:** Superseded by DEC-26.
- **Source:** `docs/UI-HILLCLIMB.md` v1.

### DEC-26 — UI primary metric: main-thread interaction cost

- **Date:** 2026-10-14 (UI-HILLCLIMB v2).
- **Decision:** Holdout p95 interaction cost: main-thread busy time from input dispatch to end of render work, from Chromium tracing.
- **Rationale:** Host-measured input → next frame is quantised to the 60 Hz frame (about 15–17 ms) and cannot resolve sub-frame improvements (a pre-run sensor finding).
- **Status:** Superseded by DEC-27.
- **Source:** `docs/UI-HILLCLIMB.md` v2.

### DEC-27 — UI primary metric: total interaction CPU with a latency guard

- **Date:** 2026-10-14 (UI-HILLCLIMB v3).
- **Decision:** Holdout p95 total interaction CPU (main thread plus worker thread). Latency guard as a hard gate: no elite may raise p95 input → frame span by more than one frame (16.7 ms). Reducer placement (worker guest or main-thread QuickJS guest) is a declared variant, measured, not searched.
- **Rationale:** The renderer lane measured that worker reducers added little main-thread time but much more input → frame latency, so a main-thread metric would reward hiding work off the main thread.
- **Alternatives rejected:** DEC-26's main-thread-only metric.
- **Status:** Active (lab scope).
- **Source:** `docs/UI-HILLCLIMB.md` v3.

## Edition 2 (16 Oct 2026)

### DEC-28 — Language-agnostic broad funnel

- **Date:** 2026-10-16.
- **Decision:** Generate or ingest code in whatever supported form suits the task (AssemblyScript, JavaScript via Javy, Python via component packaging, Rust, pre-built WASM), get it into a common WASM execution system quickly, evaluate many candidates, and refine selectively [E2 §4].
- **Rationale:** The conversation deliberately broadened the TypeScript-centred workshop into a language-agnostic funnel and a runtime manufacturing system [E2 "How this document is grounded"].
- **Alternatives rejected:** A universal TypeScript-to-WASM compiler as a prerequisite [E2 §4].
- **Status:** Superseded in part by DEC-46. Broad intake survives ("the broad intake funnel admits existing scripts, libraries, and model output" [E3 §13 item 6]); the candidate shape is now fixed as kernel plus glue. Edition 3 does not list Python or Javy routes and does not say they were dropped (see errata).
- **Source:** E2 §4.

### DEC-29 — Rust is a refinement route, not the price of admission

- **Date:** 2026-10-16.
- **Decision:** Rust is an optional refinement route [E2 §4]. Keepers may earn a careful Rust rewrite [E2 opening passage].
- **Rationale:** Broad intake lets useful ideas enter cheaply; controlled refinement lets them mature [E2 §9].
- **Alternatives rejected:** Rust-first admission.
- **Status:** Active. Edition 3 reaffirms: Rust-first is "a refinement profile, not an admission profile" [E3 §5].
- **Source:** E2 §4, §9; E3 §5.

### DEC-30 — Route by total feedback cost

- **Date:** 2026-10-16.
- **Decision:** Choose the route that obtains trustworthy feedback most economically for the task, counting preparation, checking, loading, boundary transfers, execution, evaluation and expected uses [E2 §4].
- **Rationale:** Compilation time alone is insufficient [E2 §4].
- **Alternatives rejected:** Compile time as the routing criterion.
- **Status:** Active. Edition 3 assigns route roles pending X4 (DEC-47).
- **Source:** E2 §4.

### DEC-31 — External-build routes are a named compatibility lane

- **Date:** 2026-10-16.
- **Decision:** A route that still needs an external build per candidate is an explicit compatibility lane or an open integration task, not counted as satisfying the all-local objective [E2 §4].
- **Rationale:** Producing WASM externally does not establish that the compiler runs inside the workcell [E2 §4].
- **Alternatives rejected:** Disguising an external build as local [E2 §15].
- **Status:** Active. Edition 3: "named as a lane rather than disguised as the strict path" [E3 §5].
- **Source:** E2 §4, §15; E3 §5.

### DEC-32 — Capability contract, artifact identity and qualification record are separate

- **Date:** 2026-10-16.
- **Decision:** A capability contract describes what an operation means; an artifact identity names exact bytes; a qualification record states which behaviour and environment were tested. These must not collapse into one record [E2 §9].
- **Rationale:** One capability can have several implementations with their own evidence and resource profiles [E2 §9].
- **Alternatives rejected:** A single record per capability.
- **Status:** Active [E3 §12].
- **Source:** E2 §9; W p.20; E3 §12.

### DEC-33 — Promotion and refinement are distinct

- **Date:** 2026-10-16.
- **Decision:** A capability can be accepted in its initial implementation while a better one is built. A rewrite gets a new artifact identity, comparison against the contract, new qualification and controlled activation [E2 §4].
- **Rationale:** A rewrite does not inherit correctness by resembling the previous source; the first implementation is evidence but not the sole oracle [E2 §4].
- **Alternatives rejected:** Faithful translation of the original as the correctness standard.
- **Status:** Active [E3 §12].
- **Source:** E2 §4.

### DEC-34 — Retained software is the compounding asset

- **Date:** 2026-10-16.
- **Decision:** The long-term library of versioned capabilities is more important than the number of disposable candidates; it is explicit procedural memory outside the model's weights [E2 §9].
- **Rationale:** A successful task can make the next cheaper without changing the model [E2 §9].
- **Status:** Superseded by DEC-52. Edition 3: the compounding asset is contracts, invariants, tests and counterexamples; code is the liability [E3 §12].
- **Source:** E2 §9; A sheet 29.

### DEC-35 — Three improvement loops, measured separately

- **Date:** 2026-10-16.
- **Decision:** Product, process (discovery) and machinery loops are measured separately before gains are combined. A default promotion rule improves a declared objective within predeclared tolerances on protected metrics, compared against both the incumbent and a fixed reference [E2 §6].
- **Rationale:** A chain of small tolerated regressions must not accumulate unnoticed [E2 §6].
- **Alternatives rejected:** Comparison against the incumbent alone.
- **Status:** Active [E3 §11].
- **Source:** E2 §6; E3 §11.

### DEC-36 — The in-isolate RAM-resident workcell is the production core

- **Date:** 2026-10-16.
- **Decision:** The repeated loop stays inside a RAM-resident workshop isolate; local structure is "the center of the design, not a minor optimization" [E2 §2]; the workcell is the production core [E2 §15].
- **Rationale:** Prepared tooling should not be rebuilt or transported for each small change [E2 §2].
- **Status:** Superseded by DEC-41.
- **Source:** E2 opening passage, §2, §15.

### DEC-37 — Reason upward from physical limits

- **Date:** 2026-10-16.
- **Decision:** Use a lower-envelope model, distance, movement, thermodynamic and search limits to separate fundamental limits from conventions [E2 §11].
- **Rationale:** Physics does not require a checkout, a fresh compiler process or a model turn for every deterministic operation [E2 §11].
- **Status:** Superseded by DEC-51.
- **Source:** E2 §11.

### DEC-38 — Small Endoforge-native ledger; Mononoke as a source of mechanisms

- **Date:** 2026-10-16.
- **Decision:** Build a small Endoforge-native ledger. Take mechanisms from Mononoke (Bonsai-style records, derivation on demand, ephemeral bubbles, sharded maps, conditional publication) without embedding the Mononoke server or its dependency closure in WASM [E2 §10].
- **Rationale:** The ledger supports production; Endoforge is not a Git replacement [E2 §10]. The source study inspected nineteen files at `79071c2a…`, with no build or tests [E2 §10; E3 §18].
- **Alternatives rejected:** Embedding Mononoke; a full Git replacement as an early milestone [E2 §15].
- **Status:** Active. Edition 2 lists "Mononoke is a source of ledger mechanisms" among things that are not the definition of Endoforge [E2 opening passage].
- **Source:** E2 §10, §15; E3 §18.

### DEC-39 — Separate history identities from computation identities

- **Date:** 2026-10-16.
- **Decision:** Keep candidate/provenance identity, resolved source identity, build key, artifact identity, evaluation attempt and activation record distinct [E2 §10].
- **Rationale:** Two proposals can share a build without becoming one historical event; a hash names bytes and grants no permission [E2 §10].
- **Status:** Active [E3 §16].
- **Source:** E2 §10.

### DEC-40 — Build the whole cycle narrowly, then deepen

- **Date:** 2026-10-16.
- **Decision:** First milestones establish one complete narrow workcell, one useful generated interface, contrasting routes and one controlled campaign; not a universal compiler, Git replacement or exotic hardware [E2 §15].
- **Rationale:** Those directions matter only where they address a measured constraint [E2 §15].
- **Status:** Superseded in sequencing by DEC-54. The "narrow, whole cycle" principle still holds.
- **Source:** E2 §15.

## Edition 3 (17 Oct 2026)

### DEC-41 — Thesis reordered; locality is an enabler

- **Date:** 2026-10-17.
- **Decision:** Change-proportional work leads the thesis; cheap proposals come second; the RAM-resident workcell is an enabler, "not the idea itself" [E3 §1, §2].
- **Rationale:** As models improve, in-isolate locality as a headline is roughly neutral because its term in the budget is already small [E3 §12 table]; four fifths of novel-request time is model inference (**Estimated**) [E3 §10].
- **Alternatives rejected:** DEC-36.
- **Status:** Active. Supersedes DEC-36.
- **Source:** E3 §1, §2, §10, §12.

### DEC-42 — Two products, one substrate

- **Date:** 2026-10-17.
- **Decision:** The agent substrate and generative applications share an architecture but not an evidence bar; the plausibility of the first no longer carries the second [E3 §2, §3].
- **Rationale:** Opposite economics: modest versus maximal trust; inference versus specification and review as dominant cost [E3 §3].
- **Alternatives rejected:** Edition 2's single system with applications as "expressions of the same substrate" [E2 §13].
- **Status:** Active.
- **Source:** E3 §3.

### DEC-43 — Specification is a subsystem

- **Date:** 2026-10-17.
- **Decision:** Every task gets an evaluator synthesized before any candidate exists, composed mostly from reusable invariants, qualified against fixed meta-gates and confirmed by a person for its novel part. Acceptance has three layers (universal gates, domain invariants, task residual) and the residual obeys four rules (before and blind, frozen, qualified, confirmed) [E3 §1, §6].
- **Rationale:** For a novel request no fixed evaluator exists; the risk is correlated error between test and candidate [E3 §6].
- **Alternatives rejected:** Model-as-judge; revising the test after a failure ("forbidden here") [E3 §6].
- **Status:** Active. New in Edition 3.
- **Source:** E3 §1, §4, §6.

### DEC-44 — Trust is a measured escape rate

- **Date:** 2026-10-17.
- **Decision:** The unit of trust is the harness, never the model. Trust is the measured rate at which seeded faults escape it. Autonomy tiers (Confirmed, Supervised, Autonomous) are set per domain from that rate [E3 §7].
- **Rationale:** Granting trust to model output does not change its error rate; it removes whatever would have caught the error [E3 §7].
- **Alternatives rejected:** Forecasts about future models as the basis for autonomy [E3 §7].
- **Status:** Active. The thresholds lack stated sample sizes (see errata; R15 RISK-10).
- **Source:** E3 §1, §7.

### DEC-45 — Tiers use the searched escape rate

- **Date:** 2026-10-17.
- **Decision:** Autonomy tiers are set against the escape rate measured under search, not under random sampling [E3 §11].
- **Rationale:** Under search pressure, rare evaluator mistakes become the best-scoring path [E3 §7, §11].
- **Alternatives rejected:** Sampled escape rate.
- **Status:** Active.
- **Source:** E3 §7, §11, §15 X3.

### DEC-46 — Pure WASM kernel plus declarative glue

- **Date:** 2026-10-17.
- **Decision:** Every candidate is a WebAssembly module exporting pure functions with declared imports as its only capabilities, plus glue as data (view spec, data and action bindings, interaction tests, result schema) validated by closed schemas and rendered by the host. The QuickJS layer leaves the architecture; nesting collapses from three levels to two [E3 §1, §2, §5].
- **Rationale:** Module isolation without ambient authority; sub-millisecond instantiation; kilobytes to low megabytes per candidate (**Estimated**) against tens of megabytes for the guest; pure reducers are the easiest software to test and mutation-test [E3 §5].
- **Alternatives rejected:** Generated JavaScript in a nested interpreter (DEC-04); a universal TypeScript-to-WASM compiler [E3 §5].
- **Status:** Active. Supersedes DEC-04 and, for candidate shape, DEC-03 and DEC-28. The compatibility lane still executes generated JavaScript in a child V8 isolate (see errata).
- **Source:** E3 §1, §2, §5, §9.

### DEC-47 — Route roles; WebAssembly text and Rust-first are not routes

- **Date:** 2026-10-17.
- **Decision:** AssemblyScript is the candidate default for kernels and MoonBit a second in-isolate route, both pending measurement; Rust is keeper refinement in a native lane; TypeScript → JavaScript via tsc-rs is the compatibility lane; pre-built WASM enters after admission and qualification [E3 §5 table].
- **Rationale:** Models have almost no training signal for WebAssembly text, which is also unreviewable at length; the Rust toolchain cannot live in the isolate and per-attempt cost is roughly a wash against TypeScript [E3 §5].
- **Alternatives rejected:** Writing WebAssembly text directly; Rust-first generation [E3 §5].
- **Status:** Active, pending E3 X4.
- **Source:** E3 §5, §15.

### DEC-48 — The model may author the trusted base

- **Date:** 2026-10-17.
- **Decision:** The model writes all code, including the harness, evaluators and invariants, never from a position where it grades its own work. The trust boundary is time of authorship, context separation and privilege, not human versus model [E3 §1, §7, §8].
- **Rationale:** A human-written harness is not trustworthy because a human wrote it; "not generated" was a proxy for the three properties. tsc-rs is the example: model-written, validated against an oracle from outside its authoring turn, pinned, and without authority [E3 §8].
- **Alternatives rejected:** DEC-05.
- **Status:** Active. Supersedes DEC-05.
- **Source:** E3 §2, §7, §8.

### DEC-49 — POODO's role

- **Date:** 2026-10-17.
- **Decision:** POODO is the proposer's discipline (framing, stated versus inferred, rival framing, stop or ask) and its precommit record is the evaluation receipt schema. It is not an evaluator, and runs at campaign boundaries, never per candidate [E3 §8].
- **Rationale:** Its own repository says a passing checker does not demonstrate sound reasoning and that its scope excludes routine execution; per-candidate use would wreck the loop's economics [E3 §7, §8].
- **Alternatives rejected:** POODO's capsule checker counted as a check [E3 §7].
- **Status:** Active.
- **Source:** E3 §7, §8, §10, §18.

### DEC-50 — Wasmtime local lane leads

- **Date:** 2026-10-17.
- **Decision:** The local and site lane leads, Wasmtime-based under OS sandboxing, cgroups and an external watchdog, with a native Rust lane beside it. The hosted Cloudflare lane is kept because it removes a deployment step, and X6 decides whether it compiles or only runs pre-checked artifacts [E3 §13].
- **Rationale:** The kernel contract and the Component Model are native in Wasmtime and polyfilled in V8; the V8 route exists mainly to serve the hosted lane [E3 §5, §13].
- **Alternatives rejected:** DEC-12.
- **Status:** Active. Supersedes DEC-12.
- **Source:** E3 §5, §13, §15.

### DEC-51 — Physical limits reduced to two consequences

- **Date:** 2026-10-17.
- **Decision:** Keep only two engineering consequences: movement can dominate computation, and no computation supplies a missing observation. Everything else is background [E3 §2, §13].
- **Rationale:** Edition 3 does not claim the physical-limits discussion predicts anything about the system's performance [E3 §17].
- **Alternatives rejected:** DEC-37.
- **Status:** Active. Supersedes DEC-37.
- **Source:** E3 §2, §13, §17.

### DEC-52 — The library is inventory

- **Date:** 2026-10-17.
- **Decision:** Contracts, invariants, tests and counterexamples are the compounding asset; code is the liability. Implementations are separate artifacts under a contract; qualification records do not transfer; lineage follows the data; useful failures are kept [E3 §12].
- **Rationale:** Inventory costs money to hold; retained code loses value as regeneration gets cheaper; contracts carry no customer data and can be shared across tenants [E3 §12].
- **Alternatives rejected:** DEC-34.
- **Status:** Active. Supersedes DEC-34.
- **Source:** E3 §4, §12.

### DEC-53 — Six dependency risks are named

- **Date:** 2026-10-17.
- **Decision:** Track tsc-rs age and provenance, the 128 MB Workers ceiling, shared-process side channels, retained capabilities as injection vectors, SDK and host churn, and license and provenance [E3 §13].
- **Rationale:** "So they can be tracked rather than discovered" [E3 §13].
- **Status:** Active. See R15 RISK-01 to RISK-06.
- **Source:** E3 §13.

### DEC-54 — Six experiments before the next architecture document

- **Date:** 2026-10-17.
- **Decision:** Run X1–X6 in order (specification study, evaluator error rate, escape rate, kernel route yield, model term, hosted fit), each with a kill criterion written before the result. Order is evaluation plane, then substrate, then library, close to the reverse of Edition 2's emphasis [E3 §12, §15].
- **Rationale:** Each produces one number that decides something; a failed gate narrows the product rather than the standard [E3 §15].
- **Alternatives rejected:** Another architecture document [E3 §15].
- **Status:** Active. Supersedes the sequencing of DEC-40.
- **Source:** E3 §12, §15.

### DEC-55 — Conventional-agent arm

- **Date:** 2026-10-17.
- **Decision:** After X1–X6, run the matched end-to-end campaign with arms for a warm native baseline, the kernel workcell and a child-isolate topology, plus a conventional agent in a warm container measured end to end including time to specify [E3 §15].
- **Rationale:** The product proposition is confirmed only against that arm, not against a cold VM [E3 §15].
- **Status:** Active. Extends DEC-10.
- **Source:** E3 §15.

### DEC-56 — Overlap evaluator synthesis with generation

- **Date:** 2026-10-17.
- **Decision:** Blind contexts run concurrently; the evaluator's hash is frozen before evaluation, not before generation [E3 §10].
- **Rationale:** Removes a full model turn from the critical path [E3 §10].
- **Status:** Active.
- **Source:** E3 §6, §10.

### DEC-57 — Candidate width is bounded by discriminating power

- **Date:** 2026-10-17.
- **Decision:** Candidate width is bounded by the evaluator's measured discriminating power before memory. If X3's searched escape rate exceeds 1 in 1,000, width stays at one until a new non-model check lands [E3 §11, §15].
- **Rationale:** Parallel samples multiply the evaluator's leaks [E3 §11]. Independence requires different framings, not different seeds [E3 §10].
- **Status:** Active.
- **Source:** E3 §10, §11, §15.

### DEC-58 — Trust-partitioned processes; no fine-grained timers

- **Date:** 2026-10-17.
- **Decision:** Cohorts of different trust get different processes; candidate code never receives fine-grained timers [E3 §13].
- **Rationale:** Isolates in one process are not a Spectre boundary; hosted mitigations do not ship with bare workerd [E3 §13].
- **Status:** Active.
- **Source:** E3 §9, §13; W p.15; A sheet 18.

### DEC-59 — tsc-rs pinning and parity oracle

- **Date:** 2026-10-17.
- **Decision:** Microsoft's native compiler is the parity oracle; tsc-rs is pinned by module hash and re-qualified on every bump; the kernel path does not depend on it [E3 §13].
- **Rationale:** TypeScript has no specification, so parity is a tested property [E3 §13].
- **Status:** Active. Consistent with the lab's DEC-18.
- **Source:** E3 §13.

### DEC-60 — License is a provenance field

- **Date:** 2026-10-17.
- **Decision:** License is recorded from the first admission, not audited later [E3 §13].
- **Status:** Active.
- **Source:** E3 §13.

### DEC-61 — Unqualified capabilities are retired

- **Date:** 2026-10-17.
- **Decision:** Contracts are versioned; migrations are explicit; a capability with no passing qualification against the current host is retired, not quietly kept [E3 §13].
- **Status:** Active.
- **Source:** E3 §12, §13.

### DEC-62 — Legibility through contract and evidence

- **Date:** 2026-10-17.
- **Decision:** A capability is explained by its contract and evidence, shown in the plain language the person confirmed before the campaign [E3 §12].
- **Rationale:** Trust in software comes from predictability; manufactured software lacks documentation, community and support [E3 §12].
- **Status:** Active.
- **Source:** E3 §10, §12.

### DEC-63 — Modest positioning

- **Date:** 2026-10-17.
- **Decision:** Claim a trust-and-economics architecture for cheap proposals, not a new paradigm or a platform replacement [E3 §16].
- **Rationale:** Almost every mechanism existed before; the new ingredient is cheap proposals [E3 §16].
- **Status:** Active. Consistent with the white paper's rejection of a platform-replacement narrative [W p.15].
- **Source:** E3 §16, §17; W p.15.

## Working decisions (17 Oct 2026, this repository)

### DEC-64 — Probes narrow, campaigns decide

- **Date:** 2026-10-17.
- **Decision:** A probe under `experiments/` is one precommitted run on the shared desktop, labelled Recorded (probe). It may narrow a design choice inside a work package or a decision point; it never satisfies an exit gate, decides X1–X6, or changes an evidence label in R12 §2–§3.
- **Rationale:** Six probes produced useful numbers in a day; without this rule they would be cited as results they are not (`experiments/README.md`).
- **Alternatives rejected:** running each as a mini-campaign (would have taken the day and not answered the design questions).
- **Status:** Active.
- **Source:** `experiments/README.md`; `EXECUTION-PLAN.md` §8.1; R12 §7.

### DEC-65 — Subscription CLI only for the model term

- **Date:** 2026-10-17.
- **Decision:** No Anthropic API key is used in this project; model-term measurements run through the user's own login of the unmodified Claude Code CLI (`claude -p`), with MCP and tools stripped for the lean arm, and the runner asserts `ANTHROPIC_API_KEY` is unset.
- **Rationale:** The user's choice ("use our sub"). The docs permit scripted `-p` under a personal subscription for individual use; `--bare` and `--betas` are key-gated.
- **Alternatives rejected:** a bare Messages API arm (P-04b's original brief).
- **Status:** Active. Reverses the brief of P-04b; C05 and WP24a record no API arm.
- **Source:** `docs/execution/LESSONS-LOG.md` L-02, L-03; R18 CLI-doc entries.

### DEC-66 — The X1 pool

- **Date:** 2026-10-17.
- **Decision:** The X1 pool is 60 requests: 24 vouched HIGH/MEDIUM candidates (C-001–C-024) and 36 redacted calculation requests from the public chatbot transcripts (CC-001–CC-036) as the extension reserve. Frozen with seed 20261017; primary 20, reserve 40, blind half of 10. Rule-1 vouching is the owner's statement in chat, recorded in `campaigns/x1-spec-study/receipt/vouching.md`.
- **Rationale:** C01 needs 20 plus a reserve of 40 for the extension rule; freezing at 24 would have left a 4-request reserve.
- **Alternatives rejected:** freezing at 24; including LOW-confidence candidates.
- **Status:** Active. Registration of C01 (names, dates) is still pending.
- **Source:** `campaigns/x1-spec-study/receipt/freeze.json` (`freeze.sha256` df0684d6…); LESSONS-LOG L-09.

### DEC-67 — No hints in the pool

- **Date:** 2026-10-17.
- **Decision:** Pool request files carry the request, context, inputs and provenance only. The mining agent's shape guesses, cluster labels and "parametric sibling" notes are removed before freezing.
- **Rationale:** The specifier must see each request as it was made (RUBRIC inclusion rule 4), and the shape/cluster classification is a rater output, not an input.
- **Status:** Active.
- **Source:** `campaigns/x1-spec-study/RUBRIC.md`; LESSONS-LOG L-09.

### DEC-68 — Private text stays in work/

- **Date:** 2026-10-17.
- **Decision:** Request text, contracts and name mappings live under git-ignored `work/`; `receipt/` holds digests, events, classifications and summaries only. Nothing from the corpus is sent off this machine.
- **Rationale:** The chatbot transcripts and the owner's private study contain customer and site text; the study's identity is the pool digest, not the pool.
- **Status:** Active.
- **Source:** `campaigns/x1-spec-study/README.md`; the refrigeration-ai session's caution (LESSONS-LOG L-08).

### DEC-69 — Hand-offs through files

- **Date:** 2026-10-17.
- **Decision:** When two sessions on this machine exchange work, the producer writes a file into this repository (under `work/` if private) and the consumer reads it; a session message, if sent, only names the path.
- **Rationale:** Messages between sessions in different permission modes are held and expire; files are not.
- **Status:** Active.
- **Source:** LESSONS-LOG L-08.

### DEC-70 — R19 deferred

- **Date:** 2026-10-17.
- **Decision:** R19's ten proposals enter the plan only as C01 secondaries (popularity clustering; structural-versus-parametric residuals) and a conditional C05 arm (type-constrained decoding); the rest are deferred to Edition 4 (`EXECUTION-PLAN.md` §8.2).
- **Rationale:** §2.1, §2.3 and §2.5 depend on facts X1 measures; §2.4 applies to refinement (rung 5) only; the others change nothing before Stage 6.
- **Status:** Active.
- **Source:** R19 §3–§4; `docs/execution/CRITIQUE-2026-10-17-plan.md`.

### DEC-71 — X1 as a dark-factory pilot

- **Date:** 2026-10-17.
- **Decision:** No person writes contracts. Each X1 request is handled by one fresh agent that specifies (contract + frozen tests), generates (AssemblyScript kernel), and qualifies (fixed gates it cannot edit); a second blind agent classifies the seeded half; the person's role is confirmation of the recorded question. The run is labelled a pilot of C01 under an agent specifier, not a registered C01 result.
- **Rationale:** The owner's direction: the product is a dark software factory (discover need → create code → promote to user), and "the whole point is to use agents". It is also Edition 3 §6's own design (the evaluator is synthesized; the person confirms a sentence).
- **Alternatives rejected:** the human-specifier X1 of C01 (reverses C01's "no model assistance" rule); the coordinator writing contracts itself (rejected by the owner: not blind, not parallel).
- **Status:** Active. C01 and R14 X1 need rewriting to this design before registration.
- **Source:** `campaigns/x1-spec-study/receipt/notes.md`; `factory/README.md`; LESSONS-LOG L-11.

### DEC-72 — Freeze the procedure, not the examples

- **Date:** 2026-10-17.
- **Decision:** The frozen, hashed evaluator is a procedure: properties and metamorphic relations, seeded input generators, differential or exhaustive checks where a reference exists, pre-registered sample sizes and acceptance rule, and the framings of any judging agents. Fixed example tests are the smallest layer and are sufficient on their own only where the task is deterministic by construction (pure kernels). For interface requests the evaluation splits by part: logic, view specification, interaction behaviour, fit to the person.
- **Rationale:** Fixed examples are incomplete for non-unique outputs, overfit under search (E3 §11) and brittle to correct variation; the day's evidence (P-03 invariants, disagreement inputs, P-06 exhaustive check, the persona stage) shows the procedure-level objects carry the discriminating power. Owner's direction, 17 Oct.
- **Alternatives rejected:** a fixed holdout of examples per task (C01/C02 as first drafted); model-as-judge without framing diversity.
- **Status:** Active. WP09 (evaluator engine) is properties-first; C02 and C03 register generators and power rather than fixtures; X1's successor for generative UI prices the scenario and judgement layers explicitly.
- **Source:** LESSONS-LOG L-15; E3 §6 (metamorphic relations, differential tests), §11; P-03, P-06, persona-review-summary.

### DEC-73 — The factory hill-climb method

- **Date:** 2026-10-17 (Deep POODO loop; research gate satisfied with three records, 31 primary sources; two-member blind council).
- **Decision:** `docs/execution/HILLCLIMB-METHOD.md` v2. The objective climbed is clean promotion on fresh real requests, judged by a sealed consumer-oracle plus three canaries plus a human touchpoint every loop; the whole stack (including the factory's own evaluator stage) moves on a fast loop; the oracle, canaries, sealed set, guardrail thresholds and scoring code move only on an owner-approved slow loop; adoption is paired by request against an incumbent that already contains the cheapest measured move; interactions are made visible by a resolution-IV screen when the measured token budget allows and by a pre-registered single-interaction four-corner design otherwise; an A/A replicate dimensions the noise floor before every comparison; briefs, model ids and machine state are hashed into the precommit; forecasts are Brier-scored.
- **Rationale:** gates were blind to all observed defect classes; time is gameable; persona verdicts come from the optimised stack; a single whole-stack contrast aliases every stage effect; at n = 20 a 20-point proportion change is inside the A/A noise; no proxy is unhackable and repeated scoring overfits. Owner directives honoured: whole stack per loop, agents do the work, evaluators agentic and isolated, evaluator and code in parallel by blind agents, everything recorded.
- **Alternatives rejected:** adaptive one-factor-at-a-time (its advantage needs experimental error under ~25 % of combined effects and cannot show interactions; dominated until the A/A floor is known); whole-stack adoption with no attribution (fails the "see meta-opportunities" goal); a full screen every loop regardless of budget (≈8× the runs); stopping the hill-climb until rung 4 (rejected in full; adopted as the per-loop human slice and the loop-2 stop rule).
- **Status:** Active. Loop 1 runs only on the owner's approval of the charter and after the ten blind verdicts.
- **Source:** HILLCLIMB-METHOD.md v2; the POODO capsule of 2026-10-17 (session transcript); research records summarised there.

### DEC-74 — No human in the loop

- **Date:** 2026-10-17 (evening).
- **Decision:** The hill-climb runs with no human step. The human touchpoint of DEC-73 (ten blind verdicts, five criteria validations, five uses per loop, the loop-2 stop rule) is replaced by a sealed oracle panel of two agents on different models and frames (Sonnet 5.5 technician frame; Opus 5.5 reviewer frame), with inter-oracle agreement recorded as a measured, not assumed, independence proxy; canary recall 3/3 for the panel; agent-corroborated end-to-end use of five promotions per loop; a slow-loop agent council for judge changes with the owner's veto if the owner chooses to look. Human grading or use, when it happens, is an audit that raises the claim ceiling for the items it touches; the loop never waits for it.
- **Rationale:** The owner's directive: "we need this to work without a human"; the owner is not a resource of the loop. The evidence does not change: model judges share blind spots and no proxy is unhackable, so the panel's independence is measured every loop and the canary set grows with every discovered miss.
- **Consequence stated plainly:** the highest claim a human-free loop can make is agent-corroborated clean promotion. Edition 3 §17 rung 4 (a generated capability completes a real person's real task) cannot be reached by this loop alone; it needs a person at least once, as an audit.
- **Alternatives rejected:** keeping a mandatory human gate (contradicts the directive); dropping calibration altogether (leaves the persona proxy unmeasured).
- **Status:** Active. HILLCLIMB-METHOD.md v2.1.
- **Source:** owner's messages of 17 Oct evening; DEC-73; research record on evaluation integrity (judge correlation, Goodhart).

### DEC-75 — The spec is the incumbent, not the law

- **Date:** 2026-10-17 (late evening).
- **Decision:** Edition 3, the factory protocol, the gates, the claim ladder and HILLCLIMB-METHOD.md are the incumbent hypothesis, to be beaten by every loop. Each loop runs a deviation step: a fresh agent proposes at least five deviations from the spec with predicted effect, cost and test; at least one is tested in that loop; winners are merged into the spec (version bump, errata entry, decision record), losers recorded. The spec's own choices (artifact class, gate set and definitions, review stages, promotion statuses, request-discovery trigger, the method's design) move on the fast loop. Only the objective, the honesty rules and the record are fixed. The claim ladder's top rung may be evidenced by production telemetry (a capability called in a real technician thread, follow-up answered, no escalation), not only by a person's verdict in the loop; DEC-74's "claim ceiling" wording is replaced accordingly.
- **Rationale:** The owner's correction: the point is to deviate from the initial spec with better ideas; a spec used as law never improves. Loop 0 already shows candidates the spec forbids or ignores: 15 of 18 capabilities shipped with pending changes; no interface requests in the pool because the artifact class excludes them; two review stages after the fact; a timer trigger where real demand sits in the app's threads.
- **Consequence:** the loop-1 charter is a plan, not a law; the loop-1 session may change the design if it records the departure and hashes what it actually runs. Seed deviations D-01 to D-07 are listed in the method.
- **Alternatives rejected:** keeping gate changes and spec changes on the owner-approved slow loop (treats the spec as law); abandoning precommitment (would make departures indistinguishable from drift).
- **Status:** Active. HILLCLIMB-METHOD.md v2.2. Amends DEC-73 and DEC-74.
- **Source:** owner's message of 17 Oct late evening; loop-0 receipts (`campaigns/x1-spec-study/receipt/`).

### DEC-76 — Loop 1 outcome: not adopted; the incumbent stands; the ruler first

- **Date:** 2026-10-18 (the loop-1 session, under the hashed precommit `campaigns/hillclimb-loop-01/receipt/PRECOMMIT.md`, sha256 `e4588d35…`).
- **Decision:** The loop-1 challenger (the charter's all-new bundle, with D-02's bounded repair inside it as the deviation arm) is not adopted. Paired clean gain against the incumbent (factory v2 + low effort, single-shot metered form) was 0 of 20 on the working set and 0 of 20 on the sealed set under the median panel rule (1 of 20 clean for every arm on both sets); the wall and token guardrails were breached (3.0–3.7× and 4.5–5.1× against bounds of 2.0× and 3.0×); inter-oracle within-one agreement fell below 80 % for one pair on the working set. D-02 is recorded as lost at this n. No deviation is merged into Edition 3; `docs/coverage/EDITION-3-ERRATA.md` is unchanged. The budget decision that reduced the screen to three arms (A, B, E; stage corners and the default-effort arm carried forward) is recorded in `receipt/budget-decision.json` and `deviations.md`.
- **Rationale:** The result is "no evidence at this n", not "worse": the ordinal reading moved in opposite directions on the two sets. The deeper reading is that the panel-clean rate on fresh requests is at the floor (0–1 of 20 for every arm, against 3–4 of 20 on the development set), so the primary metric could not have shown a +6 of 20 gain; and the bundle's cost is its own disqualifier.
- **Consequences:** Loop 2 begins with the ruler, run side by side with this one on the 120 rendered sheets (ordinal co-primary, request-kind stratification, canaries replayed per candidate ruler), then prices the generation stage alone against the incumbent; the stage budget row for loop 1 is in `HILLCLIMB-METHOD.md` v2.3. Two consecutive loops without a main effect ≥ 20 points move the budget from variants to harvesting real requests and oracle work (the charter's response rule); loop 1 is the first.
- **Alternatives rejected:** adopting on the ordinal reading of either set (opposite signs; p = 0.34 and 0.55); adopting B alone on its lower wall (its clean count was 0 and 1 of 20); treating the floor as a factory result rather than a ruler result (the development set, with the same factory and panel, sits at 15–20 %).
- **Status:** Active.
- **Source:** `campaigns/hillclimb-loop-01/receipt/DECISION.md`, `analysis.json`, `noise-floor.json`, `forecasts-scored.json`, `consumer-use.json`; LESSONS-LOG L-22–L-26.

### DEC-77 — Oracle protocol v1.1: one model round per rater; verdicts derived from the answers

- **Date:** 2026-10-18.
- **Decision:** (1) Every sealed rater runs as a single model round over the prompt: the Codex CLI oracle runs with `--ignore-user-config`, a named model, `web_search="disabled"` and a no-tools rule in its brief; criteria written earlier with web searches were archived and rewritten. (2) Scoring briefs v2: the verdict follows from the rater's own answers (clean needs Q1, Q2, Q3 all yes and no required change; any no is not-usable; otherwise usable-with-change), the stated verdict can only make it more severe, and the wrong-question class is stated as a general rule. (3) Any later ruler change replays the canary packet (three canaries, three known-clean fillers) before use.
- **Rationale:** Canary dry-run attempt 1 under the v1 briefs caught CC-009 (3/3) and C-006 (2/3) but not CC-011 (1/3): the raters' own criteria asked for a quote and they graded the quote checker against that. Attempt 2 under v2 passed 3/3 with no filler false-rejected. The Codex tool surface cost 1.3M tokens for five criteria batches and gave one rater an evidence base the others could not have.
- **Departure declared:** the method puts ruler changes on a slow loop decided by an agent council with the owner's veto; this change was made by the loop-1 session alone, as the brief instructed ("3/3 or stop and revise the oracle protocol (slow loop, recorded)"), with the canary replay as its only test. The owner may veto; loop 2's ruler work (DEC-76) is where a council reads it against the drift evidence: under v2 the two known-clean fillers moved to usable-with-change for two raters and the fresh-request clean rate sits at the floor.
- **Status:** Active; HILLCLIMB-METHOD.md v2.3.
- **Source:** `campaigns/hillclimb-loop-01/receipt/canary-dryrun.jsonl`, `oracle-protocol-revisions.jsonl`, `briefs/oracle-score-*-v2.md`, `lib/runner.mjs`, `lib/oracle.mjs`; LESSONS-LOG L-18, L-19.

### DEC-78 — All review is agentic

- **Date:** 2026-10-18.
- **Decision:** Every review in Endoforge is performed by agents: persona reviews, oracle scoring, calibration, criteria audits, consumer use. No document, method step, report or recommendation uses, waits for, offers or falls back on a human reviewer, audit or verdict. DEC-74's "optional human audit" and its rung-4 wording ("needs a person") are withdrawn. Claims are stated by the machine evidence that exists: agent-corroborated promotion, agent-corroborated use through the runtime, machine telemetry where deployed.
- **Rationale:** The owner's directives of 17-18 Oct: "we need this to work without a human"; "this must be fully agentic persona reviews"; "were not using human reviewers".
- **Status:** Active. Amends DEC-74 and DEC-75. HILLCLIMB-METHOD.md updated in the same commit.

### DEC-79 — Evals, not judges

- **Date:** 2026-10-18.
- **Decision:** The evaluator role is the one DEC-72 and L-16 described: persona agents write executable evals from the raw request while the generator writes the code, blind to it; the evals are frozen before any kernel exists and deterministic gates run them. The hill-climb's objective becomes the pass rate on these frozen evals on fresh requests. No agent scores an artefact after the fact. Eval quality is measured by machine means: independent eval writers on two model families, deterministic consistency checks against the typed contract, canary capabilities that must fail, and mutation testing.
- **Rationale:** The owner's correction: the mechanical checks found by loop 1's judges "are the evals they are supposed to write in parallel while the other agent is coding, they are not supposed to be agentic judges." Loop 1's post-hoc panel spent more tokens judging than generating (L-26), disagreed on reference truth, and sat at the floor on fresh requests (L-22).
- **Consequence:** Loop 1's oracle criteria (120 sheets) are the raw material for the first eval suites; their executable anchoring scored 1.4 of 2 in loop 1's audit, so converting them to executable checks is the first work. Post-hoc panel scores remain in the record as loop 1's ruler.
- **Status:** Active. Supersedes the oracle-panel ruler of DEC-73/74/77. HILLCLIMB-METHOD.md v2.4.

### DEC-80 — What evals see, what they must check, and what they never decide alone

- **Date:** 2026-10-18 (POODO Deep; independent critic: Codex, sealed; probe P-08).
- **Decision:**
  1. **Request-blind evals.** Eval writers see the raw request and the bare signature (export names, argument names, units). They never see the stub's assumption, defaults, formulas or question. Two writers on different model families per request.
  2. **Interface evals are mandatory.** Every fact the answer depends on must reach the kernel through an argument, unless it is decision-stable: a fact counts as required only when the writer gives two plausible values whose expected outputs differ beyond the stated tolerance. This curbs over-asking (P-08: sensor offsets, deadbands, altitude for a sea-level question).
  3. **Physical validity is a library, not a writer's memory.** Absolute zero, critical points and saturation limits per refrigerant, non-negative pressures, flows and masses, finite inputs: sourced (NIST and named tables), deterministic, applied to every kernel by the gate.
  4. **Value correctness rests on a sourced property core.** Reference values come from an authoritative library or table with its source and version; kernels and evals must not share the same table (common-mode guard: an eval's reference uses an independent source or a deliberate cross-check).
  5. **Frozen evals are challengeable.** A failing eval is invalidated only by outcome-independent evidence (an independent sourced computation, or both writers disagreeing with it), recorded; the repair agent never edits evals; repair is a minimal patch against valid failing evals.
  6. **Out-of-class requests are stratified, not discarded.** Intake classifies; requests the numeric-kernel class cannot serve are reported as their own stratum with the reason; the artifact class stays climbable (D-04).
- **Evidence:** P-08 (`experiments/P-08-request-blind-evals/RESULT.md`): request-blind writers rejected the no-input-path kernels 4/4 against 0/4 for stub-fed evals; found the absolute-zero defect in correct-valued kernels; missed C-022's impossible result by physics in 0/4; over-asked. Research: generated oracles encode actual behaviour (Konstantinou, Degiovanni, Papadakis); separate ambiguity detection improves resolution (Edwards and Schuster, EMNLP 2026; ClarifyGPT); LLM property tests have low coverage unless measured (Vikram et al.).
- **Not yet shown:** that these changes raise usable capabilities on fresh requests; the decision-stability gate; the physical-validity library's false-reject rate. Loop 2 measures them.
- **Status:** Active. Amends DEC-79; HILLCLIMB-METHOD.md v2.5.
- **Update (2026-10-18):** item 4 was first implemented as `tools/property-core/` inside Endoforge and then removed the same day (DEC-81): domain reference data belongs to the consuming project.

### DEC-81 — Domain references belong to the consuming project

- **Date:** 2026-10-18.
- **Decision:** Endoforge is a general factory and carries no domain data. DEC-80 item 4 is restated: an eval's value references come from a **reference provider** the consuming project supplies, declared per run (provider name, version, source, hash) and never shared with the kernel under test. Physical-validity checks (DEC-80 item 3) split the same way: the general part (finite inputs, declared ranges, sign and unit sanity) stays in Endoforge; domain bounds (critical points, saturation limits) come from the provider.
- **Rationale:** The owner: "this is a general tool, refrigerant tables are not useful beyond fieldos this would be bloat and doesnt belong in this project". The consuming project already has them: refrigeration-ai `packages/domain/src/calculators/pt-tables.generated.ts` (CoolProp 8.0.0, generated 2026-10-06, R-22, R-404A, R-410A, R-507A, dew and bubble, golden tests; its header marks the tables as not yet signed off, per ADR-167).
- **Consequence:** `tools/property-core/` (added and removed on 18 Oct) is deleted from the tree; its findings stay in the record (P-08 addendum: the R-404A value at 15 psig, the CC-034 deviations), computed with the same library version the consuming project uses.
- **Status:** Active. Amends DEC-80.

## Edition 3 alignment

- **What changed.** Edition 3 reverses DEC-04, DEC-05, DEC-12, DEC-34, DEC-36 and DEC-37, and narrows DEC-28 and DEC-40. It adds DEC-41 to DEC-63.
- **What is superseded.** The TypeScript-centred, QuickJS-guest, V8-local design of 14 October; the workcell as the headline; the physical-limits section as design driver; retained code as the asset.
- **What still holds.** Lifetimes, outcome unknown, the portable contract, the warm-baseline rule, identity separation, the evaluation ladder, the three loops and promotion rule, Rust as refinement, and the named compatibility lane.

## Open questions

- Was "trusted harness not generated" stated in the lost Edition 2 reference library, as Edition 3 implies? (DEC-05; errata.)
- Were the Python and Javy routes of DEC-28 dropped or merely omitted from Edition 3? (E3 X4 could include them.)
- Where does the compatibility lane's child V8 isolate run on the Wasmtime local lane? (DEC-46, DEC-50; E3 X4.)
- Should the lab's G = 0 decisions be re-registered against the Edition 3 kernel contract before its campaigns run? (WP??.)

## Sources

- `sources/text/Endoforge-Edition-3.txt` — §1–§18.
- `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt` — opening passage, §1–§15, App. B.
- `sources/text/In-Isolate-Software-Workshop-v1.txt` — pp. 2, 4–6, 9–11, 13–15, 19–22, 24.
- `sources/text/Diagram-Atlas.txt` — sheets 02–05, 07, 11, 14–16, 18, 21–23, 28–29.
- `~/Work/isolate-factory-lab/docs/LAB-DESIGN.md`, `PREDICTIONS.md`, `CRITIQUE-2026-10-14.md`, `END-STATE-AND-TEST-PLAN.md`, `UI-HILLCLIMB.md`, `CHECKERS.md`, `EXECUTORS.md`; `CRITIQUE-2026-10-14-precampaign.md`.
- `~/Work/isolate-factory-lab-wt/precampaign-fix/docs/PREDICTIONS.md` (v1.6) and `docs/BACKLOG.md`.
- `~/Work/field-ops-github-review/docs/research/2026-10-07-worker-fabric-design-council.md`.
