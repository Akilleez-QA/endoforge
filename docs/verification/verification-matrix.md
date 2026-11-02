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
