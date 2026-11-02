# P-30 RESULT: round 2, sticky low effort

Run 2026-11-02 02:51-03:16 EST, interleaved B C B C B C, 30 requests per run, commit 3708278.

| arm | run | promoted/30 | p50 total s | not promoted |
|---|---|---|---|---|
| auto | 1 | 24/30 | 67.3 | CC-025 CC-002 C-012 C-010 add-6 add-5 |
| auto | 2 | 29/30 | 66.8 | C-012 |
| auto | 3 | 28/30 | 59.4 | CC-036 C-006 |
| low | 1 | 28/30 | 62.5 | CC-036 C-012 |
| low | 2 | 30/30 | 61.5 | - |
| low | 3 | 27/30 | 60.8 | CC-036 CC-025 CC-013 |

| arm | mean promoted | min-max | mean p50 s | min-max |
|---|---|---|---|---|
| auto | 27.00 | 24-29 | 64.5 | 59.4-67.3 |
| low | 28.33 | 27-30 | 61.6 | 60.8-62.5 |

p95 total s per run: auto 97.9 95.2 93.8; low 85.8 94.4 85.5.

## Verdict
No gain under the fixed rule. Rule 1 fails (candidate min 27 is not above baseline max 29). Rule 2 fails (candidate max p50 62.5 s is not below baseline min 59.4 s). Low effort trends faster and lower p95 but does not clear the bar. Default stays auto.

## What it does not show
Three runs per arm cannot resolve a one-request or few-second difference. One Codex account, one machine, this cohort only.
