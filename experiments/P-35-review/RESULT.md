# P-35 result

Round 7: ENDOFORGE_CODEX_TERSE=review vs 0. 3 runs per arm, interleaved. Commit 489dcdec72e445de14e675327e33c3fa932132f1.

| arm | run | promoted/30 | median s | p95 s | not promoted |
|---|---|---|---|---|---|
| base | 1 | 28/30 | 56.0 | 76.7 | CC-036 C-012 |
| base | 2 | 26/30 | 55.6 | 70.7 | CC-036 CC-025 C-016 C-012 |
| base | 3 | 28/30 | 59.2 | 88.4 | CC-036 CC-025 |
| cand | 1 | 27/30 | 52.5 | 77.5 | CC-025 C-012 C-010 |
| cand | 2 | 28/30 | 53.9 | 78.3 | C-012 C-010 |
| cand | 3 | 28/30 | 53.8 | 82.8 | CC-036 C-010 |

| arm | promoted min-max | median mean (min-max) s | p95 mean s |
|---|---|---|---|
| base | 26-28 | 56.9 (55.6-59.2) | 78.6 |
| cand | 27-28 | 53.4 (52.5-53.9) | 79.5 |

NO GAIN

receipt sha256:
- base-r1: e31dcdbb7ddfa14a8e4178f7c43ebeae57cc937792a919d69983f8aae4dc01ae
- base-r2: ec173057dba9e1d9b2c650db5f2acdec2e9e311a9b7c38c4295b8ebbe4bc1c54
- base-r3: 6743156c4df92979f73ffc665b93c59e7de5d1dd5d94f775434165a049355468
- cand-r1: 2dbbe1567e2c9520c8080de83632e63c4817383a73b4a7998850fabc3e4a7104
- cand-r2: 3eb886c5cfaed10d1683b41e00b077647874489172ea992ea61271b722b247d1
- cand-r3: c54391853d96dd7cc0a92bfe299ab457429d41712c7a0376fe1173f8825953de

Decision: not kept. Speed rule passed (cand max median 53.9 < base min 55.6); promoted rule failed (cand min 27 not above base max 28). Switch stays off by default.
