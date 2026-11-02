# P-19 need in, promoted candidate out — precommit

## Question and boundary

Can the checked-out Endoforge engine > POODO control > Foundation adapters to
cstack ports turn a small software need into a promoted candidate? Where does
the actual pipeline break, and what latency do its implemented stages impose?
This precommit and its SHA-256 are written before harness execution or measurement.

The need is a pure `add(a, b)` JavaScript function for integer inputs in [-10, 10].
Six tests cover (0,0), (2,3), (-4,3), (10,-10), (-10,-10), (10,10).
Expected results come from real cstack POODO calls to pinned Foundation Math's
`exact_scalar` addition, adapting its existing scalar-and-negative fixture.
Checkpoints remain preauthored; this is not a POODO reasoning trial.

Inspection already shows missing synthesis dispatch in cstack's EndoforgePort
and missing cross-repository promotion decision issuance. These must remain
reported gaps. Only these missing generation/selection links get explicitly
synthetic stand-ins: preauthored addition/subtraction candidates and local
frontier artifact export. No model calls, invented port, or claim of authorized
promotion. Standalone poodo supplies instructions, not an executable intake API.

## Stages and procedure

1. cstack intake/control/Foundation execution with configured witnessed ledger.
2. Admit task/input and freeze candidate-blind evaluator files/configuration in
   the real Endoforge SQLite ledger, before materializing candidate files.
3. Synthetic generation: write fixed positive addition and negative subtraction
   implementations; register exact candidate bytes in the ledger.
4. A size-one IsolatePool runs the real evaluator and universal gates, custom
   executable tests/invariant/residual callbacks, and durable pool receipts.
5. Reopen and verify both independent ledger chains, receipt hashes and exact
   candidate/oracle bindings; require the expected negative rejection.
6. Synthetic promotion: export only the frontier candidate and a manifest,
   explicitly withholding real POODO/lifecycle promotion authority.
7. Close the pool. Total spans stages 1–7, including subprocess startup, file
   writes, durable receipts and shutdown; excludes raw receipt export afterward.

Run N=30 per isolation mode (thread and process), alternating modes, serial jobs,
fresh pool and temporary ledger/evaluator directory per run. No discarded warmups,
no retries, no outlier deletion. A failed run is retained and stops measurement;
do not silently replace it to reach N. Use `flock /tmp/ef-bench.lock` for the
measurement loop only. Setup, reading and repository checks run outside the lock.
Generated databases and workspaces stay under /tmp; sanitized receipts and selected
artifacts are exported to this experiment's receipt directory as requested.

## Metrics and acceptance

Record per-run stage/total monotonic wall milliseconds; per-mode p50/p95 use
nearest rank (ceil(p*N), one-based). The bottleneck is the stage with greatest
p50, separately per mode. Record loadavg before/after, UTC times, Node and Python
versions, platform/CPU count, repository revisions/status, source/harness hashes,
precommit digest, result reports, verified receipt hashes and output artifact hash.

Probe pass requires all 60 runs: cstack completed with six exact results and 18
witnessed records (two precommits and one outcome per request); both chains valid;
positive candidate alone on the frontier with both evaluation rounds passed;
subtraction rejected by executable tests; exactly two correctly bound pool
receipts; exported bytes match the selected candidate digest. Overall architectural
success additionally requires real synthesis dispatch and real promotion authority;
synthetic stand-ins cannot satisfy that criterion.

Near-realtime screening target: p95 total <=1000 ms per mode for this tiny local
probe. Missing real stages make this a component latency screen, not a prediction
for coding-agent latency. Preserve failures and actual measurements regardless.

## What would falsify

Wrong or accepted negative candidate, a failed/tampered chain accepted as valid,
changed oracle/candidate bytes, missing receipts, or synthetic output described
as real promotion falsifies probe correctness. Finding an implemented synthesis
or promotion bridge in the inspected interfaces would falsify the gap hypothesis
and require documenting it rather than retaining an unnecessary stand-in.
Total p95 above 1000 ms falsifies the screening target in that mode.

## What it will not show

Autonomous need decomposition, standalone POODO behavior, live coding agents,
cache benefit, authorized lifecycle promotion/activation, arbitrary JavaScript
safety, general correctness beyond six tests, concurrency throughput, memory
containment, quiet-host performance, or production durability qualification.
Host callback signature/effect checks and bounded expression execution are
specific to this tiny candidate grammar; heap delta and operation counts are
callback usage measurements, not independent process resource enforcement.
