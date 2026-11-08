# Capacity planner interface control document (Mjölnir)

## Scope and ownership

`core/runtime/capacity/` decides how many cells a job runs at once (width), where they run (placement on cache
domains) and how a job is split into cohorts, from the machine it runs on and what else shares its CPU allotment. It is
a system of the Cstack family: EndoForge is its canonical home and Cstack vendors it through
`tools/pin_endoforge.py`. It has no dependencies beyond Node's standard library, writes nothing to disk, and reads only
`/proc` and `/sys`. Interface version: `INTERFACE_VERSION = 1` (`index.mjs`); a field removal or meaning change bumps
it.

Consumers in EndoForge: the contained route (`tools/tscheck/contained-route.mjs`) and `IsolatePool`
(`core/runtime/isolate-pool.mjs`) use it whenever the caller gives no width. An explicit width always wins.

## Library interface (`core/runtime/capacity/index.mjs`)

| Export | Contract |
|---|---|
| `probe()` | The machine as this process sees it, read once and cached. See the probe record below. |
| `probeMachine(host?)` | The same, uncached; `host` replaces the readers (`read`, `exists`, `parallelism`, `freeMb`, `os`) for tests. |
| `plan({ queues = 1, allotment?, probe?, policy? })` | Cohorts for `queues` independent queues within `allotment` CPUs (default: the probe's). See the plan record. |
| `defaultWidth(options?)` | `plan(options).width`, the starting total width. |
| `POLICY` | The shipped default policy: `{ mode: 'tuned' | 'fixed', headroom, width?, perDomain? }`. |
| `createTuner({ start, max, ...TUNER_DEFAULTS })` | A width tuner fed one window at a time: `observe({ completions, elapsedMs, cpuMs?, saturated? })` returns the width to use next; `setBound(n)` lowers or raises the ceiling (applied after it persists for `boundsWindows` calls); `width`, `phase` (`explore` or `settled`), `history` (every change with its reason). |
| `createController({ plan, apply, cpuMs?, backlog?, meter?, windowMs?, minCompletions? })` | Wraps a tuner for a plan's cohorts: call `completed(decided)` once per finished attempt; it closes 1 s windows, samples the share meter, and calls `apply(widths)` with one width per cohort when the width changes. A plan with `tuned: false` never changes. |
| `createShareMeter(probe?)` | `sample()` returns `{ share, othersCpus, peers, throttledMs, source }` since the previous sample, from the quota cgroup's `cpu.stat` and its siblings'. |

### Probe record

`{ os, cpus: [allowed CPU ids], quota: CPUs | null, quotaCgroup, ownCgroup, allotment, domains: [{ cpus, cores }],
cores, smt, memory: { availableMb, headroomMb, limitMb }, taskset: path | null, notes: [strings] }`

- `allotment` = min(allowed CPUs, tightest `cpu.max` on the process's cgroup chain). Allowed CPUs are the affinity
  mask intersected with `cpuset.cpus.effective`.
- `domains` group allowed CPUs by shared L3 (`cache/index*/level == 3`, `shared_cpu_list`); `cores` counts distinct
  `thread_siblings_list` groups.
- Anything unreadable degrades to one domain of `availableParallelism()` CPUs with no quota, and adds a line to
  `notes`. A caller must treat `notes` as "this figure is a guess".

### Plan record

`{ mode, tuned, headroom, allotment, queues, pinned, cohorts: [{ queue, width, max, share, cpus | null }], width, max,
notes }`

- With at least two allotted CPUs per L3 domain and `taskset` present, there is one cohort per domain (times
  `policy.perDomain`), each pinned to its domain's CPUs; otherwise one unpinned cohort per queue.
- `width` per cohort starts at min(its share, its physical cores); `max` is min(its threads, ceil(headroom × share)).
- `queue` assigns cohorts to queues round-robin.

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

The tuner's thresholds and the default policy come from P-63 and P-67 (`experiments/P-67-adaptive-width/`).
