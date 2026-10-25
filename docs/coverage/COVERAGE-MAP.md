# Coverage map

> Reconstructed 2026-10-17. The original coverage map was not available; this version is rebuilt from
> the section lists of Edition 3, Edition 2 and the white paper (`sources/text/`), and from a citation
> scan of every document in `docs/` made on 2026-10-17. Content follows Edition 3 where the editions differ.

## Purpose

This map says, for every section of Edition 3 (§1–§18), every section of Edition 2 (§1–§15 and Appendices A and B), and every section of the white paper (sections 01–24), which documents in this repository carry it, and marks what is only partly carried or not carried at all. Edition 2 says its coverage map traced each major topic into the central document and the retained studies [E2 Appendix A]; this version traces each source section into the reconstructed library instead. It is a finding aid, not evidence: a document "carrying" a section means it restates and aligns that section, not that anything in it was established.

## Summary

- Every Edition 3 section is carried. Three are carried only in a distributed way, with no single reference document: §6 (specification), §7 (trust as a measured quantity) and §8 (the model writes all of the code). Edition 2 had no chapter for them, so the reconstructed R-series has none.
- Every Edition 2 section is carried. Two items are partly carried: Edition 2's four concept maps (Appendix A) are not reproduced, and its Python and Javy intake routes (§4) survive only as notes because Edition 3 has no route for them (E3-11).
- Every white-paper section is carried, most as superseded design. Section 04's list of runtime-fabric responsibilities is only partly carried.
- Inconsistencies inside Edition 3 are tracked in [`EDITION-3-ERRATA.md`](EDITION-3-ERRATA.md) and are cited here by erratum ID.
- The diagram atlas is cited throughout the library but is not mapped sheet by sheet here.

## How to read the tables

| Status | Meaning |
|---|---|
| Carried | One or more documents restate the section and align it to Edition 3 |
| Carried (distributed) | The content is present, but spread across several documents with no single owner |
| Partly carried | Some named content of the section has no home; the gap is stated |
| Not carried | Nothing in the repository carries it |

Document references: R01–R19 are `docs/reference/`; `PLAN` is [`docs/execution/EXECUTION-PLAN.md`](../execution/EXECUTION-PLAN.md); `WPnn` is a package in [`docs/execution/WORK-PACKAGES.md`](../execution/WORK-PACKAGES.md); `Cnn` is a record in [`docs/execution/campaigns/`](../execution/campaigns/); templates are in `docs/templates/`; `CONV` is [`docs/CONVENTIONS.md`](../CONVENTIONS.md). Page numbers for the white paper are PDF pages; section NN starts on page NN + 1.

## 1. Edition 3 (17 October 2026)

| § | Title | Carried by | Status | Notes |
|---|---|---|---|---|
| 1 | The idea in one page | R01 §1–§2, §4–§5; R16 DEC-41 | Carried | E3-01 (generated JavaScript does run, in the compatibility lane); E3-06 ("a minute or two" versus §10) |
| 2 | How to read this document | CONV (labels); R16 (reversals); R17 | Carried | E3-04 (24.04 ms missing from §14); E3-18 (four versus six risks) |
| 3 | Two products, one substrate | R01 §3; R04; R16 DEC-42; R15 RISK-11; PLAN §1; C01 | Carried | |
| 4 | The production cycle | R02 §9; R04 §2; R13; WP27 | Carried | |
| 5 | The candidate is a pure kernel plus declarative glue | R03; R06 §2; R16 DEC-46, DEC-47; WP13, WP15, WP19–WP22, WP26; C04 | Carried | E3-01, E3-02, E3-07–E3-11, E3-13 |
| 6 | Specification is a subsystem | R02; R05; R11 (frozen evaluator); R14 X2; R16 DEC-43; R17; WP06, WP08–WP10; C02, C17 | Carried (distributed) | No reference document is dedicated to specification. E3-21, E3-22 |
| 7 | Trust is a measured quantity | R05 §6; R14 X3 and §2; R15 RISK-07, RISK-08, RISK-10, RISK-29; R16 DEC-44, DEC-45; R17; WP11, WP12; C03, C08 | Carried (distributed) | No dedicated reference document. E3-03 (thresholds without sample sizes) |
| 8 | The model writes all of the code | R16 DEC-05 → DEC-48, DEC-49; R11 (POODO fields); R17; templates/CAMPAIGN-PRECOMMIT.md | Carried (distributed) | No dedicated reference document. E3-15, E3-16, E3-21 |
| 9 | Three lifetimes and the boundaries that hold | R02 §3; R11 (outcome unknown, reclamation); R12 §2.3; R16 DEC-06, DEC-07, DEC-58; WP16–WP18; C15 | Carried (distributed) | |
| 10 | Where the time goes | R01; R06 §1, §4; R09; R19 §1; C05, C16, C17 | Carried | E3-06, E3-25 |
| 11 | Search and improvement under a protected contract | R05; R14 §4; R16 DEC-35, DEC-57; C08, C13, C18 | Carried | |
| 12 | The library is inventory | R04 §5–§9; R16 DEC-52, DEC-61, DEC-62; WP29, WP31; C12 | Carried | |
| 13 | Deployment lanes and named dependency risks | R03; R08 (two consequences); R09; R15 RISK-01–RISK-06; R16 DEC-50, DEC-53, DEC-58–DEC-60; R18; R19; WP05, WP25; C06 | Carried | E3-09, E3-18, E3-19 |
| 14 | What is recorded today | R12 §2–§3, §5 | Carried | E3-04, E3-13, E3-14, E3-23, E3-24, E3-26 |
| 15 | The first six experiments | R13; R14; R16 DEC-54, DEC-55; PLAN; WORK-PACKAGES; C01–C07 | Carried | E3-02, E3-03, E3-12, E3-14 |
| 16 | Prior art and positioning | R01 §6; R07 §1.3; R16 DEC-63; R18 SRC-59–SRC-79; `studies/mononoke/`, `studies/scion/` | Carried | Prior-art sources are cited by name only in Edition 3; R18 records no read dates for them |
| 17 | The claim ladder | R12 §6; R01 §7; PLAN §2 (rung per stage); every C-record §2 | Carried | E3-23 (rung 1 omits lab smoke runs) |
| 18 | Sources and identities | R18; R12 §3 | Carried | E3-05, E3-17 (two numbering schemes) |

## 2. Edition 2 (16 October 2026)

| § | Title | Carried by | Status | Notes |
|---|---|---|---|---|
| Front | The complete story (opening passage) | R01 §6; R16 | Carried | |
| 1 | Software becomes something the runtime can make | R01 §1 | Carried | |
| 2 | One system, not a bundle of adjacent features | R01; R02 | Carried | |
| 3 | The factory is the production machinery | R02; R06 §1.7; R11 | Carried | |
| 4 | The broad funnel: admit quickly, refine selectively | R03; R06; R07 | Partly carried | Python and Javy routes have no Edition 3 route; R03 and R18 SRC-50 record them as dormant (E3-11) |
| 5 | One request through the entire factory | R04 §2 (rewritten in Edition 3's five boundaries); R02 | Carried | |
| 6 | Improvement is a controlled production process | R05; C13 | Carried | |
| 7 | The next frontier is removing repeated understanding | R07; R06; C09–C11 | Partly carried | Campaign specialisation (R07 §7) has no campaign record yet (PLAN §5) |
| 8 | The memory and trust architecture must support the idea | R02 §3; R03; R06 §1.6; R09 §5; R11; R16 DEC-06, DEC-07; WP16–WP18 | Carried (distributed) | Its inner-boundary topology discussion is superseded by the kernel contract (R13 §4) |
| 9 | Retained software is the compounding asset | R04 §5; R16 DEC-34 → DEC-52 | Carried | Superseded in emphasis: contracts, not code, compound [E3 §12] |
| 10 | The ledger belongs inside the factory, not at its center | R10; R11; `studies/mononoke/`; `studies/scion/`; WP04 | Carried | |
| 11 | Reason upward from physics | R08; R19 | Carried | Reduced to two consequences in Edition 3 (DEC-51) |
| 12 | Unified-memory systems are a physical fit, not an automatic win | R09; templates/HARDWARE-QUALIFICATION.md; WP03; C05, C16 | Carried | |
| 13 | The applications are expressions of the same substrate | R01; R04 | Carried | |
| 14 | What is supported now, and what remains to be demonstrated | R12; R01 §7 | Carried | Six-rung ladder became seven in Edition 3 |
| 15 | From today's components to the possible | R13; R14; PLAN; WORK-PACKAGES | Carried | Build order changed by Edition 3 (DEC-54) |
| App A | Reading the supporting studies as parts of one system | `docs/INDEX.md`; this map; PLAN | Partly carried | The four new Edition 2 concept maps are not reproduced as diagrams anywhere in this repository |
| App B | Source and status key | CONV; R18 | Partly carried | Edition 2's "Illustrative" and "Speculative" labels have no equivalent in CONV's label set; readers should treat Illustrative as Derived from stated assumptions and Speculative as Proposed |

## 3. White paper, *The In-Isolate Software Workshop* v1.0 (14 October 2026)

| Section | Title | Pages | Carried by | Status | Notes |
|---|---|---|---|---|---|
| Cover | Figure 1 and central thesis | 1 | R01 | Carried | |
| 01 | The concept and the bigger picture | 2 | R01; R16 DEC-03 | Carried | |
| 02 | Reading guide, terminology and evidence | 3 | R17; CONV | Carried | The white paper's evidence legend (Observed, Upstream-reported, Derived, Proposed) is mapped in R17 |
| 03 | The complete workshop inside the isolate | 4 | R03; R07; R16 DEC-03, DEC-04 | Carried | Superseded design (QuickJS guest, TypeScript-centred) |
| 04 | The runtime fabric around the workshop | 5 | R16; R17; R04 §1 | Partly carried | The list "responsibilities a senior engineer should preserve" is not restated item by item |
| 05 | Reuse the machinery, not the mission heap | 6 | R02; R04; R06 §1.2–§1.3 | Carried | |
| 06 | Agentic coding: a fast inner loop | 7 | R01; R02 | Carried | |
| 07 | Generative UI becomes working software | 8 | R04; R05; R01 | Carried | |
| 08 | Swarm hill climbing | 9 | R05; R17; R15 | Carried | |
| 09 | Build a trustworthy optimization loop | 10 | R05; R02; R01 | Carried | |
| 10 | Performance model | 11 | R06 §4; R02 | Carried | |
| 11 | Upstream-reported compiler results | 12 | R12 U01–U04; R18 SRC-21–SRC-25 | Carried | |
| 12 | WASM turns the compiler into a runtime component | 13 | R07 §1.1; R12 U05; R09; R03 | Carried | E3-24 (4.2 MB not reproduced at v0.7.0) |
| 13 | Platform implications | 14 | R03; R14; R12 U06; R18 SRC-29–SRC-42; C06 | Carried | |
| 14 | Cloud implications, prior art and differentiation | 15 | R01 §6; R15; R16; R18 | Carried | Two conflicting workerd pins recorded at R18 SRC-37 |
| 15 | Field OS: one application of the substrate | 16 | R01; R13 §5; R18 SRC-10–SRC-20 | Carried | |
| 16 | Recorded performance: cold and warm | 17 | R12 §2.1, §2.4; R02; R06 §2 | Carried | |
| 17 | Containment, limits and failed observations | 18 | R12 §2.1–§2.2; R09 §11; R02 | Carried | |
| 18 | Recovery and test qualification | 19 | R12 §2.3; R16 DEC-07 | Carried | |
| 19 | Contracts and implementation interfaces | 20 | R03; R04; templates/RECEIPT.md; WP13 | Carried | |
| 20 | Operating the substrate across hosts | 21 | R02 §4; R06 §1.7; R15; WP16–WP18 | Carried | |
| 21 | Validation plan | 22 | R14 §3; R04; C07 | Carried | Arms B and C superseded (R14 Edition 3 alignment) |
| 22 | What changes if the complete loop works | 23 | R01; R13 | Carried | |
| 23 | Repository evidence and frozen identities | 24 | R12; R18 | Carried | Numbering differs from Edition 3 (E3-17) |
| 24 | Public primary sources | 25 | R18; R15 | Carried | |

## 4. Documents with no source section

| Document | What it is |
|---|---|
| R19 | Frontier proposals for a future edition; no Edition 2 original |
| [`EDITION-3-ERRATA.md`](EDITION-3-ERRATA.md) | Inconsistencies found in Edition 3 |
| `studies/scion/STUDY.md` | Primary-source study of Scion, written after Edition 2 |
| `experiments/` | De-risking probes; results labelled Recorded (probe), never campaign results |
| C08–C18 | Campaign drafts derived from open questions in R04–R11 and R15, not from a single source section |

## Edition 3 alignment

- **Changed.** Edition 2's coverage map traced conversation topics into the Edition 2 narrative [E2 Appendix A]. Edition 3 now governs, so this map traces source sections into a library aligned to Edition 3.
- **Still holds.** The coverage map is a finding aid; document rendering and package integrity checks do not establish runtime correctness or performance [E2 Appendix B].

## Open questions

- Should a dedicated reference document carry Edition 3 §6–§8 (specification, trust, model as author)? It would remove three "distributed" rows. It needs a new identifier, since R01–R18 map to Edition 2's numbering.
- Should the diagram atlas be mapped sheet by sheet? Every sheet is cited somewhere, but no table proves it.
- Should Edition 2's concept maps be redrawn as Mermaid? They summarise a superseded build order, so the value is low.

## Sources

- `sources/text/Endoforge-Edition-3.txt` (§1–§18), `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt` (§1–§15, Appendices A–B), `sources/text/In-Isolate-Software-Workshop-v1.txt` (sections 01–24).
- Citation scan of `docs/reference/*.md`, `docs/studies/*/STUDY.md`, `docs/templates/*.md` and `docs/coverage/EDITION-3-ERRATA.md` for `[E3 §n]`, `[E2 §n]` and `[W p.n]`, 2026-10-17.
- `docs/execution/` (this library's execution documents).
