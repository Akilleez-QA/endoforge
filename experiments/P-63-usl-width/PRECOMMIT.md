# P-63 can the Universal Scalability Law set width: precommit

Label: **Proposed** procedure, frozen 2026-11-07 before any acceptance measurement. Amendments go below with a new digest appended to `receipt/precommit.sha256`; the first digest stays.

Question: does Gunther's Universal Scalability Law, X(N) = λN / (1 + σ(N−1) + κN(N−1)), predict where width stops paying on this 16-core / 32-thread machine well enough to set width from a fit instead of picking 16 by hand?

## Source and method

- Model: N. J. Gunther, *Guerrilla Capacity Planning* (Springer, 2007), ch. 4–6, and Gunther et al., "Getting in the Zone for Successful Scalability", arXiv:0809.2541, which states the model and normalises on X(1). σ is contention (queueing for something shared), κ is coherency (pairwise exchange that makes throughput fall past a peak).
- Peak: dX/dN = 0 gives 1 − σ − κN² = 0, so N* = sqrt((1 − σ)/κ). Derived here from the model; κ = 0 means no peak inside the range (Amdahl).
- Fit: nonlinear least squares on throughput with λ free, as the R `usl` package (S. Moeding, CRAN) does with `nls`. Here λ is solved in closed form for each (σ, κ) and (σ, κ) are found by grid then refinement, with σ in [0, 1] and κ in [0, 0.25]. Every unloaded round point is a sample (not round means). Code: `tools/width/usl.mjs` (`fitUsl`, `pickWidth`, `calibrateWidth`), driven offline by `fit.mjs`.

## What exists before measuring (offline, from receipts only)

`fit.mjs` fits every recorded width sweep: P-54 (runtime, widths 1/8/16/32), P-58 (route, 1/8/16/32 and the diagnose 1/8/16), P-60 (route, 1/8/16/32, four rounds, read from PR #109 head `16b7b9c`, copied to `receipt/source/`) and P-48 (1/4/8/16/28). Output: `receipt/offline-fit.json`. P-57 has no width sweep (4 cells against 1, 64 or 256 candidates in flight, bridge-bound), so it isn't fitted.

| Workload | σ | κ | N* | Width-1 residual | 32 predicted from widths ≤ 16 / measured |
|---|---|---|---|---|---|
| route `fused-reuse16-base` (P-60 default) | 0.033 | 0.0030 | 17.9 | −13.9% | 716 / 584 |
| route `fused` fresh (P-58 + P-60) | 0.011 | 0.0031 | 18.0 | −6.7% | 378 / 348 |
| runtime `shared-reuse` spin 10, Node 26 (P-54) | 0.037 | 0.0033 | 17.0 | −2.9% | 16,903 / 16,304 |
| route `supervisor` | 0.92 | ~0 | none | 0% | flat at 56 |
| bare check, threads (P-58 diagnose) | 0.018 | 0.0017 | 23.9 | exact (3 points) | — |
| P-48 `calibration` / `compiler` / `full-process` | 0 | 0.0011 / 0.0028 / 0.0042 | 30 / 19 / 15 | +13% / +15% / 0% | — |

Already visible, and the reason this may fail:

1. Four widths and three parameters leave one degree of freedom per round, so the offline fits nearly interpolate. They aren't evidence that the curve has USL's shape.
2. Every route and runtime fit puts N* at 17–18. `heavy-run` caps `heavy.slice` at 1,792% CPU (17.9 CPUs), and P-48 already traced its fall at 28 to that quota. A fitted κ may be the quota, not coherency.
3. The fits underpredict width 1 and overpredict 32 from widths ≤ 16: the drop past 16 is sharper than the low-width curve implies, which is what a cliff (quota, SMT, cache) would look like.
4. Fresh `fused` varied 279–516 per second at width 16 between sessions (P-58, P-60). λ moves between sessions by more than 10%, and the bar compares a fit from old sessions against a new one.

## Workloads measured

Run from a detached checkout of PR #109's head (`16b7b9c`, P-60 code; it contains P-54 and P-58 unchanged) with this lane's `bench.mjs --repo=`, Node 26.13.0, `HEAVY_SLOTS=4 heavy-run`, closed loop, in flight equal to width:

- `route-default`: the P-60 route default, `check: 'fused'`, `checker: { reuse: { growthMb: 16 }, incremental: true }`; P-60's 20 scalar needs, 2,000 ms deadline, `max(400, 40 × width)` attempts.
- `route-fresh`: `fused` with fresh full checks (P-58's arm).
- `runtime`: P-54's `shared-reuse` runner, `BENIGN` spin 10, `max(1000, 200 × width)` attempts.

## Predictions (from `receipt/predictions.json`, committed with this file)

New widths are 4, 12, N* rounded, 20 and 24; none was measured before for these workloads.

| Workload | X(4) | X(12) | X(N*) | X(20) | X(24) |
|---|---|---|---|---|---|
| `route-default` | 326 | 631 | 671 (N = 18) | 668 | 649 |
| `route-fresh` | 178 | 375 | 404 (N = 18) | 402 | 389 |
| `runtime` | 9,661 | 18,050 | 18,906 (N = 17) | 18,719 | 18,079 |

My expectation, stated before measuring: bar 1 misses, most likely at width 4 (the width-1 underprediction carries to small widths) or on session-level λ drift. I'd give bar 1 about one chance in four of passing for all three workloads.

## Procedure

Two rounds, each round a full sweep per workload at widths 1, 4, 8, 12, N*, 16, 20, 24, 32 (the old widths are same-session anchors), workloads interleaved, round 2 after round 1. Each row is a fresh route or runner. Per row: accepted per second, CPU per accepted, CPU busy, `cpu.stat` delta of every cgroup up to the user slice (usage and throttling of `heavy.slice`, which other lanes share), and `perf stat -p <cohort>` user-mode counters: cycles, instructions, `ls_any_fills_from_sys.dram_io_all` (DRAM/MMIO fills), `ls_any_fills_from_sys.near_cache` (fills from the other CCX). `perf_event_paranoid` is 2: uncore L3 and memory-controller counters (system-wide) aren't readable, so memory bandwidth is estimated as DRAM fills × 64 B / wall for the cohort only.

Acceptance figure per width: the lower accepted per second of the two rounds. Rows with 1-minute load above 16 at either end are *loaded*, are rerun once when the load allows, and otherwise don't count.

## Bars

1. **Prediction accuracy.** |predicted − measured| / measured ≤ 10% at every new width (4, 12, N*, 20, 24) for every one of the three workloads, measured = acceptance figure. One miss anywhere misses the bar. Reported per workload.
2. **Width helper** (judged only if bar 1 passes; measured and reported as a diagnostic either way). `calibrateWidth` fits σ, κ from a short sweep (widths 1, 4, 8, 16, 24, 32 at a quarter of each row's attempts) and picks the integer width in 1–32 with the highest fitted throughput. Run at that width for two rounds: its acceptance figure must be ≥ the same session's width-16 acceptance figure and ≥ 95% of the best acceptance figure over all measured widths. Judged on `route-default` (the route as shipped).
3. **Calibration cost.** That calibration, wall time from process start of `calibrate` (candidate build included) to the chosen width, ≤ 60 s, on `route-default`.

## Decision rule

- Bars 1–3 all pass: `tools/width/usl.mjs` ships as the width helper and the recommendation is to replace hand-picked 16 with the calibrated width (it's opt-in code; nothing's default width changes in this PR, since the code default is 1 and 16 is the experiments' choice).
- Bar 1 misses: the USL fit isn't trusted to set width. `usl.mjs` moves into this experiment's directory as fitting code only, nothing is added under `tools/`, and width 16 stays the hand-picked figure unless the same-session sweep shows another width beating it by more than 10% in both rounds, which is reported as a measured finding, not a fit.

## Rivals and how they're discriminated

- **Quota cliff.** The 17.9-CPU `heavy.slice` quota, not coherency, sets N*. Evidence: `heavy.slice` throttling and busy CPUs per row near 17.9 at widths ≥ 16; and an affinity arm (below) whose CPU count is under the quota.
- **SMT regime.** Widths 17–32 run on SMT siblings, a different regime from 1–16. Evidence: residuals of a fit on widths ≤ 16 when extrapolated to 20, 24, 32 (a regime change shows as a systematic overprediction past 16, a USL curve doesn't), and the affinity arm.
- **Memory bandwidth / LLC cliff.** Evidence: IPC, DRAM fills per attempt and cross-CCX fills per attempt across widths: flat then stepping at a width is a cliff, a smooth rise is coherency-like. The 7950X has two CCDs of 8 cores with 32 MiB L3 each, so width > 8 also crosses CCDs.
- **Affinity arm (diagnostic, not acceptance).** `route-default` under `taskset -c 0-15` (one thread on each of the 16 physical cores; 16 CPUs, below the quota) at widths 4, 8, 12, 16, 20, 24, one round. If its throughput flattens at 16 without falling, the fall past 16 in the main sweep comes from SMT or the quota; if it falls like the main sweep, coherency (κ) is real.

## What a miss means

A bar 1 miss means a four-point USL fit from earlier sessions can't predict this machine's width curve to 10%; it doesn't mean the width curve is unknowable. Whether the miss is shape (systematic residuals past 16, or at small N) or level (λ drift between sessions) is reported separately: a shape-only check scales each fit to the same session's width-16 figure and recomputes the errors. That check is diagnostic and can't pass bar 1.

## Stop condition

Two rounds plus the affinity arm and the calibration runs, or 30 minutes of waiting for load ≤ 16 without an unloaded round, whichever comes first. Nothing is retuned after a miss.
