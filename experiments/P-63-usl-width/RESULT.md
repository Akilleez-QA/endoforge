# P-63 can the Universal Scalability Law set width: result

Status: **Recorded (probe)**, 2026-11-07, Node 26.13.0, `HEAVY_SLOTS=4 heavy-run`, on a shared desktop with other lanes running. Precommit: [PRECOMMIT.md](PRECOMMIT.md), committed and pushed at 18:13 EST (de597dd) together with the predictions (`receipt/predictions.json`) before any acceptance measurement. Round 1 ran 19:17–19:19 EST at load 12.6–16.2. Raw rows: `receipt/measured/`; the offline fits: `receipt/offline-fit.json`; everything below: `receipt/analysis.json` (from `analyze.mjs`).

**No. A USL fit to the earlier width sweeps missed the 10% bar at new widths in all three workloads, by up to 27% on the routes and 108% on the runtime. The fit's N* of 17–18 isn't coherency either. From width 16 the shared `heavy.slice` runs at its 17.9-CPU quota. Past that, throughput is the CPU that's left divided by the CPU each attempt costs, and that cost keeps rising with width. The instructions per attempt stay flat while the cycles more than double. Width 16 stays the hand-picked width, and no helper ships.**

Only one unloaded round was taken. Round 2 waited 30 minutes for a free `heavy-run` slot and then for load ≤ 16. Its first row ran at load 22–28 and came in at 30 against round 1's 112, so it's *loaded*. That met the precommitted stop condition, so round 2, the affinity arm and the calibration runs weren't measured. The acceptance figure is the one unloaded round. A second round could only lower the measured figures, and bar 1 fails on predictions that were too high, so it can't change the verdict.

## The fit

Method: nonlinear least squares on throughput with λ free, N* = sqrt((1 − σ)/κ). Sources and the fitting code are in the precommit (`usl.mjs`). Predictions came from fits to P-54 (runtime), P-58 and P-60 (route). P-57 has no width sweep.

| Workload | σ | κ | N* | Offline points |
|---|---|---|---|---|
| `route-default` (P-60 default: fused, reuse 16 MiB, baseline) | 0.033 | 0.0030 | 17.9 | 7 (P-60 rounds 3–4) |
| `route-fresh` (fused, fresh checks) | 0.011 | 0.0031 | 18.0 | 24 (P-58 + P-60) |
| `runtime` (P-54 `shared-reuse`, spin 10) | 0.037 | 0.0033 | 17.0 | 4 (P-54) |

## Bar 1: prediction accuracy

Error = (predicted − measured) / measured. New widths only.

| Width | `route-default` pred / meas / err | `route-fresh` | `runtime` |
|---|---|---|---|
| 4 | 326 / 355.7 / −8.3% | 178.1 / 140.2 / **+27.0%** | 9,661 / 7,970 / **+21.2%** |
| 12 | 631.1 / 595.1 / +6.0% | 375.3 / 344.8 / +8.8% | 18,050 / 8,678 / **+108%** |
| N* (18; 17 for runtime) | 671.2 / 622.6 / +7.8% | 404.3 / 377.1 / +7.2% | 18,906 / 14,383 / **+31.5%** |
| 20 | 668.0 / 647.3 / +3.2% | 402.1 / 366.6 / +9.7% | 18,719 / 14,552 / **+28.6%** |
| 24 | 649.2 / 577.7 / **+12.4%** | 388.8 / 378.0 / +2.9% | 18,079 / 16,379 / **+10.4%** |

**Missed**: 1 of 5 widths out for `route-default`, 1 of 5 for `route-fresh`, 5 of 5 for `runtime`. The runtime rows are short (0.2–1 s each). Its width-12 row (8,678 per second, below width 8's 10,193) looks like noise, and P-54 had no width between 8 and 16. Even leaving it out, the runtime misses at 4, 17, 20 and 24.

Shape against level. The precommitted shape-only check scales each fit to the same session's width-16 figure. It leaves `route-default` at −9.0 / +5.4 / +7.1 / +2.5 / **+11.6%**, so it still misses at 24. `runtime` comes out at −19.7 / +37.7 / −13.0 / −14.8 / −26.9%. `route-fresh` can't be scaled because its width-16 row was loaded. The misses are in the shape, not only in λ drifting between sessions.

## Bars 2 and 3

- **Bar 2 (width helper): not judged.** It depended on bar 1, and the calibration runs fell under the stop condition. The same session's sweep still answers the question it asked. For `route-default`, width 16 was best at 663.6 per second, with 20 at 647.3 (−2.5%), 12 at 595.1 and 24 at 577.7. A helper using the precommitted fit picks 18, and 18 measured 622.6, 6.2% below 16. That's worse than 16 and outside 5% of the best width, so it would have missed.
- **Bar 3 (calibration ≤ 60 s): not measured.** From round 1's walls, a quarter-length sweep at widths 1, 4, 8, 16, 24 and 32 needs about 3 s of measuring for `route-default`, plus route start-up and building the candidates, which weren't timed separately. That's an estimate, not a bar figure.

## What limits scaling (round 1, `route-default`)

Counters are user-mode `perf stat` on the cohort process. The `heavy.slice` CPU rate counts every lane's heavy job, since other lanes share that slice and its quota. Busy CPUs counts this harness only, supervisor plus cohort.

| Width | Accepted/s | CPU ms per accepted | Busy CPUs | `heavy.slice` CPUs (quota 17.9) | Throttled ms | M instructions per attempt | M cycles per attempt | IPC | DRAM fills per attempt | Cross-CCX fills per attempt | Cohort DRAM GB/s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 112.0 | 11.8 | 1.3 | 5.0 | 0 | 84.0 | 49.3 | 1.70 | 118,160 | 246 | 0.85 |
| 4 | 355.7 | 13.4 | 4.8 | 6.9 | 0 | 82.0 | 55.2 | 1.48 | 118,970 | 22 | 2.71 |
| 8 | 447.9 | 19.5 | 8.7 | 11.7 | 0 | 81.0 | 80.8 | 1.00 | 150,458 | 6,113 | 4.31 |
| 12 | 595.1 | 19.5 | 11.6 | 13.8 | 0 | 78.5 | 80.2 | 0.98 | 150,739 | 13,242 | 5.74 |
| 16 | 663.6 | 22.3 | 14.8 | 17.3 | 165 | 77.0 | 93.5 | 0.82 | 172,984 | 14,570 | 7.35 |
| 18 | 622.6 | 25.2 | 15.7 | 17.9 | 706 | 76.3 | 106.2 | 0.72 | 188,046 | 13,972 | 7.50 |
| 20 | 647.3 | 25.0 | 16.2 | 17.9 | 2,144 | 76.4 | 105.7 | 0.72 | 194,675 | 13,443 | 8.06 |
| 24 | 577.7 | 26.8 | 15.5 | 18.0 | 6,238 | 75.4 | 113.6 | 0.66 | 198,448 | 13,076 | 7.34 |
| 32 | 453.5 | 27.0 | 12.2 | 17.9 | 18,995 | 75.4 | 114.1 | 0.66 | 202,822 | 11,397 | 5.89 |

1. **A hard CPU ceiling at width 16.** `heavy.slice` reaches its 1,792% quota at width 16 (17.3 CPUs) and stays at 17.9–18.0 from 18 up, with throttling going from 0.2 s to 19 s per row. Accepted per second is busy CPUs divided by CPU per accepted, by definition. What matters is that busy CPUs stop rising at 16: past that, this harness can't get more CPU, so throughput can only fall as each attempt gets dearer. At 32 its share fell to 12.2 CPUs. `route-fresh` shows the same thing as a flat plateau, 366–378 per second from 18 to 32 at 15.5–16.3 busy CPUs and 18.0 slice CPUs.
2. **Each attempt costs more cycles, not more work.** Instructions per attempt fall slightly (84 → 75 M) while cycles per attempt rise 2.3× (49 → 114 M). IPC halves by width 16. There's no extra software work, so this isn't coherency in USL's sense of pairwise exchange. It's the hardware getting less efficient per core. The big step is from 4 to 8: cross-CCX fills go from 22 to 6,113 per attempt and DRAM fills rise 26%, which is what work spreading onto the 7950X's second CCD would look like. They keep rising (+46% DRAM fills per attempt by 16, +72% by 32). `route-fresh` and `runtime` show the same direction, smaller for `route-fresh` (IPC 1.39 → 0.97).
3. **Not a memory-bandwidth cliff.** The cohort pulled at most 8.1 GB/s from DRAM (fills × 64 B), far below what dual-channel DDR5 delivers, and DRAM fills per attempt rise smoothly rather than in a step. `perf_event_paranoid` is 2, so the system-wide L3 and memory-controller counters weren't readable. Bandwidth from other processes, and L3 occupancy, aren't measured.

The USL fit folds both effects into one smooth curve. The pre-quota growth in per-attempt cost looks like σ and κ, and the quota looks like a peak. With all nine widths refitted, `route-default` gets σ 0.005, κ 0.0041, N* 15.5, with systematic residuals: −27% at 1, −14% at 4, +15% at 8, +9% at 32. Fitted on widths ≤ 16 only, the best fit is pure contention (σ 0.11, κ 0), and it overpredicts 24 by 27% and 32 by 72%. `route-fresh` behaves the same way: σ 0.025, κ 0, overpredicting 18–32 by 21–75%. Past 16 the curve breaks as a regime change, not the smooth turn USL predicts.

## Rivals

- **Quota cliff: supported.** N* sits where `heavy.slice` hits its quota, throttling starts at width 16, and this harness's busy CPUs stop rising there. In this harness the quota alone explains most of where width stops paying.
- **SMT regime past 16: not separated from the quota.** Widths above 16 ran with the quota binding, so the break past 16 fits either explanation. The affinity arm (`taskset -c 0-15`, 16 physical cores, under the quota) would have told them apart, and it wasn't run. Instructions per attempt are flat across 16 → 32, so whichever it is, it isn't extra work.
- **Memory bandwidth / LLC cliff: bandwidth not supported, LLC/CCD locality partly.** Bandwidth stayed low and smooth. The step in IPC and cross-CCX fills between widths 4 and 8 is a locality effect, and it sits well before the throughput peak.

## Decision

Under the precommitted rule, bar 1 missed, so the fit isn't trusted to set width. `usl.mjs` moved from `tools/width/` into this directory as fitting code only, and nothing new is under `tools/`. Width 16 stays the hand-picked figure. In the same-session sweep no width beat 16 by more than 10% for `route-default`. `route-fresh` (16 was loaded) is flat at 18–32. `runtime` was 31% faster at 24 than at 16, but that's one round of sub-second rows, and the rule needs both rounds, so it isn't a finding.

For whoever sets width next: in this harness the useful width is about the number of CPUs the job can actually get. That's the slice's 17.9-CPU quota minus other lanes' share, read from `heavy.slice/cpu.stat`. Past that, width only adds queueing and per-attempt cost. A rule like "width = available CPUs from cgroup accounting, capped at 16" is a hypothesis this probe suggests and didn't test.

## Not shown or unverified

- One unloaded round. Round 2's only row was loaded, and the affinity arm and the calibration runs (bars 2 and 3) weren't measured, under the stop condition.
- Measured from a checkout of PR #109's head (`16b7b9c`) before it merged. `tools/tscheck`, `core/runtime/contained` and the P-54 harness are byte-identical between that commit and the main this branch merged (f6711a7), so `route-default` is main's route default.
- Other lanes' heavy jobs shared `heavy.slice`'s quota during every row (2.6–8.1 CPUs of it in the width-1 rows). The CPU left over for this harness varied between rows.
- `perf` counted the cohort process only, in user mode. The supervisor, the kernel and the rest of the machine aren't counted. Uncore L3 and DRAM-controller counters need `perf_event_paranoid` ≤ 0, which wasn't changed.
- Runtime rows last 0.2–1 s, too short for steady-state counters. Its width-12 row is an outlier.
- A design-time smoke run (width 2, scratch directory, not a receipt) ran before the lane governor lease was held.
- Node 22 wasn't run.
