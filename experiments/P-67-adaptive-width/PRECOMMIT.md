# P-67 adaptive width: can EndoForge pick its own width, placement and split

Status: **Precommitted**, 2026-11-07. Code under test: `core/runtime/capacity/` (probe, plan, tuner, controller, CLI) and its consumers, `tools/tscheck/contained-route.mjs` (cohort set) and `IsolatePool`'s default size, in the commit that adds this file. Harness: [`bench.mjs`](bench.mjs).

## Question

P-63 found that width stops paying where the job runs out of CPU (`heavy.slice`'s 17.92-CPU quota), that each attempt costs more cycles as width grows (IPC 1.70 at width 1, 0.82 at 16), and that cross-CCX fills jump at width 8 on this two-CCD 7950X. It also found that a parametric (USL) fit does not predict untested widths. So instead of a model, the planner measures:

1. **Probe** (once per process): the allotment from the process's own cgroup chain (tightest `cpu.max`, `cpuset.cpus.effective`) and affinity (`Cpus_allowed_list`), falling back to `availableParallelism()`; L3 domains and SMT siblings from sysfs; memory headroom. Missing sysfs degrades to one domain and says so in `notes`.
2. **Plan**: when the allotment covers at least two CPUs per L3 domain and `taskset` exists, one cohort per L3 domain pinned to it; otherwise one cohort. Start width per cohort = min(its share, its physical cores); cap = min(its threads, ceil(1.25 × share)).
3. **Tuner** (in process, no disk writes): hill-climb on decided attempts per second over 1 s windows (first window after a change discarded). Grow only if throughput gains ≥ 3% and the marginal gain per added cell is ≥ 25% of the best per-cell rate seen, and CPU per attempt doesn't rise > 15% without a ≥ 6% gain. Shrink when the narrower width keeps ≥ 98% of the best rate. Halve the step to 1, then settle. Once settled, re-tune only after 5 consecutive windows more than 25% off the settled rate and at least 60 s after the last change.
4. **Cooperation**: each window reads the quota cgroup's `cpu.stat` and its siblings'; the share is max(quota − other jobs' CPU, quota / (1 + active peers)), and the tuner's bound follows it after 2 windows.

Explicit width still wins (`createContainedRoute({ width: 16 })` is the old single-runner path, unchanged).

## Arms

Route default as in P-63 (`check: 'fused'`, `checker: { reuse: { growthMb: 16 }, incremental: true }`, deadline 2,000 ms), P-60's 20 scalar needs cycled, closed loop with 48 concurrent submitters for every arm (more than any arm's width, so no arm is demand-limited and the planner can see a backlog), 120 s per arm after a warm-up pass, a fresh route per arm. Every run is under `HEAVY_SLOTS=4 heavy-run`, so the allotment is `heavy.slice`'s 17.92-CPU quota, shared with other lanes' heavy jobs.

| Arm | Shape |
|---|---|
| `1x16` | `createContainedRoute({ width: 16 })`: one cohort, width 16 (hand-picked baseline) |
| `2x8` | two unpinned cohorts of width 8 |
| `4x4` | four unpinned cohorts of width 4 |
| `4x4-pinned` | four cohorts of width 4, two per L3 domain, each pinned (`taskset`) to its domain |
| `2x8-pinned` | two cohorts of width 8, one per L3 domain, pinned (added: it's the planner's starting shape, so it tightens bar 1) |
| `planner` | `createContainedRoute()` with no width: the probe, plan and tuner as shipped |

Per arm: accepted per second, CPU ms per accepted (cohort processes from `/proc/<pid>/stat` plus the harness's own CPU), busy CPUs, `heavy.slice` CPUs and throttled ms, user-mode `perf stat -p <all cohort pids>`: cycles, instructions (IPC), `ls_any_fills_from_sys.near_cache` (cross-CCX fills) and `ls_any_fills_from_sys.dram_io_all` per attempt, the width the planner holds each second, and its tuner log.

**Verdicts**: after each arm's timed run, the same route checks a fixed verdict set: the 20 needs, each with a type-error mutant and a wrong-expectation mutant, plus one runaway loop (61 candidates). Verdict = status, reason, output digest, tests passed.

**Portability**: the bench runs again under `taskset -c 0-3` (4 CPUs, one domain), `taskset -c 0-7` (8 CPUs, one domain) and unrestricted. Each sweeps fixed single-cohort widths for 30 s each (4 CPUs: 2, 3, 4, 5, 6, 8; 8 CPUs: 4, 6, 8, 10, 12, 16; unrestricted: 12, 16, 20, 24), then the planner for 120 s. `heavy.slice` does not delegate the cpu controller to its job scopes, so a nested `cpu.max` isn't available; the restrictions are affinity. The "32-CPU" allotment can't be had inside `heavy.slice`: unrestricted, the quota (17.92) still binds, so that case tests that the planner reads the quota, not 32 CPUs. A true 32-CPU allotment would need running outside `heavy.slice`, which the lane rules forbid; it stays unmeasured.

## Bars (tighten, never loosen)

1. Planner accepted/s ≥ best fixed arm − 5%, and ≥ `1x16` + 10%.
2. Planner CPU ms per accepted ≤ `1x16`'s.
3. Planner settles within 30 s of its timed start and, once settled, changes width at most once per minute.
4. Portability: at 4, 8 and the unrestricted (quota-bound) allotment, the planner's accepted/s is within 10% of the best fixed width in that sweep.
5. Zero verdict differences between `1x16` and every other arm, including the planner.

Acceptance figures: two rounds, each row's worse round. Rows with 1-minute load above 16 at either end are *loaded*, are rerun once when the load allows (the harness waits up to 30 min per row for load ≤ 16), and otherwise don't count. If load stays above 16, that is recorded and no loaded figure is used for a bar.

## Prediction

`4x4-pinned` over `1x16`: **+15%** accepted/s (I'd put it in 1.05–1.35×), lower than the 1.3–1.8× inference. Pinning should cut cross-CCX fills per attempt from P-63's ~14,600 at width 16 to near the width-4 level (≤ 1,000), and lift IPC from 0.82 toward 1.0. But each domain still runs 8 busy threads over 8 cores sharing one 32 MiB L3, and the quota still caps total CPU near 17.9, so per-attempt cycles won't fall back to width 4's. `2x8-pinned` should land near `4x4-pinned` (±5%). Unpinned `2x8` and `4x4` should be within ±5% of `1x16`, since the scheduler spreads them over both CCDs anyway. The planner should land on `2x8-pinned`'s shape with per-cohort width 8–10, so I expect bar 1's first half met and the +10% half met only if the pinning gain is ≥ 10%. I give bar 1 about even odds.

**Rival**: shared LLC capacity, memory bandwidth and the cross-CCD link erase the gain. Discrimination: if pinned arms cut cross-CCX fills by ≥ 10× but IPC and CPU per accepted don't improve (≤ 5%), locality isn't the cost and the rival (L3 capacity or SMT contention within the domain) holds. If fills drop and IPC rises with throughput, locality was the cost.

## Decision rule (amended by Craig's instruction before any measurement; see the amendment below)

The code lands in main whatever the bars say. What it defaults to:

- If the planner matches or beats `1x16` (planner accepted/s ≥ `1x16`'s, worse rounds, and bar 2 met), `POLICY.mode` stays `'tuned'`.
- Otherwise `POLICY` becomes the best fixed arm, expressed portably (cohorts per L3 domain and cohort width relative to that domain's cores), and the tuner stays available behind `policy: { mode: 'tuned' }`. The miss is reported.

`IsolatePool`'s default size becomes the plan's starting width (16 here, against 32 from `availableParallelism()`). That part is wired but not measured here; its jobs are heterogeneous and it has no online tuner.

## What a miss means

Bar 1 or 2 missed: the online tuner costs more than it finds, or the fixed best shape is better; fall back as above. Bar 3 missed: the tuner's windows are too noisy on a shared slice; its thresholds need longer windows. Bar 4 missed at one allotment: the probe or plan's starting guess is wrong for that shape. Bar 5 missed: a defect; the planner may not be default until fixed.

## Stop condition

Load above 16 for more than 30 minutes per row in both attempts: record it and stop measuring that row. A verdict difference: stop and fix before any further rounds.

## Amendment 1 (before any measurement)

Craig, relayed by the coordinator: the planner lands as production code in main regardless of the bars, under `core/runtime/capacity/` as a standalone, dependency-free module of the Cstack family (code name Mjölnir) with a CLI and an ICD (`docs/interfaces/capacity-icd.md`). The bars gate only the default, as in the decision rule above.
