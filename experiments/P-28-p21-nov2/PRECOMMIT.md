# P-28 PRECOMMIT: the twenty P-21 requests, end to end, 2026-11-02

Written before any P-28 measurement. Code under test: endoforge main b8f0bba (PR #53). Expected results elsewhere are unchanged.

## Protocol
The twenty P-21 loop-0 requests, needs from the same 2026-10-18 archives, fixed order, run through the full pipeline `core/runtime/x1/pipeline.mjs` `runNeed` (Codex generate, freeze, compile, G1-G7 gates, ledger, promote) inside a thread `IsolatePool` of size 10 with `prewarm: true` (workcells and ledger bridge ready before the first request), concurrency 10, no retries. Harness `run.mjs` is P-27's with only the process mode and add cohort removed and prewarm on. Real Codex CLI on the scubasteve account, `ENDOFORGE_CODEX_SESSION=resume`, `ENDOFORGE_CODEX_EFFORT=auto`, Node v22.23.3, held under `flock /tmp/ef-bench.lock`. One recorded run.

Per-request seconds: clock starts before the need is read and stops after promote, as in P-21 2026-11-01 (which stopped after its gates plus a re-gate).

## Targets (pass/fail, decided now)
T1. Promoted >= 19/20.
T2. Median per-request total <= 59.4 s (P-21 2026-11-01 median).
T3. Whole-set wall <= 147.2 s (P-21 2026-11-01).
Any miss is reported as a miss; targets are not revised after the run. Results are added to P-21 RESULT as a 2026-11-02 column next to Oct 17, Oct 18 and Nov 1, without changing those columns.
