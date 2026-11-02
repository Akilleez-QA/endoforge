# P-31 RESULT: round 3, pool width 16

Run 2026-11-02 03:16-03:38 EST, interleaved B C B C B C, 30 requests per run, commit 3708278.

| arm | run | promoted/30 | p50 total s | not promoted |
|---|---|---|---|---|
| w10 | 1 | 28/30 | 61.7 | CC-036 CC-025 |
| w10 | 2 | 28/30 | 55.5 | CC-025 CC-036 |
| w10 | 3 | 29/30 | 60.7 | CC-036 |
| w16 | 1 | 28/30 | 61.0 | CC-025 C-012 |
| w16 | 2 | 26/30 | 64.1 | C-015 CC-036 CC-025 C-012 |
| w16 | 3 | 25/30 | 61.7 | C-019 CC-025 CC-036 CC-002 C-012 |

| arm | mean promoted | min-max | mean p50 s | min-max |
|---|---|---|---|---|
| w10 | 28.33 | 28-29 | 59.3 | 55.5-61.7 |
| w16 | 26.33 | 25-28 | 62.3 | 61.0-64.1 |

p95 total s per run: w10 92.7 91.9 88.3; w16 88.5 94.0 102.1.

## Verdict
No gain. Rule 1 fails (candidate min 25 is not above baseline max 29) and rule 2 fails (candidate max p50 64.1 s is not below baseline min 55.5 s). Width 16 promoted fewer and was not faster. Width stays 10.

## What it does not show
Three runs per arm cannot resolve small effects. The machine was also running unrelated GPU jobs during the w16 r3 run. One Codex account, one machine, this cohort only.
