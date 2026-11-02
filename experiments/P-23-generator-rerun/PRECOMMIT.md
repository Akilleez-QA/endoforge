# P-23 PRECOMMIT: generator contract and faster sessions, P-22 re-run

Written before any P-23 measurement. Code under test: endoforge main 3115829 (PR #39 contract-up-front, PR #40 warm resume session, auto effort, no-explore prompts).

## Protocol
Identical to P-22: same harness (copied run.mjs), same 20 P-21 needs and 10 add needs, same fixed order, thread then process IsolatePool, concurrency 10, no retries, real Codex CLI on the same account, held under flock /tmp/ef-bench.lock. Settings stated explicitly: ENDOFORGE_CODEX_SESSION=resume, ENDOFORGE_CODEX_EFFORT=auto.

## Baseline (P-22 receipts)
Total p50: thread P-21 130.4 s, add 96.6 s; process P-21 120.9 s, add 95.1 s. 41/60 promoted; 16 refusals involved G7 missing precision.

## Targets (pass/fail, decided now)
T1. Zero refusals citing a number result without precision across all 60 records.
T2. Add cohort total p50 <= 48 s in both modes.
T3. P-21 cohort total p50 at least 30% below P-22 in each mode: thread <= 91.3 s, process <= 84.6 s.
T4. Promoted >= 41/60 (no regression).
Any miss is reported as a miss; targets are not revised after the run.
