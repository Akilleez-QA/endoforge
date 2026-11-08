# P-68 tuner occupancy: can a measured occupancy cap and a fair share rule make the tuned planner the default

Status: **Precommitted**, 2026-11-08. Code under test: `core/runtime/capacity/` (occupancy cap, share rule, memory meter) and `core/runtime/contained/cohort-set.mjs` (dispatch hook and RSS reader), in the commit that adds this file. Harnesses: [`bench.mjs`](bench.mjs) (contained route) and [`pool.mjs`](pool.mjs) (`IsolatePool`).

## Question

P-67 shipped a fixed default (2 × 8 pinned on this 7950X) because its tuner lost: it yielded its share to other jobs while fixed arms didn't, a rising share restarted exploration without the hold (fixed afterwards, never measured), and its cap of min(threads, 1.25 × share) can't reach widths above the CPU count. P-68 changes three things and measures them on a fair footing:

1. **Occupancy cap.** `u` = CPU time per in-flight cell second: per 1 s window, the cohorts' and supervisor's CPU (`/proc/<pid>/stat`) over the integral of in-flight attempts (the cohort set calls `started()` on dispatch and `completed()` on finish). No disk writes. Contention only lowers the raw ratio, so the estimate is the running maximum of a 3-window median, decaying 0.5% a window. Cap per cohort = min(ceil(3 × share), ceil(1.25 × share per cohort ÷ u), memory cells), where memory cells = (width + 0.75 × memory headroom ÷ RSS per cell) ÷ cohorts. The hill-climb (accepted/s, with the CPU-per-attempt guard) runs inside it.
2. **Share rule.** Every quota level on the job's cgroup chain is read. No peer above 0.5 CPU anywhere: `lone`, share = the whole allotment. Otherwise `shared`: share = the max-min fair claim at the tightest level, where a peer whose `cpu.pressure` shows it stalled for CPU more than 10% of the window counts as wanting an equal split and any other peer as wanting only what it used. The decision is logged each window (`share`, `mode`, `peers`, `legacyShare`).
3. **`setBound` fix** from P-67 (bound hysteresis, hold on a rising bound), now measured.

Exploratory runs before this file (not acceptance figures): `u` on this route was 1.11 ± 0.05 at full allotment, quiet (cells are CPU-bound; helper threads and the supervisor add ~10%). This kernel has an unexpected property: a job in `heavy.slice` restricted by affinity to k of 32 CPUs got 0.56 × k CPUs when alone (4 spinners on 4 idle CPUs: 2.24 CPUs, the slice throttled every period), while the same spinners in a scope outside the slice got 4. So P-67's "4 CPU" and "8 CPU" allotments were effectively 2.24 and 4.48 CPUs.

## Fairness method (the main fix)

**Method A, quiet slice**, for every row: before a row the harness waits up to 20 minutes until no other job scope exists in `heavy.slice` (other than the harness's own synthetic peer), PSI `cpu some avg10` ≤ 5 and 1-minute load ≤ 16. During the row it lists `heavy.slice`'s scopes every second. After the row's own work stops it waits up to 3 minutes for load ≤ 16 and PSI ≤ 5 again (the end check: the row's own ~16 runnable threads dominate the load average at the instant it stops, so the end check measures what remains when this job is gone; the load and PSI at the instant of stopping are recorded too). A row is *quiet* when the start check passed, no other job appeared during it, and the end check passed. Load and PSI at start, stop and end are recorded per row.

A row that isn't quiet is rerun once (the harness reruns non-quiet rows). If a block (one round of arms, one sweep, one fairness pair) still has a non-quiet row, that block is run again with **method B**: all its arms back-to-back in the same order, each with the same synthetic peer started by the harness (12 busy-loop processes in their own scope in `heavy.slice`), and judged against that peer. The result states which method each block used.

Arms are interleaved: round 1 in forward order, round 2 in reverse.

## Allotments

Restricted allotments use `cpu.max` in a scope plus affinity on CPUs outside the desktop's 0–3: `systemd-run --user --scope -p CPUQuota=Q -- taskset -c CPUS env HEAVY_SLOTS=4 heavy-run -- node bench.mjs …`; `heavy-run` copies the caller's quota onto the job's scope inside `heavy.slice`. Because of the slice's per-CPU behaviour above, each allotment gets enough CPUs that the quota binds:

| Allotment | `CPUQuota` | CPUs |
|---|---|---|
| 4 | 400% | 8–15 (one CCD, 8 cores, no SMT siblings) |
| 8 | 800% | 8–15, 24–31 (one CCD with SMT) |
| 16 | 1600% | 4–31 (both CCDs, unbalanced: 8 + 16 CPUs) |
| full | none (`heavy.slice` 17.92) | 0–31 |

Each run's header records a calibration (one spinner per allowed CPU for 4 s, CPU used from the job's own `cpu.stat`). The "16" allotment may calibrate below 16 (28 CPUs × 0.56 = 15.7); whatever it calibrates is reported. 0–3 can't be avoided at full allotment; that's the whole machine.

## Arms (full allotment, 120 s, 64 submitters, route default as P-67)

| Arm | Shape |
|---|---|
| `2x8-pinned` | `plan()` with the shipped `POLICY` (current default) |
| `1x16` | `createContainedRoute({ width: 16 })` |
| `tuned` | `plan({ policy: TUNED_POLICY })`: occupancy cap and the new share rule |
| `tuned-p67` | `plan({ policy: P67_TUNED_POLICY })`: the tuner as P-67 shipped it (share cap, P-67 share rule, with the `setBound` fix that's on main) |

Per row: accepted/s, CPU ms per accepted (cohort processes plus harness, as P-67) and the job cgroup's CPU, busy CPUs, `heavy.slice` CPUs and throttled ms, widths each second, the tuner log (rate, CPU per attempt, raw and estimated `u`, cap, RSS per cell, share decision, bound, phase), occupancy stats, and a 61-candidate verdict set after the timed run (P-67's).

**Portability sweeps** at 4, 8, 16 and full: fixed total widths with the default placement (one cohort per allotted L3 domain, pinned when there are two), 30 s each, then `tuned` for 120 s. Widths reach 3× the allotment: 4: 2, 4, 6, 8, 12; 8: 4, 8, 12, 16, 24; 16: 8, 16, 24, 32, 48; full: 12, 16, 24, 36, 54.

**Fairness pairs** at full allotment, 90 s each: `tuned` alone and `tuned` with the synthetic peer (12 busy loops in their own `heavy.slice` scope, started 3 s before the timed run). Round 1 alone first, round 2 peer first.

**`IsolatePool` default size**: `pool.mjs` runs the ledger fixture (`['pass', 'effects']` per job, 64 submitters, 60 s) at the plan's width (`defaultWidth()`, 16 here) and the old default (`availableParallelism()`, 32), two rounds, ABBA.

## Bars (tighten, never loosen; two rounds; worse round counts)

1. `tuned` accepted/s ≥ 0.95 × `2x8-pinned`'s, and `tuned` CPU ms per accepted (worse round) ≤ 1.05 × `2x8-pinned`'s (worse round).
2. `tuned` settles (first `settled` window) within 30 s of its first controller window and changes width at most once a minute after that, in both arms rounds.
3. Portability: at 4, 8, 16 and full, `tuned` accepted/s (worse round) ≥ 0.90 × the best fixed width in that sweep (each width's worse round).
4. Zero verdict changes: every row in every block has the same 61-candidate verdict digest.
5. Fair share. Alone: `mode` is `lone` and the share decision equals the allotment in ≥ 90% of controller windows, and the final cap per cohort ≥ ceil(share per cohort ÷ u) (the cap lets it use the whole allotment). With the peer: `mode` is `shared` and the share decision is within 0.9–1.1 × 8.96 (half of 17.92) in ≥ 80% of windows that start 10 s or more after the peer started, and the job cgroup's CPU over the row ≤ 1.15 × the median share decision. Both rounds.

Rows that aren't quiet (method A) don't count toward a bar unless their block was rerun under method B; then the method-B figures count.

## Predictions

- `u` ≈ 1.1 at full allotment, so the occupancy cap is about ceil(1.25 × 8.96 ÷ 1.1) = 11 per cohort, close to P-67's 12: on this CPU-bound route the cap matters little at full allotment. I expect `tuned` to settle at 2 × 6–9 and land within ±10% of `2x8-pinned` on accepted/s with equal or lower CPU per accepted (narrower width, fewer IPC losses). Bar 1: about 65%.
- Bar 2: 75% on a quiet slice (the bound changes only on ≥ 20% moves, and `u`'s spread was ~5%).
- Bar 3: 50%. At 4 and 8 the cells are CPU-bound, so the best fixed width should be near the allotment, not above it; the risk is noise in 30 s rows and the unbalanced 16 allotment.
- Bar 4: met.
- Bar 5: 70%. The kernel, not the planner, splits CPU between the job and 12 spinners; the planner only decides its width. The CPU-use half depends on that split.
- `tuned-p67` on a quiet slice should do about as well as `tuned` at full allotment (no peers, so its share is the whole quota); the difference shows only with peers and at waiting workloads.
- `IsolatePool`: 16 ≥ 32 on jobs/s (exploratory 10 s: 16.2 against 8.8 jobs/s).

## Decision rule

If bars 1–4 all pass, `POLICY` becomes `TUNED_POLICY` (the tuned planner is the default for the contained route and `IsolatePool`'s starting size). Otherwise the default stays fixed (`{ mode: 'fixed', width: 'cores', perDomain: 1 }`) and P-68's code still lands, with `TUNED_POLICY` meaning the occupancy-capped tuner. Bar 5 is reported either way; a bar 5 miss with bars 1–4 met still makes the tuned planner the default only if its peer row's job CPU is ≤ 1.15 × its share decision (it never takes more than fair).

`IsolatePool`: its default stays `defaultWidth()` (it follows the planner's starting width under whatever `POLICY` is) unless the old 32 beats it by more than 5% in jobs/s on the worse round without more than 5% higher CPU per job, in which case its default reverts to `availableParallelism()`.

## Strongest rival

"Occupancy is not stable enough per attempt to set width; the cap jitters." Discrimination: per `tuned` row, the coefficient of variation of the per-window raw `u` (sd ÷ mean), the number of bound changes, and the width changes per minute after settling. The rival holds if the CV exceeds 0.15 or the bound changes more than once a minute after settling in any quiet `tuned` row; it's rejected if the CV is ≤ 0.15 and bound changes after settling are ≤ 1 a minute in all of them.

## What a miss means

Bar 1: the tuner's exploration costs more than the fixed shape gives back, or settling narrower loses throughput. Bar 2: windows are too noisy or the cap moves the bound; longer windows or a wider band. Bar 3 at one allotment: the starting shape or the cap is wrong there. Bar 4: a defect; stop. Bar 5: the share rule mis-detects peers, or the kernel's split doesn't follow the planner's width.

## Stop condition

A verdict difference: stop and fix before further rows. A block that can't be made quiet under method A in two attempts goes to method B; if method B can't run (the peer scope fails), the block is recorded as unmeasured.

## Amendment 1 (2026-11-08, before any restricted-allotment acceptance row counts)

The "unexpected kernel property" above is wrong. `heavy-run` sizes `heavy.slice` from `nproc`, which follows the caller's affinity, and rewrites the slice when that number changes. Every `taskset -c … heavy-run …` call in the exploratory runs (and the first two 4-CPU sweep rows of round 1) resized `heavy.slice` to 56% of the restricted CPU count (224% for 4 or 8 CPUs, so the "0.56 × k" pattern), for every job in the slice, until the next unrestricted `heavy-run` call wrote 1792% back. P-67's `taskset -c 0-3` and `0-7` sweeps ran the same way, so their 4- and 8-CPU allotments were probably the slice's 2.24 and 4.48 CPUs too. The slice was restored with an unrestricted `heavy-run --write-slice` at 02:07 EST (`cpu.max` 1792000 100000). The two affected rows (round 1, 4 CPUs, `w2` and `w4`, calibration 2.25 CPUs) are kept in `receipt/invalid/` and don't count.

Changed procedure: the affinity is applied inside `heavy-run`, never before it: `systemd-run --user --scope -p CPUQuota=Q -- env HEAVY_SLOTS=4 heavy-run --name p68-bench -- taskset -c CPUS node bench.mjs …`. `heavy-run` still copies the outer scope's quota onto the job scope. Each restricted block's calibration must read the quota (±5%), or the block doesn't count. The allotment table is unchanged. Arms, fairness and full-allotment sweep rows already measured ran with the slice at 17.92 (each file's probe records it) and stand.

## Amendment 2 (2026-11-08, before any ds9 or MacBook Air measurement and before the remaining main-rig restricted rows)

**Correction to amendment 1.** Applying `taskset` inside `heavy-run` wasn't enough: coreutils 9.12 `nproc` also honours the scope's `cpu.max`, so `heavy-run` started inside a `CPUQuota=400%` scope still saw 4 threads and rewrote `heavy.slice` to 224% (02:06–02:08 EST; the earlier window was 02:00–02:04, not "02:07" as amendment 1 says). The second set of 4-CPU rows is set aside in `receipt/invalid/` too. Restricted runs now pass the real thread count to `heavy-run` and drop it for the job: `systemd-run --user --scope -p CPUQuota=Q -- env OMP_NUM_THREADS=$(nproc --all) HEAVY_SLOTS=4 heavy-run --name p68-bench -- env -u OMP_NUM_THREADS taskset -c CPUS node bench.mjs …` (checked: job scope `cpu.max` 400000, slice unchanged at 1792000). The driver aborts if the slice's `cpu.max` isn't 1792000 100000 before any block.

**Code changed for the degrade path, before measuring there** (the Linux path behaves as before; the remaining main-rig rows run this commit):
- `probe.mjs`: on macOS, memory headroom from `vm_stat` (free + inactive + speculative + purgeable pages) instead of `os.freemem()`, which read 388 MB on the 16 GB Air with ~5.2 GB reclaimable and would have held the memory cap near 12 cells; `perfLevels` from `sysctl hw.perflevel0/1.physicalcpu`, with a note when cores are mixed. Tests added.
- `cohort-set.mjs`: without `/proc`, cohort CPU and RSS come from `ps -o time=,rss=`. Before this, `cpuMs()` returned null on macOS, so the tuner had no CPU-per-attempt guard and never measured `u` (its bound stayed at 1.25 × share).
- `bench.mjs`: load from `os.loadavg()`, PSI and cgroup optional, `--loadMax`, `--arms`, `--machine`; CPU from `ps` without `/proc`.

**Extension of bar 3 (portability) to two more machines.** The main-rig decision rule doesn't change. Same bar: on each machine, `tuned` accepted/s (worse of two rounds) ≥ 0.90 × the best fixed width of the sweep (each width's worse round). Also reported: the probe, the plan, and each arm's accepted/s and CPU per accepted.

| | ds9 | MacBook Air |
|---|---|---|
| Hardware | Xeon E5-2699 v4, 22 cores / 44 threads, one 55 MiB L3, 188 GB, cgroup v2 | Apple M2, 4 performance + 4 efficiency cores, 16 GB, macOS, no cgroup or sysfs |
| Node | 26.13.0 | 22.23.3 (26 isn't installed) |
| Allotment | `HEAVY_SLOTS=4 heavy-run` (its `heavy.slice`, 24.64 CPUs) | the whole machine (8) |
| Expected plan | one cohort (one L3 domain): fixed width 22, tuned start 22, max 74 | one unpinned cohort: fixed width 8, tuned start 8, max 24 |
| Arms (120 s) | `fixed` (current default), `tuned` | `fixed`, `tuned` |
| Sweep (30 s), then `tuned` 120 s | 8, 16, 22, 32, 48, 74 | 2, 4, 6, 8, 12, 16, 24 |
| Gate | PSI `cpu some avg10` ≤ 5, no other job in its `heavy.slice` (its containers keep load near 11, so load isn't gated, `--loadMax=1000`); load recorded per row | 1-minute load ≤ 4, waiting up to 20 min (no PSI on macOS); load recorded per row |
| Rounds | round 1 forward, round 2 reverse | same; `pmset -g batt` and `pmset -g therm` before and after each round. It runs on battery and is fanless, so its figures are labelled battery/thermal-affected |

ds9: EndoForge cloned to `~/endoforge-p68` at this commit; `tools/tscheck` dependencies via the repo's `npm ci`, and the AssemblyScript compiler copied from main-rig into the clone; nothing else on ds9 changes and no container or service is touched. MacBook Air: `--depth 1` clone; `tools/tscheck/node_modules` and the compiler copied from main-rig into the clone (no installs); receipts copied back to main-rig; the clone deleted at the end. On both, a row that isn't quiet is rerun once; if it still isn't, it's reported as loaded and doesn't count.
