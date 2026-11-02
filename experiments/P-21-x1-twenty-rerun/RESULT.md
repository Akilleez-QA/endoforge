# P-21 RESULT: the twenty loop-0 requests, re-run on 2026-11-01

Precommit: [PRECOMMIT.md](PRECOMMIT.md), sha256 in [receipt/precommit.sha256](receipt/precommit.sha256). Recorded run started 2026-11-01 19:41 ET. Every number below is computed by [bin/summarize.mjs](bin/summarize.mjs) from [receipt/](receipt/).

## Headline

| | 2026-10-17 loop 0 | 2026-10-18 atomizer direct | 2026-11-01 (this run) |
|---|---|---|---|
| Worker | fresh Claude agent per request | Claude Sonnet, one per request | Codex CLI (scubasteve), effort medium |
| Concurrency | sequential | pool of 10 | pool of 10 |
| Median s | 96.5 | 29.4 | 59.4 |
| p95 s | 146.2 | 53.7 | 83.6 |
| Gated (G1-G7) | 19/20 (CC-001 failed) | 18/20 (C-006, CC-026 failed) | 20/20 |
| Whole set wall s | not measured as a set | 101 | 147.2 |
| Tokens | not recorded | 77,599 output | 401,547 input+output (Codex total) |

Per-request seconds (clock starts before the request is read; stops after the seven gates; 2026-11-01 includes an independent harness re-gate, median 0.57 s):

| Request | Oct 17 | Oct 18 | Nov 1 |
|---|---|---|---|
| CC-036 | 60.5 | 22.7 | 41.5 |
| C-015 | 58.5 | 29.2 | 45.6 |
| CC-025 | 73.9 | 25.1 | 45.8 |
| CC-011 | 74.2 | 17.7 | 47.4 |
| C-019 | 85.0 | 32.3 | 50.8 |
| CC-002 | 93.7 | 29.4 | 58.5 |
| C-016 | 96.5 | 24.4 | 58.5 |
| CC-014 | 74.0 | 27.7 | 59.4 |
| C-007 | 79.5 | 30.8 | 64.3 |
| CC-027 | 76.2 | 26.7 | 66.9 |
| CC-007 | 105.7 | 29.1 | 54.7 |
| CC-001 | 99.1 (not gated) | 29.8 | 68.0 |
| CC-022 | 127.1 | 37.1 | 52.4 |
| CC-026 | 126.4 | 55.0 (not gated) | 63.8 |
| CC-013 | 146.2 | 27.8 | 65.6 |
| C-005 | 113.4 | 45.2 | 83.6 |
| C-006 | 131.8 | 46.3 (not gated) | 72.0 |
| C-010 | 128.6 | 53.7 | 74.1 |
| C-012 | 106.5 | 34.2 | 96.7 |
| CC-009 | 161.6 | 37.8 | 80.2 |

## Reading

- 20/20 gated, the first run of this set with no gate failure. Every claim of promotable was confirmed by a clean re-run of gate.mjs on a copy ([receipt/regate/](receipt/regate/)).
- Per request it is about 2x slower than 2026-10-18 (median 59 s against 30 s) and about 1.6x faster than 2026-10-17. The whole set took 147 s against 101 s.
- The time is the model, not the runtime: gates take about 0.6 s of each request; the rest is the Codex worker. The worker changed (Codex gpt-6.1-sol against Claude Sonnet) so this is not a like-for-like runtime comparison.
- Machine load at start: load average 6.6 on 32 cores, 8 other Codex processes running ([receipt/env-before.txt](receipt/env-before.txt)).

## What it does not show

- The V8 isolate workcell pool in core/runtime is not in this loop. Concurrency is 10 Codex processes, as on 2026-10-18 (where "isolate" meant an isolated HOME and sandbox, not a V8 isolate). Gates run in plain Node via gate.mjs.
- No persona stage; "gated" is not "promoted" in the loop-0 sense (2026-10-17 promoted 18 after persona review).
- Token counts are not comparable: Codex prints input plus output.
- One run, one machine, one evening. An exploratory run of the same harness earlier that evening also gated 20/20 (median about 58 s); a single-request trial before it had a gate failure on CC-036 (a wrong frozen test).
- Need text and prompts come from the 2026-10-18 archives; they differ in hash from the 2026-10-17 pool files (the archive wraps the same request).
