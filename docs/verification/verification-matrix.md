# Verification matrix

Requirement definitions are in
[docs/requirements/requirements.md](../requirements/requirements.md).

The implementation baseline below is `3083a5a5c277d6caec99eba698f6040698751400`.
Results were observed locally
on 2026-10-30; they are not hosted CI status or live-provider qualification.
T means test; I means inspection.

| Requirement | Method | Existing test or command | Result | Implementation commit |
|---|---|---|---|---|
| REQ-CORE-001 | T | `make core-test`; `tests/test_endoforge_core_boundary.py` | Pass | `3083a5a` |
| REQ-LIFE-001 | T | `make core-test`; `tests/test_endoforge_lifecycle.py`, `TransitionTests` | Pass | `3083a5a` |
| REQ-LIFE-002 | T | `make core-test`; `tests/test_endoforge_lifecycle.py`, `TransitionTests` | Pass | `3083a5a` |
| REQ-LIFE-003 | T | `make core-test`; `tests/test_endoforge_lifecycle.py`, `DecisionTests` | Pass | `3083a5a` |
| REQ-LIFE-004 | T | `make core-test`; `tests/test_endoforge_lifecycle.py`, `GenerationGrantsNothingTests` | Pass | `3083a5a` |
| REQ-LIFE-005 | T | `make core-test`; `tests/test_endoforge_lifecycle.py`, `IdentityTests` | Pass | `3083a5a` |
| REQ-LEDGER-001 | T | `make ledger-test`; `core/ledger/test_frozen.py`, `FrozenTests.test_every_component_change_refuses_before_judging` | Pass | `3083a5a` |
| REQ-DOCS-001 | I | `make check`; inspect `tools/check-docs.py` | Pass: link existence and digest checks present | `3083a5a` |

## Reproduction

Run from the repository root:

```sh
make check
make core-test ledger-test
make test ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-style-test
```

The full suite passed locally with the output override above. The override keeps
generated evidence outside the source tree. The commit body records checks for
this documentation change. `make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-style-optimized`
also passed locally on this documentation branch.


## Ledger relocation verification

On 2026-11-01, the relocation to `core/ledger/` passed the checks below locally
with Python 3.14.8, Node.js 26.12.0, and bubblewrap 0.13.1. The source identity is
the Git commit containing this section. Earlier baseline results above remain
historical; ledger test paths now refer to their relocated equivalents.

| Scope | Command | Observed result |
|---|---|---|
| REQ-DOCS-001 and relocated source digests | `make check` | Exit 0; no link or digest failures |
| REQ-CORE-001, REQ-LIFE-001 through REQ-LIFE-005, REQ-LEDGER-001 | `make core-test ledger-test` | Exit 0; 18 lifecycle/boundary and 32 ledger tests passed |
| Full suite, including engine callers | `make test ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-ledger.KCM0Ow/test` | Exit 0 |
| Full suite with Python optimization | `make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-ledger.KCM0Ow/optimized` | Exit 0 |

The scoped import check retains the lifecycle allowlist and permits only the
ledger's standard library dependencies plus test-only dependencies under the
ledger package. Ledger test assertions and fixtures are unchanged; subprocess
imports and the CLI module name use `core.ledger`. Output and logs were kept
outside the source tree under `/tmp/endoforge-ledger.KCM0Ow/`.

## Engine relocation verification

On 2026-11-01, the engine relocation was checked locally with Python 3.14.8,
Node.js 26.12.0, and bubblewrap 0.13.1. The source baseline is the Git commit
containing this section. Earlier results above remain historical.

| Scope | Command | Observed result |
|---|---|---|
| REQ-DOCS-001; engine source digests and links | `make check` | Exit 0; no link or digest failures |
| REQ-CORE-001 and lifecycle boundaries; evaluator and gates | `make core-test engine-test` | Exit 0; 18 lifecycle/boundary and 19 engine tests passed |
| Full suite, including relocated evaluator and frozen adapter | `make test ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-engine.MNFEVS/test` | Exit 0 |
| Full suite with Python optimization | `make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-engine.MNFEVS/optimized` | Exit 0 |

The relocated evaluator and gate tests and Python adapter are byte-for-byte
unchanged. Engine tests exercise fixed gate order, frozen-content drift refusal,
host failures, fresh finalist evaluation, and Pareto selection. The core boundary
check grants imports only to the engine adapter's exact file path; lifecycle and
ledger allowlists and import-isolation assertions remain in place. Full-suite logs
and evidence are outside the source tree under `/tmp/endoforge-engine.MNFEVS/`.

## Runtime relocation verification

On 2026-11-01, the runtime relocation passed locally with Python 3.14.8,
Node.js v26.13.0, and bubblewrap 0.13.1. The Git commit containing this section
identifies the relocation baseline.

| Scope | Command | Observed result |
|---|---|---|
| REQ-DOCS-001; runtime source digests and links | `make check` | Exit 0; no link or digest failures |
| Full suite, including relocated pool tests and workflow callers | `make test ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-runtime.IwV9kx/test` | Exit 0 |
| Full suite with Python optimization | `make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-runtime.IwV9kx/optimized` | Exit 0 |

Pool tests retain their assertions for client selection, registry recursion
prevention, stdin forwarding, cooldown refusal, and rate-limit failover.
Only module paths and code comments changed in the touched JavaScript sources.
Test expectations and fixtures are unchanged. Logs and configured test evidence
are outside the source tree under `/tmp/endoforge-runtime.IwV9kx/`.

## Domain extraction verification

On 2026-11-01, domain extraction was checked locally with Python 3.14.8,
Node.js v26.13.0, GNU Make 4.4.1, and bubblewrap 0.13.1. The Git commit
containing this section identifies the extraction baseline.

| Scope | Command | Observed result |
|---|---|---|
| REQ-DOCS-001; archived source paths and digests | `make check` | Exit 0; zero link or digest failures |
| Full suite, including REQ-DOMAIN-001 synthetic identity invariant checks | `make test ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-domain.Kw3REq/test` | Exit 0 |
| Full suite with Python optimization, including caller invariant checks | `make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-domain.Kw3REq/optimized` | Exit 0 |

Inspection of Makefile, core, workflow modules, and tests found no imports or
execution references to the archived film utilities or refrigeration adapter.
All ten files are byte-preserving renames. Existing engine tests exercise the
caller-supplied synthetic identity invariant and reject failed or malformed
checks before measurement. Test assertions and fixtures are unchanged.
Logs and configured test evidence are outside the source tree under
`/tmp/endoforge-domain.Kw3REq/`.

## V8 workcell verification

On 2026-11-01, the `v8-isolate-pool` working tree based on `4ede823` was checked
with Python 3.14.8, Node.js 26.12.0, and an installed Node.js 22.23.3 binary.
These are local results, not an observed Ubuntu/Python 3.12 CI run.
All new tests are in
[isolate-pool.test.mjs](../../core/runtime/test/isolate-pool.test.mjs).

| Requirement | Method | Test evidence | Observed result |
|---|---|---|---|
| REQ-ISO-001 | T | Native evaluator parity; concurrency 1/4/16; lazy defaults | Pass; identical reports, all configured workcells active, size never exceeded |
| REQ-ISO-002 | T | Real heap allocation fixture; reported generation limits; invalid configuration and heap override refusal | Pass; 24/4 MiB configured, `ERR_WORKER_OUT_OF_MEMORY` observed |
| REQ-ISO-003 | T | Heap and explicit exit fixtures with simultaneous and queued successful jobs | Pass; failed jobs unknown, replacement thread IDs distinct, independent jobs complete |
| REQ-ISO-004 | T | Python `Ledger.records()` replay, returned digest comparison, receipt tampering and subsequent admission refusal | Pass; 40 receipts across multiple workers, tampering detected; worker-loss receipts inconclusive |
| REQ-ISO-005 | T | Close during queued work at sizes 1/4/16 | Pass; new submissions refused, all accepted jobs resolved, zero workers after close, same promise on repeated close |

| Command | Actual result |
|---|---|
| `make check` | Exit 0; Markdown links and source digests verified |
| `make isolate-test` | Exit 0; seven tests passed, including real heap exhaustion |
| Node 22.23.3 `--test --experimental-test-isolation=none --test-reporter=spec core/runtime/test/isolate-pool.test.mjs` | Exit 0; seven tests passed in about 11 seconds |
| `PYTHONOPTIMIZE=1 node --test --test-isolation=none --test-reporter=spec core/runtime/test/isolate-pool.test.mjs` | Exit 0; seven tests passed in about 11 seconds |
| `timeout 40s make test ENDOFORGE_TEST_OUTPUT=/tmp/ef-isolate-test` | Exit 124; check, 18 lifecycle/boundary tests and 32 ledger tests passed; unchanged engine evaluator test stalled |
| `timeout 40s make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/ef-isolate-optimized` | Exit 124; same completed checks and engine evaluator stall |

The existing evaluator test uses `execFileSync` with stdin. A minimal independent
Node/Python stdin reproducer also stalls in this execution sandbox and reports
`EPERM` or `ETIMEDOUT`; asynchronous subprocess I/O works. New fixtures use
asynchronous I/O. Existing test assertions, expected results, and source files
were not changed. The two full-suite commands therefore did not qualify later
Makefile targets. Logs are outside the source tree at `/tmp/ef-isolate-test.log`,
`/tmp/ef-isolate-optimized.log`, `/tmp/ef-isolate-node22-final.log`, and
`/tmp/ef-isolate-optimized-target.log`.

## WASM ceiling and breach isolation verification

On 2026-11-01, the rebased uncommitted pool was extended after reading
[P-16](../../experiments/P-16-workerd-isolates/RESULT.md) and
[P-17](../../experiments/P-17-workcell-gap/RESULT.md). The earlier workcell table
remains historical. The checks below use Python 3.14.8, Node 26.12.0 and the
installed Node 22.23.3 binary; they do not claim an observed ubuntu-latest run.

| Requirement | Test evidence | Actual result |
|---|---|---|
| REQ-ISO-001 | Lazy default equals `os.availableParallelism()`; existing concurrency 1/4/16 and evaluator parity | Pass on Node 22.23.3 |
| REQ-ISO-002, REQ-ISO-003, REQ-ISO-004 | Real JS heap exhaustion with a two-cell barrier; healthy neighbor held mid-job; queued replacement; full accepted/rejected reports and inconclusive breach receipt | Pass on Node 22.23.3 |
| REQ-ISO-005 | Existing graceful close and FIFO tests unchanged | Pass on Node 22.23.3 |
| REQ-ISO-006 | JS initial/maximum/grow (including shared memory and coercion), compile/Module/Instance/instantiate and streaming paths, exported and internal growth, unexported memory, imported memory, start growth, swallowed trap, omitted maxima, smaller native maxima, default 64 MiB and signed-LEB boundary | Pass on Node 22.23.3; 20 breach subtests |
| REQ-ISO-006 | Unsupported SIMD, malformed bytes and externally compiled modules fail closed; empty and memory-only modules still execute | Pass on Node 22.23.3 |
| REQ-DOCS-001 | `make check`; source digests and Markdown links | Exit 0; zero failures over 47 documents |

Each WASM breach case uses two workers and a barrier before the failing operation;
a healthy neighbor waits for release until the host receives the breached cell’s
exit result. The queued replacement and neighbor must both reproduce the complete
native evaluator report for a passing candidate and a forbidden-effects rejection.
Their thread IDs differ from the failed cell and each other. WASM receipts bind
the configured cap and explicit `ERR_WORKCELL_WASM_MEMORY_LIMIT` result. JS heap
breaches independently require `ERR_WORKER_OUT_OF_MEMORY`. No existing assertions
or expected results were changed. The small WASM fixtures are built from bytes
in the test and need no downloaded compiler or runtime.

| Command | Actual result |
|---|---|
| `make check` | Exit 0; zero link or source-digest failures over 47 documents |
| `make isolate-test` (Node 26.12.0) | Exit 0; test file passed in about 26 seconds |
| `make isolate-test` (Node 22.23.3 first on PATH) | Exit 0; test file passed in about 24 seconds |
| Node 22.23.3 `--test --experimental-test-isolation=none --test-reporter=spec core/runtime/test/isolate-pool.test.mjs` | Exit 0; 33 tests passed, zero failed/skipped, about 23 seconds |

Logs are outside the source tree: `/tmp/ef-pool-wasm-node22.log`,
`/tmp/ef-pool-wasm-make.log`, and `/tmp/ef-pool-wasm-make-node22.log`.
The isolated Make runners report one passing test file; the direct Node 22 run
exposes its 33 constituent tests. A preliminary run with an invalid synthetic
start-body length failed before the fixture was corrected; no existing expected
results or assertions were changed. The full `make test`/`make test-optimized`
suites were not rerun for this extension.

## Node 26 workcell startup verification

Node 26.12.0 does not lazily instantiate undici WebAssembly when
`globalThis.Response` is read. The previous unreferenced startup timer let the
event loop empty, so every workcell exited with code 13. On main-rig,
`isolate-pool.test.mjs` and `isolate-process.test.mjs` failed 38 of 39 on Node
26.12.0 before the change and passed 39 of 39 after it. Node 22.23.3 passed 39
of 39 after it. CI now runs the repository tests on Node 22 and 26. On Node 26 each workcell start costs the full 2 s wait, so the process
compile-gate test has a 60 s timeout and the WASM breach test, which replaces a cell
per case, has a 180 s timeout.

Workcells now skip the startup wait when the bundled undici major version is 8
or later; Node 26.12.0 bundles undici 8.11.2 and Node 22.23.3 bundles undici
6.28.1, which still waits. On main-rig, `isolate-pool.test.mjs` and
`isolate-process.test.mjs` together took 99 s on Node 26.12.0 before the change
and 26 s after it, passing 39 of 39; Node 22.23.3 passed 39 of 39 in 25 s.

## Process workcell verification

The `v8-process-workcells` working tree was checked locally with Node 26.12.0
and 22.23.3. This is not an observed ubuntu-latest CI run. The new
[process tests](../../core/runtime/test/isolate-process.test.mjs) run without
delegation and share the [P-18 fixture](../../core/runtime/test/fixtures/pool-breach.mjs).

| Requirement | Evidence | Actual result |
|---|---|---|
| REQ-ISO-001, REQ-ISO-003, REQ-ISO-004 | N=8 process heap/WASM breaches, native accepted/rejected reports, distinct replacement, receipt observations and Python chain replay | Pass; one lost cell, zero lost siblings, 17 receipts per arm |
| REQ-ISO-002 | Real child V8 heap exhaustion with 24/4 MiB flags | Pass; fatal heap exit classified `rejected`/`heap` |
| REQ-ISO-005 | Existing FIFO/drain/close tests plus process shutdown | Pass |
| REQ-ISO-006 | Process compile/instantiate of imported/defined missing/oversized limits; retained thread API and instruction growth tests | Pass; process rejection reason `wasm_memory` |
| REQ-ISO-007 | Invalid options, unavailable explicit cgroup root, ordinary exit/replacement; cgroup helper inspection | Fallback passed; delegated memory/cpu/pids enforcement unmeasured |
| REQ-DOCS-001 | `make check` | Exit 0; links and digests checked |

`make isolate-test` passed on Node 26.12.0 and Node 22.23.3 (both test files).
An initial thread run failed because a healthy fixture still lacked a maximum;
its input now declares the maximum, preserving its existing verdict assertions.
Exactly two existing assertions changed, both in the omitted-maximum test:
`bounded.status` now expects `outcome_unknown` instead of `completed`, and
`smaller.workcell` must differ from `bounded.workcell` instead of matching it.
Explicit bounded growth, native smaller maxima and swallowed/internal/start
breach coverage remain. No other existing assertion changed.

[P-18](../../experiments/P-18-pool-breach/RESULT.md) records actual thread/process
breach counts, precommit verification and the unavailable-cgroup limitation.
Logs: `/tmp/ef-process-make-default-final.log`,
`/tmp/ef-process-make-node22-final.log`, `/tmp/ef-p18-final.log` and
`/tmp/ef-process-check-final.log`. The full `make test` and `make test-optimized`
suites were not rerun for this focused extension.

## Atomizer fan-out timing verification

On 2026-11-01, branch `deflake-atomizer` was checked against baseline
`33f1507ba1d2c1700d385a0d97a226e1e12efa60` with Node 22.23.3,
Python 3.14.8 and bubblewrap 0.13.1. These are local shared-host observations,
not an observed GitHub Actions run; affinity to CPUs 0 and 1 limits execution
to two logical CPUs without isolating the host's load average.

The fan-out fixture already uses ten `sleep 1` commands, with eight independent
workers between seed and compose. Concurrency 9 can overlap those sleeps on
two CPUs; this is a scheduler overlap check, not a CPU throughput benchmark.
The planned 3.33x bound is ten work points over a three-point critical path,
not a guarantee that accounts for throttling or harness overhead.
The inherited headroom guard can hold ready workers when host load exceeds
1.8 under two-CPU affinity, or available memory falls below its reserve. That
makes the timing assertion depend on host conditions and earlier suite work.
This fan-out scheduler invocation and the agent-swarm test scheduler invocations set `ENDOFORGE_THROTTLE=0`; the account-spread case otherwise ran one worker at a time after heavy earlier suite work and used a single account.
Production headroom policy, fixtures, and every existing assertion are unchanged.

`realizedSpeedup` rounds `sumAtomWallMs / wallMs` to two decimal places.
The reported CI values give `10160 / 5091 = 1.99568`, correctly rounded to
`2.00`; removing rounding would still fail `> 2`. Atom wall sums isolated
attempts, including spawn, OS scheduling/pool waits, execution and close/cleanup;
it excludes the scheduler's ready queue and input staging. Run wall includes
those ready-queue delays, staging and postprocessing. It excludes earlier test
harness work and scheduler startup/context collection. No timing boundary or
rounding changed, and neither the >2x nor six-second threshold was widened.
Overlapping OS waits can inflate atom wall sums, so the realized ratio can
slightly exceed the bound calculated from declared work points.

A controlled two-CPU scheduler pair set `ENDOFORGE_MAX_LOAD=0.000001` and
`ENDOFORGE_RESERVE_GB=1000000`: throttling enabled produced 1.00x in 10081 ms
with seven throttles; disabled produced 3.32x in 3039 ms with zero throttles.
Both completed all ten atoms. This isolates the host guard as a cause of the
assertion failure without changing work or the speedup calculation.

Each batch ran `PYTHONOPTIMIZE=1 taskset -c 0,1 node tools/atomizer/test/run.mjs`
30 times sequentially, using Node 22.23.3. The execution sandbox breaks
Node synchronous pipe I/O (`EPERM`, empty output or stalled stdin); both batches
used the same external `NODE_OPTIONS=--require=/tmp/ef-atomizer-deflake/stdin.cjs`
adapter, which substitutes temporary files for synchronous subprocess pipes,
preserves output and exit status, and captures fan-out receipts before cleanup.
No assertion or fixture was altered by the adapter.

| Batch | Passing test runs | Speedup min / median / p95 / max | Fan-out wall min / median / p95 / max (ms) | Throttles |
|---|---|---|---|---|
| Before | 12/30 | 1.00 / 1.00 / 3.32 / 3.32 | 3036 / 10077 / 10248 / 10291 | 7 in each failed run, 0 in each passing run |
| After | 30/30 | 3.12 / 3.31 / 3.32 / 3.34 | 3045 / 3056 / 3473 / 3540 | 0 in all runs |

Reported speedup counts before: 1.00x (18), 3.31x (3), 3.32x (9).
After: 3.12x (1), 3.20x (1), 3.23x (2), 3.24x (2), 3.25x (1),
3.27x (1), 3.31x (15), 3.32x (6), 3.34x (1). Percentiles use nearest rank.
The 18 baseline failures each failed only the >2x and six-second checks;
all other assertions passed. Raw unrounded ratios ranged from 0.996487 to
3.324120 before and 3.120621 to 3.337288 after.

Logs, per-run summary receipts, exit statuses, the adapter and repetition/statistics
scripts are outside the source tree under `/tmp/ef-atomizer-deflake/`:
`baseline.jsonl`, `after.jsonl`, `baseline-*.log`, `after-*.log`,
`*-exits.jsonl`, `distribution.txt`, `repeat.py`, `summarize.py` and
`controlled-{0,1}/`. The receipts contain the original wall measurements;
receipt capture runs after the scheduler has exited.

Additional checks used Node 22.23.3 first on PATH:

| Command | Actual result |
|---|---|
| `make check` | Exit 0; zero link/digest failures over 57 documents |
| `timeout 60s make test ENDOFORGE_TEST_OUTPUT=/tmp/ef-atomizer-deflake/full-test` | Exit 124; check, 18 lifecycle/boundary and 32 ledger tests passed; engine evaluator stalled on synchronous Python stdin |
| `timeout 60s make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/ef-atomizer-deflake/full-optimized` | Exit 124; same completed checks and engine stall |
| `make atomizer-test` with the external I/O adapter | Exit 2; trace tests and main scheduler tests passed; unchanged swarm model-fallback test failed (`1 !== 0`); remaining swarm checks passed |
| Compare all 31 existing `check()` lines against baseline; `git diff --check` | Identical assertions; exit 0 |

The full-suite attempts used native I/O without the adapter and therefore did
not qualify later Makefile targets. Their logs are `make-test.log` and
`make-test-optimized.log`; the focused target log is `make-atomizer.log`, all
under the evidence directory above. No assertion was changed to obtain a pass.
## X1 gate host port

REQ-X1-001: `make pipeline-test` exercises native/pool parity in thread and
process modes with in-repo minimal WASM addition/subtraction fixtures. It checks
positive G1–G7 verdicts and independent expected refusal gates for frozen drift,
compile failure, missing export, incorrect result and closed glue violations.
The fixture WASM is precompiled; these CI checks do not qualify an installed asc.
The port is derived from P-21's unchanged X1 gate runner; timing values are
observations and are excluded from equality. Source bindings and frozen host
bytes are checked on every residual invocation, including finalist evaluation.

Local validation: `make check` and `make pipeline-test` passed on Node 26.12.0.
An additional supervisor run with AssemblyScript 0.28.20 compared all six fixture
variants against the unchanged P-21 `gate.mjs`: every G1–G7 boolean matched.
WASM hashes differ because the port compiler declares a 64-MiB memory maximum;
parity concerns verdicts and outputs, not timestamps or compiled byte identity.

## Generator adapter

REQ-GEN-002: `generator.test.mjs` records the request sent to the labelled test
double and checks the rules, template and G7 kinds they cover. Root cause of the
P-22 G7 refusals: the schema leaves precision optional while G7 requires it for
number results, and generation received only the schema.

REQ-GEN-003: `generator.test.mjs` checks the resumed thread id, effort flags and the
fresh/default fallback through recorded client arguments. One real add(a,b) smoke on
2026-11-01 took 92.4 s before the no-exploration instruction and 42.6 s (low) / 41.7 s
(default) after; a single run each, not a measurement.

REQ-GEN-004: `generator.test.mjs` checks that `compiler.mjs` passes `--noAssert` and that
the recorded implementation instructions forbid `assert` and require an explicit
`abort()` or `throw` trap. Root cause from P-24: 43 of 45 G4 refusals used `assert(`,
0 of 34 promotions did, independent of session resume and effort.

REQ-GEN-001: `make pipeline-test` includes a labelled executable test double,
two-stage generation, durable oracle creation, frozen hashes, absence of code in
the oracle, early-code/drift/nonzero-exit refusals and missing configuration.
The configured CODEX_HOME does not exist in the test: the adapter does not inspect
it. No live Codex generation is run in the sandbox. Client sandbox behavior and
semantic quality of authored acceptance tests remain outside this fixture's claim.
`make check`, `make core-test` (18 tests) and `make pipeline-test` passed locally
on Node 26.12.0/Python 3.14.8 after adding the generator.

## Local promotion and P-22

REQ-PROMOTE-001: `make pipeline-test` and `PYTHONOPTIMIZE=1 make pipeline-test` passed locally.
Both modes exercise generated candidate → compile test double → real evaluator →
hash-chain receipt → persisted qualification decision. Refusals cover actual bad
glue, wrong receipt hash, each of seven failed gate booleans in passing-shaped
ledger evidence and chain tampering. Existing tests/expected results are unchanged.
P-22's first fake run completed 60/60 records/promotions at concurrency ten;
this qualifies wiring, not live generation, compiler correctness or real latency.
The real P-22 run on 2026-11-01 completed 60/60 records with real Codex and
AssemblyScript 0.28.20; 41 promoted, 19 refused or failed with every verdict
retained (experiments/P-22-real-need-to-candidate/RESULT.md).

`make check` passed (60 documents); `make isolate-test` passed both existing
suites after optional timing support; direct `node core/engine/gates.test.mjs`
passed all ten tests. Normal and optimized `timeout 60s make test` attempts
(with external output overrides) exited 124 at unchanged evaluator tests, after
pipeline, 18 lifecycle/boundary and 32 ledger tests passed. Full-suite success
is not claimed. Final pipeline validation includes the sixty-record harness,
all eight timing fields and non-overlapping stage sums. A separate fake-generator
run using real AssemblyScript 0.28.20 promoted successfully in both pool modes.
## Trusted compiler maximum verification — 2026-11-02 UTC

Node 26.12.0, existing assertions and expected results unchanged.
The new [toolchain tests](../../core/runtime/test/isolate-toolchain.test.mjs)
use synthetic compiler bytes without downloading a compiler.

| Requirement | Evidence | Actual result |
|---|---|---|
| REQ-ISO-006, REQ-ISO-008 | Trusted binary through compile, Module, Instance, instantiate and streaming paths in both modes; growth beyond supplied maximum; existing smaller maximum | Pass; native maximum supplied before execution, smaller declared maximum preserved |
| REQ-ISO-004, REQ-ISO-008 | Copied supervisor policy and receipt observations; candidate-supplied policy with mismatched binary; replacement | Pass; original cap recorded, forged trust rejected and replacement healthy |
| REQ-ISO-008 | Invalid names/digests/caps and duplicate policy entries | Pass; refused before dispatch |
| REQ-ISO-001–007 | `make isolate-test` | Pass; all three test files, exit 0; new file rerun after adding existing-maximum coverage also exit 0 |
| REQ-DOCS-001 | `make check` | Pass; 0 failures over 57 documents |

A real pinned AssemblyScript 0.28.20 smoke run under the guard compiled a
synthetic identity kernel (57 bytes) and returned 7 for input 7. Binaryen's
existing 65,536-page maximum remains intact; only the digest-pinned `f64_pow`
helper receives 16 pages. [P-20](../../experiments/P-20-pool-speed-rerun/RESULT.md)
appends the full compile/residency rerun and policy-bearing receipts.

`make test ENDOFORGE_TEST_OUTPUT=/tmp/ef-as-maxmem-tests` passed 18 core and
32 ledger tests, then stalled in the engine test stage and was interrupted
(exit 130). A direct synthetic `spawnSync` diagnostic returned `EPERM` with
status 0 and child output. Full-suite success is not claimed; the sandbox's
synchronous subprocess limitation does not affect the measured asynchronous
pool/ledger path. Verification logs are retained with the dated P-20 receipts.

`timeout --signal=INT --kill-after=5s 90s make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/ef-as-maxmem-tests-optimized`
also passed 18 core and 32 ledger tests, then timed out at the engine stage
(exit 124). The evaluator file was canceled with a pending promise; the gates
file passed. Later Make targets were not reached in either full-suite run.

## Workcell pre-warm verification

REQ-ISO-009: `isolate-pool.test.mjs` checks that a default pool has no workcells before
its first job, that `prewarm: true` with `ready()` yields `size` workcells that serve a job
without spawning more, that a non-boolean `prewarm` is refused and that `ready()` rejects
after `close()`. On main-rig the pool and process suites passed 40 of 40 on Node 22.23.3
and 26.12.0. Spawn-cost measurements are in P-26.

## Persistent batched ledger bridge verification — 2026-11-02 UTC

| Requirement | Case | Expected result |
|---|---|---|
| REQ-ISO-010 | 64 jobs at width 16 through one pool | Pass; every receipt present and the chain verifies from a fresh Ledger |
| REQ-ISO-010 | Second writer appends between pool batches | Pass; pool appends chain after the external record |
| REQ-ISO-010 | Bridge process killed with work pending | Pass; pending and later requests reject, no respawn |
| REQ-ISO-010 | Stored row tampered after caching | Pass; next read rejects the chain |
| REQ-ISO-010 | One invalid request inside a batch | Pass; only that request fails and the others commit |

