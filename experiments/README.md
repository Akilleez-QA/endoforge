# Experiments

Recorded probes with their precommit, harness, and receipts. Each probe keeps a
precommit hashed before measurement and a result that states what it does not show.

<!-- experiments-index:begin -->
| Probe | Question | Result |
|---|---|---|
| [P-15](P-15-workcell-concurrency/RESULT.md) | Workcell concurrency in V8 isolates on one host | [RESULT.md](P-15-workcell-concurrency/RESULT.md) |
| [P-16](P-16-workerd-isolates/RESULT.md) | Standalone workerd throughput and memory breach isolation | [RESULT.md](P-16-workerd-isolates/RESULT.md) |
| [P-17](P-17-workcell-gap/RESULT.md) | Workcell throughput between 10 and 50 isolates | [RESULT.md](P-17-workcell-gap/RESULT.md) |
| [P-18](P-18-pool-breach/RESULT.md) | Thread/process pool memory breach containment at N=8 | [RESULT.md](P-18-pool-breach/RESULT.md) |
| [P-19](P-19-need-to-candidate/RESULT.md) | Need intake to candidate selection: real stage latency and missing synthesis/promotion links | [RESULT.md](P-19-need-to-candidate/RESULT.md) |
| [P-20](P-20-pool-speed-rerun/RESULT.md) | Old compile/precompiled probes through the real thread/process isolate pool | [RESULT.md](P-20-pool-speed-rerun/RESULT.md) |
| [P-20 addendum](P-20-pool-speed-rerun/RESULT.md#addendum-2026-11-01-earliest-baselines-inside-isolatepool) | P-01/P-02/P-05 and 10-29 ramp re-measured through IsolatePool; P-05 blocked by WASM guard | [receipt](P-20-pool-speed-rerun/receipt/addendum-2026-11-01/summary.json) |
| [P-21](P-21-x1-twenty-rerun/RESULT.md) | The twenty loop-0 requests re-run with Codex workers against Oct 17 and Oct 18 | [RESULT.md](P-21-x1-twenty-rerun/RESULT.md) |
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
| [P-50](P-50-in-isolate/PRECOMMIT.md) | The candidate and agent loop inside one workcell: 0 spawns and temp files up to commit, verdicts match on 31 inputs, no false promotion under real kills; non-model time 132–134 ms p50 and 326–357 ms p95 against 1,472 and 1,759 ms, missing the 100 ms line | [RESULT.md](P-50-in-isolate/RESULT.md) |
| [P-51](P-51-escape-rate/PRECOMMIT.md) | How often seeded faults get past the real gate path, no model calls: 441 of 7,883 kernel faults promoted (5.6%, sampled, not searched); at least 92.7% in a simulation where tests fully share the fault, a floor for that simulation and not an estimate of how often correlation happens; 86.5% of label-only glue faults | [RESULT.md](P-51-escape-rate/RESULT.md) |
| [P-52](P-52-real-gates/PRECOMMIT.md) | Gates that measure the candidate: real universal gates, fuel, a contract-judged non-finite probe and glue checks. On P-51's corpus, sampled escapes 441 to 280 of 7,883, glue 691 to 295 of 799, no stall refusals, about 1 ms per candidate; 176 of 177 pristine promote, so the bar isn't met | [RESULT.md](P-52-real-gates/RESULT.md) |
| [P-53](P-53-library-v0/PRECOMMIT.md) | Library v0: when a promoted kernel can stand in for generation, and when it serves the wrong one: 3/118 P-21 and 45/59 add held-out hits; 0/5,493 false hits where tests carry the fault, but 93/313 where nothing frozen differs; stays off | [RESULT.md](P-53-library-v0/RESULT.md) |
| [P-54](P-54-contained-js/PRECOMMIT.md) | Compatibility-lane JavaScript in a child isolate: one supervised cohort of reused Workers matches one process per cell in attempts per second (about 19,000 a second at width 16) at a third of the memory, 178 active attempts in 4 GiB to 55–59; a V8 fatal error loses the attempts in flight as `outcome_unknown`; 0 authority reached by 67 attacks on Node 22 and 26 | [RESULT.md](P-54-contained-js/RESULT.md) |
| [P-55](P-55-code-label-basis/PRECOMMIT.md) | The G7 code-label rule refuses only where the contract's code table is its only statement of the result. All 177 pristine promote; glue escapes 295 to 312 of 799, inside the precommitted allowance; sampled unchanged at 280. The correlated arm caught more than predicted, and 4 of 172 `base` kernels were refused by the scalar test filter before any gate | [RESULT.md](P-55-code-label-basis/RESULT.md) |
| [P-55](P-55-constraints/PRECOMMIT.md) | Do user constraints survive our compaction summaries? | 87.9% at first compaction (17% claim not confirmed), 20.7% at the last; extractors below the adoption bar: [RESULT.md](P-55-constraints/RESULT.md) |
| [P-56](P-56-evaluator-synthesis/PRECOMMIT.md) | Evaluator synthesis before any candidate, through P-51's unmodified harness. Same tree, synthesis off to on (two agreeing evaluators): sampled P-21 escapes 280 to 105 of 7,883, rounding 107 to 12, glue 312 to 184 of 799, 177 of 177 pristine. The glue half of the bar (at most 156) isn't met | [RESULT.md](P-56-evaluator-synthesis/RESULT.md) |
| [P-56](P-56-model-effort/PRECOMMIT.md) | Model and effort through the in-isolate agent loop: `sonnet-low` recommended at 27.4 s per accepted capability against 49.6 s for `opus-high`; six of eight arms good enough, both Haiku arms fail quality; 0 held-out escapes; most failed candidates came from wrong frozen tests | [RESULT.md](P-56-model-effort/RESULT.md) |
| [P-57](P-57-release-waits/PRECOMMIT.md) | Waiting releases compute: no cell held during a model wait (0 of 225 sends), 4 cells carry 64 candidates at 8.1× the throughput and 11.5× the in flight per GiB, 6 ms added per resume; the single ledger bridge becomes the width limit | [RESULT.md](P-57-release-waits/RESULT.md) |
| [P-58](P-58-cohort-typecheck/PRECOMMIT.md) | The contained route's type check moved into the cohort: 380–516 accepted per second at width 16 against 58–63 on the supervisor, 0 verdict differences in 80, fatal losses confined to attempts in flight; missed 700 per second and the CPU bar (45 against 27.3 ms per accepted), so the default stays on the supervisor | [RESULT.md](P-58-cohort-typecheck/RESULT.md) |
| [P-59](P-59-ledger-writer/PRECOMMIT.md) | A group-commit ledger writer, one journal `fdatasync` per batch: the ledger alone carries 94.7 accepted candidates/s (15.2× P-57's bridge) at 0.22 disk syncs per candidate against 24.3; `swarm-release-256` non-model p50 18.4 s to 2.0 s; 24 of 24 SIGKILL trials keep every acknowledged event once | [RESULT.md](P-59-ledger-writer/RESULT.md) |
| [P-60](P-60-tscheck-snapshot/PRECOMMIT.md) | A cheaper type check in the cohort: a host-side post-lib snapshot isn't reachable, so a reused tsrs instance restored from its image plus a host-owned incremental baseline: 649–702 accepted per second at width 16 against 443–510 fresh, 23.6 ms CPU per accepted against 32.0 on the supervisor, 0 verdict or emit differences in 132 plus 15 sequences; missed 700 per second and the memory bar (65.7 against 49.1 MiB per active), made the cohort default by the precommitted rule | [RESULT.md](P-60-tscheck-snapshot/RESULT.md) |
| [P-63](P-63-usl-width/PRECOMMIT.md) | Can a Universal Scalability Law fit set width? Fits to P-54/P-58/P-60 missed the 10% bar at new widths in all three workloads (up to 27% on the routes); the fitted N* of 17–18 is heavy-run's 17.9-CPU quota, and cycles per attempt more than double with flat instructions, so width 16 stays | [RESULT.md](P-63-usl-width/RESULT.md) |
| [P-64](P-64-streaming-check/PRECOMMIT.md) | Acting on the reply while it streams (91 `claude -p` calls, recorded-stream replay): the reply only streams with `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1`; the post-token tail was 1.6% of latency, and a pre-check cut it 61–70% but end-to-end only 0.45–1.1%, missing 15%; early refusal stopped 4 of 9 failing turns and 127 of 127 seeded mutants about 3 s early with no false refusal; a fail-triggered hedge cost 0.097 per useful second and gained nothing | [RESULT.md](P-64-streaming-check/RESULT.md) |
| [P-66](P-66-best-of-n/PRECOMMIT.md) | Best of n against one smart attempt, cost-matched, with a per-need router: `bo1` (Sonnet low ×1) wins at 0.056 LEU per promoted and 99.5% pass; `opus-high` costs 3.2× at 100% and twice the p50 time; `bo2`/`bo4` match Opus on pass at half its time but cost 1.9×/3.8× `bo1`; failures barely correlated (ICC 0.18); 5 of 6 failures were wrong frozen values; router bar missed by its 10% exploration | [RESULT.md](P-66-best-of-n/RESULT.md) |
| [P-67](P-67-adaptive-width/PRECOMMIT.md) | A capacity planner (`core/runtime/capacity/`, Mjölnir) that picks width, placement and split from the machine: the online tuner missed bars 1–4 on a loaded shared slice (199 against 422 accepted/s for width 16 in its worse round, because it yields to peers by design, plus a fixed bound-churn defect); 0 verdict changes; pinning cut cross-CCX fills 31–34× with no IPC gain. Ships with the best fixed arm as default, one pinned cohort per L3 domain at core width: 507 against 422 accepted/s | [RESULT.md](P-67-adaptive-width/RESULT.md) |
<!-- experiments-index:end -->

The table is generated: don't edit it here. Each probe's row lives in its own `INDEX.md` (the table header plus one or more rows, with links relative to the probe's directory), and `make index` rebuilds this list in number order. `make check` fails if the committed list is stale.

Parallel lanes reused P-55 and P-56 before the allocator existed, so the full directory name, such as `P-55-constraints`, `P-56-model-effort` or `P-56-evaluator-synthesis`, is the experiment ID. [ALLOCATED](ALLOCATED) records both as `legacy-duplicate`.

## Adding a probe

1. **Reserve the number** with `python3 tools/experiment_id.py reserve <slug>`. It claims `refs/tags/experiment-id/P-NN` on `origin`, a create-only push that fails if another lane already took that number, and on failure it tries the next number. Then it appends `P-NN  <slug>` to [ALLOCATED](ALLOCATED) and commits that file alone. Never choose a number by hand. `make check` fails on a probe directory that isn't in `ALLOCATED`, and on any number listed twice that isn't a recorded legacy duplicate.
2. **Create `experiments/P-NN-<slug>/INDEX.md`** with the table header and your row, then run `make index`.
3. **List new source digests** with `make sums`. Use `python3 tools/source_sums.py --add <path>` to add a path to `sources/SHA256SUMS`, or `--remove <path>` to drop one.
4. **New test files** need no Makefile edit when they sit in an existing test directory. The test targets discover them by glob.

When a merge conflicts in `experiments/README.md` or `sources/SHA256SUMS`, take either side and run `make index sums`. `ALLOCATED` merges as a union through `.gitattributes`. Merge with `git -c rerere.enabled=false merge origin/main`.

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
