# P-44 off-heap allocation through the workcell pool: result

Status: **Recorded (probe)**, 2026-11-06, a shared desktop with other agent work running. Precommit: [PRECOMMIT.md](PRECOMMIT.md); the last digest in `receipt/precommit.sha256` covers Amendment 1. Raw trials: [summary.json](receipt/summary.json).

A job retained and touched off-heap memory with the cell's heap limited to 128/16 MiB and a 3 GiB safety cap, N = 3 per kind per arm. Reaching the cap means nothing stopped it.

| Kinds | Thread, Node 26.13.0, 26.8.1, 22.23.3 | Process, no cgroup, same versions | Process, `memory.max` only (first run) | Process, `memory.max` and `memory.swap.max=0` |
|---|---|---|---|---|
| `arraybuffer`, `typedarray`, `buffer`, `shared-arraybuffer` | **Not bounded**: 3,072 MiB, pass | **Not bounded**: 3,072 MiB, pass | **Not bounded**: 3,072 MiB, pass | Killed at 256 MiB, inconclusive |
| `blob` | **Not bounded**: 3,072 MiB, pass | **Not bounded**: 3,072 MiB, pass | **Not bounded**: 3,072 MiB, pass | Killed at 192 MiB, inconclusive |
| `wasm-memories` (each 32 MiB, under the ceiling) | **Not bounded**: 3,072 MiB, pass | **Not bounded**: 3,072 MiB, pass | **Not bounded**: 3,072 MiB, pass | Killed at 288 MiB, inconclusive |
| `js-heap` control | Stopped, `limit`, inconclusive | Stopped, `heap`, failed | Stopped, `heap`, failed | Stopped, `heap`, failed |

The figures are the last chunk completed before the kill, and were the same in all three reps. No sibling was lost in any of the 168 trials, and every job submitted after the breach completed. The siblings had been released by then and the receipt doesn't record which cell ran that job, so this doesn't show the replacement cell itself working. The harness now records it, and this receipt predates that. Kills under the cgroup were reported as `outcome_unknown` / `worker_exit` / `SIGKILL`, never as a pass.

## Findings

- **Thread mode can't bound off-heap memory.** `resourceLimits` doesn't see it, and on these three Node versions nothing stopped 3 GiB, about 23 times the old-generation limit. The job *passed*. This is now a stated limit in REQ-ISO-013 and the runtime README. A cell's allocation is process-wide, so the only stop is the host's own.
- **Process mode without a cgroup is the same.** `--max-old-space-size` doesn't see it either.
- **The first cgroup run was a real bug.** Prediction 3 failed: with `cgroup: enabled` and `memory.max` at 304 MiB, each kind still reached 3 GiB and passed. The cell's `memory.swap.max` was unset, and this host has zram plus a swapfile, so the excess most likely went to swap. The receipt has no swap reading, so that is inferred. Workcell cgroups now set `memory.swap.max=0` when the file exists. With that, every off-heap kind was killed at or below 304 MiB, so Amendment 1's prediction held. `memory.max` alone doesn't bound a cell on a host with swap.

## Predictions

1. Thread and process without a cgroup reach the cap: **held** on all three versions.
2. `js-heap` stopped in all arms: **held**.
3. Cgroup kills below 304 MiB plus one chunk: **failed on the first run**, held after Amendment 1's change.
4. No sibling lost: **held**.

## What this does not show

- The safety cap stops the probe at 3 GiB. It doesn't show what a global OOM would do to the supervisor, which README already says can end the host.
- The kinds are synthetic. Native addons and other native allocations weren't exercised, and the lab case named in the review isn't on disk under that name, so it wasn't rerun directly. Thread-mode ArrayBuffer behaviour on its Node version, 26.8.1, is measured here.
- A cgroup needs delegation. This run used a transient `Delegate=yes` user scope. Without delegation, the result records `cgroup: unavailable` and the process column applies.
- A cgroup kill stays `outcome_unknown` because it has no V8 diagnostic. It isn't relabelled as a memory breach.
- One host, three reps, no quiet gate.
