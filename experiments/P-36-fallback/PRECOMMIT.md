# P-36-fallback PRECOMMIT: hill-climb round 8, terse first with one normal retry

## Design
Same as P-29: P-21 twenty needs plus ten P-19 add requests, 30 per run, thread isolation, pre-warm on, session resume, prefix default, self-check off, effort auto, width 10, Node 22, flock /tmp/ef-bench.lock. Three runs per arm, interleaved B C B C B C, same commit. Gates, tests and expected results unchanged. Receipts stay outside git; RESULT.md lists their sha256.

- Baseline: ENDOFORGE_CODEX_TERSE=0 (normal turns, no retry).
- Candidate: ENDOFORGE_CODEX_TERSE=fallback (terse first; if not promoted, one retry in normal mode; total time includes the retry).

## Metrics
promoted per run (of 30); p50 per run is the median per-request total time; p95 reported.

## Keep rule (fixed before running)
Keep only if min candidate promoted > max baseline promoted AND max candidate p50 < min baseline p50. Otherwise no gain.

## What it will not show
Three runs per arm cannot detect small effects; one Codex account, one machine, this cohort only.
