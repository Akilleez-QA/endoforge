# P-36 result

Round 8: ENDOFORGE_CODEX_TERSE=fallback vs 0. Terse first, one normal-mode retry when not promoted; time includes the retry. 3 runs per arm, interleaved. Commit e4997d819fbddfa60d0d9886e11e653f185ffdfd.

| arm | run | promoted/30 | median s | p95 s | not promoted |
|---|---|---|---|---|---|
| base | 1 | 27/30 | 60.4 | 90.3 | CC-025 CC-036 C-010 |
| base | 2 | 28/30 | 57.3 | 84.3 | CC-025 C-012 |
| base | 3 | 29/30 | 58.6 | 84.2 | CC-025 |
| cand | 1 | 29/30 | 57.2 | 125.5 | C-012 |
| cand | 2 | 29/30 | 53.5 | 100.4 | CC-036 |
| cand | 3 | 29/30 | 55.4 | 132.4 | C-012 |

| arm | promoted min-max | median mean (min-max) s | p95 mean s |
|---|---|---|---|
| base | 27-29 | 58.8 (57.3-60.4) | 86.3 |
| cand | 29-29 | 55.3 (53.5-57.2) | 119.4 |

NO GAIN

receipt sha256:
- base-r1: 83e93369c2706dbf2a337a79823b2dc71356922294c98f3bb9817870463c94c2
- base-r2: dac5480d8269bf2d2213e0b9ded69d8fa239d9b220adabc024b1505affa95f81
- base-r3: 570538afc9cffd9e03965028c1c777f9e45f9666ea4c057c45973786a633e6d4
- cand-r1: 602ac47ed1e097685824216b518200e84b77a8639817518c6db7708796f3eb83
- cand-r2: 5be7240b172de7b757226a6c60a7eff7058edc19113793473ef27dd843a14836
- cand-r3: 63889fbe27bf038c4b317402037dd55e7ced52c3e3dc5f752ac04378e0deef32

Decision: not kept. Promoted rule failed (cand min 29 not above base max 29); speed rule failed (cand max median 57.2 not below base min 57.3). Retries raise p95 (119.4 s vs 86.3 s). Switch stays off by default.
