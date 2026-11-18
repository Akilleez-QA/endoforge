# P-81 cpu-per-need: a retiring cell's successor warms before it is needed, with one primer round instead of eight, on top of P-78: precommit

Label: **Proposed** procedure, frozen 2026-11-17 before any measurement of the lever. Round 8 of the climb loop: the objective is plumbing speed, with correctness as a light guard. **No model calls and no spending.** The model is P-73's in-process stand-in (arm A) at zero latency. Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset, and the harness asserts that at start.

This round stacks on P-78 (draft PR #180, kept, branch `climb-r5-cell-cpu`, 8f63101), the last kept round. P-79 (#181) and P-80 (#182) failed and were reverted, so neither is in either arm. The owner chose the direction: cut CPU per need.

## Question

P-80 found the machine's CPU binding once cells stop waiting: about 135 ms of CPU per need at width 64, cell CPU per need 1.6–1.7× its width-1 value, and about 1 CPU-s per replacement cell (REQ-ISO-016 retires a cell after 256 jobs; that stays). Where does the cell CPU at width 64 go now, and which lever cuts the most of it?

## Profile first (exploratory, P-78 code, `receipt/explore-p78/`)

Width-64 `diag` rows, one per process, each started at load ≤ 4:

| Row | needs/s | Cell CPU per need | All CPU per need | Cores | Cell starts in window |
|---|---|---|---|---|---|
| as shipped (2 rows) | 73.4, 74.3 | 106.9, 107.2 ms | 129.7, 129.9 ms | 9.5, 9.7 | 14, 17 |
| retirement off (diagnostic only, 2 rows) | 86.0, 85.8 | 85.7, 81.6 ms | 107.4, 103.3 ms | 9.2, 8.9 | 0 |
| `primes` 1 (2 rows) | 76.5, 75.3 | 101.2, 105.3 ms | 123.5, 127.8 ms | 9.4, 9.6 | 15, 14 |
| `primes` 0 (1 row) | 77.4 | 102.1 ms | 121.7 ms | 9.4 | 14 |

- **Replacement is still the largest removable item:** 22 ms of cell CPU per need (21%) and +16% needs/s with retirement off. With about 95 needs per replacement, that is about 2 CPU-s per replacement under load.
- **Where a replacement's CPU goes** (`curve.mjs`, one process, idle machine, process CPU across all threads; `curve.txt`): process start and imports about 40 ms; loading the compiler 235 ms; the eight primer rounds 660 ms (283 ms for the first, then 40–90 ms each); then the first real kernels are still cold (459, 209, 106, 82, 57 ms against about 45–60 ms steady).
- **Most of the eight primer rounds are wasted work.** Over 24 real kernels after the primers, eight primers cost 2,320 ms in all, one primer 2,126 ms and none 2,072 ms. Rounds 2–8 cost about 380 ms and save the later kernels only about 165 ms. The trivial primer kernel warms the compiler's generic paths once; repeating it does not warm the paths real kernels take.
- **What does not help** (measured, not pursued):
  - Node's compile cache (`module.enableCompileCache`) saves 35 ms of the compiler load and nothing of the first round, because the cache holds code compiled before execution, not the lazily compiled functions.
  - The compiled WebAssembly module cannot cross a process boundary in Node (`v8.serialize` writes a 2-byte transfer stub), so the map's L2 (compile once, instantiate per cell) stays unavailable for process cells, as P-78 found.
  - V8 flags: `--single-threaded-gc` cuts compile CPU about 5–9% but raises its wall about 30%, which would break the width-1 bar. `--no-turbofan`, `--no-maglev`, `--no-wasm-tier-up`, `--min-semi-space-size=32` and `--v8-pool-size` are neutral or worse.
- **The slot side:** a replacement takes a job straight from the queue and holds it while it warms (P-78: width-1 `crossing` 9.6 ms against 4.1 ms with no replacements). At width 64 the cells are 0.998 busy but do work only 0.64 of the time (P-80).

## Choosing the lever

| Lever | Mechanism | Prediction at width 64 |
|---|---|---|
| (1) pre-warm the successor | no job waits on a warming cell; moves CPU, cuts none | the slot share of the +16% retirement-off ceiling, about +3% to +8%, only if CPU does not bind (base runs 9.5 of 12 cores) |
| (2) code cache, compile cache or a shared module | 35 ms per replacement (compile cache); a shared module is not possible across processes | under +0.5% |
| (3) less work per cell start | one primer round instead of eight: about 380 ms of start CPU, net about 200 ms per replacement idle | measured +2% to +4%, −4 ms cell CPU per need |
| (3) less GC CPU per job | `--single-threaded-gc` | breaks the width-1 bar |

No measured CPU cut is large on its own, so this round pairs (1) with (3), as the round's brief allows: the successor warms off the critical path, and it warms with one primer round, so the move is cheaper than today's in-path warm-up. One lever, one commit: "a replacement costs less and nobody waits for it".

## Lever (one commit)

1. **The successor starts before its predecessor retires** (`core/runtime/isolate-pool.mjs`). When a cell finishes a job with 32 jobs left before `retireAfterJobs`, the pool spawns its successor as a standby. A standby takes no job. When the predecessor retires, its standby takes its slot at once, already warm if its start has finished. The predecessor exits without spawning another cell. If a standby exits before its predecessor retires, it is not respawned and the predecessor falls back to today's replacement. Pools whose `retireAfterJobs` is 32 or less behave exactly as today. The count is a constant, not an option: no new knob.
2. **One primer round** (`core/runtime/x1/loop-port.mjs`): `warm`'s default `primes` goes from 8 to 1. The option stays, since tests already pass `primes: 1` or 0. Docs: `docs/architecture/workcells.md`, `docs/configuration/configuration-reference.md`.

Ship the check: a test in `core/runtime/test/isolate-flags.test.mjs`, traced under REQ-ISO-016: with `retireAfterJobs` above 32, a cell is still replaced after its allowance; its successor's process exists before the predecessor exits; no job lands on a standby; no job is lost; and the pool never runs more than `size` + 1 processes.

Not changed: `retireAfterJobs` (256) and REQ-ISO-016's retirement between jobs (a cell still never runs more than 256 jobs, and a standby never runs one before it takes the slot), process isolation and the permission flags, the guard, the gates, the freeze rule, the frozen record, the rows, durability, and P-75 to P-78's levers.

## Predictions (P-78 arm = `climb-r5-cell-cpu` at 8f63101; P-81 arm = this branch)

- Throughput at width 64: **+4% to +12%** (P-78: 73–78 needs/s; the retirement-off diagnostic, 86/s, bounds it).
- Cell CPU per need at width 64: **−2% to −8%** (one primer round instead of eight).
- Machine cores at width 64: may rise (CPU moves off the slot path).
- Wall per need at width 1: **−3% to −10%** (`crossing` falls toward its 4.1 ms no-replacement value).
- Tree RSS at width 64 may rise by up to one cell in twelve (a standby lives for at most 32 of every 256 jobs per cell); needs/s per GB must not fall.
- Correctness: identical outcome classes and proportions, 0 wrong verdicts, 0 errors.

## Oracle and keep bar

- Keep only if width-64 needs/s rises with **Welch p < 0.05** over 4 + 4 interleaved rows (and by at least +3%), width 1 is not worse than +3% wall, and needs/s per GB does not fall.
- Correctness:
  - `wrongVerdicts` = 0 and `errors` = 0 on every row, and the same outcome classes on both arms;
  - **request stream**: a width-1 capture row on each arm (`capture1`, P-80's `stream.py`). For the needs both rows completed, every `admit`, `park` and `commit` request is identical across arms after the substitutions P-80 used (the row's temporary directory; wall-time fields, cell pids and the evaluator digest in `commit`). `loop-port.mjs` is one of the 14 frozen implementation files, so its digest, and the frozen identity derived from the record, differ by construction and are mapped;
  - the new test passes, and the guard's rewrite test (`isolate-wasm-rewrite.test.mjs`) still passes;
  - `make check` passes;
  - `make -k test`, one command per file on both arms, excluding `isolate-host-call.test.mjs` (it hangs on macOS), shows no failure on P-81 that P-78 doesn't have;
  - `core/runtime/test/loop-crash.test.mjs` run 4 times on each arm: no more failures on P-81 than on P-78.

## Procedure

- Same harness as P-80 (`run.mjs`, copied; the only addition is a `primes=` option on the exploratory `diag` plan, which acceptance rows do not use), reference machine (Apple M6, 12 cores: 2 Super, 4 Performance, 6 Efficiency; 16 GiB; Node v26.13.1; Python 3.15.2). The P-78 arm runs the same `run.mjs` from its own tree.
- `run.mjs <out> <stamp> row <w64|w1> <rep>`, reps 0–3, order per rep: w64 P-78, w64 P-81, w1 P-78, w1 P-81. One row per process; a row waits for load ≤ 4 (up to 10 minutes) and re-runs at once if it ends above 16.
- Safety caps: stop if load stays above 16, memory pressure is critical, swap exceeds 7 GB (the machine starts this round at 4.6–5.4 GB of swap) or free disk falls below 20 GB.
- If the lever is kept and there is headroom, P-80's admit release may be re-measured on top as a separate follow-up with its own precommit. It is not stacked here.

## Stop and rollback

- If the request stream differs, or any row has a wrong verdict or error: stop, revert.
- If `loop-crash.test.mjs` fails more often on P-81 than on P-78: record `failed_with_test_concern` and revert unless the failure is shown unrelated.
- If the keep bar fails: record `failed` in RESULT.md and the PR, and revert the lever on the branch.
