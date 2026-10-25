# R15 — Risk register

> Reconstructed 2026-10-17. The original R15 was not available; this version is rebuilt from
> Edition 3 (§3–§13, §15, §18), Edition 2 (§3, §6, §8–§12, §14), the white paper (pp. 6, 9–11, 14–15, 18–22),
> the diagram atlas (sheets 03–04, 07–08, 11, 17–23, 29) and the isolate-factory-lab records
> (`docs/PREDICTIONS.md`, `docs/CRITIQUE-2026-10-14.md`, `CRITIQUE-2026-10-14-precampaign.md`,
> `docs/CHECKERS.md`, `docs/EXECUTORS.md`, and the `feat/fastloop` and `feat/measure` worktrees).
> Content follows Edition 3 where the editions differ.

## Purpose

This register lists the risks that could make Endoforge fail, mislead its own evidence, or cost more than it returns. Edition 3 names six dependency risks "so they can be tracked rather than discovered" [E3 §13]. The other sources imply many more, mostly in the trust, search, library and resource sections. Each entry gives a description, a qualitative likelihood and impact, the mitigation the sources propose, an owner placeholder, the trigger or indicator that would show the risk is materialising, and the Edition 3 experiment (X1–X6) or work-package placeholder that would retire or measure it. Every likelihood and impact rating here is **Proposed**: it is this reconstruction's judgement from the sources, not a measurement.

## Summary

- RISK-01 to RISK-06 are Edition 3's six named dependency risks, kept in its order and wording [E3 §13].
- RISK-07 to RISK-12 are trust and search risks: correlated evaluator error, evaluator overfitting under search, holdout adaptation, under-powered escape-rate thresholds, specification cost, and review throughput [E3 §6, §7, §11, §13].
- RISK-13 to RISK-22 are library, resource, latency and product risks: landfill library, reclamation, outcome-unknown recovery, in-process limits, unified-memory contention, inference-dominated latency, legibility, kernel-route yield, the compatibility lane, and a locality benefit smaller than claimed.
- RISK-23 to RISK-30 are measurement, data, refinement and record-keeping risks, several of which the isolate lab's critiques found in real code before any campaign ran.
- RISK-31 (added 2026-10-17) is the one risk with a measured rate: the X1 pilot's persona review rejected gated capabilities at 2 of 41 verdicts, then 1 of 41 after re-runs (Pilot (not a registered result)).
- No risk below is retired. The only recorded evidence that bears on any of them is listed in R12; lab pilot numbers appear only as **Pilot (not a result)**.

## How to read the register

| Field | Meaning |
|---|---|
| Likelihood / Impact | Low, Medium or High. **Proposed** for every entry. Impact is judged against the north-star unit: independently accepted useful capability per unit of total cost [E3 §1]. |
| Owner | Placeholder. No owner is assigned in any source. |
| Trigger / indicator | The observation that should move the risk up or prompt action. |
| Linked | An Edition 3 experiment (`E3 X1`…`E3 X6`), the matched end-to-end campaign [E3 §15], or a work-package placeholder `WP??` for `docs/execution/WORK-PACKAGES.md` to assign. |

## Register at a glance

| ID | Risk | Likelihood (Proposed) | Impact (Proposed) | Linked |
|---|---|---|---|---|
| RISK-01 | tsc-rs age, provenance and parity | High | Medium | E3 X6, E3 X4 |
| RISK-02 | Hosted lane does not fit: 128 MB Workers ceiling and platform limits | High | Medium | E3 X6 |
| RISK-03 | Shared-process side channels and missing self-hosted mitigations | Medium | High | WP16 (multi-tenant security) |
| RISK-04 | Retained capabilities as injection vectors | Medium | High | WP05, WP31 (lineage and re-admission) |
| RISK-05 | SDK and host churn | High | Medium | WP13, WP31 (contract versioning) |
| RISK-06 | License and provenance obligations | Medium | Medium | WP05 (admission record) |
| RISK-07 | Correlated evaluator error | High | High | E3 X2 |
| RISK-08 | Evaluator overfitting under search | High | High | E3 X3 |
| RISK-09 | Holdout adaptation | Medium | High | E3 X3; matched campaign |
| RISK-10 | Escape-rate thresholds not supported by sample size | High | High | E3 X3 |
| RISK-11 | Specification cost swamps value (generative applications) | Medium | High | E3 X1 |
| RISK-12 | Review throughput is the binding constraint | High | High | E3 X1, E3 X2 |
| RISK-13 | Landfill library: inventory cost exceeds reuse value | Medium | Medium | WP31 (library lifecycle) |
| RISK-14 | Memory is not actually reclaimed | Medium | Medium | E3 X4 |
| RISK-15 | Outcome-unknown recovery is wrong or silently resolved | Low | High | WP17 (recovery) |
| RISK-16 | Limits cannot be enforced in-process | Medium | High | E3 X4; WP16 (containment) |
| RISK-17 | Unified-memory bandwidth contention | Medium | Medium | E3 X5 |
| RISK-18 | Model inference dominates latency | High | Medium | E3 X5 |
| RISK-19 | Manufactured software is not legible or predictable | Medium | High | E3 X1; matched campaign |
| RISK-20 | Kernel-route first-pass yield is too low | Medium | Medium | E3 X4 |
| RISK-21 | The compatibility lane becomes the de facto default | Medium | Medium | E3 X4 |
| RISK-22 | Locality benefit is smaller than claimed; warm native baseline wins | Medium | Medium | Matched campaign |
| RISK-23 | Measurement artefacts decide the result | Medium | High | Matched campaign; WP01, WP02 (harness) |
| RISK-24 | Confidential data leaks through generated source or reuse | Medium | High | WP05, WP31 (lineage) |
| RISK-25 | Underdetermined requests: no computation supplies the missing fact | High | Medium | E3 X1 |
| RISK-26 | Refinement spend does not repay | Medium | Low | C13 (campaign accounting) |
| RISK-27 | Upstream figures and platform limits drift | High | Medium | Every X that cites an upstream figure |
| RISK-28 | Retrieval is itself a model call | Medium | Medium | WP31 (library retrieval) |
| RISK-29 | Evaluator errors are silent and credentialed | Medium | High | E3 X2, E3 X3 |
| RISK-30 | Reconstruction and identifier drift in the documentation record | Medium | Medium | `docs/coverage/` |
| RISK-31 | Gates pass, persona rejects: a gated capability is not the capability the person wanted | High | High | WP28 (promotion rule), WP29 (G7); E3 X2 (seed stratum); rung-4 attempt |

## Edition 3's six named dependency risks

### RISK-01 — tsc-rs age, provenance and parity

| Field | Entry |
|---|---|
| Description | tsc-rs is days old and machine-written. Its first public preview shipped on 7 October 2026 as an experimental LLM-written Rust port of the TypeScript 7 compiler, pinned to one upstream revision, with documented stale-output cases under build mode and memory growth in long sessions. TypeScript has no specification, so parity is a tested property, not a guaranteed one [E3 §13 item 1]. The WASM interface is single-threaded, has no watch or language-service mode and creates a new instance per check [E3 §14; W p.13]. |
| Likelihood / Impact | High / Medium (**Proposed**). Impact is bounded because the kernel path does not depend on tsc-rs [E3 §13]. |
| Mitigation | Microsoft's native compiler is the parity oracle; tsc-rs is pinned by module hash and re-qualified on every bump; the kernel path of §5 is independent of it [E3 §13]. Compare diagnostics and emitted bytes against a pinned reference [W p.13]. The lab pinned tsc-rs 0.7.0 (commit `3644f32…`), verified release provenance, and built native and WASM from the same commit (`isolate-factory-lab/docs/CHECKERS.md`). |
| Owner | TBD (unassigned). |
| Trigger / indicator | Any parity failure against the pinned TypeScript 7 oracle; a new tsc-rs release; stack overflow on deep inputs (the lab found that tsc-rs WASM on the caller thread overflows the default V8 stack on its DoS inputs, and pinned a worker thread with a 256 MB stack instead: `PREDICTIONS.md` v1.2); upstream test counts that move between revisions (see `docs/coverage/EDITION-3-ERRATA.md`). |
| Linked | E3 X6 (hosted fit); E3 X4 (the TypeScript arm). |
| Note | Lab development measurements found that tsc-rs WASM re-parses its embedded libs in every fresh instance and offers no API to retain them, and that in-place memory restore diverged past 2 GiB (`isolate-factory-lab-wt/fastloop/docs/FASTLOOP.md` §3). **Pilot (not a result).** |

### RISK-02 — Hosted lane does not fit: the 128 MB Workers ceiling and platform limits

| Field | Entry |
|---|---|
| Description | A type-check of a nontrivial project inside 128 MB alongside the harness, the overlay and a module instance is an open question, and so is single-threaded WebAssembly checking speed against native. Neither number exists [E3 §13 item 2]. Other hosted limits: 10 MB compressed Worker size on paid plans; four in-flight Dynamic Workers per request; ten per Durable Object I/O context; production timers restricted; no guest self-measurement [E3 §13 table; §18]. All are **Upstream**. |
| Likelihood / Impact | High / Medium (**Proposed**). The lab pre-registered prediction P5 that a fresh tsc-rs WASM check of its stress project needs more than 128 MiB of JS heap plus WASM linear memory. That is a prediction, not a result (`PREDICTIONS.md`). |
| Mitigation | The local Wasmtime lane leads; the hosted lane is kept only because it removes a deployment step [E3 §13]. If it does not fit, the hosted lane consumes checked artifacts and never compiles [E3 §15 X6 kill criterion]. |
| Owner | TBD. |
| Trigger / indicator | X6 working set over 128 MB, or check latency more than 3× native [E3 §15]. |
| Linked | E3 X6. |

### RISK-03 — Shared-process side channels and missing self-hosted mitigations

| Field | Entry |
|---|---|
| Description | Isolates in one process are not a Spectre boundary. The hosted platform's mitigations (coarsened timers, dynamic process isolation) do not ship with bare workerd or with any self-hosted runtime [E3 §13 item 3]. Isolates in one process also share that process's death and memory pressure [E3 §9]. At the inspected revision, workerd's factory source contained null isolate and request limit enforcers, and its README warns that workerd alone lacks defence in depth for malicious code [W p.15; A sheet 18]. |
| Likelihood / Impact | Medium / High (**Proposed**). |
| Mitigation | Cohorts of different trust get different processes; candidate code never receives fine-grained timers [E3 §13]. Partition cohorts by trust, authority and acceptable shared failure; keep controller and ledger outside every cohort [E3 §9; W p.15]. Provide outer containment, watchdogs and resource accounting for any self-hosted runtime [W p.15]. |
| Owner | TBD. |
| Trigger / indicator | Any design that co-locates cohorts of different trust in one process; any candidate API exposing a high-resolution clock; any self-hosted lane without an outer sandbox. |
| Linked | WP16 (multi-tenant security). None of X1–X6 measures it; Edition 3 lists multi-tenant security as not established [E3 §14]. |

### RISK-04 — Retained capabilities as injection vectors

| Field | Entry |
|---|---|
| Description | Data seen at generation time can shape code that later runs on other data, and a promoted keeper is a durable place for that to hide [E3 §13 item 4]. Source documents may contain prompt-injection text [A sheet 19]. |
| Likelihood / Impact | Medium / High (**Proposed**). |
| Mitigation | Review, lineage that follows the data, and re-admission on every reuse. None scales for free [E3 §13]. Every reuse is a fresh admission under current permissions [E3 §12; A sheet 29]. |
| Owner | TBD. |
| Trigger / indicator | A retained capability reused across a permission or tenant boundary without fresh admission; review backlog growth (see RISK-12). |
| Linked | WP05, WP31 (lineage and re-admission). |

### RISK-05 — SDK and host churn

| Field | Entry |
|---|---|
| Description | Every host contract change invalidates or re-qualifies a slice of the library, and the factory multiplies the number of dependents with no owner [E3 §13 item 5]. Every retained capability carries maintenance against SDK and host churn [E3 §12]. |
| Likelihood / Impact | High / Medium (**Proposed**). |
| Mitigation | Contracts are versioned; migrations are explicit; a capability with no passing qualification against the current host is retired, not quietly kept [E3 §13]. |
| Owner | TBD. |
| Trigger / indicator | Count of capabilities whose latest qualification predates the current host contract version. |
| Linked | WP13, WP31 (contract versioning and retirement). |

### RISK-06 — License and provenance

| Field | Entry |
|---|---|
| Description | The broad intake funnel admits existing scripts, libraries and model output that may carry license obligations [E3 §13 item 6]. Edition 2 and its reference library did not newly verify license interpretations [E2 App. B]. |
| Likelihood / Impact | Medium / Medium (**Proposed**). |
| Mitigation | License is a provenance field from the first admission, not a later audit [E3 §13]. |
| Owner | TBD. |
| Trigger / indicator | Any admitted artifact without a license field; any retained capability whose closure includes an unknown license. |
| Linked | WP05 (admission record). |

## Trust and search risks

### RISK-07 — Correlated evaluator error

| Field | Entry |
|---|---|
| Description | The failure is not a candidate editing its test. It is the same model reading the request the same wrong way and producing a test and a candidate that agree with each other [E3 §6]. Ten checks that all derive from one model turn are one check [E3 §7]. A candidate-blind model context is only partly independent: a separate context, the same prior [E3 §7 table]. The lab's critiques were themselves written by the same model family with a fresh context, which the lab records as limited independence (`CRITIQUE-2026-10-14.md`; `CRITIQUE-2026-10-14-precampaign.md`). |
| Likelihood / Impact | High / High (**Proposed**). |
| Mitigation | The four rules on the residual: before and blind, frozen, qualified, confirmed [E3 §6]. Draw the residual's authority from sources other than the generator's reading of intent: the person's examples, the data, differential tests, inherited contracts, metamorphic relations [E3 §6]. Count independent error sources per promotion [E3 §7]. |
| Owner | TBD. |
| Trigger / indicator | X2 evaluator error rate above 5% on determinate requests after the library passes [E3 §15]. |
| Linked | E3 X2. |

### RISK-08 — Evaluator overfitting under search

| Field | Entry |
|---|---|
| Description | Optimizers find the holes in their objective. If synthesized evaluators are wrong one time in a hundred, search meets the wrong evaluators as the easiest tasks and the candidates that exploit them as the best-scoring [E3 §11]. An escape rate under random sampling overstates safety under optimization [E3 §7]. Sixteen candidates against a 1% leak are also sixteen chances to be credentialed wrong [E3 §11]. Plain hill climbing can plateau or overfit its evaluator [W p.9]; search-based repair overfits its test suite [E3 §16]. |
| Likelihood / Impact | High / High (**Proposed**). |
| Mitigation | Set autonomy tiers against the searched rate, not the sampled one [E3 §11]. Bound candidate width by the evaluator's measured discriminating power before memory [E3 §11]. Keep diversity, restarts and untouched holdouts [W p.9]. |
| Owner | TBD. |
| Trigger / indicator | Searched escape rate materially above sampled escape rate; X3 searched escape rate above 1 in 1,000 with the full harness [E3 §15]. |
| Linked | E3 X3. |

### RISK-09 — Holdout adaptation

| Field | Entry |
|---|---|
| Description | Scores obtained repeatedly from the same held-out set adapt the search to that set even without access to its contents [E3 §11; E2 §6; W p.10]. |
| Likelihood / Impact | Medium / High (**Proposed**). |
| Mitigation | Release confirmation uses rotated or fresh fixtures, paired randomized comparisons, repeated measurements and real host accounting; an inconclusive difference stays inconclusive [E3 §11]. The lab froze holdouts by digest, kept them invisible to candidates and bounded winner's bias with a re-measured holdout rule (U3 in `docs/UI-HILLCLIMB.md`). |
| Owner | TBD. |
| Trigger / indicator | Holdout improvement much smaller than in-search improvement (the lab's U3 threshold is 70%); repeated reads of one holdout set across campaigns. |
| Linked | E3 X3; the matched end-to-end campaign [E3 §15]. |

### RISK-10 — Escape-rate thresholds not supported by sample size

| Field | Entry |
|---|---|
| Description | The Supervised and Autonomous tiers require escape rates below 1 in 1,000 and 1 in 10,000 [E3 §7]. **Derived:** with zero observed escapes in *n* seeded faults, the 95% upper bound on the rate is about 3/*n* (rule of three). Supporting "below 1 in 1,000" therefore needs about 3,000 zero-escape faults per domain (exactly 2,995 by Clopper–Pearson), and "below 1 in 10,000" about 30,000 (exactly 29,956); any observed escape raises the requirement (R14 §2). Edition 3 calls the ratio "measurable this week" and states no sample size [E3 §7, §15 X3]. |
| Likelihood / Impact | High / High (**Proposed**). A tier granted on too few faults is unsupported trust. |
| Mitigation | Pre-register fault counts, confidence level and stopping rule per domain before X3; report the upper confidence bound, not the point estimate; report sampled and searched rates separately. |
| Owner | TBD. |
| Trigger / indicator | A tier assignment whose fault count is below the derived minimum. |
| Linked | E3 X3. See `docs/coverage/EDITION-3-ERRATA.md`. |

### RISK-11 — Specification cost swamps value (generative applications)

| Field | Entry |
|---|---|
| Description | The second product's critical dependency is not the substrate. It is whether a request at the "too small for a project" scale can be turned into a checkable contract cheaply enough [E3 §3]. Its dominant cost is specification and review per request [E3 §3 table]. Generative applications win only where a residual exists that composition cannot cover and specification cost does not swamp [E3 §16]. End users rarely verify and generated artifacts go unmaintained [E3 §16, end-user programming row]. |
| Likelihood / Impact | Medium / High (**Proposed**). |
| Mitigation | Make the residual thinner every quarter [E3 §6]; confirm a sentence rather than review code [E3 §6]; narrow the product if X1 fails rather than lowering the standard [E3 §15]. |
| Owner | TBD. |
| Trigger / indicator | X1: under 20% of real requests specifiable in ten minutes. Then the agent substrate is the product and generative applications move to research [E3 §15]. |
| Linked | E3 X1. |

### RISK-12 — Review throughput is the binding constraint

| Field | Entry |
|---|---|
| Description | Review, lineage and re-admission are the mitigations for injection risk, none scales for free, "which is why review throughput is the binding constraint of the whole design" [E3 §13 item 4]. Reviewer effort is also a measured term of the decisive experiment [W p.22] and a cost in every search receipt [W p.10]. |
| Likelihood / Impact | High / High (**Proposed**). |
| Mitigation | Move promotion weight onto checks qualified before the request (thin residual) [E3 §6]; plain-language confirmation in place of code review [E3 §6]; trusted-base changes as "a handful of approvals a month" [E3 §8]. |
| Owner | TBD. |
| Trigger / indicator | Review queue age or size growing faster than accepted capabilities; reviewer minutes per accepted capability rising. |
| Linked | E3 X1, E3 X2. Edition 3 states "binding constraint" without a measurement; see the errata file on scope. |

### RISK-29 — Evaluator errors are silent and credentialed

| Field | Entry |
|---|---|
| Description | A wrong candidate fails visibly; a wrong evaluator promotes a wrong candidate with a receipt that says it passed [E3 §7]. An evaluator that accepts mutants has no discriminating power [E3 §6]. The lab found real cases before any campaign: a fixture without an expected output accepted any output, including the string `"garbage"`, and `outcome_unknown` on an expected-reject candidate scored as a correct reject (`CRITIQUE-2026-10-14-precampaign.md` M3, M4). |
| Likelihood / Impact | Medium / High (**Proposed**). |
| Mitigation | Qualify every evaluator by mutation testing before it may promote [E3 §6, §16]. The lab's C6 calibration requires 100% rejection of injected faults, extended after critique S7 to the paths that decide the primary metric (`docs/END-STATE-AND-TEST-PLAN.md`; `CRITIQUE-2026-10-14-precampaign.md`). Make evaluators fail closed when an expectation is missing (`PREDICTIONS.md` v1.6). |
| Owner | TBD. |
| Trigger / indicator | Any surviving mutant in evaluator qualification; any fixture lacking an expectation. |
| Linked | E3 X2, E3 X3. |

## Library, resource, latency and product risks

### RISK-13 — Landfill library: inventory cost exceeds reuse value

| Field | Entry |
|---|---|
| Description | Inventory costs money to hold: maintenance against churn, re-qualification when an evaluator or invariant changes, security review, retrieval cost. A library with no deprecation, deduplication or reclamation mechanism is "a landfill with provenance" [E3 §12]. Retained code becomes less valuable as models improve because regeneration gets cheaper [E3 §12 table]. Edition 2 already warned against "an ever-growing landfill of unreviewed code" [E2 §9]. |
| Likelihood / Impact | Medium / Medium (**Proposed**). |
| Mitigation | Make contracts, invariants, tests and counterexamples the asset and treat code as the liability [E3 §12]; separate implementations under one contract; qualification records do not transfer; retire capabilities that fail current qualification [E3 §12–§13]. |
| Owner | TBD. |
| Trigger / indicator | Retained capabilities with no reuse in a declared window; retrieval-plus-requalification cost exceeding regeneration cost. |
| Linked | WP31 (library lifecycle). Edition 3 claim-ladder rung 6 (lifetime economics) is "not yet" [E3 §17]. |

### RISK-28 — Retrieval is itself a model call

| Field | Entry |
|---|---|
| Description | Deciding whether a request can be satisfied by composition is semantic search: a model call with the same latency and trust properties as any other [E3 §12]. The "composable from the library" class (0.5–2 s, **Estimated**) depends on it [E3 §10]. |
| Likelihood / Impact | Medium / Medium (**Proposed**). |
| Mitigation | Treat a retrieval judgement as a candidate subject to the contract check, not as authority; route short retrieval calls to local inference where it pays [E3 §10]. |
| Owner | TBD. |
| Trigger / indicator | Retrieval false positives (a composed capability that fails its contract check); retrieval latency approaching generation latency. |
| Linked | WP31 (library retrieval); E3 X5 for local placement. |

### RISK-14 — Memory is not actually reclaimed

| Field | Entry |
|---|---|
| Description | Discarding a name is not freeing storage. The Mononoke study's test-only memory store removes link entries without reclaiming payload entries on those paths; that is not evidence about production leakage, but it is a reason to design long-lived ownership explicitly [E2 §3]. Binary size is not peak RAM, and compiled-module sharing across isolates is runtime-dependent [E2 §8; W pp. 6, 13]. |
| Likelihood / Impact | Medium / Medium (**Proposed**). |
| Mitigation | Measure bytes, not candidate counts; verify after teardown that resources were released [E2 §3; W p.21]; report retained-memory slope over thousands of candidates (lab critique item 15, `CRITIQUE-2026-10-14.md`). |
| Owner | TBD. |
| Trigger / indicator | Positive retained-memory slope across a campaign. Lab development work saw tsc-rs WASM in-place memory restore leak and diverge past 2 GiB (`FASTLOOP.md` §3). **Pilot (not a result).** |
| Linked | E3 X4 (per-candidate memory). |

### RISK-15 — Outcome-unknown recovery is wrong or silently resolved

| Field | Entry |
|---|---|
| Description | An attempt authorized before a crash may have executed. A process name, a PID or a successful spool is not proof of completion [E3 §9; A sheets 21–22]. Recovery that infers success, or a retry that duplicates an external effect, corrupts durable truth. |
| Likelihood / Impact | Low / High (**Proposed**). Low because Field OS recorded five named recovery boundaries behaving correctly (**Recorded**, W3/W4 receipt) [E3 §14]; that evidence covers one private adapter only. |
| Mitigation | Fence future work, verify the exact owned closure, record ambiguity [E3 §9]. Never silently retry an ambiguous external effect [A sheet 21]. The lab gives `outcome_unknown` its own stage and counts it as an admissibility flag (`PREDICTIONS.md` v1.6, after critique M3). |
| Owner | TBD. |
| Trigger / indicator | Any `outcome_unknown` scored as pass or fail; any retry without a new attempt identity. |
| Linked | WP17 (recovery). Physical power-loss survival is not established [E3 §14]. |

### RISK-16 — Limits cannot be enforced in-process

| Field | Entry |
|---|---|
| Description | A timeout on a blocked event loop cannot stop a synchronous loop [E3 §9; W p.21]. The lab found that an unbounded allocation loop is not stopped in-process by isolated-vm or worker_threads on Node 26.8.1; the hosting process is killed by its cgroup, so the blast radius is the whole arm (`PREDICTIONS.md` v1.5; `docs/EXECUTORS.md`). That is a lab conformance observation, not a campaign result. |
| Likelihood / Impact | Medium / High (**Proposed**). |
| Mitigation | Enforce deadlines, memory, output volume and host-call amplification in the runtime, an external watchdog or by terminating an owned cohort; measure from counters the candidate cannot touch [E3 §9]. Predeclare expected containment failures (lab P8). |
| Owner | TBD. |
| Trigger / indicator | Any containment case that escapes or leaves an owned process or unit. |
| Linked | E3 X4 (module footprint); WP16 (containment). |

### RISK-17 — Unified-memory bandwidth contention

| Field | Entry |
|---|---|
| Description | On unified-memory hardware, inference, compilation and evaluation share one bandwidth budget: B_inference + B_compiler + B_evaluator + B_other ≤ B_sustainable. Overlap can help or contention can make the combined loop worse [E2 §12]. The local lane's hard limits include unified-memory bandwidth shared with inference [E3 §13 table]. Thermal and sustained-operation limits apply; a cold burst is not sustained production [E2 §12]. |
| Likelihood / Impact | Medium / Medium (**Proposed**). |
| Mitigation | Measure compilation/evaluation alone, inference alone and the combined loop, then concurrency and memory sweeps [E2 §12]; compare against a discrete-GPU system where relevant [E2 §12]. |
| Owner | TBD. |
| Trigger / indicator | X5 local batched time-to-pass, yield-adjusted, worse than 1.5× hosted: local inference then serves short calls only [E3 §15]. |
| Linked | E3 X5. |

### RISK-18 — Model inference dominates latency

| Field | Entry |
|---|---|
| Description | For a small novel capability, roughly four fifths of the time is model inference, not anything the workcell does (**Estimated**) [E3 §10]. Every recorded number in the project is model-free [E3 §10]. The one recorded local model trial produced no completed JSON within its 90 s deadline (**Recorded**) [E3 §14]. Workcell engineering therefore cannot move the novel-request floor on its own. |
| Likelihood / Impact | High / Medium (**Proposed**). |
| Mitigation | Generate less; start before the request; parallel candidates for yield; overlap evaluator synthesis with generation; local inference for short calls; measure the model term [E3 §10]. |
| Owner | TBD. |
| Trigger / indicator | X5's first measured model latency [E3 §15]. |
| Linked | E3 X5. |

### RISK-19 — Manufactured software is not legible or predictable

| Field | Entry |
|---|---|
| Description | Trust in software comes from predictability. Manufactured software is new every time, for every person, with no documentation, community or support path when it breaks in six months [E3 §12]. A capability the person cannot predict is not on anyone's happy path, however fast it was made [E3 §12]. The white paper's stop rule includes "users cannot reliably understand the generated result" [W p.22]. |
| Likelihood / Impact | Medium / High (**Proposed**). |
| Mitigation | Explain each capability by its contract and evidence in the plain language the person confirmed [E3 §12]; keep the active version pinned until a validated candidate can replace it without losing input, focus or authority [A sheet 14]. |
| Owner | TBD. |
| Trigger / indicator | Users unable to state what a delivered capability checks; repeat explanation requests after delivery. |
| Linked | E3 X1; the matched campaign's conventional-agent arm [E3 §15]. Claim-ladder rung 4 is "not yet" [E3 §17]. |

### RISK-20 — Kernel-route first-pass yield is too low

| Field | Entry |
|---|---|
| Description | AssemblyScript yield is expected below TypeScript because models emit constructs it lacks; MoonBit's is unknown with little training data (**Estimated**) [E3 §5]. If yield is low, the kernel contract's benefits do not reach production. |
| Likelihood / Impact | Medium / Medium (**Proposed**). |
| Mitigation | Measure before committing: X4 decides the default route [E3 §15]. Keep the compatibility lane named and available [E3 §5]. |
| Owner | TBD. |
| Trigger / indicator | X4: best in-isolate WebAssembly route more than 20 points below TypeScript. Then the compatibility lane stays default and the kernel contract waits [E3 §15]. |
| Linked | E3 X4. X4 as written omits MoonBit; see the errata file. |

### RISK-21 — The compatibility lane becomes the de facto default

| Field | Entry |
|---|---|
| Description | The TypeScript-to-JavaScript compatibility lane executes generated JavaScript in a child V8 isolate [E3 §5 route table]. If most imported code and most generated code land there, the system runs generated imperative JavaScript at scale despite the kernel-plus-glue commitment, and needs the V8 topology the local Wasmtime lane was chosen to avoid [E3 §5, §13]. |
| Likelihood / Impact | Medium / Medium (**Proposed**). |
| Mitigation | Name the lane as a lane, not as the strict path [E3 §5]; give it separate admission and containment; track the share of capabilities served through it. |
| Owner | TBD. |
| Trigger / indicator | X4 kill criterion firing (RISK-20); compatibility-lane share of accepted capabilities rising. |
| Linked | E3 X4. See errata on "no generated imperative JavaScript executes anywhere". |

### RISK-22 — Locality benefit is smaller than claimed; the warm native baseline wins

| Field | Entry |
|---|---|
| Description | Edition 3 already rates in-isolate locality as roughly neutral as a headline [E3 §12 table] and requires comparison against a warm native baseline, not a cold VM [E3 §15; A sheet 02]. The lab's development head-to-head found a warm tsc-rs native API process with a warm sandbox pool used about 4.7× less CPU per candidate than its in-isolate tsc-rs WASM arm in the stateless regime, because the native process retains parsed libs (`isolate-factory-lab-wt/fastloop/docs/FASTLOOP.md` §0). **Pilot (not a result):** shared desktop, no quiet-machine gate, no confidence intervals. |
| Likelihood / Impact | Medium / Medium (**Proposed**). |
| Mitigation | Report the whole loop, not supporting microbenchmarks; pre-register the primary metric and a symmetric retraction rule (lab `PREDICTIONS.md`); keep locality as an enabler, not the thesis [E3 §1]. |
| Owner | TBD. |
| Trigger / indicator | Matched-campaign result where the warm native baseline is equivalent or better at equal total cost. |
| Linked | The matched end-to-end campaign [E3 §15]. |

## Measurement, data, refinement and record-keeping risks

### RISK-23 — Measurement artefacts decide the result

| Field | Entry |
|---|---|
| Description | The lab's two critiques found, before any campaign, defects that would have decided its primary comparison: a denominator that was behaviour-unique rather than content-unique (4× inflation on one stream); holdouts verified on the validator's emit, not the arm's own artifact; helper processes able to leave the arm cgroup; a steady-state rule confounded by stream composition; a harness constant diluting ratios towards "equivalent"; percentile bootstrap on eight blocks under-covering; official campaigns not refused on a dirty tree (`CRITIQUE-2026-10-14-precampaign.md` M1–M12, S1–S12). |
| Likelihood / Impact | Medium / High (**Proposed**). |
| Mitigation | Calibrate every instrument against known truths before it judges anything; pre-register and fix defects before data exists; refuse dirty trees; null arm; verified-only reporting; independent critique before and after (lab `END-STATE-AND-TEST-PLAN.md`; `PREDICTIONS.md` v1.6; `BACKLOG.md` on `precampaign-fix`). |
| Owner | TBD. |
| Trigger / indicator | Calibration gate failure (the lab's phase-3 pilot ran uncalibrated by construction: `isolate-factory-lab-wt/measure/docs/PILOT-2026-10-14.md`); any unattributed CPU outside arm cgroups. |
| Linked | Matched campaign; WP01, WP02 (harness). |

### RISK-24 — Confidential data leaks through generated source or reuse

| Field | Entry |
|---|---|
| Description | Generated source can embed confidential values; promotion never declassifies what was inlined [E3 §12; W p.20]. Tenant-bound lineage means most user-requested capabilities cannot be shared across tenants [E3 §12]. |
| Likelihood / Impact | Medium / High (**Proposed**). |
| Mitigation | Split templates into data-free logic and scoped inputs where possible; lineage follows the data; every reuse is a fresh admission [E3 §12; A sheets 20, 29]. Share contracts and invariants, which carry no customer data, rather than code [E3 §12]. |
| Owner | TBD. |
| Trigger / indicator | Literal input values in promoted source; cross-tenant retrieval hits. |
| Linked | WP05, WP31 (lineage). |

### RISK-25 — Underdetermined requests: no computation supplies the missing fact

| Field | Entry |
|---|---|
| Description | When behaviour is underdetermined by the available information, no computation can supply the missing observation [E3 §13; E2 §11]. A synthesized evaluator is computation and cannot supply a fact the request never contained [E3 §6]. At the "too small for a project" scale, ambiguous requests are most requests, and their latency is a human round trip: 30 s if present, hours if not (**Estimated**) [E3 §10]. |
| Likelihood / Impact | High / Medium (**Proposed**). |
| Mitigation | If the request is underdetermined, the host asks [E3 §4]; represent uncertainty explicitly [E2 §5]; start before the request where patterns are common [E3 §10]. |
| Owner | TBD. |
| Trigger / indicator | Share of X1 requests that need a clarification before a contract can be written. |
| Linked | E3 X1. |

### RISK-26 — Refinement spend does not repay

| Field | Entry |
|---|---|
| Description | Break-even is optimization cost divided by saving per subsequent use. **Derived** example from the sources: 200 CPU-seconds to save 1 ms per execution needs 200,000 executions to repay the CPU alone, before model, review and storage [E3 §11; E2 §6]. A Rust rewrite is one refinement among several [E3 §12]. |
| Likelihood / Impact | Medium / Low (**Proposed**). |
| Mitigation | Different budgets for a one-use capsule and a shared compiler path [E3 §11]; reward measured improvement, not the language label [E3 §12]. |
| Owner | TBD. |
| Trigger / indicator | Refinement campaigns whose projected use count is below break-even. |
| Linked | C13 (campaign accounting). |

### RISK-27 — Upstream figures and platform limits drift

| Field | Entry |
|---|---|
| Description | Platform limits, compiler releases and runtime behaviour change without notice [E3 §18; W p.25]. Several Edition 3 upstream figures were carried from Edition 2 and not reverified [E3 §18]. The tsc-rs README's ported-test count changed between 12 and 14 October 2026 (see R18, SRC-01). |
| Likelihood / Impact | High / Medium (**Proposed**). |
| Mitigation | Recheck every upstream figure against the exact build and host before the experiment that depends on it [E3 §18]; pin revisions; record check dates in R18. |
| Owner | TBD. |
| Trigger / indicator | Any R18 entry whose revalidation status is "needs recheck before X#" when that experiment is scheduled. |
| Linked | Every X that cites an upstream figure (R18). |

### RISK-31 — Gates pass, persona rejects

| Field | Entry |
|---|---|
| Description | The fixed gates certify that a kernel does what its contract says: frozen, compiles with no imports, exports, tests pass, deterministic, bounded. They say nothing about whether the contract is the capability the person wanted. In the X1 pilot every one of 19 gated kernels passed those gates, and a persona review then found a wrong default (C-006 v1: an unsafe equipment class for an A3 charge limit), a wrong question (CC-011: a cost formula for a price the kernel cannot hold) and five presentation defects shared by most capabilities (L-13). The second rejection was not repairable by the factory: no kernel can supply the price; the answer is a host binding. |
| Likelihood / Impact | High / High (**Proposed**). The only measured rate in this register: **2 of 41 persona verdicts rejected in the first review, 1 of 41 after the two re-runs; 16 of 19 gated capabilities needed at least one change; 3 of 19 were accepted by every persona** (Pilot (not a registered result); `campaigns/x1-spec-study/receipt/persona-review-summary.md`, `receipt/factory-summary.json`). One agent, one day, 19 capabilities: a rate to design against, not a result. |
| Mitigation | Promotion means gated **and** persona-accepted (WP28, `factory/promote.mjs`): a reject is gated-but-not-promoted with the question recorded; accept-with-change is promoted-pending-change, listed separately. The five presentation rules are a gate on the glue (G7, WP29) so that class cannot recur. Persona findings are handed forward to a fresh worker as input when the reject is repairable (one void per id). C02 grades the pilot's contracts as a seed stratum so the persona proxy is checked against graders. |
| Owner | TBD. |
| Trigger / indicator | Any persona reject on a gated capability; the share of accept-with-change verdicts above the pilot's 24 of 41; a rung-4 attempt in which the person's completion statement disagrees with the persona verdict. |
| Linked | WP28, WP29; E3 X2 (C02 seed stratum); the rung-4 attempt (DP-4); R04 §8; RISK-19, RISK-25. |

### RISK-30 — Reconstruction and identifier drift in the documentation record

| Field | Entry |
|---|---|
| Description | The Edition 2 reference library was written in a conversation that is not available, and this repository reconstructs it [CONVENTIONS]. The sources use two incompatible receipt and upstream numbering schemes (the white paper's R1–R9 / U1–U10 and the atlas and Edition 3 register's R01–R11 / U01–U14), and Edition 3 attributes at least one rule to Edition 2 that appears in the atlas in the available text (errata file). |
| Likelihood / Impact | Medium / Medium (**Proposed**). |
| Mitigation | Cite PDFs by page and sheet; use SRC-xx identifiers that map both schemes (R18); record known inconsistencies in `docs/coverage/EDITION-3-ERRATA.md`; never present reconstructed text as original. |
| Owner | TBD. |
| Trigger / indicator | A citation that resolves to different documents under the two schemes. |
| Linked | `docs/coverage/COVERAGE-MAP.md`; `docs/coverage/EDITION-3-ERRATA.md`. |

## Edition 3 alignment

- **What changed.** Edition 3 is the first source to name dependency risks explicitly, and it names six [E3 §13]. Its "What changed" list in §2 names only four of them; this register uses the six of §13 (see errata). Edition 3 also adds risks that earlier sources did not frame as risks: correlated evaluator error, searched versus sampled escape rate, inventory holding cost, legibility and review throughput [E3 §6–§7, §11–§13].
- **What is superseded.** The white paper and atlas treated a nested QuickJS guest as the inner candidate boundary [W p.4; A sheets 03–04]. Risks specific to that guest (interpreter overhead, guest heap size) now apply only to the recorded baseline and to the lab, not to the Edition 3 kernel path [E3 §5, §9].
- **What still holds.** Containment, recovery, three lifetimes and "isolate is not a failure boundary" carry over unchanged [E3 §9]. Holdout adaptation and break-even arithmetic carry over from Edition 2 [E2 §6; E3 §11].

## Open questions

- What fault counts and confidence level should X3 pre-register per domain? (RISK-10; E3 X3.)
- Is review throughput binding for both products, or only for generative applications and the retained library? (RISK-12; E3 X1, X2.)
- Which runtime hosts the JavaScript-hosted AssemblyScript compiler in the Wasmtime local lane? (RISK-20, RISK-21; errata; E3 X4.)
- Who owns each risk? No source assigns owners.
- Does the lab's development finding on parsed-lib retention (RISK-22) hold under a calibrated, quiet-machine campaign? (Matched campaign.)
- Does a persona agent's rejection predict a person's (RISK-31)? One rung-4 attempt and C02's seed-stratum grading are the first checks.

## Sources

- `sources/text/Endoforge-Edition-3.txt` — §1–§18, especially §6, §7, §9–§13, §15, §18.
- `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt` — §3, §5, §6, §8, §9, §11, §12, §14, App. B.
- `sources/text/In-Isolate-Software-Workshop-v1.txt` — pp. 6, 9–11, 13, 15, 20–22, 25.
- `sources/text/Diagram-Atlas.txt` — sheets 02–04, 14, 18–22, 29.
- `~/Work/isolate-factory-lab/docs/PREDICTIONS.md` (v1–v1.5), `docs/CRITIQUE-2026-10-14.md`, `CRITIQUE-2026-10-14-precampaign.md`, `docs/END-STATE-AND-TEST-PLAN.md`, `docs/UI-HILLCLIMB.md`, `docs/CHECKERS.md`, `docs/EXECUTORS.md`.
- `~/Work/isolate-factory-lab-wt/precampaign-fix/docs/PREDICTIONS.md` (v1.6) and `docs/BACKLOG.md`; `~/Work/isolate-factory-lab-wt/fastloop/docs/FASTLOOP.md`; `~/Work/isolate-factory-lab-wt/measure/docs/PILOT-2026-10-14.md`.
- `campaigns/x1-spec-study/receipt/{persona-review-summary.md,factory-summary.json}` and `docs/execution/LESSONS-LOG.md` L-13, L-14 (RISK-31; Pilot (not a registered result)).
