# P-33 RESULT: round 5, pre-packed fresh implementation context

Run 2026-11-02 04:34-04:56 EST, interleaved B C B C B C, 30 requests per run, commit b47d93d. Receipts in ~/work/ef-v8c/receipts/P-33 on main-rig, outside git.

| arm | run | promoted/30 | median s | p95 s | not promoted |
|---|---|---|---|---|---|
| base | 1 | 29/30 | 60.3 | 88.3 | CC-036 |
| base | 2 | 28/30 | 57.9 | 93.0 | CC-036 C-012 |
| base | 3 | 27/30 | 58.2 | 83.4 | CC-036 CC-002 CC-025 |
| cand | 1 | 27/30 | 60.8 | 81.5 | CC-025 C-012 CC-026 |
| cand | 2 | 28/30 | 59.5 | 97.3 | CC-025 CC-036 |
| cand | 3 | 26/30 | 51.6 | 85.5 | CC-036 CC-025 C-012 CC-013 |

| arm | promoted min-max | median mean (min-max) s | p95 mean s |
|---|---|---|---|
| base | 27-29 | 58.8 (57.9-60.3) | 88.2 |
| cand | 26-28 | 57.3 (51.6-60.8) | 88.1 |

## Verdict

receipt sha256:
- base-r1: 49507a92e1af721c039fc4095e07c24a70ba7c4b802fe4573ba6cebf4fbfed2a
- base-r2: 65308ba43eba123fbe5ffa483cd1873e1a6e645e633a211c935c59fa03cdb8f9
- base-r3: 2a424e717ffacaa5636ccb9850cb4a18e484a3d58464c4327d038abbafb65844
- cand-r1: f071c5a93e236bc25628ff4e88a08e3a58c86d2e67ff79dcf02c3a17b05c32bb
- cand-r2: bfcda5641cfdbb074879745669885c6e20051d7a131c794c8d5e87bd9071b5b5
- cand-r3: 52cfa3388fae0ac0537a49265beb8713a0fb958ce26fc0054c4acea620e4ee20

No gain. Rule 1 fails (candidate min 26 is not above baseline max 29) and rule 2 fails (candidate max median 60.8 s is not below baseline min 57.9 s). A fresh implementation call with the frozen files packed in gives up the cached thread and was not faster overall; p95 was unchanged. ENDOFORGE_CODEX_SESSION stays resume.

## What it does not show
Three runs per arm cannot resolve small effects. One Codex account, one machine, this cohort only.
