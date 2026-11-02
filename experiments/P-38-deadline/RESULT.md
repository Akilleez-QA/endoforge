# P-38 result

Round 10: ENDOFORGE_CODEX_TERSE=fallback with a hard 86 s request deadline vs TERSE=0. 6 runs per arm, interleaved. Commit 188737eff5df144ecacac0c3bfbbea3389df2090.

| arm | run | promoted/30 | median s | p95 s | retried | skipped (budget/error) | cancelled | not promoted |
|---|---|---|---|---|---|---|---|---|
| base | 1 | 28/30 | 60.8 | 81.2 | 0 (0 promoted) | 0/0 | 0 | CC-036 CC-025 |
| cand | 1 | 28/30 | 55.2 | 86.0 | 2 (0 promoted) | 0/0 | 2 | CC-036 C-010 |
| base | 2 | 27/30 | 59.7 | 79.9 | 0 (0 promoted) | 0/0 | 0 | CC-025 CC-036 CC-002 |
| cand | 2 | 26/30 | 56.6 | 87.7 | 3 (0 promoted) | 1/0 | 2 | CC-036 CC-002 CC-025 C-012 |
| base | 3 | 28/30 | 58.0 | 87.0 | 0 (0 promoted) | 0/0 | 0 | CC-025 C-010 |
| cand | 3 | 26/30 | 54.6 | 86.0 | 4 (0 promoted) | 0/0 | 4 | CC-025 CC-002 CC-036 CC-013 |
| base | 4 | 28/30 | 61.4 | 79.8 | 0 (0 promoted) | 0/0 | 0 | CC-025 C-012 |
| cand | 4 | 26/30 | 58.2 | 86.0 | 4 (0 promoted) | 0/0 | 3 | CC-036 CC-002 CC-025 CC-013 |
| base | 5 | 28/30 | 54.9 | 96.8 | 0 (0 promoted) | 0/0 | 0 | CC-036 C-012 |
| cand | 5 | 26/30 | 52.7 | 90.3 | 4 (0 promoted) | 0/0 | 4 | CC-025 CC-002 CC-036 CC-013 |
| base | 6 | 27/30 | 61.8 | 115.6 | 0 (0 promoted) | 0/0 | 0 | CC-036 CC-025 C-012 |
| cand | 6 | 27/30 | 57.6 | 86.0 | 3 (0 promoted) | 0/0 | 3 | CC-002 CC-025 CC-036 |

| arm | promoted min / total | median mean s | p95 mean s | retries (promoted) |
|---|---|---|---|---|
| base | 27 / 166 | 59.4 | 90.0 | 0 (0) |
| cand | 26 / 159 | 55.8 | 87.0 | 20 (0) |

quality no worse: False; median mean lower: True; p95 within +5 s: True
NO GAIN

receipt sha256:
- base-r1: 85e52e62d9a74ccb1705f7820064de22189f3bb86cb8b5814c6ed5c0b4822bd7
- base-r2: 977c1d55fbe3b2f4fba100a092b6a14bf08a31218790cf7056fcd6b80e4a4ec0
- base-r3: 57f7f7de04050fe14cda555477b3cc07b25a88e373aed7893b405c52133175a6
- base-r4: ae988e91e42298011bbdfe32f39d2c21c0322faa7c809f1ebec5b7ecdc312f5a
- base-r5: 998a138ee5f521a5898484d13f99f2a0ec815021c581d7309a957a44fd5e5d36
- base-r6: a4196cbaa2b5a76ecd99c470775a8327af656cce6a1930b8f5ab65f00eb885a9
- cand-r1: 5e296c01bd9bb47c2366add8fefc320ef79deedf0156e7bbeba4825167148a39
- cand-r2: 61e97d6eb002b1d12902fddefa3198dd2279f0c699ef1e61b409273ec35760cb
- cand-r3: 7db150c7569178048cb801961791caf087d6a5502e105bdf6df50faebc04eea1
- cand-r4: 3f4f9b040f42ffc5c44e6fee7f779f5937daa568c6004fcb93a1f879fd82bf39
- cand-r5: 064b3bdc5a2ea6cd09fb2461b74b4ee5d93bd99a1da58297445e0e0a46958953
- cand-r6: a93bb77e57a358e6f84f3b1552dee7259e329ef6e6995694b58d2eb2b9d3f21c

Decision: not kept. Median and p95 rules passed; quality rule failed (min 26 vs 27, total 159 vs 166). 18 of 20 retries were cancelled at the deadline and none was promoted: a normal retry needs about 60 s but only about 30-40 s remain after a terse first attempt. Switch stays off by default.
