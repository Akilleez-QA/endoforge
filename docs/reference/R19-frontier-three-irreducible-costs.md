# R19 — Frontier: the three irreducible costs

> Written 2026-10-17. This document has no Edition 2 original. It records the conversation held after the reference library was reconstructed, asking what the design is not yet thinking about and how it approaches the limits of physics. Everything here is **Proposed** unless labelled otherwise. It does not change Edition 3; it proposes what Edition 4 should change.

## Purpose

Edition 2 reasoned upward from physics (R08) but applied the reasoning to the part of the loop the project had already engineered: the compiler, the isolate, the virtual filesystem. Edition 3 noticed that four fifths of the time is model inference [E3 §10] but kept the architecture built around the workcell. This document ranks the costs by their physical weight, shows that the engineered parts are the lightest, and proposes the ten changes that would move the design toward the limit. It ends with the uncomfortable observation that the design is now ahead of its evidence.

## Summary

- Near the limit, Endoforge's cost is three things: the bits a person must supply, the weight bytes moved per generated token, and the number of evaluations that discriminate rather than confirm. Compilation and instantiation are four orders of magnitude lighter than generation (Estimated, §1).
- The most elegant missing mechanism is **candidate disagreement as the specification interface**: one generated input that separates two surviving candidates is simultaneously the cheapest discriminating test, the question for the person, and a new frozen test (§2.1).
- Local inference earns its place through **type-constrained decoding**, not through batching: the checker masks invalid tokens while the model writes, so the type-repair loop disappears (§2.2).
- The pure kernel contract makes **bounded equivalence proofs** available for refinement, replacing tens of thousands of seeded faults with a proof for that case (§2.4).
- The design is ahead of its evidence. X1 is the cheapest experiment and the one on which §2.1, §2.3 and §2.5 all depend (§4).

## 1. Where the energy goes

All figures in this section are **Estimated** from public orders of magnitude; none was measured for this project. The point is the ranking, not the digits.

| Term | Working | Order of magnitude |
|---|---|---|
| Decode one token, 70B model, 4-bit weights, unbatched | ≈ 35 GB of weights read per token; DRAM/HBM traffic ≈ 5–20 pJ/bit → 35 × 8 × 10⁹ bit × (5–20) × 10⁻¹² J/bit | 1.4–5.6 J per token |
| Generate a 1,000-token kernel | 1,000 × above | 1.4–5.6 kJ |
| Type-check that kernel | ≈ 10 ms CPU at ≈ 10 W | ≈ 0.1 J |
| Instantiate a WASM module | sub-millisecond [E3 §5] | ≈ 0.01 J or less |
| Ratio generation : checking | 1.4–5.6 kJ : 0.1 J | ≈ 10⁴ |

Batched decode reads the weights once per step for every sequence, so k candidates cost close to one in weight traffic [E3 §10]; that divides the first row by up to k but does not change the ranking. Hosted inference moves the energy off the host's meter, not out of existence.

The ranking by physical weight is therefore:

1. **Human bits.** A clarification round trip is 30 seconds when the person is present and hours when they are not [E3 §10]. It is the only term with an unbounded tail and the only one no engineering reduces directly.
2. **Weight bytes per generated token.** The dominant energy term and, with first-pass yield, the dominant latency term.
3. **Discriminating evaluation bits.** Most tests confirm what every candidate already does; only the ones on which candidates differ carry information about which to promote.
4. Everything Edition 2 optimised: compiler locality, isolate density, instantiation, virtual filesystems.

Edition 3 §12's table ("as models improve") already points this way: it ranks the evaluation plane and the invariant library above the substrate. This document takes the next step and ranks the physical terms.

## 2. Ten changes, in order of expected payoff

### 2.1 Candidate disagreement as the specification interface

When two or more candidates survive the frozen evaluator, generate an input on which they disagree (differential fuzzing between pure kernels is cheap: same input, compare outputs). That input is three things at once:

- the cheapest test that discriminates, since by construction it separates the survivors;
- the question for the person, posed as a choice between concrete outputs ("for this row, A gives 12 psi and B gives 12 psig; which is right?") rather than a sentence to confirm;
- a new frozen test once answered, with authority drawn from the person rather than from the generator's reading of intent [E3 §6, the sources of residual authority].

This merges the specification stage [E3 §6] with the search stage [E3 §11] into one loop and converts the "Ambiguous" request class [E3 §10] from an open-ended conversation into a sequence of binary choices. Each choice costs the person seconds. Prior art: version-space algebra and FlashFill (programming by example), differential testing, active learning. Dependence: it assumes most requests are ambiguous at the "too small for a project" scale, which X1 measures.

Rule it must respect: the disagreement input is generated after candidates exist, so it is not candidate-blind. It therefore never *promotes* on its own; it adds a frozen test the person authored, and promotion still runs through the frozen evaluator. The evaluator hash changes only on this outcome-independent evidence, which the "Frozen" rule permits [E3 §6].

### 2.2 Type-constrained decoding

With a local model, the type checker can run inside the decoder and mask tokens that cannot continue a well-typed program (grammar- and type-constrained decoding is established technique). The type-error repair round, estimated at about half a round for Rust and more for AssemblyScript [E3 §5], goes to approximately zero, and tokens spent on malformed output are never generated.

This is the strongest argument for co-locating the checker and the model in one memory space, stronger than the batching argument [E3 §10], and it is something hosted inference cannot offer. It changes X5: the local arm should be measured with constrained decoding on, since that is the configuration in which local inference wins rather than merely matches.

Dependence: a checker with an incremental, token-granular interface. tsc-rs has no language-service mode [E3 §14; R07]; AssemblyScript and MoonBit compilers would need the same. This is a WP, not a given.

### 2.3 Sketches, not programs

Have the model write the structure with holes (a sketch) and let deterministic search fill the holes against the frozen evaluator: enumeration over a small grammar, or SMT where the hole is arithmetic or a predicate. Tokens generated fall by an order of magnitude for the common case, and the hole-filling is exhaustive rather than sampled, so it does not add correlated error.

This is Edition 2 §7's "the model proposes a strategy and a bounded variation space; deterministic machinery explores it", given a concrete mechanism (Sketch/Rosette-style synthesis). Dependence: X1's finding on how much of a typical residual is structural versus parametric.

### 2.4 Prove refinements rather than test them

The kernel contract (pure functions, state in and out, no ambient authority [E3 §5]) makes bounded equivalence checking practical:

- a Rust rewrite of an AssemblyScript kernel can be checked for equivalence on all inputs up to a bound, or symbolically on the WASM itself (both modules are WASM, so one tool serves both);
- small finite domains (enumerations, unit tables, status transitions) can be checked exhaustively.

Where a proof is available, the refinement case needs no seeded-fault budget at all: R14 §2's 2,995–29,956 faults per domain are for the *generation* case, where there is no reference implementation. Refinement has one. This is the single largest reduction in evaluation cost available and it is a direct consequence of the candidate shape Edition 3 chose.

### 2.5 Retrieval by behaviour, not by model call

Edition 3 says retrieval is semantic search and therefore a model call [E3 §12]. It need not be:

- run the library's kernels on the person's examples and keep those that agree (execution is microseconds per kernel);
- index contracts by type signature plus a behavioural fingerprint (outputs on a canonical input set), so lookup is a hash join.

If request popularity is skewed (Zipf-like, which X1 can test by clustering its twenty requests), most requests hit the library and the factory is a cache with a generator behind it. The cache hit rate then becomes the headline performance number, and it is the one that compounds. R04's "composable from the library: 0.5–2 s" becomes milliseconds for the hit case.

### 2.6 Batch evaluation as derived data

Pure kernels give three properties that the evaluator should exploit: results are cacheable by (code hash, input hash); candidates that differ only in parameters share one module instance; and evaluation can be loop-inverted (tests outside, candidates inside) so each input is loaded once and every candidate streams over it while it is in cache. R07's shared candidate families and R06's batching become one mechanism, and it is Scion's and Mononoke's derived-data idea applied one level down (docs/studies/scion/STUDY.md). Numeric families go to the GPU where R09's placement allows.

### 2.7 Implementations are a cache; the contract is the asset

When the SDK or host changes, manufacture a new implementation against the retained contract rather than migrating old code. This resolves the "code is a liability" tension in R04 and E3 §12 by construction: contracts, invariants and counterexamples are kept; implementations are regenerated and re-qualified lazily on next use, exactly like derived data. RISK-05 (SDK and host churn) becomes a cost, not a correctness problem.

### 2.8 Never generate from real data

Generate only from schema, synthetic data and examples the person approved. Real data reaches only the running kernel, through host-owned buffers. RISK-04 (retained capabilities as injection vectors) is then closed structurally rather than by review, which Edition 3 itself names as the binding constraint [E3 §13]. It also makes tenant-bound lineage [E3 §12] simpler: a kernel that never saw tenant data has no tenant lineage to carry.

### 2.9 Accepted outputs train a factory-specific model

The factory produces verified (request, contract, kernel) triples. Those are training data for a smaller model specialised to the factory's SDK and kernel contract, raising first-pass yield and reducing weight bytes per token — the only lever on the dominant physical term (§1) that compounds. Edition 3 deliberately leaves the model untouched; this is where that choice costs the most. Constraint: only data-free contracts and kernels (§2.8) may be used, which tenant-bound lineage already requires.

### 2.10 Deliver an approximation immediately, then swap

Hand over the closest composable approximation from the library (§2.5) within a second, with its contract shown, and swap in the qualified version when ready using the pinned-incumbent mechanism the design already has [E3 §4, §9]. Perceived latency approaches zero without changing the floor. The approximation must be labelled as such in the legibility surface (R04 §9) so the person never mistakes it for the qualified result.

## 3. What this does to the architecture

| Edition 3 element | Change proposed here |
|---|---|
| Specification stage (§6) | Gains a post-candidate loop: disagreement inputs become person-authored frozen tests (§2.1). The blind-and-before rule still governs the initial residual. |
| Route table (§5) | Every in-isolate route needs a token-granular checker interface for §2.2; add this as a column. |
| Trust table (§7) | Add "Proof" as an error source for refinement cases (§2.4), independent of the model. |
| Library (§12) | Retrieval is deterministic first, model second (§2.5). Implementations are derived data (§2.7). |
| Risks 4 and 5 (§13) | Closed structurally (§2.8, §2.7) rather than by review. |
| X5 | Local arm measured with constrained decoding on (§2.2). |
| X1 | Add: cluster the twenty requests for popularity skew (§2.5); classify each residual as structural or parametric (§2.3). |

## 4. The uncomfortable part

Three editions in four days have sharpened the design; no rung of the claim ladder above rung 2 has moved, and the lab has no campaign results (R12). The design is ahead of its evidence. Of the ten changes above, §2.1, §2.3 and §2.5 depend on facts about real requests (ambiguity, structure, popularity skew) that nobody has measured. X1 measures all three, needs no engineering, and is the cheapest experiment in the programme. It should run before any of §2 is built.

## Edition 3 alignment

Nothing here contradicts Edition 3's commitments; each change is an application of one of them (pure kernels, frozen evaluators, the library as the compounding asset, trust as a measured quantity). What changes is the ranking of effort: from the workcell toward the model term, the specification interface and discriminating evaluation. If adopted, this is the main content of Edition 4.

## Open questions

- Is the disagreement loop (§2.1) safe against a candidate population that agrees on a wrong answer? (It is not; it only separates survivors. Candidate-blind residual tests remain necessary. Document the failure mode in R15.)
- What fraction of X1's requests have structural residuals (§2.3) versus parametric ones?
- Does any current in-isolate compiler expose a token-granular checking interface (§2.2)?
- What bound makes bounded equivalence (§2.4) convincing for a given domain, and who sets it?

## Sources

- `sources/text/Endoforge-Edition-3.txt` §4–§7, §9–§13, §15.
- `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt` §7, §11.
- R04, R06, R07, R08, R09, R12, R14, R15; `docs/studies/scion/STUDY.md`.
- Public orders of magnitude for DRAM energy per bit and model sizes; none measured here.
