# Evaluator revision 1 (robustness), 2026-10-17

- Trigger: the first `node run.mjs` crashed with `TypeError: Cannot read properties of undefined (reading 'rows')` in `domainInvariants` (evaluator.mjs:133) while evaluating a mutant that returns zero effects on a reconcile event. The schema gate accepts an empty effects array (the forbidden-effects gate is what rejects it), and the invariants layer assumed an `emit` effect existed.
- No harness outcome had been written or read before the crash; `receipt/harness.jsonl`, `summary.json` and `disagreement.json` did not exist.
- Change: guard the precondition — a reconcile result without both `emit` and `summary` effects fails the invariants layer with `invariant: 'precondition'` instead of crashing. No tolerance, test, input set or judgement changed. `EVALUATOR_VERSION` bumped to `p03-evaluator-2`.
- Per R14 §2.3 and PRECOMMIT.md this is a new evaluator. v1 hash kept in `evaluator.sha256.v1`; v2 hash in `evaluator.sha256`. All reported results are under v2. The mutant set was regenerated from scratch by the rerun (it is deterministic from the source), so no mutant was evaluated twice under different evaluators.

## Second crash, same revision (before any outcome was read)

- The rerun under the first fix crashed again in `domainInvariants` (`refBasis`: reading `.unit` of undefined) for a mutant whose rows cite a `reading_id` that does not exist: the dimensional check records the defect and breaks, but the source-bound check then dereferenced the missing reading.
- Change: the per-input body of `domainInvariants` is wrapped in try/catch; a checker exception is recorded as `invariant: 'checker_exception'` (a failure of the layer). Again no judgement, tolerance, test or input changed. Both fixes together constitute evaluator v2 (`p03-evaluator-2`); the hash below supersedes the one written after the first fix.
- Lesson for WP09 (R13/R14): an evaluator must be total over arbitrary candidate output; a crash in the checker is an evaluator defect that would otherwise look like a harness failure rather than a kill.
