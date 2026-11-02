# P-29 PRECOMMIT: hill-climb round 1, generator self-check

## Question
Does ENDOFORGE_SELF_CHECK=1 (REQ-GEN-005: the generator runs the unchanged gates on its own kernel and resumes the same Codex thread once with the failures) raise promoted count without raising median request time?

## Design
- Cohort: P-21 twenty needs plus ten P-19 add requests = 30 requests per run, thread isolation, pool width 10, pre-warm on, session resume, effort auto, Node 22, under flock /tmp/ef-bench.lock.
- Arms: baseline ENDOFORGE_SELF_CHECK=0, candidate ENDOFORGE_SELF_CHECK=1, same commit.
- Three runs per arm, interleaved B C B C B C.
- Gates, tests and expected results are unchanged; only official promotion counts.

## Metrics
- promoted per run (of 30).
- p50 per run: median of per-request total time over all 30 rows.

## Keep rule (fixed before running)
Keep the candidate as the default only if both hold:
1. min candidate promoted > max baseline promoted.
2. max candidate p50 < min baseline p50.
Otherwise the round is no gain and the default stays off.

## What it will not show
Three runs per arm cannot detect small effects; one Codex account and one machine; no claim beyond this cohort.
