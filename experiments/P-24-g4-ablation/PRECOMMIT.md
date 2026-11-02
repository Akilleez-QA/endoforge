# P-24 PRECOMMIT: G4 ablation, session resume x auto effort

Written before any P-24 measurement. Code under test: endoforge main 04d2d7e. G4, the compiler flags and every gate are unchanged.

## Question
P-23 raised G4 refusals from 3 (P-22) to 34 while session resume and auto effort changed together. Which change, if either, drives the rise?

## Observation made before this precommit (P-23 receipts, not a new measurement)
Of the 34 P-23 refusals, 32 kernels call `assert(` and none of the 26 promoted kernels do. The compiler runs asc with `--noAssert`, so an `assert` trap is compiled out and every `expectError` test that relies on it fails G4. Hypothesis H: the arm that raises G4 refusals is the arm that raises `assert` use.

## Protocol
Copy of the P-23 harness, thread IsolatePool only, size and concurrency 10, the same 20 P-21 needs in the same order, no retries, real Codex CLI on the same account, held under flock /tmp/ef-bench.lock. Four arms run in this order, each a full pass over the 20 needs:

| Arm | ENDOFORGE_CODEX_SESSION | ENDOFORGE_CODEX_EFFORT | Note |
|---|---|---|---|
| A0 | fresh | default | P-22 settings |
| A1 | resume | default | |
| A2 | fresh | auto | |
| A3 | resume | auto | P-23 settings |

Per record: promoted, failed gates, G4 passed/total, count of `assert(` in kernel.ts, generate and total time.

## Decision rules (fixed now)
D1. An arm raises G4 if its G4 refusals exceed A0's by at least 4 of 20.
D2. A factor is the driver if both arms with it raise G4 and neither arm without it does; otherwise the result is reported as an interaction or as no single driver.
D3. H holds if, pooled over the four arms, at least 80% of G4 refusals have an `assert(` and at most 10% of G4 passes do.

One run per arm; n=20 per arm is small and is reported as such. Results are not revised after the run.
