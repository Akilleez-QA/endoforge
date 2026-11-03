# P-41-reference result

Verdict: NO GAIN (quality gate failed). Default stays exact.

| arm | run | promoted/30 | median s | p95 s | retried | skipped (budget/error) | cancelled | not promoted |
|---|---|---|---|---|---|---|---|---|
| base | 1 | 30/30 | 60.4 | 85.3 | 0 (0 promoted) | 0/0 | 0 | - |
| cand | 1 | 28/30 | 46.6 | 85.2 | 0 (0 promoted) | 0/0 | 0 | C-016 CC-001 |
| base | 2 | 29/30 | 57.2 | 92.8 | 0 (0 promoted) | 0/0 | 0 | C-012 |
| cand | 2 | 27/30 | 48.6 | 71.2 | 0 (0 promoted) | 0/0 | 0 | CC-036 C-016 C-007 |
| base | 3 | 29/30 | 56.1 | 92.3 | 0 (0 promoted) | 0/0 | 0 | C-010 |
| cand | 3 | 28/30 | 48.3 | 76.7 | 0 (0 promoted) | 0/0 | 0 | CC-027 add-1 |
| base | 4 | 29/30 | 59.0 | 89.0 | 0 (0 promoted) | 0/0 | 0 | C-006 |
| cand | 4 | 27/30 | 44.7 | 78.4 | 0 (0 promoted) | 0/0 | 0 | C-015 CC-001 C-005 |
| base | 5 | 29/30 | 58.8 | 85.9 | 0 (0 promoted) | 0/0 | 0 | C-010 |
| cand | 5 | 28/30 | 46.9 | 72.6 | 0 (0 promoted) | 0/0 | 0 | C-019 add-7 |
| base | 6 | 28/30 | 58.0 | 88.5 | 0 (0 promoted) | 0/0 | 0 | CC-036 C-012 |
| cand | 6 | 30/30 | 49.6 | 74.3 | 0 (0 promoted) | 0/0 | 0 | - |

| arm | promoted min / total | median mean s | p95 mean s | retries (promoted) |
|---|---|---|---|---|
| base | 28 / 174 | 58.3 | 89.0 | 0 (0) |
| cand | 27 / 168 | 47.5 | 76.4 | 0 (0) |

quality no worse: False; median mean lower: True; p95 within +5 s: True
NO GAIN

receipt sha256:
- base-r1: 993404be724b2f55b9d62285b69439257ebc302e7a3d6be2d5bb79c7e3339bd0
- base-r2: 0836b581bfa8ad211cfb5937b37e3b6ae1efa4b4898cfc61781365fcf32f256b
- base-r3: d01f453f3e824d5b2c272f27b3386e5b4248946f5c75b2e1f101e09670c8dbbf
- base-r4: 080f15d1d663a18b14c431f6272aed2159fb1dfaf3c4a184f33c8dfa5374e59d
- base-r5: 2235bf4313079ad77b99f208703f266932b242c6b67319b1b624c995da61b056
- base-r6: f11f12d5cd9aa98fcc5d5f3e7b4a8b27e1b248aa29df225c42fe1fbd6e0150f2
- cand-r1: c8d5847368d14a6ffccad59e680227ed9783dfc0ea8061dd68cb215e06055947
- cand-r2: 0e9c1735424290155a48eee1e9de0b029f2f7b38055b0b459c1d2e1801f9e6c2
- cand-r3: 72c80fca41a0ca54ad61e72ac4367600cdb1cd15ca1922644331a323f6a1ffe5
- cand-r4: 1eb2e081c83dc20bde31506ea1bcdbdd5f49acb9710e614cd3100422b69d295c
- cand-r5: 33487758d466d9f0f27749289e5221a7aa2c11ad13cfd91f2630b4791e344af3
- cand-r6: 87240303a309b17e995eaa857a65949d66e57ab25a42e815cb873c933e1a8904

## Correction note (2026-11-03)

Reference mode replaces model-written expected numbers with reference-computed ones before freeze. This correction note changes no existing golden files or assertions.

## Failure analysis

Candidate is 10.8 s faster on median mean and 12.6 s faster on p95 mean, but promotes 168 vs 174 (min 27 vs 28).

Every candidate rejection is G4_tests on expectError cases whose inputs a scalar wasm boundary cannot represent: fractional values for integer parameters (C-016, C-015), null (JSON form of a non-finite or missing value: CC-001, CC-036, C-007, CC-027, add-1), and numeric strings (CC-001, C-005, add-1). reference.js throws on them in JavaScript, so the evaluator accepts them, but the wasm export coerces and returns a value.

Baseline rejections are different: memory-out-of-bounds on string/array arguments (C-012), Array<f64> at the boundary (C-010), and one wrong expected value (C-006).

General cause, shared with C-010: the spec stage is not told the boundary is finite scalars only, and freeze does not reject tests whose args are not finite numbers. Next lever: reject at freeze (or in fillExpected) any test with a non-finite-number argument, and state the scalar-only boundary in the spec rule.
