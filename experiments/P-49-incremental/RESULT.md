# P-49 `.tsbuildinfo` feedback between checks in a workcell: result

Status: **Recorded (probe)**, 2026-11-06, Node v26.13.0, a shared desktop with other agent work running. Precommit: [PRECOMMIT.md](PRECOMMIT.md); the last digest in `receipt/precommit.sha256` covers Amendment 1. Raw results: [summary.json](receipt/summary.json).

**It works where the change is small, and parity held.** All 220 comparisons of full and incremental checks gave the same diagnostics and exit code, over 4 workloads and 5 reps. A one-file edit took 65–80% less time. An edit to a widely imported type took longer than a full check.

Median wall time for full against incremental, ms. "Leaf" is the module with the fewest importers (1), and "shared" the most imported (10–11).

| Step | `medium/ill` | `medium/well` | `stress/ill` | `stress/well` |
|---|---|---|---|---|
| Seed | 104, 110 | 112, 114 | 1,213, 1,227 | 1,471, 1,352 |
| Leaf comment | 104, 35 (−66%) | 116, 38 (−67%) | 1,239, 290 (−77%) | 1,266, 307 (−76%) |
| Leaf body | 108, 30 (−72%) | 113, 39 (−65%) | 1,250, 247 (−80%) | 1,291, 252 (−80%) |
| Leaf adds an error | 106, 32 (−70%) | 115, 37 (−68%) | 1,224, 287 (−77%) | 1,273, 311 (−76%) |
| Leaf restored | 101, 32 (−68%) | 113, 38 (−66%) | 1,199, 296 (−75%) | 1,266, 312 (−75%) |
| Shared type changed | 107, 142 (+33%) | 125, 150 (+20%) | 1,196, 1,416 (+18%) | 1,251, 1,481 (+18%) |
| Shared restored | 105, 109 (+4%) | 115, 118 (+3%) | 1,244, 1,131 (−9%) | 1,269, 1,212 (−4%) |
| Leaf syntax error | 19, 30 | 23, 39 | 133, 238 | 155, 266 |
| Leaf restored | 103, 32 (−69%) | 114, 41 (−64%) | 1,218, 290 (−76%) | 1,285, 324 (−75%) |
| Options changed | 98, 100 | 113, 114 | 1,206, 1,163 | 1,290, 1,335 |
| Options restored | 102, 102 | 114, 117 | 1,184, 1,206 | 1,328, 1,261 |

A full check stops early on a syntax error, so incremental is slower there in percentage terms, by about 10–110 ms. Build info is 22–31 KB on medium and 172–196 KB on stress, and about 340 KB after the shared type change.

## Predictions

1. Parity at every step: **held**, 220 of 220, including exit codes.
2. Stress at least 30% less, medium at least 15% less, on `comment` and `body`: **held**, 76–80% and 65–72%. The precommit reasoned that parsing again would limit the saving, and it was far less limiting than expected.
3. `export-type` and `options` save less than `comment`: **held**, and `export-type` costs more than a full check.

## Decision

`typecheck(project, {buildInfo})` ships, because parity held and the saving passed the bar. It's refused with `emit`, because an incremental emit needn't rewrite unchanged files, so its artifact wouldn't be complete. `tools/tscheck/port.mjs` doesn't use it, so pool verdicts are still full checks. Wiring it into a verdict would need the trust question below settled first.

## What this does not show

- **Build info decides which diagnostics are reused, so it's trusted input.** The test suite shows a forged file with `semanticDiagnosticsPerFile` removed turning a real error into no diagnostics. It must come from the caller's own previous check, never from a candidate. A chain of feedback over longer sequences, a corrupted file, and a compiler bump aren't tested.
- Parity on these synthetic edits doesn't establish general parity. Only one compiler version was tested.
- Medians of 5 reps on one host, with no quiet gate. Each check here is in a warm instance sequence, and a pool job adds frozen-check cost ([P-48](../P-48-width/RESULT.md)) that this doesn't reduce.
