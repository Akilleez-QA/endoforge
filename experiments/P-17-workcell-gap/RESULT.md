# P-17 workcell gap 10-50 — result

Status: **Recorded (probe)**. One lifetime, 2026-11-01 18:22-18:40 ET, main-rig (AMD Ryzen 9 7950X, 16C/32T, 124 GiB RAM, Node 26.12.0). Shared desktop: Codex process count rose from 21 to 40 and the 1-minute load average from 8 to 48 during the ramp (no quiet gate). Precommit sha256 `edd203a4…cf371954`, hashed 18:21:59 ET before the first rep (`receipt/precommit.sha256`).

## Procedure as run
Harness, kernels, machinery and pinned assemblyscript 0.28.20 are byte-identical to P-15 (`receipt/module-sha256.txt`). One `node:worker_threads` Worker = one V8 isolate = one workcell, doing asc compile, instantiate, 5 gates and a hash-chained receipt per candidate. `ARM=gap`, N = 10, 12, 16, 20, 24, 28, 32, 40, 50; 3 reps; 15 s window; cores 0-27. Latency stop OFF, memory and correctness stops ON. No stop fired.

## Results
Every rep: **0 incorrect verdicts, 0 broken chains, 0 spawn failures, no memory kill.**

| N | accepted-correct/s (r1 / r2 / r3) | median | latency p50 (ms, median rep) | latency p95 (ms, range) | spawn-to-ready p50 (ms) | peak RSS (GiB) | RSS per isolate (MiB) | load 1 m at start |
|---|---|---|---|---|---|---|---|---|
| 10 | 95.3 / 88.4 / 88.9 | 88.9 | 80.8 | 122-140 | 517-609 | 2.86-3.10 | 287-312 | 8-17 |
| 12 | 98.9 / 102.0 / 92.6 | 98.9 | 89.0 | 140-161 | 609-756 | 3.32-3.77 | 279-317 | 19-21 |
| 16 | 100.5 / 85.7 / 95.8 | 95.8 | 113.0 | 194-262 | 1015-1105 | 4.69-5.40 | 297-342 | 21-27 |
| 20 | 98.2 / 116.7 / 108.6 | 108.6 | 132.8 | 210-249 | 940-1146 | 6.03-7.21 | 306-366 | 27-29 |
| 24 | 107.4 / 108.0 / 97.4 | 107.4 | 160.3 | 270-320 | 1199-1241 | 6.97-7.39 | 295-313 | 29-32 |
| **28** | **112.1 / 107.3 / 114.4** | **112.1** | 176.1 | 313-346 | 1264-1272 | 8.32-8.73 | 302-317 | 33-36 |
| 32 | 108.9 / 100.9 / 111.8 | 108.9 | 201.6 | 393-489 | 1348-1448 | 9.32-9.90 | 297-315 | 33-35 |
| 40 | 96.4 / 87.0 / 110.5 | 96.4 | 278.8 | 550-756 | 1669-1770 | 10.14-11.46 | 258-292 | 35-41 |
| 50 | 65.8 / 63.4 / 69.4 | 65.8 | 516.4 | 1017-1272 | 2055-2376 | 11.98-12.23 | 244-249 | 39-48 |

Raw per-rep records: `receipt/raw-gap/N*-r*.json`; full summary: `receipt/summary-gap.json`; log: `receipt/run-gap.log`.

## Headline
- Highest median accepted-correct/s: **N = 28, 112.1/s**, about 4.0 per core-second (28 pinned cores) and 13.2 per GiB-second (8.46 GiB peak).
- Throughput is a plateau, not a peak: N = 20-32 medians lie within 107-112/s, inside rep-to-rep spread (±10 %). N = 40 starts to fall; N = 50 loses 41 % against N = 28.
- Latency grows roughly linearly with N from 10 to 32 (p50 81 → 202 ms) and then bends: p95 doubles from 32 to 40 and again to 50.
- Memory per isolate stays near 300 MiB through 32 and falls to about 250 MiB at 50, as in P-15 (shared V8 overhead amortised).
- Bad-sign check: N = 10 medians 88-95/s lie inside the precommitted 80-130 band; they are below P-15's 99-119/s, consistent with the heavier Codex load.

## What it does not show
- Not workerd, Wasmtime or hosted limits (see P-16 for workerd).
- Not a quiet machine: load average rose monotonically with step order (8 → 48) and the Codex process count doubled, so the fall past 32 is partly the background, not only the width. Steps were not randomised.
- Not a campaign: one lifetime, 3 reps, no confidence intervals.
- Same limits as P-15: synthetic frozen contract, ledger port without schema validation, RSS per isolate includes shared V8 overhead.

## Interpretation
On main-rig under Codex load the useful width for endoforge workcells is **20-32 isolates**, with 28 the best measured point, roughly the pinned core count (R02 rule 4). P-15's "max stable = 10" was set by the latency rule, not by throughput; at the same 10x-p95 rule (baseline 46 ms) every step from 12 upward would have stopped. A pool that targets throughput should size to cores; one that targets latency should stay at or below 12.
