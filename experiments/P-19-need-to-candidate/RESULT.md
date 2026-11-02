# P-19 need in, promoted candidate out — result

**The component probe passed 60/60 runs; the planned architecture remains
incomplete.** Real cstack control and Foundation execution fed frozen tests to
the real Endoforge isolate evaluator and ledger. Generation and final selection
used explicitly synthetic stand-ins. No real POODO-authorized promotion occurred.
Both modes failed the precommitted <=1000 ms total-p95 latency screen.

The [precommit](PRECOMMIT.md) was written and hashed before harness execution.
Its SHA-256 is `9c3e517e7bdc9f2a093da6b0a09f82c021e99372f2ccb7ed8b6d0390f4ac56e0`;
the [receipt](receipt/precommit.sha256) and harness check bind that exact file.
There were no amendments, discarded warmups, retries, failed runs or exclusions.

## Procedure and evidence

Measured 2026-11-02 00:30:01.920–00:31:59.560 UTC (2026-11-01 Eastern),
30 runs per mode, alternating thread/process, serial execution, fresh size-one
pool and temporary workspace per run. `flock /tmp/ef-bench.lock` held the
measurement loop only. Node v26.12.0; cstack venv and engine PATH Python both
3.14.8; Linux x64 with 32 available CPUs. Versions, source/harness digests,
repository revisions and initial status are in [env.json](receipt/env.json).
Load averages changed from 9.50/9.04/8.26 to 8.49/8.87/8.29 (1/5/15 minutes),
retained in [before](receipt/env-before.json) and
[after](receipt/env-after.json). This was a shared host with no quiet-host gate
or CPU affinity restriction.

The need was executable integer `add(a,b)` for inputs in [-10,10]. Six actual
cstack `exact_scalar` calls observed (0,0), (2,3), (-4,3), (10,-10), (-10,-10),
and (10,10). The harness adapted the existing scalar-and-negative fixture into
a goal and six capability requests; its checkpoints remained preauthored.
Each observed exact result also had to match the independent fixed expectation.

Before candidate files were materialized, the real `FrozenEvaluators.freeze`
stored a candidate-blind evaluator containing the host-port code, tests and
gate configuration. Preauthored `(a,b)=>a+b` and `(a,b)=>a-b` expressions then
stood in for unavailable synthesis. The real `IsolatePool.run` executed
`evaluateCandidates`, all five universal gates, executable invariant and
residual checks, a source-byte metric and finalist re-evaluation.

Every run produced:

- Six completed Foundation outcomes and 18 verified cstack witness records:
  six decision precommits, then an execution precommit/outcome per request.
- Seven verified Endoforge SQLite records: task, admitted input, frozen
  evaluator, two candidates and two pool receipts with matching stored hashes.
- Addition passing both rounds and alone on the frontier; subtraction passing
  universal gates then rejected at `invariant:exact_addition`.
- One exported addition artifact with matching SHA-256, `synthetic: true` and
  `realPromotion: false`. Selection did not issue a fake decision reference.

Totals: 360 real Foundation calls, 1,080 cstack witnessed records, 420 Endoforge
records including 120 candidate receipts, and 60 selected artifacts. Both existing
chain verifiers reopened their storage every run. A separate standard-library
replay recomputed all 120 exported chain hashes, checked 60 artifact digests and
recalculated every percentile using [verify.py](verify.py). Its evidence is in
the [verification receipt](receipt/verification.json).
Raw runs retain both chains' records and the complete evaluator reports, for
example [thread-01.json](receipt/raw/thread-01.json) and
[process-01.json](receipt/raw/process-01.json). The corresponding selected
[artifact](receipt/output/thread-01.mjs) and [manifest](receipt/output/thread-01.json)
are reviewable.

## Latency

Milliseconds, nearest-rank quantiles over 30 observations per column/mode.
Stages do not overlap; total includes shutdown and intervening orchestration.
Total excludes subsequent raw JSON and selected-artifact export into `receipt/`.
The synthetic selection stage includes the original workspace artifact/manifest
writes. Percentiles of stages need not sum to the total percentile.

| Stage | Thread p50 | Thread p95 | Process p50 | Process p95 |
|---|---:|---:|---:|---:|
| cstack intake/control/Foundation | 1354.47 | 1445.61 | 1342.71 | 1496.83 |
| Admit input and freeze evaluator | 61.99 | 77.86 | 62.41 | 79.17 |
| Synthetic generation and candidate registration | 61.79 | 70.72 | 62.11 | 76.22 |
| Pool evaluation and receipt append | 373.20 | 471.18 | 403.48 | 520.11 |
| Reopen and verify both chains | 65.09 | 78.51 | 68.78 | 82.71 |
| Synthetic selection and workspace export | 0.16 | 0.26 | 0.17 | 0.37 |
| Pool shutdown | 1.11 | 1.60 | 3.80 | 6.74 |
| **Total** | **1925.46** | **2118.94** | **1957.18** | **2155.93** |

The bottleneck in both modes was **cstack intake/control/Foundation execution**.
Its median is about 69–70% of median total; these are ratios of medians, not
per-run attribution estimates. The pool is second. It includes cold workcell
startup, Python receipt preparation, repeated Python frozen-content verification,
actual gate/check execution and durable receipt append. This probe does not
separate those internal costs. The process/thread difference is descriptive;
30 alternating shared-host observations do not establish a general mode ranking.
Full precision is retained in [summary.json](receipt/summary.json).

## Gaps against the planned architecture

| Boundary | Existing implementation | Exact break and probe treatment |
|---|---|---|
| Need to POODO intake | cstack `cli.py:run_document` / `_run_document` accept a structured goal, calls and four checkpoints | No free-text software-need decomposition. Harness authors the fixture mapping; structural phase checks do not establish reasoning. Standalone poodo is an instruction package per `docs/architecture/architecture.md`, without a callable intake loop. |
| POODO to Endoforge generation | cstack `poodo_core/core.py:PoodoCore.execute` invokes bound capability adapters; `bootstrap.py:DOMAINS` registers Foundation operations | No synthesis capability bound to `core/runtime/agent-pool.mjs` or `IsolatePool.run`. `poodo_core/ports.py:EndoforgePort` exposes only append/read/verify storage operations. Fixed candidate sources are the labeled generation stand-in. |
| Foundation evidence to engine evaluator | Real Math adapter outcomes and real frozen evaluator APIs exist | No production record-to-record bridge. `bridge.py` explicitly maps six observations to tests and admits them. The two ledgers have different schemas/hash formats; verifying both is not a unified cross-chain transaction or authority binding. |
| Evaluation | `core/runtime/isolate-pool.mjs:IsolatePool.run`, engine gates/evaluator and `core/ledger/ledger.py:Ledger` | Implemented and exercised directly. Host callbacks remain experiment-specific executable checks. |
| Passing frontier to promotion | `core/lifecycle.py:LifecycleRecord.proposal` / `apply` require a bound `PoodoDecision` | cstack `EndoforgePort` has no lifecycle-proposal decision issuer; `core/lifecycle.py:PoodoDecision` validates references only. Evaluator frontier is a selection, not lifecycle authority. Synthetic export replaces this missing step; no lifecycle transition, activation or deployment is claimed. |

The real local agent launcher exists, but requires configured clients/accounts
and does not supply the missing cstack dispatch/decision bridge. Its absence
from this run must not be interpreted as absence of agent execution code.
The refrigeration acceptance demonstrates approved Foundation execution and
witnessed storage, not software synthesis or promotion; its script is checked
separately below.

## Top fixes for near-realtime operation

1. Implement an explicit, versioned cstack synthesis capability/host bridge to
   Endoforge, with request, admitted input, candidate bytes and both ledgers'
   receipts bound together. Define cancellation and uncertain outcomes. This
   closes a functional gap before any full-pipeline latency claim is possible.
2. Add a trusted promotion decision issuer that binds the exact lifecycle
   proposal digest, candidate, frozen oracle and verified receipt. Keep policy
   admission separate from successful storage and evaluator frontier selection.
3. Profile the measured 1.34–1.35 s cstack stage internally: imports/bootstrap,
   source-pin validation, six Foundation subprocess calls, control validation
   and witness fsync. Trial a persistent bounded Foundation bridge and immutable
   source-identity cache with correct invalidation; preserve prospective durable
   precommits and every independent acceptance check. These are proposed tests,
   not measured speedups.
4. Profile the 0.37–0.40 s pool stage; test retained workcells and a bounded
   persistent Python ledger/frozen-verification service. Reuse immutable prepared
   evaluator state only with equivalent drift detection and durable receipt
   semantics. Increasing pool width cannot remove this serial need's critical
   path. Measure live generation separately after wiring it.

## What it does not show

- Real generated code, autonomous POODO research/reasoning, real promotion,
  preview, approval consumption in P-19, activation or a deployed outcome.
- Arbitrary function correctness: six integer cases are the acceptance boundary.
  Inputs are specified integers; the harness does not test invalid inputs.
- Production domain checks supplied by a Foundation directly to the engine.
  Math supplies real observations; the harness supplies the comparison callbacks.
- Independent signature inference, general effect scanning or hostile-code
  isolation. The port declares a signature and validates a tiny arithmetic
  grammar. VM execution is not an OS sandbox. Fuel is an operation count and
  memory usage is heap delta, not separately enforced process resource limits.
- Warm-pool latency, cache benefit, concurrency throughput, model latency,
  suffix-deletion detection, external witnessing, power-loss durability or
  cgroup enforcement. Host load and alternating fixed mode order remain confounders.
- A unified Endoforge/cstack ledger or automatic goal closure. Passing receipts
  establish the named checks only; synthetic selection costs say nothing about
  real promotion policy cost.

## Verification

Commands and actual results are recorded in [verification.json](receipt/verification.json)
and [repository-checks.json](receipt/repository-checks.json). Checks ran after
measurement and outside the benchmark lock. The measured harness used Node
26.12.0; final suite attempts and direct gate checks used the installed Node
22.23.3 through a temporary PATH setting, without changing repository files.

| Command | Actual result |
|---|---|
| `node experiments/P-19-need-to-candidate/run.mjs` | Exit 0; 60/60 component probes passed; both latency screens failed; architectural success false |
| `python3 -B experiments/P-19-need-to-candidate/verify.py` | Exit 0; 120 chain hash replays, 60 artifact hashes and every percentile verified |
| `make check` | Exit 0, 0 failures over 52 documents, including final check |
| `timeout 20s make test ENDOFORGE_TEST_OUTPUT=/tmp/ef-p19-test-bounded-output` | Exit 124 at engine tests; 18 lifecycle and 32 ledger tests passed first; remaining targets not reached |
| `timeout 20s make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/ef-p19-test-optimized-bounded-output` | Exit 124 at engine tests; optimized 18 lifecycle and 32 ledger tests passed first; remaining targets not reached |
| `node core/engine/gates.test.mjs` | Exit 0; all 10 tests passed under Node 22.23.3 |
| `timeout 10s node core/engine/evaluator.test.mjs` | Exit 124; did not complete |
| `PYTHON="$HOME/work/cstack-venv-tmp/bin/python" bash tools/e2e_refrigeration.sh` from cstack | Exit 0; configured ledger, approval id, two precommits, outcome and valid chain |
| Syntax checks, experiment file-link/path checks, precommit hash and `git diff --check` | Passed |

Initial full-suite attempts on Node 26.12.0 and 22.23.3 were interrupted at the
same engine stage (exit 130) before the bounded attempts above. A minimal Node
26 `execFileSync` invocation reproduced `spawnSync python3 EPERM` in the sandbox,
even though its child printed output. Existing evaluator fixtures use that
synchronous API. The restricted environment is a likely cause of the stalled
suite; the timeout alone does not establish its exact cause. The experiment's
asynchronous bridge/evaluator path completed all 60 runs. No check was weakened
and the full normal/optimized suites are **not claimed passed**. Isolate,
agent-launcher and later Makefile targets were not reached by these suite runs.

The harness/port/Python bridge plus standalone verifier total 306 source lines
with no code comments; the 60 exported one-line candidate files bring executable
source under this experiment to 366 lines. No core files, existing tests or
sibling repositories were modified; no commit or push was made.
