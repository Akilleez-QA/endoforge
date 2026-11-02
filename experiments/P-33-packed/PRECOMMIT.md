# P-33-packed PRECOMMIT: hill-climb round 5, pre-packed fresh implementation context

## Design
Same as P-29: P-21 twenty needs plus ten P-19 add requests, 30 per run, thread isolation, pre-warm on, terse off, self-check off, effort auto, width 10, Node 22, flock /tmp/ef-bench.lock. Three runs per arm, interleaved B C B C B C, same commit. Gates, tests and expected results unchanged. Receipts stay outside git; RESULT.md lists their sha256.

- Baseline: ENDOFORGE_CODEX_SESSION=resume (implementation resumes the 71k-token specification thread).
- Candidate: ENDOFORGE_CODEX_SESSION=packed (fresh implementation call; prompt carries only the need, the frozen CONTRACT.md and tests.json, and the glue schema).

## Metrics
promoted per run (of 30); p50 per run is the median per-request total time; p95 reported.

## Keep rule (fixed before running)
Keep only if min candidate promoted > max baseline promoted AND max candidate p50 < min baseline p50. Otherwise no gain.

## What it will not show
Three runs per arm cannot detect small effects; one Codex account, one machine, this cohort only.
