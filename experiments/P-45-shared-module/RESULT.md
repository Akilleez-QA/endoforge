# P-45 one verified compiled module across thread workcells: result

Status: **Recorded (probe)**, 2026-11-06, Node v26.13.0, a shared desktop with other agent work running. Precommit: [PRECOMMIT.md](PRECOMMIT.md). Raw results: [summary.json](receipt/summary.json). One wiring smoke at N = 1, not kept, ran before the precommit froze.

**Sharing works, and it's better on every measure at 8 and 16 cells.** At one cell it's slower: 2,185 ms against 2,023 ms to the first result, and 3.8 checks/s against 4.1. One guard-instrumented `WebAssembly.Module` was posted to thread cells, and the containment tests pass.

Means of 3 reps on `medium/ill`, `tools/tscheck/pin.mjs` limits, 8 × N jobs after the first batch.

| Cells | Arm | `ready()` | First batch | Per-cell `compileMs` p50 | `ready()` + first | Peak RSS | Checks/s |
|---|---|---|---|---|---|---|---|
| 1 | per-cell | 52 ms | 1,970 ms | 1,590 ms | 2,023 ms | 728 MiB | 4.1 |
| 1 | shared | 1,792 ms | 393 ms | 4 ms | 2,185 ms | 727 MiB | 3.8 |
| 8 | per-cell | 60 ms | 5,293 ms | 4,725 ms | 5,353 ms | 4,383 MiB | 21.0 |
| 8 | shared | 1,618 ms | 522 ms | 5 ms | 2,140 ms | 1,943 MiB | 24.0 |
| 16 | per-cell | 64 ms | 11,171 ms | 10,137 ms | 11,235 ms | 8,258 MiB | 17.5 |
| 16 | shared | 1,539 ms | 667 ms | 6 ms | 2,206 ms | 3,660 MiB | 30.7 |

Per-cell's first rep at 16 cells measured 10.3 checks/s against 21.9 and 20.4, and it's kept in the mean. Diagnostics matched in every run (40), and all jobs completed.

## Where the compile time goes

On one thread: hash 4 ms, `validate` 5–8 ms, native compile of the original bytes 4–11 ms, guarded `new WebAssembly.Module` 1,596–1,732 ms. Native compile is lazy, so **nearly all of the 1.2 s P-43 called compile is the guard's JavaScript instrumentation**, which builds arrays of the 10 MB module's bytes. That explains the RSS and the wait: each cell repeated it, and contended with the others. It is a good target for later work, and this probe does not change it.

## Predictions

1. Shared `compileMs` p50 at most 150 ms at 8 cells, per-cell at least 1,000 ms: **held**, 5 ms against 4,725 ms.
2. First batch at 8 cells at least halves: **held**, down 90%. Counting `ready()`, the fair total, it fell 60%.
3. Peak RSS at 8 cells falls at least 25%: **held**, down 56%.
4. Throughput within 10%: **failed, in the better direction**, up 14% at 8 cells and 75% at 16. The probe doesn't separate why; less retained garbage per cell is the likely cause.
5. Identical diagnostics and passing containment tests: **held**.

## The guard

Sharing doesn't weaken it on what these tests cover, so it stays on:

- The module is instrumented by the same guard in a worker before it's shared. The helpers and the breach flag live in the module, and globals and memories are per instance. A shared module growing past its cap stopped only its cell, with three siblings intact and the next job completing.
- A cell still hashes the bytes it's given. Other bytes go through the normal check. A module received through port options stays refused.
- The cell can't check that a posted `Module` matches a digest, since a `Module` has no byte accessor. It relies on the supervisor, which holds the same authority as `trustedWasmModules`.

At one cell, sharing costs slightly more in total (2,185 ms against 2,023 ms), because of an extra worker. It only moves compile cost to `ready()`.

## What this does not show

- Process mode can't share: a `Module` doesn't cross a process boundary, so those cells compile per cell.
- Instance-level limit tests use a synthetic module and one real lowered-cap test. Adversarial bytecode wasn't tested.
- One host, three reps, no quiet gate. The bottleneck at width is separate work.
