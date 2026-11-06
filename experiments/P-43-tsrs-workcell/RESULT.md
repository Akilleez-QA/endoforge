# P-43 tsrs in the workcell pool: result

Status: **Recorded (probe)**, 2026-11-06, Node v26.13.0, AMD Ryzen 9 7950X, a shared desktop with other agent work running and no quiet gate. Precommit: [PRECOMMIT.md](PRECOMMIT.md). The last digest in `receipt/precommit.sha256` covers Amendment 1, and the earlier ones cover the original text and an edit to one path in that amendment. Raw results: [summary.json](receipt/summary.json).

[P-20's addendum](../P-20-pool-speed-rerun/RESULT.md) recorded the TypeScript checker blocked by the WASM guard in `IsolatePool`. With a hash-pinned module, a 1 GiB WASM ceiling and an optional 256 MB stack, it now runs in a thread workcell, through the real evaluator, frozen check and ledger receipts.

## Parity

All 20 projects completed with matching location sets, matching first-line messages and matching exit codes against `typescript` 7.1.0-beta. There were no traps. The 11 adversarial dos projects all finished under the 120 s job deadline; `deep-array-nesting` took 17.2 s.

| Project | Files | Diagnostics | Check | Linear memory |
|---|---|---|---|---|
| small/ill | 69 | 10 | 17 ms | 98 MiB |
| medium/ill | 259 | 40 | 148 ms | 112 MiB |
| stress/ill | 2,061 | 123 | 1,293 ms | 252 MiB |
| stress/well | 2,061 | 0 | 1,131 ms | 252 MiB |

## Warm reuse

One cell on `medium/ill`: the module compiled once in 1,222 ms, the guard's instrumentation included. The first check took 202 ms; the next 20 had a p50 of 119 ms and a p95 of 164 ms.

## Width

`medium/ill`, 8 × N jobs on one shared ledger, 3 reps, no incorrect result.

| Cells | Checks/s (3 reps) | Check p50 | Check p95 | Peak RSS |
|---|---|---|---|---|
| 1 | 3.3, 3.1, 3.3 | 136–142 ms | 140–159 ms | 0.6 GiB |
| 4 | 11.3, 11.3, 11.4 | 122–133 ms | 137–168 ms | 1.8 GiB |
| 8 | 16.5, 14.4, 14.4 | 153–173 ms | 193–222 ms | 3.1 GiB |
| 16 | 16.6, 15.5, 14.1 | 285–308 ms | 388–451 ms | 5.8 GiB |
| 28 | 11.7, 11.5, 11.8 | 622–722 ms | 1,134–1,586 ms | 9.0 GiB |

Peak RSS is the largest `cellRssMiB` of the three reps, divided by 1,024. It was first published divided by 1,000.

Throughput flattens by 8 cells and falls by 28. That is narrower than P-17's 20–32 for AssemblyScript kernels. This probe doesn't separate the compiler, the ledger, the evaluator's Python frozen check or the shared desktop as the cause.

## Breach

**The first run failed:** 7 of 7 siblings lost and no replacement. It is kept as `breach_first_run_invalid`. The harness had lowered the heap to 256 MiB, and a healthy job alone, with no breach and no neighbour, also ran out of memory at that limit, which shows the arm did not test containment. It also shows that a `tsrs` cell needs more than 256 MiB of old generation on this input.

With the unchanged limits and siblings held mid-job until the breach finished: the breached cell reported `ERR_WORKER_OUT_OF_MEMORY`, **0 of 7 siblings were lost**, and a later job completed. That job ran on sibling cell 1, not on the replacement, since the siblings had been released by then (`replacementWorkcell` in the receipt). So this run doesn't show the replacement cell working. That is one run, and it is thread mode.

Amendment 2 adds a check that does, with the prediction in [PRECOMMIT.md](PRECOMMIT.md) and the result in [its receipt](receipt/amendment-2-replacement.json). With 7 siblings still held after the breach of cell 8, the next job ran on new cell 9 and completed, and 0 of 7 siblings were lost. **The prediction held.** That is one run on a one-file synthetic input, since the original workload isn't on this machine.

## What this does not show

- Candidate JavaScript still does not execute. Emit exists, but WP22's contained executor doesn't.
- Thread mode isn't an OS sandbox. A native crash or global OOM can still take the host. Process mode can't use `stackSizeMb` yet.
- Only heap breach was rerun in this arm. A WASM ceiling breach by a pinned compiler wasn't tested here.
- The parity inputs are synthetic. A clean-only comparison on one real project is recorded separately from this probe.
- tsrs is an experimental upstream release. Parity on these inputs doesn't establish general parity.
- It isn't a campaign: one lifetime, three reps, and no quiet gate.
