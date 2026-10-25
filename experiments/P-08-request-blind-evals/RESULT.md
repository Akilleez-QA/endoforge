# P-08 request-blind evals — RESULT

**Status: complete, 2026-10-18.** Label: **Recorded (probe)**; 4 requests, 8 ground-truth kernels, one run per suite; precommit hashed before any eval was written (`receipt/precommit.sha256`).

## Scored against the precommit

| Prediction | Observed | Verdict |
|---|---|---|
| P1 NEW rejects the no-input-path kernels (CC-020 B, E) in >= 3/4; OLD <= 1/4 | NEW 4/4; OLD 0/4 | **met** |
| P2 NEW rejects the physical-bound faults (C-022 B, E; CC-029 E) in >= 4/6; OLD <= 2/6 | NEW 6/6; OLD 4/6 | **failed** (the OLD bound). Attribution (`receipt/attribution.json`): NEW caught C-022's impossible result by physics in 0 of 4 suite-kernel pairs (rejections came from the required-input check); CC-029 by physics in 2/2 (critical-point and non-finite cases). OLD's rejections were for unrelated reasons (a fractional refrigerant code; an export renamed in the D-02 repair). |
| P3 correct C-003 kernels accepted in >= 3/4 per arm | OLD 4/4; NEW 0/4 | **failed_with_test_concern**: every NEW suite expects a refusal below absolute zero and both kernels return −500 °F; the defect is physically real, and the fixture defined "correct" on the request's own case only. |
| P4 planted fault rejected in >= 3/4 per arm | OLD 2/2 by the value case; NEW 2/2, but NEW-sonnet only through the absolute-zero case (its request case tolerance admits the shifted constant) | **met**, with one incidental catch |
| P5 NEW output tokens <= 1.5x OLD per suite | NEW 338-2,179 output tokens (10-31 s); OLD Codex replay 1,448-3,674 (38-96 s) | **met** (about a third to half) |

Both NEW families reached the same verdict on all 8 kernels; their reasons differ.

## What it shows, within this scope

1. **Evals written from the stub cannot see a wrong interface.** CC-020's stub had no arguments; every OLD suite accepted kernels that refuse every input. Request-only writers flagged the missing input path in 4/4. This is the mechanism behind loop 1's 20/20 gated and 0-1/20 usable.
2. **Request-only writers find real input-validity defects** (absolute zero) that the old suites and my fixture missed, and catch critical-point violations; they do **not** reliably encode result-validity bounds (C-022's negative pressure), and they **over-ask**: required inputs included sensor offsets, deadbands and altitude for a sea-level question.
3. **Physical validity should not depend on what a writer remembers.** Absolute zero, critical points, non-negative pressures and flows, finite inputs are standard, sourced, deterministic checks that apply to every kernel.
4. **Value correctness still needs reference truth.** CC-034 (R-404A) was excluded: no authoritative table is available here without installing a property library.

## Addendum (post-hoc, after the owner approved the property library)

With CoolProp 8.0.0 (installed briefly in Endoforge as `tools/property-core/`, wheel sha256 8ca1aefd...a3bba8f611 matching PyPI, NIST spot checks passed; removed the same day under DEC-81 because domain data belongs to the consuming project), the excluded CC-034 case has ground truth: R-404A dew at 15 psig is −21.46 F. All three loop-1 kernels fail a 1 F tolerance (B and E: −2.2 to +8.7 F; A: up to −2.8 F, refusing above about 150 psig). Not part of the precommit; recorded as a deterministic sourced eval, the first use of the core.

`bin/cc034-core-check.mjs` imported the removed property core and no longer runs from this tree; its output is kept in `receipt/cc034-core-check.json`. The consuming project's own tables (refrigeration-ai, CoolProp 8.0.0) are the reference provider for any re-run.
