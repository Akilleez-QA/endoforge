# P-39-exact result

Verdict: KEEP (new keep rule, 6 runs per arm, interleaved B C).

Baseline ENDOFORGE_CODEX_TERSE=0, candidate ENDOFORGE_CODEX_TERSE=exact.

| arm | run | promoted/30 | median s | p95 s | retried | skipped (budget/error) | cancelled | not promoted |
|---|---|---|---|---|---|---|---|---|
| base | 1 | 28/30 | 67.2 | 91.7 | 0 (0 promoted) | 0/0 | 0 | CC-036 CC-025 |
| cand | 1 | 30/30 | 65.1 | 98.8 | 0 (0 promoted) | 0/0 | 0 | - |
| base | 2 | 27/30 | 60.8 | 88.7 | 0 (0 promoted) | 0/0 | 0 | CC-036 CC-025 CC-002 |
| cand | 2 | 29/30 | 60.2 | 96.0 | 0 (0 promoted) | 0/0 | 0 | C-012 |
| base | 3 | 28/30 | 64.5 | 93.8 | 0 (0 promoted) | 0/0 | 0 | CC-036 C-012 |
| cand | 3 | 30/30 | 59.2 | 94.1 | 0 (0 promoted) | 0/0 | 0 | - |
| base | 4 | 28/30 | 55.7 | 91.1 | 0 (0 promoted) | 0/0 | 0 | CC-036 C-012 |
| cand | 4 | 29/30 | 59.8 | 93.5 | 0 (0 promoted) | 0/0 | 0 | C-010 |
| base | 5 | 27/30 | 65.0 | 91.4 | 0 (0 promoted) | 0/0 | 0 | CC-025 CC-002 C-012 |
| cand | 5 | 29/30 | 62.3 | 96.1 | 0 (0 promoted) | 0/0 | 0 | C-010 |
| base | 6 | 29/30 | 63.7 | 112.0 | 0 (0 promoted) | 0/0 | 0 | C-012 |
| cand | 6 | 29/30 | 62.8 | 90.6 | 0 (0 promoted) | 0/0 | 0 | C-010 |

| arm | promoted min / total | median mean s | p95 mean s | retries (promoted) |
|---|---|---|---|---|
| base | 27 / 167 | 62.8 | 94.8 | 0 (0) |
| cand | 29 / 176 | 61.6 | 94.8 | 0 (0) |

quality no worse: True; median mean lower: True; p95 within +5 s: True
KEEP

receipt sha256:
- base-r1: f104a9c015a9fb162722c9f5b25eddc9d38dd7f2b303f8faea7a304fac4c42f3
- base-r2: 9c8803f64cc499d08611df3bb2e2280b15b1b81464ef75b973792c4309f96069
- base-r3: 9d6690b416ae419c142a6be947a6983e13d343e01a32c567355ca761b4098607
- base-r4: 30182fb84696a7c304d5a27e7151526343d824c7e3c441af670ed8ea7e09d7fa
- base-r5: 9227b6f0fa680601ce2e425e340ab4bd4f3b25e0e2e6ceaf62810d5b54507a7c
- base-r6: 24b508066dc2b34f4aa55e1fb680aa6db9be5faf088a2e1312fb9040a9212b6e
- cand-r1: 3666f87e99946e948d3f320ce7fca19e365400b0fde92f9cb127d4cf3273730a
- cand-r2: 13f06f9c9660714d3067a042daf1fc82364dc50b354bbde5456a5696df6d1f96
- cand-r3: aaa04a6c85316dcf977d1dd4223080805bc0fd279a1bbd6a484cee9c3bd6cb98
- cand-r4: bb7c8e9cafe78769d06760c3b2c2a7aeff194b5f7491ed95cbb0bc358e181e29
- cand-r5: a1571124b9fa59d2acb46e8432d0bd1869a27bf267081dd516ddb4c97971ec36
- cand-r6: 32924ffb3fa2f7802ba4df89734f4345ba26e8cd88d0132a0dd1283040624258

## Diagnosis

Terse first-attempt failures were G4_tests failures caused by wrong expected values in the frozen tests.json, while the kernels matched the CONTRACT.md formula exactly. Terse specification stages wrote hand-estimated values with tolerances tighter than their error; normal mode reasoned longer and wrote full-precision values. Missing behavior: deriving numeric expected values carefully, with tolerances consistent with their precision. The fix is one general rule on the specification stage, with no request-specific logic.

In this round CC-002, CC-013, CC-025 and CC-036 were promoted in every candidate run. Remaining candidate misses are C-010 (3, implementation bug, kernel returned 0) and C-012 (1).

## Next lever

The deeper root cause is that expected values come from the model doing arithmetic in its head. The general fix is to compute expected values by running the CONTRACT.md formula in a sandboxed reference evaluator. That also explains the CC-036 and CC-025 misses of about 1e-9 seen in both modes before this round.
