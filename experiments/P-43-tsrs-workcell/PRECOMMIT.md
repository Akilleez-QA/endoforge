# P-43 tsrs in the workcell pool: precommit

Label: **Proposed** procedure, frozen 2026-11-06 before measurement.

Question: P-20's addendum recorded the TypeScript checker blocked by the WASM guard in `IsolatePool`. With a pinned module and an optional stack limit, does tsrs run in a thread workcell with diagnostics matching the native TypeScript compiler, and what width does it support on one host?

Pins: `@tsrs/wasm` 0.22.0-ts7.1.0-beta through `tools/tscheck/pin.mjs`; oracle `typescript` 7.1.0-beta; Node as recorded in the receipt. Workcell: `tools/tscheck/pin.mjs` `WORKCELL`, one job per cell, `jobTimeoutMs` 120000.

Inputs: frozen synthetic check workloads, small, medium and stress (well, ill, ill-syntax) and 11 adversarial dos projects, already written to disk with their tsconfig, 20 projects. Input digests are recorded in the receipt.

Parity arm: one pre-warmed cell. Each project runs as one real pool job with the real evaluator, frozen check and ledger receipts, with the check as the `typescript` invariant. The oracle runs `tsc -p tsconfig.json --noEmit --pretty false` on the same files. Compare the sets of file, line, column and code, and the first line of each message.

Warm arm: one cell, `medium/ill`, 1 cold job then 20 jobs. Record compile time, wall time per check, linear memory and RSS.

Width arm: N = 1, 4, 8, 16, 28 thread cells, 8 × N jobs of `medium/ill` on one shared ledger, 3 reps, recording checks per second, p50 and p95 check time, and peak RSS. Stop widening if MemAvailable falls below 30 GiB, any diagnostic set differs, or a job is not completed.

Breach arm: 8 cells, one job with a heap-exhausting port while others run the check. Count lost siblings and whether the replacement completes.

Success boundary: every parity project completes with matching location sets and no trap, and no sibling is lost in the breach arm.

Failure meaning: a difference, trap or lost sibling is a failure for that scope and stays recorded. A trap or deadline on a dos project is a failure of parity for that project, not of containment.

Limits: a shared desktop with other work running, no quiet gate, and a thread-mode cell is not an OS sandbox. This does not execute candidate JavaScript, does not qualify hosted fit, and is not a campaign.

## Amendment 1, after the first run

The first breach arm lost 7 of 7 siblings. It is recorded as `breach_first_run_invalid` in `receipt/summary.json` and is invalid for containment: the harness lowered the old generation to 256 MiB, and a single healthy job with no breach and no neighbour also ends in `ERR_WORKER_OUT_OF_MEMORY` at that limit. Prediction for the rerun: with the unchanged `WORKCELL` limits and siblings held mid-job until the breach has finished, 0 of 7 siblings are lost and the replacement completes. Any lost sibling is a failure. Parity, warm and width arms are not rerun.
