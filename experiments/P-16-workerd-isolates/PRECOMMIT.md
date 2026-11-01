# P-16 workerd workcell isolates — precommit

Written 2026-11-01 (America/New_York) before any measurement. Probe rules: experiments/README.md. One harness smoke check (2 services, 4 units, no timing kept) preceded this file.

## Question
Under workerd, how do N concurrent endoforge workcell isolates perform, and when one isolate breaches a memory limit, is the limit enforced and does the breach kill only that isolate or the whole process?

## Unknown it de-risks
P-05 ran workerd one request at a time: `--max-old-space-size=128` was enforced only as a process-fatal OOM, WebAssembly memory was unbounded (peak 351.6 MiB). P-15 measured node worker_threads isolates only. Neither tested many isolates in one workerd process or breach containment.

## Unit
One workerd service = one V8 isolate = one workcell, each with its own HTTP socket. workerd 1.20261101.1 (npm, pinned; sha256 in receipt/workerd.txt), compatibilityDate 2026-09-01, v8Flags `--max-old-space-size=128`. Each isolate holds endoforge tools/engine/gates.mjs and tools/factory_quality/index.mjs (copied unmodified, same as P-15), the 22 P-15 candidates as precompiled wasm module bindings, and a JS port of ledger encode/event_hash. Per request, inside the isolate: instantiate the candidate module, runUniversalGates (5 gates), append a receipt to that isolate's hash chain. Candidates are compiled once by asc 0.28.20 outside workerd, because workerd forbids runtime wasm code generation; compile rejects (k05, k11, k17) are fixed at build time and receipted in the isolate.
Correct completion = verdict equals the P-15 expectation AND the host re-hashes the chain successfully.

## Procedure
Throughput arm: N = 1, 10, 20, 50; 3 reps; 15 s window; one sequential client loop per isolate; workerd pinned to cores 0-27. Stop a step on any incorrect verdict, broken chain, request error or failed start.
Limit arm: N = 10, 3 reps each of (a) JS heap: 200 MiB of on-heap double arrays allocated in isolate w0; (b) wasm: WebAssembly.Memory grown by 256 MiB and touched in w0. Before and 1 s after: one unit on every isolate, process RSS, exit status.

## Metrics
correct/s, accepted-correct/s, latency p50/p95, spawn-to-ready, process peak RSS, RSS/N, MemAvailable min; limit arm: breacher response, process exit, survivors answering (0-9), RSS before/after.

## Outcomes defined now
Enforced-contained: breacher fails, process alive, 9/9 survivors correct. Enforced-fatal: process exits, survivors fail. Unenforced: alloc returns 200 and RSS rises by about the allocation.
Expected from P-05: JS heap enforced-fatal; wasm unenforced.

## What it will not show
Not Cloudflare production (its enforcer differs from standalone workerd). Not in-isolate asc compile. One machine, one lifetime, shared desktop with Codex workers. HTTP loopback cost is included in latency. Recorded (probe), not a campaign.
