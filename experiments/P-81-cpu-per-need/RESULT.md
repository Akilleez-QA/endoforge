# P-81 cpu-per-need: a retiring cell's successor warms as a standby, with one primer round instead of eight, on top of P-78: result

Status: **failed** (keep bar missed at width 64; the lever is reverted on the branch), 2026-11-17, reference machine (Apple M6 Mac mini, 12 cores: 2 Super, 4 Performance, 6 Efficiency; 16 GiB; Node v26.13.1; Python 3.15.2). Stand-in model only (arm A, zero latency): **no model calls, no tokens**, credential variables asserted unset. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed and pushed (4ed1bc4) before any measurement of the lever.

- Lever measured: 6af4a68 (pushed before the acceptance rows; every P-81 receipt names it). Reverted in the next commit; the branch's product code is P-78's (8f63101).
- After the measurement, the branch merged `climb-r5-cell-cpu` at 48cd38f (the CI fixes for P-76 to P-78: the shard fail-closed fix, lint, and the byte-identity pin run as a workcell starts). Every row here measured P-78 at 8f63101 against the lever at 6af4a68.
- Receipts: `receipt/explore-p78/` (the profile), `receipt/accept-p78/` and `receipt/accept-p81/` (`row-{w64,w1}-{0..3}.json`), `receipt/summary.json` (`summarize.py`), `receipt/stream.json` (`stream.py`) with the capture rows in `receipt/guard-p78/` and `receipt/guard-p81/`, `receipt/tests-p78.json`, `receipt/tests-p81.json` and `receipt/reruns.json`.

**Width-64 throughput rose 3.1%** (75.9 → 78.2 needs/s, Welch t = 2.06, df ≈ 5.1, **p ≈ 0.093**), against a predicted +4% to +12% and a bar of p < 0.05 and at least +3%. Needs/s per GB fell 1.7% (16.07 → 15.80), which also misses the bar. The lever is not kept.

**Width 1 fell 9.3%** (66.4 → 60.2 ms per need, t = −14.4, p ≈ 0.0001), inside the predicted −3% to −10%. `crossing` fell from 9.9 to 4.3 ms, which is P-78's no-replacement value (4.1 ms). Width-1 CPU per need fell 11% (82.1 → 73.4 ms). The successor did what it was built to do. At width 64 it bought little, because the CPU it cut was small and the cell slots there are held by `admit`, not by warming cells.

## Profile first (exploratory, P-78 code; `receipt/explore-p78/`)

Width-64 `diag` rows, one per process, each started at load ≤ 4:

| Row | needs/s | Cell CPU per need | All CPU per need | Cores | Cell starts in window |
|---|---|---|---|---|---|
| as shipped (2 rows) | 73.4, 74.3 | 106.9, 107.2 ms | 129.7, 129.9 ms | 9.5, 9.7 | 14, 17 |
| retirement off (diagnostic only, 2 rows) | 86.0, 85.8 | 85.7, 81.6 ms | 107.4, 103.3 ms | 9.2, 8.9 | 0 |
| `primes` 1 (2 rows) | 76.5, 75.3 | 101.2, 105.3 ms | 123.5, 127.8 ms | 9.4, 9.6 | 15, 14 |
| `primes` 0 (1 row) | 77.4 | 102.1 ms | 121.7 ms | 9.4 | 14 |

- **Replacement is still the largest removable item:** 22 ms of cell CPU per need (21%) at width 64, and +16% needs/s with retirement off. That is about 2 CPU-s per replacement under load (about 95 needs per replacement).
- **Where a replacement's CPU goes.** `curve.mjs` runs one process on an idle machine and counts process CPU across all threads (`curve.txt`):
  - process start and imports: about 40 ms;
  - loading the compiler: 235 ms;
  - the eight primer rounds: 660 ms (283 ms for the first, then 40–90 ms each);
  - the first real kernels are still cold: 459, 209, 106, 82 and 57 ms, against about 45–60 ms steady.
- **Rounds 2–8 of the primer are wasted work.** Over 24 real kernels after the primers, the whole run cost 2,320 ms with eight primers, 2,126 ms with one and 2,072 ms with none.
- **What does not help** (measured, not pursued):
  - Node's compile cache saves 35 ms of the compiler load and nothing of the first round. It holds code compiled before execution, not lazily compiled functions.
  - A compiled `WebAssembly.Module` cannot cross a process boundary in Node: `v8.serialize` writes a 2-byte transfer stub. So the map's L2 stays unavailable for process cells.
  - V8 flags: `--single-threaded-gc` cuts compile CPU 5–9% but raises its wall about 30%. `--no-turbofan`, `--no-maglev`, `--no-wasm-tier-up`, `--min-semi-space-size=32` and `--v8-pool-size` are neutral or worse.
  - About half of a compile round's CPU runs off the main thread (80 kernels: about 4.0 CPU-s for 1.9 s wall): GC helpers and V8's background compilers.

## Lever (measured, then reverted)

One commit, 6af4a68: +46 −15 lines, of which product code is +24 −6.
- `core/runtime/isolate-pool.mjs`: a cell within 32 jobs of `retireAfterJobs` starts its successor as a standby. There is one standby at a time, and a standby takes no job. When the cell retires, the standby takes its slot at once, and the retiring cell exits without spawning another. A standby that exits first is not respawned. `stats.standby` reports the count.
- `core/runtime/x1/loop-port.mjs`: `warm`'s default `primes` went from 8 to 1.
- The test `the successor of a retiring cell warms as a standby, ...` in `isolate-flags.test.mjs` passed, traced under REQ-ISO-016, with `isolate-pool.test.mjs`'s `stats` shape updated. Docs were updated in `workcells.md` and `configuration-reference.md`. All of this is reverted with the lever.
- **Deviation from the precommit:** the precommit said "at most `size` + 1 processes". The first build started a successor for every cell at its 224th job, and with `size` 2 the test saw four processes at once, because cells that start together retire together. The measured build allows one standby at a time, so a cell that reaches its lead point while another standby exists is replaced as before. A retiring cell that has not exited yet can still sit beside the standby for up to its exit grace.

## Predictions against measurement (4 + 4, interleaved, one row per host process, each row started at load ≤ 4, no re-runs)

| Quantity | P-78 | P-81 | Predicted | Verdict |
|---|---|---|---|---|
| needs/s, width 64 | 74.02, 74.38, 77.64, 77.39 (**75.9**) | 77.46, 77.82, 80.05, 77.53 (**78.2**) | +4% to +12% (bar p < 0.05, ≥ +3%) | **failed** (+3.1%, t = 2.06, p ≈ 0.093) |
| Cell CPU per need, width 64 | 105.1 ms | 103.6 ms | −2% to −8% | **missed** (−1.4%) |
| All CPU per need, width 64 (host + cells + writers) | 127.6 ms | 125.4 ms | — | −1.7% |
| Cores by role, width 64 | 9.68 | 9.81 | may rise | +0.13 |
| Cell starts per window, width 64 | 12–18 | 18–19 | — | — |
| Cell net / gross utilisation, width 64 | 0.657 / 0.998 | 0.647 / 0.999 | — | unchanged: the slots are held by `admit`, not by warming cells |
| Cell queue wait, width 64 | 191 ms | 184 ms | — | −4% |
| Ledger writers, width 64 | 0.83–0.91 (0.873) | 0.88–0.93 (0.914) | — | `ledger (saturated)` in every row of both arms |
| Wall per need, width 1 | 67.5, 66.2, 66.3, 65.6 (**66.4 ms**) | 60.1, 60.6, 60.3, 59.8 (**60.2 ms**) | −3% to −10% (bar ≤ +3%) | **met** (−9.3%, t = −14.4, p ≈ 0.0001) |
| `crossing` per need, width 1 | 9.9 ms | 4.3 ms | toward 4.1 ms | met: at P-78's no-replacement value |
| CPU per need, width 1 (cells) | 82.1 ms (68.4) | 73.4 ms (59.6) | — | −11% (−13%) |
| Tree RSS / needs/s per GB, width 64 | 4.75 GB / 16.07 | 4.98 GB / 15.80 | per GB must not fall | **missed** (−1.7%; sampled peak 5.12 → 5.63 GB) |

**Why width 64 barely moved.** The P-78 arm runs 9.7 of 12 cores, so its CPU does not bind. P-80's 10.6 cores were measured on P-80's lever arm, with the cells released during `admit`. On P-78, cells are 0.998 busy but do work only 0.66 of the time. About 48 ms per need is held on `admit` (P-79/P-80), and the four writers are saturated (0.87–0.91).
- A warm successor returns the slot time of a warming cell, but that slot goes straight back into the `admit` wait.
- At width 64 the primer cut saves about 1.5 ms of cell CPU per need: 18 starts per window × about 0.2 CPU-s, spread over about 1,470 needs.
- The retirement-off ceiling (86/s) is set by the full replacement cost: about 2 CPU-s each, mostly cold JIT on the first real jobs and the compiler load. This lever cut only about 0.2 s of that and moved the rest off the slot path.

## Correctness guard

- **Rows:** every row on both arms has `wrongVerdicts` = 0 and `errors` = 0. Both arms show the same two outcome classes, `true/true/passed/-` and `false/false/failed/-`, at 14.1–14.3% failed in every row.
- **Request stream** (`stream.py`, width-1 capture rows, `stream.json`): for the 189 needs both rows completed, all 189 `admit`, 216 `park` and 189 `commit` requests are identical across arms, with 0 differing. `admit` and `park` are compared byte for byte after the row directory and the `loop-port.mjs` digest are mapped. That file is one of the 14 frozen implementation files, and the primer default lives in it. `commit` is compared after timing fields are also dropped.
- **`make -k test`**, one command per file on both arms with `--test-timeout=120000` under a 600 s alarm, `isolate-host-call.test.mjs` excluded on both (it hangs on macOS): 42 failing commands on each arm, the same commands, and the same 118 named failing tests. **No new failure.** All are pre-existing (among them `loop-agent`, `loop-count`, `loop-review`, `isolate-pool`'s bridge-death and prewarm cases, `isolate-limits`, `tscheck` and the gap targets). The new successor test and the guard's rewrite pin (`isolate-wasm-rewrite.test.mjs`) passed on the lever.
- **`loop-crash.test.mjs`** run 4 times on each arm (`reruns.json`): the random-kill case failed 1 of 4 on each arm, the same flake as P-80.
- `make check` passed on the lever and passes on the final commit.
- Not changed by the lever, nor by this round: `retireAfterJobs` (256) and REQ-ISO-016 (no cell ran more than 256 jobs; a standby ran none before taking its slot), process isolation and the permission flags, the guard, the gates, the freeze rule, the frozen record, the rows, durability, and P-75 to P-78's levers.

## Floors against observed (zero latency; this round's P-78 arm)

Width 1, per need (P-78 wall 66.4 ms; the lever's 60.2 ms in brackets):

| Bucket | Share of wall | P-78 | Physical floor | Distance |
|---|---|---|---|---|
| `compile` | 38% | 25.4 ms (24.8) | not measured (AssemblyScript `-O3` through binaryen; about half its CPU off the main thread) | **unknown** |
| `crossing` | 15% | 9.9 ms (4.3) | 0.06 ms of IPC; 4.1 ms with no cell replacements (P-78) | **~165×** IPC; 2.4× no-replacement (lever: 1.05×) |
| `ledger` + `freeze` | 30% | 20.0 ms | about 11 ms (3.14 requests × 3.5 ms unbatched `F_FULLFSYNC`, P-79) | **1.8×** |
| `gate` + `promote` | 16% | 10.7 ms | not measured | **unknown** |

Width 64, throughput resources:

| Resource | P-78 | P-81 (lever) | Floor | Distance |
|---|---|---|---|---|
| Cell slots | gross 0.998, net 0.66; about 48 ms per need held on `admit` | gross 0.999, net 0.65 | — | **binding** |
| Ledger writers | 0.87 of 4, saturated | 0.91 of 4, saturated | 11.4 ms CPU per need (replay, P-79) against 15.0 ms | 1.3× CPU; latency-bound |
| Machine CPU | 9.7 cores, 128 ms per need | 9.8 cores, 125 ms per need | 82 ms per need (width-1 CPU per need, this P-78 arm) | 1.55× |
| Cell CPU per need | 105 ms | 104 ms | 84 ms (retirement off, diagnostic) / 68 ms (width 1) | 1.25× / 1.55× |

**Stop rule not met.** `compile` and `gate` + `promote` have no measured floor, and `crossing` is 2.4× its no-replacement value on P-78.

## Next binding ceiling and levers

1. **The cell slots, through `admit` latency, with the writers saturated.** Neither this round's lever nor P-80's passed alone: P-80 was +3.8% (p ≈ 0.058) and became CPU-bound, and P-81 was +3.1% (p ≈ 0.093). They act on different holds of the same slot (admit, and warming). One candidate is a single round that measures both together against P-78 under a new precommit, with P-81's width-1 gain (−9%) as a stated secondary outcome. Another is to cut `admit` work on the writers (P-79's exact dedup, about −17% writer CPU), since the writers run saturated in every row of both arms here.
2. **The replacement's remaining cost** (about 2 CPU-s each at width 64; 22 ms of cell CPU per need): mostly cold JIT on the first real jobs plus the compiler load. No cross-process cache in Node holds optimized JS or WebAssembly code. What is left is structural: fewer replacements, which needs an owner decision on REQ-ISO-016's interval; or a lighter cell start, such as a V8 startup snapshot of the loaded compiler JS (JS only; WebAssembly cannot be snapshotted).
3. **Measure the `compile` floor** (a warm `asc.main` on the corpus kernels in one process) so the stop rule can be decided. About half of compile CPU runs off the main thread (GC helpers, background compilers), which is why `--single-threaded-gc` saves CPU but costs wall.

## Code delta

- **Product:** none net. The lever (+24 −6 lines of product code, plus a 22-line test, a one-line test update, a trace entry and doc lines) was committed, measured and reverted.
- **Experiment tools:**
  - `curve.mjs`: CPU and wall per compile round from a fresh process;
  - `diagtab.py`: tabulates the `diag` rows;
  - `run.mjs` is P-80's plus a `primes=` option on the exploratory `diag` plan. Both arms ran it, the P-78 arm from an uncommitted copy in its own tree;
  - `summarize.py` and `stream.py` are P-80's, with the arm names and the lever's `loop-port.mjs` digest changed.

## Receipts and how to reproduce

- `run.mjs <out> <stamp> row <w64|w1> <rep>`: one acceptance row. `run.mjs <out> explore diag 64 <tag> [retire=N] [primes=N]`: an exploratory row. `run.mjs <out> <stamp> capture1`: a width-1 capture row.
- `node curve.mjs <tree> 0 p8,k24` gives per-round CPU and wall (primer rounds, then P-15 kernels). Pass V8 flags before the script.
- `summarize.py` builds the acceptance table with Welch t and p. `stream.py <capture P-78> <capture P-81>` compares the request streams.

