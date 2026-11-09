# EndoForge software requirements specification

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-SRS |
| Version | 2.0 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-08 |
| Baseline commit | 0476635f53384e9db6f5743520a4d499c4d24cf5 |
| Applies to | endoforge main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

## 1. Introduction

### 1.1 Purpose and scope

This document states what EndoForge does, as inspected at the baseline commit, and how each item is verified. Each
requirement describes implemented behaviour that a test or a named inspection checks. It is not authority to execute
work, and it does not qualify live model services: tests use synthetic inputs and test doubles.

### 1.2 System overview

EndoForge turns a short need into a small numeric WebAssembly kernel. A model writes a contract and tests, the
supervisor freezes them in a hash-chained ledger, the model writes the kernel, and a frozen evaluator runs gates inside
V8 workcells. The [design description](../architecture/architecture.md) lists the components. The Python core holds the
lifecycle model, the ledger and constraint records; `core/engine/` holds the evaluator and gates; `core/runtime/`
holds the workcell pool, the X1 candidate loop and the model-access controls; `tools/` holds workflow tools and
repository scripts.

### 1.3 Conventions

- IDs keep the repository scheme `REQ-<AREA>-<NNN>`. An ID is never reused; a removed requirement keeps its heading
  with status `Deleted`.
- Each requirement has one "shall" statement and these fields: Rationale; Derivation (source paths); Allocated to
  (component in [SDD §4](../architecture/architecture.md#4-components)); Verification (method and target); Status.
- Methods: T = test, A = analysis, I = inspection, D = demonstration. The test files and test names for each
  requirement are in the [verification matrix](../verification/verification-matrix.md).
- Behaviour that exists but has no test is listed in [§11](#11-untested-behaviour-requirement-gaps) as a gap, not as a
  requirement.
- `tools/check_trace.py` (run by `make check`) checks the fields, the trace to the matrix and the design, and that
  every derivation path exists.

## 2. Lifecycle model and core boundary

### REQ-CORE-001 — Core import boundary

The Python core shall import only its scoped standard library allowlists and load no concrete integrations on import.

- Rationale: Keep execution outside the lifecycle model. The engine adapter may also use the core ledger, `pathlib` and `sys`.
- Derivation: `core/__init__.py`, `core/lifecycle.py`, `core/engine/frozen.py`
- Allocated to: SDD §4 C-01 Lifecycle model
- Verification: T — `make core-test`
- Status: Baselined

### REQ-LIFE-001 — Legal transitions only

The lifecycle shall refuse transitions outside its legal state graph.

- Rationale: Prevent skipped lifecycle stages.
- Derivation: `core/lifecycle.py`
- Allocated to: SDD §4 C-01 Lifecycle model
- Verification: T — `make core-test`
- Status: Baselined

### REQ-LIFE-002 — Qualification needs a passing receipt

Qualification shall require a passing receipt for the exact candidate under the frozen oracle.

- Rationale: Bind qualification to independently checked bytes.
- Derivation: `core/lifecycle.py`
- Allocated to: SDD §4 C-01 Lifecycle model
- Verification: T — `make core-test`
- Status: Baselined

### REQ-LIFE-003 — Decisions bound to the proposal digest

Applying a transition shall require a decision bound to the current proposal digest and refuse reused decisions.

- Rationale: Prevent stale or replayed authorization references.
- Derivation: `core/lifecycle.py`
- Allocated to: SDD §4 C-01 Lifecycle model
- Verification: T — `make core-test`
- Status: Baselined

### REQ-LIFE-004 — Generation grants nothing

Generation shall not confer qualification or activation.

- Rationale: Separate candidate production from acceptance.
- Derivation: `core/lifecycle.py`
- Allocated to: SDD §4 C-01 Lifecycle model
- Verification: T — `make core-test`
- Status: Baselined

### REQ-LIFE-005 — Distinct identities

Artifact identity shall distinguish generation inputs, candidate bytes, and qualification receipt.

- Rationale: Preserve evidence identity across stages.
- Derivation: `core/lifecycle.py`
- Allocated to: SDD §4 C-01 Lifecycle model
- Verification: T — `make core-test`
- Status: Baselined

## 3. Ledger and evidence

### REQ-LEDGER-001 — Frozen evaluator refuses change

Evaluation shall refuse changes to frozen evaluator components before judging.

- Rationale: Prevent the candidate's checks from changing during evaluation.
- Derivation: `core/ledger/frozen.py`
- Allocated to: SDD §4 C-02 Ledger
- Verification: T — `make ledger-test`
- Status: Baselined

### REQ-LEDGER-002 — Group-commit writer durability

The ledger writer shall commit a batch of ledger writes with one journal `fdatasync` before any answer or decision file leaves, so that a crash leaves either nothing of an attempt or complete records.

- Rationale: Group commit without losing durability. Measured in `experiments/P-59-ledger-writer/RESULT.md`.
- Derivation: `tools/ledger_writer.py`, `core/runtime/isolate-ledger.mjs`
- Allocated to: SDD §4 C-14 Ledger writer
- Verification: T — `make isolate-test`, `make ledger-test`
- Status: Baselined

### REQ-LEDGER-003 — Append-only, schema-checked, tamper-evident records

The ledger shall accept only records that pass `record.schema.json` and reference durable records of the right kind, refuse SQL update, delete and replace, and detect tampering on reopen and append, with exactly one winner for concurrent duplicate appends.

- Rationale: The ledger is the evidence chain every promotion depends on.
- Derivation: `core/ledger/ledger.py`, `core/ledger/record.schema.json`
- Allocated to: SDD §4 C-02 Ledger
- Verification: T — `make ledger-test`
- Status: Baselined

### REQ-LEDGER-004 — Provenance and license metadata

Version 1 ledger records shall carry provenance and license metadata, with legacy version 0 records replayed as unknown without being rewritten and a task's `no_unknown_licenses` policy pinned before admission and enforced on later appends.

- Rationale: Know where every input and generated artifact came from, and under which license.
- Derivation: `core/ledger/ledger.py`, `core/ledger/record.schema.json`
- Allocated to: SDD §4 C-02 Ledger
- Verification: T — `make ledger-test`
- Status: Baselined

## 4. Engine, gates and library

### REQ-DOMAIN-001 — Domain checks through callbacks

The engine shall delegate named domain invariant checks to caller callbacks without importing domain implementations.

- Rationale: Foundations own domain logic; engine evaluation remains reusable.
- Derivation: `core/engine/evaluator.mjs`
- Allocated to: SDD §4 C-03 Engine evaluator and gates
- Verification: T — `make engine-test`
- Status: Baselined

### REQ-ENGINE-001 — Five ordered engine gates

The engine gates shall apply schema, interface, bounds, determinism and forbidden-effects checks in that order, stop at the first failure, and treat missing, invalid or incomplete runtime evidence and rejected port operations as failures.

- Rationale: A fixed gate order gives one first-failure record per candidate.
- Derivation: `core/engine/gates.mjs`, `tools/factory_quality/index.mjs`
- Allocated to: SDD §4 C-03 Engine evaluator and gates
- Verification: T — `make engine-test`
- Status: Baselined

### REQ-ENGINE-002 — Evaluator selection

The evaluator shall refuse invalid frozen policies and duplicate candidate identities before any host operation, prevent measurement after a failing gate, invariant or residual, re-check finalists on fresh measurements, select by Pareto dominance without a weighted score, and stop the campaign as `outcome_unknown` on a host exception.

- Rationale: Selection must depend only on frozen policy and fresh evidence.
- Derivation: `core/engine/evaluator.mjs`
- Allocated to: SDD §4 C-03 Engine evaluator and gates
- Verification: T — `make engine-test`
- Status: Baselined

### REQ-LIB-001 — Kernel library reuse

The library shall key promoted kernels by a canonical contract key that ignores labels and names, admit a kernel only after a gate that refuses an evaluator unable to discriminate WebAssembly mutants, serve, refuse, revoke and requalify entries across restarts, and let the pipeline reuse a kernel on a pass and generate on a miss.

- Rationale: A need that a promoted kernel already satisfies should skip implementation.
- Derivation: `core/library/library.mjs`, `core/library/key.mjs`, `core/library/discriminate.mjs`, `core/library/mutants.mjs`, `tools/library_verify_promotion.py`
- Allocated to: SDD §4 C-05 Library
- Verification: T — `make library-test`
- Status: Baselined

## 5. Workcell runtime

### REQ-ISO-001 — Workcell pool

The runtime shall execute the real frozen evaluator and gates in separate V8 workcells, with one active job per workcell, FIFO dispatch, at most the configured size, and default size `os.availableParallelism()`, on Node 22 and Node 26.

- Rationale: R02 assigns parallel work to separate isolates; P-15/P-17 support core-count throughput sizing.
- Derivation: `core/runtime/isolate-pool.mjs`, `core/runtime/isolate-workcell.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`; CI runs Node 22 and 26
- Status: Baselined

### REQ-ISO-002 — Heap limits

Each workcell shall receive configurable positive old and young generation heap limits through Node `resourceLimits` in thread mode or `--max-old-space-size`/`--max-semi-space-size` in process mode, with defaults 128 and 16 MiB and refusal of conflicting heap command-line overrides.

- Rationale: Bound each JavaScript heap independently.
- Derivation: `core/runtime/isolate-pool.mjs`, `core/runtime/isolate-workcell.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-ISO-003 — Lost cells

The runtime shall replace an exited workcell after exit, return `outcome_unknown`/`limit` in thread mode or `rejected` with reason `heap`/`wasm_memory` in process mode for confirmed memory breaches, and continue queued and independent jobs without retrying the lost job.

- Rationale: A lost acknowledgment cannot establish a verdict.
- Derivation: `core/runtime/isolate-pool.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-ISO-004 — Receipts for every batch

The host shall append candidate-bound receipts for every evaluated batch through the existing ledger validator and hash chain, including failed receipts for confirmed process memory breaches and inconclusive receipts for other lost workcells.

- Rationale: Preserve one durable evidence chain across isolates.
- Derivation: `core/runtime/isolate-pool.mjs`, `core/runtime/isolate-ledger.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-ISO-005 — Orderly close

`close()` shall refuse new submissions, drain accepted jobs and receipts, and terminate all workcells, returning the same promise on repeated calls.

- Rationale: Permit orderly caller shutdown.
- Derivation: `core/runtime/isolate-pool.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-ISO-006 — WebAssembly memory ceiling

Workcells shall enforce `wasmMemoryMaxMb` (default 64 MiB, integer 1–4096) on each WASM linear memory independently of the JS heap: checked constructors, compilation and instantiation reject untrusted module memories without a declared maximum and all declarations above the cap, preserve existing declared maxima, prevent JS or internal instruction growth past the ceiling, terminate only the breaching cell with `ERR_WORKCELL_WASM_MEMORY_LIMIT` and the mode-specific status of REQ-ISO-003, replace it after exit, preserve concurrent verdicts, and fail closed on unsupported memory-bearing binaries and externally compiled modules.

- Rationale: P-16 shows that a JS heap flag does not cap WASM memory; use native maxima plus instruction checks.
- Derivation: `core/runtime/isolate-wasm.mjs`, `core/runtime/isolate-wasm-compile.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-ISO-007 — Process isolation and cgroups

`isolation` shall select `thread` (default) or one forked Node process per workcell, with process mode using writable cgroup v2 delegation when available (per-child `memory.max`, `memory.oom.group=1`, `cpu.max`, `pids.max`) or recording `cgroup: "unavailable"` while keeping V8 limits, without root privileges.

- Rationale: Contain fatal V8 exits without requiring OS delegation.
- Derivation: `core/runtime/isolate-workcell.mjs`, `core/runtime/isolate-cgroup.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`; I — `core/runtime/isolate-cgroup.mjs` (delegated enforcement is unmeasured locally, GAP-EF-001)
- Status: Baselined

### REQ-ISO-008 — Supervisor-only trusted WASM caps

Only supervisor configuration shall authorize supplying an omitted WASM maximum, by a named complete-binary SHA-256 match and a positive integer page cap within the workcell ceiling; candidate inputs grant no trust, growth past a supplied cap is a breach under REQ-ISO-006, and the supervisor records the configured name, digest and cap in results and receipts, including worker losses.

- Rationale: Permit pinned compiler helpers while retaining fail-closed candidate checks and auditable policy.
- Derivation: `core/runtime/isolate-wasm.mjs`, `core/runtime/isolate-pool.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-ISO-009 — Opt-in pre-warm

`IsolatePool` shall offer opt-in pre-warming (`prewarm`, `ready()`) that starts every workcell, guard installed, and the ledger bridge before the first job, with on-demand creation as the default.

- Rationale: Remove spawn cost from first-job latency (P-26).
- Derivation: `core/runtime/isolate-pool.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-ISO-010 — Persistent batched ledger bridge

The pool shall write receipts through one persistent ledger bridge that batches concurrent requests per ledger path in a single transaction with per-request savepoints, replies only after commit, verifies the full hash chain on every read, invalidates cached rows on any mismatch, and fails closed without respawn when the bridge exits.

- Rationale: Remove per-request process spawn and full re-validation as the throughput limit without weakening chain verification.
- Derivation: `core/runtime/isolate-ledger.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-ISO-011 — Stack size

`resourceLimits` shall accept an optional positive `stackSizeMb`; process mode raises the stack rlimit before starting Node with `--stack-size` below it and refuses in the constructor where the host won't raise it, never relying on the flag alone.

- Rationale: Deep compiler recursion needs a larger stack; P-47 measured SIGSEGV from the flag alone.
- Derivation: `core/runtime/isolate-workcell.mjs`, `core/runtime/isolate-pool.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`, `make tscheck-test`
- Status: Baselined

### REQ-ISO-012 — Job deadline

With `jobTimeoutMs` set, a job past the deadline shall end with the workcell terminated and replaced, status `outcome_unknown`, reason `deadline`, inconclusive receipts and no pass, including when a process cell traps SIGTERM or a grandchild holds its stderr, and a cell past its deadline or whose process has exited takes no further job.

- Rationale: Limits are enforced where they work: a synchronous loop can't stop itself.
- Derivation: `core/runtime/isolate-pool.mjs`, `core/runtime/isolate-workcell.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`, `make tscheck-test`
- Status: Baselined

### REQ-ISO-013 — Off-heap memory statement

Heap limits shall be documented as not bounding off-heap memory: thread mode states no per-cell bound on ArrayBuffer, Buffer, Blob or the sum of WASM memories, and process mode with a delegated cgroup bounds them with `memory.max` and `memory.swap.max=0`, recording `cgroup: unavailable` where that file is absent on a host with swap and ending the cell with an inconclusive receipt, never a pass, without losing a sibling.

- Rationale: A stated limit replaces an assumed bound (P-44).
- Derivation: `core/runtime/isolate-cgroup.mjs`, `core/runtime/README.md`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test` (the cgroup case needs a delegated scope and skips without one, GAP-EF-001)
- Status: Baselined

### REQ-ISO-014 — Shared WASM modules

`sharedWasmModules` shall let a thread pool compile a pinned module once through the guard and share it across its cells, keeping growth limits and breach flags per instance, stopping only the breaching cell, refusing modules from any other source, falling back to per-cell compile on a digest mismatch, and compiling per cell in process mode.

- Rationale: P-45: compile cost is the guard's instrumentation, repeated per cell.
- Derivation: `core/runtime/isolate-pool.mjs`, `core/runtime/isolate-wasm-compile.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-ISO-015 — Warm start

`warm`, an options object off by default, shall have each workcell await the host module's exported `warm(options)` before it reports ready; a failure rejects `ready()` and makes that workcell's jobs unknown outcomes, a cell still warming after `warmTimeoutMs` is terminated as a start failure, and respawning stops after `size + 2` consecutive start failures with `halted` set.

- Rationale: Remove first-job latency for callers who can wait in `ready()` (P-46).
- Derivation: `core/runtime/isolate-pool.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`, `make tscheck-test`
- Status: Baselined

### REQ-ISO-016 — Cell retirement after a job allowance

The pool shall replace a workcell between jobs after `retireAfterJobs` jobs (default 256) without losing a job, while breach flags from earlier jobs neither pin instances nor hide a breach by an instance kept across jobs.

- Rationale: Bound state carried across jobs in a long-lived cell.
- Derivation: `core/runtime/isolate-pool.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-ISO-017 — Bounded host calls

A port shall reach the supervisor only through the configured `hostCall`/`hostCalls` callback, with host calls bounded per job, a failed host call an unknown outcome, never a pass, and port calls refused when no host call is configured.

- Rationale: The supervisor decides what a cell may ask for.
- Derivation: `core/runtime/isolate-pool.mjs`, `core/runtime/isolate-workcell.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined

## 6. X1 candidate loop and generation

### REQ-X1-001 — X1 gates in the pool

X1 gates G1–G9 shall run through the real evaluator in thread/process pools, bind frozen checks and compiled source, and preserve X1 test/glue decisions, with compilation on the supervisor under a timeout.

- Rationale: Replace the experiment-only port without changing acceptance.
- Derivation: `core/runtime/x1/gates.mjs`, `core/runtime/x1/host.mjs`, `core/runtime/x1/compiler.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-X1-002 — Release the cell while waiting

Under `waits: 'release'`, the default, an agent attempt waiting on its model shall hold no workcell: once the task is frozen and its conversation holds a reply, its continuation is durable in the task's ledger before the model call, each reply is admitted fresh into any free cell with deadline, limits, frozen evaluator, implementation files, frozen files and compiler identity rechecked, and a continuation resumed twice cannot reach a promotion.

- Rationale: Edition 3 §9: waiting releases compute; a swarm is a queue (P-57).
- Derivation: `core/runtime/x1/loop.mjs`, `core/runtime/x1/agent.mjs`, `tools/x1_loop.py`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make loop-test`; D — `experiments/P-57-release-waits/RESULT.md`
- Status: Baselined

### REQ-X1-003 — Frozen-store stalls are unknown

A stalled or unavailable frozen check or a timed-out compiler shall read as unknown, never as a refusal, while real drift still rejects, with at most three frozen checks per candidate.

- Rationale: An unavailable check cannot establish a verdict either way.
- Derivation: `core/runtime/x1/gates.mjs`, `core/runtime/x1/host.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-X1-004 — Universal gates measured from outside

The universal gates shall read memory and usage from outside the guest, run two fresh instances in different call orders, allow only `abort` as a runtime import, refuse a kernel that never returns at G6, report garbage WebAssembly and a trapping start as G2, and treat wall time alone as an unknown outcome, never a refusal.

- Rationale: A kernel must not be able to hide its resource use or hang the supervisor.
- Derivation: `core/runtime/x1/gates.mjs`, `core/runtime/x1/measure.mjs`, `core/runtime/x1/meter.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-LOOP-001 — Agent loop in the cell

The agent loop shall run model turns and checks in one job, return a failed check to the next turn, stop at turn, token and deadline limits as a recorded failure without promotion, keep the model out of the frozen files and outside the overlay, and pass only reply text and usage into the cell and its records.

- Rationale: The model iterates against checks it cannot change.
- Derivation: `core/runtime/x1/agent.mjs`, `core/runtime/x1/loop.mjs`, `core/runtime/x1/loop-port.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make loop-test`
- Status: Baselined

### REQ-LOOP-002 — Commit refuses forgery and drift

The loop commit shall refuse a forged receipt, a receipt that does not bind the frozen evaluator, a frozen tree or bundle changed after admission, and an implementation that differs from the code the cell ran, while an unforged commit through the same path still promotes.

- Rationale: Promotion needs evidence for the exact bytes that were checked.
- Derivation: `core/runtime/x1/loop.mjs`, `tools/x1_loop.py`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make loop-test`
- Status: Baselined

### REQ-LOOP-003 — Crashes never promote

SIGKILL of the cell, the supervisor or the ledger bridge at any stage shall never yield a promotion without its evidence: the attempt is lost, records are either absent or complete, and the task can resume from the ledger.

- Rationale: Crash safety is part of the acceptance contract.
- Derivation: `core/runtime/x1/loop.mjs`, `tools/x1_loop.py`, `tools/ledger_writer.py`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make loop-test`
- Status: Baselined

### REQ-LOOP-004 — No spawn or write before commit

The default loop cell shall be a separate process that cannot read the environment or other files, with no process spawn or file write in the cell visible to a syscall counter before commit.

- Rationale: The cell holds candidate code; it must have no ambient authority.
- Derivation: `core/runtime/x1/loop.mjs`, `core/runtime/x1/loop-port.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make loop-test`
- Status: Baselined

### REQ-GEN-001 — Two-stage generation with freeze

Generation shall invoke an environment-configured Codex command twice, durably freeze contract/tests before code, refuse drift and premature code, and return candidate bytes without conferring promotion, without reading or copying auth files.

- Rationale: Close the synthetic-generation gap while retaining the freeze boundary.
- Derivation: `core/runtime/x1/generator.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-GEN-002 — G7 glue rules in the request

The implementation request shall carry the G7 glue rules (number precision, code tables, boolean labels, trap entries, export and arity coverage) and a conforming glue template, with G7 itself unchanged.

- Rationale: Give generation the acceptance contract up front instead of discovering it at G7.
- Derivation: `core/runtime/x1/generator.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-GEN-003 — Warm session and effort

Generation shall by default resume the specification session for implementation (`ENDOFORGE_CODEX_SESSION=resume`, or `fresh`), select reasoning effort by `ENDOFORGE_CODEX_EFFORT` (`auto` gives `low` when the requester's words are at most 400 characters, `default` leaves the client setting, other values pass through), instruct the client not to explore or run commands, and keep the durable freeze between the two turns.

- Rationale: Cut generation latency without weakening freeze-before-code.
- Derivation: `core/runtime/x1/generator.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-GEN-004 — Explicit traps under `--noAssert`

The implementation request shall state that the compiler runs with `--noAssert` and require every expectError case to trap with an explicit `abort()` or `throw` instead of `assert`, with G4 and compiler flags unchanged.

- Rationale: P-24: 43 of 45 G4 refusals used `assert(`, which `--noAssert` deletes.
- Derivation: `core/runtime/x1/generator.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-GEN-005 — Optional self-check

With `ENDOFORGE_SELF_CHECK=1` (default off), generation shall compile the implementation, run the unchanged gates on it, and on failure resume the same Codex thread once with the failing gates and tests, then re-check that the frozen files are unchanged, while the official gates still decide promotion.

- Rationale: Three of four P-28 refusals failed G4/G7 on kernels the model never saw run.
- Derivation: `core/runtime/x1/generator.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-GEN-006 — Reference and scalar modes

In reference mode generation shall freeze evaluator-computed expectations rather than model numbers and fail closed on missing functions, wrong traps and side effects, and in scalar mode it drops non-finite and non-integer trap values before the freeze, fails before implementation when a function lacks a value test, and returns the drop evidence with the gate receipt.

- Rationale: Frozen expectations should come from a checked computation where one exists.
- Derivation: `core/runtime/x1/reference.mjs`, `core/runtime/x1/scalar.mjs`, `core/runtime/x1/generator.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-GEN-007 — Terse attempt with bounded retry

When a terse first attempt is refused by the gates, the pipeline shall retry once in normal mode within the request deadline, but never retry a stage error or an attempt that already used the time budget.

- Rationale: A short prompt is faster when it works; the retry keeps the success rate.
- Derivation: `core/runtime/x1/pipeline.mjs`, `core/runtime/x1/generator.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make test` (`pipeline-retry-test`)
- Status: Baselined

### REQ-GEN-008 — Prompt modes

Generation prompt modes shall add exactly their own rules: terse turns default to `exact` and `0` turns the rules off, `exact` adds the numeric derivation rule to the specification stage only, reviewed turns append the review rule to every stage, a packed session starts implementation fresh with the frozen files in the prompt, and the stable prefix orders fixed prompt fields first only when opted in.

- Rationale: Each mode is a measured prompt variant; it must not change other stages.
- Derivation: `core/runtime/x1/generator.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-PROMOTE-001 — Local promotion

Local promotion shall issue a persisted qualification decision only for the exact candidate, frozen oracle, verified receipt hash and chain with two complete passing pool rounds and all nine X1 gates (G1–G9) present and passing, and refuse on any mismatch.

- Rationale: Supply the executable interface a future POODO host can call without claiming POODO authority.
- Derivation: `core/runtime/x1/pipeline.mjs`, `tools/x1_ledger.py`, `tools/x1_loop.py`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-UNITS-001 — Independent units gate

Gate `G9_units` shall check the kernel's arithmetic, the glue's kinds and units and parameter names without reading the contract or the evaluator, and be required to pass for promotion.

- Rationale: An independent check catches glue unit errors the evaluators share (P-65).
- Derivation: `core/runtime/x1/gates.mjs`, `core/runtime/x1/dimensions.mjs`, `core/runtime/x1/contract.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-SYNTH-001 — Evaluator synthesis

With `ENDOFORGE_SYNTH=1` (default off), the X1 path shall synthesize an evaluator in candidate-blind model contexts, qualify it against meta-gates M1 to M5, write it into the oracle root before the ledger freeze, and after the pool gates refuse a candidate that fails a qualified check, abstain when nothing qualified, and never refuse because of a model failure.

- Rationale: Edition 3 §6: specification precedes the workcell. Design in [evaluator synthesis](../architecture/evaluator-synthesis.md).
- Derivation: `core/runtime/x1/synth/stage.mjs`, `core/runtime/x1/synth/qualify.mjs`, `core/runtime/x1/synth/vectors.mjs`, `core/runtime/x1/synth/sandbox.mjs`
- Allocated to: SDD §4 C-08 Evaluator synthesis
- Verification: T — `make pipeline-test`
- Status: Baselined

### REQ-ORACLE-001 — Formula oracle

With `limits.oracle` set (default off), the agent loop shall recompute frozen expectations from the contract's formula, ranges and `reference.js` before the freeze, replace a literal when the formula and the reference agree on another value, return flagged tests to the model, and abstain on conditional, piecewise or conflicting rules.

- Rationale: Catch wrong frozen expectations before implementation (P-69, P-70). Lane F15 may extend this module after the baseline.
- Derivation: `core/runtime/x1/oracle.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined

## 7. Model access

### REQ-SUB-001 — Subscription guard

Every `claude -p` launch by a transport, the atomizer or hillclimb shall first prove a claude.ai subscription login from metadata and refuse with exit 78 on any API-key, cloud-provider, helper, bare-mode or unreadable configuration, with billing and provider variables removed from child environments.

- Rationale: Model calls run on a subscription, never on API billing.
- Derivation: `core/runtime/subscription-guard.mjs`, `core/runtime/x1/transports.mjs`
- Allocated to: SDD §4 C-09 Model access
- Verification: T — `make isolate-test`, `make atomizer-test`
- Status: Baselined

### REQ-GOV-001 — Usage governor

Before each model call the usage governor shall park new calls (`USAGE_PARKED`, exit 75, `outcome_unknown`) when projected weekly utilization reaches the ceiling (default 0.85), the last status is `allowed_warning` or `rejected`, or the login draws on usage credits, without counting a parked call as a failed candidate.

- Rationale: Leave headroom for interactive use and never spend usage credits.
- Derivation: `core/runtime/usage-governor.mjs`, `core/runtime/x1/transports.mjs`
- Allocated to: SDD §4 C-09 Model access
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-TRANSPORT-001 — Claude transports

The warm transport shall spawn one process per lane, send only new turns, refuse sessions that report a non-subscription mode, give a dead lane's next session a new process with the full history, kill a hung turn's process, and route around a usage-limited instance, while the spawn transport sends the full history with tools off once per turn.

- Rationale: Reuse a model process where safe without leaking state between sessions.
- Derivation: `core/runtime/x1/transports.mjs`
- Allocated to: SDD §4 C-09 Model access
- Verification: T — `make loop-test`
- Status: Baselined

### REQ-POOL-001 — Codex agent pool

The agent pool shall run the Codex binary named by `CODEX_POOL_BIN`, else the `codex` found on `PATH` other than itself, exit 2 when none exists, pass a spawn-rate refusal through as exit 75 without failover, deliver piped and file prompts across a rate-limit failover, and cool an account with a multi-day usage cap until its reset.

- Rationale: Local Codex clients fail over across accounts without hiding a refusal.
- Derivation: `core/runtime/agent-pool.mjs`
- Allocated to: SDD §4 C-15 Agent pool
- Verification: T — `make test` (`runtime-test`)
- Status: Baselined

## 8. Resource management and contained execution

### REQ-CAP-001 — Capacity planner

The capacity planner shall derive width, placement and split from the probed CPU allotment, cache domains and memory, keep its default policy fixed (one cohort per L3 domain at core width), and let an explicit caller width always win.

- Rationale: Fit width to the machine without hand tuning. See the [capacity ICD](../interfaces/capacity-icd.md), P-67, P-68.
- Derivation: `core/runtime/capacity/probe.mjs`, `core/runtime/capacity/plan.mjs`, `core/runtime/capacity/tuner.mjs`, `core/runtime/capacity/controller.mjs`, `core/runtime/capacity/cli.mjs`
- Allocated to: SDD §4 C-11 Capacity planner
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-MEM-001 — Dump list

With the dump list enabled, the isolate pool, contained cohort and ledger writer shall register sheddable memory and shed only idle capacity on `SIGUSR2`, never in-flight work or unacknowledged journal batches.

- Rationale: Spend RAM for speed and give it back under pressure (P-61).
- Derivation: `core/runtime/dump-list.mjs`, `tools/dump_list.py`, `tools/ledger_writer.py`
- Allocated to: SDD §4 C-12 Dump list
- Verification: T — `make isolate-test`, `make ledger-test`, `make tscheck-test`
- Status: Baselined

### REQ-CONTAINED-001 — Contained JavaScript

The contained runner shall run guest JavaScript with only an allowlist of globals and named, bounded, JSON-only ports, refuse dynamic import before the guest runs, enforce the deadline from outside, kill only the breaching guest or pool cell, report everything a fatal cohort held as unknown without retry, and refuse `runTwice` output that differs.

- Rationale: Emitted JavaScript runs with no ambient authority and cannot hurt its neighbours.
- Derivation: `core/runtime/contained/runner.mjs`, `core/runtime/contained/cohort.cjs`, `core/runtime/contained/cell.cjs`, `core/runtime/contained/guest.js`, `core/runtime/contained/cohort-set.mjs`
- Allocated to: SDD §4 C-10 Contained JavaScript
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-RATES-001 — Stage rates

With `rates` enabled, the loop shall report per-stage arrival, service and wait rates consistent with Little's law and name a saturated stage by net utilisation, falling back to population.

- Rationale: Find the bottleneck from live counters (P-62).
- Derivation: `core/runtime/stage-rates.mjs`, `tools/stage-rates.mjs`
- Allocated to: SDD §4 C-13 Stage rates
- Verification: T — `make isolate-test`
- Status: Baselined

## 9. Tools

### REQ-TSC-001 — Pinned TypeScript checker

The TypeScript checker shall run in a pool workcell from a module and core matching the pinned SHA-256 digests, compile at most once per workcell and use a fresh instance per check, with a hash mismatch, missing compiler or trap an unknown outcome, never a pass.

- Rationale: Tested parity needs an exact compiler identity (P-43).
- Derivation: `tools/tscheck/checker.mjs`, `tools/tscheck/pin.mjs`, `tools/tscheck/port.mjs`
- Allocated to: SDD §4 C-16 TypeScript checker
- Verification: T — `make tscheck-test`
- Status: Baselined

### REQ-TSC-002 — Emit hashes in receipts

With `emit` set, the check shall record each clean emit's per-file SHA-256 and the compiler's name and digest in the receipt's observation, add no artifact hash for a check with diagnostics, and treat a clean emit that writes nothing as an unknown outcome.

- Rationale: Bind what was emitted to the compiler that emitted it, in the existing hash chain, with no schema change.
- Derivation: `tools/tscheck/checker.mjs`, `tools/tscheck/port.mjs`
- Allocated to: SDD §4 C-16 TypeScript checker
- Verification: T — `make tscheck-test`
- Status: Baselined

### REQ-TSC-003 — Requalification

`make tscheck-requalify` shall rerun the parity arm against whatever `pin.mjs` names and exit nonzero on any difference, on an incomplete job, on an oracle at another version, on an oracle or workload whose digest isn't pinned, on a workload under 20 projects or without diagnostics or variety, on anything that isn't a project, and when plain `tsc` disagrees with the oracle run with the host's options.

- Rationale: A version bump shouldn't inherit parity it hasn't shown.
- Derivation: `tools/tscheck/requalify.mjs`, `tools/tscheck/pin.mjs`
- Allocated to: SDD §4 C-16 TypeScript checker
- Verification: T — `make tscheck-test`
- Status: Baselined

### REQ-TSC-004 — Incremental build info

`typecheck` shall accept optional build info from the caller's previous check, with diagnostics matching a full check on the measured edits, refuse it with `emit`, never take build info from a candidate, and keep pool verdicts as full checks.

- Rationale: Make checks proportional to the change where the caller owns the state (P-49).
- Derivation: `tools/tscheck/checker.mjs`, `tools/tscheck/check-core.mjs`
- Allocated to: SDD §4 C-16 TypeScript checker
- Verification: T — `make tscheck-test`
- Status: Baselined

### REQ-TSC-005 — Candidates cannot switch the check off

A candidate-authored project shall not decide that the checker ran: the host owns `noCheck`, `noResolve`, `incremental` and the build info path, refuses non-canonical file keys and names that fold to a compiler extension, takes program membership from the compiler's structured record, and requires every project TypeScript source in the program with no `@ts-nocheck` and no `.tsbuildinfo` input for a clean result.

- Rationale: A verdict must not depend on options that switch the check off. `// @ts-ignore`, `strict`, `skipLibCheck` and unchecked JavaScript are stated limits in `tools/tscheck/README.md`.
- Derivation: `tools/tscheck/check-core.mjs`, `tools/tscheck/checker.mjs`
- Allocated to: SDD §4 C-16 TypeScript checker
- Verification: T — `make tscheck-test`
- Status: Baselined

### REQ-TSC-006 — Checks in the contained cohort

A type check run in the contained cohort, with a reused tsrs instance or a host baseline, shall give the same verdicts as a fresh full check on the supervisor, and lose only its own attempt as `outcome_unknown` when a checker Worker or the cohort dies, with the contained route emitting and running checked code only when the type check passes.

- Rationale: Keep fused placement (P-58, P-60) equivalent to the plain check.
- Derivation: `tools/tscheck/cohort-check.mjs`, `tools/tscheck/tsrs-reuse.mjs`, `tools/tscheck/contained-route.mjs`, `tools/tscheck/cohort-preparer.mjs`
- Allocated to: SDD §4 C-16 TypeScript checker
- Verification: T — `make tscheck-test`, `make pipeline-test`
- Status: Baselined

### REQ-KERNEL-001 — Kernel component contract

The kernel contract tool shall emit an artifact record only for a component that conforms to `kernel.wit`, bind the record to the exact bytes, refuse omitted, changed or added fields, undeclared capabilities and exports, wrong types and versions, malformed WIT and invalid components, and fail closed when a tool is missing or at another version.

- Rationale: A kernel's identity is its bytes plus its declared interface.
- Derivation: `tools/kernel/contract.py`, `tools/kernel/kernel.wit`
- Allocated to: SDD §4 C-17 Kernel host
- Verification: T — `make kernel-test`
- Status: Baselined

### REQ-KERNEL-002 — Capability broker

The broker shall run only declared imports, reject undeclared authority imports before compile, deny reads revoked between calls without returning stale data, treat a failing or non-true authority check as a denial, and stop read floods at the per-attempt call limit.

- Rationale: A kernel gets exactly the authority its declaration names.
- Derivation: `tools/kernel/broker.py`
- Allocated to: SDD §4 C-17 Kernel host
- Verification: T — `make kernel-test`
- Status: Baselined

### REQ-KERNEL-003 — Kernel host containment

The Wasmtime kernel host shall stop infinite loops, deep recursion, allocation bombs and output floods at their limits, stop an unresponsive host with a watchdog even with closed pipes, refuse invalid limits before launch, and start a fresh process after a failure.

- Rationale: A failing kernel costs one attempt, not the host.
- Derivation: `tools/kernel/limits.py`
- Allocated to: SDD §4 C-17 Kernel host
- Verification: T — `make kernel-test`
- Status: Baselined

### REQ-KERNEL-004 — Kernel workcell

The kernel workcell shall compile a component once and give each attempt fresh state, carry forward only explicit state and the current buffer, stop loops by fuel, enforce the memory ceiling at instantiation, return effects as data, and bind its cache identity to the exact bytes.

- Rationale: Reuse compilation without carrying hidden state between attempts.
- Derivation: `tools/kernel/workcell.py`
- Allocated to: SDD §4 C-17 Kernel host
- Verification: T — `make kernel-test`
- Status: Baselined

### REQ-TOOLS-001 — Pinned kernel test tools

`make tools` shall install Wasmtime and wasm-tools at the versions pinned in `tools/kernel/install_tools.py` into `.tools/`, install nothing on a hash mismatch, and `make kernel-test` refuses to run with missing or wrong versions.

- Rationale: Kernel tests are only comparable with the pinned toolchain.
- Derivation: `tools/kernel/install_tools.py`, `Makefile`
- Allocated to: SDD §4 C-17 Kernel host
- Verification: T — `make core-test`
- Status: Baselined

### REQ-COMPAT-001 — TypeScript reducer contract

The compatibility contract shall pin the exact EF-18 WIT digest and refuse extra or missing exports, wrong types, asynchronous reducers, contract and schema drift, malformed budgets, transitions and effects, snapshot policy and inputs before reducer code runs, and revoke borrowed handles after a thrown reducer.

- Rationale: TypeScript reducers must meet the same contract as kernel components.
- Derivation: `tools/compatibility/contract.ts`, `tools/compatibility/reference.ts`
- Allocated to: SDD §4 C-18 Compatibility contract
- Verification: T — `make test` (`compatibility-test`)
- Status: Baselined

### REQ-FAULT-001 — Seeded fault generator

The seeded fault generator shall produce replayable faults with exact distinguishing witnesses for every family, be byte-identical for a repeated seed, filter equivalent mutants, isolate caller inputs and outputs, and fail on empty, duplicate, oversized, invalid or nondeterministic requests.

- Rationale: Escape-rate measurement needs reproducible, non-equivalent faults.
- Derivation: `tools/seeded_faults/generator.py`
- Allocated to: SDD §4 C-19 Escape measurement
- Verification: T — `make seeded-fault-test`
- Status: Baselined

### REQ-ESCAPE-001 — Escape-rate harness

The escape harness shall submit non-equivalent faults in seeded random order, count a promotion only with every configured check passing, abort on unknown outcomes, malformed evidence, budget overruns, duplicates and freeze changes, and report exact certification bounds and sample sizes.

- Rationale: An escape rate is only meaningful if unknowns never count as catches.
- Derivation: `tools/escape_harness/harness.py`, `tools/escape_harness/stats.py`
- Allocated to: SDD §4 C-19 Escape measurement
- Verification: T — `make escape-test`
- Status: Baselined

### REQ-STEP-001 — Step harness

The step harness shall accept a done claim only with matching evidence, stop on budget, wall clock and repetition without dispatching the repeated call, keep blocked separate from done, never retry after an unknown outcome or an execute exception, carry constraints and ledger references across one compaction, and refuse reuse.

- Rationale: A bounded agent step loop where every step is evidence.
- Derivation: `tools/step_harness/harness.py`
- Allocated to: SDD §4 C-20 Step harness
- Verification: T — `make harness-test`
- Status: Baselined

### REQ-HW-001 — Hardware record

The hardware record tool shall collect a machine record with read-only probes, validate it against `schema.json`, reject corrupted or missing receipts, forged enforcement gates and statistics and changed probe sources, and report whether the current environment still matches.

- Rationale: A measurement is tied to the machine it ran on.
- Derivation: `tools/hardware_record/record.py`, `tools/hardware_record/schema.json`
- Allocated to: SDD §4 C-21 Hardware record
- Verification: T — `make hardware-test`
- Status: Baselined

### REQ-ATOM-001 — Atomizer scheduler

The atomizer shall reject plans with cycles or forbidden edges, run independent atoms in parallel, fail an atom that reads an undeclared input and block its dependents, accept binds only under configured roots, cap `timeoutSec` by policy, and write a hashed run archive and ledger events for every run, atom, attempt and verification.

- Rationale: Fan-out work with enforced input boundaries and receipts.
- Derivation: `tools/atomizer/bin/schedule.mjs`, `tools/atomizer/bin/verify.mjs`, `tools/atomizer/lib/validate.mjs`, `tools/atomizer/lib/binds.mjs`, `tools/atomizer/lib/ledger.mjs`, `tools/atomizer/lib/isolate.mjs`
- Allocated to: SDD §4 C-22 Atomizer
- Verification: T — `make atomizer-test`
- Status: Baselined

### REQ-ATOM-002 — Atomizer routing and failover

Atomizer routing shall load and validate its config, classify by declared kind before heuristics, never pick the throwaway tier automatically, forbid luna models outside the throwaway tier, fail over across accounts on exhaustion, label a spawn-gate 75 distinctly, and stop without retry when a guard refuses.

- Rationale: Route work to the cheapest adequate model and never mask a refusal.
- Derivation: `tools/atomizer/lib/routing.mjs`, `tools/atomizer/lib/workers.mjs`, `tools/atomizer/routing.json`
- Allocated to: SDD §4 C-22 Atomizer
- Verification: T — `make atomizer-test`
- Status: Baselined

### REQ-ATOM-003 — Atomizer trace and lessons

The atomizer trace shall be off unless enabled, account for its own overhead, report diamond analysis and nearest-rank percentiles, and receipt lessons name failed launches, the slowest atom and queue waits.

- Rationale: Measure where fan-out time goes.
- Derivation: `tools/atomizer/lib/trace.mjs`, `tools/atomizer/lib/lessons.mjs`, `tools/atomizer/bin/bench.mjs`
- Allocated to: SDD §4 C-22 Atomizer
- Verification: T — `make atomizer-test`
- Status: Baselined

### REQ-COND-001 — Conductor fails closed on unknown state

The conductor shall treat an empty or garbage exit file, a vanished process or a failing `systemctl` as unknown, never as exit 0, stop on an unreadable state file without rewriting it, exit 78 on torn state without restart, and write state atomically with a sync before rename.

- Rationale: A lane's status must never read as success by default.
- Derivation: `tools/conductor/lib/state.mjs`, `tools/conductor/lib/daemon.mjs`, `tools/conductor/lib/launch.mjs`, `tools/conductor/lib/adopt.mjs`, `tools/lib/exitfile.mjs`, `tools/lib/lock.mjs`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-COND-002 — Conductor principles

The conductor shall compare a measured outcome with its target and tolerance, re-check downstream atoms when an upstream atom lands a newer candidate, freeze a judged item list on first use and mark a check unstable when it changes or disagrees with itself, revert a change that regresses a passing item and improves none, stop the job on a check reporting 78, and resume a mid-check atom after a daemon restart.

- Rationale: Iterate against frozen, stable checks only.
- Derivation: `tools/conductor/lib/checks.mjs`, `tools/conductor/lib/handlers.mjs`, `tools/conductor/lib/daemon.mjs`, `tools/conductor/lib/escalate.mjs`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-JOB-001 — Job event log

The job event log shall lose only a torn last line and say the log is incomplete, keep the next event whole, report a log with nothing readable as unknown, and sync an event before reporting it written.

- Rationale: Job status is derived from a durable log.
- Derivation: `tools/job/lib/events.mjs`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-LOCK-001 — Job locks registry

`job-locks.py` shall add, render and remove locks, treat a missing registry as no jobs, name torn or missing manifests, warn on and never overwrite a torn or wrong-shaped registry, and leave no temporary file after a failed write.

- Rationale: Concurrent jobs see a consistent lock registry.
- Derivation: `tools/job-locks/job-locks.py`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-ERR-001 — Typed exit codes

`tools/lib/errors.mjs` and `run-typed` shall classify exit 0 as ok, 75 as transient, 78 as stop and anything else as failure, wait out a busy guard with backoff up to a maximum, and pass 78 and failures through at once.

- Rationale: One exit-code convention across tools.
- Derivation: `tools/lib/errors.mjs`, `tools/lib/run-typed`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-HILL-001 — Hillclimb lessons ledger

Hillclimb shall count lesson recurrences, reopen a closed lesson that recurs, write `LESSONS.md` from measurements and receipts, record `--close` and `--add` changes, and leave a torn ledger as it was.

- Rationale: Lessons persist across rounds and become tool changes.
- Derivation: `tools/hillclimb/lib/lessons.mjs`
- Allocated to: SDD §4 C-24 Hillclimb
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-CONSTRAINT-001 — Constraint records

Constraint records shall resume verbatim with their source identity, survive a crash without duplication in one durable crossing, refuse tampering, take origin from the transport only, require a human message for withdrawal, and record every extractor failure visibly.

- Rationale: User constraints must survive transcript compaction unchanged (P-55).
- Derivation: `core/constraints/record.py`, `core/constraints/store.py`, `core/constraints/transcript.py`, `core/constraints/extract.py`, `tools/constraint_store.py`
- Allocated to: SDD §4 C-04 Constraint records
- Verification: T — `make core-test`
- Status: Baselined

### REQ-CONSTRAINT-002 — No constraint laundering

Constraint extraction shall never turn seeds, quoted or pasted text, tool output, reported speech or model output into an active user constraint or a permission, and the constraint block states that it grants no authority.

- Rationale: Only the user's own words become constraints.
- Derivation: `core/constraints/extract.py`, `core/constraints/segments.py`, `core/constraints/port.py`
- Allocated to: SDD §4 C-04 Constraint records
- Verification: T — `make core-test`
- Status: Baselined

### REQ-FACTORY-001 — Campaign state recovery

Factory campaign state shall recover the last complete stage after a SIGKILL or a torn state file, while the model journal fences a second live controller and keeps orphan workers visible for reconciliation.

- Rationale: A campaign resumes from durable state, not memory.
- Derivation: `tools/factory_campaign/state.py`, `tools/factory_campaign/model_journal.py`
- Allocated to: SDD §4 C-25 Factory campaign and portability
- Verification: T — `make test` (`factory-state-test`); see finding D-01 in the [assurance record](../assurance/assurance-record.md) for the optimized run
- Status: Baselined

### REQ-FACTORY-002 — Encrypted checkpoint transfer

The checkpoint tool shall round-trip a campaign through an `age`-encrypted archive without changing the source, and refuse a wrong key, tampered ciphertext, existing destinations or archives, credential files and content, links, traversal, absolute paths, duplicates and unknown versions.

- Rationale: Move a campaign between machines without carrying credentials.
- Derivation: `tools/factory_portability/checkpoint.py`
- Allocated to: SDD §4 C-25 Factory campaign and portability
- Verification: T — `make test` (`portability-test`); see finding D-01 in the [assurance record](../assurance/assurance-record.md)
- Status: Baselined

### REQ-RUST-001 — Rust lane

The Rust lane shall build reproducibly with the pinned toolchain, refuse a toolchain mismatch before building, and match the P-06 frozen equivalence.

- Rationale: A second language lane under the same acceptance.
- Derivation: `tools/rust_lane/build.py`, `tools/rust_lane/equivalence.mjs`
- Allocated to: SDD §4 C-26 Rust lane
- Verification: T — `make rust-lane-test` (outside `make test` and CI; needs the pinned Rust toolchain)
- Status: Baselined

## 10. Repository checks

### REQ-DOCS-001 — Links and source digests

Repository checks shall validate local Markdown link targets and source digests.

- Rationale: Keep navigation and supplied source evidence reproducible.
- Derivation: `tools/check-docs.py`, `tools/source_sums.py`, `sources/SHA256SUMS`
- Allocated to: SDD §4 C-27 Repository checks
- Verification: T — `make check`, `make core-test`
- Status: Baselined

### REQ-REPO-001 — Privacy lint

`make check` shall fail when an experiment record contains a home-directory path, a Claude projects or scratch-workspace path, or an email address, unless the file is allowlisted with a reason and an unchanged digest.

- Rationale: The repository is public.
- Derivation: `tools/check-privacy.py`, `tools/privacy-allowlist.json`
- Allocated to: SDD §4 C-27 Repository checks
- Verification: T — `make core-test`
- Status: Baselined

### REQ-REPO-002 — Generated index, sums and P-number allocation

`make check` shall fail when `experiments/README.md` differs from its fragments, when `sources/SHA256SUMS` is stale, or when a P-number is allocated twice or missing, and the allocator gives parallel lanes distinct numbers and never reuses a claimed tag.

- Rationale: Generated files and experiment numbers stay consistent under parallel work.
- Derivation: `tools/experiments_index.py`, `tools/source_sums.py`, `tools/experiment_id.py`
- Allocated to: SDD §4 C-27 Repository checks
- Verification: T — `make core-test`
- Status: Baselined

### REQ-REPO-003 — Every test file is run

`make test` shall fail when a discovered test file is reached by no make target and is not listed with a reason in `tests/test-reachability.json`, and when CI does not run both suites.

- Rationale: A test that never runs verifies nothing.
- Derivation: `tests/test_reachability.py`, `tests/test-reachability.json`
- Allocated to: SDD §4 C-27 Repository checks
- Verification: T — `make core-test`
- Status: Baselined

### REQ-REPO-004 — Traceability check

`make check` shall fail on a requirement without a verification-matrix row, a matrix row naming a missing test file or test name, a discovered test file that traces to no requirement and is not listed as supporting, a design component that implements no requirement and is not infrastructure or a recorded gap, an environment variable read by code that is not in the configuration reference, and a dead relative link or anchor.

- Rationale: NPR SWE-052 bidirectional traceability, checked by a tool rather than by hand.
- Derivation: `tools/check_trace.py`
- Allocated to: SDD §4 C-27 Repository checks
- Verification: T — `make core-test`
- Status: Baselined

## 11. Untested behaviour (requirement gaps)

These behaviours exist in the code at the baseline but no test in `make test` checks them. They are not
requirements until a test exists. Numbering: `GAP-EF-NNN`, never reused.

| ID | Behaviour | Location | Why untested / note |
|---|---|---|---|
| GAP-EF-001 | Delegated cgroup v2 enforcement (`memory.max`, `memory.swap.max=0`, `cpu.max`, `pids.max`) in process mode | `core/runtime/isolate-cgroup.mjs` | The test needs a delegated systemd scope and skips without one; not measured locally or in CI |
| GAP-EF-002 | Factory runtime: job specs, scheduler, recovery, egress and WebAssembly runner | `tools/factory_runtime/` | No test file exists |
| GAP-EF-003 | Glue gate CLI | `tools/gate/gate.mjs` | No test file exists |
| GAP-EF-004 | Project scheduler | `tools/project-scheduler/scheduler.mjs` | No test file exists |
| GAP-EF-005 | Approved-atoms helper | `tools/approved_atoms.py` | No test file or caller found |
| GAP-EF-006 | Campaign repair and transfer, Wasmtime qualification and stage resume | `tools/factory_campaign/repair.py`, `tools/factory_portability/campaign_transfer.py`, `tools/factory_portability/qualify_wasmtime.py`, `tools/factory_portability/resume_stage.py` | No test file exists |
| GAP-EF-007 | Stub pool replay | `core/runtime/stub-pool.mjs` | No test imports it |
| GAP-EF-008 | Atomizer commands other than schedule, verify and bench (for example `atomize`, `fanout`, `direct`, `report`, `cutover`) | `tools/atomizer/bin/` | No test runs them |
| GAP-EF-009 | Hillclimb fan-out, plan and scoreboard | `tools/hillclimb/lib/fanout.mjs`, `tools/hillclimb/lib/plan.mjs`, `tools/hillclimb/lib/scoreboard.mjs` | Only the lessons ledger is tested |
| GAP-EF-010 | Job kinds, card compilation and source loading | `tools/job/kinds/`, `tools/job/lib/compile.mjs`, `tools/job/lib/card.mjs` | Exercised only indirectly through conductor fixtures; no direct assertions |
| GAP-EF-011 | `WarmClaudeTransport` with a custom usage governor | `core/runtime/x1/transports.mjs` | Defect D-03 in the assurance record: the option is ignored, and no test covers it |
| GAP-EF-012 | Atomizer `bench` default example and `conduct adopt` example paths | `tools/atomizer/bin/bench.mjs`, `tools/conductor/bin/conduct.mjs` | Defect D-04: the default inputs are missing; the bench test passes explicit inputs |
| GAP-EF-013 | Rust lane in CI | `tools/rust_lane/` | REQ-RUST-001 is tested only by `make rust-lane-test`, which CI does not run |

## 12. Not-applicable requirement categories

- Safety and hazard requirements (SWE-184): N/A. EndoForge is not safety-critical ([SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)).
- Control-system, hardware-interface, operating-system, board-support and partitioning requirements: N/A. EndoForge
  commands no hardware and runs as user processes on a general-purpose OS.
- Performance requirements: no throughput or latency figure is a requirement. Measured figures live in the
  experiments, with their commit and machine; defaults change only after a precommitted measurement.
- TBD count at baseline: 0.

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-10-30 | `3083a5a` | Table of implemented requirements | earlier PRs |
| 2.0 | 2026-11-08 | `0476635` | Per-requirement fields; 45 existing requirements kept and 49 added for tested areas, gap register, N/A categories | this PR |
