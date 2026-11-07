# P-44 off-heap allocation through the workcell pool: precommit

Label: **Proposed** procedure, frozen 2026-11-06 before measurement.

Question: `resourceLimits` and `--max-old-space-size` bound the V8 heap. Which limit, if any, stops a workcell that retains off-heap memory, in thread mode, process mode, and process mode with a delegated cgroup?

Method: real `IsolatePool` jobs, 4 cells, default heap limits (128/16 MiB), `wasmMemoryMaxMb` 64, a fresh pool per trial, N = 3 per kind per arm. One job runs [port.mjs](port.mjs), which retains and touches chunks until a stop or a **safety cap of 3 GiB**, about 23 times the old-generation limit. Three siblings are held mid-job until the breach settles; a queued job then shows replacement. Reaching the safety cap with no stop counts as *not bounded*; the cap exists to protect the desktop and says nothing about where a limit would appear.

Kinds: `arraybuffer`, `typedarray`, `buffer`, `shared-arraybuffer`, `blob`, `wasm-memories` (separate 32 MiB `WebAssembly.Memory` objects, each under the 64 MiB ceiling), and `js-heap` as the positive control.

Arms: thread and process with no cgroup on Node 26.13.0, 26.8.1 and 22.23.3. Process with a cgroup on Node 26.13.0 inside a transient `Delegate=yes` user scope, default `memoryMax` 304 MiB.

Predictions:

1. Thread and process without a cgroup: every off-heap kind reaches 3 GiB and the job completes, on all three Node versions. Nothing stops them.
2. `js-heap` is stopped in all arms.
3. Process with a cgroup: every off-heap kind is killed below 304 MiB of off-heap progress plus one chunk, reported as `outcome_unknown` / `worker_exit` / `SIGKILL`, never as a pass.
4. No sibling is lost in any trial and every replacement completes.

Failure meaning: an off-heap kind stopped in arm 1 would mean a limit exists that this repo doesn't document, and the requirement text must describe it. A kill in arm 3 reported as a pass, or a lost sibling in any arm, is a containment failure. A cgroup that can't be delegated leaves arm 3 unmeasured, and this is reported as unmeasured.

Limits: a shared desktop with other work running. One host, a safety cap instead of unbounded growth, and no test of what a global OOM does to the supervisor. Only the listed kinds; native addons and other native allocations are not exercised. The lab case cited in the review is not on disk under that name, so these synthetic kinds stand in for it.

## Amendment 1, after the first cgroup run

The first cgroup arm missed prediction 3: every off-heap kind reached 3 GiB under `cgroup: enabled` with no kill, and it stays in the receipt as `cgroup-first-run`. Each trial took longer than the uncgrouped arm, and `isolate-cgroup.mjs` never sets `memory.swap.max`, so the hypothesis is that `memory.max` caps resident memory while the excess goes to swap, unbounded. The change under test: a workcell cgroup also gets `memory.swap.max=0` when the file exists. Prediction for the rerun: all off-heap kinds are killed below 304 MiB plus one chunk of progress, as `outcome_unknown` / `worker_exit` / `SIGKILL`, with no lost sibling, and `js-heap` is still rejected. Any other result means this hypothesis is wrong and the arm is reported as not bounded.
