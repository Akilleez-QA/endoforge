# P-20 old probes vs new pool — result

Status: **Recorded (probe), with compile compatibility stops**. All 24 precompiled
repetitions completed through the real thread/process IsolatePool, evaluator, gates,
frozen-content checks and Python Ledger. The compile and residency arms failed
during compiler import before any timed candidate; wider steps and remaining
repetitions in those arms were stopped as precommitted.

UTC run: 2026-11-02T00:32:01.262Z to 2026-11-02T00:42:31.912Z. Node v26.12.0,
AMD Ryzen 9 7950X 16-Core Processor, kernel 7.2.8-9-omarchy; measured supervisors and inherited workers
were pinned to cores 0–27. Every measurement invocation held the exclusive
`flock /tmp/ef-bench.lock`; the harness also checked lock contention before running.
The lock wait preceded measurement. This was a shared desktop, without a quiet gate.

Precommit SHA-256: `8d71be6e709e96252e45d1a2d13d59f46fdb265fa0da8fc12b42a1c5f92ee84a`. The [precommit](PRECOMMIT.md)
and [hash](receipt/precommit.sha256) preceded setup and measurement. See
[summary.json](receipt/summary.json), `receipt/raw/`,
[source/runtime hashes](receipt/modules.sha256), [dependency hashes](receipt/dependencies.sha256),
and [setup attempts](receipt/setup.json). No core or existing test files changed.

## Procedure as run

The 22 sources are read directly from P-15: 17 expected accepts, three compiler
rejects, and two exact env.clock negative controls. Sources, -O3, stub runtime,
initialMemory 1, --noAssert, signature, five inputs, 20 step events per case,
fresh instances, and the five gate limits follow P-15/P-16/P-17. Kernel builds
add --maximumMemory 16 because the pool requires declared memory maxima.
The precompiled arm builds once outside measurement, with 128/16 MiB heap
settings and a 64 MiB WASM ceiling. Both modes use three fresh-pool repetitions
at N=1,10,20,50 and a 15 s submission window. Throughput includes draining
in-flight jobs after that window. Warmup jobs and receipts are excluded.

The compile arm attempted N=1 in both modes; the residency arm attempted N=100
in both modes. Those arms use 1024/16 MiB heap settings and a 4096 MiB WASM ceiling.
The P-15/P-17 combined widths and 5 s residency windows were precommitted, but
no timed windows in those arms began. Consequently the P-15 latency stop ratio
has no usable baseline. No memory-floor stop fired.

## Old versus new accepted-correct/s

Old figures below come directly from [P-15 RESULT](../P-15-workcell-concurrency/RESULT.md),
[P-17 RESULT](../P-17-workcell-gap/RESULT.md), and
[P-16 RESULT](../P-16-workerd-isolates/RESULT.md). P-15 values are displayed rep
ranges; P-17 values are its published medians; P-16 values are medians of its
displayed three reps. New values are medians of three reps. Missing measurements
are not zero throughput. Shared P-15/P-17 compile widths were planned to reuse
observations, rather than duplicate the same workload.

| Old workload | N | Old accepted/s | New thread | New process |
|---|---|---|---|---|
| P-15 compile | 1 | 21.2–21.4 | blocked before ready | blocked before ready |
| P-15 compile | 10 | 99.3–119.4 | not run (stop) | not run (stop) |
| P-15 compile | 50 | 62.3–77.1 | not run (stop) | not run (stop) |
| P-17 compile | 10 | 88.9 | not run (stop) | not run (stop) |
| P-17 compile | 12 | 98.9 | not run (stop) | not run (stop) |
| P-17 compile | 16 | 95.8 | not run (stop) | not run (stop) |
| P-17 compile | 20 | 108.6 | not run (stop) | not run (stop) |
| P-17 compile | 24 | 107.4 | not run (stop) | not run (stop) |
| P-17 compile | 28 | 112.1 | not run (stop) | not run (stop) |
| P-17 compile | 32 | 108.9 | not run (stop) | not run (stop) |
| P-17 compile | 40 | 96.4 | not run (stop) | not run (stop) |
| P-17 compile | 50 | 65.8 | not run (stop) | not run (stop) |
| P-15 residency | 100 | 24.0–26.5 | blocked before ready | blocked before ready |
| P-15 residency | 150 | 17.2–20.6 | not run (stop) | not run (stop) |
| P-15 residency | 200 | 9.7–13.7 | not run (stop) | not run (stop) |
| P-16 precompiled | 1 | 1852 | 2.90 | 2.93 |
| P-16 precompiled | 10 | 1950 | 7.40 | 7.55 |
| P-16 precompiled | 20 | 1561 | 6.87 | 7.16 |
| P-16 precompiled | 50 | 1881 | 6.00 | 6.58 |

## Precompiled latency, memory, and readiness

New latency includes pool queueing, evaluator rounds, Python frozen verification,
and durable receipt append. p50/p95 are medians of the three per-rep percentiles.
Heap is the median across reps of median cell maximum-sampled used JS heap;
external/WASM memory is excluded. RSS/cell is (sampled peak minus supervisor
baseline)/N. Sampling is every 200 ms and includes transient direct Python
children. Thread RSS is counted once. Old P-16 RSS/cell uses total RSS/N,
without subtracting its supervisor baseline; old heap was not recorded.

The pool exposes no spawn timestamp. New readiness is submission-to-port-ready
and is an **upper bound** including serialized ledger preparation, startup and
module loading. The two new ready columns are median cell p50 / median all-ready
over reps. Old P-16 reports all-ready ranges. They are different observables.

| N | Runtime | accepted/s (rep range) | latency p50 / p95 ms | RSS/cell MiB | heap/cell MiB | ready p50 / all ms |
|---|---|---|---|---|---|---|
| 1 | old P-16 | 1713–1854 | 0.37 / 0.67 | 170–173 | unavailable | — / 30–78 |
| 1 | new thread | 2.89–2.93 | 296.26 / 332.30 | 60.9 | 12.0 | ≤ 65 / 70 |
| 1 | new process | 2.86–2.93 | 289.53 / 328.84 | 105.8 | 12.0 | ≤ 75 / 81 |
| 10 | old P-16 | 1351–2568 | 2.95 / 9.02 | 35–46 | unavailable | — / 79–96 |
| 10 | new thread | 7.30–7.42 | 1067.95 / 1367.25 | 19.7 | 8.5 | ≤ 217 / 417 |
| 10 | new process | 7.41–7.59 | 1039.42 / 1332.57 | 76.1 | 8.3 | ≤ 233 / 434 |
| 20 | old P-16 | 959–1728 | 8.30 / 18.59 | 27–31 | unavailable | — / 162–264 |
| 20 | new thread | 6.31–6.95 | 2203.19 / 2669.61 | 16.0 | 8.3 | ≤ 433 / 846 |
| 20 | new process | 7.07–7.21 | 2102.97 / 2601.84 | 72.2 | 8.3 | ≤ 420 / 823 |
| 50 | old P-16 | 1820–1915 | 19.29 / 27.41 | 23.5 | unavailable | — / 344–421 |
| 50 | new thread | 5.86–6.21 | 6164.61 / 7201.06 | 13.7 | 8.2 | ≤ 1040 / 2138 |
| 50 | new process | 6.54–6.60 | 5421.33 / 6586.92 | 70.0 | 8.2 | ≤ 1045 / 2040 |

Peak new throughput by mode:

- thread: N=10, 7.40 accepted-correct/s (median).
- process: N=10, 7.55 accepted-correct/s (median).

All timed reports matched the expected accepts/interface rejects/effect rejects,
and every completed precompiled receipt had the expected candidate, oracle and
outcome. Python Ledger.records revalidated every complete chain after each rep;
3566 durable receipts include warmups,
with 3080 timed correct completions and 2435 timed accepts.
Process cgroup status was unavailable.

## Compiler compatibility stop

The pinned AssemblyScript module imports an embedded 7,419-byte `f64_pow` WASM
helper with one memory: initial=1 page, **no declared maximum**. The pool
memoryType check refuses missing maxima before allocation, even with a 4096 MiB
ceiling. This is source compatibility, not measured compiler latency or a
demonstrated physical-memory exhaustion. [Static decoding evidence](receipt/compiler-memory.json)
can be reproduced with `node experiments/P-20-pool-speed-rerun/inspect-compiler.mjs`
using the same P20_ASC installation. Neither the guard nor the compiler was patched.

| Attempt | N | Mode | Cells port-ready | Durable failure receipts | Pool outcome |
|---|---|---|---|---|---|
| compile r1 | 1 | thread | 0 | 1 | outcome_unknown: limit |
| compile r1 | 1 | process | 0 | 1 | rejected: wasm_memory |
| residency r1 | 100 | thread | 0 | 100 | outcome_unknown: limit |
| residency r1 | 100 | process | 0 | 100 | rejected: wasm_memory |

All 202 failure receipts were chain-verified. They do not count as correct
candidate completions. No automatic retry was used. Repetitions 2–3 and subsequent
widths stopped after the first failed preparation in each arm/mode.

## Machine load

Before/after each sweep (and each rep) record host loadavg, MemFree,
MemAvailable and process counts. Process counts see only the execution PID
namespace, **not the desktop total**; the per-rep supervisor snapshots exclude
its descendants and are the appropriate count scope. Child-rep snapshots may
include the idle parent controller. Old probes counted desktop Codex processes,
so those counts are not directly comparable. Host load and memory remain global.

| Sweep | load 1m before → after | MemFree GiB before → after | MemAvailable GiB before → after | visible other-heavy before → after |
|---|---|---|---|---|
| compile thread | 8.45 → 8.45 | 1.79 → 1.96 | 59.48 → 59.03 | 0 → 0 |
| compile process | 8.45 → 8.41 | 1.96 → 2.20 | 59.03 → 59.27 | 0 → 0 |
| residency thread | 8.41 → 41.83 | 2.20 → 4.58 | 59.27 → 65.03 | 0 → 0 |
| residency process | 41.83 → 49.27 | 4.58 → 19.83 | 65.03 → 74.22 | 0 → 0 |
| precompiled thread | 49.27 → 8.57 | 19.83 → 6.99 | 74.22 → 71.04 | 0 → 0 |
| precompiled process | 8.57 → 6.33 | 6.99 → 5.51 | 71.04 → 69.11 | 0 → 0 |

Minimum sampled MemAvailable: 48.55 GiB, above the 20% floor.
Widths were ascending, modes sequential. Old P-16 reported load 10–16;
P-17 load rose 8→48; P-15 residency reached 140. This run cannot remove
background drift from comparisons. Repository checks overlapped early
preparation/repetitions; their CPU cost is part of this shared-host run.

## Verification

`make check`: passed, 0 failures over 52 documents. `node --check run.mjs` and
precommit/source hash checks passed. See [verification.json](receipt/verification.json).
`make test ENDOFORGE_TEST_OUTPUT=/tmp/ef-p20-tests`: 18 core and 32 ledger tests
passed, then the engine tests stalled; interrupted with exit 130.
`timeout --signal=INT --kill-after=5s 90s make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/ef-p20-tests-optimized`:
the same 50 Python tests passed; engine evaluation was canceled with a pending
promise at timeout (exit 124); gates test file completed. Later make targets
were not reached. Synchronous Node subprocess diagnostics returned EPERM or
timed out with stdin in this execution environment; async Python calls used
by the measured pool completed. The full suites are **not claimed to pass**.
Logs: [regular](receipt/make-test.txt), [optimized](receipt/make-test-optimized.txt).

## What it does not show

This compares complete pipelines across separate shared-desktop runs. The new
pipeline validates durable receipts, repeatedly checks frozen content using
Python processes, and evaluates accepted candidates twice. The old probes used
a JavaScript hash chain and one gate evaluation. P-16 also included loopback
HTTP; P-20 uses pool IPC. The much lower full-pipeline rate cannot be attributed
exclusively to isolate scheduling, IPC, the ledger, or a single check without
further measurements. No causal speedup or runtime-only regression claim follows.

No compile throughput curve or maximum stable compile width was obtained.
The compiler could not become ready with the real guard. Moving it to the host
would change the compile experiment; weakening the guard would change the pool.
The constant objective and residual callback only confirm the fixed synthetic
workload, without independent semantic qualification. Compile failures are
represented as real interface-gate rejections because this evaluator has no
compile gate; raw candidate IDs retain that distinction.

Heap excludes external WASM memory. RSS includes shared Node overhead and
validators, is sampled rather than an exact peak, and is not a per-cell quota.
Readiness is a public-API upper bound, not a directly observed spawn interval.
One machine, one lifetime, three reps per completed point; no randomization,
confidence intervals, model service, production qualification, quiet-host
comparison, or new memory-breach containment claim. See P-18 for containment.
No commit or push was performed.

## 2026-11-02 UTC — explicit compiler maximum rerun

The supervisor now supplies a maximum only to the complete-binary SHA-256 match
for `assemblyscript-0.28.20-f64-pow`: 16 pages (1 MiB), digest
`24982099e4fafe2b0779b0d4cb7a78b8264ebd3890e3c8d75b6d54a3e333e189`.
Binaryen already declares 65,536 pages (4096 MiB); its maximum is preserved.
Kernel builds still declare 16 pages. Unmatched no-maximum modules remain rejected.
The policy is fixed by the supervisor before compiler import, never by candidate
input, and is recorded in every ledger observation and published job record.

Only compile and residency were selected with `P20_ARMS=compile,residency`;
original widths, three repetitions, timing windows, affinity, lock and stop rules
were retained. Compilation remains inside each workcell. Kernel source and WASM
hashes match the original P-20 build exactly. The original precommit and all old
numbers above are unchanged. See the dated [plan](receipt/rerun-2026-11-02/rerun-plan.json),
[summary](receipt/rerun-2026-11-02/summary.json),
[source hashes](receipt/rerun-2026-11-02/modules.sha256),
[dependency hashes](receipt/rerun-2026-11-02/dependencies.sha256) and
[setup](receipt/rerun-2026-11-02/setup.json).

UTC measurement: 2026-11-02T01:15:20.268Z to 2026-11-02T02:40:22.570Z; v26.12.0, AMD Ryzen 9 7950X 16-Core Processor,
kernel 7.2.8-9-omarchy; cores 0–27. Shared desktop, no quiet gate.
An initial partial sweep completed two N=1 thread repetitions before interruption:
a hash-lookup cleanup changed guard source during the third repetition startup. The
[partial receipts](receipt/rerun-2026-11-02/interrupted/summary.json) are retained
and excluded below. The final sweep used the frozen source hashes throughout.

Completed points report medians across the successful repetitions shown; three
were planned per point. Latency p50/p95 and
ready p50/all-ready are medians of per-repetition statistics; readiness remains
a submission-to-port-ready upper bound. Heap is median cell maximum-sampled JS
heap; RSS/cell subtracts supervisor baseline and includes direct Python children.
Warmups are excluded from throughput. RSS and heap use MiB.

| Arm | N | Mode | reps | accepted/s (range) | latency p50 / p95 ms | RSS/cell | heap/cell | ready p50 / all ms |
|---|---|---|---|---|---|---|---|---|
| compile | 1 | thread | 3 | 2.30 (2.27–2.30) | 372.63 / 400.58 | 557.8 | 82.0 | ≤ 1998 / 2006 |
| compile | 10 | thread | 3 | 5.39 (5.31–5.50) | 1579.37 / 1801.55 | 508.4 | 79.7 | ≤ 5419 / 5687 |
| compile | 12 | thread | 3 | 4.89 (4.83–4.91) | 2020.88 / 2388.38 | 499.3 | 80.9 | ≤ 6698 / 6979 |
| compile | 16 | thread | 3 | 4.21 (4.16–4.25) | 3073.12 / 3814.02 | 483.0 | 78.6 | ≤ 8772 / 9244 |
| compile | 20 | thread | 3 | 3.44 (3.43–3.47) | 4306.78 / 5797.03 | 491.6 | 73.0 | ≤ 10957 / 11631 |
| compile | 24 | thread | 3 | 2.87 (2.84–2.96) | 6102.25 / 8243.78 | 470.9 | 72.5 | ≤ 13439 / 15223 |
| compile | 28 | thread | 3 | 2.55 (2.51–2.58) | 7993.92 / 11126.22 | 458.2 | 70.8 | ≤ 15812 / 17738 |
| compile | 32 | thread | 3 | 2.32 (1.87–2.35) | 9316.80 / 14665.21 | 480.2 | 63.5 | ≤ 16900 / 19816 |
| compile | 40 | thread | 3 | 1.85 (1.71–1.86) | 14216.87 / 22297.51 | 422.9 | 61.9 | ≤ 20741 / 24817 |
| compile | 50 | thread | 3 | 1.52 (1.46–1.52) | 21724.84 / 28321.16 | 404.2 | 61.1 | ≤ 25156 / 31369 |
| compile | 1 | process | 3 | 2.26 (2.22–2.29) | 378.29 / 417.67 | 648.0 | 63.5 | ≤ 2147 / 2154 |
| compile | 10 | process | 3 | 7.27 (7.26–7.28) | 1094.93 / 1374.28 | 611.7 | 63.3 | ≤ 5396 / 5648 |
| compile | 12 | process | 3 | 7.20 (7.11–7.22) | 1327.34 / 1629.92 | 618.5 | 64.0 | ≤ 6489 / 6847 |
| compile | 16 | process | 3 | 7.13 (7.07–7.13) | 1763.32 / 2147.82 | 602.4 | 62.7 | ≤ 8619 / 9087 |
| compile | 20 | process | 3 | 6.87 (6.86–6.90) | 2190.72 / 2757.03 | 587.3 | 62.2 | ≤ 10593 / 11193 |
| compile | 24 | process | 3 | 6.80 (6.77–6.84) | 2620.42 / 3322.90 | 573.5 | 49.7 | ≤ 12690 / 13532 |
| compile | 28 | process | 3 | 6.72 (6.20–6.81) | 3161.23 / 3808.39 | 550.7 | 62.7 | ≤ 14529 / 15687 |
| compile | 32 | process | 3 | 6.78 (6.73–6.80) | 3684.66 / 4366.65 | 550.8 | 47.9 | ≤ 16435 / 18105 |
| compile | 40 | process | 3 | 6.62 (5.77–6.69) | 4657.24 / 5610.70 | 560.2 | 47.3 | ≤ 19756 / 23203 |
| compile | 50 | process | 3 | 6.46 (6.46–6.47) | 5713.78 / 6866.19 | 560.9 | 48.0 | ≤ 24513 / 29266 |
| residency | 100 | thread | 3 | 0.67 (0.64–0.67) | 100408.24 / 115837.70 | 270.3 | 54.4 | ≤ 42040 / 63922 |
| residency | 150 | thread | 3 | 0.46 (0.42–0.46) | 213893.58 / 250388.09 | 222.9 | 53.2 | ≤ 68336 / 109466 |
| residency | 200 | thread | 0 | not run (stop) | — | — | — | — |
| residency | 100 | process | 3 | 5.13 (4.99–5.27) | 11027.60 / 14787.46 | 508.8 | 48.3 | ≤ 42050 / 65758 |
| residency | 150 | process | 0 | not run (stop) | — | — | — | — |
| residency | 200 | process | 0 | not run (stop) | — | — | — | — |

Stops and outcomes:

- compile / thread: 30 recorded repetitions; all planned points completed.
- compile / process: 30 recorded repetitions; all planned points completed.
- residency / thread: 6 recorded repetitions; stop at N=200: projected memory floor.
- residency / process: 3 recorded repetitions; stop at N=150: projected memory floor.
- Peak median compile accepted-correct/s, thread: N=10, 5.39.
- Peak median compile accepted-correct/s, process: N=10, 7.27.

The P-15 latency comparison uses ten times the new N=1 median p95; the
P-17 full curve remains measured even after crossing that reference threshold.
thread: threshold 4005.76 ms; first measured crossing N=20.
process: threshold 4176.74 ms; first measured crossing N=32.

The 69 completed repetitions have 9823 reconciled, Python-revalidated durable
receipts, including warmups; 7375 timed correct completions include
5878 accepts. All completed job records carry the configured compiler cap.
Process cgroup delegation was unavailable. Both residency stops were projections;
no final-sweep repetition failed or was aborted. The summary records both stops.

| Sweep | load 1m before → after | MemFree GiB before → after | MemAvailable GiB before → after | visible other-heavy before → after |
|---|---|---|---|---|
| compile thread | 1.48 → 23.47 | 4.11 → 19.83 | 78.65 → 77.89 | 0 → 0 |
| compile process | 23.47 → 45.00 | 19.83 → 25.25 | 77.89 → 78.17 | 0 → 0 |
| residency thread | 45.00 → 16.24 | 25.25 → 28.73 | 78.17 → 70.37 | 0 → 0 |
| residency process | 16.24 → 80.09 | 28.73 → 51.66 | 70.37 → 70.58 | 0 → 0 |

Minimum retained memory sample: 26.23 GiB MemAvailable.
Supervisor snapshots consistently saw one external Codex process in this execution's PID namespace;
counts do not establish desktop-wide load. Full-suite checks overlapped early
N=1 preparation; they stalled at engine evaluation. Later points ran without
repository checks. Ascending widths and sequential modes retain load drift.

`make check` and `make isolate-test` passed. Final toolchain tests passed in both
modes, including cap enforcement, preserved maxima, receipt metadata, forged
candidate policy and replacement. Existing assertions/expected results were not edited.
Both full-suite attempts passed 18 core and 32 ledger tests, then stalled at the
engine stage: regular interrupted (130), optimized timed out (124). A synthetic
`spawnSync` diagnostic reproduced `EPERM` despite status 0 and child output.
Full-suite success is not claimed. See [verification](receipt/rerun-2026-11-02/verification.json)
and its logs. The real compiler smoke compiled a 57-byte identity kernel under
the guard and returned 7 for input 7.

These results establish compiler compatibility under an explicit bounded policy,
not causal speedup or production qualification. The full evaluator, repeated
frozen checks and durable Python ledger remain different from the old pipelines.
All earlier limits concerning synthetic residuals, sampled RSS, external WASM
memory, readiness upper bounds and a single shared host still apply.

## Addendum 2026-11-01: earliest baselines inside IsolatePool

The precommit amendment is in `PRECOMMIT.md`; its sha256 is f1376cdac284181c506ee156b1888d46cf6c7891316e42815d2df0db89a29028. The receipt is in `receipt/addendum-2026-11-01/summary.json`. The run used Node v22.23.3 on the main-rig 7950X (32 threads, Linux 7.2.8) under `flock /tmp/ef-bench.lock`. Load average was 0.7 at start and 2.9 at end, on a shared desktop. Three earlier invocations stopped in setup, before any timing was produced, because of harness bugs: the asc library path was used as the CLI, the frozen reference was empty, and jobs had no receipts. The harness was fixed and committed each time, and no numbers from those invocations exist.

| Probe | Original (date, host) | Addendum thread | Addendum process |
|---|---|---|---|
| P-01 V8 instantiate, stub 1 page, µs median / p95 | 18.6 / 34.8 (2026-10-14, Node 26.8.1, direct) | 47.9 / 91.7 | 48.5 / 93.9 |
| P-01 bytes per live instance (RSS), K=5,000 | 11,325 | 9,332–9,594 | 10,066–10,171 |
| P-02 `import` of asc in a fresh cell, ms | 359 host / 292 bwrap (2026-10-17) | 1,817–2,040 | 1,805–1,901 |
| P-02 clean kernel compile, ms median (p95) | 51.1 (71.3), passes 1–2 host | cold 45.1 (108.1), warm 41.4 (56.6) | cold 45.5 (80.3), warm 39.9 (42.2) |
| P-02 kernels compiled / 20 | 17 (3 type errors by design) | 17 | 17 |
| P-05 tsc-rs WASM in Node, 5 / 50 files, ms | 43.8 / 87.5 (2026-10-17) | blocked: cell terminated `limit` | blocked: `wasm_memory` |
| P-05 native tsc-rs `--singleThreaded`, 5 / 50 files, ms median (outside pool) | 19.8 / 56.6 | 15.8 / 36.0 (one series) | same |
| Ramp bwrap isofix checks/s at 1 / 4 / 8 / 16 / 32 / 48 | 28.8 / 106.1 / 200.5 / 280.0 / 324.4 / 282.3 (2026-10-29, direct) | 7.7 / 10.8 / 11.1 / 11.2 / 10.9 / 10.4 | 8.6 / 11.8 / 11.6 / 11.5 / 11.1 / 10.3 |
| Ramp in-cell check latency p50, ms | 35–164 | 40–43 | 34–35 |
| Ramp direct serial check p50, ms | 35 | 38.1 (20 checks) | same |

Observations:

- Instantiation inside a workcell was about 2.6× the original median, but the Node version and the load both differ.
- The asc cold import is about 5× slower in a workcell than in the original worker, while the steady compile time matches or improves.
- Pool throughput flattens at about 11 jobs/s from width 4 upward, while the in-cell check stays at about 35–43 ms. Each job's pool latency grows linearly with width, so the ceiling sits outside the cell. The per-job ledger prepare/append is serialized by the host. Throughput is about 25× below the direct 10-29 ramp at width 16–32.
- The P-05 tsc-rs module defines its own memory. The workcell guard terminated the cell in every rep, in both modes. Per the precommit, the guard was not weakened. Measuring this arm in the pool needs a supervisor trust entry (REQ-ISO-008) for that module.
- Wasmtime (P-01) and workerd (P-05) are not reproduced, by design. Their numbers are quoted above only from the originals. The cold tsc ramp was not repeated.

### What it does not show

- Cause. The Node version (26.8.1 vs 22.23.3), load, kernel and guard instrumentation all changed together.
- That the ~11 jobs/s ceiling comes from the ledger. That is inferred from latency growing with width, not isolated.
- P-05 WASM timings in the pool, because they are blocked.
- A quiet host, or variance beyond three pools per arm and one ramp per width.
