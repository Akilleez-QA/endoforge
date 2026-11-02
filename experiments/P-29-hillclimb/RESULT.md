# P-29 RESULT: round 1, generator self-check

Run 2026-11-02 02:10-02:35 EST, interleaved B C B C B C, 30 requests per run, commit 858f569.

| arm | run | promoted/30 | p50 total s | not promoted |
|---|---|---|---|---|
| baseline | 1 | 28/30 | 65.2 | CC-025 add-7 |
| baseline | 2 | 30/30 | 69.1 | - |
| baseline | 3 | 29/30 | 63.0 | CC-036 |
| selfcheck | 1 | 29/30 | 67.0 | C-012 |
| selfcheck | 2 | 28/30 | 65.7 | C-012 add-7 |
| selfcheck | 3 | 29/30 | 71.3 | add-3 |

| arm | mean promoted | min-max | mean p50 s | min-max |
|---|---|---|---|---|
| baseline | 29.00 | 28-30 | 65.7 | 63.0-69.1 |
| selfcheck | 28.67 | 28-29 | 68.0 | 65.7-71.3 |

## Verdict
No gain. Keep rule 1 fails (candidate min 28 is not above baseline max 30) and rule 2 fails (candidate max p50 71.3 s is not below baseline min 63.0 s). ENDOFORGE_SELF_CHECK stays off by default.

## Results log
| round | change | baseline promoted mean (min-max) | candidate promoted mean (min-max) | baseline p50 mean s | candidate p50 mean s | kept |
|---|---|---|---|---|---|---|
| 1 | generator self-check | 29.00 (28-30) | 28.67 (28-29) | 65.7 | 68.0 | no |

## What it does not show
The baseline already promotes 28-30 of 30, so there is little room to climb on this cohort. Three runs per arm cannot resolve a one-request difference. Repair use per request is not recorded in rows, so this does not show how often the repair fired. One Codex account and one machine.
