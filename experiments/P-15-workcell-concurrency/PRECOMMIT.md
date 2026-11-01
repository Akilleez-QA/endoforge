# P-15 workcell-concurrency — precommit

Written 2026-11-01 (America/New_York) before any measurement. Probe rules: experiments/README.md. Lives outside the lab checkout (rule 8); nothing is committed.

## Question
How many concurrent endoforge workcells (R02: RAM-resident V8 isolate holding prepared machinery, one private overlay per candidate) can main-rig hold while every candidate still yields a correct, receipted verdict, and what is the accepted-correct-candidate rate per unit of resource (R01 headline)?

## Unknown it de-risks
R02 rule 4 (a single-threaded isolate is not parallel CPU; width must be scheduled across workers) and the X4 footprint column: per-workcell resident memory and the width at which a local machine saturates. Extends P-01 (V8 instantiate 18.6 us median) and P-02 (asc in a worker, about 51 ms per compile, about 97 MB RSS per loaded compiler) from one isolate to many.

## Unit (one workcell = one node:worker_threads Worker = one V8 isolate)
Prepared once per isolate: assemblyscript@0.28.20 asc, endoforge tools/engine/gates.mjs and tools/factory_quality/index.mjs (copied unmodified from Akilleez-QA/endoforge main, commit recorded), JS port of tools/ledger/ledger.py encode() and event_hash().
Per candidate, entirely inside the isolate: (1) private in-memory overlay holding the kernel source; (2) asc compile from the overlay, zero fs; (3) WebAssembly.compile and a fresh instance per run; (4) runUniversalGates (schema, interface, bounds, determinism, forbidden_effects) with a port that runs the kernel (initState, 100 step events, convertUnit) on frozen cases; (5) a ledger receipt appended to the hash chain owned by that isolate.
Candidates: P-02 kernels k00-k19 with --noAssert (17 clean expected accept; k05, k11, k17 expected reject at compile), plus k00 and k01 built with assertions (expected reject at forbidden_effects because of the env.abort import). Expected verdicts are fixed here.
Correct completion = verdict equals expectation AND the host recomputes the receipt hash chain and it validates. Only correct completions count.
Outside the isolate: worker spawn, receipt verification, resource measurement (VmRSS of the bench process and /proc/meminfo, read by a separate parent process). The JSON-schema validate() of ledger.py is NOT ported; only encode and event_hash.
No model calls. No network after setup.

## Procedure
setup.sh pins deps. run.mjs (idempotent: skips reps whose raw file exists) runs the bench host pinned with taskset to cores 0-27 (4 cores left free). Ramp N = 1, 10, 50, 100, 250, 500, 1000, 2000, ... Each step 3 repetitions. Each rep: spawn N workcells, wait until all are ready, run candidates round-robin for a 15 s window, collect, verify, exit.

## Metrics per rep
isolates alive, spawn-to-ready per isolate (median/p95/min/max), per-candidate latency (median/p95/min/max, n), correct completions/s, accepted-correct/s, incorrect count, peak RSS of the bench process, RSS per isolate = (peak RSS - host-only RSS)/N, MemAvailable min, loadavg, Codex process count before/after.

## Headline
Accepted correct candidates per core-second and per GB-second of RSS; isolate count is the explaining number.

## Stop rule (any)
- MemAvailable < 20% of MemTotal at any sample (keeps total use under 80%, stricter than the 15% abort): kill the step.
- Pre-step projection (per-isolate RSS from the previous step x N) would cross that line: step not run, recorded as projected OOM risk.
- p95 candidate latency > 10x the N=1 p95.
- Any spawn failure or any incorrect completion.
Max stable = largest N whose 3 reps all finish with no stop condition.

## Bad sign
Any incorrect verdict at N=1; per-isolate RSS well above the P-02 figure; Codex workers visibly stalled.

## What it will not show
Not workerd, not Wasmtime, not hosted limits; one machine, one lifetime, shared desktop with Codex workers running (no quiet gate). Recorded (probe), not a campaign.

## Amendment 1 (2026-11-01 13:16 ET, after a 3 s N=1 harness check, before any recorded rep)
The harness check (77 candidates) showed k00/k01 built with assertions import nothing under --runtime stub, so they were accepted and the precommitted expectation was wrong; no kernel/gate defect. Replaced: the two negative controls are now k00 and k01 (noAssert) with one line appended to their overlay declaring an external env.clock and exporting tick() that calls it. Expected verdict: reject:forbidden_effects (static import scan finds env.clock). The run port supplies env.clock so bounds and determinism still execute. Original hash kept in receipt/precommit-original.sha256.

## Amendment 2 (2026-11-01, after the main ramp stopped at N=50 on the latency rule, before any residency rep)
Main-ramp result stands as precommitted (max stable = 10). Separately labelled residency arm, to answer how many prepared workcells can be held live: N = 100, 150, 200, 3 reps, 5 s window, same correctness rule (every completion must be correct), latency stop rule OFF, memory stop and projection rule ON. Results under receipt/raw-residency/ and receipt/summary-residency.json. This arm measures holding capacity, not useful throughput.
