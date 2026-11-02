# P-34 RESULT: round 6, stable prompt prefix

Run 2026-11-02 05:05-05:27 EST, interleaved B C B C B C, 30 requests per run, commit 0c3426d. Receipts in ~/work/ef-v8c/receipts/P-34 on main-rig, outside git.

| arm | run | promoted/30 | median s | p95 s | not promoted |
|---|---|---|---|---|---|
| base | 1 | 26/30 | 53.8 | 91.1 | CC-025 CC-036 CC-011 C-010 |
| base | 2 | 27/30 | 53.3 | 81.8 | CC-025 CC-036 C-010 |
| base | 3 | 28/30 | 53.9 | 83.2 | C-012 C-010 |
| cand | 1 | 27/30 | 65.9 | 98.1 | CC-025 CC-036 C-012 |
| cand | 2 | 28/30 | 63.6 | 88.3 | CC-036 C-006 |
| cand | 3 | 29/30 | 58.5 | 91.6 | C-012 |

| arm | promoted min-max | median mean (min-max) s | p95 mean s |
|---|---|---|---|
| base | 26-28 | 53.7 (53.3-53.9) | 85.4 |
| cand | 27-29 | 62.7 (58.5-65.9) | 92.7 |

## Verdict

receipt sha256:
- base-r1: a1aabe2acc948047c3b95f0d7730dc9192cb0c63090efc762c3b1228fe6e683a
- base-r2: 3c609b16c0ebc1cf2cf806448a7b76dd12f19303d2b390bf8a578e120006077a
- base-r3: 7ba9999cffc3a12c6755e59ac9285c03f9f06a26490f8cea912bb81ea94370db
- cand-r1: 77486f18f04051b82d62b1a1c3fe7b312badbcfe5ef3b4e88feba2180fe7fee3
- cand-r2: 40d2c06766a814cf55f040c1afc8175bb7938a2d6e0143ec67d4332619c7f0f9
- cand-r3: d31cfa1a19b2266a9261b1dbb3eafea8dda2588ffb5d1691e36e0462b3e2ac9d

No gain. Rule 1 fails (candidate min 27 is not above baseline max 28) and rule 2 fails (candidate max median 65.9 s is not below baseline min 53.3 s). Reordering the prompt did not raise cached input (specification p50 29,184 vs 29,312 tokens) and the candidate was slower. The cache already covers the fixed system prefix; the request JSON is too small a share to matter. ENDOFORGE_CODEX_PREFIX stays off.

## What it does not show
Three runs per arm cannot resolve small effects. One Codex account, one machine, this cohort only.
