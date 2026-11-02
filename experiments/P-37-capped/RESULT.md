# P-37 result

Round 9: ENDOFORGE_CODEX_TERSE=fallback with ENDOFORGE_RETRY_BUDGET_MS=86000 vs TERSE=0. 6 runs per arm, interleaved. Commit 63b8cb74dd2a2f89d73ab36f1af6f5ef00540691.

| arm | run | promoted/30 | median s | p95 s | retried | skipped (budget/error) | not promoted |
|---|---|---|---|---|---|---|---|
| base | 1 | 28/30 | 59.5 | 87.8 | 0 (0 promoted) | 0/0 | CC-036 CC-025 |
| cand | 1 | 30/30 | 59.0 | 123.5 | 4 (4 promoted) | 0/0 | - |
| base | 2 | 28/30 | 53.8 | 85.3 | 0 (0 promoted) | 0/0 | CC-036 CC-025 |
| cand | 2 | 28/30 | 61.0 | 120.6 | 5 (3 promoted) | 0/0 | CC-036 CC-025 |
| base | 3 | 28/30 | 61.4 | 78.5 | 0 (0 promoted) | 0/0 | CC-036 CC-025 |
| cand | 3 | 28/30 | 52.8 | 100.3 | 2 (0 promoted) | 0/0 | CC-025 CC-036 |
| base | 4 | 28/30 | 60.8 | 83.0 | 0 (0 promoted) | 0/0 | CC-025 C-012 |
| cand | 4 | 28/30 | 58.3 | 113.7 | 4 (2 promoted) | 0/0 | CC-036 CC-025 |
| base | 5 | 28/30 | 64.4 | 85.5 | 0 (0 promoted) | 0/0 | CC-036 CC-025 |
| cand | 5 | 28/30 | 56.4 | 112.0 | 3 (2 promoted) | 1/0 | CC-036 C-012 |
| base | 6 | 28/30 | 62.1 | 81.2 | 0 (0 promoted) | 0/0 | CC-025 CC-036 |
| cand | 6 | 28/30 | 58.2 | 111.0 | 4 (2 promoted) | 0/0 | CC-036 CC-002 |

| arm | promoted min / total | median mean s | p95 mean s | retries (promoted) |
|---|---|---|---|---|
| base | 28 / 168 | 60.3 | 83.6 | 0 (0) |
| cand | 28 / 170 | 57.6 | 113.5 | 22 (13) |

quality no worse: True; median mean lower: True; p95 within +5 s: False
NO GAIN

receipt sha256:
- base-r1: 8d4259f3a32107e79c8a27ebabbc0cc902cbc0320e8e54e8600ab2df1952c6ff
- base-r2: 44e1daac256935b498f89b1cbc89a0e18222894cda08c3a027bca81a54bc2b53
- base-r3: 0856b87c68bc5b02ef74e64d3e7033954f0e2b7ce142032175aa8b586be0caf9
- base-r4: 091db8f2ffbb5bb8b9e2b2cb6177618c6576f0f522a41ae87925c2b948f9524d
- base-r5: e9426669d9368ff22571fcab78980873719bdb3136a00477e4eafb8eebb45f40
- base-r6: a610c955b21600b14be31bf4bec7bc71c427ccdf331e767f26a8637169f03271
- cand-r1: f8385a8fc70da80059a192d9d38ad0a503bf45d9e3a48379dff2baf2272978bc
- cand-r2: 888903c5b89cf86c854297215ba7ebad1b42923b2d8073039907eb92e1db4b4b
- cand-r3: eff13e92e46579e58b645ec3ece2062ef9e265ee8faa4d742dc6d358c643f724
- cand-r4: 55bdf71394802158ebd624395efff65597e8e3cb7b5109f28f91ceec0c6c2963
- cand-r5: ede31624394cc6ecd1bbafe2b38f67ad321008829cd0643bba4a08364e6192c3
- cand-r6: 3c1ff5eeaf196bd0e5af906f240f854a7e7be1dd7d50e76a3d43a99882207fd2

Decision: not kept. Quality and median rules passed; p95 rule failed (113.5 s vs 83.6 + 5 s). Retried requests finish at about first attempt plus a normal run, so the budget on the first attempt alone does not cap the tail. Switch stays off by default.
