# P-27 PRECOMMIT: G4 fix confirmation, P-23 re-run

Written before any P-27 measurement. Code under test: endoforge main bbfc98a (PR #46)
(REQ-GEN-004: the implementation request forbids `assert` under `--noAssert` and requires
explicit `abort()` or `throw` traps). G4, the compiler flags and every expected result are unchanged.

## Protocol
Identical to P-23: same harness (`run.mjs` copied from P-23), same 20 P-21 needs and 10 add
needs, same fixed order, thread then process IsolatePool, concurrency 10, no retries, real
Codex CLI on the same account, Node v22.23.3, held under `flock /tmp/ef-bench.lock`.
Settings: `ENDOFORGE_CODEX_SESSION=resume`, `ENDOFORGE_CODEX_EFFORT=auto` (P-24 showed
neither raises G4).

## Baseline (P-23 receipts)
26/60 promoted; 34 G4 refusals. Total p50: thread P-21 62.4 s, add 43.1 s; process P-21
67.4 s, add 39.8 s.

## Targets (pass/fail, decided now)
T1. Promoted >= 41/60.
T2. At most 2 of 60 generated kernels contain `assert(`.
T3. Speed kept: each of the four cohort x mode total p50 values at most 20% above P-23
(thread P-21 <= 74.9 s, thread add <= 51.7 s, process P-21 <= 80.9 s, process add <= 47.8 s).
T4. `core/runtime/x1/gates.mjs` and `core/runtime/x1/compiler.mjs` are byte-identical to
P-23's code under test (3115829).
Any miss is reported as a miss; targets are not revised after the run.
