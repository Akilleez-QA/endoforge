# R07 — Persistent semantics and shared search

> Reconstructed 2026-10-17. The original R07 was not available; this version is rebuilt from
> Edition 2 (§7, §10, §15), Edition 3 (§1, §10, §12, §13, §14, §16), the white paper (pp. 4, 6, 13),
> and the isolate-factory-lab CHECKERS and FASTLOOP documents. Content follows Edition 3 where the
> editions differ.

## Purpose

Edition 3 puts the thesis first: the expensive thing is repeated understanding, not repeated compilation, and work should be proportional to the change and the newly required evidence, never to the size of the project [E3 §1]. Edition 2 §7 is where that idea is worked out. This document covers it in depth: persistent semantic state and sound invalidation, structured changes, populations that share structure, e-graphs, the line between exploration and qualification, coalescing of in-flight derivations, campaign specialisation, and the preservation of useful failure. Every mechanism here is **Proposed**. None has been built for Endoforge. Where the lab has touched one (retained compiler state, shared-program batching), its findings are reported with its own labels.

## Summary

- Warm tooling and incremental semantic analysis are separate milestones. The tsc-rs WASM interface reuses compiled machinery but creates fresh per-run analysis state, with no watch or language-service mode [E2 §7; E3 §14; W pp. 4, 13].
- Sound invalidation is the bar: incremental results must match full recomputation, including invalid programs and edits with large transitive effects. The goal is avoiding unnecessary work, not constant-time checking [E2 §7].
- Shared structure (parameter blocks, shared immutable programs, e-graphs) makes exploration cheaper, but finalists need standalone qualification. The lab found a real cross-candidate leak in shared-program checking [E2 §7; `FASTLOOP.md` §4].
- Coalescing joins identical in-flight derivations; an identity match is not permission [E2 §7].
- Campaign specialisation must amortise its own cost, and useful failures are kept as constraints [E2 §7; E3 §12].

## 1. Persistent semantic state

A small source edit often changes only a small part of what the system already knows. Edition 2 proposes a semantic graph that connects source regions, types, interfaces, executable units, dependency identities, test obligations and established properties. A change would invalidate the facts it can actually affect, and unaffected results would be reused under exact assumptions [E2 §7].

Three constraints come with it [E2 §7]:

1. **Warm is not incremental.** The original WASM compiler interface reuses compiled machinery but builds fresh analysis state per run. Fresh compiler instances still create ASTs, symbols, type graphs and output buffers [W p.4].
2. **Soundness is tested against full recomputation.** Incremental results must match a full recomputation, including invalid programs and edits with large transitive effects.
3. **Bounded retained state.** A single edit can legitimately invalidate a large closure. The proposal is to avoid unnecessary work while preserving sound invalidation and bounded retained state.

### 1.1 What the tsc-rs WASM interface supplies

Upstream documentation, carried by Edition 3: a 4.2 MB module, compile once and instantiate per check, single-threaded, no watch or language-service mode (**Upstream** [E3 §14; W p.13]). The white paper draws the engineering consequence: budget fresh type graphs and linear memory per run, and do not describe a persistent incremental language service as implemented [W p.13].

The lab adds detail, all on V8 under Node and none of it a campaign result:

- Each check is a new `WebAssembly.Instance`; one program per instance is upstream's design [`~/Work/isolate-factory-lab/docs/CHECKERS.md`].
- A second `ts_run` on a used instance is refused (it exits through `proc_exit`). An in-place memory restore leaked about 9.6 MiB per run and diverged from fresh results after run 209; with recycling every 32 runs it stayed equivalent on the tested streams, but its soundness is empirical only (**Pilot (not a result)**, [`FASTLOOP.md` §3.3]).
- About 70% of a solo check was lib parse and bind, which the WASM build has no way to retain (**Pilot (not a result)**, [`FASTLOOP.md` §3]).
- An R-incremental mode does exist through an in-memory `.tsbuildinfo` carried between fresh instances, so tsc re-emits only affected files [`CHECKERS.md`]. On an unchanged medium project this smoke-measured 65 ms against 302 ms stateless (**Smoke (not a result)**: unpinned, no gate, the degenerate no-change case [`CHECKERS.md`]). This is build-info incrementality, not a resident semantic service.
- The module measured 5.17–5.21 MB at tsc-rs v0.7.0, not 4.2 MB; the lab notes the upstream figure was written at an earlier revision [`CHECKERS.md`]. See Edition 3 alignment.

### 1.2 What going wrong looks like

The lab's checker lane found two retained-state defects while building R-incremental modes, both caught by a forward-then-reversed leakage sequence on one long-lived handle [`CHECKERS.md`]:

- tsc-rs native API `snapshot.update()` without `openProjects` silently kept the old program, so a changed project returned the previous diagnostics.
- The WASM R-incremental mode at first returned only the re-emitted files.

Edition 3 also records upstream's documented stale-output cases under build mode and memory growth in long sessions [E3 §13]. These are exactly the failures Edition 2's rule exists for: a stale result that looks like a fresh one. **Rule (Proposed):** every incremental path ships with a differential test against full recomputation, run in forward, reversed and shuffled orders, over valid and invalid programs, and over at least one edit whose transitive closure is large.

### 1.3 Prior art

Edition 3 names Salsa and rust-analyzer, the tsserver builder and Roslyn as the lineage: change-proportional re-analysis is engineering, not research [E3 §16]. The descriptions below are background on third-party designs, from general knowledge, not reverified for this document (**Upstream**, unpinned; R18 should pin them).

| System | Mechanism relevant here | What Endoforge takes, and where it differs |
|---|---|---|
| Salsa / rust-analyzer | Memoised queries over inputs with revision tracking; a query re-validates by checking its recorded dependencies, and an unchanged result stops propagation ("early cutoff") | The model of facts as queries with recorded dependencies. Endoforge applies it to candidate families and evaluations, not only one project's semantics [E3 §16] |
| tsserver builder / `--incremental` | Per-file versions and declaration-output signatures decide which files' dependents need re-checking; state can persist as build info | The signature idea: invalidation follows interface change, not text change. The lab's stale-snapshot defect shows the API surface can still serve old results |
| Roslyn | Immutable syntax trees and solution snapshots with structural sharing between versions | Immutable shared structure as the base that private candidate edits branch from |

The difference in every row is the same: those systems serve one developer's evolving project. Endoforge would serve many concurrent hypotheses over a shared base, under trust scopes, with evidence attached to each fact.

## 2. Structured changes instead of source-text round trips

Broad intake need not make source text the only internal format. After admission, compatible candidate families can be represented as structured changes: substitute an approved operation, choose an implementation, bind a parameter, compose known functions. Human-readable source remains for review, debugging, import and export [E2 §7].

This can reduce repeated token output, parsing and syntax failures. It does not prove semantic correctness, and the factory should not force every imported language into one representation before that representation has shown value [E2 §7]. Edition 3's kernel-plus-glue shape is a partial instance: glue is already structured data validated by closed schemas [E3 §5]. Generating less is one of E3's six latency levers [E3 §10].

## 3. Populations share structure

A population is not necessarily a thousand programs [E2 §7]. Three representations, in increasing ambition:

1. **Parameter blocks.** One executable, many parameter sets. No new compilation per variant.
2. **Shared immutable structure.** One program structure retained, selected regions varied per candidate.
3. **Shared preparation of evaluation.** Common input prepared once, each candidate keeping its private state and observation identity.

The lab's shared-program regime (R-batch) is a concrete case of (2) for checking: up to 32 candidates became sibling files of one tsc program, with diagnostics and emit mapped back per candidate. It cut tsc-rs WASM CPU per candidate from 29.6 to 9.3 ms on S-medium (**Pilot (not a result)**, [`FASTLOOP.md` §2]). It also exposed a leak no one had predicted: TypeScript checkers give "Did you mean …?" suggestions for only the first 10 unresolved names per checker, so one candidate's diagnostics depended on its siblings. A reversed-order parity test found it; the fix rechecks such candidates solo. The lab reports batch equal to solo byte for byte on its streams in stream, reversed and shuffled orders, and calls the guards tested, not proven [`FASTLOOP.md` §4, §11].

That is the general hazard of shared structure in one example: a shared resource carries hidden per-consumer state.

## 4. E-graphs and equality saturation

Edition 2 identifies e-graphs and equality saturation as relevant research for representing justified equivalent alternatives [E2 §7]. An e-graph stores many equivalent expressions compactly by grouping them into equivalence classes; equality saturation applies rewrite rules until no new equivalences appear (or a budget runs out), then extracts a best member by a cost function. egg is the widely used library for this (**Upstream**, background, not reverified).

The rule Edition 2 attaches is the important part: **an equivalence must come from valid rules under the chosen semantics, not from two programs passing a few examples** [E2 §7]. Different hypotheses remain different until the required evidence supports a stronger relationship. For Endoforge that means:

- Rewrite rules are part of the trusted base: authored offline, frozen, and qualified against oracles from outside their authoring turn [E3 §8].
- Semantics must be stated, including the edge cases Edition 2 lists for behavioural equivalence: malformed records, ordering, Unicode, overflow, missing values, errors and resource limits [E2 §4]. A rule valid for mathematical integers is not valid for wrapping i32.
- Extraction by cost is a performance claim and needs measurement like any other.

## 5. Exploration versus standalone qualification

Sharing preparation makes comparison cheaper, but finalists need standalone measurement. A program must not win because it relied on another candidate doing work that will be absent after deployment [E2 §7].

**Rule (Proposed).** Exploration may share structure, caches and preparation. Qualification runs the exact promoted artifact alone, in the deployment configuration, against the frozen evaluator, with resource measurement from outside the isolate [E3 §4]. The lab's pre-campaign critique found the general form of this failure in its harness: holdout verification ran the validator's emitted code rather than each arm's own artifact, so an arm could be credited with an accept its own bytes would fail (M2) [`CRITIQUE-2026-10-14-precampaign.md`]. The lab's memory-cap finding is the resource form: a shared QuickJS instance let typed-array backing stores escape the runtime memory limit [`FASTLOOP.md` §6]. In both cases the shared configuration was not the one that would ship.

## 6. Coalescing in-flight derivations

Compatible callers should join one in-flight derivation of identical inputs instead of independently reconstructing it [E2 §7]. The Mononoke derivation interface is the warning: its default batch path is sequential in topological order, because naive concurrent recursion can repeat derivation work [E2 §7; Mononoke study §3, commit 79071c2a…, source inspection only, no build or tests run [E3 §18]].

**An identity match is not permission** [E2 §7]. Coalescing must account for configuration, source restrictions, trust scope and actual dependency identity. A content hash names bytes; it does not grant permission or prove task correctness [E2 §10; E3 §16]. Concretely:

- The coalescing key includes every build-affecting input (the build key of E2 §10), plus the trust scope and source-permission set of the requester.
- A caller may join a derivation only if it could have started that derivation itself under current permissions. Read-only input caches are partitioned by permission [E3 §9].
- A joined result is a derived result, regenerable from pinned inputs. Observations (timings, model outputs, reviewer judgements) are never coalesced; repeating one produces a new observation [E2 §10].

## 7. Campaign specialisation and partial evaluation

A campaign often fixes most of the problem: an SDK, an input schema, a family of mutations, an evaluator and an output shape. A longer-term direction is to prepare specialised machinery around those constants, through partial evaluation and campaign-specific compiler or evaluator paths, leaving only the varying work in each experiment [E2 §7]. The factory would then produce better fixtures and processing paths for the next batch, not only better workpieces.

**Amortisation (Derived form).** Specialisation pays when C_specialise + C_qualify ≤ n × (c_general − c_specialised), where n is the number of experiments in the campaign. The qualification term matters: a specialised evaluator is a new evaluator and must pass the same meta-gates (seeded faults rejected, known-good anchor accepted, determinism) before it may judge [E3 §6]. It is not automatically economical for a one-off task [E2 §7]. Retaining parsed libs (R06) is the lowest rung of this ladder: the "constant" is the lib closure, and the lab's TS6 measurements suggest it alone is worth several-fold on checker CPU (**Pilot (not a result)**, [`FASTLOOP.md` §9]).

## 8. Preserve useful failure

A rejected candidate can leave a counterexample, a known incompatibility, or a constraint that narrows future search. The model proposes a strategy and a bounded variation space; deterministic machinery explores it; reasoning returns when evidence calls for a different approach [E2 §7]. Edition 3 keeps useful failures in the library as counterexamples and constraints: a rejected candidate that revealed a wrong join rule is worth more than a tenth accepted parser [E3 §12]. Counterexamples also flow back to the specification stage, which is how later requests get cheaper [E3 §4].

The objective is more information gained per unit of work. Faster exhaustive search is not the answer to a combinatorial space [E2 §7]. R08 gives the arithmetic: 2^100 combinations at 10^12 evaluations per second is about 40 billion years (**Derived**).

## Edition 3 alignment

- **Holds:** all of E2 §7. Edition 3 promotes its premise to the first point of the thesis [E3 §1] and lists incremental computation as prior art applied to candidate families and evaluations [E3 §16].
- **Changed:** Edition 3's kernel contract makes the shared base a set of WASM modules and schemas rather than a TypeScript project, and the compatibility lane (tsc-rs) is no longer on the kernel path at all [E3 §5, §13]. Persistent semantics for the kernel routes (AssemblyScript, MoonBit, Rust) is unexamined.
- **Changed:** equivalence rules and specialised evaluators are trusted-base components, governed by authorship time, context separation and privilege [E3 §8].
- **Discrepancy:** Edition 3 carries the 4.2 MB tsc-rs WASM module size from Edition 2 without reverification [E3 §18]; the lab built 5.17–5.21 MB at v0.7.0 and could not reproduce 4.2 MB [`CHECKERS.md`].

## Open questions

- What is the smallest semantic graph that pays for itself on a real candidate stream? Needs a workload with realistic edit locality; none exists in the lab.
- Can retained semantic state be shared across tenants when the contracts are shared but data is not [E3 §12]?
- Which equivalence rules are worth qualifying first, and against what oracle?
- Does campaign specialisation survive E3's Wasmtime local lane, where the lab's V8 observations do not apply [E3 §13]?
- How is "large transitive edit" defined for the differential test? R14 should fix a workload that contains one.

## Sources

- `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt` §4, §7, §10, §15.
- `sources/text/Endoforge-Edition-3.txt` §1, §4, §5, §6, §8, §9, §10, §12, §13, §14, §16, §18.
- `sources/text/In-Isolate-Software-Workshop-v1.txt` pp. 4, 6, 13.
- `~/Work/isolate-factory-lab/docs/CHECKERS.md`.
- `~/Work/isolate-factory-lab/CRITIQUE-2026-10-14-precampaign.md` (M2).
- `~/Work/isolate-factory-lab-wt/fastloop/docs/FASTLOOP.md` (unmerged branch `feat/fastloop`).
- Mononoke study, as summarised in E2 §7 and §10 and E3 §18 (the study itself was not read for this document).
