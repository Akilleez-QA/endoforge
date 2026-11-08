# P-68 tuner occupancy: result

Status: **Recorded**, 2026-11-08, Node 26.13.0 (main-rig, ds9) and 22.23.3 (MacBook Air). Precommit: [PRECOMMIT.md](PRECOMMIT.md), committed and pushed at 01:38:39 EST (9458d5a) before any measurement. Six amendments followed, each committed and pushed before the rows it affects (times EST): 1beb54a 01:39:30 (record start times), 37fe873 02:05:51 (amendment 1), 1e9f3a2 02:09:50 (amendment 2, ds9 and MacBook Air), 69969c6 02:28:51 (amendment 3, condition change), 180a7c8 02:33:56 (amendment 4, boundary 02:26:49), 01066a1 03:34:32 (amendment 5, method B), 46c6f82 04:34:50 (amendment 6, defect fix). Measurements ran 01:39–06:09 on main-rig, 02:10–02:33 on ds9 and 02:12–03:50 on the Air. Raw rows: `receipt/measured/` (condition A), `receipt/measured-B/` (condition B), `receipt/machines/`; summaries: `receipt/analysis-measured.json` and `receipt/analysis-measured-B.json` (from `analyze.mjs`). Set-aside rows are in `receipt/invalid/`.

**Decision: the default stays fixed** (`{ mode: 'fixed', width: 'cores', perDomain: 1 }`, 2 × 8 pinned on main-rig). Under condition B, which decides, the tuned planner met bars 1 and 4 and missed bars 2, 3 and 5. P-68's code lands: `TUNED_POLICY` is now the occupancy-capped tuner with the new share rule, and `P67_TUNED_POLICY` keeps the old one. The precommitted `IsolatePool` rule fired: its default size returns to `availableParallelism()`.

## What changed during the run

1. **`heavy-run` resized `heavy.slice` (amendments 1 and 2).** `heavy-run` sizes the slice from `nproc`, which follows affinity and, in coreutils 9.12, the caller's `cpu.max`. My `taskset`- and `CPUQuota`-wrapped calls rewrote the slice to 224% for every lane's jobs, 02:00–02:04 and 02:06–02:08 EST, restored each time with an unrestricted `heavy-run --write-slice`. The precommit's "0.56 × k CPUs per allowed CPU" kernel claim was this artifact, and P-67's restricted allotments were probably affected the same way. Four affected rows are set aside. Restricted runs now pass `OMP_NUM_THREADS=$(nproc --all)` to `heavy-run` and drop it for the job. `heavy-run` itself still has the defect for any caller under affinity or a quota.
2. **Condition change (amendments 3 and 4).** At 02:26:49 `heavy.slice` went from a 17.92-CPU `cpu.max` to `cpu.weight 40` with no cap (Craig's instruction). Condition A is round 1 before it (one round, reported, decides nothing). Condition B is two new rounds after it, and decides. Round 1's 16-CPU `w32` straddled the boundary and is excluded; its `w48` and `tuned` ran under B and aren't used.
3. **Method B for condition B (amendment 5).** Other lanes' `heavy-run` jobs (`make test`, `ci/run-local.sh`, 0.7–7 CPUs) occupied the slice almost continuously from 02:36, so method A's quiet slice couldn't be had. Condition B ran under method B: every row with the same synthetic peer (12 busy loops in their own `heavy.slice` scope), no gate, arms interleaved. Other lanes' jobs still ran alongside, so peer pressure was the synthetic peer plus a varying background. Condition B's figures are noisy: the same fixed arm moved up to 1.9× between rounds.
4. **Two defects found and fixed mid-run.** The share rule only read cgroups with a finite `cpu.max`, so in the uncapped slice it would never see a peer. The enclosing slice is now a weighted level (amendment 3). That level first used the job's own allowed CPUs as its capacity, which made a restricted job yield below its own quota. It now spans the slice's CPUs (amendment 6). The three condition-B round-1 restricted `tuned` rows were rerun after the fix.

## Arms (full allotment, 120 s, 64 submitters)

Condition B (32 CPUs weighted, method B with a 12-loop peer and other lanes active), the deciding condition:

| Arm | Accepted/s r1 / r2 (worse) | CPU ms per accepted (worse) | Width held r1 / r2 | Load start/stop/end r1; r2 | PSI start/stop/end r1; r2 |
|---|---|---|---|---|---|
| `2x8-pinned` | 329.8 / 623.9 (**329.8**) | 28.4 | 16 / 16 | 17.2/41.4/15.8; 15.1/33.6/15.9 | 16.2/18.4/0.2; 0.0/11.5/0.0 |
| `1x16` | 452.0 / 500.2 (**452.0**) | 23.3 | 16 / 16 | 15.8/44.5/16.0; 15.8/31.9/15.1 | 0.2/18.8/0.6; 0.1/5.9/0.0 |
| `tuned` | 497.7 / 676.4 (**497.7**) | 21.9 | 14 / 20 | 16.0/37.9/14.9; 15.1/34.6/15.8 | 0.6/12.3/0.1; 0.0/12.4/0.1 |
| `tuned-p67` | 363.5 / 638.4 (**363.5**) | 24.3 | 14 / 18 | 14.9/44.4/15.1; 17.0/36.3/15.1 | 0.1/18.0/0.2; 5.3/11.9/0.0 |

Condition A (17.92-CPU cap, method A, quiet, one round):

| Arm | Accepted/s | CPU ms per accepted | Width held | Load start/stop/end | PSI start/stop/end |
|---|---|---|---|---|---|
| `2x8-pinned` | 646.6 | 26.7 | 16 | 4.7/19.6/14.8 | 4.1/1.0/0.1 |
| `1x16` | 614.7 | 24.2 | 16 | 14.8/18.7/15.9 | 0.1/2.0/0.6 |
| `tuned` | 565.6 | 16.7 | 2 × 4 | 15.9/11.4/11.4 | 0.6/0.0/0.0 |
| `tuned-p67` | 629.4 | 28.5 | 18 | 11.4/23.7/15.6 | 0.0/4.5/0.3 |

## Bars (condition B decides)

1. **Met.** `tuned` 497.7 against ≥ 313.3 (0.95 × 329.8), and 21.9 against ≤ 29.8 ms CPU per accepted (1.05 × 28.4). The base's worse round (329.8) is half its other round (623.9), so this rests on a noisy row. Condition A, one quiet round, went the other way: 565.6 against 614.3 needed, because the tuner settled at 2 × 4 and kept ≥ 98% of a noisy best. It did so at 38% less CPU per accepted (16.7 against 26.7).
2. **Missed.** Settled in 14.4 s and 11.3 s (both ≤ 30 s), but changed width 1.66 times a minute after settling in round 1 (0.54 in round 2). Condition A: settled in 13.1 s at 0.55 a minute.
3. **Missed.** `tuned` against the best fixed width of each sweep (worse rounds): 4 CPUs 0.961 (216.2 against `w6` 225.0, met); 8 CPUs 0.760 (194.3 against `w24` 255.7); 16 CPUs 0.870 (553.2 against `w24` 635.8); full (32) 0.758 (453.2 against `w16` 597.5). The two rounds of the same fixed width differ by up to 1.6× under method B (full `w48`: 419.3 then 679.1), so most of these ratios compare noise. Condition A (quiet, one round): 4 CPUs 0.997, 8 CPUs 0.931, full 1.029, all met; 16 CPUs has no condition-A `tuned` row. Extended (amendment 2): ds9 **met** (0.929), MacBook Air **missed** (0.726).
4. **Met.** One 61-candidate verdict digest (`e75311bf…`) across every row of both conditions, ds9 and the MacBook Air.
5. **Missed.** Alone: round 1 had no window free of other lanes' peers (unmeasured); round 2 had 43 such windows, all `lone` with the whole 32, and the cap (16) above the 13 needed (met). With the 24-loop peer: the share decision was in the precommitted band (0.9–1.1 × 32 ÷ (1 + active peers)) in 51% and 16% of windows, against 80% needed. The median decisions were 7.25 and 15.5, and the job's CPU stayed within 1.15 × its decision (4.98 and 7.86 CPUs). Round 2's median is close to an even split of 32 with the synthetic peer. The band is low because it treats every other lane's small job as greedy. Condition A (quiet, 17.92 cap, one round) met both halves: alone, `lone` with 17.92 in 100% of windows; with the 12-loop peer, 8.96 (the even split) in 100% of windows, using 9.01 CPUs.

## Occupancy `u`, the cap and the rival

- **Main-rig quiet (condition A):** `u` = 1.14 (sd 0.035, CV 0.03) in the arms row and 1.06–1.07 in the sweeps. Cells are CPU-bound; helper threads and the supervisor add about 10%. Implied cap per cohort at full allotment: ceil(1.25 × 8.96 ÷ 1.14) = 10 (logged 10–11), close to P-67's 12. At 4 and 8 CPUs: 5 and 10.
- **Main-rig with a peer (condition B):** the logged estimate fell to 0.43–0.87 and the cap rose to 9–28. The 0.5%-a-window decay lets the estimate follow a lasting contended ratio, so under sustained contention `u` measures contention as well as occupancy. That's a known weakness of this estimator.
- **ds9 (quiet by PSI):** `u` = 0.90–0.95 (CV 0.03); cap 32–34 against 22 cores.
- **MacBook Air:** `u` = 0.77–1.32 (CV 0.15–0.23), from `ps`, which has coarse time resolution.

Rival ("occupancy is too unstable per attempt to set width; the cap jitters"): **rejected on the quiet rows it was precommitted on** (condition A: CV ≤ 0.039, bound changes after settling 0 a minute). Under method B, though, the bound changed 1.1 times a minute after settling (CV ≤ 0.12), and on the Air the CV reached 0.23 with 2–3 width changes a minute. Occupancy is stable enough on a quiet machine and not under shifting contention or coarse CPU clocks.

## What the planner chose

| Allotment | Fixed default (`POLICY`) | Tuned plan start / max per cohort | Tuned held (A; B r1, r2) |
|---|---|---|---|
| 4 (CPUs 8–15, 400%) | 1 × 4 | 4 / 12 | 4; 5, 5 |
| 8 (8–15, 24–31, 800%) | 1 × 8 | 8 / 24 | 7; 10, 6 |
| 16 (4–31, 1600%) | 2 × 8 pinned (two L3 domains, 8 + 16 CPUs) | 8 / 24 | –; 20, 14 total |
| main-rig full | 2 × 8 pinned | A: 8 / 27; B: 8 / 48 | A: 2 × 4 (arms), 16 (sweep); B: 14, 20 (arms), 22, 12 (sweep) |
| ds9 (`heavy.slice` 24.64) | 1 × 22 (one L3 domain) | 22 / 74 | 27, 23 (arms); 22, 24 (sweep) |
| MacBook Air (8, no cgroup) | 1 × 8, unpinned | 8 / 24 | 6, 5 (arms); 6, 6 (sweep) |

Calibration (spinners, the job's own `cpu.stat`): 4.01, 8.02–8.04 and 16.02–16.05 CPUs for the restricted allotments; 17.97 under condition A's cap; 26.9 and 23.9 of 32 under condition B (weight 40, with the desktop and other lanes).

## Other machines

**ds9** (Xeon E5-2699 v4, 22 cores / 44 threads, one 55 MiB L3, 188 GB; Node 26.13.0; `HEAVY_SLOTS=4 heavy-run`, `heavy.slice` 24.64 CPUs; gated on PSI ≤ 5, every row quiet by PSI; its containers kept load at 9–50, recorded per row):

- **Probe:** allotment 24.64, one domain of 44 CPUs and 22 cores, SMT, ~66 GB available; correct, with no notes.
- **Plan:** one cohort, fixed 22.
- **Arms:** fixed 697.1 / 687.1 (worse 687.1) at 31.3 ms CPU per accepted; `tuned` 698.8 / 653.6 (worse 653.6) at 34.5.
- **Sweep, worse rounds:** w8 392.6, w16 627.5, w22 681.4, w32 638.3, w48 585.3, w74 513.0; `tuned` 633.1 (ratio 0.929, met).
- **Tuner:** settled in 13–17 s, at most 0.58 changes a minute afterwards.
- **Cleanup:** the clone `~/endoforge-p68` was removed; no container or service was touched.

**MacBook Air** (Apple M2, 4 performance + 4 efficiency cores, 16 GB, macOS; Node 22.23.3 since 26 isn't installed; whole machine; gated on load ≤ 4):

- **Probe after the fix:** allotment 8 from `availableParallelism()`, one domain, `perfLevels` 4 + 4, headroom 4.8 GB from `vm_stat`, no taskset.
- **What it got wrong before amendment 2:** headroom from `os.freemem()` read 388 MB with about 5.2 GB reclaimable, which would have held the memory cap near 12. The cohort set's CPU reader returned null without `/proc`, so the tuner had no CPU guard and never measured `u`. Both are fixed and tested (`vm_stat` and `sysctl` in the probe, `ps` in the cohort set).
- **Placement:** pinning isn't available on macOS, so the plan is one unpinned cohort.
- **Arms:** fixed 87.1 / 44.3 (worse 44.3) at 98.4 ms CPU per accepted; `tuned` 85.0 / 52.5 (worse 52.5) at 98.4.
- **Sweep, worse rounds:** w2 43.3, w4 43.7, w6 52.4, w8 57.9, w12 40.2, w16 55.9, w24 75.6; `tuned` 54.9 (ratio 0.726, missed).
- **Battery and thermal:** the battery went from 85% to 52% in round 1 and from 52% to 27% in round 2, and round 2 ran at about half round 1's rate. `pmset -g therm` recorded no thermal or performance warning. Five of 18 rows weren't quiet (load ≤ 4 at the end). These figures are battery-affected and noisy; same-width rounds differ by up to 2.4×.
- **Cleanup:** the clone was deleted and nothing of P-68 is left running.

## `IsolatePool` default size

Ledger-fixture jobs, 64 submitters, 60 s, condition B, gated on load and PSI (quiet):

| Size | Jobs/s r1 / r2 (worse) | CPU ms per job (worse) | Peak cgroup MB |
|---|---|---|---|
| plan (16) | 7.6 / 2.3 (**2.3**) | 3,803 | 625 / 875 |
| old (32) | 4.7 / 9.5 (**4.7**) | 2,639 | 1,414 / 1,205 |

The rounds contradict each other. Under the precommitted rule, which uses worse rounds, 32 beats 16 by more than 5% without more than 5% higher CPU per job, so `IsolatePool`'s default reverts to `availableParallelism()`. The plan's width still sets the contained route's default.

## Not shown or unverified

- No condition-B row is quiet. All of condition B ran beside the synthetic peer and other lanes' changing jobs. Condition A is quiet but has one round.
- Condition B round 1's restricted `tuned` rows are reruns after the fixed-width rows (amendment 6), not interleaved with them.
- The 16-CPU allotment spans two unbalanced L3 domains (8 + 16 CPUs); its pinned cohorts get equal shares.
- `u` under contention isn't inherent occupancy (above). The memory cap never bound: RSS per cell was 45–110 MB against tens of GB of headroom.
- `heavy-run`'s resize-under-affinity defect is reported here, not fixed (it lives in the throttle tool, outside this repository).

## Decision

Bars 1–4 didn't all pass under condition B, so `POLICY` stays `{ mode: 'fixed', width: 'cores', perDomain: 1 }`. The occupancy-capped tuner (`TUNED_POLICY`) ships as opt-in with the max-min share rule and the macOS probe paths. `IsolatePool` defaults to `availableParallelism()` again. Next work for the tuner: an occupancy estimate that discounts measured run-queue and throttle time instead of decaying toward the contended ratio, and longer windows on shared slices.
