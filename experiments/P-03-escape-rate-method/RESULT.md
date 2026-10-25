# P-03 escape-rate-method — result

**Label: Recorded (probe).** One run on a shared desktop, no quiet gate, no replication. Never citable as an X3 result or as deciding any X1–X6 experiment.

**This probe validates the METHOD, not Endoforge's escape rate.** The task is a toy, the kernel is plain JavaScript, the evaluator is a hand-written stand-in, the mutants are not real generator errors, and every rate below is a property of this toy harness against this toy fault set. Nothing here says anything about what a Field OS evaluator would let through.

## Question

Does the seeded-fault (escape-rate) method work end to end on a toy task — three-layer harness, four fault strata, equivalent-mutant filtering by differential execution, exact Clopper–Pearson reporting — and does disagreement-input generation (R19 §2.1) separate surviving candidates?

De-risks: X3 method (R14 §2), R19 §2.1, RISK-10, E3-03, E3-22. (The brief cited E3-25 for the six-case fixture; E3-25 is the decode-bandwidth erratum. The fixture erratum is E3-22, and this probe exercises its unit/basis and reversed-input shapes.)

## Procedure as run

Precommit `PRECOMMIT.md` hashed to `receipt/precommit.sha256` (`a3f1af41…b139`) at 17:04:25Z, before any measurement. Reference kernel `src/kernel.mjs`: `kernel(state, event) -> {state, effects}`, joins pressure readings (psi | psig | kPa | bar, basis gauge | absolute, source ids) to a reference table, converts to a target unit and basis via an atmosphere value when a basis shift is needed, classifies |delta| against inclusive minor/major tolerances, emits one row per reading carrying every contributing source id, and a totals summary.

Evaluator `src/evaluator.mjs` + `src/inputs.mjs`, three layers as Edition 3 §6 describes:

| Layer | Checks | Inputs |
|---|---|---|
| Universal gates | schema validity; determinism (two runs compared); forbidden effects (only `emit`/`summary`, exactly one each on a reconcile event, none otherwise); resource bound (50 ms wall, a throw fails); purity (inputs not mutated) | 60 seeded random inputs (seed `0x5eed0001`) |
| Domain invariants | dimensional consistency against an independently written conversion (rel. 1e-9); source-bound return (every cited source exists; converted cites reading + atmosphere when shifted; expected cites the reference row); totals reconcile (one row per reading in order, class counts sum, unmatched-reference count); idempotence (second application on the returned state reproduces state and effects) | same 60 |
| Task residual | six example tests R1–R6 derived from the plain-language statement in the evaluator | hand-written |
| Holdout (reports only) | six further examples H1–H6 used by no layer | hand-written |

Freeze: `receipt/evaluator.sha256` written before `src/mutants.mjs` existed. **The evaluator was revised once (v1 → v2) for robustness, before any harness outcome had been written or read**: the first two runs crashed inside the invariants layer on mutant output (a reconcile result with zero effects; a row citing a non-existent reading). v2 adds a precondition guard and makes every invariant check exception-safe (a checker exception is a failure of that invariant). No tolerance, test, input or judgement changed. Both hashes are kept (`evaluator.sha256.v1` = `4432014f…81b9`; v2 = `bdf09502…4331`); all results are under v2; see `receipt/evaluator-revision-1.md`. Under R14 §2.3 this is a new evaluator, which is why it is reported this way rather than hidden.

Mutants (`src/mutants.mjs`): each an edit list over the reference source, compiled with `new Function`.
- **S1 mechanical**: every single-site application of a fixed operator table (relational/equality/arithmetic/logical swaps, negation drop, condition negation, numeric constant ±1/×2/×10/negate/zero, `null`↔`undefined`, vocabulary string flips and emptying, identifier swaps within type classes, `===`→`==`, `Math.abs` removal, initialiser→`undefined`, return-value swaps, single-statement and single-line control deletion, ternary branch swap). 303 generated.
- **S2 domain-semantic**: 24 hand-written (psig no longer forces gauge; drop missing-basis rows; wrong psi and bar factors; cite the reading id instead of its source; reverse join direction; treat absolute as gauge; shift in the wrong direction; atmosphere source not cited; atmosphere added in the source unit; reference source never cited; exclusive minor boundary; unmatched count inverted; totals.rows counts only converted rows; no-reference → unconvertible; target basis ignored; target unit ignored; delta sign reversed; unresolvable basis as zero; join consumes the reference row; prior state discarded; negative gauge clamped; psi also forced gauge; missing basis defaults to gauge).
- **S3 model-plausible**: 22 hand-written (unit lookup case-insensitive; missing basis defaults absolute; early return on empty readings / empty reference; mutable aliasing of `state.seen`; loosened event-type check; epsilon-tolerant boundary; rounding to 3 dp; sorted sources; duplicate-source guard dropped; major tolerance widened by minor; totals keys uninitialised; first-wins reference map; case-insensitive basis; `reading_id` fallback; atmosphere required even without a shift; `kPa` key typo; rounded psi factor; state keyed by reading id; effects order swapped; absolute-valued delta; matched only when the reading resolves). Three are labelled *spec-ambiguous* in the source (source order, duplicate sources, effect order), two *expected equivalent*.
- **S4 searched** (as precommitted): compose pairs of the top-scoring non-equivalent S1–S3 mutants (score = checks passed), non-overlapping edits, ≥ 50 pairs. 56 generated from the top 12.
- **S4b (post-hoc, not in the precommit; reported separately, excluded from ALL)**: compose pairs of the top-scoring *killed* mutants. Added after the first complete run showed the precommitted S4 degenerates (below). 52 generated.

Equivalence filter: differential execution against the reference over 2,000 seeded inputs (seed `0x5eed0002`, disjoint from the invariant set), comparing the JSON of the result **and of the inputs after the call** (so aliasing is a difference). Never-differing mutants are equivalent and excluded from n. Uncompilable mutants are excluded and counted.

Harness: every non-equivalent mutant through all three layers; escape = all three pass. Layer contributions: universal + invariants only (residual removed), universal + residual only (invariants removed), universal alone. Clopper–Pearson implemented in `src/stats.mjs` (regularized incomplete beta + bisection); checked against R14 §2.1: one-sided upper bound at 0/2,995 = 0.0010, 0/29,956 = 0.00010, 1/4,742 = 0.0010, and C6a's 0/1,081 = 0.28 %.

Disagreement: for every pair among {reference} ∪ escapees (69 → 2,346 pairs), fresh random inputs (seed `0x5eed0003`) until the two differ, cap 20,000. The first reference-vs-escapee disagreement is answered for the reference (the reference is this probe's oracle; a person would answer), frozen as test D1 (`receipt/frozen-disagreement-test.json`), and every escapee re-run under evaluator v2 + D1 (hash `receipt/evaluator-plus-frozen-test.sha256`).

Run: `node run.mjs` (verifies the precommit and evaluator hashes first; deterministic apart from timings). Final run 17:12:49Z–17:12:59Z (git `cdb5d3c`, `experiments/` untracked), AMD Ryzen 9 7950X (32 logical), kernel 7.2.5-3-omarchy, Node v26.8.1, load average 27.3 before / 25.8 after (shared desktop, other work running).

## Results

Reference kernel passes all three layers and the holdout (546/546 checks).

### Mutant counts and escape rates (full harness; CP two-sided 95 %; one-sided 95 % upper = the tier bound)

| Stratum | Generated | Uncompilable | Equivalent | **n (non-equiv.)** | **Escapes** | Point | CP 95 % | One-sided upper |
|---|---|---|---|---|---|---|---|---|
| S1 mechanical | 303 | 1 | 20 | **282** | **5** | 1.8 % | [0.58 %, 4.09 %] | 3.69 % |
| S2 domain-semantic | 24 | 0 | 1 | **23** | **1** | 4.3 % | [0.11 %, 21.9 %] | 19.0 % |
| S3 model-plausible | 22 | 0 | 2 | **20** | **6** | 30 % | [11.9 %, 54.3 %] | 50.8 % |
| S4 searched (compose top scorers) | 56 | 0 | 0 | **56** | **56** | 100 % | [93.6 %, 100 %] | 100 % |
| **ALL (S1–S4)** | 405 | 1 | 23 | **381** | **68** | 17.8 % | [14.1 %, 22.1 %] | 21.4 % |
| S4b post-hoc (compose top killed) | 52 | 0 | 0 | 52 | 0 | 0 % | [0 %, 6.85 %] | 5.60 % |

Equivalent fraction in S1: 20/302 compiled = 6.6 % (precommit bad-sign threshold 40 %). The 23 equivalents: 10 `===`→`==` and 3 `!==`→`!=` (genuinely equivalent on these value types), 5 `null`↔`undefined` in positions where only truthiness matters, 1 `&&`→`||` in a dedupe guard, S3 "first-wins reference map" and "`reading_id` fallback" (predicted equivalent), and three that are **not** equivalent in general but are equivalent **under this input distribution**: S1-285 (delete `if (basis === null) return null` in the converter), S2-322 (unresolvable basis treated as zero pressure) — the random generator never emits a reference row with an unresolvable basis (psig overrides any garbage basis), so that path is only reached by holdout test H4. Equivalence is relative to the differential input set, exactly as R14 §2.3 warns ("extended input set").

### Layer contributions (escapes / n, full population n = 381 unless noted)

| Configuration | S1 (282) | S2 (23) | S3 (20) | S4 (56) | ALL (381) |
|---|---|---|---|---|---|
| Universal gates only | 169 | 23 | 14 | 56 | 262 (68.8 %) |
| Universal + invariants (residual removed) | 68 | 4 | 7 | 56 | 135 (35.4 %) |
| Universal + residual (invariants removed) | 17 | 4 | 9 | 56 | 86 (22.6 %) |
| **Full harness** | **5** | **1** | **6** | **56** | **68 (17.8 %)** |

First-failure attribution over all 381: universal gates killed 119 (schema 83, resource bound/throw 25, forbidden effects 10, purity 1 — the aliasing mutant); invariants killed a further 127 (dimensional 79, totals 34, source-bound 14); the residual killed a further 67 (R1 24, R2 15, R4 12, R3 7, R5 7, R6 2); 68 escaped. In S2 the universal gates killed nothing (23/23 pass them) and the invariants killed 19/23: the domain-semantic faults are exactly the ones the invariant layer exists for. The six example tests alone (with universal gates) would have let 86 through; the invariants alone 135; both together 68 — the layers overlap but neither subsumes the other, which is the design intent of §6.

### The 12 base escapees (S4's 56 are compositions of these)

| Id | Fault | Why it escaped | Holdout |
|---|---|---|---|
| S1-155…159 | the `'unconvertible'` literal in the *reference-side* unconvertible branch replaced by each other class | branch only reached when the reference needs a basis shift and no atmosphere is given (or the reference basis is unresolvable); no residual example covers it | H4 fails all five |
| S2-324 | prior `state.seen` discarded | idempotence and R6 only look at points present in the current event | passes |
| S3-334 | epsilon-tolerant minor boundary (1e-9) | differs only on near-boundary floats the examples do not hit | passes |
| S3-336 | `row.sources` sorted | spec-ambiguous: no layer fixes source order | passes |
| S3-337 | duplicate sources allowed in `row.sources` | spec-ambiguous: invariants use `includes` | passes |
| S3-338 | major tolerance widened by the minor tolerance | R3 tests exactly at the major boundary and far beyond it, not in the widened band | passes |
| S3-343 | atmosphere required even when no shift is needed | the invariants check every *converted* value but never that a convertible reading *was* converted (no completeness invariant), so over-reporting `unconvertible` is invisible to them; R5's atmosphere-null example needs a shift anyway | passes |
| S3-347 | effects order swapped | spec-ambiguous: forbidden-effects gate is order-insensitive | passes |

Holdout: 5 of the 12 base escapees (and 35 of the 56 S4 composites) fail the holdout. The holdout caught the one family a sixth example would have caught (H4) and missed the other seven.

### Searched stratum

As precommitted, S4 composed the top-12 by score — which were the 12 escapees themselves — so all 56 compositions escaped (100 %, CP [93.6 %, 100 %]). This is a tautology, not a measurement: composition of two faults that each escape, in independent code sites, escapes. The post-hoc S4b (compose the top-scoring *killed* mutants) produced 52 non-equivalent composites and **0 escapes** (one-sided upper 5.6 %); all 52 were killed by the residual alone after passing universal gates and invariants, exactly as their parents were. Composition did not turn two near-misses into an escape here. Neither S4 variant is R14's S4 (a search campaign proposing wrong candidates against an oracle); both are proxies.

### Disagreement inputs (R19 §2.1)

- 2,346 pairs among reference + 68 escapees; a disagreeing input was found for 2,331 (99.4 %). **Median draws to disagreement: 1** (p95 42, max 20,000 = cap). Reference-vs-escapee pairs: 50 found at draw 1, 7 at draw 3 (S3-343 family), 10 at draw 42 (S1-155 family), 1 at draw 240 (S3-334, the epsilon boundary).
- 15 pairs not found in 20,000 draws: all are {S3-343, or an S4 composite containing S3-343} vs {another S4 composite containing S3-343 and one of S1-155…159}. These are genuinely equivalent to each other: S3-343 makes every atmosphere-null row unconvertible on the reading side first, so the S1-155 edit in the reference-side branch becomes unreachable. The precommit's bad sign ("not found for a pair the filter showed non-equivalent") does not apply: the filter showed each non-equivalent to the *reference*, not to each other.
- **Example choice (reference vs S1-155, found at draw 42):** input with `atmosphere: null`, target bar absolute, reading `rd-0` at `pt-05` = 40.0961 psi absolute from `src:sensor-9`, reference for `pt-05` = 26.2276 psig from `ref:table-1#4`. For row 0, **A (reference) says `unconvertible`** (the reference value needs gauge→absolute and there is no atmosphere), **B (S1-155) says `match`**. Which is right? Answering "A" is a one-bit question, and it is a question the plain-language statement actually answers.
- **Frozen as D1 and re-run:** of the 68 previously escaping mutants, **58 are now killed** (all five S1-155…159, S3-337, S3-343, S3-347, and 50 S4 composites); **10 still escape**: S2-324 (state discarded), S3-334 (epsilon boundary), S3-336 (sorted sources), S3-338 (widened major band), and six S4 composites of those. One person-authored input removed 85 % of the survivors because the survivors were dominated by one family (S1-155…159 and their 35 composites) plus three faults that happen to show on the same input. Those still escaping need inputs of a different shape (a prior state; a near-boundary float; a question about source order).

### Cost

Full harness per non-equivalent mutant (60 inputs × 5 gates × 2 runs + 60 × 4 invariants + 6 + 6 tests): **median 4.65 ms**, p95 7.51 ms, min 1.13 ms, max 9.30 ms, n = 381 (an earlier identical run at load ≈ 12 gave median 2.79 ms; samples in `receipt/harness.jsonl`). Differential filter per mutant: median 0.17 ms (early exit on the first difference), p95 23.8 ms, max 31.3 ms (full 2,000 inputs for the equivalents). Whole run including mutant generation, 2,346 disagreement searches and the re-run: **10.2 s**. R14 §2.4 assumed 0.1–1 s per full harness run; a toy kernel in-process is 20–200× under that, so for a real kernel the harness cost will be dominated by the kernel route and instantiation, not by the layers.

## What this does not show

- **Nothing about Endoforge's escape rate.** The rates above are properties of a hand-written toy evaluator against a hand-written toy fault set on a 110-line JavaScript kernel. They are not an X3 result, not a tier, not a bound on any real evaluator, and must not be cited as one.
- **The mutants are not real generator errors.** S1 is a fixed operator table; S2 and S3 were written by the same author who wrote the kernel and the evaluator, so they are correlated with the evaluator's prior (R14 §2.4 warns about this for S3 and it applies to S2 here too). S4 is composition, not search; S4b is post-hoc.
- **The evaluator is a stand-in**, not a Field OS invariant library, not a synthesized residual, not blind (the author saw the kernel). It was also revised once for robustness after it crashed on mutant output; under the campaign rule that is a new evaluator and a new fault set, which this probe approximated by regenerating the deterministic fault set.
- **One run, one machine, no quiet gate.** Load average was 25–27 on a shared desktop; timings are indicative only. No confidence interval is claimed on any timing.
- **Equivalence is relative to the input generator.** Three mutants were called equivalent that a different generator would kill (S1-285, S2-322, and the near-equivalent S3-334 only escaped because the boundary region is thin). With n this small the CP intervals are wide and the point estimates are not meaningful beyond ordering.
- **The disagreement loop was answered by the reference, not a person.** The "choice" step is therefore a demonstration of the mechanism (find input, pose the choice, freeze, re-run), not evidence about how people answer or how long they take.
- **S4 as precommitted degenerated.** The 100 % figure for S4 is a tautology and should not be read as "search defeats the harness".
- The kernel was run in-process in Node, not in any isolate or route; nothing here speaks to Wasmtime, AssemblyScript or the kernel contract.

## Interpretation

The method works end to end at toy scale: precommit → freeze → stratified faults → differential equivalence filter → three-layer harness → per-stratum exact bounds → disagreement inputs → person-authored frozen test → re-run, in 10 seconds, with every number reproducible from the receipt. Seven things worth carrying into WP09–WP12 and the X3 precommit:

1. **The evaluator must be total over arbitrary candidate output.** Both crashes were in the invariants layer dereferencing structure that a mutant's output lacked. A real harness should treat a checker exception as a kill and log it as an evaluator defect, and the X3 precommit should say so, or the first crash becomes an unplanned evaluator revision mid-campaign.
2. **The layers contribute separately and the ordering matters.** Universal gates removed 31 % of non-equivalent faults, the invariants another 33 %, six examples another 18 %. The invariants killed 19/23 domain-semantic faults; the examples killed 3 more; one escaped. This is the §6 picture — fixed layers do most of the work — but on this toy the residual still carried 18 points. "Make the residual thinner" is measurable in exactly this form.
3. **Equivalence filtering is an input-distribution claim.** Report the equivalent fraction with the generator's coverage, and extend the differential set with the holdout and any person-authored inputs; the filter should at least include every input the residual and holdout use.
4. **Escapes cluster by code site**, not by stratum: 5 of 12 base escapees and 35 of 56 composites are one literal in one branch. R14 §2.3's cluster warning (effective n nearer the number of sites than of faults) shows up even here. Report escapes by site as well as by stratum.
5. **Spec-ambiguous mutants inflate the escape count.** Three of twelve base escapees (source order, duplicate sources, effect order) are not faults under the plain-language statement; the differential filter calls them non-equivalent because it compares JSON. The X3 fault generator needs a rule for these (either the contract fixes them, or they are excluded from n with a reason) or the rate is biased upward.
6. **Disagreement inputs are cheap and sharp.** Median one draw to separate two survivors; one answered input killed 58 of 68 survivors. But the ten that remained need inputs of a different *shape* (prior state, near-boundary floats, an order question), which random drawing from the same distribution reaches slowly or never (240 draws for the epsilon boundary; the composites equivalent to their parent never). R19 §2.1's loop needs the generator to be steered by the pair, not just sampled — and as R19 itself says, it only separates survivors that disagree; S2-324 (state discarded) survived every input until one carried a non-trivial prior state.
7. **Composition of near-misses did not create escapes here** (S4b 0/52), while composition of escapes trivially does. Neither is R14's S4; the searched stratum needs an actual optimizer against an oracle, and this probe says nothing about it.

Precommit bad signs: none triggered (reference passed; equivalent fraction 6.6 %; the S2 escape is a state-carry fault, not a dimensional or source-bound one; the 15 unfound pairs are explained; harness 4.65 ms per mutant).

## Files

All under `experiments/P-03-escape-rate-method/`:

- `PRECOMMIT.md` — question, procedure, metrics, bad signs, stop rule (hash `receipt/precommit.sha256`).
- `setup.sh` — records the toolchain; no dependencies.
- `run.mjs` — the idempotent runner (verifies hashes, generates, filters, evaluates, searches, writes receipts).
- `src/kernel.mjs` — reference kernel. `src/evaluator.mjs`, `src/inputs.mjs` — the frozen evaluator and its seeded input generator. `src/mutants.mjs` — four strata plus S4b. `src/stats.mjs` — Clopper–Pearson, median, quantile.
- `receipt/precommit.sha256`, `evaluator.sha256` (v2), `evaluator.sha256.v1`, `evaluator-revision-1.md`, `reference-and-stats.sha256`, `freeze-timestamp.txt`, `toolchain.txt`.
- `receipt/env-before.json`, `env-after.json` — kernel, CPU, load, memory, Node/V8, git commit, module hashes.
- `receipt/mutants.jsonl` (457 lines: 405 + 52 S4b; edits, source hash, status, first difference, filter time), `harness.jsonl` (433 non-equivalent evaluations with per-layer outcomes, first failures, scores, ms), `disagreement.json` (all 2,346 pairs, example, re-run), `frozen-disagreement-test.json`, `evaluator-plus-frozen-test.sha256`, `summary.json`, `SHA256SUMS`.
