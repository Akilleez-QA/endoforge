# P-17 workcell gap 10-50 — precommit

Written 2026-11-01 (America/New_York) before any measurement. Probe rules: experiments/README.md.

## Question
Where between 10 and 50 concurrent endoforge workcells does accepted-correct throughput peak on main-rig, and how do p50/p95 latency and memory per isolate move across that range?

## Unknown it de-risks
P-15 measured N=1, 10, 50 only. The practical width (R02 rule 4) lies in the untested 10-50 range.

## Unit
Identical to P-15: one node:worker_threads Worker = one V8 isolate = one workcell. Same host.mjs, worker.mjs, run.mjs, kernels, machinery and pinned assemblyscript 0.28.20 as P-15 (files copied byte for byte; hashes in receipt/module-sha256.txt). Same 22 candidates and fixed expected verdicts (17 accept, 3 reject:compile, 2 reject:forbidden_effects).

## Procedure
ARM=gap, RAMP=10,12,16,20,24,28,32,40,50, 3 reps per step, 15 s window, bench pinned to cores 0-27. Latency stop rule OFF (every step runs, the full curve is the answer). Memory stop and projection rule ON. Correctness rule ON: any incorrect verdict or broken chain stops the ramp.

## Metrics
Same as P-15: correct/s, accepted-correct/s, latency p50/p95, spawn-to-ready, peak RSS, RSS per isolate, min MemAvailable, loadavg, Codex process count.

## Headline
N with highest median accepted-correct/s across its 3 reps; accepted-correct per core-second and per GiB-second at that N.

## Bad sign
Any incorrect completion; N=10 accepted/s outside 80-130 (P-15 range 99-119) would indicate host load drift.

## What it will not show
Not workerd, Wasmtime or hosted limits. One lifetime, shared desktop with Codex workers (no quiet gate). Recorded (probe), not a campaign.
