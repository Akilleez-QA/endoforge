# P-42-scalar PRECOMMIT: hill-climb round 13, finite scalar boundary

## Design
Same as P-39: P-21 twenty needs plus ten P-19 add requests, 30 per run, thread isolation, pre-warm on, session resume, prefix default, self-check off, effort auto, width 10, Node 22, flock /tmp/ef-bench.lock. Six runs per arm, interleaved B C B C B C B C B C B C, same commit. Gates, tests and expected results of the benchmark unchanged. Receipts stay outside git; RESULT.md lists their sha256.

- Baseline: ENDOFORGE_CODEX_TERSE=exact (the default since P-39; terse turns plus the exact-derivation rule on the specification stage).
- Candidate: ENDOFORGE_CODEX_TERSE=scalar (everything exact does, plus a specification rule requiring finite numeric scalar inputs and outputs, finite numeric expectError inputs, and integer values for integer parameters. Before freeze, the supervisor drops tests with non-finite-number arguments and expectError tests passing fractional values to explicitly declared integer parameters. Dropped test ids and count are logged per request. A function with no remaining value tests fails the request closed.) No request-specific rules.

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
