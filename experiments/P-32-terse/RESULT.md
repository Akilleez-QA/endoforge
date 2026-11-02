# P-32 RESULT: round 4, terse turns

Run 2026-11-02 04:01-04:24 EST, interleaved B C B C B C, 30 requests per run, commit 69fdf3a. Receipts in ~/work/ef-v8c/receipts/P-32 on main-rig, outside git.

| arm | run | promoted/30 | median s | p95 s | not promoted |
|---|---|---|---|---|---|
| base | 1 | 28/30 | 63.0 | 112.2 | CC-036 C-012 |
| base | 2 | 29/30 | 60.5 | 97.4 | CC-036 |
| base | 3 | 27/30 | 61.0 | 88.6 | CC-036 CC-025 C-012 |
| cand | 1 | 27/30 | 55.2 | 75.4 | CC-036 CC-002 C-010 |
| cand | 2 | 26/30 | 53.3 | 86.8 | CC-036 CC-025 CC-002 CC-013 |
| cand | 3 | 26/30 | 51.8 | 86.1 | CC-036 CC-025 CC-002 CC-013 |

| arm | promoted min-max | median mean (min-max) s | p95 mean s |
|---|---|---|---|
| base | 27-29 | 61.5 (60.5-63.0) | 99.4 |
| cand | 26-27 | 53.4 (51.8-55.2) | 82.8 |

## Verdict

receipt sha256:
- base-r1: 0465a699a2b9963001c9edb9a24fe3af9cd5270da4aad7364a3752c8a03fe001
- base-r2: ea87c8d3a5a778cdfd603afe8a829fed46369f47077de5e2618d57ca0a51679f
- base-r3: afe35426dd18f1e25c9761d6fd0e3b3dbcf1092e158157f2b5e38bf73478de11
- cand-r1: b4892b5b1706476ed0bf0be6bffef19d739f5b42f7138a6ebf9d01937c4941b7
- cand-r2: 66e634238e6349680df862353ee06d332dc19a4d6706ed6865d59e9c9106c605
- cand-r3: f8bd297ae75810a6b9452ba24a949b897fcda48ca8b16f1a6243e462b00b0d64

No gain under the fixed rule. Rule 2 passes (candidate max median 55.2 s is below baseline min 60.5 s) but rule 1 fails (candidate min 26 promoted is not above baseline max 29). Terse turns cut about 8 s off the median and 17 s off p95: the closing summary shrank (spec tail p50 3.9 to 2.3 s) and the specification call fell from 36.6 to 30.6 s p50. They also lost 1-3 promotions per run, with CC-002 and CC-013 refused in the candidate arm and not the baseline. ENDOFORGE_CODEX_TERSE stays off by default.

## What it does not show
Three runs per arm cannot separate a one-to-two-request quality drop from noise with confidence. One Codex account, one machine, this cohort only.
