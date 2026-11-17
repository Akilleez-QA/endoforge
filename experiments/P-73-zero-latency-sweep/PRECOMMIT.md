# P-73 zero-latency stand-in sweep: which ceiling binds below the model: precommit

Label: **Proposed** procedure, frozen 2026-11-17 before any acceptance measurement. **No model calls and no spending.** Every model is a stand-in: an in-process scripted reply with a set delay (arm A), or the existing `fake-claude` test fixture spawned once per call (arm B). Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset, and each runnable asserts that at start. Arm B's `PATH` is the Node binary's directory plus `/usr/bin:/bin`, and its `HOME` is a synthetic test home (`subscribedHome`), so no real `claude` binary or login can be reached; the fixture's own log counts every spawn.

## Question

Models are today's ceiling (98.6% of a 22.3 s need, P-72 precommit), but "llm speed is only the bottleneck for now". If the model got 10×, 100× or infinitely faster, which ceiling below it binds first on this machine, how far is each non-model bucket from the physical floor of the hardware it runs on, and which of the platform levers 7–12 (captured graphs, residency, overlap, handles and in-process calls, contention tiers, context and memory tiers) pays most?

This is the "Decide" precommit from the GPU-platform study (critic's design), run on the reference machine below, with the owner's later additions: a width sweep to find the core-band knee, QoS band placement, a memory roofline (candidates/s per GB) and a tiered-memory sweep (RAM, compressed memory, swap) under hard safety caps.

## Reference machine (recorded in every receipt)

Mac mini, Apple M6, 12 cores in three bands (`hw.perflevel0` 2 Super, `perflevel1` 4 Performance, `perflevel2` 6 Efficiency), 16 GiB unified memory, Apple Fabric SSD with APFS, macOS (Darwin 27.0.0), Node v26.13.1, Python 3.15.2, SQLite 3.54.1. No cgroups and no bubblewrap on macOS, so the loop's process cells run without cgroup limits (`cgroup: unavailable`), and the ledger writer and cells share the whole machine. Power and energy are **unmeasured**: `powermetrics` needs sudo and is not run.

## Design under test

The agent loop on `origin/main` (`runNeed` with `ENDOFORGE_LOOP=agent`, `createLoopPool`, `waits: 'release'`, process cells, `maxTurns: 2`), with P-50's 21-kernel corpus. The corpus contracts gain the capability fence that main now requires (`withCapability` from the test fixtures); nothing else about the workload changes. Ledgers are written under the probe's output directory on the Apple Fabric SSD.

Stand-in model per turn: spec 15.5 s, impl 6.3 s at 1× (P-72's measured medians), multiplied by the scale. Scales 1 (today), 0.1 (10× faster), 0.01 (100×), 0 (zero latency). Fixed delays, no jitter.

- **Arm A**: `scriptedProvider` in process; the reply is the scripted spec or implementation, after the scaled delay.
- **Arm B**: the same, but each turn first runs `SpawnClaudeTransport` with `command` = `core/runtime/test/fixtures/x1/fake-claude.mjs` (`governor: null`), which spawns the fixture with the production arguments, writes the prompt to stdin, waits for its `init` and `result` lines and its exit. That is the real local spawn, init and stdio cost of a per-call `claude -p`, with no tokens. The delay follows.

## Buckets (per need, from independent host-side stamps)

Each need records: the provider's transport and delay intervals, every `pool.run` job (wrapped), every ledger bridge request (wrapped, with its action), the loop's `observe` events, and the cell-reported compile and gates times. Buckets are interval unions, each with the higher-priority buckets removed, in this order:

| Bucket | Interval |
|---|---|
| `spawnInit` | arm B transport (spawn, init, stdio, exit) |
| `model` | the stand-in delay |
| `freeze` | `admitting` → `admitted` (the admit ledger request, frozen-file checks) |
| `ledger` | every ledger request other than `admit` (park, commit, …) |
| `promote` | `committing` → `returned` minus ledger requests (the independent re-run at commit, evaluator load, decision) |
| `setup` | need start → `need` event (pool ready, ledger start) |
| `compile`, `gate` | cell-reported |
| `crossing` | time inside cell jobs not covered above, minus compile and gates: dispatch, host↔cell messages, cell bookkeeping, queueing for a cell at width |
| `unattributed` | wall − all of the above |

Reconciliation = |unattributed| / wall. Since `crossing` is a remainder inside jobs, the reconciliation tests what the host does *between* stamped intervals; a negative `crossing` (cell-reported time larger than the job) is reported as an inconsistency.

## Arms

All closed-loop: `width` needs in flight, each replaced as it finishes; steady window from `warmup` to `seconds`; only needs finishing inside the window count. Cells = min(width, 12) (the pool default is `availableParallelism()` = 12). The stage-rates view (P-62's rule V) is on in every row.

1. **`predict`**: arms A and B × scales 1, 0.1, 0.01, 0 × widths 1 and 64. Width 1: 150/25 s at 1×, 45/8 s at 10×, 25/5 s otherwise. Width 64: 110/35, 45/10, 25/6 s.
2. **`sweep`** (core-band knee): arms A and B at scale 0, widths 1, 2, 4, 6, 8, 12, 24, 64, 25/6 s each.
3. **`qos`** (band placement), arm A, scale 0, width 12, two repetitions each, interleaved: `default` (macOS places everything), `cells-utility` (cells at throughput and latency tier 2 with `taskpolicy -t 2 -l 2 -p`: the band-aware placement, orchestrator and writer left at the top class), `cells-background` (`taskpolicy -b`, cells confined to the Efficiency band), `writer-background` (inverse control). **`qos-clamp`**: the whole tree launched under `taskpolicy -c utility` and under `taskpolicy -c background` (Efficiency band only), two repetitions each. No "user-interactive" class can be granted from the command line; the top class reachable is the default one, so "latency-critical at the top class" means leaving the parent and writer unclamped.
4. **`isolation`**: arm A, scale 0, process against thread cells at widths 12 and 24.
5. **Memory composition**: a child Node process's RSS, heap, external and array-buffer bytes bare, after importing the toolchain, after one compile and after 21; then one fresh process per pool shape (process and thread cells, sizes 1, 4, 12) giving per-cell RSS after 8 s of passing work and candidates/s per GB.
6. **Tiered memory**: a hot pool of 12 process cells doing zero-latency work for 15 s, measured with 0 ballast and then after each added idle ballast pool of 6 process cells (each warmed with one passing need per cell, then idle 20 s). Recorded per step: hot throughput and p95 need wall, tree RSS, `vm_stat` free, compressor and swap counters, `vm.swapusage`, `kern.memorystatus_vm_pressure_level`, free disk. After the last step and 60 s idle, page-in: one need per ballast cell (cold) then again (warm), with swap-in and decompression counts. Then each ballast pool runs 6 s of its own work, everything closes, and swap use is sampled six times over 60 s.
7. **Floors** (`floors.mjs`, `floors.py`), the limit of physics per bucket on this machine: `/usr/bin/true` spawn to exit; Node spawn to first stdout byte; `fake-claude` spawn to init, result and exit; a persistent child's stdio JSON round trip; `worker_threads` `postMessage` round trip; `SharedArrayBuffer` + `Atomics` handoff round trip; `postMessage` copy and transfer at 1 KiB–16 MiB; `v8.serialize`/`deserialize` and JSON round trip per KiB; binaryen's 8.9 MB tooling WASM compiled per worker against one compiled `WebAssembly.Module` shared to 8 workers (time and RSS); `fsync`, `F_BARRIERFSYNC` and `F_FULLFSYNC` latency at 4 KiB and 1 MiB; SQLite commit latency and rows/s for rollback-journal (the ledger's mode, `synchronous=FULL`) and WAL, each with `fullfsync` off and on, at 1, 4, 16, 64 and 256 rows per commit.

## Predictions (from the ledger's precommit, unchanged)

- Arm A, width 1: non-model share ≈ 1.2%, 11% and 55% at 1×, 10× and 100×.
- Arm B, 100×: non-model share ≥ 70%.
- Width 64: binds on the model (population) at 1× and 10×; at 100× on the ledger (arm A) or spawn or cell (arm B).
- Core-band knee near width 6 (work spilling from the Super and Performance bands onto Efficiency).

Pilot-informed expectation, recorded separately and **not** a replacement for the predictions above: the pilot (disclosed below) measured about 85 ms of non-model time per need at width 1 on this machine, not the 0.27 s the ledger's table assumed, which would put arm A at about 0.4%, 3.8% and 28%, and arm B (about 48 ms more) at about 38% at 100×. The predictions are judged as written.

## Oracle and bars

1. **Stage-rates verdict** per row (P-62 rule V), reported with the stage it names.
2. **Little's Law**: |L − λW| / L ≤ 10% per row, L = width, λ = completions/s, W = mean need wall in the window.
3. **Bucket reconciliation**: ≤ 5% per row. Between 5% and 10%: reported as a missing bucket. Over 10%: stop rule below, reported as a finding.
4. **Correctness**: every need's promotion matches the corpus's expected outcome (P-50 marks sibling kernels as expected refusals); a mismatch is reported, not retuned.

Headroom per bucket = observed (median per need, at width 1, scale 0) ÷ the floor for the same physical operation. Levers 7–12 are ranked by measured payoff: the time per need (width 1) and the throughput (width 64, scale 0.01 and 0) that each removes if it brought its buckets down to their floors.

## Stop rules

- Any real model call attempted (any spawn that is not the fixture, any credential variable set): stop, report.
- 1-minute load above 16: no row starts above it; a row whose start or end load is above 16 is rerun once, then the plan stops.
- Bucket reconciliation off by more than 10%: the row is kept and reported as a finding; three such rows in a plan stop it.
- More than one day in total.
- Tiered memory, hard caps: stop growing as soon as the pressure level is critical (4) or swap use exceeds 8 GiB or free disk falls below 20 GB. No system setting (swap, sysctl) is changed; only observed. The pool is shrunk and freed at the end and swap use is sampled to confirm it falls. Swap was already at about 4.4 GiB used before this probe, so the cap leaves about 3.6 GiB of headroom; that is recorded, not worked around.

## Pilot disclosure

Before this file, on this machine: a 6-need smoke run found that P-50's corpus no longer passes main's specification check (no capability fence; every need stopped at `max_turns`), fixed by `withCapability`. Pilot rows (12 s, not acceptance): arm A width 1 scale 0, 11.7 needs/s, 85 ms per need; arm B width 1 scale 0, 8.0/s, 121 ms (spawn+init 48 ms); arm A width 12 scale 0, 42/s, verdict `ledger (saturated)`; arm B width 12 scale 0.01, 24/s, `model (population)`. Reconciliation 0.1–0.3%, Little ≤ 3.2%. A floors pilot and a memory-composition pilot ran to check the scripts; their numbers are not used. Pilot receipts are not committed.

## What a miss means

- Non-model share far below prediction: the ledger's 0.27 s non-model figure came from a different rig and real model streams; on this machine the stub need is cheaper, and the 100× crossover sits further out.
- A verdict other than predicted at 100× width 64: that stage is the next ceiling.
- No knee near 6: the macOS scheduler doesn't separate the bands for this load, or another roof (the single ledger writer) binds first.
- Band-aware placement not beating default: macOS already places the load well; QoS is not a lever here.
- Reconciliation over 5%: a cost the buckets don't see.

## Limits known now

Stand-in models; synthetic kernels; one machine shared with the owner's desktop session and other lanes; macOS has no hard CPU affinity, so band placement is by QoS hint only; no cgroups; the fixture is a small Node script, so arm B's spawn cost is a lower bound on a real `claude -p` start (P-64 measured 285 ms spawn→init there); CPU per candidate counts live descendants only (arm B's short-lived fixture children are reaped and missed); RSS is the macOS `ps` resident size, which counts shared pages in each process.
