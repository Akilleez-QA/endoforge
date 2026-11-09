# Capacity planner interface control document (Mjölnir)

## Scope and ownership

`core/runtime/capacity/` decides how many cells a job runs at once (width), where they run (placement on cache
domains) and how a job is split into cohorts, from the machine it runs on and what else shares its CPU allotment. It is
a system of the Cstack family: EndoForge is its canonical home and Cstack vendors it through
`tools/pin_endoforge.py`. It has no dependencies beyond Node's standard library, writes nothing to disk, and reads only
`/proc` and `/sys` (on macOS it runs `sysctl -n hw.perflevel0/1.physicalcpu` and `vm_stat` instead). Interface version: `INTERFACE_VERSION = 1` (`index.mjs`); a field removal or meaning change bumps
it.

Consumers in EndoForge: the contained route (`tools/tscheck/contained-route.mjs`) uses it whenever the caller gives
no width; an explicit width always wins. `IsolatePool` (`core/runtime/isolate-pool.mjs`) no longer does: P-68's
precommitted rule returned its default size to `availableParallelism()`: on worse rounds the old 32 gave 4.7 jobs/s
against 2.3 for the plan's 16. The rounds disagreed (16 led 7.6 to 4.7 in round 1; 32 led 9.5 to 2.3 in round 2), so the
evidence is weak in both directions.

## Library interface (`core/runtime/capacity/index.mjs`)

| Export | Contract |
|---|---|
| `probe()` | The machine as this process sees it, read once and cached. See the probe record below. |
| `probeMachine(host?)` | The same, uncached; `host` replaces the readers (`read`, `exists`, `parallelism`, `freeMb`, `os`) for tests. |
| `plan({ queues = 1, allotment?, probe?, policy? })` | Cohorts for `queues` independent queues within `allotment` CPUs (default: the probe's). See the plan record. |
| `defaultWidth(options?)` | `plan(options).width`, the starting total width. |
| `POLICY` | The shipped default: `{ mode: 'fixed', width: 'cores', perDomain: 1, headroom: 1.25 }`, one cohort per L3 domain as wide as that domain's cores within its share (P-67's best fixed arm). |
| `TUNED_POLICY` | `{ mode: 'tuned', cap: 'occupancy', headroom: 1.25, oversubscribe: 3, ram: 0.75 }`: the same placement with the online tuner, capped by measured occupancy (P-68). Opt in with `plan({ policy: TUNED_POLICY })` or the route's `placement`. |
| `P67_TUNED_POLICY` | `{ mode: 'tuned', cap: 'share', headroom: 1.25 }`: the tuner as P-67 shipped it, capped at min(threads, ceil(1.25 × share)) and bounded by the P-67 share rule. Kept for comparison. |
| `createTuner({ start, max, ...TUNER_DEFAULTS })` | A width tuner fed one window at a time: `observe({ completions, elapsedMs, cpuMs?, saturated? })` returns the width to use next; `setBound(n)` lowers or raises the ceiling (a change of at least max(2, 20%) that persists for `boundsWindows` calls; a rise re-tunes a settled width only after the hold); `width`, `phase` (`explore` or `settled`), `history` (every change with its reason). |
| `createController({ plan, apply, cpuMs?, rssMb?, backlog?, meter?, memory?, windowMs?, minCompletions? })` | Wraps a tuner for a plan's cohorts: call `started()` when an attempt is dispatched and `completed(decided)` when it finishes; it closes 1 s windows, samples the share meter, sets the tuner's bound, and calls `apply(widths)` with one width per cohort when the width changes. `occupancy` reports `{ windows, mean, sd, u }`. A plan with `tuned: false` never changes. |
| `createOccupancy()` / `occupancyCap({ share, u, headroom, max, memoryCells })` | Occupancy `u` is CPU time per in-flight cell second (`cpuMs` over the integral of in-flight attempts). The estimate is the running maximum of a 3-window median, decaying 0.5% a window, because contention only lowers the raw ratio. Cap per cohort = min(max, ceil(headroom × share per cohort ÷ u), memory cells). |
| `createShareMeter(probe?)` | `sample()` returns `{ share, mode, peers, othersCpus, throttledMs, level, legacyShare, levels, source }` since the previous sample. See the share rule below. |
| `createMemoryMeter(probe?)` | `headroomMb()`: MemAvailable, lowered to the memory cgroup's ceiling minus its current use. |
| `fairShare(quota, peers)` | The max-min fair claim of one more job beside peers using `peers` CPUs (a peer at `Infinity` wants all it can get). |

### Probe record

`{ os, cpus: [allowed CPU ids], quota: CPUs | null, quotaCgroup, levels: [{ cgroup, quota, branch }], ownCgroup,
allotment, domains: [{ cpus, cores }], cores, smt, perfLevels, memory: { availableMb, headroomMb, limitMb, cgroup }, taskset: path | null,
notes: [strings] }`

- `allotment` = min(allowed CPUs, tightest `cpu.max` on the process's cgroup chain). Allowed CPUs are the affinity
  mask intersected with `cpuset.cpus.effective`.
- `domains` group allowed CPUs by shared L3 (`cache/index*/level == 3`, `shared_cpu_list`); `cores` counts distinct
  `thread_siblings_list` groups.
- `perfLevels` is `{ performance, efficiency }` physical cores on macOS (from `sysctl`), else `null`. Mixed cores are all
  counted as cores of one domain and the probe says so in `notes`.
- Without `/proc/meminfo`, macOS headroom is free + inactive + speculative + purgeable pages from `vm_stat`
  (`os.freemem()` there omits reclaimable pages and reads a few hundred MB on a busy 16 GB machine).
- Anything unreadable degrades to one domain of `availableParallelism()` CPUs with no quota, and adds a line to
  `notes`. A caller must treat `notes` as "this figure is a guess".

### Plan record

`{ mode, tuned, headroom, allotment, queues, pinned, cohorts: [{ queue, width, max, share, cpus | null }], width, max,
notes }`

- With at least two allotted CPUs per L3 domain and `taskset` present, there is one cohort per domain (times
  `policy.perDomain`), each pinned to its domain's CPUs; otherwise one unpinned cohort per queue.
- Tuned: `width` per cohort starts at min(its share, its physical cores) and `max` is min(its threads, ceil(headroom × share)). Fixed with `width: 'cores'`: width = max = min(its physical cores, ceil(share)).
- `queue` assigns cohorts to queues round-robin.
- Tuned with `cap: 'occupancy'`: `max` per cohort is ceil(oversubscribe × share), the most cells the runner may ever be given; the controller's occupancy cap keeps the live bound below it.

### Share rule

For every cgroup on the job's chain with a finite `cpu.max` (`probe.levels`), the meter reads the job's branch, its
siblings (peers) and their `cpu.pressure`. A peer is active above 0.5 CPU, and starved when some of its tasks waited
for CPU more than 10% of the window. With no active peer at any level the job is `lone` and its share is the whole
allotment. Otherwise it is `shared` and each level's claim is `fairShare(quota, peers)`, where a starved peer counts as
wanting an equal split and any other peer as wanting what it used; the share is the smallest claim, clamped to
[1, allotment]. `legacyShare` is P-67's rule (max(quota − others, quota ÷ (1 + peers)) at the tightest level).

## Command interface (`core/runtime/capacity/cli.mjs`)

For callers that aren't Node (`heavy-run`, `lane-governor`, `gpu-queue`). Each prints one JSON line to stdout with
`interface: 1`; a usage error exits 2.

| Command | Output |
|---|---|
| `node core/runtime/capacity/cli.mjs probe` | `{ interface, probe }` |
| `node core/runtime/capacity/cli.mjs plan [--queues=N] [--allotment=CPUS]` | `{ interface, probe, plan }` |
| `node core/runtime/capacity/cli.mjs share [--ms=1000]` | `{ interface, share }` sampled over `ms` |

The probe describes the calling process, so a caller that wants the plan for a job it is about to start should run the
CLI inside the same cgroup and affinity it will give that job (for example under the same `systemd-run` scope or
`taskset`).

## Evidence

The tuner's thresholds and the default policy come from P-63 and P-67 (`experiments/P-67-adaptive-width/`); the
occupancy cap and the share rule from P-68 (`experiments/P-68-tuner-occupancy/`).
