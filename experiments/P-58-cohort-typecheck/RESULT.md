# P-58 the type check inside the contained cohort: result

Status: **Recorded (probe)**, 2026-11-07, Node 26.13.0, on a shared desktop with other agents' work running. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed and pushed before any route measurement. Raw rows: [receipt/](receipt/). No row was loaded: the 1-minute load stayed between 2.1 and 10.2.

**Moving the check into the cohort lifts the route 6–8× at width 16, from 58–63 to 380–516 accepted attempts per second, at 44–49 MiB per active attempt. It misses the 700 per second bar and the CPU bar, and it costs 1.1–1.5× the CPU per accepted attempt of the check on the supervisor. Under the precommitted rule that CPU cost blocks the switch, so the route's default stays `check: 'supervisor'`.** Both cohort placements are in the code and selectable. Verdicts matched on all 80 parity candidates, and a fatal lost only what it should have.

The ceiling is the check, not the cohort. Every check runs tsrs from a fresh instance (the only API it has), so `lib.d.ts` is parsed every time, and the check's CPU cost grows from 16.5 ms alone to 25–31 ms with 16 at once. That growth happens in separate processes too (see Diagnosis), so it comes from the machine and not from sharing one process.

## Arms

| Arm | Where the check runs | Supervisor handoffs per attempt |
|---|---|---|
| `supervisor` | Supervisor main thread (P-54 as shipped) | check in-process, 2 run jobs out, 2 results back |
| `sibling` | `width` checker Workers in the cohort process; the cohort's main thread passes the emitted JS to a guest Worker that runs it twice | 1 in, 1 out |
| `fused` | The guest's own Worker: check, emit, run, run | 1 in, 1 out |

All three use one `shared-reuse` cohort process. The cohort verifies the pinned `tsrs.wasm` and compiles it once. It's the only file the process may read (`--allow-fs-read` for that one path), and every checking Worker gets the same compiled module. `core.js` (pinned digest checked on the supervisor), `check-core.mjs` and the preparer arrive as text and are imported once per Worker.

## Speed and resources

Workload: P-54's 20 scalar needs, 2,000 ms run deadline, closed loop, `max(400, 40 × width)` attempts per row, two rounds with arms interleaved. Each cell gives round 1 / round 2. **Bold** is the acceptance figure: the lower rate, or the higher CPU or RSS. CPU is user plus system time of the supervisor and the cohort process, per accepted attempt. "RSS per active" is peak cohort plus supervisor RSS divided by width. P-54 counted only the cohort; that figure is in the last column.

| Arm | Width | Accepted per s | p50 ms | Check p50 ms | CPU ms per accepted | RSS per active MiB | Cohort-only per active |
|---|---|---|---|---|---|---|---|
| `supervisor` | 1 | **53.3** / 54.0 | 17.9 / 18.0 | 15.6 | **37.1** / 36.9 | **577** / 576 | 79 |
| | 8 | **59.0** / 62.2 | 135 / 127 | 46 / 45 | **34.8** / 30.6 | **61.6** / 60.1 | 25 |
| | 16 | **58.1** / 63.2 | 279 / 251 | 68 / 63 | **33.4** / 30.3 | **38.2** / 38.0 | 21 |
| | 32 | **58.5** / 65.3 | 546 / 492 | 250 / 164 | **33.6** / 29.2 | **27.8** / 27.3 | 18–19 |
| `sibling` | 1 | **53.1** / 59.0 | 18.3 / 16.5 | 17.0 / 15.4 | **25.3** / 22.2 | **658** / 651 | 164–168 |
| | 8 | **284.8** / 356.8 | 27.5 / 21.8 | 25.5 / 20.3 | **33.7** / 26.7 | **89.2** / 87.4 | 52–54 |
| | 16 | **372.4** / 468.3 | 40.9 / 33.0 | 37.9 / 30.8 | **47.2** / 36.8 | **63.0** / 60.1 | 43–46 |
| | 32 | **294.5** / 424.3 | 103 / 76 | 97 / 69 | **60.8** / 42.4 | **51.3** / 50.7 | 41–42 |
| `fused` | 1 | **53.1** / 59.2 | 18.4 / 16.7 | 17.0 / 15.5 | **25.1** / 21.9 | **638** / 635 | 147–148 |
| | 8 | **278.6** / 351.4 | 28.1 / 21.8 | 26.3 / 20.4 | **34.4** / 27.1 | **71.8** / 69.8 | 35–36 |
| | 16 | **380.2** / 516.4 | 41.6 / 30.1 | 38.8 / 28.3 | **45.0** / 32.6 | **49.1** / 44.3 | 27–32 |
| | 32 | **318.3** / 428.8 | 100 / 77 | 95 / 71 | **56.3** / 42.1 | **36.3** / 35.9 | 27 |

Every attempt in every row was accepted, and no cohort restarted. In the cohort arms the supervisor spends 0.13–0.37 ms of CPU per attempt; on the `supervisor` arm it spends 27–35 ms. About 280–310 MiB of the supervisor's RSS is the harness itself (the AssemblyScript compiler it loads to build tests), and it's in every arm. That's why width 1 shows about 600 MiB per active attempt.

What the table says:

- **The supervisor arm is flat at 53–65 per second at every width**, which matches P-54's 62–72. Its check p50 grows with width only from queueing.
- **The cohort arms scale up to width 16 and then fall at 32.** Width 1 matches the supervisor (one check at a time either way), width 8 gives 5–6×, and width 16 gives 6.4–8.2×. At width 32 throughput drops and CPU rises, as in P-54's runtime arms. The machine has 16 cores and 32 threads, and `heavy-run` caps the slice at about 17.9 cores.
- **Per-check cost grows with concurrency.** Check p50 goes from 15.4 ms at width 1 to 28–39 ms at width 16, and CPU per accepted attempt rises with it. Round 1 ran at load 3.3–4.7 and round 2 at 6.8–7.3, and round 2 was still faster, so this is variance on a shared machine rather than load alone.
- **`fused` vs `sibling`.** At width 16, `fused` is 2–10% faster, uses 3–14% less CPU, and uses 14–26% less memory per active attempt, since it holds one Worker per slot instead of two. They're within 10% of each other on throughput, so the tie-break picks the lower RSS: `fused`.
- **Memory.** A check's linear memory is about 97 MiB while it runs (102,039,552 bytes reported by tsrs). Because Workers finish at different times and V8 collects the dead instances, peak RSS per active attempt stays well under one check's linear memory at widths 8 and up.

## Diagnosis: why per-check CPU grows (diagnostic, not acceptance)

[`diagnose.mjs`](diagnose.mjs) ran the same check 60 times per checker: N checkers as Worker threads in one process, against N separate processes (load 6.1–10.2). Raw: `receipt/diagnose-26.13.0.json`.

| Checkers | Threads: CPU ms per check / checks per s | Processes: CPU ms per check / checks per s |
|---|---|---|
| 1 | 16.5 / 60 | 16.8 / 58 |
| 8 | 19.1 / 392 | 22.5 / 313 |
| 16 | 24.7 / 570 | 30.8 / 292 |

Separate processes are no faster, so one shared address space isn't the cost. The growth is per machine: 16 physical cores, SMT siblings and shared cache and memory bandwidth for 16 fresh ~100 MiB instances at once. On this machine, about 570 bare checks per second at width 16 is the ceiling for a fresh-instance tsrs check. The route reached 380–516 of that. Getting 700 per second needs less work per check, not more parallelism. The obvious lever is not reparsing `lib.d.ts` every check: a persistent program or a post-lib memory snapshot. tsrs 0.22 doesn't expose either, and this lane didn't attempt them.

## Bars

| # | Bar | Measured (acceptance figure) | |
|---|---|---|---|
| 1 | ≥ 700 accepted/s at width 16, unloaded | `fused` 380.2 (round 2: 516.4), `sibling` 372.4 (468.3) | **missed** |
| 2 | CPU per accepted at width 16 ≤ 27.3 ms (P-54) | `fused` 45.0 (32.6), `sibling` 47.2 (36.8). Same-session `supervisor`: 33.4 (30.3) | **missed** |
| 3 | Peak RSS per active at width 16 ≤ 128 MiB, cohort + supervisor | `fused` 49.1, `sibling` 63.0 | **met** |
| 4 | Zero verdict differences on the parity corpus | 0 of 80 differ in either cohort arm (20 accepted, 40 refused `typescript`, 20 refused `tests` in all three arms) | **met** |
| 5 | Checker death loses only its attempt; cohort kill → in-flight `outcome_unknown`, nothing re-dispatched | 6 of 6 heap breaches (3 per arm, width 16): breacher `outcome_unknown` / `checker_lost` / `ERR_WORKER_OUT_OF_MEMORY`, 31 of 31 neighbours completed, 32 dispatches for 32 admissions, no cohort restart. 6 of 6 kills: exactly 16 `outcome_unknown` (`cohort_exit`), 16 queued completed once on 1 replacement, 32 dispatches for 32 admissions, 378–473 ms from kill to first result | **met** |

Predictions: throughput landed below the 500–750 band I predicted for the worse round and inside it for the better one. CPU came in above my 22–30 ms prediction. Memory came in well under it: I predicted 100–130 MiB and measured 44–63, because peaks don't coincide. Parity and fatal held as predicted.

Note on bar 5's raw rows: in `fatal-26.13.0.json` the `checker-heap` rows' `dispatched` field is the total minus 16 (16 means 32 dispatches for 32 admissions). That was a bug in the harness and it's fixed in `bench.mjs`. The kill rows are correct as recorded. The breacher is a candidate with 150,000 type errors, which goes over the default 64 MiB Worker heap while diagnostics are decoded. On the supervisor, with its larger heap, the same candidate is a plain `refused: typescript`. That verdict difference is a resource limit, and the candidate isn't in the parity corpus.

## Decision

The rule picks the cohort arm with the higher width-16 throughput, or within 10% the lower RSS. That's `fused` (380.2 against 372.4, 49.1 against 63.0 MiB). The rule allows the switch only if that arm spends at most 1.25× P-54's CPU per accepted attempt, 34.1 ms. `fused` measured 45.0 ms in its worse round, so **the default stays `check: 'supervisor'`**. That's a miss, reported as one and not retuned. `fused` and `sibling` are selectable through `createContainedRoute({ check })`.

For whoever decides next: in the same session the gap is smaller than against P-54's figure. `fused` used 45.0 / 32.6 ms against the supervisor's 33.4 / 30.3, which is 1.08–1.35×, for 6.5–8.2× the accepted work per second. The rule compared against P-54's 27.3, and today's `supervisor` arm doesn't reproduce that figure either.

## Trust budget

The check runs in the candidate's own cohort. It reads only that candidate's project, and its failures are that attempt's failures: a tsrs trap is `outcome_unknown` / `checker_error`, a Worker loss during the check is `checker_lost`, and an overrun is `check_deadline`, 10 s by default. A cohort death already costs every attempt in flight. No different trust or failure budget calls for a separate process.

## What changed in the code

- `tools/tscheck/check-core.mjs`: the check split out of `checker.mjs` unchanged, with no file or package access, so the same code runs on the supervisor and in a cohort Worker. The existing tscheck suites (109 tests) pass unchanged.
- `tools/tscheck/cohort-preparer.mjs` runs in the Worker. `tools/tscheck/cohort-check.mjs` builds what the cohort needs on the supervisor and checks `core.js` against its pin.
- `core/runtime/contained/runner.mjs` takes a `prepare` option (`layout: 'fused' | 'sibling'`, `count`, `checkDeadlineMs`, `memoryMb`) and adds `runChecked()`: one job in, one result out. A cohort loss reports every checked attempt `outcome_unknown`, whatever the width, because the supervisor can't tell whether it was checking or running. `stats.dispatched` counts jobs sent to a cohort. The RSS watchdog's default adds `memoryMb` (1,024) per slot for the check's linear memory.
- `cohort.cjs` and `cell.cjs`: checker Workers (sibling) or a preparer in the guest Worker, imported before the realm is hardened (fused). Per-phase deadlines. Each run's result is posted as soon as it exists, and an attempt's remaining run moves to a new Worker if the first one dies, as the second run job did before.
- `tools/tscheck/contained-route.mjs`: `check: 'supervisor' | 'sibling' | 'fused'`, default `supervisor`. Scoring stays on the supervisor in every placement.
- Tests: `tools/tscheck/test/cohort-check.test.mjs` covers verdict parity across all three placements on 10 candidates covering accepted, `typescript`, `tests` and `deadline`, a checker heap death per placement, and a cohort kill per placement.

## Not shown or unverified

- Node 26.13.0 only. Node 22 wasn't run.
- One workload of small scalar needs. A larger project changes check time and memory, possibly a lot.
- The shared desktop had other agents' work running. Round-to-round spread at width 16 was up to 30% (380 against 516), which is larger than the gap between the two cohort arms.
- In fused mode the check uses the guest's Worker limits (64 MiB heap, 2 MiB stack). In sibling mode it uses 64 MiB and 4 MiB. On the supervisor it uses the main thread's. Verdicts at those edges (deep nesting, huge diagnostics) can differ, as the breacher above shows. The parity corpus doesn't reach them.
- Escape behaviour of the fused realm wasn't re-run against P-54's attack suite. The guest context is unchanged, but the Worker realm now also holds the checker.
