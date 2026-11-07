# Experiments

Recorded probes with their precommit, harness, and receipts. Each probe keeps a
precommit hashed before measurement and a result that states what it does not show.

| Probe | Question | Result |
|---|---|---|
| [P-15](P-15-workcell-concurrency/RESULT.md) | Workcell concurrency in V8 isolates on one host | [RESULT.md](P-15-workcell-concurrency/RESULT.md) |
| [P-16](P-16-workerd-isolates/RESULT.md) | Standalone workerd throughput and memory breach isolation | [RESULT.md](P-16-workerd-isolates/RESULT.md) |
| [P-17](P-17-workcell-gap/RESULT.md) | Workcell throughput between 10 and 50 isolates | [RESULT.md](P-17-workcell-gap/RESULT.md) |
| [P-18](P-18-pool-breach/RESULT.md) | Thread/process pool memory breach containment at N=8 | [RESULT.md](P-18-pool-breach/RESULT.md) |
| [P-21](P-21-x1-twenty-rerun/RESULT.md) | The twenty loop-0 requests re-run with Codex workers against Oct 17 and Oct 18 | [RESULT.md](P-21-x1-twenty-rerun/RESULT.md) |
| [P-19](P-19-need-to-candidate/RESULT.md) | Need intake to candidate selection: real stage latency and missing synthesis/promotion links | [RESULT.md](P-19-need-to-candidate/RESULT.md) |
| [P-20](P-20-pool-speed-rerun/RESULT.md) | Old compile/precompiled probes through the real thread/process isolate pool | [RESULT.md](P-20-pool-speed-rerun/RESULT.md) |
| [P-20 addendum](P-20-pool-speed-rerun/RESULT.md#addendum-2026-11-01-earliest-baselines-inside-isolatepool) | P-01/P-02/P-05 and 10-29 ramp re-measured through IsolatePool; P-05 blocked by WASM guard | [receipt](P-20-pool-speed-rerun/receipt/addendum-2026-11-01/summary.json) |
| [P-22](P-22-real-need-to-candidate/README.md) | Real generation, pool gates and local qualification: 41/60 promoted; generation is ~99% of latency | [RESULT.md](P-22-real-need-to-candidate/RESULT.md) |
| [P-23](P-23-generator-rerun/PRECOMMIT.md) | Contract-up-front generator, resumed sessions and auto effort: 0 precision refusals, about 2x faster, but only 26/60 promoted (G4 regression) | [RESULT.md](P-23-generator-rerun/RESULT.md) |
| [P-24](P-24-g4-ablation/PRECOMMIT.md) | Session x effort ablation on the P-21 cohort: neither factor raises G4; 43/45 G4 refusals use `assert(`, 0/34 promotions do | [RESULT.md](P-24-g4-ablation/RESULT.md) |
| [P-25](P-25-pool-ledger/PRECOMMIT.md) | Supervisor ledger confirmed as the pool limit (L1); persistent batched ledger bridge raises width-16 throughput from 11.89 to 152.9 checks/s with full chain verification | [RESULT.md](P-25-pool-ledger/RESULT.md) |
| [P-26](P-26-cell-spawn/PRECOMMIT.md) | Cell spawn and instantiate overhead: Node 26 spawn 2 s to 63–73 ms (S1 pass); pre-warm halves first-job latency but the lazy ledger bridge start keeps it above 1.2x the second job (S2 miss); with the bridge started in ready() (Nov 2) first job 9.9–13.0 ms against about 1 ms, S2 still a miss | [RESULT.md](P-26-cell-spawn/RESULT.md) |
| [P-27](P-27-g4-fix/PRECOMMIT.md) | P-23 re-run after the no-assert generator fix: 57/60 promoted, 0/60 kernels use `assert(`, every total p50 within 20% of P-23 | [RESULT.md](P-27-g4-fix/RESULT.md) |
| [P-28](P-28-p21-nov2/PRECOMMIT.md) | The twenty P-21 requests end to end through runNeed in a pre-warmed thread pool on Nov 2: 16/20 promoted, median 72.6 s, wall 168.3 s (T1–T3 miss; the time goes to Codex) | [RESULT.md](P-28-p21-nov2/RESULT.md) |
| [P-29](P-29-hillclimb/) | Hill-climb round 1: generator self-check, 3x30 per arm | No gain: 29.00 vs 28.67 promoted, p50 65.7 vs 68.0 s; stays off |
| [P-43](P-43-tsrs-workcell/PRECOMMIT.md) | The TypeScript checker in the workcell pool, blocked in P-20: parity on 20 of 20 synthetic projects against TS 7.1 beta, throughput flat by 8 cells, 0 of 7 siblings lost on a heap breach after an invalid first run | [RESULT.md](P-43-tsrs-workcell/RESULT.md) |
| [P-44](P-44-offheap/PRECOMMIT.md) | Off-heap allocation through the pool: 3 GiB past a 128 MiB heap passes in thread mode and in process mode without a cgroup; `memory.max` alone also failed to stop it until `memory.swap.max=0` was set | [RESULT.md](P-44-offheap/RESULT.md) |
| [P-45](P-45-shared-module/PRECOMMIT.md) | One guard-instrumented module shared across thread cells: at 8 cells, 56% less peak RSS and 60% less time to first results; the compile cost was the guard's JavaScript instrumentation, not V8 | [RESULT.md](P-45-shared-module/RESULT.md) |
| [P-46](P-46-prewarm/PRECOMMIT.md) | Loading host warm state in `ready()`: first job down 82% with the same total; a trivial probe check didn't help and was removed | [RESULT.md](P-46-prewarm/RESULT.md) |
| [P-47](P-47-process-stack/PRECOMMIT.md) | `stackSizeMb` in process cells: the V8 flag alone dies with SIGSEGV; with the rlimit raised first, no probe died and diagnostics matched thread mode | [RESULT.md](P-47-process-stack/RESULT.md) |
| [P-48](P-48-width/PRECOMMIT.md) | What limits checker throughput at width: the evaluator's per-call frozen-check process, near 50–70 calls/s at any width; the compiler alone reached 96 checks/s; thread cells' shared address space is second; the ledger and desktop aren't the limit | [RESULT.md](P-48-width/RESULT.md) |
| [P-49](P-49-incremental/PRECOMMIT.md) | `.tsbuildinfo` feedback between checks: one-file edit 65–80% faster, no diagnostic difference in 220 comparisons, widely imported type edit 18–33% slower | [RESULT.md](P-49-incremental/RESULT.md) |
| [P-51](P-51-escape-rate/PRECOMMIT.md) | How often seeded faults get past the real gate path, no model calls: 441 of 7,883 kernel faults promoted (5.6%, sampled, not searched); at least 92.7% in a simulation where tests fully share the fault, a floor for that simulation and not an estimate of how often correlation happens; 86.5% of label-only glue faults | [RESULT.md](P-51-escape-rate/RESULT.md) |
| [P-53](P-53-library-v0/PRECOMMIT.md) | Library v0: when a promoted kernel can stand in for generation, and when it serves the wrong one: 3/118 P-21 and 45/59 add held-out hits; 0/5,493 false hits where tests carry the fault, but 93/313 where nothing frozen differs; stays off | [RESULT.md](P-53-library-v0/RESULT.md) |
| [P-54](P-54-contained-js/PRECOMMIT.md) | Compatibility-lane JavaScript in a child isolate: one supervised cohort of reused Workers matches one process per cell in attempts per second (about 19,000 a second at width 16) at a third of the memory, 178 active attempts in 4 GiB to 55–59; a V8 fatal error loses the attempts in flight as `outcome_unknown`; 0 authority reached by 67 attacks on Node 22 and 26 | [RESULT.md](P-54-contained-js/RESULT.md) |

Rebuild P-15 dependencies with `setup.sh` in its directory; `node_modules` is not committed.

## Rules

A probe turns one named unknown into a recorded number on one machine. It is not a campaign: it runs once, without the quiet gate, calibration or replication a campaign requires, so its result may narrow a design decision but never stands in for a campaign result.

1. **Precommit before run.** `PRECOMMIT.md` states the question, the unknown it de-risks, the procedure, the metrics, what counts as a bad sign and the stop rule. Hash it before the first measurement: `sha256sum PRECOMMIT.md > receipt/precommit.sha256`.
2. **One directory per probe**, `experiments/P-nn-<slug>/`, with `PRECOMMIT.md`, the runnable, setup for pinned dependencies, `receipt/` and `RESULT.md`.
3. **Capture the environment**: kernel, CPU, load before and after, memory, tool versions, this repository's commit and exact module hashes.
4. **Keep raw samples.** Summaries report median, p95, min, max and n. Do not claim a confidence interval from a single lifetime.
5. **`RESULT.md` says what it does not show**, in a section with that name, before any interpretation.
6. **Claim nothing beyond the probe.** A compiler run in a Node worker does not show it runs under Wasmtime; say so.
7. **Keep dependencies local** to the probe (`node_modules/`, binaries under `.tools/`), ignored by git, with versions and hashes in `receipt/`.

## Earlier probes

P-01 to P-14 ran before this repository's first commit and are not published here, so a result that cites one, such as P-20 citing P-01, P-02 and P-05, carries the numbers it needs. Numbering continues from one sequence.
