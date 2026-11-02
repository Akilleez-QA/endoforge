# P-42-scalar result

Verdict: KEPT. All three keep-rule parts hold. Run commit 34142b526ffad741899e16f0f3180cd5ed9576b0.

| arm | run | promoted/30 | median s | p95 s | not promoted |
|---|---|---|---|---|---|
| base | 1 | 29/30 | 50.7 | 73.7 | C-010 |
| base | 2 | 29/30 | 52.4 | 68.0 | C-012 |
| base | 3 | 29/30 | 51.9 | 74.7 | C-010 |
| base | 4 | 28/30 | 50.7 | 67.6 | C-012 add-8 |
| base | 5 | 29/30 | 53.9 | 70.2 | C-010 |
| base | 6 | 28/30 | 51.7 | 68.9 | C-019 C-010 |
| cand | 1 | 29/30 | 48.6 | 67.0 | add-2 |
| cand | 2 | 30/30 | 46.4 | 65.2 | - |
| cand | 3 | 29/30 | 53.2 | 63.6 | CC-036 |
| cand | 4 | 29/30 | 48.4 | 74.7 | CC-009 |
| cand | 5 | 30/30 | 48.9 | 66.4 | - |
| cand | 6 | 30/30 | 47.2 | 67.7 | - |

| arm | promoted min / total | median mean s | p95 mean s |
|---|---|---|---|
| base | 28 / 172 | 51.9 | 70.5 |
| cand | 29 / 177 | 48.8 | 67.4 |

quality no worse: True; median mean lower: True; p95 within +5 s: True

The candidate no longer loses C-010 or C-012, the two boundary failures the baseline repeats. Six runs per arm cannot detect small effects.

receipt sha256 (summary.json):
- base-r1: 05a2d0802af1ae5f8aaadcde1721515fbed131ceea42ad8b40146a1ebfcd6edf
- base-r2: 64246d045d0625b8f584eac8bbd6b1929edeb995256fd4d2335efb435769fac9
- base-r3: 353e0716716d3a9694b5cf952bb787c91d58756d8cdc74a82b5dd5a11558b849
- base-r4: 04b8f99a94da1288b3cb63d04f961e884c284af9c64cd15373facdae18c7dd21
- base-r5: 405decdc7c510f75ac5d706c9a6b08d9d46c8aca5c9f65fd9b0eee854ddfe8d6
- base-r6: b4863684e3d2645b4c1fc98af38476c181b1c0fbe8d235fffec3205ced24f916
- cand-r1: 30b2d40e548c70dc785ab6d4330810ffb741d0ace5bc8d86e94a17fdb4ec4ec0
- cand-r2: e869a70d6e359d690566256face1288a8653c5984068146bc1ff24b1eab9f4d9
- cand-r3: 91c2309508464715cdf3ca9a73841edb2224a23a48a7e5a1b67dd966c743c22f
- cand-r4: 668fdd810f0520da4de318e9f88fd9f39728c556f1790e8576da6defe6ba575f
- cand-r5: d25dfa87cd330773c5c63ebac1ac15f7b1b7d3a420e2cdded3926d749e90df46
- cand-r6: 9f22e09259160158b09819a2461fc27ab0a256e124e2c1852c47bd98cf2cbbb0
