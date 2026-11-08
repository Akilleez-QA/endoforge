# P-67 adaptive width: result

Status: **Recorded, loaded**, 2026-11-07, Node 26.13.0, `HEAVY_SLOTS=4 heavy-run`, on a shared desktop with other lanes' heavy jobs in `heavy.slice`. Precommit: [PRECOMMIT.md](PRECOMMIT.md), committed and pushed at 21:35:17 EST (6221356), with amendment 1 included, before any measurement. Measurements ran 21:42–23:22 EST. Raw rows: `receipt/measured/`; everything below: `receipt/analysis.json` (from `analyze.mjs`).

**The tuned planner missed bars 1–4 and met bar 5. Under the amended decision rule the capacity planner lands as production code with its best fixed policy as the default: one cohort per L3 domain, pinned, each as wide as its domain's cores (`2x8-pinned` on this 7950X). That arm was the best fixed arm in both rounds: 507 accepted/s in its worse round against 422 for `1x16` (+20%), at 32.3 against 32.6 ms CPU per accepted. The online tuner ships behind `TUNED_POLICY` and is not the default.**

Every arm row was *loaded*. Load was under 16 at the start of every row, but it ended at 21.7–36.1, and the harness's own job adds up to about 17 to the load average. The precommit says loaded rows don't count toward a bar. So, strictly, bars 1 and 2 have no unloaded figure, and the numbers below are loaded figures, reported as such. Neither the default nor the verdict on the tuner rests on one row: `2x8-pinned` led every fixed arm in both rounds, and the tuner's round-1 failure has a mechanism in its own log (below).

## Not shown or unverified

- No arm row was unloaded. The other lanes' heavy jobs also shared the 17.92-CPU quota, which throttled `heavy.slice` for 3.8–466 s per 120 s row. The rows aren't steady-state measurements of one job alone.
- `taskset -c 0-3` shares its CPUs with the rest of the desktop, and the 4-CPU sweep swung by up to 1.7× between rounds at the same width (width 4: 209 then 130 per second). Bar 4 at 4 CPUs is noise-dominated.
- A true 32-CPU allotment wasn't measured. Inside `heavy.slice` the quota binds at 17.92, and `heavy.slice` doesn't delegate the cpu controller to job scopes, so the restricted allotments are affinity, not `cpu.max`.
- `IsolatePool`'s new default size (the plan's width: 16 here, against 32 from `availableParallelism()`) wasn't measured.
- `perf` counted the cohort processes only, in user mode. L3 occupancy and memory-controller counters need `perf_event_paranoid` ≤ 0, which wasn't changed.
- The defect fixes made after the measurements (the bound hysteresis and the hold on a rising bound, below) weren't measured. They don't change the default.
- Node 22 ran the unit and integration tests, not the measurements.

## Arms (120 s each, 48 submitters, route default)

| Arm | Accepted/s r1 / r2 (worse) | CPU ms per accepted (worse) | IPC r1 / r2 | Cross-CCX fills per attempt r1 / r2 | DRAM fills per attempt r1 / r2 | Busy CPUs r1 / r2 | Width held |
|---|---|---|---|---|---|---|---|
| `1x16` | 421.6 / 450.7 (**421.6**) | 32.6 | 0.61 / 0.52 | 10,625 / 11,216 | 208,519 / 218,199 | 12.0 / 14.7 | 16 |
| `2x8` | 510.4 / 313.3 (**313.3**) | 42.3 | 0.61 / 0.40 | 10,454 / 9,584 | 202,911 / 243,448 | 14.6 / 13.3 | 16 |
| `4x4` | 360.3 / 451.2 (**360.3**) | 42.0 | 0.42 / 0.47 | 8,784 / 9,992 | 242,434 / 231,485 | 15.1 / 16.5 | 16 |
| `4x4-pinned` | 498.2 / 466.2 (**466.2**) | 35.8 | 0.58 / 0.48 | 345 / 331 | 214,355 / 232,710 | 14.5 / 16.7 | 16 |
| `2x8-pinned` | 516.6 / 507.3 (**507.3**) | 32.3 | 0.66 / 0.53 | 314 / 313 | 200,132 / 221,346 | 13.1 / 16.4 | 16 |
| `planner` (tuned) | 199.4 / 573.7 (**199.4**) | 40.0 | 0.43 / 0.63 | 492 / 272 | 248,253 / 200,262 | 8.0 / 15.6 | 2 × 5–6 / 2 × 7 |

Load at the start and end of each row: `receipt/analysis.json` (`loads`).

## Bars

1. **Missed.** Planner 199.4 (worse round) against a requirement of max(0.95 × 507.3, 1.1 × 421.6) = 481.9. Its other round, 573.7, was the best row of the run.
2. **Missed.** 40.0 against `1x16`'s 32.6 ms per accepted (worse rounds).
3. **Missed.** It settled within 30 s in both rounds (13.1 s and 9.0 s). Round 2 then held width 7 per cohort with no change for 111 s. Round 1 made 19 changes after settling, 10.7 a minute.
4. **Missed at 4 CPUs.** Planner as a fraction of the best fixed width in the sweep: 4 CPUs 0.88 (175 against 199 for width 8); 8 CPUs 0.98 (361 against 370 for width 16); unrestricted, quota-bound, 0.90 (478 against 530 for width 16). The last two met the 10% bar.
5. **Met.** All 61-candidate verdict sets, in every arm, every sweep row and both rounds, have the same digest (`e75311bf…`): no verdict changed.

## What the planner chose

- **Shipped default (fixed)** on this machine: two cohorts pinned to the two L3 domains, 8 + 8. Under `taskset -c 0-3`: one cohort of 4. Under `taskset -c 0-7`: one cohort of 8 (one domain, so no pinning).
- **Tuned (opt-in)**, as measured: unrestricted, 2 × 5–6 with three peers in the slice (round 1) and 2 × 7 with one peer (round 2). In the unrestricted sweep it ended at a total of 20, then 12. At 4 CPUs: 4. At 8 CPUs: 7.

## Why the tuner lost in round 1

Its log shows two mechanisms:

1. **Cooperation by design.** Three other heavy jobs were active in `heavy.slice`. The share meter computed max(quota − others, quota / 4) ≈ 6–10 CPUs and bounded each cohort near 5. The fixed arms take what CFS gives a wider job, about 14 CPUs; the planner held 8. The precommitted bars score one job's total throughput in a shared slice, so a planner that yields to peers loses on them by construction. That's a real conflict between bar 1 and the cooperation requirement, not noise. It also limits the share signal: once the quota is saturated, other jobs' usage grows into whatever this job leaves, so "quota − others" tracks this job's own current use.
2. **A defect.** A rising bound restarted exploration while the tuner was settled, without the 60 s hold, and the share moved by ±1–2 CPUs every window. Each restart counts as changes, hence 10.7 a minute. Fixed after the measurements: a bound changes only by at least max(2, 20%) persisting for 2 windows, and a rise re-tunes a settled width only after the hold. Unit tests cover both. The fix wasn't measured.

The sweeps also show that the best width can exceed the CPUs: width 6–8 at 4 CPUs and 16 at 8 CPUs, because cells spend part of each attempt waiting. The tuned cap of min(threads, 1.25 × share) can't reach those widths. Widening it would be retuning after the fact, so it isn't done here; it's a follow-up with its own precommit.

## Prediction and rival

Predicted `4x4-pinned` over `1x16`: +15% (range 1.05–1.35×). Measured: **+10.6%** on worse rounds (466.2 / 421.6), inside the range and below the point estimate. Same-round ratios were +18% (round 1) and +3% (round 2). The 1.3–1.8× inference wasn't borne out.

Rival (shared LLC, memory bandwidth and the cross-CCD link erase the gain): **supported as the reason pinning doesn't improve per-attempt cost.** Pinning cut cross-CCX fills per attempt by 31–34× (10,625 → 345 in round 1; 11,216 → 331 in round 2). IPC didn't rise (0.61 → 0.58; 0.52 → 0.48), and neither DRAM fills per attempt (+3%, +7%) nor CPU per accepted (+2%, +10%) improved. That meets the precommitted discrimination test: fills down ≥ 10× with no IPC gain means locality isn't the cost. Most of the throughput gain of the multi-cohort and pinned arms comes with more busy CPUs (12.0 → 13.1–14.6 in round 1), consistent with several cohort processes keeping more cells fed within the same quota. The supervisor and cohort messaging weren't profiled, so that last part is an inference.

## Decision

Under the amended rule the planner didn't match `1x16` (199.4 < 421.6 and 40.0 > 32.6 ms), so `POLICY` becomes the best fixed arm, expressed portably: `{ mode: 'fixed', width: 'cores', perDomain: 1 }`. That's one cohort per L3 domain, pinned when there are at least two allotted CPUs per domain and `taskset` exists, each as wide as its domain's physical cores within its share of the allotment. The contained route and `IsolatePool` use it whenever no width is given; explicit width still wins. The tuner, share meter and controller stay in `core/runtime/capacity/` behind `TUNED_POLICY`.
