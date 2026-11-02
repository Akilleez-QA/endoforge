# P-39-exact PRECOMMIT: hill-climb round 11, terse turns with exact numeric expectations

## Design
Same as P-38: P-21 twenty needs plus ten P-19 add requests, 30 per run, thread isolation, pre-warm on, session resume, prefix default, self-check off, effort auto, width 10, Node 22, flock /tmp/ef-bench.lock. Six runs per arm, interleaved B C B C B C B C B C B C, same commit. Gates, tests and expected results unchanged. Receipts stay outside git; RESULT.md lists their sha256.

- Baseline: ENDOFORGE_CODEX_TERSE=0 (normal turns, no retry).
- Candidate: ENDOFORGE_CODEX_TERSE=exact (terse turns as in P-32, no retry; the specification stage also gets one general rule: derive every numeric expected value step by step from the contract formula with at least 12 significant digits and never pair a rounded or estimated value with a tolerance tighter than its error). No request-specific rules.

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
