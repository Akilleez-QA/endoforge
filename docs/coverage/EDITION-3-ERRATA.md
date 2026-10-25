# Edition 3 errata

> New document, written 2026-10-17. It is not a reconstruction of an original. It records
> inconsistencies found in Edition 3 (`sources/pdf/Endoforge-Edition-3.pdf`, 17 Oct 2026) by reading
> its extracted text against itself, against the earlier sources, and against local evidence.

## Purpose

Edition 3 governs the architecture [CONVENTIONS]. That makes its internal inconsistencies expensive: a reference document that follows one sentence can contradict another. This file lists every inconsistency found so far, with its location, the problem, the evidence, and a proposed correction. It does not change Edition 3. The reference documents should follow the proposed correction where they need to take a position, and say so.

## Summary

- 30 errata are recorded. Five were supplied as candidates and all five were verified (E3-01 to E3-05); the rest were found while building R15–R18 or reported by other reconstruction agents (including the R12 writer's receipt checks) and verified here against the sources before inclusion.
- The most consequential are E3-01 (generated JavaScript does execute, in the compatibility lane), E3-03 (autonomy-tier thresholds without sample sizes), E3-09 and E3-10 (which runtime hosts the compatibility lane and the JavaScript-hosted compilers on the Wasmtime local lane) and E3-17 (two incompatible source-numbering schemes).
- E3-04's arithmetic is correct (669 / 24.04 ≈ 27.8) and 24.04 ms is a real recorded value (warm shared-VFS median at 50% quota). The fault is that §14 never prints that row, and that the two operands measure different things.
- Several items are omissions rather than errors (E3-11, E3-23, E3-26). They are listed because a reader following Edition 3 alone would be misled.
- Severity is this file's judgement (**Proposed**): High means a reader acting on the text would build or claim the wrong thing; Medium means a figure or citation is wrong or unsupported; Low means wording or presentation.

## Index

| ID | Location | Problem (short) | Severity |
|---|---|---|---|
| E3-01 | §1, §5 | "No generated imperative JavaScript executes anywhere" vs a compatibility lane that executes it | High |
| E3-02 | §5 route table; §15 X4 | Route comparison attributed to Experiment 1; X4 omits MoonBit | Medium |
| E3-03 | §7; §15 X3 | Tier thresholds need about 3,000 / 30,000 faults; no sample sizes given | High |
| E3-04 | §2; §14 | Ratio uses 24.04 ms, a recorded value §14 never prints; operands not comparable | Medium |
| E3-05 | §2, §8, §13, §14, §17 vs §18 | "tsc-rs" vs "ts-rust" | Low |
| E3-06 | §1 vs §10 | "Within a minute or two" vs 2–3 minutes realistic | Low |
| E3-07 | §5 figure caption | Counts of glue artifacts and host services disagree with the prose | Low |
| E3-08 | §5 route table | Table headed "kernel contract" includes a JavaScript-output route | Low |
| E3-09 | §5 vs §13 | Compatibility lane's child V8 isolate has no home on the Wasmtime local lane | High |
| E3-10 | §5 vs §2, §13 | JavaScript- and browser-hosted compilers "inside the isolate" on a Wasmtime lane with QuickJS removed | High |
| E3-11 | §5 | Python and Javy routes of Edition 2 silently absent | Low |
| E3-12 | §15 X2 | "One pass" of library growth vs kill criterion "after two library passes" | Medium |
| E3-13 | §5 | "Tens of megabytes (recorded, Section 14)" is not in §14 | Medium |
| E3-14 | §15 X4 | Per-candidate memory compared against a whole-unit 150 MiB peak | Medium |
| E3-15 | §8 | 181,711 ported tests matches only a 12 Oct README; unpinned and unlabelled | Medium |
| E3-16 | §8 | "Not generated" rule attributed to Edition 2; in the available text it is in the atlas | Low |
| E3-17 | §18 | R/U identifiers from a register Edition 3 does not list; collide with the white paper's | Medium |
| E3-18 | §2 vs §13 | Four named dependency risks vs six | Low |
| E3-19 | §13 item 4 vs §3, §10 | "Review throughput is the binding constraint of the whole design" vs inference as dominant cost | Medium |
| E3-20 | §8, §10, §13, §16 | Numbers and claims without an evidence label | Low |
| E3-21 | §8 vs §15 X2 | POODO "is not an evaluator" vs POODO synthesizes the evaluator residual | Low |
| E3-22 | §6 | Seeded-fault list described as "the shape of the existing six-case fixture" | Medium |
| E3-23 | §14, §17 | "No in-isolate route has been exercised" omits lab smoke runs | Low |
| E3-24 | §14, §18 | 4.2 MB WASM module not reproducible at tsc-rs v0.7.0 | Medium |
| E3-25 | §10 | Decode estimates imply inconsistent bandwidth efficiencies | Low |
| E3-26 | §14 | "No watch or language-service mode" omits the lab's incremental regime and its defect | Low |
| E3-27 | §14 | Stale outputs described as withheld; the receipt shows them displayed with a rebind proposal | Medium |
| E3-28 | §14 | "About 140× cheaper" is Derived inside a Recorded row | Low |
| E3-29 | §14 | Containment times are whole-wall single observations; the allocation bomb exhausted its heap | Low |
| E3-30 | §9, §14 | "Five named recovery boundaries"; the receipt has six | Low |

## Errata

### E3-01 — Generated JavaScript does execute

- **Location:** §1 (the third commitment, p.1) and §5 opening sentence (p.6); §5 route table, "TypeScript to JavaScript" row (p.8).
- **Problem:** §1 and §5 both state that "no generated imperative JavaScript executes anywhere" in the system. The route table keeps a TypeScript → JavaScript compatibility lane whose output is a JavaScript module, with "execution in a child V8 isolate", for "imported code and behavior that resists the kernel split". §5 itself says that lane is "named as a lane rather than disguised as the strict path".
- **Evidence:** E3 lines "No generated imperative JavaScript executes anywhere" (§1) and "no generated imperative JavaScript executes anywhere in the system" (§5); route table row "TypeScript to JavaScript … tsc-rs as WASM, inside the isolate; execution in a child V8 isolate … Compatibility lane".
- **Proposed correction:** "No generated imperative JavaScript executes on the kernel path. The compatibility lane executes generated or imported JavaScript in a child V8 isolate under its own admission, containment and evidence bar."

### E3-02 — Route comparison is X4, not Experiment 1; X4 omits MoonBit

- **Location:** §5 route table, Role column for AssemblyScript ("pending Experiment 1") and MoonBit ("compared in Experiment 1") (p.7); §15 X4 (p.28).
- **Problem:** Experiment 1 is the specification study (twenty real requests, hand-written acceptance contracts). Route yield is Experiment 4, which generates "the same twenty tasks … in TypeScript, AssemblyScript, and Rust". MoonBit, named as the second in-isolate route, is in no experiment.
- **Evidence:** §15 table rows 1 and 4.
- **Proposed correction:** Replace "Experiment 1" with "Experiment 4" in both rows, and add MoonBit to X4's route list (or state that MoonBit is deferred and why).

### E3-03 — Autonomy-tier thresholds need large fault counts that are not stated

- **Location:** §7 autonomy-tier table and the sentence "The ratio is measurable this week" (pp. 12–13); §15 X3 (p.28).
- **Problem:** The Supervised tier requires an escape rate below 1 in 1,000 and the Autonomous tier below 1 in 10,000, per domain. Neither §7 nor X3 states how many seeded faults are needed to support those claims, at what confidence, or under sampled and searched conditions separately.
- **Evidence (Derived):** If zero escapes are observed in *n* independent seeded faults, the one-sided 95% upper bound on the escape rate is about 3/*n* (rule of three). Exactly (Clopper–Pearson, zero events: 1 − 0.05^(1/*n*) below the threshold), "below 1/1,000" needs *n* ≥ 2,995 non-equivalent faults per domain with zero escapes, and "below 1/10,000" needs *n* ≥ 29,956 (ln 0.05 / ln 0.999 = 2,994.2; ln 0.05 / ln 0.9999 = 29,955.8). Any observed escape raises the requirement, so a zero-escape plan is a fragile design (R14 §2 discusses alternatives). Per domain, and again under search [E3 §11], the counts multiply. "Measurable this week" may hold for a point estimate; it does not obviously hold for a tier claim.
- **Proposed correction:** State that tiers are assigned on the upper confidence bound, give the confidence level, and give the minimum fault count per domain for each tier (2,995 and 29,956 zero-escape non-equivalent faults at 95%, exact). Pre-register the counts in X3. See R15 RISK-10 and R14 §2.

### E3-04 — 24.04 ms is not in the recorded table

- **Location:** §2 evidence-label table, "Derived" example (p.2); §14 "Cold-to-warm ratio" row (p.24).
- **Problem:** 24.04 ms is a real recorded value, and 669 / 24.04 ≈ 27.8× is correct arithmetic. But §14 never prints the 50%-quota warm row, so the Derived ratio relies on an operand the document does not show. §14 gives only 100%-quota warm medians (18.64 and 18.65 ms) and a 50%-quota cold row. The two operands also measure different things: 669 ms is one cold run's payload wall time including startup; 24.04 ms is the median of 20 warm jobs and excludes host oracle verification [W p.17 footnote].
- **Evidence:** 24.04 ms is the warm "Just Bash / shared VFS" median at 50% CPU quota [W p.17 warm-lane table; A sheet 24 "Warm at 50% CPU quota … guest median 24.04 ms"]. The main-rig receipt line 27 gives `| Just Bash, shared VFS | 50% | 24.04 ms | 86.22 ms | 1.021 s | 163.41 MiB |` (`~/Work/field-ops-github-review/docs/receipts/FIELD-OS-MAIN-RIG-001-RECEIPT.md`; the R12 writer reports raw `medianMs` 24.042244 in `~/Work/field-ops/docs/receipts/FIELD-OS-MAIN-RIG-001-RECEIPT.md`; see R12). The white paper describes the ratio as cold payload latency versus warm shared-VFS median "at the same 50% quota", indicating amortizable adapter overhead only [W p.17].
- **Proposed correction:** Add a §14 row: "Warm guest, shared VFS, 50% quota — 24.04 ms median; p95 86.22 ms; peak 163.41 MiB — Recorded, R04." Describe the ratio as "one cold run, startup included, against a 20-job warm median excluding verification, same 50% quota; descriptive only".

### E3-05 — "tsc-rs" and "ts-rust"

- **Location:** §2, §8, §13, §14, §15, §17 use "tsc-rs"; §18 says "ts-rust releases" and "ts-rust WebAssembly interface (U02)".
- **Problem:** The two names are used without saying how they relate.
- **Evidence:** The white paper: "'tsc-rc' in the discussion is treated as tsc-rs, the ts-rust compiler named in the inspected source" [W p.3]. The upstream repository is `pingdotgg/ts-rust`; its compiler binary and npm package are `tsc-rs` (`sources.json` U01; lab `docs/CHECKERS.md`: npm `tsc-rs@0.7.0`).
- **Proposed correction:** In §18, write "tsc-rs releases (ts-rust repository)" and "tsc-rs WebAssembly interface (ts-rust repository, U02)". Use "ts-rust" only for the repository.

### E3-06 — "Within a minute or two" vs "two to three minutes realistic"

- **Location:** §1 "What should feel different" (p.2); §10 opening and request-class table (pp. 16–17).
- **Problem:** §1 says a person "is using working software within a minute or two". §10 estimates a 20 s floor and "two to three minutes" as a realistic run for a novel and determinate request, plus a human round trip (hours if absent) for ambiguous requests, which "is most requests" at that scale.
- **Evidence:** E3 §1 and §10 text and table.
- **Proposed correction:** In §1, "within a few minutes for a novel request, and seconds for one the library can compose (estimated, Section 10)".

### E3-07 — Candidate-anatomy caption counts

- **Location:** §5 figure caption "candidate anatomy · kernel, three glue artifacts, four host services" (p.7).
- **Problem:** The prose lists four glue items: "a view specification over the host's registered components, data and action bindings …, interaction tests, and a result schema". It names three host services the candidate never touches: "the renderer, the broker, or the ledger". The caption says three glue artifacts and four host services.
- **Evidence:** §5 paragraphs 3–4 and the caption. PDF page 7 was inspected on 2026-10-17. The figure draws three glue boxes ("View spec over registered components"; "Data and action bindings"; "Interaction tests and result schema") and four host services ("Loop runner"; "Capability broker"; "Renderer"; "Evaluator and ledger"). The caption therefore matches the figure. The prose splits the third glue box into two items and names three of the four services (the loop runner is omitted from the "never touches" sentence, and evaluator-and-ledger is called "the ledger").
- **Proposed correction:** Prose only. Write "interaction tests and a result schema" as one artifact, and name all four host services, e.g. "the loop runner, the broker, the renderer, or the evaluator and ledger". The caption and figure stand.

### E3-08 — Route table heading includes a non-kernel route

- **Location:** §5 route table, column heading "Route into the kernel contract" (pp. 7–8).
- **Problem:** The TypeScript → JavaScript row outputs a JavaScript module and is the compatibility lane, which by definition does not satisfy the kernel contract. The pre-built WASM row is admission of supplied modules, not a route a candidate is generated through.
- **Evidence:** Route table rows 4–5.
- **Proposed correction:** Head the column "Route" or "Route into the candidate contract", and mark the compatibility row as outside the kernel contract.

### E3-09 — The compatibility lane has no home on the local lane

- **Location:** §5 route table (TypeScript → JavaScript row) vs §13 lane table and the paragraph after it (pp. 8, 22).
- **Problem:** §13 makes the local lane Wasmtime-based and says "the V8 route exists mainly to serve the hosted lane". §5 executes the compatibility lane in a child V8 isolate and runs tsc-rs "as WASM, inside the isolate". On the local lane that leads, there is no stated V8 runtime for the child isolate, and no stated isolate for tsc-rs.
- **Evidence:** §5 route table; §13 lane table ("Wasmtime-based runtime under OS sandboxing, cgroups, and an external watchdog; native Rust lane beside it") and following paragraph.
- **Proposed correction:** State where the compatibility lane runs locally (for example a supervised V8 or workerd process beside the Wasmtime lane, partitioned as its own trust cohort per §13 item 3), or state that locally the compatibility lane is hosted-only until X4 decides it.

### E3-10 — JavaScript- and browser-hosted compilers on a Wasmtime lane

- **Location:** §5 route table (AssemblyScript: "JavaScript-hosted compiler, inside the isolate"; MoonBit: "Browser-hosted compiler, inside the isolate") vs §2 ("the QuickJS layer leaves the architecture") and §13 lane table (local lane "Yes: AssemblyScript and MoonBit compilers run inside").
- **Problem:** A JavaScript-hosted compiler needs a JavaScript engine. The local lane is Wasmtime, which does not run JavaScript; the QuickJS layer, the only JavaScript-in-WASM engine the earlier design used, has been removed. Edition 3 does not say what hosts these compilers on the local lane. The §13 "Yes" is stated as fact, but Edition 3's own claim ladder says no in-isolate route has been exercised [E3 §17 rung 1].
- **Evidence:** §2, §5, §13, §17 text.
- **Proposed correction:** Name the host for each compiler on each lane (for example a JavaScript engine compiled to WASM inside Wasmtime, which would reintroduce an engine of the QuickJS kind for trusted tooling only, or a V8 process), label the §13 "Yes" as Proposed, and make it a measured output of X4.

### E3-11 — Python and Javy routes silently absent

- **Location:** §5 route table.
- **Problem:** Edition 2 named JavaScript through runtime-backed tools such as Javy and Python through compatible component packaging as candidate adapter families, and its end-to-end walk-through admits "an existing Python routine" [E2 §4, §5]. Edition 3 lists neither and does not say they were dropped. This is an omission, not strictly an error.
- **Evidence:** E2 §4 ("JavaScript through runtime-backed tools such as Javy, Python through compatible component packaging"), E2 §5; E3 §5 table.
- **Proposed correction:** Add a sentence to §5: whether Python and runtime-backed JavaScript enter through the compatibility lane, as pre-built WASM after admission, or not at all.

### E3-12 — One library pass or two in X2

- **Location:** §15 X2 (p.28).
- **Problem:** "What it produces" says "evaluator error rate by request type, before and after one pass of invariant-library growth". The kill criterion says "above 5% on determinate requests after two library passes".
- **Evidence:** §15 X2 row.
- **Proposed correction:** Use one number in both cells. If two passes are intended, the output should read "before and after each of two passes".

### E3-13 — "Tens of megabytes (recorded, Section 14)"

- **Location:** §5 paragraph 2 (p.6): a nested QuickJS guest "cost tens of megabytes (recorded, Section 14)".
- **Problem:** No receipt isolates a per-guest footprint. §14 records whole-unit peaks of 150.62 MiB (guest, shared VFS) and 151.93 MiB (fresh VFS) against 29.96 MiB for the preloaded native function. The receipts' guest whole-unit peaks range from 117.40 MiB (cold, 50%) to 163.41 MiB (warm, 50%) [W p.17]. The guest-versus-native difference is about 90–135 MiB, which is not "tens", and it is a whole-unit difference rather than a per-guest cost.
- **Evidence:** §14 rows 1–3; W p.17 (peak memory includes startup, warm-up and verification); R12.
- **Proposed correction:** "where the recorded guest adapter's whole unit peaked at about 150 MiB against about 30 MiB for the native function (recorded, Section 14); per-guest cost was not isolated."

### E3-14 — X4 compares per-candidate memory with a whole-unit baseline

- **Location:** §15 X4, "module footprint against the 150 MiB guest baseline" (p.28).
- **Problem:** 150 MiB (150.62 MiB) is the peak of the whole supervised unit across 25 jobs, including startup, warm-up and verification [W p.17], not a per-candidate footprint. Comparing a per-candidate module footprint against it overstates the improvement.
- **Evidence:** §14 row 1; W p.17 footnote to the warm table.
- **Proposed correction:** Compare whole-unit peak against whole-unit peak under the same job count, and report per-candidate incremental memory separately.

### E3-15 — The 181,711 ported tests

- **Location:** §8 paragraph on tsc-rs (p.14): "validated against 181,711 tests ported from the Go reference compiler and checked on 120 open-source repositories".
- **Problem:** The number carries no evidence label and no pinned revision. In the ts-rust README history it appears only at commit `43bc0ab0` (12 Oct 2026). At the benchmark pin Edition 3's other figures use (`144d6e0`, 13 Oct) the README says 184,749; at v0.7.0 (`3644f32`, 14 Oct) it says 184,773.
- **Evidence:** `git show <rev>:README.md` in `~/Work/isolate-factory-lab-cache/ts-rust-src` (local check, 2026-10-17): 181,711 at `43bc0ab0`; 184,745 at `a7deaa28`; 184,749 at `a18df3ec` and `144d6e0`; 184,773 at `3644f324`. The "120 open-source repos" figure is present at both pins.
- **Proposed correction:** "validated against about 184,700 tests ported from the Go reference compiler (Upstream, ts-rust README at 144d6e0, 13 Oct 2026)", or pin the 12 Oct revision explicitly.

### E3-16 — "Not generated" attributed to Edition 2

- **Location:** §8 paragraph 2 (p.13): "the Edition 2 rule that the trusted harness is 'not generated'".
- **Problem:** The available Edition 2 text does not contain the rule. It appears in the diagram atlas, sheet 03, "Trusted factory harness … Not generated" (14 Oct 2026). It may have been in the lost Edition 2 reference library, which cannot be checked.
- **Evidence:** text search of all four extracted sources: "not generated" occurs only in the atlas (sheet 03) and in Edition 3 §8.
- **Proposed correction:** "the earlier rule (atlas sheet 03, carried into Edition 2's engineering library) that the trusted harness is 'not generated'".

### E3-17 — Source identifiers from an unlisted register

- **Location:** §18 (pp. 33–34).
- **Problem:** §18 cites receipts R01, R03–R09, R11 and upstream sources U02, U04–U06, U09, U11, U13, U14. These identifiers come from the register of *The In-Isolate Software Factory* report and the diagram atlas (`sources.json`), not from the white paper, which uses R1–R9 / U1–U10 with different assignments. Examples: Edition 3's R04 (main-rig receipt) is the white paper's R3; Edition 3's U09 (Workers performance and timers) collides with the white paper's U9 (Project Think); the workerd README is U13 in the atlas and U4 in the white paper. §18's edition history lists the 25-page white paper and the atlas but not the 33-page Factory report whose register it uses. §18 also omits R02 and R10 and gives no workerd pin, while the sources disagree on it (`9f247e0d…` in atlas sheet 18 and `sources.json` U14; `587bab1` in W p.15).
- **Evidence:** W pp. 3, 24–25; A sheet 18 and register pages; `~/Work/isolate-factory-lab/reference/Isolate_Software_Factory/sources.json`.
- **Proposed correction:** Add the Factory report to the edition history, state which register §18's identifiers belong to, and pin the workerd revision. This repository resolves both schemes through R18's SRC-xx identifiers.

### E3-18 — Four named dependency risks or six

- **Location:** §2 "What changed" bullet 7 (p.3) vs §13 (pp. 22–23).
- **Problem:** §2 lists four dependency risks (tsc-rs age and provenance, the 128 MB ceiling, side channels, injection vectors). §13 names six, adding SDK and host churn and license and provenance.
- **Proposed correction:** §2: "Six dependency risks are named (Section 13)".

### E3-19 — Which constraint binds

- **Location:** §13 item 4 (p.23): "review throughput is the binding constraint of the whole design"; vs §3 table (agent substrate dominant cost "Model inference per iteration") and §10 ("roughly four fifths … is model inference").
- **Problem:** The sentences assign the binding constraint differently without saying for which product. Review throughput plausibly binds generative applications and the retained library; inference dominates agent-substrate latency. "The whole design" does not distinguish them, and no measurement supports either claim yet.
- **Proposed correction:** "review throughput is the binding constraint on retained capabilities and generative applications (proposed; Experiments 1 and 2 bear on it); inference dominates agent-substrate latency (estimated, Section 10)."

### E3-20 — Figures without an evidence label

- **Location:** §8 (181,711 tests; 120 repositories), §10 (94%, about 0.07 expected repairs, 99.998%), §13 lane table ("Yes" for the in-isolate compiler on the local and browser lanes), §16 (environment setup "roughly 100 ms"; fresh instances "in under a millisecond").
- **Problem:** §2 says every number and every architectural statement carries one of five labels. These do not.
- **Evidence (Derived, for §10):** at 50% first-pass yield, P(at least one of four passes) = 1 − 0.5⁴ = 93.75%; of sixteen, 1 − 0.5¹⁶ ≈ 99.998%. The arithmetic is right; only the label is missing.
- **Proposed correction:** Label §8 figures Upstream (with revision), §10 figures Derived from an Estimated yield, the §13 "Yes" cells Proposed, and §16 figures Upstream with sources.

### E3-21 — POODO is "not an evaluator" but synthesizes the residual

- **Location:** §8 paragraph 4 (p.14) vs §15 X2 (p.28).
- **Problem:** §8 says POODO "is not an evaluator" and runs at campaign boundaries. X2 has "POODO synthesizes the residual in a candidate-blind context". The residual is the synthesized top layer of the evaluator [E3 §6]. The two are reconcilable (POODO authors the residual once per task, before candidates, and does not grade) but the text does not say so.
- **Proposed correction:** §8: "It is not an evaluator and never grades a candidate; it may author the task residual once per campaign, before any candidate exists, under the rules of Section 6."

### E3-22 — Seeded faults described as the shape of the six-case fixture

- **Location:** §6, rule "Qualified" (p.10): "swapped units, dropped rows, off-by-one, reversed inputs: the shape of the existing six-case fixture".
- **Problem:** The six-case fixture is "equivalent and unequal power quantities, repeated source origin, gauge/absolute pressure without assumed atmosphere, an unavailable page, and reversed inputs" [W p.17]. Only reversed inputs matches. Swapped units, dropped rows and off-by-one are not fixture cases. §7 gives a third list (swapped units, dropped rows, a wrong join rule, a stale source binding).
- **Evidence:** W p.17; E3 §6, §7.
- **Proposed correction:** "seeded faults (swapped units, dropped rows, off-by-one, reversed inputs, wrong join rules, stale bindings), several of which the existing six-case fixture exercises (unit and quantity handling, reversed inputs)". Use one list in §6 and §7.

### E3-23 — "No in-isolate route has been exercised"

- **Location:** §17 rung 1 status (p.32); §14 "What these do not establish" (p.25).
- **Problem:** The isolate lab (14 Oct 2026) built tsc-rs 0.7.0 WASM from source and ran it in a V8 isolate (a Node `worker_threads` isolate inside the factory process) with parity against TypeScript 7 on every W-check throughput project. These are smoke and pilot-level runs on a busy shared desktop (**Pilot (not a result)**), and the isolate is V8, not the intended Wasmtime lane. Edition 3 does not mention them, so "no in-isolate route has been exercised" is stronger than the local evidence. "Not yet" still stands as the rung status. This is an omission relative to local evidence, not an internal inconsistency.
- **Evidence:** `~/Work/isolate-factory-lab/docs/CHECKERS.md` (status line; parity table; "Threads"); `docs/PREDICTIONS.md` v1.2.
- **Proposed correction:** "Not established. tsc-rs WASM has been run in a V8 worker isolate in lab smoke tests with diagnostic parity on small projects (not a campaign result); no route has been exercised in the intended Wasmtime workcell."

### E3-24 — The 4.2 MB WASM module

- **Location:** §14 "tsc-rs WebAssembly interface" row (p.25); §18 "ts-rust WebAssembly interface (U02): 4.2 MB module" (p.34).
- **Problem:** The figure is carried from Edition 2 and not rechecked [E3 §18]. At v0.7.0 the lab built the size build at 5,214,613 bytes (Rust 1.95.0; gzip 2,212,427; Brotli 1,790,052) and 5.17 MB with Rust 1.98.1, and the speed build (the one the lab's arm C uses) at 6,518,285 bytes (gzip 2,653,873). None reproduced 4.2 MB, which was written at the earlier revision `144d6e0`. §14 also drops the white paper's 1.5 MB Brotli figure [W p.13].
- **Evidence:** `~/Work/isolate-factory-lab/docs/CHECKERS.md` artifact table and "Module size" note.
- **Proposed correction:** "4.2 MB module, about 1.8 MB gzip and 1.5 MB Brotli (Upstream, at 144d6e0; not reproduced at v0.7.0, where lab builds were 5.2 MB size-optimized and 6.5 MB speed-optimized)". Recheck before X6.

### E3-25 — Decode estimates imply inconsistent efficiencies

- **Location:** §10, lever "Local inference where it pays" (pp. 17–18): about 100 tokens/s for a 4-bit 7B model, 30–40 for 30B, 15–20 for 70B, on an 800 GB/s part (Estimated).
- **Problem:** The text calls decode bandwidth-bound, but the three figures imply different fractions of the bandwidth ceiling.
- **Evidence (Derived):** ceiling = 800 GB/s ÷ weight bytes read per token. At 4.0–4.5 bits per weight: 7B is 3.5–3.9 GB, ceiling about 203–229 tokens/s; 30B is 15–17 GB, about 47–53; 70B is 35–39 GB, about 20–23. Edition 3's figures are then 44–49%, 56–85% and 65–98% of the ceiling. No single efficiency explains all three. The figures are labelled order-of-magnitude estimates, so this is Low severity.
- **Proposed correction:** State one assumed efficiency (for example about 50% of the ceiling, giving roughly 100, 25 and 10–12 tokens/s) or show the arithmetic for each figure.

### E3-26 — "No watch or language-service mode" omits the lab's incremental regime

- **Location:** §14 "tsc-rs WebAssembly interface" row (p.25).
- **Problem:** The statement is correct for the upstream interface. It omits that the lab ran an incremental regime by carrying an in-memory `.tsbuildinfo` and previous outputs between fresh instances, and that this mode at first returned only the re-emitted files, a leakage defect its gates caught and that was fixed. A second defect found at the same time was in the tsc-rs native API (`snapshot.update()` reusing a stale program), not in the WASM mode. Omission, not error.
- **Evidence:** `~/Work/isolate-factory-lab/docs/CHECKERS.md` ("Regime", "Leakage defects found and fixed while building this").
- **Proposed correction:** Add: "An incremental regime is possible by carrying an in-memory .tsbuildinfo between instances (lab smoke); it needs leakage gates."

### E3-27 — Stale outputs were not withheld

- **Location:** §14 "Source-bound return" row (p.24): "stale, revoked, and corrupt outputs withheld".
- **Problem:** The W3/W4 receipt shows that an authorized, context-stale candidate exposed its qualified value together with an unapplied (unsaved) rebind proposal. Revoked, retired and corrupt outputs were withheld. Stale was not.
- **Evidence:** W3/W4 receipt (`~/Work/field-ops-github-review/docs/receipts/FIELD-OS-WORKER-FABRIC-W3W4-20261008.md`, lines 25–28 and 75: "same-source stale value with an unsaved rebind proposal"). The white paper states it correctly: "authorized stale context produced an unapplied rebind proposal, and revoked or corrupt outputs withheld payloads and pointers" [W p.19].
- **Proposed correction:** "an authorized stale value was shown with an unapplied rebind proposal; revoked and corrupt outputs were withheld".

### E3-28 — "About 140× cheaper" is Derived, not Recorded

- **Location:** §14 "Preloaded native function" row (p.24).
- **Problem:** The row is labelled Recorded, but "about 140× cheaper to call natively" is arithmetic on two recorded medians.
- **Evidence (Derived):** 18.64 / 0.131 = 142.3.
- **Proposed correction:** Move the ratio to its own row labelled Derived ("18.64 / 0.131 ≈ 142×, same run, 100% quota").

### E3-29 — Containment times are whole-wall single observations

- **Location:** §14 "Containment cases" row (p.24): "Infinite loop killed at 2,389 ms; allocation bomb at 1,067 ms; output flood timed out at 5,230 ms".
- **Problem:** The figures are whole-wall times of single fresh-process observations, including start-up, shutdown and scheduling, not time-to-kill. The allocation bomb ended because the guest heap was exhausted, not because it was killed; the infinite loop's outcome was "Timeout; exhausted". Edition 3 notes "single fresh-process observations" but the wording "killed at" reads as a kill latency.
- **Evidence:** W p.18 containment table ("Whole wall" column; "Infinite loop — Timeout; exhausted"; "Allocation bomb — Guest heap exhausted"; "These are single fresh-process observations, not a latency distribution").
- **Proposed correction:** "Infinite loop: timeout, exhausted (whole wall 2,389 ms); allocation bomb: guest heap exhausted (whole wall 1,067 ms); output flood: external timeout (whole wall 5,230 ms) before proving the transport cap. Single observations; whole-wall times include start-up and teardown."

### E3-30 — Five recovery boundaries or six

- **Location:** §9 "Outcome unknown is a state" paragraph (p.15): "Field OS recorded five named recovery boundaries"; §14 "Recovery boundaries" row.
- **Problem:** The W3/W4 receipt's boundary table has six rows: five SIGKILL points (after claim before unit; before durable owned-unit identity; after durable execution permit; after payload release; after successful private spool before canonical finish) and active cancellation after payload release. The white paper merges the permit and payload rows and so shows five [W p.19], while its reference list says "six recovery boundaries" [W p.24]. "Five Linux recovery methods across six controller trials" [§14; W p.19] counts methods and trials, not boundaries.
- **Evidence:** W3/W4 receipt lines 96–103; W pp. 19, 24.
- **Proposed correction:** §9: "Field OS recorded six named recovery boundaries (five crash points and active cancellation) behaving this way."

## Edition 3 alignment

- **What changed.** Nothing in Edition 3 is changed by this file. Reference documents that must take a position on an erratum follow the proposed correction and cite the erratum ID.
- **What is superseded.** Nothing.
- **What still holds.** Edition 3 governs. Most errata are presentation or citation faults; E3-01, E3-03, E3-09 and E3-10 affect what would be built or claimed and should be settled before X3 and X4 are precommitted.

## Open questions

- What hosts the AssemblyScript and MoonBit compilers on the local lane, and where does the compatibility lane run locally? (E3-09, E3-10; E3 X4.)
- What fault counts and confidence level will X3 pre-register? (E3-03; E3 X3.)
- Which workerd revision was inspected? (E3-17; R18 SRC-37.)
- Did the lost Edition 2 library state the "not generated" rule? (E3-16.)

## Sources

- `sources/text/Endoforge-Edition-3.txt` — §1, §2, §5–§8, §10, §13–§18.
- `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt` — §4, §5.
- `sources/text/In-Isolate-Software-Workshop-v1.txt` — pp. 3, 15, 17, 24–25.
- `sources/text/Diagram-Atlas.txt` — sheets 03, 18, 24 and the register pages.
- `~/Work/field-ops-github-review/docs/receipts/FIELD-OS-MAIN-RIG-001-RECEIPT.md` (line 27) and `FIELD-OS-WORKER-FABRIC-W3W4-20261008.md` (lines 25–28, 75, 96–103).
- `docs/reference/R12-recorded-observations-versus-missing-proof.md` (receipt checks by the R12 writer, including raw `medianMs` 24.042244); `docs/reference/R14-matched-experiments-and-benchmark-programme.md` §2 (fault-count design).
- `~/Work/isolate-factory-lab/docs/CHECKERS.md`, `docs/PREDICTIONS.md`; `~/Work/isolate-factory-lab/reference/Isolate_Software_Factory/sources.json`.
- `~/Work/isolate-factory-lab-cache/ts-rust-src` (README history and tags, read 2026-10-17).
