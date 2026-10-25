# P-08 request-blind evals — PRECOMMIT

**Question.** Loop 1's blind evaluator wrote its evals from the generator's stub (assumption, defaults, formulas) and every artefact passed them, while the artefacts had faults a consumer agent found. Do evals written from the request and the bare signature only catch faults that stub-fed evals miss, without rejecting correct kernels?

**Ground truth, frozen before any eval was written** (`receipt/fixtures.json`, sha256 in `receipt/fixtures.sha256`): 8 deterministic cases. Accept: C-003 kernels B and E (dew point at 70 F, 60 % within 0.5 F of the Magnus relation). Reject: a planted C-003 fault (Magnus b 243.04 -> 253.04, recompiled; 54.98 F); CC-020 B and E (no probed input yields a value: no input path for the nameplate data); C-022 B and E (a negative non-condensable excess pressure, -58 psi, returned as an answer); CC-029 E (R-134a at 600 psig, above its critical pressure per NIST, returns 218 F). Kernels whose fault could not be established deterministically are excluded.

**Arms.** OLD = loop 1's evaluator: its recorded Sonnet suites (the tests the kernels were frozen against) and a replay of the exact recorded prompt through Codex. NEW = `briefs/evals-request-only-v1.md` through Sonnet (claude -p lean, low effort) and Codex (GPT-6.1, no tools, no user config). 4 requests x 2 arms x 2 families = 16 suites (the 4 OLD-Sonnet suites are recorded, not regenerated).

**Runner.** A suite accepts a kernel when every case passes (value within tol, or a trap when refuse is expected), every property holds on 200 seeded samples per property, and (NEW only) no required input has argName null. A suite whose call names an export the kernel lacks counts that case as failed.

**Predictions (P = subjective probability).**
- P1: NEW rejects the CC-020 kernels (2 kernels x 2 families) in >= 3 of 4; OLD in <= 1 of 4 (P = 0.7).
- P2: NEW rejects the physical-bound faults (C-022 B, E and CC-029 E: 3 kernels x 2 families = 6) in >= 4 of 6; OLD in <= 2 of 6 (P = 0.55).
- P3: Correct C-003 kernels (2 x 2 = 4 pairs per arm) are accepted in >= 3 of 4 for each arm (P = 0.6).
- P4: The planted fault is rejected by >= 3 of 4 suites in each arm (P = 0.75).
- P5: NEW suite writing costs <= 1.5x OLD output tokens per suite, measured on the Codex replay and the NEW calls (P = 0.7).

**Failure meaning.** If NEW does not beat OLD on P1 and P2, request-blindness alone is not the fix and the interaction contract (input paths, questions) needs its own mechanism, which is the critic's rival. If NEW rejects correct kernels (P3 fails), request-only evals are too strict or wrong and need the shared property core before use.

**Boundary.** R-404A reference values (CC-034) are excluded: no authoritative table is available without installing a property library, which needs the owner's approval. Four requests, one run each: a probe that narrows a design decision, not a measured rate.
