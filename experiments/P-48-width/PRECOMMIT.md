# P-48 what limits checker throughput at width: precommit

Label: **Proposed** procedure, frozen 2026-11-06 before measurement.

Question: [P-43](../P-43-tsrs-workcell/RESULT.md) found throughput flat by 8 cells and falling by 28, cause not separated. Is the limit the compiler, the ledger, the evaluator's frozen check, or the shared desktop?

Workload: `medium/ill`, the P-43 input, whose job has one check. Limits: `tools/tscheck/pin.mjs`. Base: this PR's stack, so thread cells share the compiled module ([P-45](../P-45-shared-module/RESULT.md)); process cells compile their own. Widths N = 1, 4, 8, 16, 28, 2 reps, 8 × N units per run, compile excluded by holding work until every cell is ready.

Arms:

- `full`: the real pool, evaluator, frozen check, ledger and checker, with `timing: true`, recording the pool's `gate` and `ledger` per job and the checker's own wall time.
- `full-process`: as `full` in process cells.
- `harness`: the pool with an identity port and no compiler, which leaves evaluator, frozen check and ledger.
- `frozen`: N threads calling `requireFrozen` only.
- `compiler`: N guarded threads running `typecheck` only, with no evaluator or ledger.
- `compiler-process`: the same in N processes.
- `touch` and `touch-process`: N threads or processes allocating a 112 MiB `WebAssembly.Memory`, touching each page and dropping it, the checker's memory pattern with no compiler. This isolates kernel memory work in a shared address space.
- `calibration`: N threads running a fixed JS loop that allocates nothing. It shows what this desktop and the job's CPU quota allow at that moment.

Every run records wall time and three CPU figures: machine-wide busy CPUs from `/proc/stat`, this job's cgroup CPU use, and their difference, which is everyone else's load. It also records `heavy.slice` `nr_throttled` and `throttled_usec`. `heavy-run` caps `heavy.slice` at 1,792% CPU, 56% of 32 threads, so 28 cells can't get 28 CPUs in this harness.

Predictions:

1. `calibration` scales close to linearly to 16 cells (at least 12×) and is limited by the quota at 28. It sets the ceiling.
2. `compiler` flattens well before calibration, and `compiler-process` beats it by at least 1.5× at 16. That would put the limit in shared-process costs, and `touch` against `touch-process` would show the same gap if the kernel's address-space lock is the reason.
3. `harness` (no compiler) sustains well above `full`'s peak, so ledger and frozen check are not the primary limit alone, though in `full` the gate time not spent checking grows with N.
4. Other load is under 4 CPUs and is not the primary cause.

Failure meaning: all are hypotheses, so any outcome stands. If two arms explain the curve equally, the result says the cause is unresolved. This changes no code.

Limits: a shared desktop with no quiet gate, one host and Node as recorded. Quota and `nice 10` from `heavy-run` apply to all arms, so absolute throughput isn't P-43's. The input is synthetic. This ranks limits on this workload only.
