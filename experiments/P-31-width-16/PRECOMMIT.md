# P-31-width-16 PRECOMMIT: hill-climb round 3, pool width 16

## Design
Same as P-29: P-21 twenty needs plus ten P-19 add requests, 30 per run, thread isolation, pre-warm on, session resume, self-check off, Node 22, flock /tmp/ef-bench.lock. Three runs per arm, interleaved B C B C B C, same commit. Gates, tests and expected results unchanged.

- Baseline: pool size and concurrency 10.
- Candidate: pool size and concurrency 16.

## Metrics
promoted per run (of 30); p50 per run is the median per-request total time.

## Keep rule (fixed before running)
Keep only if min candidate promoted > max baseline promoted AND max candidate p50 < min baseline p50. Otherwise no gain.

## What it will not show
Three runs per arm cannot detect small effects; one Codex account, one machine, this cohort only.
