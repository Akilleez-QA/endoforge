# P-20 old probes vs new pool — precommit

Written 2026-11-01 before any P-20 measurement. This file is hashed in
`receipt/precommit.sha256` before setup, smoke checks, or timed repetitions.

## Question

How do the P-15/P-17 compile workload and P-16 precompiled workload behave through
`core/runtime/IsolatePool`, separately in thread and process mode, with the real
engine evaluator, five gates, frozen evaluator verification, and durable ledger?

## Workloads and settings

Reference sources are [P-15](../P-15-workcell-concurrency/worker.mjs), its
[kernels](../P-15-workcell-concurrency/kernels/manifest.json),
[P-16](../P-16-workerd-isolates/worker/workcell.js), and
[P-17](../P-17-workcell-gap/PRECOMMIT.md). Read kernel files by path, without
copying dependencies into the repository. Use P-15's setup.sh in an external
scratch mirror with symlinked source inputs; record setup failures and dependency
versions/digests. No network during measurement.

Same 22 candidates: k00-k19, --noAssert, -O3, runtime stub, initialMemory 1;
k05/k11/k17 must fail compilation; append the exact P-15 env.clock negative control
to k00/k01. Same signature, five cases (0, 1, 7.5, 250, 999), initState,
20 step events per case, convertUnit plus readChecksum, fresh WASM instance per
run, wallMs=1000, memoryBytes=1048576, fuel=1000, no allowed effects.

Compile arm: compile source once per evaluator attempt inside the workcell, not
on the supervisor. P-15 main widths 1,10,50 and P-17 widths
10,12,16,20,24,28,32,40,50 are combined into one ascending sweep
1,10,12,16,20,24,28,32,40,50; overlapping widths share observations.
Three fresh-pool repetitions per width, 15 s submission window. Record the
P-15 10x N=1 p95 threshold without suppressing the P-17 full curve. Separately,
P-15 residency widths 100,150,200, three fresh-pool repetitions, 5 s window.
P-15 did not cap JS/WASM memory; this arm uses 1024 MiB old generation,
16 MiB young generation, 4096 MiB per WASM memory to accommodate the compiler.

Precompiled arm: compile the same candidates once outside measurement, as in
P-16; compile locally checked WASM modules once per workcell, instantiate per run.
Widths 1,10,20,50, three fresh-pool repetitions, 15 s window. Heap settings
128 MiB old / 16 MiB young, WASM ceiling 64 MiB. Both arms add
--maximumMemory 16 to kernel compilation because the new pool refuses modules
without a declared maximum; actual initial memory and workload are unchanged.
No limit-breach arm: P-18 already addresses containment.

Use cores 0-27 for supervisor and inherited children. One sequential client loop
per logical lane, one candidate per pool.run, starting at lane index modulo 22.
No replacement evaluator, persistence hook, gate, or validation bypass. Compile
failures return a valid mismatching signature and are rejected by the real
interface gate (the engine has no compile gate); distinguish these three IDs
from other interface failures. Accepted candidates must pass both real evaluator
rounds, including residual and a constant cost objective. No extra invariants.
The residual confirms the fixed synthetic workload, not independent semantics.
These required additions make the full pipeline different from the old probes.

## Readiness, correctness, and evidence

Force all N lazy workers to exist with N blocked warmup jobs before timing.
Port-ready files identify distinct pid/thread cells, loaded compiler/modules,
used heap and RSS. Public pool APIs expose no spawn timestamp: report
submission-to-port-ready as a spawn-to-ready upper bound, explicitly including
serialized receipt preparation, process startup, import, and warmup queueing.
Also report all-ready time. Warmup evaluations and receipts are excluded from
throughput. Failure to prepare every cell stops that arm/mode.

Timed latency is pool.run submission through durable receipt return, including
queueing, both evaluator rounds, and ledger append. Accepted-correct/s counts
only completions whose report, expected first failure, and durable receipt match;
divide by elapsed time including drain after the deadline, like P-15.
Retain per-job latency/outcome/hash and memory samples. Verify complete durable
chains with Python Ledger.records after every rep and reconcile receipt counts;
no incorrect or unknown outcome counts as a success. Capture worker heap at
ready and after candidate checks; heap per cell is the maximum sampled used heap.
Thread RSS is shared process RSS: subtract supervisor baseline and divide by N.
Process RSS sums supervisor and direct children (including transient Python
validators), then subtracts baseline and divides by N. Sample every 200 ms;
report scope and avoid adding thread RSS N times. External scratch holds SQLite,
frozen bundles, WASM, ready files and full temporary artifacts. Sanitized raw
receipts and summary are copied to this requested experiment directory.

## Lock, load, stops, and reporting

Acquire exclusive `flock /tmp/ef-bench.lock` around every measurement invocation,
including smoke runs, with the harness enforcing lock ownership. Before/after
each arm/mode sweep and each repetition record UTC timestamp, loadavg,
MemFree/MemAvailable/MemTotal, and counts of other CPU-heavy processes (ps %CPU
>=20, excluding supervisor/descendants), plus Codex process count. Store only
counts, no process command lines. No quiet gate; report drift.

Stop an arm/mode on any wrong verdict, unknown result, chain error, failed
spawn/import, or insufficient available memory. Abort below 20% MemAvailable;
skip a projected width if prior per-cell peak RSS times N times 1.15 would
cross that floor. Readiness timeout 300 s, whole-repetition timeout 600 s.
A compiler rejected by the pool's WASM guard is a recorded compatibility blocker,
not permission to weaken the guard or move compilation outside that arm.
Continue independent arm/modes after a stop. No unrecorded tuning or retries.

Write receipt/summary.json, raw per-rep records and RESULT.md with old numbers
quoted from each old RESULT.md, one row per width, both modes, readiness and
memory metrics, load observations, failures, and "What it does not show".
No claims of causal speedup, quiet-host equivalence, or production qualification.

## Amendment 2026-11-01: earliest baselines (P-01, P-02, P-05, 2026-10-29 ramp)

Written before any addendum measurement, smoke run, or setup. The original
precommit digest is kept in `receipt/precommit-original.sha256`; this amended
file's digest replaces `receipt/precommit.sha256`. Nothing above is changed.

Question: how do the earliest timing probes compare when their workloads run
inside `IsolatePool` workcells, separately in thread and process mode?

Mapping. Each workload runs inside the workcell's `createPort` (harness
`addendum.mjs`, port `addendum-port.mjs`), writes its timings, then throws, so
the pool records `outcome_unknown` and the evaluator is not exercised. Old
sources are read by path from the old checkout and the 2026-10-29 load-test
directory, given by environment variables; nothing is copied in.

- P-01: P-01 `kernel.ts`, stub runtime, 1 initial page, plus `--maximumMemory 16`
  (the pool refuses undeclared maxima). Compile once, 50 untimed instances,
  2,000 timed `new WebAssembly.Instance`, then live K=100/1,000/5,000 with
  `initState(0)` and gc before/after; bytes per instance from RSS and
  arrayBuffers. Pool size 1, default limits. Three fresh pools per mode.
- P-02: cold `import` of AssemblyScript 0.28.20 inside a fresh workcell, then
  the 20 P-02 kernels compiled with P-02's flags plus the same memory flags;
  asc phase timers recorded. A second job in the same cell gives warm numbers.
  Limits 1024/16 MiB heap, 4096 MiB WASM, trusted f64-pow module as P-20.
  Three fresh pools per mode.
- P-05: the Node arm only (tsc-rs WASM `core.js` + `ts_rust.size.wasm` from the
  lab cache, lab `host.mjs` `runOnce`, indexed fs), 5-file and 50-file overlays
  from P-05's generator, 3 warm + 20 timed per project, cold then warm job,
  same limits as P-02, three fresh pools per mode. Native tsc-rs
  `--singleThreaded` re-run outside the pool, same projects on /dev/shm.
- 2026-10-29 ramp: the identical bwrap isofix unit-test command, launched from
  inside a workcell per job; pool width = parallel 1/4/8/16/32/48, width warmup
  jobs, then a 10 s closed loop. Report successful checks/s, pool latency and
  in-cell check latency p50/p95, failures. Also 20 direct serial checks.

Not reproduced, by design: Wasmtime (P-01) and workerd (P-05) arms, because
neither runtime is the pool under test; their old numbers are quoted only.
Cold tsc ramp is not repeated (no pool mapping). If a dependency is missing or
the pool's WASM guard refuses a module, record it as a blocker; do not weaken
the guard. No retries, no tuning. Hold `flock /tmp/ef-bench.lock` for every
invocation including smoke runs. Results go to `receipt/addendum-<date>/` and an
old-old vs new table with original dates in RESULT.md, with "What it does not
show". No causal or quiet-host claims.
