# P-80 admit-release: the freeze releases the cell, as a model wait already does, on top of P-78: result

Status: **failed** (keep bar missed; the lever is reverted on the branch), 2026-11-17, reference machine (Apple M6 Mac mini, 12 cores: 2 Super, 4 Performance, 6 Efficiency; 16 GiB; Node v26.13.1; Python 3.15.2). Stand-in model only (arm A, zero latency): **no model calls, no tokens**, credential variables asserted unset. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed and pushed (83bae64) before any measurement of the lever.

- Lever measured: 10c0cac (pushed before the acceptance rows; every P-80 receipt names it). Reverted in the next commit; the branch's product code is P-78's (8f63101).
- Receipts: `receipt/accept-p78/` and `receipt/accept-p80/` (`row-{w64,w1}-{0..3}.json`), `receipt/summary.json` (`summarize.py`), `receipt/stream.json` (`stream.py`) with the capture rows in `receipt/guard-p78/` and `receipt/guard-p80/`, `receipt/tests-p78.json` and `receipt/tests-p80.json`, `receipt/reruns.json`.

**Width-64 throughput rose 3.8%** (76.2 → 79.1 needs/s, Welch t = 2.7, df ≈ 3.8, **p ≈ 0.058**), against a predicted +5% to +15% and a bar of ≥ +3% with p < 0.05. The effect clears the size bar but not the significance bar, and is below the predicted range, so the lever is not kept. The mechanism worked as designed: the cells stopped waiting on `admit`. What it bought was swallowed by the next ceiling, the machine's CPU.

## Why lever (1) over lever (2)

Stated in the precommit before measuring: releasing the cell returns about 48 ms per need of blocked cell-slot time (predicted +5% to +15%), while exact dedup of `admit` frees about 2.5 ms of writer CPU per need on writers that are latency-bound, not CPU-bound (predicted +0% to +3%). No exploratory row of the lever was run before the precommit.

## Lever (measured, then reverted)

`core/runtime/x1/loop-port.mjs` and `core/runtime/x1/loop.mjs`, +43 −37 lines in product code (most of it the admit handling moved into one function), +11 lines of test:
- Under `waits: 'release'`, the cell's specification stage ended its job with the admit request beside its continuation, instead of a host call that held the cell.
- The host froze with the same function that answers the `hold` path's host call (`freeze`, moved out of `answerKind`), parked the continuation, ran the next model turn, and the next job rechecked the admission through the existing resume checks (`admitted()`).
- The `admitted` kill point moved to the first job after the freeze, so the crash tests at that stage still run.
- The new test `the freeze holds no cell under release, and holds it under hold` passed on the lever and failed on P-78 (`[1, 1]` busy cells at `admitting`/`admitted` where the lever shows `[0, 0]`). It is reverted with the lever.

## Predictions against measurement (4 + 4, interleaved, one row per host process, each row started at load ≤ 4)

| Quantity | P-78 | P-80 | Predicted | Verdict |
|---|---|---|---|---|
| needs/s, width 64 | 73.37, 78.09, 77.02, 76.30 (**76.2**) | 78.15, 79.91, 79.08, 79.21 (**79.1**) | +5% to +15% (bar ≥ +3%, p < 0.05) | **failed** (+3.8%, p ≈ 0.058) |
| Cell net / gross utilisation, width 64 | 0.64 / 0.998 | 0.96 / 0.96 | net within 0.10 of gross | met |
| Cell queue wait, width 64 | 190 ms | 126 ms | — | −34% |
| Machine CPU by role, width 64 | 9.7 cores | 10.6 cores | rises toward 12 | rose; binds |
| CPU per need, width 64 (host + cells + writers) | 127 ms (cells 105) | 135 ms (cells 111) | — | +6%: contention |
| `freeze` per need, width 64 | 56 ms | 111 ms | may rise up to +30% | exceeded: the admit queues on the writers and a hotter machine, now outside any cell |
| `compile` / `gate` per need, width 64 | 52.8 / 15.8 ms | 76.1 / 24.1 ms | — | +44% / +53% wall: more cells running at once on the same cores |
| Wall per need, width 1 | 63.3, 65.1, 64.0, 64.9 (64.3 ms) | 66.4, 64.6, 63.8, 65.3 (65.0 ms) | unchanged (bar ≤ +3%) | met (+1.1%, p ≈ 0.35) |
| Tree RSS, width 64 | 4.8 GB | 5.5 GB | — | +14% (more jobs in cells at once) |

The P-78 arm's first row (73.4, load 2.3 at start) is the lowest P-78 row recorded in rounds 5 to 7 (others 75.3 to 78.3). Without it the gain is +2.6%. Against P-78's own round-5 mean (76.7) the lever's 79.1 is +3.1%. Every reading puts the effect at about +2.5% to +4%, short of the predicted range.

**Why it fell short.** Before, 12 cells were busy 0.998 of the time but did work only 0.64 of it, and the machine ran 9.7 cores. With the freeze outside the cells, the cells did work 0.96 of the time and the machine ran 10.6 cores. On 12 cores, six of them efficiency cores, that is close to all the work the machine can do: per-need CPU rose 6% from contention (compile wall +44%), so the 50% more cell work time produced 4% more needs. The precommit's arithmetic named this cap ("roughly 85–90/s"); it overestimated how much of the nominal 12 cores is usable.

## Correctness guard

- **Rows:** every row on both arms has `wrongVerdicts` = 0 and `errors` = 0. Both arms show the same two outcome classes, `true/true/passed/-` and `false/false/failed/-`, at 14.2–14.3% failed in every row.
- **Request stream** (`stream.py`, width-1 capture rows, `stream.json`): for the 186 needs both rows completed, all 186 `admit`, 212 `park` and 186 `commit` requests are identical across arms. `admit` and `park` are byte-identical after replacing the row's temporary directory and mapping the one digest that differs by construction: the lever changes `loop-port.mjs`, one of the 14 implementation files frozen into every record, so its digest and the frozen identity derived from the record differ. `commit` is identical after also dropping wall-time fields, cell pids and the evaluator digest.
- **`make -k test`**, one command per file on both arms, `isolate-host-call.test.mjs` excluded on both (it hangs on macOS): 41 failing commands on P-78, 43 on the lever. The two extra:
  - `core/runtime/test/ledger-writer.test.mjs`, the SIGKILL `half_frame` case: pre-existing, as P-78 and P-79 found; re-run on P-78 it failed 2 of 3. The lever does not touch the writer.
  - `core/runtime/test/loop-crash.test.mjs`, the random-kill case (`bridge and supervisor kills at random times never yield a promotion without its evidence`). In the four dedicated runs per arm it failed **1 of 4 on each arm** (`reruns.json`), so with the suite run it is 1 of 5 on P-78 and 2 of 5 on the lever. That is within the precommit's rule (the dedicated runs are equal) and the case is a random-timing test that flakes on P-78 too. Recorded, not treated as a test concern.
- `make check` passed on the lever and passes on the final commit.
- Not changed by the lever, nor by this round: the gates, the freeze rule and its checks (the shadow-copy check, `testProblems`, synthesis, `revise`, reuse), the frozen record, the rows, durability, park as its own checkpoint, P-75 to P-78's levers.

## Floors against observed (zero latency; this round's P-78 arm)

Width 1, per need (wall 64.3 ms):

| Bucket | Share of wall | P-78 | Physical floor | Distance |
|---|---|---|---|---|
| `compile` | 38% | 24.6 ms | not measured (AssemblyScript `-O3` through binaryen) | **unknown** |
| `crossing` | 15% | 9.4 ms | 0.06 ms of IPC; 4.1 ms with no cell replacements (P-78) | **~150×** IPC; 2.3× no-replacement |
| `ledger` + `freeze` | 31% | 19.7 ms | about 11 ms (3.14 requests × 3.5 ms unbatched `F_FULLFSYNC`, P-79) | **1.8×** |
| `gate` + `promote` | 16% | 10.3 ms | not measured | **unknown** |

Width 64, throughput resources:

| Resource | P-78 | P-80 (lever) | Floor | Distance |
|---|---|---|---|---|
| Cell slots | gross 0.998, net 0.64, 48 ms per need blocked on `admit` | gross 0.96, net 0.96 | — | no longer binding with the lever |
| Machine CPU | 9.7 cores, 127 ms per need | 10.6 cores, 135 ms per need | 78 ms per need (width-1 CPU per need, P-78 arm) | **1.6–1.7×**: binding |
| Cell CPU per need | 105 ms | 111 ms | 64 ms (width 1) | **1.6–1.7×** |
| Writer CPU per need | 14.8 ms | 15.4 ms | 11.4 ms (replay, P-79) | 1.3× |

**Stop rule not met.** `compile` and `gate` + `promote` have no measured floor, and `crossing` is far from its floor.

## Next binding ceiling and levers

1. **The machine's CPU, through cell CPU per need at width 64 (1.6–1.7× width 1).** Released cells make this the ceiling outright. Candidates, ranked:
   - **The rest of each cell start** (P-78: about 1 CPU-s per replacement; 18–22 replacements per 19 s window here, so about 1 core, roughly 13 ms per need): pre-warm the replacement before retiring, or a V8 code cache for the compiler module. Both cut work rather than move it, so they help with or without this round's lever.
   - **Re-test this round's lever stacked on a CPU-cutting round.** It freed 0.32 of 12 cells; it can only convert that into throughput once the machine has headroom. It is simple and keeps every check, so it is worth re-measuring then (new precommit).
   - Exact dedup of `admit` (−17% writer CPU, about 2.5 ms per need): now a CPU lever, small.
2. **Measure the `compile` floor** so the stop rule can be decided.

## Code delta

- **Product:** none net. The lever (+43 −37 lines, plus an 11-line test and its trace entry and doc lines) was committed, measured and reverted.
- **Experiment tools:** `stream.py` (the request-stream guard). `run.mjs` is P-78's plus a `capture1` plan (a width-1 capture row); both arms ran this same `run.mjs` (the P-78 arm from a copy in its own tree, not committed). `summarize.py` is P-78's with the arm names changed and gross cell utilisation added.

## Receipts and how to reproduce

- `run.mjs <out> <stamp> row <w64|w1> <rep>`: one acceptance row. `run.mjs <out> <stamp> capture1`: a width-1 capture row, written to `<out>/capture.jsonl`.
- `stream.py <capture P-78> <capture P-80>`: the request-stream comparison.
- `summarize.py`: the acceptance table with Welch t and p.
