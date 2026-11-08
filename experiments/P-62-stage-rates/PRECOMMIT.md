# P-62 a live per-stage view names the bottleneck: precommit

Label: **Proposed** procedure, frozen 2026-11-07 before any acceptance measurement. No model calls and no spending: every model is a scripted stub with a set delay.

Question: today the loop's bottleneck moved from the type check (P-58, P-60) to the ledger (P-57, P-59) to the cells, and each move took its own experiment to find. Can a per-stage view, like Factorio's production statistics, recorded inside the running loop, name the current bottleneck correctly and cheaply enough to leave on?

## Design under test

`core/runtime/stage-rates.mjs`, opt-in through `createLoopPool({ rates })`. Off by default; with `rates: null` each hook is one optional-chaining check.

- **Recording.** Each stage event is a monotonic `performance.now()` stamp written into preallocated typed arrays in the supervisor's memory: a 16,384-slot ring for items in flight, per-stage running integrals (∫N dt in the stage, ∫N dt waiting, ∫busy servers dt), sums of sojourn, service and wait, blocked time, and a 2,048-entry ring per stage of recent service times for percentiles. No allocation per event besides the call, no disk write per event. A 1 Hz timer copies the counters into an in-memory history of 900 snapshots so any window can be read.
- **Stages** of the agent loop (`loopStages`):
  - `model:spec`, `model:impl`: provider calls before and after admission, unbounded servers, one family `model`.
  - `cell`: a job from `pool.run` to its result. Arrival at `run`, start at dispatch to a cell, done at the result. Servers = pool size.
  - `cell.compile`, `cell.gates`: inside a cell job, from the job's own timings (AssemblyScript type check and emit; the frozen evaluator's gates and tests). Shown as parts of `cell`, not judged on their own.
  - `ledger`: every bridge request (admit, park, commit, prepare, append, frozen). One server; FIFO service start is inferred as max(arrival, previous completion).
  - With the compatibility lane on (the harness composes it after the agent loop, as `attemptCurrent` does): `tscheck`, the contained TypeScript route (type check, emit and two runs in one cohort job), servers = route width, with `tscheck.check` and `tscheck.run` as parts.
  - **Blocked time**: a cell job waiting on a host call (the admit crossing, or a model call under `hold`) is busy but not working. That time is recorded against `cell` and subtracted to give **net utilisation**.
- **Per stage, over a window**: arrivals/s, completions/s, utilisation (busy server-time / (servers × wall)) and net utilisation, queue (now, time-averaged, growth = (arrivals − completions)/s), time-averaged items in the stage L, service p50/p95/p99, mean sojourn W, and the Little's Law check |L − λW| / L with λ the completion rate.
- **Supervisor event loop utilisation** is reported alongside, not judged.
- **Readout**: `rates.view()`, `rates.text()`, `rates.publish(path)` (an atomic JSON+text snapshot every second, to `/dev/shm` in the harness), and `node tools/stage-rates.mjs <path> [--watch] [--json]`.

## Rule V, fixed here (as `verdict()` and `RULE` in the module)

Over the window, among top-level stages with finite servers and any traffic:

1. **Saturated** stages have net utilisation ≥ 0.80 **and** (time-averaged queue ≥ 0.25, or queue growth > 0, or net utilisation ≥ 0.95).
2. If any are saturated, the bottleneck is the one with the highest net utilisation; when several are within 0.05 of the top, the one with the longest time-averaged queue. Kind `saturated`.
3. Otherwise no service stage limits the rate and the loop is bound by its population (width). The bottleneck is the stage family holding the most candidates on average (L, summed over a family such as `model`). Kind `population` if that family has unbounded servers, `unsaturated` otherwise.

Live verdicts use the last 5 s. Acceptance verdicts use the steady window below.

## Arms

All at width 16 (16 candidates in flight, closed loop), 4 process cells, `waits: 'release'` (the default), P-50's 21-kernel corpus and stage-scripted replies, 2 model turns per candidate, under `HEAVY_SLOTS=4 heavy-run`. Each run: start after `pool.ready()` (cells warm), submit for `seconds`, steady window from `warmup` to `seconds`, then drain. Ledger files on btrfs NVMe (`disk`, main's bridge as shipped, P-59 not merged) or `/dev/shm` (`tmpfs`, where `fsync` is free).

Controlled runs, answer known by construction:

| Run | Model per turn | Ledger | Lane | Injected | Expected |
|---|---|---|---|---|---|
| R1 `ledger` | 20–40 ms | disk | off | +25 ms per ledger request, serialized | `ledger` |
| R2 `checker` | 20–40 ms | tmpfs | width 1, `fused`, fresh tsrs instance (main has no P-60), each kernel padded with 3,000 `export const` lines | none | `tscheck` |
| R3 `model` | 2–4 s (P-57) | disk | off | none | `model` (population) |

R3 is also main as it is today at width 16 with model waits at P-57's distribution, which the question asks about.

Observations, answer not known in advance, verdict checked only by perturbation: `main-fast` (main with 20–40 ms turns) and `cells` (tmpfs ledger, no lane).

Seconds/warmup: 40/10 for all but R3, 130/15 for R3 (W is about 3 s there, so a longer window keeps edge effects small).

Pilot disclosure: before this file, 20 s pilots (not acceptance) ran `main-fast` (verdict `ledger`, 10.7/s), `cells` (`cell`, 30.9/s) and `checker` with a 3,000-line pad (`tscheck`, 18.4/s). The pad was chosen from that pilot so the checker sits well under the cells' rate. The pilots also found a units bug in the Little's Law column, fixed before this file.

## Rival and its test

Rival: *utilisation alone misleads; the true constraint shows only in queue growth or end-to-end sensitivity.* (In the pilot, `cell` was at gross utilisation 1.00 while the ledger was the limit, because a cell holds its job while it waits for the admit crossing.)

Test: in each of R1, R2, R3, `main-fast` and `cells`, two base runs, then one run per top-level stage with that stage's mean service time raised by 20% (mean from base run 0):

- `model`: every delay × 1.2.
- `cell`: a sleep of 0.2 × mean cell service at the start of every cell job, inside the cell (`delay-port.mjs`).
- `ledger`: a serialized sleep of 0.2 × mean ledger service before every request (added to R1's 25 ms).
- `tscheck`: a sleep of 0.2 × mean tscheck service inside the lane's server slot.

Throughput change is against the mean of the two base runs. A stage **moves** throughput if it drops by 8% or more. The view is **supported** in a run if the named stage moves and no other perturbed stage does; the **rival wins** there if the named stage doesn't move or another one does. I also report which stage gross utilisation alone (argmax) would have named.

## Bars (fixed here)

1. **Overhead**: at `cells` (the config whose rate is set by CPU work), 8 interleaved pairs of 30 s runs (8 s warmup) with `rates` on and off, order alternating. The median over pairs of the on-vs-off change is ≤ 1% for accepted candidates/s (drop) and ≤ 1% for CPU-ms per candidate (rise; CPU of the whole process tree, including reaped children). If the interquartile range of the paired changes is wider than 2 points, the A/B can't resolve 1% and the bar is reported **unresolved**, not met. Reported alongside: a microbenchmark (ns per arrive/start/done, per span, per view) times events per candidate, over CPU per candidate.
2. **Correct verdicts**: the steady-window verdict names the expected stage in both base runs of each of R1, R2, R3 (6 of 6).
3. **Little's Law**: in every base run of R1–R3, every top-level stage with ≥ 50 completions in the window has |L − λW| / L ≤ 10%.
4. **Live**: in every base run of R1–R3, the live verdict sampled at 5 s (±0.5 s) after the run starts names the expected stage, and a published snapshot exists by then.

## Predictions

- Throughput: R1 5–7/s, R2 15–21/s, R3 2.3–2.7/s, `main-fast` 9–12/s, `cells` 27–34/s.
- Verdicts: R1 `ledger`, R2 `tscheck`, R3 `model`, `main-fast` `ledger`, `cells` `cell`.
- Rival: the named stage drops 12–20% (R3's model about 19%, since nearly all of a candidate's time is model time); every other stage within ±4%. Gross utilisation alone names `cell` (a tie at 1.00) in R1 and `main-fast`.
- Overhead: cost model under 0.05%; the A/B median within ±1%, probably unresolved on this shared machine.
- Little's Law: under 5% for every stage, the model family in R3 the largest.
- Live: correct at 5 s in all six.

## Decision rule

If bars 2–4 hold and the view is supported in R1–R3, the view becomes the first step for finding the loop's bottleneck (a run with `rates` and a glance at the dump), in place of a lane per move. It stays opt-in; bar 1 decides whether it may be on by default in harnesses. Any miss is reported as measured, not retuned.

## What a miss means

- A wrong verdict in R1–R3: rule V doesn't capture that shape; the miss says which signal (net utilisation, queue, population) misled.
- Little's Law over 10%: lost or mispaired events, or a window too short for the stage's sojourn.
- The rival winning: a stage the view rates unsaturated still sets the pace, so utilisation and queues are not enough and sensitivity tests stay necessary.
- Overhead over 1%: recording must move off the hot path.

## Limits known now

- Stub models, synthetic kernels, one shared host.
- Stages in the cell are reported from the job's own timings, not stamped live, and the supervisor can't see the queue inside the bridge's Python process or inside a contained cohort, only in front of them.
- A stage that runs synchronously on the supervisor's thread has its queue in the event loop, where these stamps can't see it; that's why event loop utilisation is reported.
- The compatibility lane isn't part of the agent loop on main; the harness composes it.

## Stop condition

One acceptance pass per plan (`micro`, `controlled`, `overhead`). Each arm starts only when the 1-minute load is ≤ 16; a row whose start or end load is above 16 is labelled loaded and doesn't count, and may be rerun once. A crashed arm may be rerun once, and the crash is reported.
