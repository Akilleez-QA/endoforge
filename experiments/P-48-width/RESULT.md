# P-48 what limits checker throughput at width: result

Status: **Recorded (probe)**, 2026-11-06, Node v26.13.0, 32 threads, a shared desktop with other agent work running. Precommit: [PRECOMMIT.md](PRECOMMIT.md). Raw results: [summary.json](receipt/summary.json).

**The compiler isn't the limit, and the evaluator's frozen check is the likely one, though this doesn't prove it.** Each `requireFrozen` starts a Python process, and a job spends more time there than in its check. Calls stop scaling near 50–70 per second, however many cells make them. No arm removes the check, and thread `full`, at 18–20 jobs per second with 2 calls each, makes about 38 calls per second, below that ceiling, so the ceiling alone doesn't account for it. Thread cells also pay for sharing one address space. No code changes here. This paragraph first said the frozen check was the limit, and was corrected after review.

Rates per second, 2 reps on `medium/ill`, under `heavy-run`'s 1,792% CPU quota and `nice 10`. A unit is a job in the pool arms and a call or check otherwise.

| Cells | `calibration` | `compiler` | `frozen` | `harness` | `full` (thread) | `full-process` | `touch` | `touch-process` |
|---|---|---|---|---|---|---|---|---|
| 1 | 1.6, 1.6 | 6.6, 8.7 | 12.1, 10.4 | 2.3, 2.1 | 3.6, 3.2 | 3.7, 3.9 | 23.5, 32.0 | 28.6, 29.6 |
| 4 | 6.4, 6.4 | 25.0, 33.3 | 44.4, 39.0 | 9.1, 7.4 | 12.2, 10.5 | 14.0, 12.9 | 64.0, 72.7 | 76.2, 71.1 |
| 8 | 12.0, 12.7 | 52.9, 64.6 | 68.8, 52.9 | 13.2, 10.5 | 14.0, 15.0 | 24.8, 22.0 | 58.2, 59.3 | 103.2, 97.0 |
| 16 | 24.2, 24.7 | 86.5, 95.5 | 61.5, 47.6 | 14.5, 10.2 | 19.4, 18.3 | 34.5, 32.2 | 55.9, 64.0 | 117.4, 100.0 |
| 28 | 26.4, 27.5 | 70.0, 77.2 | 69.6, 50.7 | 13.4, 10.0 | 19.5, 18.0 | 22.7, 23.5 | 63.3, 59.4 | 79.2, 69.1 |

## What separates them

- **Compiler: not the limit.** With no evaluator or ledger it reached 86–96 checks per second at 16 cells, about five times `full`. Its p50 stayed at 134–166 ms, while the same check in `full` took 414–470 ms at 16 cells.
- **Frozen check: the largest share, and the likely limit.** At one cell, a call took 82–97 ms. A rejected job makes 2 calls and runs 1 check of about 110 ms, so about 60% of its 290 ms goes to frozen calls. The `frozen` arm stops scaling at 8 cells, near 50–70 calls per second, on only 6–7 CPUs with no quota throttling, so it's waiting on something other than CPU. A passing job makes 5 calls, and `harness`'s 10–14 jobs per second is that same ceiling (50–73 calls per second). This probe doesn't identify the lock. `child_process` spawn from one large address space is the likely place.
- **Thread cells' shared address space: real, and second.** Process cells did the same work at 32–35 jobs per second at 16 cells, against 18–19 for threads, with check p50 at 195–228 ms against 414–470 ms. Raw memory churn shows the same split: `touch` is flat near 60 per second from 4 cells on, using 5–10 CPUs, and `touch-process` reaches 100–117 using 17.
- **Ledger: not the limit.** `full-process` sustained higher throughput with a ledger p50 of 73–82 ms at 16 cells. In `full` it rose to 436–497 ms at 16 and over 1 s at 28. That rise is on a supervisor sharing the cells' address space, and since the process arm does not show it, it's more likely an effect than a cause.
- **Desktop: not the primary cause.** Other load was mostly 1–10 CPUs, with one 18-CPU sample, and `calibration` stayed linear to 16 cells (15× one cell) anyway.
- **The fall at 28 is the quota in this harness.** `calibration` itself stopped at 17.8 CPUs, and every arm that reached the quota was throttled. This can't say what P-43's fall at 28 was without knowing its CPU limit, which isn't recorded.

## Predictions

1. `calibration` close to linear to 16, limited by quota at 28: **held**, 15× at 16.
2. `compiler` flattens early and `compiler-process` beats it by 1.5× at 16: **failed**. `compiler` scaled, and `compiler-process` was worse, at 35–44 against 87–96. With 8 units, each process's first checks are unoptimized, as its p95 of 1.3–1.8 s shows, and it hit the quota, so this arm understates steady-state processes. `full-process` is the better comparison.
3. `harness` sustains well above `full`'s peak: **failed**, 10–15 against 18–20. A passing job makes 5 frozen calls and a rejected one 2, so the frozen ceiling is what's visible.
4. Other load under 4 CPUs: **failed on the numbers**, as above, though it isn't the primary cause.

`timings.gate` includes the job's queue wait, since it starts when the job is prepared, so with 8 × N jobs queued it can't separate the gate's own work. The per-job split here comes from the `frozen` arm and the checker's wall time.

## What would change it

A persistent frozen-check bridge, as [P-25](../P-25-pool-ledger/RESULT.md) did for the ledger, is the obvious next test. It would keep the check's identity comparison and change how it's run. It isn't part of this work and has no evidence yet.

## What this does not show

- It ranks limits on one workload, `medium/ill`, whose jobs are all rejected. Passing jobs make more frozen calls.
- Runs are short (8 units per cell). Two reps, no quiet gate, a CPU quota and `nice 10`, so absolute throughput isn't comparable with P-43.
- This stack shares the compiled module in thread cells, and process cells don't. Process mode is not free: it compiles per cell and costs RSS, which isn't measured here.
