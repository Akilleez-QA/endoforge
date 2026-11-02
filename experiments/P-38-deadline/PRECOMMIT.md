# P-38-deadline PRECOMMIT: hill-climb round 10, terse first with a retry under a hard request deadline

## Design
Same as P-37: P-21 twenty needs plus ten P-19 add requests, 30 per run, thread isolation, pre-warm on, session resume, prefix default, self-check off, effort auto, width 10, Node 22, flock /tmp/ef-bench.lock. Six runs per arm, interleaved B C B C B C B C B C B C, same commit. Gates, tests and expected results unchanged. Receipts stay outside git; RESULT.md lists their sha256.

- Baseline: ENDOFORGE_CODEX_TERSE=0 (normal turns, no retry).
- Candidate: ENDOFORGE_CODEX_TERSE=fallback with ENDOFORGE_RETRY_BUDGET_MS=86000 (terse first; one normal-mode retry only when the gates rejected the candidate, not on a stage error, and only when the first attempt took under 86 s; the retry's Codex calls get only the time left until 86 s after the request started and are killed when it runs out; no per-request-ID rules; total time includes the retry).

## Metrics
promoted per run (of 30); p50 per run is the median per-request total time; p95 per run; retries, retries promoted, retries cancelled and skipped retries per run.

## Keep rule (fixed before running)
Keep only if all hold:
1. Quality no worse: min candidate promoted >= min baseline promoted AND total candidate promoted >= total baseline promoted.
2. Mean of candidate p50 < mean of baseline p50.
3. Mean of candidate p95 <= mean of baseline p95 + 5 s.
Otherwise no gain.

## What it will not show
Six runs per arm cannot detect small effects; one Codex account, one machine, this cohort only.
