# R06 — Low-hanging performance reductions

> Reconstructed 2026-10-17. The original R06 was not available; this version is rebuilt from
> Edition 3 (§5, §9, §10, §14), Edition 2 (§3, §4, §8, §15), the white paper (pp. 6, 11, 13, 17),
> the diagram atlas (sheets 07, 08, 15) and the isolate-factory-lab FASTLOOP, CHECKERS, EXECUTORS
> and TESTING documents. Content follows Edition 3 where the editions differ.

## Purpose

Edition 2 says the practical route begins with low-risk reductions before anything clever: smaller generated surfaces, prepared dependencies, artifact reuse, parameterized candidates, batching, fewer conversions and actual memory reclamation [E2 §15]. This document says what each of those means, what Edition 3's change of candidate shape does to the density argument, what the lab's speed-optimised factory branch actually measured, and how each reduction should be confirmed. It ends with a ranked table. Every reduction is **Proposed** until a campaign confirms it. The lab figures are development and pilot numbers on a shared desktop and are labelled as such.

## Summary

- The seven reductions remove repeated work without changing what counts as success. Deeper reductions (incremental semantics, coalescing, shared families, specialisation) wait for full-recomputation comparisons (R07) [E2 §15].
- Edition 3 turns density into arithmetic: a resident candidate is a module instance, not a heap. The estimate is one to two orders of magnitude less per attempt [E3 §5, §9].
- The lab's head-to-head found that what won was retaining parsed libraries, not WASM versus native. A warm native checker that kept its lib parse cost 4.7× less CPU per candidate than the in-isolate tsc-rs WASM path. **Pilot (not a result).**
- In a closed loop, pools only move cost off the request path. Batching and retained preparation moved CPU; hop removal and tiering flags did not. **Pilot (not a result).**
- Do not multiply ratios. A tenfold faster check on 10% of a workflow yields about 1.10× overall (Derived, [W p.11]).

## 1. The reductions, one by one

### 1.1 Smaller generated surfaces

Generate less: structured changes, parameter binding and composition of existing capabilities instead of fresh source [E3 §10]. Edition 3 notes this matters more for latency than for memory [E3 §10]. Model inference is about four fifths of a small novel capability's time (**Estimated** [E3 §10]), so every token not generated is the largest saving available. Edition 2 adds that where a compiled primitive already solves most of the work, the generator should compose it, and parameters can often vary without new compilation [E2 §4]. The pure-kernel-plus-declarative-glue shape also shrinks the generated surface: views, bindings and tests are data validated by schema, not imperative code [E3 §5].

### 1.2 Prepared dependencies

An ordinary candidate change should not imply installing another compiler, reconstructing a dependency tree or reconnecting an environment [E2 §3]. The white paper's cache table keys a pinned project base by dependency graph, SDK declarations and configuration, read-only with private writes per candidate [W p.6]. "Prepared" must mean more than "the bytes are in memory". The lab's TS6 ladder shows the difference: holding lib text in memory changed nothing (40.0 → 40.0 ms per candidate), while holding parsed lib SourceFiles cut it to 10.8 ms (**Pilot (not a result)**, [`FASTLOOP.md` §9]). The expensive form of a dependency is the analysed form.

### 1.3 Artifact reuse

Reuse compiled machinery and checked outputs under exact keys: compiler bytes plus runtime identity for a module; source, compiler, options and dependency digests for a checked build; artifact, inputs, evaluator, policy and environment for a measured result [W p.6]. A cache hit is never authorization [E3 §9; A sheet 23]. Two proposals can share a build without becoming the same historical event [E2 §10].

### 1.4 Parameterised candidates

Some searches can use one executable with many parameter blocks; others keep a shared immutable structure and vary selected regions [E2 §7]. A threshold change should not cost a compile [E2 §5]. This is the bridge to R07's candidate families.

### 1.5 Batching

Load a batch once, carry out compatible operations in its resident representation, and return compact evidence [E2 §8]. The lab tested two kinds: request batching (32 candidates per request) and program batching (up to 32 candidates as sibling files of one tsc program). The second is a different regime with its own leakage risk (see §3 and R07).

### 1.6 Fewer conversions

Keeping computation in one isolate does not remove UTF-8/UTF-16 conversions, object construction, WASM-memory copies, host buffers or repeated scans [E2 §8; A sheet 08]. A source string, a JavaScript object, a WASM linear-memory region and a GPU allocation are not interchangeable because they share a machine [E2 §8]. Large inputs stay in host-owned buffers reached through handles; a candidate never receives a pointer into trusted state [E3 §5].

### 1.7 Actual reclamation

Discarding a name is not freeing storage. The Mononoke study's test-only memory store removes link entries without reclaiming payload entries on those paths; that is a design warning, not evidence about production stores [E2 §3]. After a campaign the factory must know what is live, retained, awaiting persistence and reclaimable, and it measures bytes, not candidate counts [E2 §3]. After teardown, verify that the intended resources were actually released [W p.21].

## 2. Edition 3's density argument

Edition 2 could only propose density. Edition 3 makes it arithmetic by changing the candidate's shape: a resident candidate is a WebAssembly module instance, not an interpreter heap [E3 §5]. The kernel instantiates in well under a millisecond and costs kilobytes to low megabytes (**Estimated**), where a nested QuickJS guest cost tens of megabytes (**Recorded** [E3 §5, §14]). The per-attempt footprint falls by one to two orders of magnitude (**Estimated**; E3 X4 measures it [E3 §9]).

Three scoping notes.

- The recorded baseline is the whole warm unit: 150.62 MiB peak with shared VFS, 151.93 MiB with fresh VFS, at 100% quota (**Recorded** [E3 §14; W p.17]). That figure includes Node, Just Bash and harness, not only the guest. X4 compares module footprint against "the 150 MiB guest baseline" [E3 §15], so the comparison must say which boundary it measures.
- The density argument is about the **candidate**. If the compiler is also instantiated per attempt, the compiler dominates. In the lab's tsc-rs path each check is a fresh `WebAssembly.Instance` with about 44 MiB of linear memory, and the per-active-attempt increment was 57–81 MiB per worker (**Pilot (not a result)**, [`FASTLOOP.md` §3, §8]). The density win needs the compiler instance off the per-attempt bill, which tsc-rs WASM cannot currently do (§3.2).
- Machinery per isolate (V8 heap, compiled WASM code, allocator arenas) was the larger term per worker: RSS 340–390 MiB against the 57–81 MiB attempt increment, and CPU bound before memory at 16 workers (**Pilot (not a result)**, [`FASTLOOP.md` §8]).

## 3. What the lab's fastloop measured

Branch `feat/fastloop` (unmerged) built "C+", a speed-optimised in-isolate factory [`~/Work/isolate-factory-lab-wt/fastloop/docs/FASTLOOP.md`]. Its own label: every number is a development or pilot measurement on a shared Ryzen 9 7950X desktop with load averages of 3 to 28, no quiet-machine gate, no block-bootstrap confidence intervals, and not through the harness front door. None of it is a campaign result. The lab's harness owns official timing. Everything in this section is **Pilot (not a result)**.

### 3.1 Head-to-head, S-medium (445 candidates, 5 lifetimes per row)

| Row | CPU per candidate (median) | Accepts agreeing with validator |
|---|---|---|
| C+ tsc-rs WASM, R-stateless (declared arm C) | 30.23 ms | 34/34 |
| C+ tsc-rs WASM, R-batch (exploratory) | 9.93 ms | 34/34 |
| C+ TS6-JS, R-stateless (fallback) | 6.58 ms | 34/34 |
| C+ TS6-JS, R-incremental | 5.70 ms | 34/34 |
| naive C, batch 32 | 30.55 ms | 34/34 |
| B: tsc-rs native API (warm) + bwrap pool | 6.42 ms | 34/34 |
| B′: TS7 native API + charged TS6 emit | 7.76 ms | 34/34 |
| E-warm: native CLI + bwrap pool-once | 74.44 ms | 33/34 in one lifetime (one `outcome_unknown`) |

Derived from those rows: B costs 30.23 / 6.42 ≈ 4.7× less CPU than declared arm C; R-batch is 9.93 / 6.42 ≈ 1.5× B; TS6 R-stateless is 6.58 / 6.42 ≈ 1.02× B, inside a ±10% band. The lab's reading: what wins is retaining parsed libs; WASM versus native is secondary [`FASTLOOP.md` §0].

### 3.2 Where a tsc-rs check spends its time

A solo R-stateless check on S-medium took about 26 ms. Of that, about 70% (~18 ms) was parsing and binding the ES2022 lib, about 20% (~5 ms) runtime start-up and instantiation, and about 11% (~3 ms) program set-up. The candidate itself was approximately zero (**Pilot (not a result)**, [`FASTLOOP.md` §3]). tsc's own diagnostics agree: parse 24 ms, bind 1 ms, check and emit about zero, across 58 files and 10,638 lines.

The tsc-rs WASM build cannot keep that lib work: there is no API for it, a second `ts_run` on an instance is refused, and in-place memory restore leaked about 9.6 MiB per run and diverged from fresh results after run 209 [`FASTLOOP.md` §3.3]. This is the concrete form of E3's upstream note that the WASM interface creates fresh per-run state [E3 §14]. In R-stateless the lab could therefore only remove the roughly 20 ms around the checker, and the lab judged its own P11 (≥ 3× over naive warm C) to look contradicted for tsc-rs at about 1.7× (50.8 / 29.6), while holding for TS6-JS and for tsc-rs only in R-batch.

### 3.3 The ablation ladder (3 lifetimes per row)

| Step | Change | CPU per candidate |
|---|---|---|
| T0 | naive: worker hop and structured clone per check, new QuickJS module per candidate | 50.77 ms |
| T1 | one loop thread for checker, guest and scoring; transferred buffers | 35.13 ms |
| T1b | own tsc-rs host (cached encodings, one directory index) | 33.57 ms |
| T2 | tsc-rs instance pool off the request path | 36.16 ms |
| T3 | QuickJS module compiled once; fresh capped instance per candidate | 30.73 ms |
| T4 | capped instances pre-created off-path | 32.67 ms |
| T5 (C+) | 32 candidates per request | 29.61 ms |
| B6 | ≤ 32 candidates per tsc program (R-batch) | 9.33 ms |

Lab readings, all **Pilot (not a result)**: pools only move cost off the request path, and in a closed loop with no idle time they save nothing (T2, T4); removing the remaining thread hop measured 29.17 ms against 29.61 ms, noise-level; V8 tiering flags made no steady-state difference; the size build was slower [`FASTLOOP.md` §2–§3].

**Caveat found in reconstruction.** The head-to-head's naive C row at batch 32 measured 30.55 ms, against T0's 50.77 ms at one candidate per request. In the head-to-head, C+ was only about 1% cheaper than naive C with request batching (30.55 / 30.23 ≈ 1.01). FASTLOOP states both numbers but does not draw the consequence: in these runs, request batching accounts for most of the naive-to-C+ difference, and the ladder's step attributions depend on the order the steps were applied. Ablation by ladder is not ablation by factorial design.

### 3.4 Other recorded findings on the branch

- **Zero hot-path I/O.** 0 path-based filesystem syscalls over the measured window, storage bytes 0, character I/O equal to IPC bytes within 80–104 B; the naive positive control made 176 path syscalls and read 44.7 MB of character I/O [`FASTLOOP.md` §7]. **Pilot (not a result).**
- **Sharing broke a memory cap.** A shared QuickJS instance let 64 × 16 MiB typed arrays grow linear memory to about 1 GiB, because the runtime limit does not count ArrayBuffer backing stores. A fresh capped instance per candidate closed it at about +1 to +1.5 ms per candidate [`FASTLOOP.md` §6]. A reduction that shares state must be re-run through containment.
- **Scaling.** C+ R-stateless reached speedup 5.18 at 8 workers (efficiency 0.65) and B reached 5.23; CPU per candidate rose with worker count on a shared machine [`FASTLOOP.md` §0, §8]. **Pilot (not a result).**

### 3.5 What the earlier records add

The Field OS warm guest records show the same lesson at a different layer: fresh VFS per job cost the same as shared VFS (18.65 versus 18.64 ms median; the 0.01 ms difference is not statistically meaningful), while a preloaded native function was about 140× cheaper (18.64 / 0.131 ≈ 142; **Recorded** and **Derived** [E3 §14; W p.17]). Fresh mutable state was cheap; the interpreter layer was not.

## 4. Do not multiply ratios

If checking is fraction f of a fixed workflow and becomes s times faster, the idealised whole speedup is 1 / ((1 − f) + f / s) [W p.11].

**Derived.** f = 0.60, s = 10: 1 / (0.40 + 0.06) ≈ 2.17×. f = 0.10, s = 10: 1 / (0.90 + 0.01) ≈ 1.10×. Both figures in the white paper check out. Under E3's estimate that roughly four fifths of a small novel capability's time is model inference [E3 §10], workcell reductions alone move end-to-end latency by at most about 1.25× (1 / 0.8), however large they are. That bound is **Derived** from an **Estimated** share. The reductions matter mainly for throughput and density, for the agent substrate, and for removing generated surface (§1.1), which attacks the model term directly.

## 5. Ranked reductions

Ranked by expected value per unit risk on Edition 3's architecture. "Effect class" is an order-of-magnitude expectation, **Estimated** unless marked; "Confirming measurement" is what would move it to Recorded.

| Rank | Reduction | Expected effect class | Risk | Confirming measurement |
|---|---|---|---|---|
| 1 | Generate less: composition, binding, structured changes [E3 §10] | Largest on latency, since model time dominates; removes whole model turns | Medium: a wrong composition is a wrong capability; contract check must cover it | Tokens and model time per accepted capability, same tasks, same evaluator; first-pass yield unchanged or better (E3 X1, X5) |
| 2 | Retain the analysed form of prepared dependencies (parsed and bound libs, SDK declarations) | Several-fold on checker CPU where lib work dominates (3.7× on the TS6 ladder; **Pilot (not a result)**) | Low if keyed by content digest and tested for leakage | Same-stream CPU per candidate with and without retention; byte-identical diagnostics and emit in forward and reversed order |
| 3 | Kernel module instance instead of nested interpreter [E3 §5] | One to two orders on per-attempt memory (**Estimated** [E3 §9]) | Medium: route yield may fall (E3 X4 kill criterion) | Module footprint against the 150 MiB recorded baseline, with yield per route (E3 X4) |
| 4 | Parameterised candidates: one executable, many parameter blocks | Removes compile per variant; size depends on share of variants that are parameter-only | Low; parameters validated by schema | Fraction of campaign candidates expressible as parameters; compile count per accepted variant |
| 5 | Batching of requests and evaluations | Tens of percent per candidate in the lab's runs (**Pilot (not a result)**) | Low for request batching; **medium** for shared-program batching (cross-candidate leakage) | Per-candidate CPU and stage parity with solo; for shared programs, batch == solo byte for byte in several orders |
| 6 | Actual reclamation | Prevents unbounded growth rather than speeding a step | Low | Retained-memory slope over thousands of candidates; resources verified released after teardown; plateau, not count-of-threads, for pools |
| 7 | Artifact reuse under exact keys | Removes repeat builds of identical inputs; size depends on duplicate rate | Low if keys cover every build-affecting input; a hash is not permission | Cache hit rate; identical outputs on hit versus rebuild; zero hits across incompatible scope |
| 8 | Fewer conversions and hops | Small in the lab's runs: hop removal was noise-level (**Pilot (not a result)**) | Low | Bytes copied and per-phase time with host-side marks; matters more once lib work is gone |
| 9 | Instance pools and pre-warming | Latency only; no CPU saving in a closed loop (**Pilot (not a result)**) | Low; pools need capped, fresh instances | Latency under open-loop arrivals, not closed-loop CPU |

The reductions in R07 (incremental semantics, coalescing, shared families, specialisation) are deliberately not in this table. Edition 2 admits them only once each is backed by full-recomputation comparisons and total-resource measurements [E2 §15].

## Edition 3 alignment

- **Holds:** the seven reductions and their order before deeper work [E2 §15]; locality has several levels and conversions remain [E2 §8].
- **Changed:** the candidate is a WASM kernel plus declarative glue, so "smaller generated surface" now includes moving views, bindings and tests into validated data, and density follows from instance size rather than heap tuning [E3 §5, §9].
- **Changed:** in-isolate locality is an enabler, not the headline, and its share of the latency budget is already small [E3 §1, §12]. The lab's result that retained preparation mattered more than location is consistent with that.
- **Scope note:** the lab ran on V8 under Node. Edition 3's local lane is Wasmtime-based [E3 §13]. None of the fastloop numbers transfers to that lane without re-measurement.

## Open questions

- Can any in-isolate checker route retain parsed libs across fresh candidate programs without leakage? tsc-rs WASM currently cannot [`FASTLOOP.md` §3]. Decides whether the in-isolate compiler is competitive with a warm native one; feeds E3 X4 and X6.
- What is the per-attempt footprint of an AssemblyScript or MoonBit kernel plus its compiler on Wasmtime? E3 X4.
- How much of a real campaign's stream is parameter-only? No workload in the lab measures it.
- Is the shared-program batch regime sound beyond the tested orders? The lab calls its guards tested, not proven [`FASTLOOP.md` §11].

## Sources

- `sources/text/Endoforge-Edition-3.txt` §1, §5, §9, §10, §12, §13, §14, §15.
- `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt` §3, §4, §5, §7, §8, §10, §15.
- `sources/text/In-Isolate-Software-Workshop-v1.txt` pp. 6, 11, 17, 21.
- `sources/text/Diagram-Atlas.txt` sheets 07, 08, 15, 23.
- `~/Work/isolate-factory-lab-wt/fastloop/docs/FASTLOOP.md` (unmerged branch `feat/fastloop`, head f70fa25).
- `~/Work/isolate-factory-lab/docs/CHECKERS.md`, `EXECUTORS.md`, `TESTING.md`.
