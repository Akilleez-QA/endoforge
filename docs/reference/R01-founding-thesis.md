# R01 — Founding thesis

> Reconstructed 2026-10-17. The original R01 was not available; this version is rebuilt from
> Edition 3 (§1–§3, §10, §12, §16–§17), Edition 2 (§1–§2, §13–§15, opening passage), the white
> paper (pp. 1–2, 7, 11, 22–23) and the diagram atlas (sheets 01–02, 15, 30). Content follows
> Edition 3 where the editions differ.

## Purpose

This document states what Endoforge is for, in the order Edition 3 gives it. It also says which of the two products a claim belongs to, what the unit of success is, how the system should feel to the person using it, and what Endoforge is not. Every later reference document assumes these definitions. Nothing here is a result. The proposition is **Proposed** throughout, and the only recorded evidence it leans on is listed in R12.

## Summary

- Endoforge makes software creation an operation that a running system performs, under rules that let the result be trusted without trusting whatever wrote it [E3 §1].
- Edition 3 reorders the thesis. The expensive thing is repeated understanding, proposals are now cheap, and the RAM-resident workcell is an enabler, not the headline [E3 §1, §2].
- There are two products on one substrate: an agent substrate and generative applications. Their economics and their evidence bars are opposite, and the plausibility of the first does not carry the second [E3 §3].
- The north-star unit is an independently accepted useful capability per unit of total cost. Tokens, isolates and checks per second explain a result; they are not the objective [E3 §1; E2 §1; W p.11].
- Field OS, TypeScript, Mononoke and unified-memory hardware are not the definition of Endoforge [E2 opening passage; E3 §3].

## 1. The proposition: software creation as a runtime operation

The white paper put the idea in one line: software creation becomes a runtime operation, through generate, type-check, execute, measure, improve and activate [W p.1]. Edition 2 widened it into a production system [E2 §1–§2]. Edition 3 restates it with trust as the central problem [E3 §1].

In Edition 3's form, a person or an agent brings a need. The runtime then does five things [E3 §1]:

1. It finds existing capabilities, imports useful code, or generates what is missing.
2. It checks, runs and measures the candidate in a bounded workcell.
3. It qualifies the candidate against an evaluator the candidate never saw.
4. It supplies a working capability.
5. Ordinary use then executes code instead of spending another model turn.

The fifth step is the economic core. A comparator, parser, mapper or interaction handler that exists as code can be called many times. The cost of reasoning and checking is spread across those calls. New reasoning is needed for new intent, not for every click [W p.7]. This is a hypothesis about whole-task cost, not a claim that model cost vanishes [W p.23].

### Why it matters

A lower marginal cost of creating software changes which problems are worth solving with software [W p.2]. Edition 2 gives the canonical example. A comparison panel may need custom grouping, unit handling, validation, source inspection and an export rule. That is too specific for a generic interface and too small to justify a conventional project [E2 §1]. Edition 3 names this the "too small for a project" scale and makes it the critical question for one of the two products [E3 §3].

The output need not be a user interface. Another agent could need a parser, a workflow a transformation, a simulation a scoring function [E2 §1]. All of these are products of the same machinery. The platform is broader than agentic coding and broader than generative UI [E2 §1; W p.2].

### What a generated capability contains

A successful generated capability contains real behaviour: state transitions, calculations, input checks, filtering, error handling and approved actions. The host still provides identity, rendering, accessible primitives, source authority and effect approval [E2 §1; W p.8]. Edition 3 makes the split structural: computation is a pure WebAssembly kernel and everything else is declarative glue that the host validates and renders [E3 §5]. R03 and R04 carry the detail.

## 2. The thesis, in the order that matters

Edition 3 gives the thesis as three ordered points [E3 §1]. The order is itself a decision, recorded as a reversal of Edition 2's emphasis [E3 §2].

| # | Thesis point (Edition 3) | Edition 2 position | What changed |
|---|---|---|---|
| 1 | The expensive thing is repeated understanding, not repeated compilation. Work should be proportional to the change and to newly required evidence, not to the size of the project. | Present, but as "the next frontier" in §7, after the workcell. | Promoted to first place. |
| 2 | Proposals are cheap. The system exists to turn cheap proposals into trusted capabilities at the lowest total cost. Total cost includes the model, repairs, evaluation, review and failures. | Implicit in the north-star unit and the improvement loops (§1, §6). | Made explicit, and tied to trust (§6–§8 of Edition 3). |
| 3 | A RAM-resident workcell inside one isolate keeps the repeated loop local. It is a means to points 1 and 2, not the idea. | The workcell was "the production core" and "the center of the design" (§2, §15). | Demoted to enabler. |

### Why the order changed

The reason is Edition 3's own time budget. For a small novel capability, the floor is about 20 seconds and a realistic run is two to three minutes. Roughly four fifths of either figure is model inference, not workcell activity. The compiler, the module instance and the local tests are one to three seconds in every scenario [E3 §10]. All of these figures are **Estimated**. No model turn has been measured in this project; Experiment 5 is the first measurement of that term [E3 §10, §15].

If the estimate holds, making the workcell faster attacks the smallest term. Edition 3 also expects the value of in-isolate locality "as a headline" to stay roughly neutral as models improve, because its term in the budget is already small [E3 §12]. Locality still matters. It is what lets an agent run many bounded experiments without an environment per attempt [E3 §3]. But it is the enabler of the thesis, not the thesis.

### What "repeated understanding" means

Repeated understanding is the work of reconstructing program meaning, task meaning or evidence that the system already had. Examples: re-analysing an unchanged dependency closure, regenerating a capability that the library already holds, re-asking a model to reason through a deterministic manipulation, re-running checks whose inputs did not change. The far-end target is "only the new behavior, only the information that must move, and only the evidence that the change invalidates" [E2 §11]. That is a research direction, not a promise of constant-time lookup [E2 §11]. R07 covers the mechanisms.

### The four commitments

Edition 3 adds four commitments that separate it from earlier editions [E3 §1]. All four are **Proposed**.

| Commitment | Meaning | Detail |
|---|---|---|
| Specification is a subsystem | Every task gets an evaluator before any candidate exists. It is composed mostly of reusable invariants, qualified against fixed meta-gates, and confirmed in plain language by a person for its novel part. | E3 §6; R02 §9 |
| Trust is a measured quantity | The harness earns trust, never the model. The measure is the escape rate of seeded faults. | E3 §7; R12, R14 |
| The candidate is a pure kernel plus declarative glue | Computation is a WebAssembly module with declared imports. Views, bindings and tests are data validated by schema. | E3 §5; R03 |
| The model writes all of the code | Including the trusted base, but never from a position where it grades its own work. | E3 §8; R02 §9 |

## 3. Two products, one substrate

Edition 3's sharpest structural change is to say that Endoforge is two products with opposite economics sharing one architecture [E3 §3]. A claim is only honest when it says which product it is about.

| | Agent substrate | Generative applications |
|---|---|---|
| What it is | A cheap, trusted iteration loop for coding agents and tool-building agents | An application that grows new capabilities on request, inside a stable interface |
| Customer | Agent developers and platform teams | End users of a host application, and the host's developers |
| Where the evaluator comes from | The agent's own task: existing tests, a fixed benchmark, a build that must pass | Synthesized per request; no evaluator exists in advance |
| Trust required | Modest: a wrong candidate fails the task visibly | Maximal: a wrong capability is promoted, retained and reused |
| Dominant cost | Model inference per iteration | Specification and review per request |
| Competitors | Warm-sandbox services, agent harnesses, snapshot-restore microVMs | Configurable software, spreadsheets, notebooks, conventional feature development |
| Horizon | Near term; measurable in weeks | Long term; depends on specification cost falling |
| Evidence bar | Accepted candidates per second per unit cost against a warm native baseline | Real users completing real tasks with manufactured capabilities, at lower total cost than the alternative |

Source: [E3 §3]. All rows are **Proposed** positioning.

### Opposite economics

The two products fail for different reasons.

- **The agent substrate is an infrastructure bet.** Its differentiators are density, locality and a harness that lets an agent run many bounded experiments without an environment per attempt [E3 §3]. The evaluator already exists, so trust is cheap. The question is cost per accepted candidate against a warm baseline. Its competitors already amortize environment setup to roughly 100 ms (Firecracker snapshot restore, E2B, Modal: **Upstream**, as characterised in E3 §16, not pinned there).
- **Generative applications are a product bet.** Their critical dependency is not the substrate. It is whether a request at the "too small for a project" scale can be turned into a checkable contract cheaply enough [E3 §3]. The evaluator does not exist and must be synthesized, qualified and confirmed. The dominant cost is specification and review, not execution.

So a fast workcell can make the first product real and leave the second unproven. Edition 3 states that "the plausibility of the first no longer carries the second" [E3 §2]. Experiment 1 (E3 X1) is the gate: if fewer than 20% of twenty real requests can be specified in under ten minutes, the agent substrate is the product and generative applications move to research [E3 §15].

### Where Field OS sits

Field OS is the applied setting and the only source of recorded evidence [E3 §3]. It exercises the agent substrate today and is the intended first host for generative applications. Its refrigeration domain, its Python authority plane and its native stack are not the definition of either product [E3 §3; E2 §13]. R12 lists exactly what its receipts establish.

## 4. The north-star unit

The unit of success has been stable across all four sources, with sharpening at each step.

| Source | Wording (paraphrased) |
|---|---|
| White paper | Time and total resources per accepted useful capability, not checks per second, isolates created or the fastest successful candidate [W p.11]. |
| Atlas | The economic unit is an independently accepted useful improvement, not a token, an isolate count or one fast type check [A sheet 15]. |
| Edition 2 | Time and total resources per independently accepted useful capability; for campaigns, accepted improvement under an equal complete budget [E2 §1]. |
| Edition 3 | An independently accepted useful capability per unit of total cost. Tokens generated, isolates created and checks per second explain a result; they are not the objective [E3 §1]. |

### The terms, defined for this library

The definitions below are **Proposed** readings, consistent with the sources. R17 should carry them as terminology.

- **Independently accepted.** Accepted by an evaluator the candidate could not see or change, frozen before evaluation began, with measurement taken from outside the candidate [E3 §4, §6]. A guest returning "accepted: true" is untrusted data, not acceptance [W p.16].
- **Useful.** For the agent substrate, the agent's task passes. For generative applications, a real person completes a real task with it [E3 §3]. Schema validity, compilation or a screenshot is not usefulness [W p.15].
- **Capability.** A behaviour supplied under a capability contract, with an implementation, qualification evidence and lineage (R04 §5).
- **Total cost.** Model inference, repairs, evaluation, specification, review, rendering, storage, rejected candidates and failures [E3 §1; E2 §6; W p.10]. The atlas writes the same idea as cost = inference + compute + I/O + review + failures [A sheet 15].

### Consequences of the unit

1. **The denominator includes specification.** Edition 3 adds a comparison arm the earlier plan lacked: a conventional agent in a warm container, measured end to end, including the time to specify. The product proposition is only confirmed against that arm, not against a cold VM [E3 §15].
2. **Failures are in the cost.** A cheaper model response is not a cheaper solution if it creates more retries. A larger swarm is not better if the accepted result is unchanged and total cost rises [E2 §6].
3. **The baseline is warm.** Comparisons are against an already-warm native or declarative baseline, not a fictional cold operating system per candidate [E2 §15; A sheet 02].
4. **Speedups do not multiply.** If checking is fraction *f* of a fixed workflow and becomes *s* times faster, total speedup is 1 / ((1 − *f*) + *f*/*s*). At *f* = 0.60 and *s* = 10 that is about 2.17×; at *f* = 0.10 it is about 1.10× (**Derived**, [W p.11]). With Edition 3's estimate that four fifths of the time is inference, a faster compiler alone cannot move the unit much.

## 5. What should feel different

The experience is part of the thesis, because a capability the person cannot predict is not on anyone's happy path, however fast it was made [E3 §12].

Edition 3 lists four experiences [E3 §1]. Edition 2 adds several [E2 §1]. Combined, and all **Proposed**:

- A person asks for a capability and confirms, in a sentence, what will be checked [E3 §1, §6].
- The person is using working software within a minute or two [E3 §1].
- They can inspect what it does, use it repeatedly, change the requirement and keep a useful version [E2 §1].
- The current version stays pinned while a better one is qualified [E3 §1]. A revision does not destroy the state of the current application [E2 §1].
- A restart restores the capability from durable records. It does not depend on a live guest heap or on repeating the original model conversation [E3 §1; E2 §1].
- A failed experiment never replaces a working version [E3 §1; E2 §1].

The ambition is not constant visible mutation. It is a stable application backed by a process that can supply new behaviour when needed [E2 §1].

### A tension in the timing promise

Edition 3 §1 says "within a minute or two". Edition 3 §10 estimates a realistic novel run at two to three minutes, a 20-second floor, and 20–25 seconds with four parallel candidates. Requests composable from the library are estimated at 0.5–2 s. Ambiguous requests add a human round trip: about 30 s if the person is present, hours if not [E3 §10]. All are **Estimated**. The §1 phrasing is therefore true only for composable requests, or for novel ones with parallel candidates and a present person. It should be read as a target, not as the typical case. This belongs in `docs/coverage/EDITION-3-ERRATA.md`.

## 6. What Endoforge is not

Edition 2 names four things that are not the definition of Endoforge [E2 opening passage]. Edition 3 keeps all four and adds explicit non-claims [E3 §16, §17].

| Not the definition | Its actual role | Edition 3 status |
|---|---|---|
| **Field OS** | An application and early evidence source [E2 §13]. | The applied setting, the only source of recorded evidence, and the intended first host for generative applications [E3 §3]. |
| **TypeScript** | An initial route [E2 opening passage]. | Demoted to the compatibility lane for imported code and behaviour that resists the kernel split. The candidate default is a WebAssembly kernel [E3 §5]. R03. |
| **Mononoke** | A source of ledger mechanisms [E2 §10]. Endoforge is not a Git replacement [E2 §10]. | Carried as a pinned source study only [E3 §18]. R10, R11. |
| **Unified-memory hardware** | A possible physical foundation, not an automatic win [E2 §12]. | Experiment 5 decides whether it is a lane or a preference [E3 §15]. R09. |

Edition 3 also says what it does not claim [E3 §17]:

- no universal speedup;
- not that the underlying primitives are new;
- not that agents or any harness rarely make mistakes;
- not that the model can be trusted at run time;
- not that a hash or a receipt is permission;
- not that in-isolate locality is the main source of value;
- not that the physical-limits discussion predicts this system's performance;
- not that any estimated number has been measured;
- not that Field OS is a released multi-tenant generative platform.

It is not a platform replacement either. The honest claim is "a trust-and-economics architecture for cheap proposals, not a new paradigm of software creation" [E3 §16]. Almost every mechanism existed before: live programming, end-user programming, search-based software engineering, content-addressed code, incremental computation, durable execution, warm sandboxes, WebAssembly runtimes, Cloudflare's runtime-created software, and object-capability security [E3 §16]. Cloudflare Code Mode, Dynamic Workers and Project Think in particular mean the project cannot claim that nobody has considered agents writing tools inside a runtime [W p.15; E2 §13].

Endoforge also does not claim unbounded self-improvement. The factory may improve its own machinery under a protected contract. That is "controlled recursive engineering" [E3 §11; E2 §6].

## 7. Where the evidence stands

Edition 3's claim ladder has seven rungs [E3 §17]. As of 17 October 2026, only rung 2 (bounded, contained, recoverable execution) has recorded evidence, and that evidence is for the previous guest adapter, not the kernel contract. Rungs 1 and 3–7 are "not yet". R12 carries the full table and the scope of every recorded number. The thesis in this document is therefore a design position whose first decisive tests are E3 X1 and X2. Edition 3 notes that those two need no engineering at all [E3 §15].

## Edition 3 alignment

- **Superseded.** Edition 2's framing of the workcell as "the production core" and "the center of the design" [E2 §2, §15]. Edition 3 calls it an enabler [E3 §1]. Edition 2's single-proposition framing, in which the generative-UI case and the agentic-coding case were "expressions of the same substrate" [E2 §13] without separate evidence bars, is replaced by two products with separate evidence bars [E3 §3].
- **Changed.** TypeScript moves from initial route to compatibility lane. QuickJS leaves the architecture [E3 §2, §5]. Trust becomes a measured quantity rather than a property of "not generated" machinery [E3 §8].
- **Still holds.** Software creation as a runtime operation; the north-star unit; the experience goals; Field OS as application; the evidence-label discipline; the refusal to claim a universal speedup or new primitives [E2 §1, §14; E3 §16–§17].

## Open questions

| Question | What would settle it |
|---|---|
| Is there a market for generative applications now, or is the agent substrate the product? | E3 X1 (specification study); kill criterion: under 20% specifiable in ten minutes. |
| How large is the trust gap for synthesized evaluators? | E3 X2 (evaluator error rate) and X3 (escape rate). |
| Is "within a minute or two" achievable for novel determinate requests? | E3 X5 (first measured model term), then the matched end-to-end campaign (R14). |
| How should review time enter the denominator when review is batched or amortised across many capabilities? | Not settled by any source. Propose a rule in R14 before the matched campaign. |
| What counts as "useful" for an agent-substrate task whose tests pass but whose output is never used? | Not settled by any source. Record as a terminology decision in R16/R17. |

## Sources

- Edition 3: `sources/text/Endoforge-Edition-3.txt`, §1, §2, §3, §5, §6, §8, §10, §11, §12, §15, §16, §17, §18.
- Edition 2: `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt`, opening passage ("The idea in one passage"), §1, §2, §6, §7, §10, §11, §12, §13, §14, §15.
- White paper: `sources/text/In-Isolate-Software-Workshop-v1.txt`, pp. 1, 2, 7, 8, 10, 11, 15, 16, 23.
- Diagram atlas: `sources/text/Diagram-Atlas.txt`, sheets 02, 15, 30.
