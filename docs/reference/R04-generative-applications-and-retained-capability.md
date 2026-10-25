# R04 — Generative applications and retained capability

> Reconstructed 2026-10-17. The original R04 was not available; this version is rebuilt from
> Edition 3 (§3–§6, §9, §10, §12, §13, §17), Edition 2 (§1, §5, §9, §13), the white paper (pp. 6, 8,
> 16, 20–22), the diagram atlas (sheets 12–14, 20, 21, 29) and the isolate-factory-lab documents
> (`docs/UI-HILLCLIMB.md`, `docs/UIHILL-IMPL.md`, `docs/RENDERER.md`, `docs/LAB-DESIGN.md`).
> Content follows Edition 3 where the editions differ.

## Purpose

This document covers the second of Endoforge's two products: an application that grows new capabilities on request, inside a stable interface [E3 §3]. It sets out what the host owns and what the factory owns, walks one request through the whole system in Edition 3's terms, and explains live revision and restart. It then treats retained capabilities as inventory: what a library entry contains, why lineage binds to the tenant, how each part fares as models improve, why legibility is part of the product, and why every reuse is a fresh admission. It closes with an accurate account of the isolate-factory-lab's generative-UI hill-climb, which has pilot outputs and no campaign results. Everything here is **Proposed** unless labelled otherwise.

## Summary

- The host owns identity, rendering, components, data authority, effect approval and the event loop. The factory supplies a pure kernel plus declarative glue and never touches the renderer, broker or ledger [E3 §5; E2 §13].
- A request crosses intake, specification, workcell, qualification and the library. The person confirms in a sentence what will be checked before any candidate is judged [E3 §4, §6].
- The active version stays pinned while a replacement is qualified. Restart restores the capability from durable records, never from a guest heap [E3 §1, §9; A sheet 14].
- The library is inventory with a holding cost. Contracts, invariants, tests and counterexamples compound; retained code is the liability that comes with them [E3 §12].
- The lab built and piloted a generative-UI performance hill-climb with deterministic mutations and no model. No campaign was run and no result exists (`isolate-factory-lab/docs/UIHILL-IMPL.md`).

## 1. Host and factory responsibilities

A host supplies identity, stable components, data contracts and effect policy. Endoforge supplies task-specific behaviour and presentation definitions. The person works in a stable instrument while revisions are manufactured separately [E2 §13]. Edition 3 makes the split structural: the factory's output is a kernel and glue, and the host renders the glue and runs the event loop [E3 §5].

| Responsibility | Host | Factory |
|---|---|---|
| Identity, sessions, permissions | Owns | Never sees credentials |
| Registered component library, styling, accessibility primitives | Owns; renderer refuses unknown components, scripts and wider grants [A sheet 12] | Composes registered components through the view specification |
| Authoritative data and source bindings | Owns; supplies admitted snapshots | Binds by exact owner and revision [E3 §5] |
| Effects | Broker approves and executes; high-consequence approval stays in the host [W p.8] | Kernel emits effects as data |
| Event loop and rendering | Owns [E3 §5] | Kernel is called with state and event |
| Focus, selection, scroll, unsaved input | Owns [A sheet 14] | Declares state schema and migration |
| Active version and rollback target | Owns the guarded revision change [E3 §4] | Supplies the candidate artifact |
| Task-specific computation | Runs the kernel in a module instance | Generates, repairs and refines the kernel |
| Acceptance | Runs the frozen evaluator and the promotion rule | Cannot see or edit the evaluator |

A successful generated interface is not a screenshot or a decorative layer over another conversation. It contains real behaviour: state transitions, calculations, input checks, filtering, error handling and approved actions [E2 §1; A sheet 12]. A versioned presentation grammar covers common controls and views [W p.8]. An updated layout must not silently reinterpret a number or redirect an action to a different object [W p.8].

## 2. One request through the factory

This walk-through extends the comparison workbench of the white paper [W p.8, p.22] and Edition 2's end-to-end demonstration [E2 §5], restated in Edition 3's terms. It is a proposed demonstration, not an account of a completed experiment [E2 §5]. Each step names the boundary from R02 §9.

```mermaid
sequenceDiagram
  participant P as Person
  participant H as Host
  participant S as Specification (blind context)
  participant W as Workcell
  participant Q as Qualification
  participant L as Library
  P->>H: Compare two datasets; group, change units, explain discrepancies, show sources
  H->>L: Can composition satisfy this?
  L-->>H: Parser, unit system, table, filter exist; join rule and classifier missing
  H->>P: Which pressure basis is intended?
  P-->>H: Answers (illustrative: gauge basis)
  H->>S: Contract plus composed invariants
  S-->>P: "Here is what will be checked"
  P-->>H: Confirmed
  H->>H: Freeze evaluator hash in ledger
  H->>W: Admit: overlay over approved material
  W->>W: Candidate 1 binds an unregistered component: schema gate rejects
  W->>W: Candidate 2 merges records with distinct source identities: invariant rejects
  W->>W: Candidate 3 fixes the join logic, not the oracle
  W->>Q: Exact artifacts
  Q->>H: Pass, with receipts
  H->>P: Activated workbench
  H->>L: Versioned entry: contract, tests, lineage, counterexample
```

### Step by step

1. **The request.** A person has two datasets and asks for a workbench that compares records, allows grouping and unit changes, explains discrepancies, and shows the source of each displayed result. The host already owns the datasets and the person's identity. It provides an admitted snapshot, its registered components, allowed operations and a versioned task contract [E2 §5].

2. **Composition first.** Before generating anything, the system checks whether existing capabilities can satisfy the request. A known parser, unit system, table and filter may already cover most of it. The missing behaviour might be only a join rule and a discrepancy classifier. The system creates that, not a UI framework [E2 §5]. Edition 3 estimates that a fully composable request takes 0.5–2 s, with no generation at all (**Estimated**) [E3 §10]. It also notes that retrieval is semantic search, which means a model call with the same latency and trust properties as any other [E3 §12].

3. **Intake: ask for the missing fact.** If the sources do not establish which pressure basis or unit interpretation is intended, no compilation will supply it. The host asks, or represents the uncertainty explicitly [E2 §5; E3 §4]. Edition 3 calls this the ambiguous class: everything else plus one human round trip, about 30 s if the person is present and hours if not (**Estimated**) [E3 §10].

4. **Specification (new in Edition 3).** Before any candidate exists, an evaluator is built [E3 §4, §6]:
   - *Universal gates:* glue schema validity, interface conformance, resource bounds, determinism, forbidden effects.
   - *Domain invariants, composed:* dimensional consistency, source-bound return, no cross-room mutation, reconciliation of totals. Field OS already holds several [E3 §6].
   - *Task residual:* the join rule and the discrepancy classifier's expected behaviour. A model synthesizes it in a context that has seen no candidate. Where possible its authority comes from the person's own examples, the data, differential tests against an existing implementation, or metamorphic relations [E3 §6].
   - *Qualification:* it must reject seeded faults (swapped units, dropped rows, off-by-one, reversed inputs) and accept a known-good anchor where one exists [E3 §6].
   - *Freeze and confirm:* its hash enters the ledger, and the person sees "here is what will be checked" and approves it [E3 §6].

   Generation may start concurrently in another blind context. Only evaluation waits for the freeze [E3 §10].

5. **Workcell.** The candidate is a kernel (join and classify as pure functions over state and events) plus glue (a view over registered table and filter components, bindings to the two admitted sources by owner and revision, interaction tests, and a result schema) [E3 §5]. Edition 2's first failure was a call to a nonexistent SDK method, rejected before a full renderer test [E2 §5]. In Edition 3's shape the equivalent is glue naming an unregistered component, or a kernel importing an undeclared capability: the closed-schema or interface gate rejects it. The repaired candidate passes those gates, but a behaviour check finds that it merges two records with distinct source identities. The repair changes the join logic, not the acceptance oracle [E2 §5]. No branch, checkout, container or deployment is created per repair [E2 §5].

6. **Qualification and first use.** The survivor leaves the workcell as an exact artifact. It meets the frozen evaluator, resource measurement from outside the isolate, and the promotion rule [E3 §4]. The host preserves the executable closure and receipts, rechecks permissions, and activates under an expected revision [E2 §5]. The person can now filter rows, change units, inspect sources and regroup results through working code. Those interactions do not each need a model turn [E2 §5].

7. **Library.** The accepted capability becomes a versioned entry with contract, tests, applicability and lineage. The counterexample that revealed the wrong join rule is kept [E3 §4, §12; E2 §5].

### Changes from Edition 2's walk-through

- Edition 2 allowed admitting "an existing Python routine through a compatible prepared adapter" [E2 §5]. Edition 3 has no Python route. A Python routine could enter only as pre-built WASM after admission and qualification [E3 §5]; R03 §3.
- Edition 2 had no specification stage. Its evaluator was simply "independent" [E2 §5]. Edition 3 makes the evaluator a produced, qualified, frozen and confirmed object [E3 §6].
- Edition 2's "checked TypeScript route" is now the compatibility lane, not the default [E3 §5].

## 3. Live revision with state preservation

The person asks for a sensitivity view. The current workbench stays pinned and usable. Endoforge builds a new candidate with the extra behaviour and a compatible state migration [E2 §5]. The point is not to animate the search. It is to let the application gain a capability without making the experience unstable [E2 §5].

The atlas gives the release rules [A sheet 14]:

| Active version (pinned) | Shadow candidate |
|---|---|
| Stable instance identity; inputs, focus, selection, scroll, unsaved edits and source binding owned by the host | Generated, checked and simulated off-screen; no mutation of active state; no live layout churn |
| Actions target an expected version. Each event carries view ID, revision and schema. Stale events never silently target a new UI | State migration validated: schema version plus a deterministic migration; destructive or incompatible changes refused |
| Rollback target retained: prior bundle plus a compatible state snapshot; in-flight effects need reconciliation | Atomic activation at a safe boundary; permissions and source context rechecked; focus and inputs preserved or confirmation required |

Edition 3's kernel shape makes these rules easier to meet. State is explicit and owned by the host. The kernel is a pure function of state and event. So a migration is itself a pure function from the old state schema to the new one, testable before activation. The host can replay recorded events through the shadow kernel and compare. Activation is a guarded revision change: the incumbent stays pinned until the replacement can take over without losing state, focus or authority [E3 §4].

UI improvement still needs a real renderer test. Structural schema validity cannot establish legibility, navigation, responsiveness or task completion [W p.8]. A candidate may be better because it exposes fewer misleading options, not because it renders more components [W p.8].

## 4. Restart from durable records

At restart the host restores the selected capability and compatible application state from durable records. It does not require the original guest heap to survive [E2 §5]. Edition 3's durable lifetime holds task identity, admitted inputs, the frozen evaluator, kept candidates, accepted artifacts, receipts and application state that must survive restart. The rule is persist before any reference points at it, and never a live promise or a guest heap [E3 §9].

Three consequences follow.

1. **UI state belongs to the host.** UI state that must survive restart lives in the host's versioned state model, not only in a guest heap [W p.6].
2. **Outcome unknown is a state.** An attempt authorized before a crash may have executed. Recovery fences future work, verifies the exact owned closure, and records ambiguity rather than inferring success from leftover output [E3 §9; A sheets 21–22]. Field OS recorded five Linux recovery methods across six controller trials in 9.081 s, with every ambiguous case recorded as unknown and none as success (**Recorded**, W3/W4 receipt) [E3 §14].
3. **Restart is a fresh admission.** Resumption revalidates source scope, context, policy, deadline and runtime [E3 §9].

The white paper's most informative demonstration ends with the capability surviving restart and staying useful offline where its dependencies allow [W p.22]. Edition 3's claim ladder places "a generated capability completes a real person's real task" at rung 4, status "not yet; no generative UI has been qualified with a user" [E3 §17].

## 5. The library is inventory

The long-term library matters more than the number of disposable candidates [E2 §9]. It is explicit procedural memory outside the model's weights; a successful task can make the next one cheaper without changing the model [E2 §9]. That is an architectural opportunity, not a demonstrated learning curve [E2 §9].

Edition 3 corrects the metaphor. Inventory costs money to hold [E3 §12]. Every retained capability carries:

- maintenance against SDK and host churn;
- re-qualification whenever an evaluator or invariant changes;
- security review;
- retrieval cost, where retrieval is itself a model call [E3 §12].

A library with no deprecation, deduplication or reclamation mechanism is "a landfill with provenance" [E3 §12].

### What an entry contains

The library is structured around what compounds [E3 §12]. The five parts must not collapse into one record [E2 §9].

| Part | What it is | Rule |
|---|---|---|
| **Capability contract** | What an operation means: schemas, required behaviour, declared capabilities, applicability, known failure cases | The unit people retrieve and compose |
| **Implementation** | An exact artifact under the contract, with its own identity, evidence and resource profile | Several may coexist: low-startup, direct-WASM, bounded fallback, compatibility-lane. A Rust rewrite is one refinement among several (R03 §9) |
| **Qualification record** | Which behaviour was tested in which environment | Does not transfer. A capability efficient for one input distribution or machine is not ranked universally |
| **Lineage** | Where the inputs, authoring context and data came from | Follows the data. Promotion never declassifies what was inlined |
| **Counterexamples** | Useful failures: constraints that narrow future search | "A rejected candidate that revealed a wrong join rule is worth more than a tenth accepted parser" [E3 §12] |

Sources: [E3 §12; E2 §9; A sheets 20, 29].

### Lifecycle

The atlas's promotion path runs candidate → evaluated artifact → reviewed package → active version [A sheet 29]. Packages are versioned and never silently overwritten [A sheet 29]. Revocation disables future admission, reconciles active effects, and retains historical receipts and evidence [A sheet 29]. Edition 3 adds retirement: when a host contract changes, a capability with no passing qualification against the current host is retired, not quietly kept [E3 §13]. Contracts are versioned and migrations are explicit [E3 §13].

### Where compounding happens

Every accepted capability adds to the domain-invariant layer of the specification subsystem [E3 §6]. That is why Edition 3 calls contracts and tests the compounding asset, and why the library's feedback path goes to the next request's evaluator rather than its code [E3 §4, §12]. The design goal is to make the task residual thinner every quarter [E3 §6].

## 6. Tenant-bound lineage

Generated source can embed confidential values [W p.20; E2 §9]. A template should be split into data-free logic and scoped inputs where possible. Promotion never declassifies what was inlined. Every reuse is a fresh admission under current permissions [E3 §12; A sheet 20].

Edition 3 draws the commercial consequence. Most user-requested capabilities cannot be shared across tenants, so compounding happens per tenant, unless the shared thing is the contracts and invariants, which carry no customer data [E3 §12]. That is another reason the contract layer, not the code layer, is the asset [E3 §12].

Retained capabilities are also a named injection risk. Data seen at generation time can shape code that later runs on other data, and a promoted keeper is a durable place for that to hide [E3 §13]. The mitigations are review, lineage that follows the data, and re-admission on every reuse. None scales for free, which is why Edition 3 calls review throughput "the binding constraint of the whole design" [E3 §13].

**Proposed** lineage rules for library entries:

1. Each entry records the transitive input and authoring scope: which tenant, which sources, which prompts or examples [A sheet 20].
2. An entry whose implementation inlines tenant data is tenant-bound; it is never retrievable by another tenant.
3. A contract or invariant may cross tenants only if it was authored or reviewed as data-free, and its own lineage says so.
4. Retrieval results are filtered by current permissions before any model sees them.

## 7. How each part fares as models improve

Edition 3 asks every plan-phase design to say how each part fares as models improve, because the answer is not uniform [E3 §12].

| Component | As models improve | Why |
|---|---|---|
| Evaluation plane and harness | More valuable | More untrusted output to check; more autonomy to contain |
| Substrate: density, locality, bounded execution | More valuable | More candidates per budget; more experiments per request |
| Invariant and contract library | More valuable | It is what the synthesized residual shrinks against |
| Retained code | Less valuable | Regeneration gets cheaper; retrieval plus adaptation plus re-qualification must beat it |
| In-isolate locality as a headline | Roughly neutral | Its term in the budget is already small |

Source: [E3 §12]. All entries are **Proposed** judgements.

This table drives Edition 3's experiment order: evaluation plane, then substrate, then library, close to the reverse of Edition 2's emphasis on the workcell [E3 §12]. For the library it implies a retention test (**Proposed**). Keep code only where expected reuse × (regeneration cost − retrieval, adaptation and re-qualification cost) exceeds the holding cost. Keep contracts, invariants and counterexamples by default, subject to deduplication. No part of this test has been measured; rung 6 of the claim ladder ("retained capabilities make later requests cheaper over months of use") is "not yet; the library does not exist" [E3 §17].

## 8. Legibility

Trust in software comes from predictability. A person learns a tool once and it does the same thing for everyone [E3 §12]. Manufactured software is new every time, for every person, with no documentation, no community and no support path when it breaks in six months [E3 §12]. The only answer that scales is that a capability is explained by its contract and its evidence, shown in the same plain language the person confirmed before the campaign [E3 §12].

Legibility is part of the latency, not a separate concern. The person is on the happy path only when the delivered capability needs no explanation [E3 §10]. The white paper made it a stop condition: narrow the approach if users cannot reliably understand the generated result [W p.22].

**Proposed** minimum for every activated capability:

- the confirmed plain-language sentence of what was checked;
- the sources each displayed value is bound to, inspectable in place [A sheet 12];
- what changed from the previous version, in the same language;
- the known failure cases from the contract;
- the qualification scope: which data and which environment.

**What the X1 pilot's persona review measured (2026-10-17; Pilot (not a registered result); `campaigns/x1-spec-study/receipt/persona-review-summary.md`, L-13, L-14).** Ten named personas, 2–3 per capability, ran the 19 gated kernels on their usage examples and persona-realistic edge inputs (155 calls). Of 41 verdicts, 14 accepted as returned, 25 accepted with one named change and 2 rejected; after re-runs of the two, 16 / 24 / 1. Only 3 of 19 were accepted by every persona. None of the findings was arithmetic: the rejections were a wrong default (an unsafe equipment class for an A3 charge limit) and a wrong question (a cost formula for a price the kernel cannot hold), and the five cross-cutting findings were presentation: trap codes need a message saying why and what to supply; the assumption must print with every answer; numbers need field precision and a unit; every boolean and integer code needs a label; one kernel per quantity. Two things follow for this section:

- **Legibility is a property of the glue, and it is gateable.** The five rules were written as a closed schema and a gate (G7) on the declarative glue, and 17 of 17 gated kernels received glue from their contracts with no kernel edit and every kernel hash intact. The minimum list above is therefore enforced before promotion, not reviewed after it (WP29, now on the critical path; `EXECUTION-PLAN.md`).
- **The question is part of the explanation.** Every pilot contract recorded an assumption and the one question that would remove it (20 of 20 underdetermined). A capability is legible only if it prints both: the person must be able to see which fact was assumed and what to answer to change it. Promotion means gated **and** persona-accepted (WP28); a gated capability a persona rejects is not offered to a person, and the honest outcome for a question no kernel can answer (CC-011: a price) is a binding in the host, not a kernel.

Persona review is a proxy: one agent, backfilled per capability, no person. It found a class of defect the gates cannot (wrong default, wrong question, unusable presentation), which is the reason it is a stage and not a secondary; it does not move rung 4.

## 9. Reuse is a fresh admission

Every reuse is a new admitted request: current grants, exact context, selected runtime, a new attempt and fresh mutable state. Previous review is not blanket permission [A sheet 29; E3 §12]. A hash names bytes; it does not grant permission or prove task correctness [E3 §16; E2 §10]. A cache hit is never authorization [E3 §9].

Reuse also inherits the qualification record's scope. A capability qualified on one input distribution or machine needs re-qualification before it is relied on elsewhere [E3 §12]. When an evaluator or invariant changes, the entries that depend on it are re-qualified or retired [E3 §12, §13].

## 10. What the lab attempted: the uihill generative-UI hill-climb

The isolate-factory-lab (14 Oct 2026) built a pipeline for a generative-UI performance hill-climb. Its documents describe a precommit and an implementation. They report development pilot outputs only, and the lab labels them as such: "Every number in this file comes from a development pilot. None of them is a result." (`isolate-factory-lab/docs/UIHILL-IMPL.md`). The lab's `receipts/` directory holds no uihill campaign receipts. Nothing below is a result.

### What it was designed to test

The precommit (`docs/UI-HILLCLIMB.md`, v0 to v3, all amended before any run) searches typed instrument definitions to minimise rendered interaction cost on a frozen task:

- **Candidate.** An instrument is data (component tree, bindings, reducer, layout parameters) interpreted by a fixed, trusted component library. It is never arbitrary DOM code (`docs/RENDERER.md`). The reducer is generated TypeScript, bound to the instrument by the digest of its emitted JavaScript, and run only in a sandboxed QuickJS worker guest (`docs/UIHILL-IMPL.md` §1).
- **Hard gates, cheap to expensive.** Schema; in-process TypeScript 6.0.3 typecheck plus digest identity; visible and hidden reducer fixtures in a fresh QuickJS guest; then rendered gates on survivors: hidden-data values, zero serious or critical axe-core violations, keyboard journeys, overflow, stable IDs across replacement, loading and error states.
- **Objective.** After v3, holdout p95 total interaction CPU (main-thread plus worker busy time), with a hard latency guard of one frame (16.7 ms) over the seed. v2 and v3 changed the metric after pre-run sensor findings: input-to-paint was quantised to the 60 Hz frame, and a main-thread-only metric would score off-thread worker time as cheaper while users waited longer.
- **Search.** Seeded deterministic mutations in six families (component substitution, windowing, memoisation, batching, layout simplification, lazy sections). No LLM: G = 0. No operator touches the reducer.
- **Controls.** A frozen evaluator by digest; a holdout with different data size, viewport and journey; an expert-written baseline as a fixed rival; an unchanged control re-measured every generation to detect drift; five predictions U1–U5 with stated contradiction conditions.

### What happened (Pilot (not a result))

All figures from `docs/UIHILL-IMPL.md` §2, on a shared desktop with the quiet-machine gate recorded but not enforced.

- **Evaluator self-test (C6).** 29 of 29 injected bad candidates rejected at the expected gate, and 3 of 3 positive controls passed. Earlier runs reached 22 of 24; both misses were defects in the injected cases, not the evaluator.
- **Open loop.** 10 unique mutants. The cheap gates rejected 0, because every operator was definition-level (limitation L3). Throughput was about 0.03 candidates per second through the full pipeline.
- **Adaptive search.** Stopped after one generation on the U5 drift guard (`failed_with_test_concern`): the unchanged control drifted 15.5% on the shared desktop. The guard fired as designed.
- **Holdout.** Two blocks, which the document calls underpowered with a meaningless interval. The selected elite virtualised one of two tables. The expert baseline virtualised both and memoised derived data, and was far cheaper than the elite.

The lab's own reading: the pipeline ran end to end, and on a tiny budget the search found a partial version of the obvious fix. Only the campaign could decide between search and the rival hypothesis. Blockers B1–B3 (three instrument formats and two overlapping evaluators; no main-thread reducer variant; sensor window versus slow candidates) were open when the work stopped.

### How it relates to Edition 3

| Aspect of uihill | Edition 3 position |
|---|---|
| Instrument as data, rendered by a trusted library with no `eval` or `innerHTML` | Matches the declarative glue of E3 §5. A working precursor. |
| Reducer as generated TypeScript run as JavaScript in a QuickJS guest | Exactly the layer Edition 3 removes. Under E3 §5 the reducer is a WASM kernel. |
| G = 0 deterministic mutations | Exercises the product loop's mechanics [E3 §11]. Says nothing about model generation, evaluator synthesis or escape rate under a model. |
| C6 evaluator self-test with injected faults | The same idea as E3 §6's qualification rule and §7's seeded faults. But it tests a hand-built evaluator, not a synthesized residual. |
| Expert baseline as fixed rival; drift control; holdout | Consistent with E3 §11's search controls. |

So uihill supports none of the claim-ladder rungs. It is a tested pipeline and a set of design lessons. Two of those lessons carry into Endoforge directly: gate savings depend on the operator mix (R02 §5), and an interaction metric must count off-thread work or it rewards hiding cost.

### A source mismatch

The lab's documents cite "report §9–§10" and "§19, the decisive benchmark" of `reference/Isolate_Software_Factory/`. That reference is *The In-Isolate Software Factory*, version 1.0, 14 October 2026, a 33-page edition (`isolate-factory-lab/reference/Isolate_Software_Factory/README.md`). It is a different document from the 25-page white paper in `sources/` (*The In-Isolate Software Workshop*), with different section numbering. Lab section references cannot be mapped to [W] pages without that document. R18 should register it as a separate source.

## Edition 3 alignment

- **Changed.** Generative applications are a separate product with their own evidence bar: real users completing real tasks at lower total cost than the alternative [E3 §3]. Added 2026-10-17: the product of a request is a capability plus its recorded question (the pilot found every small request underdetermined), and promotion requires a persona-level acceptance beyond the gates (§8); Edition 4 should make both explicit (`docs/execution/CRITIQUE-2026-10-17-reconcile.md`). A specification stage precedes the workcell [E3 §4]. The behaviour module becomes a WASM kernel [E3 §5]. The library becomes inventory with a holding cost, and retained code is expected to lose value as models improve [E3 §12].
- **Superseded.** Edition 2's framing of retained software as simply "the compounding asset" [E2 §9]. Edition 3 narrows that to contracts, invariants, tests and counterexamples [E3 §12]. Also superseded: the Python adapter in the walk-through [E2 §5] and QuickJS-hosted behaviour [A sheet 12].
- **Still holds.** The host/factory split, the pinned-active-version release model [A sheet 14], restart from durable records, the separation of contract, artifact and qualification record [E2 §9], data-free templates, and reuse as fresh admission [A sheet 29].

## Open questions

| Question | What would settle it |
|---|---|
| Can a request at the "too small for a project" scale be specified in under ten minutes, and how thin is the residual? | E3 X1. |
| Does a generated capability complete a real person's real task? | Claim-ladder rung 4: a qualified generative interface used by a real person. No experiment in E3 §15 targets it directly; the matched end-to-end campaign (R14) should include it. Path open since 2026-10-17: 19 gated kernels delivered to refrigeration-ai (unmerged); one technician's consented, hashed-task use of a promoted one (DP-4). |
| Is a persona agent's acceptance a usable proxy for the person's confirmation, and how often does it disagree with the gates? | Measured once: 1 reject in 41 verdicts after re-runs, 2 in 41 before; 16 of 19 gated capabilities needed a change. A registered C02 grading of the same contracts, and the rung-4 attempt, would say whether the proxy predicts the person. |
| Does the library make later requests cheaper over months, net of holding cost? | Claim-ladder rung 6; needs a library in use. |
| Which contracts and invariants can be shared across tenants without leaking data? | A review rule in R16; no source settles it. |
| Can state migration be checked automatically for kernel revisions by replaying recorded events? | A focused test once a kernel route exists (after E3 X4). |
| Who owns acceptance for the lab's UI campaign (blocker B1)? | A lab decision. Under Edition 3 the reducer slot would become a WASM kernel first. |

## Sources

- Edition 3: `sources/text/Endoforge-Edition-3.txt`, §1, §3, §4, §5, §6, §9, §10, §12, §13, §14, §16, §17.
- Edition 2: `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt`, §1, §5, §9, §10, §13.
- White paper: `sources/text/In-Isolate-Software-Workshop-v1.txt`, pp. 6, 8, 20, 22.
- `campaigns/x1-spec-study/receipt/{persona-review-summary.md,factory-summary.json,notes.md}` (Pilot (not a registered result)); `docs/execution/LESSONS-LOG.md` L-11, L-13, L-14; `docs/execution/WORK-PACKAGES.md` WP28, WP29.
- Diagram atlas: `sources/text/Diagram-Atlas.txt`, sheets 12, 14, 20, 21, 22, 29.
- Lab: `~/Work/isolate-factory-lab/docs/UI-HILLCLIMB.md` (precommit v0–v3), `~/Work/isolate-factory-lab/docs/UIHILL-IMPL.md` (implementation, pilot outputs, blockers), `~/Work/isolate-factory-lab/docs/RENDERER.md` (instrument contract), `~/Work/isolate-factory-lab/docs/LAB-DESIGN.md` (arms and evidence discipline), `~/Work/isolate-factory-lab/reference/Isolate_Software_Factory/README.md`, `~/Work/isolate-factory-lab/receipts/` (inspected; no uihill receipts).
