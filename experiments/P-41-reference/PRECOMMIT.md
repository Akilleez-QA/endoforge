# P-41-reference PRECOMMIT: hill-climb round 12, expected values from a sandboxed reference evaluator

## Design
Same as P-39: P-21 twenty needs plus ten P-19 add requests, 30 per run, thread isolation, pre-warm on, session resume, prefix default, self-check off, effort auto, width 10, Node 22, flock /tmp/ef-bench.lock. Six runs per arm, interleaved B C B C B C B C B C B C, same commit. Gates, tests and expected results of the benchmark unchanged. Receipts stay outside git; RESULT.md lists their sha256.

- Baseline: ENDOFORGE_CODEX_TERSE=exact (the default since P-39; terse turns plus the exact-derivation rule on the specification stage).
- Candidate: ENDOFORGE_CODEX_TERSE=reference (terse turns; the specification stage also writes reference.js, plain JavaScript implementing the CONTRACT.md formula, and omits expect from value tests. Before freeze the supervisor runs reference.js in a sandboxed child process (node --permission, vm context with only Math, Number and basic built-ins, 2 s script timeout, 10 s process timeout, empty environment) and writes every expect from its result; non-integer results without a model tolerance get tol 1e-9 relative. Any missing function, missing trap, non-finite value or evaluator failure fails the request closed. The model never writes an expected value.) No request-specific rules.

## Metrics
promoted per run (of 30); p50 per run is the median per-request total time; p95 per run; not-promoted request ids per run.

## Keep rule (fixed before running)
Keep only if all hold:
1. Quality no worse: min candidate promoted >= min baseline promoted AND total candidate promoted >= total baseline promoted.
2. Mean of candidate p50 < mean of baseline p50.
3. Mean of candidate p95 <= mean of baseline p95 + 5 s.
Otherwise no gain.

## What it will not show
Six runs per arm cannot detect small effects; one Codex account, one machine, this cohort only.
