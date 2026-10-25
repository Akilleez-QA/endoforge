# Speed ledger

North star: wall per request and per pool. Method: decompose the critical chain (`LEDGER.md`), pick the largest bucket a focused change can remove, ledger the prediction, run, ledger the outcome. Labels: Recorded (probe) unless stated.

## Improvements

| Id | Change | Prediction | Mechanism result | North-star result | Status |
|---|---|---|---|---|---|
| S-01 | Script-first fast path: compose and no-op repair run as scripts in the isolate; the agent runs only on a miss | compose-draft + repair + compose segment from about 18 s to under 3 s; median wall at least 12 s faster | 14/15 fast-path hits; segment median 18.7 s → 1.6 s | median wall 64.5 s → 50.9 s; median paired delta -11.0 s (predicted −12: just short); pooled speedup 5.68x → 7.67x | **adopted** (on by default, `policy.scriptFirst`) |

Per request (baseline: fanout-02/03 on the same atoms.json; new: fanout-04):

| Request | Wall before (s) | Wall after (s) | Δ (s) | Segment before (s) | Segment after (s) |
|---|---|---|---|---|---|
| C-005 | 91.5 | 87.4 | -4.0 | 18.7 | 1.4 |
| C-007 | 56.9 | 45.9 | -11.0 | 17.1 | 1.3 |
| C-010 | 86.3 | 91.7 | +5.3 | 23.6 | 18.7 |
| C-015 | 61.8 | 47.0 | -14.8 | 18.1 | 1.7 |
| CC-002 | 64.5 | 50.9 | -13.6 | 21.0 | 1.6 |

C-010 got slower: its draft failed one test this time (it passed in run 3), so the model repair ran as designed and the rest of its chain was model variance. Quality: 4/5 promotable against 5/5; the miss is that same C-010 test, which the fast path never touched. n = 5, one run each.

## Where the wall goes now (after S-01, fanout-04)

| Bucket | Share of critical-chain time |
|---|---|
| model API | 68 % |
| queue (ready, waiting for a slot) | 12 % |
| Codex turns | 10 % |
| harness (bwrap + CLI start) | 7 % |
| scripts | 2 % |
| local tools | 1 % |

## Next focused candidates (Proposed; ranked by chain seconds they can remove)

- **S-02 raise per-run concurrency or pool atoms globally.** Queue is 12 % of chain time: with 4 slots per run, wave-1 atoms wait for a slot while the pool has idle capacity. One scheduler over all requests with a global limit removes the per-run cap. Test: one global queue, same total slots.
- **S-03 review tail.** Reviews are the last link of every chain (11–26 s); the Opus review is the slowest in most runs. Options: deliver the gated artefact when the gates pass and run reviews off the delivery path; or route reviews to Sonnet/Codex and keep Opus for one sampled audit. Prediction: about 15 s off median wall.
- **S-04 split test atoms.** Single-output test atoms are the slowest on-chain model turns (p50 20 s, max 33 s), dominated by output tokens. Split by export or by test family so no test atom writes more than about 1.5k tokens.
- **S-05 harness.** About 1 s per atom on the chain (CLI start, auth, settings) times six links. Measure a warm CLI or a reused isolate per run.
- **S-06 contract → interface ordering.** Interface and contract are both wave 0 but later atoms need both; whichever is slower sets the start of wave 1. Measure and shorten the slower (smaller output, or Sonnet low effort).


## Router state (18 Oct 2026)

Templated planning (about 9 s) plus the test check reaches a promotable result first on large requests (N1, N2: 6/6 paired reps, median 66 s against 97 s direct). Direct stays the default for small requests until the singles are measured on the templated arm. See `CUTOVER.md`.

## Trace and bench

Tracing defaults on; `ENDOFORGE_TRACE=0` disables it without creating a file.
`trace.jsonl` appends absolute epoch spans: run, atom, queue, setup, preflight, worker,
pool.acquire, codex.exec, isolate.home, post, verify, verify.acceptance, archive;
sched.sample marks show occupancy and trace.self records write overhead.
From forge/endoforge: `node tools/atomizer/bin/bench.mjs --atoms tools/atomizer/examples/C-005/atoms.json --n 3 --concurrency 3`.
Free replay: add `--stub --replay <finished-run-dir>`; `--stub-latency recorded --stub-scale 1` replays receipt latencies (default latency 0; numeric milliseconds also supported).
Results live in ~/.cache/endoforge-bench/bench by default; use --out-dir DIR or --label X.
Use --trace-ab to alternate tracing on/off, or --no-verify to omit verification.
Summary gives nearest-rank median/p90 and min/max: wall, measured DAG critical path,
realized chain queue/Codex/other time, pool waits, phase totals, busy time and startup.
Concurrency average is busy/wall; efficiency divides it by the configured concurrency.
A/B arms include receipt wall and bench-side process wall; errors and okReps aggregate reps.
