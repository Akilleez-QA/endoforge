# P-61 big memory holders on the machine's dump list: result

Status: **Recorded**, 2026-11-07, Node 26.13.0, on a shared desktop with other lanes running. Precommit: [PRECOMMIT.md](PRECOMMIT.md), committed and pushed at 18:39 EST (7bf84c6) before any acceptance measurement; digest in `receipt/precommit.sha256`. Acceptance runs: 18:46–19:10 EST. Raw rows: [receipt/](receipt/). Load ran from 11.3 to 42.8; 9 of the 10 cohort trials, the parity run (16.1 at its end) and all four overhead pairs crossed 16 and are marked loaded.

**On SIGUSR2 at width 16 with four attempts in flight, the cohort freed 246–261 MiB of the 320–380 MiB it reported (68–77%), 251 MiB of 336 (75%) in the one unloaded trial, where 70% of the reported bytes were gone 31 ms after the signal and the file was rewritten at 52 ms. Throughput was back within 10% of pre-shed 0–500 ms after load returned to 16 lanes (2.0–2.5 s after the signal).** Repeated sheds changed no verdict and added no `outcome_unknown`. The ledger writer freed 202 MiB of the 167 MiB it reported in 45–62 ms. The isolate pool's cells give back only about 2 MiB each on Node 26, and in two of five pools the first shed overstated that 3–5 times.

## Bytes freed, time to free, time to recover

| Holder | Priority | Reported | Freed (RSS, median 1.5–2.0 s after vs 0.5 s before) | Time to 70% of reported | File rewritten | Recovery |
|---|---|---|---|---|---|---|
| Cohort, 4 of 16 lanes running (5 trials) | 40 | 319.6–379.9 MiB | 246.1–261.0 MiB (0.682–0.771) | 31–1,479 ms; 31 ms unloaded | 40–204 ms | 0–500 ms after load returned; 2.0–2.5 s after the signal |
| Cohort, all 16 lanes running (5 trials) | 40 | 28.4–36.8 MiB | −21.2 to +23.2 MiB (noise) | — | 10–243 ms | 0–1,750 ms |
| IsolatePool, 16 thread cells (5 trials) | 20 | 29.7–134.3 MiB | 29.1–32.1 MiB | 10 ms in 3 trials, never in 2 | after termination | next job 282–371 ms |
| Ledger writer, 1,024 handles (5 trials) | 110 | 167.3 MiB (171,287 bytes per handle) | 202.0–202.2 MiB | shed took 45–62 ms | after the shed | all 3,072 answers and every record intact; next batch served |

What each drops: the cohort retires idle Workers beyond a floor of one (about 11 at four lanes; about 23 MiB of RSS came back per retired Worker) and drops the floor Worker's reused instance and image; the pool terminates idle cells beyond a floor of one; the ledger writer closes every cached SQLite handle and calls `malloc_trim(0)`. In-flight cohort attempts, busy pool cells and the writer's unacknowledged journal batches are never touched.

With all 16 lanes running the cohort has nothing worth dropping: each busy Worker's reused instance is the working set and would be rebuilt by its next check, so it counts as zero. What it reported (one idle Worker between attempts) was within the RSS noise of 16 running checks.

## Bars

| # | Bar | Measured | |
|---|---|---|---|
| 1 | ≥ 70% of reported bytes freed within 2 s, width 16, 4 lanes in flight, every unloaded trial | 0.747 in the one unloaded trial (trial 4, load 15.4–16.0). Loaded trials: 0.770, 0.735, 0.771, and **0.682** in trial 1 (load 39.5–42.8) | **met**, on a single unloaded trial; the loaded trial 1 would have missed |
| 2 | Zero verdict differences and zero extra `outcome_unknown` | 300 attempts per arm, 29 sheds during the shedding arm: 0 differences, 0 `outcome_unknown` in either arm; 0 `outcome_unknown` and 0 cohort losses across 85,768 attempts in the ten shed trials | **met** (parity run loaded at its end, 16.1) |
| 3 | Throughput within 10% of pre-shed within 3 s of load returning to 16 lanes, every unloaded trial | 0 ms in the unloaded trial; 0–500 ms in the loaded four-lane trials | **met** |
| 4 | Registration under 1% of accepted per second (mean on/off difference above −1%) | +1.45% (pairs: −8.2%, −3.6%, +12.8%, +4.9%), all four pairs loaded at their end | **met by the rule, not resolved**: pair-to-pair spread is ±13%, so this run can't show a 1% effect either way. The added per-result work is one `v8.getHeapStatistics()` (0.176 µs per call) and a rate-limited estimate, against about 30 ms of wall time per attempt per lane |

## What I learned while building it

- **A shed GC inside a deadline changes verdicts.** The first sibling-layout test with repeated sheds once returned a different verdict. A Worker given a new attempt while it was still collecting garbage after a shed charged that time to the attempt's deadline. Workers now leave the idle list while they shed and return when they reply; the difference didn't reproduce in five runs after that, or in the parity run.
- **SIGUSR2 can already be taken.** `node --test` children run with `--report-on-signal` on SIGUSR2, so a signal writes a diagnostic report (with the environment) to the working directory. Three such reports appeared from my own test runs and were deleted. The helper now refuses to register a process that reports on SIGUSR2, and the Python helper refuses one whose SIGUSR2 handler is already set; the cohort, started with fixed arguments and an empty environment, checks for the same.
- **Wasm memory isn't in V8's external memory on Node 26** (it is on 22), and an isolate's own heap isn't returned to the OS when its Worker ends: on Node 26 a pool cell with an 8–11 MiB heap freed about 2 MiB. Estimates from heap statistics alone overstate; the estimates are therefore scaled by ratios measured from the process's own RSS (at boot and after each shed). The cohort's boot calibration landed within 0.68–0.77 of what a shed freed. The pool's boot calibration is unreliable: each trial was a new pool's first shed, and three were accurate (0.87–1.08) while two reported 3–5 times what they freed (101–134 MiB against 29 MiB). After a shed the pool's ratio is learned from what actually came back.
- **Reused instances in busy Workers can't be shed usefully.** Dropping them under full load freed about 240 MiB for a moment and it all came back within a second as the next checks built fresh instances; the cohort reports and drops only idle Workers' instances.

## Not shown or unverified

- Acceptance runs are Node 26.13.0 only. Node 22.23.3 ran the test suites and harness dry runs (where pool cells were much larger: about 288 MiB reported, 205 MiB freed at ratio 0.71), not the bench.
- Bar 1 rests on one unloaded trial; the other four were loaded, one of them (load 40) at 0.682.
- Bar 4 is within noise; a 1% effect wasn't resolved at this load.
- The memguard side (private PR) wasn't run against these holders; the files and signals were checked against the protocol by the tests and the bench, using temporary registry directories, not the live service.
- The pool's overestimate in two of five first sheds would miss bar 1's 70% if that bar applied to the pool; it has no bar of its own.
- After a crash or SIGKILL a holder's file stays behind naming a dead pid; memguard has to treat dead pids as stale.
