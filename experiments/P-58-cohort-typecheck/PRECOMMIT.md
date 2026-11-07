# P-58 the type check inside the contained cohort: precommit

Label: **Proposed** procedure, frozen 2026-11-07 before any route measurement. Amendments go below with a new digest appended to `receipt/precommit.sha256`; the first digest stays.

Question: P-54 found the contained TypeScript route tops out at 62–72 accepted attempts per second at every width, because tsc-rs checks and emits on the supervisor's main thread at about 14 ms each, while the reused-Worker cohort runs about 19,000 bare attempts per second at width 16. If check, emit and both runs happen inside the cohort, one handoff in and one result out per attempt, does accepted work per second scale with width, and what does it cost in CPU and memory per accepted attempt?

The goal is speed, concurrency and resource pressure: accepted per second, CPU per accepted attempt, peak RSS per active attempt, attempts in flight. Containment isn't the question here.

## What exists before measuring

One feasibility probe was run while designing, and it isn't a measurement for any bar: in a Worker of a `--permission --allow-worker --disallow-code-generation-from-strings` process, the pinned tsrs module compiled once on the process's main thread and passed to the Worker instantiated and checked a one-line project in 18–22 ms warm (71 ms first), with 102,039,552 bytes of linear memory per check. A data-URL import of the pinned `core.js` works under those flags. A 50,000-deep parenthesis traps the checker (exit 5, a stack overflow) without killing the Worker.

tsrs exposes one-shot `runTsc` on a fresh instance only: there's no language service or persistent program to keep, so "warm" here means the module is verified and compiled once per cohort, shared by every Worker, and `core.js` and the check code are loaded once per Worker. `lib.d.ts` is parsed on every check, as on the supervisor today.

## Trust budget

The type check runs in the same cohort as the candidate's execution. It reads only that candidate's files, its failures (a trap, a Worker death, a check deadline) are that attempt's failures, and a cohort death already costs every attempt in flight. A separate process would only make sense for a different trust or failure budget, and the check has the candidate's.

## Arms

All three use one supervised `shared-reuse` cohort process (`--permission`, reused Workers, fresh guest context per run), Node 26.13.0.

| Arm | Where the check runs | Handoffs per attempt at the supervisor |
|---|---|---|
| `supervisor` | Main thread of the supervisor, as P-54 shipped. Re-measured here as the same-session baseline | check in-process, then two run jobs to the cohort and two results back |
| `fused` | Inside the same Worker that then runs the guest twice: check, emit, run, run | one job in, one result out |
| `sibling` | A pool of `width` checker Workers in the same cohort process; the cohort's main thread passes the emitted JavaScript to a guest Worker, which runs it twice | one job in, one result out |

The check code is the same module in every arm: `check-core.mjs`, split out of `checker.mjs` with no behaviour change. Scoring (comparing outputs against the candidate's tests) stays on the supervisor in every arm, as in P-54.

## Workload and procedure

The P-54 route workload: the 20 P-15 scalar needs (`toBaseFactor` plus `convertUnit`), tests from the AssemblyScript build of the same source, deadline 2,000 ms per run. Widths 1, 8, 16 and 32, closed loop, `width` submitters. Each row runs `max(400, 40 × width)` attempts after a warm-up of `width` attempts. Arms are interleaved within each width, and the whole sweep runs twice; the acceptance figure for a row is the lower of the two rounds' accepted per second, and the higher of the two rounds' CPU and RSS.

CPU is user plus system time of the supervisor and the cohort process over the measured span, divided by accepted attempts. Peak RSS is sampled every 20 ms over the cohort process plus the supervisor process, divided by width; P-54's "RSS per active" counted the cohort process only, so that figure is reported too, for comparison.

A row is **loaded** if the 1-minute load average exceeds 16 at its start or end; a loaded row is reported but is not an acceptance figure. A row starts only when load is at most 16 (waiting up to 30 minutes, then recorded as loaded). Heavy runs go through `heavy-run` with 4 slots.

## Bars, fixed now

1. **Throughput.** The better cohort arm reaches at least **700 accepted per second at width 16**, unloaded (10× P-54's 71.7).
2. **CPU.** CPU per accepted attempt at width 16 is no worse than P-54's `shared-reuse` route at width 16, **27.3 ms**.
3. **Memory.** Peak RSS (cohort plus supervisor) per active attempt at width 16 is at most **128 MiB**. The budget is one check's linear memory, about 97 MiB, plus about 30 MiB for the Worker, the guest and the share of the supervisor.
4. **Verdict parity.** Zero verdict differences between the `supervisor` arm and each cohort arm on the parity corpus: the 20 scalar needs as they are, each with a planted type error (`convertUnit` returning a string), and each with a wrong result (`+ 1` on the return), 60 candidates; plus the 20 whole P-15 kernels checked without running. A verdict is the route receipt's `status`, `reason`, `passed`, `total`, the first five diagnostics (file, line, column, code) and the emitted artifact digests.
5. **Fatal.** At width 16: a checker Worker that dies during a check (its heap limit exceeded) loses only that attempt, recorded `outcome_unknown`, and every neighbour completes; killing the cohort process with 16 attempts in flight records exactly those 16 `outcome_unknown`, none is dispatched again (cohort dispatches equal admissions), and queued attempts each run once on the replacement.

## Predictions

- `sibling` and `fused` both scale roughly linearly to width 16 and flatten at 32 on 32 hardware threads, landing near **500–750 accepted per second at width 16**: about 20 ms of check CPU per attempt in a Worker puts the ceiling near 800 with 16 cores busy, less what the machine's other work takes. I give bar 1 about even odds.
- CPU per accepted attempt lands near 22–30 ms, so bar 2 is about even odds too; the check in a Worker looked slower in the probe than P-54's 13.7 ms on the main thread.
- Memory per active attempt is dominated by the check's linear memory: 100–130 MiB in both cohort arms against about 20–30 MiB in the `supervisor` arm, where only one check is ever live. `sibling` holds two Workers per slot, so it costs a few MiB more per slot than `fused`.
- Parity: zero differences. The check code is the same; the only difference is the thread's native stack, which matters only to a trap.
- Fatal: held.

## Decision rule

The route's default check placement becomes the cohort arm with the higher unloaded accepted per second at width 16, or within 10% of each other the lower peak RSS per active attempt, provided that arm has zero verdict differences (bar 4), holds bar 5, and spends no more than 1.25× P-54's CPU per accepted attempt (34.1 ms). A miss on bars 1, 2 or 3 alone doesn't block the switch if the arm at least doubles the `supervisor` arm's accepted per second at width 16; the miss is reported as a miss and nothing is retuned to meet it. Otherwise the default stays `supervisor`. Every arm stays selectable.

## Receipts

`experiments/P-58-cohort-typecheck/receipt/`: the raw rows per round (`route-*.json`), the parity diff (`parity.json`), the fatal runs (`fatal.json`), and this file's digest in `precommit.sha256`.
