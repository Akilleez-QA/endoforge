# P-03 escape-rate-method — precommit

**Status:** Recorded (probe). Not a campaign. Never citable as an X3 result or as deciding any X1–X6 experiment.

## Question

Does the seeded-fault (escape-rate) method work end to end on a toy task — harness with three acceptance layers, four fault strata, equivalent-mutant filtering by differential execution, exact Clopper–Pearson reporting — and does disagreement-input generation (R19 §2.1) separate surviving candidates?

**This probe validates the METHOD. It does not measure Endoforge's escape rate.** The task is a toy, the kernel is plain JavaScript (the subject is the harness, not the kernel route), the mutants are not real generator errors, and nothing here is a Field OS evaluator.

## Unknown de-risked

- X3 method (R14 §2: rule of three, power, equivalent-mutant filtering, four strata, frozen evaluator).
- R19 §2.1: candidate disagreement as the specification interface.
- RISK-10 (escape-rate thresholds unsupported by sample size): exercises the exact bound arithmetic on a real run.
- E3-03 (tier thresholds need stated fault counts); E3-22 (the seeded-fault list vs the six-case fixture: unit/basis handling and reversed inputs are exercised here). (The brief cited E3-25 for the fixture; E3-25 is the decode-bandwidth erratum, E3-22 is the fixture erratum.)

## Procedure (exact)

1. Toy task: join pressure readings (psi | psig | kPa | bar, `basis` gauge | absolute, source ids) against a reference table; convert to a target unit and basis using an atmosphere value when a basis shift is needed; classify |delta| against inclusive minor/major tolerances; emit one row per reading carrying every contributing source id; emit a totals summary. Reference implementation `src/kernel.mjs`, `kernel(state, event) -> {state, effects}`.
2. Evaluator `src/evaluator.mjs` (with `src/inputs.mjs`), frozen by hash into `receipt/evaluator.sha256` **before any mutant is generated**:
   - Universal gates over 60 seeded random inputs (seed 0x5eed0001): schema validity, determinism (two runs compared), forbidden effects (only `emit` and `summary`; exactly one of each on a reconcile event, none otherwise), resource bound (50 ms wall per call; throwing counts as a failure), purity (inputs not mutated).
   - Domain invariants over the same 60 inputs: dimensional consistency against an independently written conversion (relative 1e-9), source-bound return (every cited source exists; converted cites the reading and, when shifted, the atmosphere; expected cites the reference row), totals reconcile (rows = readings in order, class counts sum to rows, unmatched reference count), idempotence (second application on the returned state reproduces state and effects).
   - Task residual: six example tests derived from the plain-language statement in the evaluator.
   - Holdout: six further example tests used by no layer; reported only.
3. Mutants, each an edit list over the reference source, compiled with `new Function`:
   - S1 mechanical: every single-site application of a fixed operator table (relational/equality/arithmetic/logical swaps, numeric constant ±1 and ×, boolean and string-literal flips, statement-level deletions where safe). Target ≥ 300.
   - S2 domain-semantic: ≥ 20 hand-written faults (swap psi/psig, drop missing-basis rows, wrong factor, cite the wrong source, reverse join direction, treat absolute as gauge, …).
   - S3 model-plausible: ≥ 20 hand-written realistic generator bugs (wrong default, unit case mismatch, early return, mutable aliasing, …).
   - S4 searched: among non-equivalent S1–S3 mutants ranked by harness score (checks passed), compose pairs of the top survivors with non-overlapping edits; ≥ 50.
   Mutants that fail to compile are counted and excluded (they are not candidates). Mutants whose output matches the reference on all 2,000 differential inputs (seed 0x5eed0002, a disjoint set from the invariant inputs) are equivalent and excluded from the denominator; their count is reported per stratum.
4. Every non-equivalent mutant runs through the full harness. Escape = passes universal + invariants + residual. Report per stratum and overall: escapes / n, two-sided exact Clopper–Pearson 95 % interval, and the one-sided 95 % upper bound (the tier bound). Also report escape with the residual removed (universal + invariants) and with the invariants removed (universal + residual), and universal gates alone.
5. Disagreement inputs: for each pair among {reference} ∪ escaping mutants (or, if none escapes, the 10 highest-scoring killed mutants), draw fresh random inputs (seed 0x5eed0003) until the two disagree; cap 20,000 per pair. Report the per-pair count and its median, and one example as "A gives X, B gives Y". Take the first reference-vs-escapee disagreement input, answer the choice in the reference's favour (here the reference is the oracle; a person would answer), add it as a frozen test, re-run every previously escaping mutant, and report how many it now kills. The evaluator hash changes at that point; both hashes are recorded.
6. Cost: wall time per full harness evaluation (median, p95, min, max, n) and total run time.

## Metrics

Non-equivalent n per stratum; equivalent and uncompilable counts; escapes per stratum with CP bounds; layer-contribution escapes; disagreement-search counts; kills added by one disagreement input; per-mutant wall time.

## What counts as a bad sign

- The reference kernel fails any layer (harness defect).
- Equivalent fraction above ~40 % in S1 (weak differential input set).
- Escapes concentrated in a stratum the invariants were meant to cover (dimensional, source-bound) — would indicate the invariants are hollow.
- Disagreement search fails to find an input in 20,000 draws for a pair that the differential filter already showed to be non-equivalent (inconsistent generators).
- Harness evaluation above 1 s per mutant (R14 §2.4 assumes 0.1–1 s).

## Stop rule

Single run; no tuning of the evaluator after seeing mutant outcomes (any change is a new evaluator). If the runner crashes, the partial `receipt/` is kept and RESULT.md says so. If the reference fails its own evaluator, stop and record the defect; do not patch the evaluator and re-run under the same probe id.

## Environment

Node v26.8.1, shared Omarchy desktop (kernel 7.2.5-3-omarchy, 32 logical CPUs), no quiet gate. Dependencies: none beyond Node. Captured in `receipt/env-before.json` and `env-after.json`.
