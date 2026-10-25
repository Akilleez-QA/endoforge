# R17 — Terminology

> Reconstructed 2026-10-17. The original R17 was not available; this version is rebuilt from
> Edition 3 (§1–§18), Edition 2 (§1–§15, App. B), the white paper (pp. 3, 5–6, 9–10, 19–22),
> the diagram atlas (sheets 01–30) and the isolate-factory-lab records (`docs/LAB-DESIGN.md`,
> `docs/ADAPTER-CONTRACT.md`, `docs/PREDICTIONS.md`, `docs/CHECKERS.md`, `docs/UI-HILLCLIMB.md`).
> Content follows Edition 3 where the editions differ.

## Purpose

This glossary defines every term that the sources use with a specific meaning. For each term it gives a definition, the source that defines or first uses it, and a note where the editions differ. Definitions paraphrase the sources; where a source defines a term in a table, the citation points to that table. When Edition 3 changes a meaning, the Edition 3 meaning comes first and the earlier meaning is recorded in the note.

## Summary

- Edition 3 introduces the trust and specification vocabulary: task residual, universal gates, domain invariants, escape rate (sampled and searched), autonomy tiers, independent error source, trusted base, kernel and glue.
- Edition 2 introduces the factory and ledger vocabulary: workcell, workpiece, machinery, keeper, finishing, build key, activation record, bubble, compatibility lane.
- The white paper and atlas introduce the workshop vocabulary: workshop isolate, software capsule, attempt, swarm, hill climbing, three lifetimes, outcome unknown, cohort.
- The lab adds measurement vocabulary used only in its campaigns: arm, representative, open-loop stream, regime, verified accept, marginal, pilot, G = 0.
- Two evidence vocabularies exist: the white paper's Observed / Upstream-reported / Derived / Proposed, the lab's OBSERVED / UPSTREAM / DERIVED / PROPOSED, and Edition 3's Recorded / Upstream / Derived / Estimated / Proposed. This repository uses Edition 3's [CONVENTIONS].

## Source keys

`E3` Edition 3; `E2` Edition 2; `W` white paper; `A` diagram atlas; `Lab` isolate-factory-lab (`~/Work/isolate-factory-lab`, paths relative to it); `M` Mononoke study as cited by E2.

## Glossary

| Term | Definition | Defined in | Edition notes |
|---|---|---|---|
| Acceptance layers | The three layers of acceptance for a task: universal gates, domain invariants, and the task residual. Only the top layer is synthesized per task. | E3 §6 | New in E3. |
| Activation | A guarded revision change that makes an accepted artifact the active version; the incumbent stays pinned until the replacement can take over without losing state, focus or authority. | W p.20 (Activation contract); E3 §4 | W lists its fields (accepted artifact and scope, state migration, expected active revision, current grants, reviewer or policy, rollback pointer). Same meaning in E2 §2 and E3. |
| Activation record | The identity that names the authorized transition to use of an artifact; authoritative for reconciling lost acknowledgements. | E2 §10 | One of the six identities of DEC-39 (R16). |
| Admission | Acceptance of a request, input or artifact into the system under current grants, source scope, context and policy. Every reuse and every resumption is a fresh admission. | W pp. 5–6; A sheets 21–23, 29; E3 §9, §12 | Same across editions. |
| Agent / attempt | In the white paper, the pair: an agent is a durable task and decision history; an attempt is one bounded period of actual execution. | W p.3 | E3 uses "attempt" as a lifetime (see Attempt lifetime). |
| Agent substrate | The first of Endoforge's two products: a cheap, trusted iteration loop for coding and tool-building agents. Evaluator comes from the agent's own task; trust required is modest; dominant cost is model inference. | E3 §3 | New in E3. E2 treated agentic coding as one application of one substrate [E2 §13]. |
| Ambiguous request | Request class whose latency includes a human round trip: 30 s if the person is present, hours if not (**Estimated**). At the "too small for a project" scale, most requests. | E3 §10 | New in E3. |
| Arm | One configuration compared in a matched campaign (for example A warm native baseline, C strict in-isolate). | W p.22; A sheet 28; Lab `docs/LAB-DESIGN.md` | E3 §15 adds a conventional-agent-in-warm-container arm. Lab arms A–E differ in detail from W's A–E. |
| Artifact identity | The identity naming exact executable output bytes. A hash names bytes and never grants permission or proves task correctness. | E2 §9–§10; A sheet 20; E3 §16 | Same across editions. |
| Attempt lifetime | State that is fresh per candidate and discarded after bounded execution: the candidate's overlay, compiler state, module instance and buffers. Loss means nothing; the task continues from durable records. | E3 §9; W p.6; A sheet 7 | E3 replaces "guest memory and VFS" with "module instance"; per-attempt footprint falls by one to two orders of magnitude (**Estimated**). |
| Autonomy tier | Per-domain level of human involvement in promotion, set from the measured escape rate: **Confirmed** (person approves residual and promotion; rate measured, no ceiling), **Supervised** (person approves residual; promotion automatic; below 1 in 1,000), **Autonomous** (no person; below 1 in 10,000 and acceptance covered entirely by qualified invariants). All thresholds **Proposed**. | E3 §7 | New in E3. Tiers use the searched rate [E3 §11]. Sample sizes are not stated (errata). |
| Before and blind | The first rule on the task residual: synthesized in a context that has seen no candidate, unique per task and shared by every candidate in the campaign. | E3 §6 | New in E3. |
| Bonsai | Mononoke's changeset record: ordered parents, metadata and changed-path mappings, with file contents stored separately. A mechanism Endoforge may borrow. | E2 §10 [M §1–§7] | E2 only. |
| Break-even | Optimization cost divided by saving per subsequent use, in the same units. | E2 §6; E3 §11 | Same in both. |
| Broad funnel | Admission of code in whatever supported form suits the task, converging on a common WASM execution system, with selective refinement of keepers. | E2 §4 | E3 keeps broad intake [E3 §13 item 6] but fixes candidate shape as kernel plus glue [E3 §5]. |
| Broker | The host service through which a candidate's declared capabilities are exercised; owns credentials and egress policy. Candidates cannot call it except through the host. | A sheets 17, 19; E3 §5 | Same meaning; E3 names it as one of the services the candidate never touches. |
| Bubble (ephemeral bubble) | A temporary storage overlay, taken from Mononoke, that lets candidate objects exist without durable publication. | E2 §10 [M] | E2 only; see R11. |
| Build key | The identity naming all build-affecting inputs. | E2 §10 | E3 §16 cites "build keys" among content-addressed mechanisms. |
| Build receipt | Record of source, config and dependency hashes, checker identity, mode, diagnostics, emitted-byte hashes and parity or test status. | W p.20 | — |
| Campaign | A bounded search that freezes a task, an evaluator, a budget and a baseline, then runs a frontier of proposals with cheap rejection first, independent measurement of survivors and Pareto selection. Stops on budget, plateau, regression or ambiguous execution. | E3 §11; E2 §6; W pp. 9–10 | In the lab a campaign is a pre-registered measurement run with a hashed precommit [Lab `docs/LAB-DESIGN.md`]. |
| Candidate | An exact proposed implementation or configuration against a task contract. In E3: a pure WebAssembly kernel plus declarative glue. | E2 §3 (as workpiece); E3 §5 | W: generated TypeScript emitted as JavaScript [W p.4]. |
| Candidate / provenance identity | The identity recording a proposal and its lineage, distinct from build and artifact identity. | E2 §10 | E2 only. |
| Capability | Working behaviour supplied to a person or agent: a function, tool, transformation, parser, workflow, simulation component or small application. | E2 opening passage; E3 §1 | — |
| Capability contract | What an operation means: schemas, required behaviour, declared capabilities, applicability, known failure cases. The unit people retrieve and compose, and with a checkpoint the portable unit across lanes. | E3 §12, §13; E2 §9 | W: "a capsule plus a capability contract" is the common interface [W p.5]. E3 makes the contract layer, not the code, the asset. |
| Capsule (software capsule) | Immutable code plus schemas, dependency identities, capability requirements, tests and provenance. | W p.3, p.20 | E3 uses "one-use capsule" only in the break-even passage [E3 §11]; its unit is the capability contract plus implementations. |
| Checkpoint | Durable state that lets a capability and compatible application state be restored on any lane; never a live heap. | E2 §13; E3 §13; W p.21 | Same across editions. |
| Child V8 isolate | An execution topology in which candidate JavaScript runs in a separate V8 isolate (for example a Dynamic Worker), moving the trust boundary rather than preserving one-isolate locality. | A sheet 4; E2 §8 | E3: the compatibility lane executes in a child V8 isolate [E3 §5]. |
| Claim ladder | Ordered claims, each with its own kind of evidence: embedding, execution, specification, task, optimization, lifetime economics, recursive engineering. No rung stands in for the one above. | E2 §14; E3 §17 | E2 has six rungs; E3 inserts "specification" (rung 3) for seven. |
| Cohort | A group of isolates or attempts sharing one process and therefore its failure, memory pressure and side channels. Partitioned by trust, authority, memory budget and acceptable shared failure. | W p.15; A sheet 18; E3 §9 | E3 adds side channels and different processes per trust level [E3 §13]. |
| Compatibility lane | A named route for imported code or behaviour that does not fit the strict path; in E3, TypeScript → JavaScript via tsc-rs, executed in a child V8 isolate. | E2 §4; E3 §5 | E2: any route still needing an external build per candidate. E3: a specific route. |
| Composable request | Request class satisfiable by retrieval, binding and contract check with no generation; 0.5–2 s (**Estimated**). | E3 §10 | New in E3. |
| Conditional publication | Publication of a mutable reference only by a conditional update; losing the race does not activate the candidate. | E2 §10 [M §7] | E2 only. |
| Confirmed (residual rule) | The person sees "here is what will be checked" and approves it before the campaign starts. For the agent substrate the confirming party is the agent's task contract. | E3 §6 | New in E3. Also the name of the lowest autonomy tier. |
| Context separation | Trust-boundary property: whether a checker shares the prior of the thing it checks. | E3 §7, §8 | New in E3. |
| Correlated error | The same model reading a request the same wrong way and producing a test and a candidate that agree with each other. | E3 §6 | New in E3. |
| Counterexample | A rejected candidate's evidence that narrows future search; kept as a constraint. | E2 §7; E3 §12 | E3 counts counterexamples among the compounding assets. |
| Derivation (on demand) | Generating a representation from canonical records only when the next step needs it. | E2 §10 [M §3] | E2 only. |
| Derived | Evidence label: arithmetic from stated values. | E3 §2; W p.3 | Same meaning in W, Lab and E3. |
| Discovery loop | The improvement loop that changes proposal strategy, model routing, context, repair feedback, candidate diversity and stopping rules, without changing the evaluator or budget accounting. | E3 §11; E2 §6 ("improve the production process") | E2 calls it the process loop. |
| Domain invariants | The second acceptance layer: properties fixed per domain and composed per task (dimensional consistency, source-bound return, no cross-room mutation, round-trip and idempotence, reconciliation of totals). Authored offline and qualified once. | E3 §6 | New in E3. |
| Durable lifetime | State whose loss is loss of truth: task identity, admitted inputs, the frozen evaluator, kept candidates, accepted artifacts, receipts, state that must survive restart. Persist before any reference points at it. | E3 §9; W p.6; A sheet 7 | E3 adds the frozen evaluator. |
| Enabler | E3's classification of the RAM-resident in-isolate workcell: a means to change-proportional work and cheap trusted proposals, not the idea itself. | E3 §1, §2 | E2 called the workcell the production core [E2 §15]. |
| Escape rate | Seeded faults promoted divided by seeded faults submitted, through the full harness. **Sampled** escape rate is measured on randomly drawn candidates; **searched** escape rate inside an optimizing campaign (X3 uses a sixteen-wide campaign). Tiers use the searched rate. | E3 §7, §11, §15 | New in E3. |
| Estimated | Evidence label: an order-of-magnitude figure reasoned from public data, not measured here. | E3 §2 | New label in E3. W and the lab have no equivalent. |
| Evaluation attempt | The identity naming one observation of an artifact under given inputs and environment. | E2 §10 | — |
| Evaluation receipt | Record of exact evaluator and fixtures, host metrics, seed, warm or cold mode, gates, repeated samples, quality evidence and complete cost. | W p.20 | E3: POODO's precommit record is "the evaluation receipt of this design" [E3 §8]. |
| Evaluator | The protected component that decides acceptance; outside candidate control. In E3, synthesized per task from the three acceptance layers, frozen and qualified. | W p.10; E3 §6 | W/E2: an independent, fixed oracle. E3: synthesized per task with fixed lower layers. |
| Fence | A durable marker that prevents future work from a possibly-executed attempt during recovery. | A sheets 21–22; E3 §9 | — |
| Finishing | Deeper engineering of a capability that has justified the investment (a keeper's refinement route). | E2 §3 | — |
| Fixed reference | A stable comparison point, besides the incumbent, so a chain of small tolerated regressions cannot accumulate unnoticed. | E2 §6; E3 §11; E2 §15 | Same in E2 and E3. |
| Frontier | The bounded set of an incumbent plus diverse parents and evaluated candidates; selection keeps a Pareto frontier rather than one score. | A sheet 10; E3 §11 | W: "archive" and "select_diverse_parents" [W p.10]. |
| Frozen | The second residual rule: the evaluator's hash enters the ledger before evaluation begins; revision only on evidence independent of any candidate's outcome. | E3 §6 | E3 §10: frozen before evaluation, not before generation. |
| G = 0 | Lab scope label: no model calls; candidates come from deterministic seeded mutations. | Lab `docs/LAB-DESIGN.md`, `docs/PREDICTIONS.md` | Lab only. |
| Generative applications | The second product: an application that grows new capabilities on request inside a stable interface. Evaluator synthesized per request; trust required is maximal; dominant cost is specification and review. | E3 §3 | New framing in E3. E2 "Generative applications" was one expression of the substrate [E2 §13]. |
| Generative UI | Generated working presentation and behaviour, executed by normal code after generation. | W p.3 | E3 subsumes it under generative applications; presentation becomes glue as data [E3 §5]. |
| Glue | The declarative part of a candidate: a view specification over the host's registered components, data and action bindings naming exact owners and revisions, interaction tests, and a result schema. Validated by closed schemas and rendered by the host. | E3 §5 | New in E3. Prefigured by the atlas's view specification and bindings [A sheet 12] and the lab's "instruments are data" rule [Lab `docs/UI-HILLCLIMB.md`]. |
| Harness | The checking machinery around candidates; in E3 the unit of trust. Its trustworthiness is the number of independent error sources it has. | E3 §7 | W/A: the "trusted harness", "not generated" [A sheet 3]. E3: may be model-written under three boundaries [E3 §8]. |
| Hill climbing | Iterative candidate selection against declared objectives, with gates, holdouts and diversity. | W p.3, p.9 | E3 uses "search" and "campaign". |
| Holdout | Fixtures withheld from candidates for confirmation. Repeated scoring on the same holdout adapts the search to it. | W p.9–10; E2 §6; E3 §11 | Same across editions. |
| Incumbent | The currently accepted version, kept in service and pinned while a challenger is qualified. | W p.9; E3 §4, §11 | Same across editions. |
| Independent error source | A class of check whose errors are independent of the model's reading of intent: deterministic tooling, offline-qualified invariants, existing implementations, seeded faults, the person. The candidate-blind model is only partly independent. | E3 §7 | New in E3. |
| Intake and contract | The first boundary: what is asked, which inputs are authoritative, what resources may be spent, which effects are permitted. Imported code is material, not authority. | E2 §2; E3 §4 | Same in both. |
| Keeper | A candidate worth retaining and possibly refining. | E2 opening passage, §3; E3 §5, §13 | E3: Rust is "keeper refinement" [E3 §5]. |
| Kernel | A WebAssembly module exporting pure functions (state in, event in, state out, effects out as data) whose declared imports are its only capabilities. | E3 §5 | New in E3. E2 mentioned "a narrow direct-WASM kernel" as one possible route [E2 §5]. |
| Kill criterion | A stop rule written before an experiment's result is known; a failed gate narrows the product, not the standard. | E3 §15 | New in E3. |
| Lane (deployment lane) | A host class implementing the portable contract under its own runtime, limits and enforcement: local and site, hosted (Cloudflare Workers), browser. | A sheet 16; E3 §13 | A: local on V8/Node/workerd. E3: local on Wasmtime. |
| Landfill (with provenance) | A library with no deprecation, deduplication or reclamation. | E3 §12; E2 §9 | E2 "landfill of unreviewed code"; E3 adds "with provenance". |
| Ledger | The durable record of identities, evidence and activation; inside the factory, not at its centre. | E2 §10; E3 §5 | E3: candidates never touch it. |
| Library | The versioned set of capability contracts, implementations, qualification records, lineage and counterexamples. | E3 §12; E2 §9 | E2: retained software is the asset. E3: the library is inventory; contracts are the asset, code the liability. |
| Lineage (tenant-bound) | Provenance that follows the data into code, templates, caches and outputs; promotion never declassifies inlined values; most user-requested capabilities cannot cross tenants. | E3 §12; W p.20; A sheet 20 | — |
| Lower-envelope model | T ≥ max(W/F, Q/B, T_critical_path, T_required_external_interaction). | E2 §11 | E3 keeps only two consequences of the physical-limits discussion [E3 §13]. |
| Machinery | Reusable compiler, runtime, dependency base, evaluator and prepared execution interface. | E2 §3 | — |
| Machinery loop | Improvement loop that changes the compiler bridge, module instantiation, caching, allocation and scheduling, isolated by replay through baseline and challenger, then live synthesis under equal budgets. | E3 §11; E2 §6 | E2 lists "virtual filesystem, memory layout" among its targets. |
| Marginal (candidate) | Lab: a candidate the frozen validator flags because some fixture took at least 1/50 of its wall budget; excluded from the primary denominator. | Lab `precampaign-fix` `docs/PREDICTIONS.md` v1.6 | Lab only. |
| Material | Admitted source, inputs, reusable capabilities and existing evidence. Imported code is material, not authority. | E2 §3; E3 §4 | — |
| Matched end-to-end campaign | The comparison of arms on identical tasks with frozen evaluators and equal budgets that would establish the full claim. | W p.22; E2 §15; E3 §15 | E3 adds the conventional-agent arm and runs it after X1–X6. |
| Meta-gates | The fixed checks a synthesized evaluator must pass (rejecting seeded faults, accepting a known-good anchor, determinism within bounds). | E3 §1, §6 | E3 uses the word in §1 and describes the content under "Qualified" in §6. |
| Model term | The latency and cost of model turns; never measured in this project's recorded evidence. | E3 §10, §15 X5 | New in E3. |
| North-star unit | Time and total resources per independently accepted useful capability; for campaigns, accepted improvement under an equal complete budget. | E2 §1; E3 §1; W p.11 | E3 calls it "the unit of success". |
| Novel and determinate request | Request class needing generation but no clarification: 20 s floor, 2–3 min realistic (**Estimated**). | E3 §10 | New in E3. |
| Observed | White paper and lab evidence label for a recorded experiment or test with a receipt. | W p.3; Lab `docs/LAB-DESIGN.md` | E3 uses **Recorded**. |
| Open-loop candidate stream | Lab: one precomputed, content-addressed candidate list fed identically to every arm. | Lab `docs/PREDICTIONS.md` | Lab only. |
| Outcome unknown | The state of an attempt that may have executed but whose completion is unproven. Recovery records it; never inferred as success or failure. | A sheets 21–22; E3 §9; Lab `docs/ADAPTER-CONTRACT.md` (`outcome_unknown`) | Same across sources. |
| Overlay (private overlay) | A per-candidate writable layer over a read-only base of approved material. | A sheets 3, 7; E2 §5; E3 §4 | — |
| Parity | Agreement of a checker's diagnostics (and emit) with a pinned oracle. Lab: the set of (file, line, col, code, category) matching TS7 native. E3: Microsoft's native compiler is the parity oracle for tsc-rs. | W p.13; Lab `docs/PREDICTIONS.md`; E3 §13 | — |
| Pilot | Lab: a labelled run used to estimate variance and set sample counts; pilot numbers are never reported as results. | Lab `docs/END-STATE-AND-TEST-PLAN.md` | This repository labels such numbers **Pilot (not a result)** [CONVENTIONS]. |
| Precommit | A hashed record of workload, adapters, versions, budgets, sample counts, seed and predictions made before the first measured job. E3: POODO's precommit record (observable, acceptance boundary, oracle and version, artifact identity, environment, failure meaning, stop condition). | Lab `docs/LAB-DESIGN.md`; E3 §8 | — |
| Privilege | Trust-boundary property: whether a component can change what judges it. | E3 §7, §8 | New in E3. |
| Product loop | Improvement loop that changes an accepted capability's algorithms, data structures, layout and state transitions, without changing the task contract or invariants. | E3 §11; E2 §6 | — |
| Promotion | Moving a candidate to accepted status under the promotion rule. In E3, only checks independent of the in-loop model contribute to promotion. | W p.10; E2 §6; E3 §7 | — |
| Proposed | Evidence label: intended architecture, experiment or rule; nothing establishes it yet. | E3 §2; W p.3 | Same in all. |
| Qualification (of an evaluator) | The third residual rule: the residual must reject seeded faults, accept a known-good anchor where one exists, and run deterministically within bounds. | E3 §6 | New in E3. |
| Qualification record | The record of which behaviour was tested in which environment; does not transfer across input distributions or machines. | E2 §9; E3 §12 | Same in both. |
| Recorded | Evidence label: reported by a receipt from a real run, not rerun. | E3 §2 | W/Lab use "Observed". |
| Regime | Lab: the retained-state rule for a checker. **R-stateless**: fresh program per candidate, only immutable bytes and a parsed-lib cache retained. **R-incremental**: whatever retained state the tool supports. **R-batch**: exploratory batching regime in the fast-loop work. | Lab `docs/PREDICTIONS.md`; `isolate-factory-lab-wt/fastloop/docs/FASTLOOP.md` | Lab only. |
| Representative | Lab: the single variant declared in advance to stand for an arm, to prevent picking the best variant after seeing data. | Lab `docs/PREDICTIONS.md` | Lab only. |
| Resolved source identity | The identity naming the effective source and dependency state. | E2 §10 | — |
| Rival framing | POODO's step that names the strongest alternative framing; in E3 it seeds diverse candidates so parallel candidates fail independently. | E3 §8, §10 | New in E3. |
| Route | A path from source into the candidate contract (AssemblyScript, MoonBit, Rust, TypeScript → JavaScript, pre-built WASM). | E2 §4; E3 §5 | E2: adapter families including Python and Javy. E3: five routes with roles. |
| Scrap and reclamation | Freeing the storage of discarded candidates; discarding a name is not freeing bytes. | E2 §3 | — |
| Seeded fault | A known fault injected to test the harness (swapped units, dropped rows, off-by-one, reversed inputs, wrong join rule, stale source binding). | E3 §6, §7 | Lab calibration C6 uses the same idea (evaluator mutation testing) [Lab `docs/END-STATE-AND-TEST-PLAN.md`]. |
| Setup and changeover | Preparing tooling once and changing only the candidate and its mutable state between attempts. | E2 §3 | — |
| Specification (stage) | The second boundary of the production cycle: synthesis, qualification, freezing and confirmation of an evaluator before any candidate exists. | E3 §4, §6 | New in E3. |
| Strict in-isolate form | W's topology in which checker, virtual files and tests run in the workshop and generated JavaScript runs in a nested interpreter in the same outer isolate. | W p.14 | Superseded by the kernel contract [E3 §5]. |
| Structured change | A candidate change expressed as substituting an operation, choosing an implementation, binding a parameter or composing functions, instead of a source-text round trip. | E2 §7 | E3 "Generate less" lever [E3 §10]. |
| Swarm | A budgeted population of candidate-producing workers; not necessarily simultaneous inference. "A queue, not a pile of idle machines." | W p.3; A sheet 23; E3 §9 | — |
| Task residual | The third acceptance layer: the part of acceptance only this request determines, synthesized by the model from the request, data and examples, stated in plain language and expressed as runnable tests. Governed by four rules. | E3 §6 | New in E3. The design objective is to make it thinner every quarter. |
| Three lifetimes | Durable, warm and attempt state, each with its own rule. | W p.6; A sheet 7; E2 §8; E3 §9 | See each lifetime. |
| Time of authorship | Trust-boundary property: whether a component was authored offline and frozen, or during the task it governs. | E3 §7, §8 | New in E3. |
| Trusted base | The harness, evaluator engine and invariant library: components whose failure violates the system's guarantees, minimized rather than expanded. | E3 §7, §8 | E3 lets the model author it under three boundaries. |
| Universal gates | The first acceptance layer, fixed for every task: contract and schema validity, type and interface conformance, resource bounds, determinism, forbidden effects. Deterministic code run inside the isolate. | E3 §6 | New in E3; overlaps with the lower rungs of the atlas's evaluation ladder [A sheet 11]. |
| Upstream | Evidence label: reported by a third-party maintainer, pinned where possible. | E3 §2; W p.3 ("Upstream-reported") | — |
| Verified accept | Lab: a sample whose public accept matches the validator, matches the frozen oracle, and whose own emitted artifact passes every holdout fixture in the arm. | Lab `precampaign-fix` `docs/PREDICTIONS.md` v1.6 | Lab only. |
| Warm lifetime | Reusable, evictable state: compiled modules per route, the approved dependency base, the invariant library, read-only input caches partitioned by permission. A cache hit is never authorization. | E3 §9; W p.6; A sheets 7, 23 | E3 adds the invariant library. |
| WIT / Component Model | The typed, language-independent interface intended for values crossing the module boundary; mature in Wasmtime, polyfilled in V8 hosts. | E3 §5; E2 §4 | E2: a "relevant precedent". E3: the intended contract. |
| Workcell | The bounded, RAM-resident production cell: a pinned compiler per route, approved dependencies, a private overlay per candidate and the cheap deterministic gates. | E2 §2; E3 §4 | E2: the production core. E3: an enabler. |
| Workpiece | An exact candidate implementation or configuration against a task contract. | E2 §3 | E3 says "candidate". |
| Workshop isolate | A task- or trust-scoped execution context containing build, check and run machinery. | W p.3 | Replaced by "workcell" in E2 and E3. |
| Zero-copy | An interface property, not an architecture label: shared physical memory still needs compatible layout, ownership, synchronization and lifetime rules. | E2 §12 | — |

## Edition 3 alignment

- **What changed.** Edition 3 adds the trust and specification vocabulary (acceptance layers, task residual, escape rate, autonomy tiers, trusted base, independent error source) and the candidate vocabulary (kernel, glue). It renames the north-star unit "the unit of success" and the evidence label "Observed" becomes "Recorded"; it adds "Estimated".
- **What is superseded.** "Strict in-isolate form", the nested-guest meaning of the inner boundary, the workcell as production core, and "trusted harness" in its "not generated" sense.
- **What still holds.** The ledger identities, lifetimes, outcome unknown, fence, cohort, keeper, compatibility lane, holdout, incumbent and fixed reference.

## Open questions

- Edition 3 uses "meta-gates" once in §1 without defining them; this glossary infers the definition from §6. Should a later reference define them exactly? (R05, E3 X2.)
- Is "attempt" in Edition 3 the white paper's execution period or only the lifetime row? The sources use both senses.

## Sources

- `sources/text/Endoforge-Edition-3.txt` — §1–§17.
- `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt` — opening passage, §1–§15.
- `sources/text/In-Isolate-Software-Workshop-v1.txt` — pp. 3, 5–6, 9–11, 13–15, 20–22.
- `sources/text/Diagram-Atlas.txt` — sheets 03–04, 07, 10–12, 16–23, 28–29.
- `~/Work/isolate-factory-lab/docs/LAB-DESIGN.md`, `ADAPTER-CONTRACT.md`, `PREDICTIONS.md`, `END-STATE-AND-TEST-PLAN.md`, `UI-HILLCLIMB.md`; `~/Work/isolate-factory-lab-wt/precampaign-fix/docs/PREDICTIONS.md`; `~/Work/isolate-factory-lab-wt/fastloop/docs/FASTLOOP.md`.
