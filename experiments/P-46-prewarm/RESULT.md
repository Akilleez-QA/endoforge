# P-46 loading a host module's warm state in `ready()`: result

Status: **Recorded (probe)**, 2026-11-06, Node v26.13.0, a shared desktop with other agent work running. Precommit: [PRECOMMIT.md](PRECOMMIT.md). Raw results: [summary.json](receipt/summary.json).

**Warm state removes the first job's penalty and moves its cost into `ready()`.** The total doesn't shrink.

Means on `medium/ill`, 5 reps at N = 1, 3 reps at N = 8. These cells compiled their own module; the run predates sharing being the `WORKCELL` default ([P-45](../P-45-shared-module/RESULT.md)), so the 8-cell `ready()` figures are per-cell compile.

| Cells | Arm | `ready()` | First job | Later median | `ready()` + first | First `compileMs` |
|---|---|---|---|---|---|---|
| 1 | `prewarm` | 52 ms | 2,087 ms | 254 ms | 2,139 ms | 1,698 ms |
| 1 | `warm` | 1,781 ms | 379 ms | 253 ms | 2,160 ms | 0 |
| 1 | `warm-probe` | 1,845 ms | 342 ms | 255 ms | 2,187 ms | 0 |
| 8 | `prewarm` | 62 ms | 5,826 ms | 385 ms | 5,888 ms | 5,293 ms |
| 8 | `warm` | 5,268 ms | 610 ms | 397 ms | 5,878 ms | 0 |
| 8 | `warm-probe` | 5,438 ms | 468 ms | 372 ms | 5,906 ms | 0 |

Diagnostics were 40 in every run, and all first jobs completed.

## Predictions

1. `prewarm` first job above 1,300 ms: **held**. Later jobs at about 400 ms: **wrong**. They were about 254 ms, because a rejected candidate has one check and one round, not two.
2. `warm`: `compileMs` 0 and first job down at least 60%, still above later jobs: **held**, down 82% at one cell and 90% at eight.
3. `warm-probe` within 1.25 × later: **failed**, 1.34 × at one cell and 1.26 × at eight. A trivial probe doesn't warm what a real check uses: it saved 37 ms at one cell, for 64 ms more `ready()`.
4. Diagnostics match: **held**.

## Decision

`warm` ships as an opt-in. `probe` was removed after this run, as the precommit's decision called for, so this harness's `warm-probe` arm no longer has an effect on the code as shipped.

## What this does not show

- The first job remains slower than later ones, at 1.5 × at one cell. A first real check is still cold.
- It doesn't reduce total work, so it only helps a caller who can wait in `ready()`.
- One host, a few reps and no quiet gate. Only the tscheck host module has a `warm` export.
