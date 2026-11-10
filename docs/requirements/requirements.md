# EndoForge software requirements specification

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-SRS |
| Version | 2.10 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-10 |
| Baseline commit | 4d692a41853045c4e013405d8e674528745a38b9 |
| Applies to | endoforge main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

## 1. Introduction

### 1.1 Purpose and scope

This document states what EndoForge does, as inspected at the baseline commit, and how each item is verified. Each
requirement describes implemented behaviour that a test or a named inspection checks. It is not authority to execute
work, and it does not qualify live model services: tests use synthetic inputs and test doubles.

### 1.2 System overview

EndoForge is where coding agents build software as a runtime operation. For a need, an agent writes a contract and
tests, the supervisor freezes them in a hash-chained ledger, the agent writes the code (today in the kernel candidate
form: a WebAssembly module taking state and events in and giving state out as data, plus declarative glue), and a
frozen evaluator runs gates inside V8 workcells. The [design description](../architecture/architecture.md) lists the components. The Python core holds the
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

- Rationale: Prevent skipped lifecycle stages. The graph (`LEGAL`): proposed, generated, qualified, previewed,
  activated, each entered only from the one before; failed and rejected from any of the first four; disposed from every
  state except disposed itself.
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

- Rationale: Separate candidate production from acceptance. Each transition carries only its own evidence fields
  (`candidate_sha256` into generated, `receipt` into qualified, `preview_ref`, `host_approval_ref`, and `reason` into
  failed, rejected or disposed); anything else, such as a generator's own claims, is refused.
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

The library shall key promoted kernels by a canonical contract key that ignores labels and names, admit a kernel only after a gate that refuses an evaluator unable to discriminate WebAssembly mutants, serve, refuse, revoke and requalify entries across restarts, and let the pipeline reuse a kernel on a pass and generate on a miss, with the key and the export binding including the nested layout of record, list and text values (record fields matched by name, each with its kind, unit, range, precision, rounding, codes and labels; list `items` and `max`; text `maxBytes`), so a need whose nested layout differs from an entry's misses and field order does not count, while a capability with only scalar values keeps the key it had before the layout was keyed.

- Rationale: A need that a promoted kernel already satisfies should skip implementation. Until round 9 the key compared each argument and result at the top level only, so the library could reuse a capability whose nested units differ (finding D-11).
- Derivation: `core/library/library.mjs`, `core/library/key.mjs`, `core/library/discriminate.mjs`, `core/library/mutants.mjs`, `tools/library_verify_promotion.py`
- Allocated to: SDD §4 C-05 Library
- Verification: T — `make library-test`; the nested-layout key and binding cases run in `make isolate-test`
- Status: Baselined (changed in round 9, S2: the key and binding include the nested layout). An entry admitted before round 9 with a record, list or text value keeps the key it was journaled with, which left out the layout, so a need with the same capability now misses it with `no_contract_match`; the entry is not refused

### REQ-LIB-002 — Library composition

`library.compose` shall link a union of entries, output-to-input pipelines and argument adapters into one module, serve it only after the need's frozen tests pass on it and journal it against every part, refuse a wrong composition, and let `serve` build a union when no single entry holds the capability, matching each member on its whole signature, nested layout included (a member whose nested layout differs from every entry leaves no union plan, so `serve` misses with `no_contract_match`), and binding members that share one signature to the entry export with the same name.

- Rationale: A need that two promoted capabilities cover together should not need a new model turn. Until round 10 no test covered the union path with nested layouts. Its first test showed that members sharing one signature (state in, state out over the same record) were all sent to the first entry that fit, so the union either never composed or composed the wrong function.
- Derivation: `core/library/library.mjs`, `core/library/compose.mjs`, `core/library/link.mjs`
- Allocated to: SDD §4 C-05 Library
- Verification: T — `make library-test`
- Status: Baselined (changed in round 10, T4: union members that share a signature bind by export name, and a nested layout mismatch leaves no union)

### REQ-LIB-003 — Semantic retrieval

With `retrieval: 'semantic'` (default `key`), the library shall rank entries by offline, deterministic similarity of normalized contract text before the key match, and let a need with no capability block adopt the capability of an entry scoring at least 0.4.

- Rationale: A need handed to the library directly, outside the loop, may carry no capability block (the loop's freeze has required one since round 6, REQ-GEN-011); text similarity finds the candidate entry without a model call.
- Derivation: `core/library/library.mjs`, `core/library/key.mjs`
- Allocated to: SDD §4 C-05 Library
- Verification: T — `make library-test`
- Status: Baselined

### REQ-LIB-004 — Tenant and lineage scopes

The library shall hide another tenant's entries, miss with `permission_denied` when the caller's lineage is outside an entry's lineage, record an entry's scope from the admit row or the admitting principal, and journal every grant and ungrant.

- Rationale: Entries admitted for one tenant or lineage must not be reused by another without a recorded grant.
- Derivation: `core/library/library.mjs`, `core/library/scope.mjs`
- Allocated to: SDD §4 C-05 Library
- Verification: T — `make library-test`
- Status: Baselined

### REQ-LIB-005 — Reclaiming duplicates

`library.reclaim` shall keep one entry per behaviour within a scope, where a behaviour is the entry's fingerprint (every export's results over a fixed grid, with numbers, non-finite numbers included, printed to 12 significant digits, records and lists as JSON, and text, booleans and missing values printed exactly as JSON, so two kernels returning different strings are not duplicates), free the others in memory and on disk, move the grants of each released entry to the entry it keeps (so grant, ungrant, serve and a composition plan naming a released entry resolve against the kept entry, also after the journal is replayed), and compact the journal behind a `library_compacted` record that names the previous tip.

- Rationale: Duplicate entries cost memory and journal size without adding behaviour. Until round 8 the fingerprint turned text results into numbers, so modules returning `"!"` and `"\""` both printed `NaN` and one was discarded as a duplicate, and reclaim released a duplicate without its grants, so a tenant granted only that entry lost access (backfill review R1, R2).
- Derivation: `core/library/library.mjs`, `core/library/journal.mjs`, `core/library/discriminate.mjs`
- Allocated to: SDD §4 C-05 Library
- Verification: T — `make library-test`
- Status: Baselined (changed in round 8: exact text fingerprints, grants kept on reclaim)

### REQ-LIB-006 — Refusals become counterexamples

A refused reuse shall record its counterexamples and its refusal identity under the environment it was refused in, so that a later lookup in that environment whose tests that entry is known to fail, or an identical refused need, misses with `counterexample` before any cell runs, across restarts, while another environment where the entry qualified is not refused by it.

- Rationale: A refusal is evidence; spending a cell on the same refusal again is waste. Until round 8 the refusal identity omitted the environment, so a refusal recorded in one environment was replayed in another after the entry requalified there (backfill review R3). Refusals journaled before round 8 carry no environment: their counterexamples still apply in every environment, and their old refusal identities no longer match.
- Derivation: `core/library/library.mjs`
- Allocated to: SDD §4 C-05 Library
- Verification: T — `make library-test`
- Status: Baselined (changed in round 8: refusals kept per environment)

### REQ-LIB-007 — Per-environment qualification

The library shall record qualification per environment (Node, V8, platform, architecture), serve an entry only where it is qualified, and keep an entry qualified elsewhere when requalification fails in a new environment.

- Rationale: A failure on one runtime says nothing about another.
- Derivation: `core/library/library.mjs`
- Allocated to: SDD §4 C-05 Library
- Verification: T — `make library-test`
- Status: Baselined

### REQ-LIB-008 — Composition across separate memories

`library.compose` shall link parts that each use linear memory or a table, giving each part its own WebAssembly memory (after memory 0, which holds the host's buffers), bounds-checked to the part's own size, and its own table, copy structured values between parts only as layout-checked copies between memories made by the linked wrapper, and refuse a plan whose parts do not fit the 64 MiB workcell memory, whose stage layouts disagree, or that passes a buffer address as a scalar.

- Rationale: Kernels with state live in linear memory; composition must not be limited to at most one such part.
- Derivation: `core/library/link.mjs`, `core/library/compose.mjs`, `core/library/mutants.mjs`, `core/runtime/x1/meter.mjs`
- Allocated to: SDD §4 C-05 Library
- Verification: T — `make library-test`
- Status: Baselined

### REQ-LIB-009 — Structured mutation check

For an export that takes or returns a `record`, `list` or `text`, the library's discrimination check shall build its probe grid from the declared layout, call the kernel and each mutant through the host buffers of a fuel-metered instance, compare results field by field, and apply its result wrappers to every `number` leaf.

- Rationale: A kernel over records or lists must get a real mutation check under `gate: 'full'`; scalar-only probing reports every mutant killed without exercising it.
- Derivation: `core/library/discriminate.mjs`, `core/library/mutants.mjs`, `core/library/cell.mjs`
- Allocated to: SDD §4 C-05 Library
- Verification: T — `make isolate-test`, `make library-test`
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
- Verification: T — `make isolate-test` (delegated enforcement: REQ-ISO-018)
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

The pool shall write receipts through one persistent ledger bridge that batches concurrent requests per ledger path in a single transaction with per-request savepoints, replies only after commit, verifies the full hash chain on every read, invalidates cached rows on any mismatch, and fails closed without respawn when the bridge exits, with `LedgerBridge` exposing the bridge process's pid read-only as `pid` (`undefined` until the process is spawned, and still the dead process's pid after the bridge fails closed).

- Rationale: Remove per-request process spawn and full re-validation as the throughput limit without weakening chain verification.
- Derivation: `core/runtime/isolate-ledger.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined (changed in round 9, S1: the bridge-death test waits for the pool's own bridge through `pool.ledger.pid`, checks that its parent is the test process and kills exactly that pid. Before, it read the test process's children once, right after `pool.run()`, and expected one `python3`: the bridge might not have started yet (seen in CI on Node 26 under load), and a `python3` child it found might not be the pool's bridge)

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
- Verification: T — `make isolate-test` (the delegated cases need a delegated scope and skip without one; REQ-ISO-018)
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

### REQ-ISO-018 — Delegated cgroup enforcement

In a delegated cgroup v2 scope, process mode shall have its limits enforced, not only written: `prepareCgroup` moves the supervisor into its own leaf and enables the `memory`, `cpu` and `pids` controllers; `attachCgroup` writes the stated `memory.max`, `memory.oom.group=1`, `cpu.max`, `pids.max` and, where the file exists, `memory.swap.max=0`, and moves the process in; a process past `memory.max` is killed, process creation past `pids.max` is refused and a process past `cpu.max` is throttled; and a process-mode pool ends a cell killed by its limit with an inconclusive receipt, keeps serving, and removes every cell group on release.

- Rationale: Process mode's off-heap bound (REQ-ISO-013) holds only if the delegated limits are enforced, not only written (formerly GAP-EF-001).
- Derivation: `core/runtime/isolate-cgroup.mjs`, `core/runtime/isolate-pool.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test` (the case runs itself inside `systemd-run --user --scope` and skips with the reason where no delegated scope with those controllers exists)
- Status: Baselined

### REQ-ISO-019 — Synchronous host calls

With `syncHostCalls` set, the pool shall give each job's port a channel (`portOptions.syncHostCall`: a growable shared buffer in a thread cell, blocking pipes on file descriptors 4 and 5 in a process cell) that `connectSyncHostCall` turns into a blocking call answered by the `syncHostCalls` function before the cell's next statement, counted against the same 4,096 calls per job and 1 MiB request limit as asynchronous host calls, with the job timeout paused while the host answers and the total deadline still applying, and with no channel in `portOptions` when `syncHostCalls` is unset.

- Rationale: A synchronous interface such as the WIT `read` cannot await an asynchronous host call; without this path the compatibility workcell had to copy snapshots in with the job.
- Derivation: `core/runtime/isolate-pool.mjs`
- Allocated to: SDD §4 C-06 Isolate pool
- Verification: T — `make isolate-test`
- Status: Baselined (round 6)

### REQ-STUB-001 — Stub pool replay

`core/runtime/stub-pool.mjs` shall copy the recorded outputs of the atom named by the launch spec's `/out` bind from `ENDOFORGE_STUB_REPLAY/atoms/<id>/out` into that bind after `ENDOFORGE_STUB_LATENCY_MS`, log a stub account line with `pid=` in the form the atomizer scheduler attributes, run `CODEX_POOL_BIN` with `SIGTERM` and `SIGINT` forwarded, return its exit status (failure when it dies on a signal), and fail with a message when the replay has no outputs for the atom, the spec has no `/out` bind or cannot be read, or the next pool cannot start.

- Rationale: Atomizer replays need a stand-in pool that behaves like the real one at its boundary (formerly GAP-EF-007).
- Derivation: `core/runtime/stub-pool.mjs`
- Allocated to: SDD §4 C-31 Stub pool and approved atoms
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

### REQ-X1-005 — Structured state at the kernel boundary

The X1 gates shall pass glue kinds `record`, `list` and `text` through host-owned linear-memory buffers in the declared little-endian, naturally aligned layout, compare structured results structurally, refuse a kernel that writes into an input buffer or a value that does not fit its layout without counting it as a trap, and keep scalar kernels' behaviour.

- Rationale: Edition 3 §5 kernels take state and events in and give state out as data.
- Derivation: `core/runtime/x1/measure.mjs`, `core/runtime/x1/gates.mjs`, `core/runtime/x1/glue.schema.json`, `core/runtime/x1/contract.mjs`, `core/runtime/x1/dimensions.mjs`, `core/runtime/x1/agent.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-X1-006 — Independent re-run at commit

The commit shall re-run the gates on the committed candidate whenever the cell report claims a pass, and reject the receipt when the re-run's verdict or test outcomes disagree with the report.

- Rationale: A consistent wrong report from code in the cell must not promote (P-50).
- Derivation: `core/runtime/x1/loop.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-X1-007 — Frozen implementation lists cover the loop

The frozen implementation lists shall include every x1 file the host and the cell import, so that a frozen tree whose `dimensions.mjs` or `generator.mjs` differs from the running code never passes.

- Rationale: The drift check must cover the code that decides G9 and generation.
- Derivation: `core/runtime/x1/host.mjs`, `core/runtime/x1/loop-port.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-X1-008 — Nine-gate labels

The X1 ledger tools shall write the labels `X1 G1-G9` (task and frozen residual) and `X1-G1-G9/v2` (decision policy) into new records, verify and promote records with the older labels unchanged, and print `tools.x1_ledger` usage with exit 2 on missing, unknown or extra arguments.

- Rationale: Labels must match the nine-gate rule without rewriting stored identities.
- Derivation: `tools/x1_loop.py`, `tools/x1_ledger.py`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make ledger-test`
- Status: Baselined

### REQ-X1-009 — Structured comparison at commit

The commit's evidence re-check shall compare a recorded structured result with its frozen expectation by structure: records by field name with exactly the frozen fields, lists by length and item, text by its bytes within `maxBytes`, each leaf against the kind the candidate's glue declares, and the frozen `tol` on every numeric leaf.

- Rationale: A structured-state kernel must promote through the in-cell commit whatever order the frozen test lists record fields in.
- Derivation: `tools/x1_loop.py`, `core/runtime/x1/loop.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-X1-010 — Python drift list and receipt label

The X1 commit tools shall name, in the bridge's drift check (`IMPLEMENTATION_FILES` in `tools/x1_loop.py`), every frozen x1 implementation file that the host and cell lists name, and write the nine-gate label `X1 G1-G9` as the receipt's `acceptance_boundary` (`core/runtime/x1/ledger.mjs`).

- Rationale: The commit must refuse drift in any file that decides a verdict, and labels must match the nine-gate rule.
- Derivation: `tools/x1_loop.py`, `core/runtime/x1/ledger.mjs`, `core/runtime/x1/host.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-X1-011 — Every memory metered

The meter shall read every memory a module declares or imports, export each unexported one, meter loads and stores that name a memory index, and count measured memory as the sum of all memories.

- Rationale: A composed library module has one memory per part; reading only the first would leave the others unmeasured.
- Derivation: `core/runtime/x1/meter.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
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

### REQ-LOOP-005 — Library and synthesis on every path

The `isolate` and `agent` paths shall consult a supplied library after the freeze and skip implementation on a pass, and with `ENDOFORGE_SYNTH=1` freeze `synth/evaluator.json` into the ledger bundle before any code exists and refuse at commit what that evaluator refuses.

- Rationale: Reuse and the candidate-blind evaluator apply whichever path runs the need.
- Derivation: `core/runtime/x1/loop.mjs`, `core/runtime/x1/loop-port.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-LOOP-006 — Per-stage token budget

On the agent path, `limits.maxTokens` shall bound each stage (specification, implementation) separately, in both wait modes.

- Rationale: P-56 sized budgets per stage; one shared budget let a long specification starve implementation.
- Derivation: `core/runtime/x1/loop.mjs`, `core/runtime/x1/loop-port.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`, `make loop-test`
- Status: Baselined

### REQ-LOOP-007 — Suspect tests become a specification correction

When evaluator synthesis reports suspect frozen tests, every loop path shall, before any candidate, record the report in the ledger as an `admitted_input` and freeze a revision of the latest frozen evaluator with reason `specification_correction` whose tests take the references' agreed outcome, then judge the candidate against the revised tests.

- Rationale: A frozen test that two qualified references contradict is likely wrong (P-56); correcting it under the ledger's revision rule before code costs no failed candidate.
- Derivation: `tools/x1_loop.py`, `core/runtime/x1/loop.mjs`, `core/runtime/x1/pipeline.mjs`, `core/runtime/x1/ledger.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-LOOP-008 — Compatibility promotion on every path

When `runNeed` is given a compatibility route with `freeze` and `promote`, every loop path shall freeze the specification's tests into `compatibility.sqlite` before any candidate and decide the TypeScript candidate with `route.promote` under policy `COMPAT-TS-CHECK-RUN2-TESTS/v1`, returning that decision as `compatibility` without changing the kernel decision.

- Rationale: The compatibility lane has its own promotion rule; a pipeline that only reported it left the decision to the caller.
- Derivation: `core/runtime/x1/loop.mjs`, `core/runtime/x1/pipeline.mjs`, `core/runtime/contained/promotion.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-LOOP-009 — Caller principal reaches the library

Every loop path shall pass the `principal` given to `runNeed` to `library.serve`.

- Rationale: Tenant and lineage scopes (REQ-LIB-004) must apply to the caller of the pipeline, not to the principal the library was opened with.
- Derivation: `core/runtime/x1/loop.mjs`, `core/runtime/x1/pipeline.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-LOOP-010 — Structured specification correction

`revise` shall correct a suspect test to a record, list or text value only when the suspect carries a valid declared layout, both reference values fit it and agree under the structured comparison of REQ-X1-009 with the test's `tol`, freezing the value in declared field order, and refuse otherwise without appending to the ledger.

- Rationale: A kernel over structured state can have a wrong frozen test too; without a declared layout a structure cannot be compared or frozen soundly.
- Derivation: `tools/x1_loop.py`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make ledger-test`
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

### REQ-GEN-009 — Relative Codex command

The generator shall resolve a relative `ENDOFORGE_CODEX_CMD` path, or a `./` or `../` entry in its JSON argv, against the caller's working directory before running Codex in `candidate/`, and leave bare command names to `PATH`.

- Rationale: Generation runs in a different directory from the caller.
- Derivation: `core/runtime/x1/generator.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-GEN-010 — Implementation turn reads corrected tests

After the freeze, `generate` shall re-read `tests.json` and `frozen.sha256` from the oracle root and, when a specification correction changed them, refuse them unless they match the frozen digest and every test can fail, then give the corrected files to the workspace, the implementation prompt, the library lookup and the returned candidate.

- Rationale: On the Codex paths the implementation turn must write code against the same tests every check uses.
- Derivation: `core/runtime/x1/generator.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-GEN-011 — Capability block required at the freeze and checked at G7

Generation shall ask in both specification prompts for a fenced ```capability block in `CONTRACT.md` (exports with ordered arguments, kinds, units, ranges, number precision, code tables and traps, and for every record, list or text value, at every depth, its layout: a record's `fields`, a nonempty list of uniquely named fields, each with its kind, a unit when integer, number or code, and codes when code; a list's `items`, the layout of one item, and `max`, 1 to 4096; a text value's `maxBytes`, 1 to 65536), ask in both implementation prompts for `glue.json` to declare the same nested layout, refuse at the freeze on the `current`, `isolate` and `agent` paths a contract with no block or with a block that is malformed, leaves out a structured value's layout, leaves out a number field's `precision` or a boolean field's `labels` anywhere inside a structured result, or disagrees with the frozen tests (the agent path returns the refusal to the model as specification problems and never freezes), fail G7 when the frozen block leaves out a structured value's layout (`the capability block does not declare the layout: ...`, whatever the glue declares) or when `glue.json` disagrees with the frozen block on exports, argument kinds, units, ranges and codes, result kind, unit, precision, rounding, codes and labels, or traps (`capabilityAgreement`, comparing units and ranges as library lookup does, and going down through structured values: record fields matched by name with missing and extra fields reported, list `items` and `max`, text `maxBytes`, and at every level the same kind, unit, range, precision, rounding, codes and labels as at the top), and let library lookup serve a generated need whose block matches a promoted kernel without an implementation stage on the `current` and `agent` paths.

- Rationale: The library keys entries by the capability that `core/library/key.mjs` `capabilityFromContract` reads from this block. A block-less contract could freeze until round 6 and then always missed with `no_capability`; glue that disagrees with the block would describe a different capability from the one the library keys.
- Derivation: `core/runtime/x1/generator.mjs`, `core/runtime/x1/agent.mjs`, `core/runtime/x1/contract.mjs`, `core/runtime/x1/gates.mjs`, `core/library/key.mjs`
- Allocated to: SDD §4 C-07 X1 candidate loop
- Verification: T — `make isolate-test`
- Status: Baselined (round 5; changed in round 6, M1: the block is required on every path and G7 checks the glue against it; changed in round 8, R4: G7 compares nested structure, where it compared only the top level, so a nested Celsius result relabelled Fahrenheit in `glue.json` passed). Since round 7 the stand-alone `tools/gate/gate.mjs freeze` runs the same check (REQ-GATECLI-001), and every atomizer path that writes `CONTRACT.md` asks for the block (REQ-ATOM-006). Changed in round 9, S2: a record, list or text value must declare its layout in the block, every prompt that asks for the block asks for it, and the freeze and G7 refuse a block without it. Until then such a block agreed with any glue layout, so nested drift went uncaught (finding D-11, closed)

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

### REQ-SYNTH-002 — Judging in a cell

`evaluate` shall judge each candidate against the frozen synthesized evaluator in a separate worker thread with heap and stack limits, an empty environment and a deadline, and refuse the candidate when that cell times out, crashes or runs out of memory.

- Rationale: Judging runs candidate code; it belongs in a bounded cell, not on the controller thread.
- Derivation: `core/runtime/x1/synth/cell-host.mjs`, `core/runtime/x1/synth/cell.mjs`, `core/runtime/x1/synth/judge.mjs`, `core/runtime/x1/synth/stage.mjs`
- Allocated to: SDD §4 C-08 Evaluator synthesis
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-SYNTH-003 — Suspect frozen tests

At width 2, `finish` shall report a frozen test as suspect, before implementation, only when both references pass every meta-gate except M3, contradict the same tests the same way and reproduce each other's vectors, writing `synth/suspect.json` and calling the caller's `suspect` hook.

- Rationale: A frozen test two independent qualified references both contradict is likely wrong (P-56) and should be revised before code.
- Derivation: `core/runtime/x1/synth/stage.mjs`
- Allocated to: SDD §4 C-08 Evaluator synthesis
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-SYNTH-004 — Judging in a cell at commit

On the `isolate` and `agent` paths, the commit shall judge the candidate against the frozen synthesized evaluator with `judgeInCell`, in a bounded worker thread separate from the controller thread.

- Rationale: Judging runs candidate code; every path must keep it off the controller thread.
- Derivation: `core/runtime/x1/loop.mjs`, `core/runtime/x1/synth/cell-host.mjs`
- Allocated to: SDD §4 C-08 Evaluator synthesis
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-SYNTH-005 — Structured references and suspects

Evaluator synthesis shall accept references that return records, lists or text for an export whose binding declares a valid layout, fail M2 for a value that misfits it, compare structured anchors field by field, and attach the declared layout to every structured suspect.

- Rationale: Suspect correction (REQ-LOOP-010) needs agreeing structured reference values and their declared layout before any glue exists.
- Derivation: `core/runtime/x1/synth/sandbox.mjs`, `core/runtime/x1/synth/layout.mjs`, `core/runtime/x1/synth/stage.mjs`, `core/runtime/x1/synth/qualify.mjs`, `core/runtime/x1/synth/invariants.mjs`, `core/runtime/x1/synth/vectors.mjs`
- Allocated to: SDD §4 C-08 Evaluator synthesis
- Verification: T — `make ledger-test`
- Status: Baselined

### REQ-SYNTH-006 — Judging structured exports

`judge` shall call an export whose glue entry takes or returns a record, list or text through the declared layout and the host buffers, compare the whole decoded value with the vector's expected value, and refuse on a difference or a boundary problem.

- Rationale: Synthesized checks of a kernel over structured state must run against the kernel, not be skipped.
- Derivation: `core/runtime/x1/synth/judge.mjs`, `core/runtime/x1/measure.mjs`
- Allocated to: SDD §4 C-08 Evaluator synthesis
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-SYNTH-007 — Structured synthesized vectors

Evaluator synthesis shall generate inputs for a record, list or text parameter from the layout the binding declares for it (an empty value, a full value and seeded random values), from the frozen tests' values, and from reference results that fit that layout; qualify the resulting vectors under M1 to M5 like numeric ones; keep them in `combine` at width 1, and at width 2 only where the other member's reference gives the same value through the declared layout; and keep ranges and codes for such exports while keeping a monotone relation only over a numeric parameter.

- Rationale: Synthesized checks must reach kernels over structured state, which `judge` already runs (REQ-SYNTH-006); before round 4 `combine` dropped them.
- Derivation: `core/runtime/x1/synth/vectors.mjs`, `core/runtime/x1/synth/stage.mjs`, `core/runtime/x1/synth/qualify.mjs`
- Allocated to: SDD §4 C-08 Evaluator synthesis
- Verification: T — `make isolate-test`
- Status: Baselined

### REQ-SYNTH-008 — Caller's judging-cell limits on every path

`runNeed({ synthCell })` shall pass `synthCell` to `begin({ cell })` on every loop path, and on the `isolate` and `agent` paths on through the commit to `judgeInCell`, so the judging cell runs under the caller's deadline and heap limits.

- Rationale: A caller that tightens or widens the judging cell must get the same limits whichever path runs.
- Derivation: `core/runtime/x1/loop.mjs`, `core/runtime/x1/pipeline.mjs`
- Allocated to: SDD §4 C-08 Evaluator synthesis
- Verification: T — `make isolate-test` (all three paths; the `current` path since round 6, where a refusal by the synthesized evaluator now carries the same `problem` text as on the other paths)
- Status: Baselined

### REQ-SYNTH-009 — Reference sandbox deadline

`runReferences` shall stop its reference child with `SIGKILL` at a deadline derived from the work it runs (`startupMs`, default 30000 ms, plus for each reference variant 2000 ms of load time and the smaller of 400 ms per call and 4400 ms), or at the caller's explicit `timeout`, and reject with an error that tells the cases apart: `reference sandbox timed out after N ms (deadline D ms)`, `reference sandbox exited with code X`, `reference sandbox exited with signal S`, `reference sandbox exceeded its output limit` or `reference sandbox returned no result`.

- Rationale: Until round 10 every reference call ran in one child under a single 30-second wall-clock limit, and every failure read "reference sandbox failed or timed out". Under heavy load (several full suites at once) `gaps4-synth` S1 failed at that limit, though the run alone took 2.8 to 16 s (finding D-14). M2 reports the error with its `M2 ` prefix, so a timeout is now told apart from a crash.
- Derivation: `core/runtime/x1/synth/sandbox.mjs`, `core/runtime/x1/synth/stage.mjs`
- Allocated to: SDD §4 C-08 Evaluator synthesis
- Verification: T — `make isolate-test`
- Status: Baselined (round 10, T1). The `hold` option, which makes the child wait before it starts, exists for the tests. Inside the child each variant's calls still share a 4000 ms wall-clock budget (the `budget` result), which this deadline does not change

### REQ-ORACLE-001 — Formula oracle

With `limits.oracle` set (default off), the agent loop shall recompute frozen expectations from the contract's formula, ranges and `reference.js` before the freeze, replace a literal when the formula and the reference agree on another value, return flagged tests to the model, evaluate a piecewise or conditional rule only inside its own condition, and abstain on a branch it cannot read or on conflicting definitions.

- Rationale: Catch wrong frozen expectations before implementation (P-69, P-70, P-71; still off by default).
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

### REQ-TRANSPORT-002 — Transport defaults

The Claude transports shall pass `--model sonnet` unless the caller names a model, report `testDouble: true` when the command is not named `claude` unless overridden, and, in the warm transport, admit every turn through a governor passed per instance or by the caller.

- Rationale: A transport must not launch with an undefined model, mislabel a stand-in, or ignore the caller's usage governor.
- Derivation: `core/runtime/x1/transports.mjs`
- Allocated to: SDD §4 C-09 Model access
- Verification: T — `make isolate-test`
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

### REQ-CONTAINED-002 — Compatibility-lane promotion

The compatibility lane shall promote a TypeScript candidate under policy `COMPAT-TS-CHECK-RUN2-TESTS/v1` only when its tests equal the tests frozen before it, the pinned compiler matches, the type check was clean, the two runs agreed and the policy's own re-score of the recorded output passes every frozen test, refuse forged or tampered evidence, and return `inconclusive` for an unknown route outcome.

- Rationale: The lane needs its own promotion rule; a report alone decides nothing.
- Derivation: `core/runtime/contained/promotion.mjs`, `tools/compat_policy.py`, `tools/tscheck/contained-route.mjs`
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

### REQ-KERNEL-005 — Declared effects, durable denials and task conformance

The kernel host shall release a transition only when every returned effect matches a declaration whose `id` equals the kernel's frozen effect-schema identity (capability, operation, `bytes`, `utf8` or `json` encoding, byte bounds, an optional JSON schema without `$ref`, and `max_effects`), freeze the declaration as a deep copy before checking and hashing it (so a caller that later changes its own payload specs changes neither enforcement, the declaration's SHA-256 nor the Workcell cache key), refuse a `json` payload holding any non-finite number (`NaN`, `Infinity` or an overflowing literal such as `1e999`) as `payload-not-json`, permit no effect without a declaration, reject the whole transition with `EffectDenied` otherwise (reported by `run_candidate` as `denied`), append every effect and broker denial to a `DenialJournal`, an append-only SQLite journal hash-chained with the ledger's encoder that refuses update and delete and verifies its chain on reopening, and let `conformance.check` (also a process entry point reading JSON on stdin) run a frozen task's cases through the workcell and report each as `passed`, `wrong`, `denied`, `trapped` or `refused`.

- Rationale: Effects were returned unchecked and denials left no record, and nothing outside the kernel tests used the host (round 6, M4); the Rust lane's admission is now its caller (REQ-RUST-001). Until round 8 the frozen declaration kept references to the caller's payload specs, and `{"x":1e999}` parsed to infinity and passed (backfill review R5, R6).
- Derivation: `tools/kernel/effects.py`, `tools/kernel/journal.py`, `tools/kernel/conformance.py`, `tools/kernel/workcell.py`, `tools/kernel/broker.py`, `tools/kernel/limits.py`
- Allocated to: SDD §4 C-17 Kernel host
- Verification: T — `make kernel-test`
- Status: Baselined (round 6; changed in round 8: deep-copied declaration, non-finite JSON numbers refused)

### REQ-TOOLS-001 — Pinned kernel test tools

`make tools` shall install Wasmtime and wasm-tools at the versions pinned in `tools/kernel/install_tools.py` into `.tools/`, install nothing on a hash mismatch, and `make kernel-test` refuses to run with missing or wrong versions.

- Rationale: Kernel tests are only comparable with the pinned toolchain.
- Derivation: `tools/kernel/install_tools.py`, `Makefile`
- Allocated to: SDD §4 C-17 Kernel host
- Verification: T — `make core-test`
- Status: Baselined

### REQ-COMPAT-001 — TypeScript reducer contract

The compatibility contract shall pin the exact EF-18 WIT digest and refuse extra or missing exports, wrong types, asynchronous reducers, contract and schema drift, malformed budgets, transitions and effects, snapshot policy and inputs before reducer code runs, and revoke borrowed handles after a thrown reducer, with `probeInWorkcell` running these checks inside `IsolatePool` workcells, binding source, WIT, evaluator, runtime and compiler identities in the receipt, refusing a reducer that hangs, exits or exhausts the cell heap while the pool keeps serving, refusing contract drift, shared memory and a snapshot list that is not an array of at most 1,024 unshared byte arrays before dispatch, keeping snapshots in the host and serving each borrowed buffer's `size` and `read` through synchronous host calls (`syncHostCalls: serveHostBuffer`, REQ-ISO-019) under the same input budget, with the host checking bounds again, and recording the calls and bytes served as `hostBuffers` in the receipt.

- Rationale: TypeScript reducers must meet the same contract as kernel components, and the WIT `read` is synchronous, so a borrowed buffer must be read from the host, not copied in with the job (round 6, M3).
- Derivation: `tools/compatibility/contract.ts`, `tools/compatibility/reference.ts`, `tools/compatibility/workcell.mjs`, `tools/compatibility/port.mjs`
- Allocated to: SDD §4 C-18 Compatibility contract
- Verification: T — `make test` (`compatibility-test`), `make isolate-test` (`gaps6-hostcall.test.mjs`)
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
- Derivation: `TODELETE/tools/step_harness/harness.py`
- Allocated to: SDD §4 C-20 Step harness (retired)
- Verification: T — `make harness-test`, which now runs `tools/step_harness/test_retired.py`: the harness is archived, its 12 archived tests still pass, and no code outside `TODELETE/` calls it
- Status: Deleted 2026-11-09 (round 5, P4). Nothing in EndoForge called the harness, and no caller belongs here: it needs a POODO core with `decide` and `execute`, and none is in this repository; the conductor's workers (`claude -p`, Codex) run their own tool calls, so the host cannot decide each step; the job tool runs no agent loop; and the X1 candidate loop in `core/runtime/x1/` is already EndoForge's host-decided loop. The code and its tests moved to `TODELETE/tools/step_harness/` ([reasoning](../../tools/step_harness/README.md))

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

### REQ-ATOM-004 — Atomizer references and usage

The atomizer shall ship `LEDGER.md` listing exactly the events its code emits, default `bench.mjs` to an atoms file in the repository and refuse a missing one with exit 2, and print `testcheck.mjs` usage with exit 2 when arguments are missing.

- Rationale: A tool must not point at files that do not exist or crash on a bare run.
- Derivation: `tools/atomizer/LEDGER.md`, `tools/atomizer/bin/bench.mjs`, `tools/atomizer/bin/testcheck.mjs`
- Allocated to: SDD §4 C-22 Atomizer
- Verification: T — `make atomizer-test`
- Status: Baselined

### REQ-ATOM-005 — Atomizer commands

The atomizer commands `atomize`, `direct`, `fanout`, `report` and `cutover` shall each behave as follows on script workers: every command prints its usage and exits 2 without its required arguments; `atomize --fixture` validates, plan and record a valid graph without a model, and refuses an invalid graph or output that is not JSON without writing `atoms.json`; `direct` writes a valid one-atom graph named after the request; `fanout` runs several script graphs as one pool, verifies and reports each, records a graph the scheduler refuses and keeps running the others, and exits 1 when a request fails verification; `report` renders the timeline, waves and verification of a run directory; and `cutover` pairs the arms per case, records a model arm the subscription guard refuses, writes a ledger event for every case, refuses an unknown arm, and finishes cleanly when no case matches.

- Rationale: The commands other than `schedule`, `verify` and `bench` had no test and crashed on several of these inputs (formerly GAP-EF-008).
- Derivation: `tools/atomizer/bin/atomize.mjs`, `tools/atomizer/bin/direct.mjs`, `tools/atomizer/bin/fanout.mjs`, `tools/atomizer/bin/report.mjs`, `tools/atomizer/bin/cutover.mjs`
- Allocated to: SDD §4 C-22 Atomizer
- Verification: T — `make atomizer-test` (script workers and fixtures; model arms are checked only as refused without a subscription login)
- Status: Baselined

### REQ-ATOM-006 — Capability block on every atomizer contract path

Every atomizer path that writes `CONTRACT.md` shall ask for the ```capability block in the candidate loop's own wording (`capabilityRule`, which asks for the layout of every record, list or text value): the planning prompt of `atomize.mjs`, the `contract` kind procedure in `policy.json`, the contract atom of `plan-template.mjs` and the `direct` procedure (before its freeze), with the glue procedure, the `direct` procedure and the templated glue atom asking for the same nested layout in `glue.json`, the glue procedure and the templated glue atom reading the contract to match the block, the `direct` atom's contract and the templated contract atom naming the layout, and every prompt naming the gates G1 to G9; `compose-kernel.mjs` refuses with exit 3, before freezing or compiling, a contract atom's `CONTRACT.md` with no block or a block that is not JSON; and the compose atom's toolchain carries the gate's own modules and the pinned compiler, so the compose helper freezes and gates to a promotable kernel inside the atom sandbox.

- Rationale: Round 6 made the block required at the freeze, but no atomizer prompt asked for it and the compose sandbox could not load the gate's modules, so every real atomizer run failed at the freeze or at G7. The tests use script workers, so they did not show it (round 7, N1).
- Derivation: `tools/atomizer/bin/atomize.mjs`, `tools/atomizer/bin/plan-template.mjs`, `tools/atomizer/bin/direct.mjs`, `tools/atomizer/bin/compose-kernel.mjs`, `tools/atomizer/policy.json`, `tools/atomizer/lib/workers.mjs`, `tools/atomizer/lib/augment.mjs`
- Allocated to: SDD §4 C-22 Atomizer
- Verification: T — `make atomizer-test` (rendered prompts asserted as text; the compose helper runs in a real `bwrap` sandbox)
- Status: Baselined (round 7; changed in round 9, S2: the prompts ask for the nested layout of records, lists and text)

### REQ-ATOM-007 — Atomizer verify policy and helper usage

`tools/atomizer/bin/verify.mjs` shall load the policy named by `--policy` (default the `policy.json` next to the tool) and take from it the `node` toolchain its acceptance checks run with, taking its options and the run directory in any order, refuse with exit 2 and its usage, before checking anything, a missing, unreadable or non-object policy, a missing or second run directory, a run directory without `atoms.json` and an unknown option, record the policy's path and SHA-256 as `policy` in `receipt/verify.json`, and print its usage with exit 0 for `--help`; `ledger-export.mjs` and `repair-noop.mjs` print their usage with exit 0 for `--help` and refuse with exit 2, a message and no stack trace, missing or bad arguments (no ledger events file, `--out` without a value, an unknown argument, a missing `--failures` or `--map`, a `--map` that is not a JSON list of `from`/`to` paths), while `repair-noop.mjs` keeps exit 10 for a failing or unreadable `failures.json`; `fanout.mjs` and `cutover.mjs` take `--policy <file>` (default the same `policy.json`), refuse with exit 2 before running anything a missing, unreadable or non-object policy or a `--policy` with no file after it, pass that file to `schedule.mjs` and `verify.mjs`, and record its path and SHA-256 as `policy`: `fanout.mjs` in `fanout.json` and the `pool.start` event, `cutover.mjs` in the `cutover.start` event; `atomize.mjs`, `plan-template.mjs` and `direct.mjs` take `--policy` with the same default and the same exit-2 refusals (with their usage), validate their plan against that policy and record its path and SHA-256 as `policy` in their receipt (`receipt/atomize.json`; `direct-atoms.json`, which also gets `valid` and `errors`) and in their start and end events, `direct.mjs` exiting 1 when its plan breaks the policy and `plan-template.mjs` writing an invalid receipt when the model call is refused; and `cutover.mjs` passes its policy to every planning step and records for each arm `planPolicy` and `planPolicyMatches`, giving an arm whose plan used another policy, or whose plan the policy rejects, `planValid: false` without scheduling it.

- Rationale: Until round 8 `verify.mjs` printed `--policy` in its usage but always loaded the default policy, `ledger-export.mjs` and `repair-noop.mjs` printed no usage, and a bare `ledger-export.mjs` with no ledger threw `ENOENT` (finding D-10, backfill review R13).
- Derivation: `tools/atomizer/bin/verify.mjs`, `tools/atomizer/bin/ledger-export.mjs`, `tools/atomizer/bin/repair-noop.mjs`, `tools/atomizer/bin/fanout.mjs`, `tools/atomizer/bin/cutover.mjs`, `tools/atomizer/bin/atomize.mjs`, `tools/atomizer/bin/plan-template.mjs`, `tools/atomizer/bin/direct.mjs`
- Allocated to: SDD §4 C-22 Atomizer
- Verification: T — `make atomizer-test`
- Status: Baselined (round 8; changed in round 9, S3: `fanout.mjs` and `cutover.mjs` pass the policy they ran with to `schedule.mjs` and `verify.mjs`, where they called `verify.mjs` without `--policy` and so verified against the default one; finding D-12, closed; changed in round 10, T3: cutover's planning steps take, use and record the policy too, where they read the default `policy.json`; finding D-16, closed). `schedule.mjs` honours `--policy` but does not record it in `run.json`; `verify.mjs` records it

### REQ-ATOM-008 — Node toolchain from the running Node

The atomizer shall resolve the `node` toolchain mounted into atoms to `ENDOFORGE_TOOLCHAIN_NODE`, else `policy.toolchain.node`, else the install prefix of the Node running the atomizer (the shipped `policy.json` names none), and refuse, before any sandbox starts and with a message naming the variable and the running Node's prefix, a configured node home that has no `bin/node`.

- Rationale: The policy named `/usr`, so on hosts without a system Node, including GitHub's runners, compose atoms failed with `execvp node` (round 7b, PR #143's coverage job).
- Derivation: `tools/atomizer/lib/workers.mjs`, `tools/atomizer/policy.json`
- Allocated to: SDD §4 C-22 Atomizer
- Verification: T — `make atomizer-test`
- Status: Baselined (round 7b)

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

### REQ-COND-003 — Conductor checks, worktree lock and worker tools

The conductor shall run, for an atom without `conductor.checks`, the runnable checks of the criteria it lists, keep its collect lock in the repository's real git directory, and launch Claude workers allowed `make` and `python3` unless `conductor.claudeTools` replaces the list.

- Rationale: An atom must never be frozen with its own acceptance checks unrun, and a worker must be able to run its tests (G29–G31).
- Derivation: `tools/conductor/lib/checks.mjs`, `tools/conductor/lib/collect.mjs`, `tools/conductor/lib/launch.mjs`, `tools/hillclimb/lib/fanout.mjs`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-COND-004 — Adopt example

`conduct adopt` shall name an example map directory that exists and whose shipped map adopts the shipped old job, with running lanes tracked, collected ones checked and others keeping their status.

- Rationale: The adopt path needs a working example.
- Derivation: `tools/conductor/lib/adopt.mjs`, `tools/conductor/examples/fanout-loop.adopt-map.json`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-COND-005 — A relaunch patch reopens a finished job

`applyPatch` shall, for a coordinator patch whose `relaunch` names atoms, set each of them to `relaunch` and, when the job's phase is past `streaming` (`gates`, `locks`, `finals`, `compose` or `done`), move the phase back to `streaming` with a state-log entry `{from, to, why, reopened: true}` and a `GATE` event (which, when the phase was `done`, says the conductor had ended and must be started again), return `reopened: true`, refuse a relaunch on a job the user stopped before writing anything, and leave a done job done for a patch without `relaunch`, while the daemon advances a phase only if the phase did not change while its handler ran, so a reopen is not overwritten.

- Rationale: Until round 10 a relaunch applied after the phase reached `done` set the atom to `relaunch` and nothing ran it, because `conduct` returns as soon as it reads `done` (finding D-15).
- Derivation: `tools/conductor/lib/escalate.mjs`, `tools/conductor/lib/state.mjs`, `tools/conductor/lib/daemon.mjs`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined (round 10, T2). A reopened `done` job needs its daemon started again (`conduct.mjs run` or `unit`); the event names it `endoforge conduct <job.json>`, the name the conductor's usage text uses for `unit`

### REQ-COND-006 — TRACE-NEEDED when an atom freezes with new tests

When an atom freezes, the conductor shall emit a `NEEDS-COORDINATOR` event with the summary `TRACE-NEEDED <atom>: new test files ...`, `data.event` `TRACE-NEEDED` and `data.tests`, listing each test file (by name: `test_*` with a `.py`, `.mjs`, `.cjs`, `.js`, `.ts` or `.sh` suffix, `*_test.py`, or `*.test.*` and `*.spec.*` JavaScript and TypeScript files) that the atom's collected commits added in any iteration and that still exists at `HEAD`, name each file at most once per atom, and emit nothing when there is none, without escalating or holding the atom.

- Rationale: New test files need trace rows before other atoms' checks run `make check`; in round 9 the coordinator found them only when a later check failed.
- Derivation: `tools/conductor/lib/collect.mjs`, `tools/conductor/lib/handlers.mjs`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined (round 10, T6). `TRACE-NEEDED` is not its own event kind (`tools/job/lib/events.mjs` has none), so it reaches the `events.coordinator` hooks like any `NEEDS-COORDINATOR` event. Adopted lanes are never collected, so their freezes emit none

### REQ-JOB-001 — Job event log

The job event log shall lose only a torn last line and say the log is incomplete, keep the next event whole, report a log with nothing readable as unknown, and sync an event before reporting it written.

- Rationale: Job status is derived from a durable log.
- Derivation: `tools/job/lib/events.mjs`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-JOB-002 — Workflow tools cite existing files

The job, conductor, atomizer and hillclimb sources shall cite only repository files that exist.

- Rationale: A citation to a missing playbook misleads the reader.
- Derivation: `tools/job/lib/compile.mjs`, `tools/job/lib/invariants.mjs`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-JOB-003 — Job kinds, card and prompt compilation

The job tool shall load every bundled kind file by its id with only known rule keys, refuse an unknown kind (including names inherited from `Object`) and a kind file with an unknown rule key, add kinds from `ENDOFORGE_JOB_KINDS`, apply each kind's check rules (`code`, `video`, `model3d`, `campus`; none for `doc` and `generic`), compile each atom's prompt with the goal verbatim, its brief, governing inputs, checks, files, declared and imported interfaces and return form, hash each prompt and the set, and compute the card hash over exactly what the user confirms, accepting only a direct confirmation of that card.

- Rationale: Kind rules, prompts and the confirmed card decide what workers are told and what the user agreed to; they had only indirect coverage (formerly GAP-EF-010).
- Derivation: `tools/job/lib/kinds.mjs`, `tools/job/kinds/`, `tools/job/lib/compile.mjs`, `tools/job/lib/card.mjs`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-JOB-004 — Records after freeze and calibrated checks (I16, I17)

The job tool shall hold invariants I16 and I17 at Decide: refuse a collect gate (`conductor.gate`, or an atom's `gate` as a string or an argv list) or a criterion check that runs a records check (`check_trace` or `test_*trace*`, also when it is reached through a target of the repository's `Makefile`, so `make check` and `make test` are refused while `make lib-test` and `make sums` are not), saying that records are written after freeze; have `job.mjs stage`, after every other Decide rule passes, run each runnable criterion check once on the base commit (`stage.base`, default `HEAD`) in a throwaway detached worktree, reset and cleaned before each check with the `conductor.links` symlinks added, with a `stage.checkTimeoutSec` limit (default 1800), and record `proofs.baseline` (`base`, `at`, and per check `run`, `status` `passed`, `failed` or `broken`, `exit`, `why` and `ms`); class as broken a check whose output names a missing Python or JavaScript module, `Could not find`, `ENOENT`, `No rule to make target` or `can't open file`, or that exits 126 or 127, and record a timeout as failed, `timed out after N ms`; refuse a broken check at every Decide validation, and a check with no baseline or whose command changed since it was calibrated in `stage` and `fire`, where plain `validate` only warns; and warn about a check that already passes on the base tree.

- Rationale: In round 9 a records check in a collect gate failed every atom, because records are written after the atoms freeze, and checks broken by a missing module or path ran unnoticed until an atom's turn was spent on them. These are the coordinator's round-10 lessons, turned into refusals.
- Derivation: `tools/job/lib/invariants.mjs`, `tools/job/lib/validate.mjs`, `tools/job/bin/job.mjs`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined (round 10, T5). `stage` runs the checks, so it can take as long as they do. The conductor's `go` and `applyPatch` validate without requiring a baseline

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

### REQ-ERR-002 — Shared lock, headroom and exit-file modules

The shared tool library shall have `lock.mjs` record the owner's pid, host and time in `<target>.lock`, reclaim a lock whose owner pid is dead on this host or an ownerless lock older than `orphanMs` but never a lock from another host, throw `LockBusy` (exit code 75) after `waitMs`, release in `withLock` even when the function throws, serialise read-modify-write across processes, and write JSON atomically leaving no temporary file; have `headroom.mjs` report `ok` only while the one-minute load is below `maxLoad` (default 0.875 of the CPUs, `ENDOFORGE_MAX_LOAD`) and available memory is at least `reserveGb` (default the larger of 8 GiB and 12% of RAM, `ENDOFORGE_RESERVE_GB`), always `ok` with `ENDOFORGE_THROTTLE=0`; and have `exitfile.mjs` record a command's exit code (128 plus the signal for a signal) without changing its output, leave no file when the wrapper itself is killed, and read back `null` for anything that is not an exit code.

- Rationale: The conductor, atomizer, project scheduler and job tools rely on these modules to tell busy from failed and finished from running; only `errors.mjs` had a direct test (round 6, M6).
- Derivation: `tools/lib/lock.mjs`, `tools/lib/headroom.mjs`, `tools/lib/exitfile.mjs`
- Allocated to: SDD §4 C-23 Conductor and job intake
- Verification: T — `make test` (`lib-test`)
- Status: Baselined (round 6)

### REQ-HILL-001 — Hillclimb lessons ledger

Hillclimb shall count lesson recurrences, reopen a closed lesson that recurs, write `LESSONS.md` from measurements and receipts, record `--close` and `--add` changes, and leave a torn ledger as it was.

- Rationale: Lessons persist across rounds and become tool changes.
- Derivation: `tools/hillclimb/lib/lessons.mjs`
- Allocated to: SDD §4 C-24 Hillclimb
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-HILL-002 — Hillclimb default runner

Hillclimb shall default its campaign runner to `bin/run-atoms.mjs` in this repository, mapping the runner contract onto the atomizer scheduler with the campaign policy, pass the stage policy as `--policy <stage>.policy.json` to a campaign's own runner as well as to the default one, give the script `compose-review`, `compose-fix` and `compose-judge` atoms the round directory at `/hc` and every file `bin/hillclimb.mjs` statically imports at its repository path under `/hc-src` (adding those files to the stage policy's `bindRoots`) while model atoms still see only this tool at `/hc-tool`, run `plan-review` from an unrelated directory, and have `hc-patch.sh` print its usage and exit 2 without its arguments.

- Rationale: A default must not depend on a launcher outside the repository, and a campaign's own runner outside the atomizer's `bindRoots` needs the same stage policy (round 6, M6). Until round 8 the compose atoms mounted only `/hc-tool`, so `hillclimb.mjs`'s imports of `tools/lib/lock.mjs` and `core/runtime/subscription-guard.mjs` were missing and every compose stage failed at module load after the model atoms finished (backfill review R7).
- Derivation: `tools/hillclimb/lib/runner.mjs`, `tools/hillclimb/lib/plan.mjs`, `tools/hillclimb/bin/run-atoms.mjs`, `tools/hillclimb/bin/hillclimb.mjs`, `tools/hillclimb/scripts/hc-patch.sh`
- Allocated to: SDD §4 C-24 Hillclimb
- Verification: T — `make test` (`lib-test`; the two compose-mount cases that start `bwrap` skip with the reason where it cannot start)
- Status: Baselined (changed in round 8: compose atoms mount what `hillclimb.mjs` imports)

### REQ-HILL-003 — Hillclimb fan-out, plan and scoreboard

Hillclimb shall treat a directory, its glob and its children as one ownership tree and refuse an unsound decomposition by name, assign lanes across logged-in accounts honouring engine and account pins, size waves by the capacity dial (zero slots at a dial of zero, nothing under `DRAIN`), build review, fix and judge atoms the atomizer accepts, keep a non-worsening round and refuse a worse one naming the regressed pieces, re-atomize by freezing clean pieces and splitting outliers, score rounds by severity, and stop on the target, the round limit or a plateau.

- Rationale: Fan-out, planning and scoring decide which agent edits which file and when a campaign stops; only the lessons ledger was tested (formerly GAP-EF-009).
- Derivation: `tools/hillclimb/lib/fanout.mjs`, `tools/hillclimb/lib/plan.mjs`, `tools/hillclimb/lib/scoreboard.mjs`
- Allocated to: SDD §4 C-24 Hillclimb
- Verification: T — `make test` (`lib-test`)
- Status: Baselined

### REQ-GATECLI-001 — Glue gate CLI uses the core gates

`tools/gate/gate.mjs freeze` shall refuse with exit 2, writing no `frozen.sha256`, a `CONTRACT.md` whose ```capability block is missing, malformed or in disagreement with `tests.json`, using the loop's own freeze check (`capabilityProblems`), and freeze a contract whose block agrees; and `tools/gate/gate.mjs run` compiles `kernel.ts` with the core compiler flags and judge the kernel with the core `runGates`, so a kernel on disk gets the same nine gates and structured state as the loop, with a `glue.schema.json` equal to the core schema, compiling with `ENDOFORGE_ASC` unset with the pinned compiler at `ASC_PATH` from `tools/asc/pin.mjs` that `make loop-setup` installs.

- Rationale: Two gate implementations drift; the atomizer's stand-alone check must agree with the loop. Until round 7 `freeze` hashed a block-less contract and the refusal came only at G7, after the code was written (formerly GAP-EF-015).
- Derivation: `tools/gate/gate.mjs`, `tools/gate/glue.schema.json`, `tools/asc/pin.mjs`, `core/runtime/x1/generator.mjs`
- Allocated to: SDD §4 C-30 Glue gate CLI and project scheduler
- Verification: T — `make gate-test`
- Status: Baselined (round 2; changed in round 7, N1: `freeze` checks the capability block)

### REQ-SCHED-001 — Project scheduler

The project scheduler shall refuse a malformed batch, overlapping files within one project, a token reservation over a project's budget and a GPU step without a queue before any command runs; run pieces under the concurrency, the capacity dial and machine headroom, rotating across jobs; route only GPU steps through the queue; never retry a piece; fail a job whose piece or recombine fails while other jobs continue; and hand each command its identity, budget and, for the recombine step, the ordered results.

- Rationale: Cross-project work must not overspend or let one job take every slot (formerly GAP-EF-004).
- Derivation: `tools/project-scheduler/scheduler.mjs`
- Allocated to: SDD §4 C-30 Glue gate CLI and project scheduler
- Verification: T — `make test` (`gap-tools-test`)
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

### REQ-FACTORY-003 — Factory runtime

The factory runtime shall validate job specs and records against its schema files, write state durably (a failed write keeps the previous content), fence a second controller, schedule FIFO within capacity with subscription-limit backoff and persisted queues (an interrupted job becomes unknown; an unknown saved version is refused on reload), publish a passed attempt once with a valid receipt, never create a container on an input-hash mismatch and never remove a container another owner labelled, reconcile a crashed attempt from its journal, deny egress outside the allowlist and a TLS hello that does not name the CONNECT authority, forward only exact allowed requests through the local provider, complete `local_provider.call_protected` through a real sandboxed worker whose only route out is the `bridge.py` relay, start a local-provider turn without needing or mounting `node`, `codex` or the Codex credential while a Codex turn names a missing tool, run WebAssembly by default with the hash-pinned Wasmtime 49.0.0 wheel from `make tools` (checking its version and installed files and enforcing fuel, epoch and memory limits, and naming `make tools` when it is absent), refuse a Wasmtime CLI given in `ENDOFORGE_WASMTIME` without a matching `ENDOFORGE_WASMTIME_SHA256`, and keep `Egress.test_run_bounded_outcomes` independent of garbage other test modules leave in the same process.

- Rationale: A worker attempt must leave checked, single publications and recoverable state (formerly GAP-EF-002); a local-provider turn must not depend on agent tools it never runs, and the Wasmtime the runner uses must be the pinned one (round 6, M5).
- Derivation: `tools/factory_runtime/core.py`, `tools/factory_runtime/scheduler.py`, `tools/factory_runtime/runner.py`, `tools/factory_runtime/recovery.py`, `tools/factory_runtime/egress.py`, `tools/factory_runtime/bridge.py`, `tools/factory_runtime/local_provider.py`, `tools/factory_runtime/wasm.py`, `tools/factory_runtime/wasm_host.py`
- Allocated to: SDD §4 C-29 Factory runtime
- Verification: T — `make test` (`gap-tools-test`; most runner cases use a stand-in Docker CLI; the sandboxed-worker cases start real workers through `systemd-run --user --scope`, `unshare` and `bwrap` and skip with the reason where one of those is missing; `RealPinnedWasmtime` skips with the reason where `make tools` has not run or there is no systemd user manager; the Wasmtime CLI case skips unless `ENDOFORGE_WASMTIME` and `ENDOFORGE_WASMTIME_SHA256` are set; `RealDocker` runs the runner against a real Docker daemon reached without `sudo` and an image already on the host, and skips with the reason otherwise)
- Status: Baselined. The `RealDocker` cases ran and passed on GitHub in PR #142 (run 42709080153, job `test (22)`, and also `test (26)`), in both the repository tests and the optimized Python run; on the development host the Docker socket is not reachable without `sudo`, so they skip there. Under the wheel, a `memory.grow` past the ceiling returns -1 instead of trapping; the ceiling holds

### REQ-FACTORY-004 — Approved atoms registry

`tools/approved_atoms.py` shall register, approve, resolve and retire atoms in an append-only JSONL store with content pinned by digest, refuse invalid transitions, registrations and resolutions, resolve a batch all or nothing, replay incrementally for a second writer, refuse a tampered store, roll back a write it reports as failed, and refuse a consumer row for an atom that was never approved.

- Rationale: Approved values are reused by later work; a reported failure must not take effect (formerly GAP-EF-005).
- Derivation: `tools/approved_atoms.py`
- Allocated to: SDD §4 C-31 Stub pool and approved atoms
- Verification: T — `make test` (`gap-tools-test`)
- Status: Baselined

### REQ-FACTORY-005 — Campaign repair, Wasmtime qualification, stage resume and transfer

The factory campaign and portability tools shall keep frozen evidence unchanged while they repair, qualify, resume and transfer: repair writes a bounded implementation-only patch to a new `.repair-N` file, chains rounds up to the limit, refuses contract and eval disputes, links, ambiguous text, a changed candidate and a missing frozen-path list, never overwrites a repair, and discards one when a frozen path changes; `qualify_wasmtime.py` fails an unqualified runtime under `python -O` too; `resume_stage.py` publishes a resumed stage once, records a failing stage without publishing, and refuses a conflicting publication, a symlinked escape and files missing from the inventory; and `campaign_transfer.py` sends the checkpoint tool and bundle over `ssh` and `scp` with `BatchMode=yes` and no inherited standard input, resumes on a distinct destination machine, refuses a destination that is the source machine before staging, and removes its remote staging on failure.

- Rationale: A campaign moved to another machine must resume without changing frozen evidence (formerly GAP-EF-006).
- Derivation: `tools/factory_campaign/repair.py`, `tools/factory_portability/qualify_wasmtime.py`, `tools/factory_portability/resume_stage.py`, `tools/factory_portability/campaign_transfer.py`
- Allocated to: SDD §4 C-25 Factory campaign and portability
- Verification: T — `make test` (`factory-state-test`, `portability-test`; the transfer cases skip with the reason where `age` or an unprivileged `bwrap` sandbox is missing; the real second-host cases skip unless `ENDOFORGE_SECOND_HOST` is set, so they skip in CI)
- Status: Baselined

### REQ-RUST-001 — Rust lane

The Rust lane shall build reproducibly with the pinned toolchain, refuse a toolchain mismatch before building, match the P-06 frozen equivalence, and admit any Rust kernel crate that meets the kernel contract (a `cdylib` with `Cargo.lock`, `src/lib.rs`, regular files only under `src/`, no build script or workspace, crates.io dependencies only, all checked before building) only after the `tools/kernel` host runs every case of its frozen task through the Wasmtime workcell (`tools.kernel.conformance`, REQ-KERNEL-005), writing `admission.json` on a pass and raising `AdmissionRejected` with an `admission` entry in the denial journal on a build failure or any failed, denied, trapped or refused case, as shown for two distinct frozen tasks (`tasks/p06-pressure.json` and `tasks/tally.json`).

- Rationale: A second language lane under the same acceptance; admission was limited to one reference task until round 6 (M7), and the kernel host had no caller (M4).
- Derivation: `tools/rust_lane/build.py`, `tools/rust_lane/admit.py`, `tools/rust_lane/equivalence.mjs`, `tools/rust_lane/package.json`, `tools/rust_lane/tasks/p06-pressure.json`, `tools/rust_lane/tasks/tally.json`, `tools/rust_lane/kernels/tally/src/lib.rs`
- Allocated to: SDD §4 C-26 Rust lane
- Verification: T — `make rust-lane-test` (outside `make test`; run by the CI job `rust-lane`; needs the pinned Rust toolchain)
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

`make test` shall fail when a discovered test file is reached by no make target and is not listed with a reason in `tests/test-reachability.json`, and when CI does not run both suites, and run every `experiments/*/analyze.test.mjs` through the target `experiments-test` (all but P-51's by-hand `controls.test.mjs`), failing when one of them fails.

- Rationale: A test that never runs verifies nothing.
- Derivation: `tests/test_reachability.py`, `tests/test-reachability.json`
- Allocated to: SDD §4 C-27 Repository checks
- Verification: T — `make core-test`
- Status: Baselined (changed in round 8: `experiments-test`)

### REQ-REPO-004 — Traceability check

`make check` shall fail on a requirement without a verification-matrix row, a matrix row naming a missing test file or test name, a discovered test file that traces to no requirement and is not listed as supporting, a design component that implements no requirement and is not infrastructure or a recorded gap, an environment variable read by code that is not in the configuration reference, and a dead relative link or anchor.

- Rationale: NPR SWE-052 bidirectional traceability, checked by a tool rather than by hand.
- Derivation: `tools/check_trace.py`
- Allocated to: SDD §4 C-27 Repository checks
- Verification: T — `make core-test`
- Status: Baselined

### REQ-REPO-005 — Generated data dictionary

`make check` shall fail when the generated sections of `docs/data/data-dictionary.md` differ from the ledger, hardware-record and factory-runtime schema files.

- Rationale: The dictionary is generated from the schemas so it cannot drift (SWEHB 5.07).
- Derivation: `tools/gen_data_dictionary.py`, `core/ledger/record.schema.json`, `tools/hardware_record/schema.json`
- Allocated to: SDD §4 C-27 Repository checks
- Verification: T — `make core-test`
- Status: Baselined

### REQ-REPO-006 — Secret scan in CI

CI shall run a Gitleaks scan of the full history with a checksum-verified binary and fail on any finding.

- Rationale: Credentials must not reach a public repository unnoticed.
- Derivation: `.github/workflows/ci.yml`
- Allocated to: SDD §4 C-27 Repository checks
- Verification: I — `.github/workflows/ci.yml` job `secret-scan`
- Status: Baselined

### REQ-REPO-007 — Make targets install what their tests import

`make isolate-test` shall depend on `tscheck-setup` and `loop-setup` and `make rust-lane-test` on `rust-lane-setup`, with CI running `make rust-lane-test` on the pinned Rust toolchain after `make tools`, in a job that is not allowed to fail silently.

- Rationale: `make test` must work on a fresh clone, and the Rust lane must be checked on every push (formerly GAP-EF-013).
- Derivation: `Makefile`, `.github/workflows/ci.yml`
- Allocated to: SDD §4 C-27 Repository checks
- Verification: T — `make isolate-test`; I — `.github/workflows/ci.yml` job `rust-lane`
- Status: Baselined

### REQ-REPO-008 — Release-record generator

`tools/gen_release_docs.py` shall parse Node spec and TAP summaries, `unittest` summaries and script `PASS`/`FAIL` lines with the last make exit winning, count severities, list failed runs and trace problems, name files changed between a run and the record commit, report lint and coverage from the Makefile, CI and the logs, state in the version description whether CI runs a secret scan from the workflow files (each job whose steps run `gitleaks`, `trufflehog` or `detect-secrets` as a command or a `uses:` action, ignoring commented lines and mere mentions), write the test report and version description with links that resolve from where they are written, replace an index row of the same name, exit 1 on a failed run or a trace problem, and refuse a log without a label, a record without logs and a dirty tree.

- Rationale: Release records are generated so their numbers are never typed by hand (formerly GAP-EF-014). Until round 8 the sentence "CI has no secret-scanning job" was hard-coded, though the CI job `secret-scan` runs Gitleaks (backfill review R8).
- Derivation: `tools/gen_release_docs.py`
- Allocated to: SDD §4 C-28 Release records
- Verification: T — `make test` (`gap-tools-test`)
- Status: Baselined (changed in round 8: the secret-scan statement is read from the workflows). `docs/releases/VDD-main-20261108.md`, generated before the change, still carries the old sentence (finding D-13)

### REQ-REPO-009 — Lint and coverage

`make lint` shall fail on any finding of ruff 0.17.0 (with the repository's `ruff.toml`) over the tree or of `node --check` over every `.mjs`, `.js` and `.cjs` file, with CI running it in the job `lint`, and `make coverage` running the Node suites under `--experimental-test-coverage` with a summary and the Python suites under coverage.py when installed, else with trace counts, failing when any test fails in either mode, with CI running `make coverage -k` under coverage.py 7.10.7 in the job `coverage` (its shell runs with `pipefail`, so a failing `make` fails the step) and uploading `coverage-summary.txt` as the artifact `coverage-summary`.

- Rationale: Static analysis and coverage are measured rather than stated as missing (NPR SWE-135, SWE-189). Whether a failing test fails `make coverage`, and whether the CI job completes, was formerly GAP-EF-016; until round 8 only inspection and one recorded run showed the first (backfill review R14).
- Derivation: `Makefile`, `ruff.toml`, `.github/workflows/ci.yml`
- Allocated to: SDD §4 C-27 Repository checks
- Verification: T — `make core-test` (`tests/test_coverage_fails.py` runs the real `make coverage-node`, `make coverage-python` in both modes and `make coverage` against a temporary failing test and its passing twin; where coverage.py is not installed its mode is driven through a stand-in module, which checks the Makefile wiring, not coverage.py); I — `Makefile` targets `lint` and `coverage`, `.github/workflows/ci.yml` jobs `lint` and `coverage`
- Status: Baselined (changed in round 7: GAP-EF-016 closed by the first CI run of the `coverage` job and a recorded failing-test run; round 8 added the automated failing-test check)

### REQ-REPO-010 — No code comments

`make lint`, and so the CI job `lint`, shall run `tools/check_comments.py`, which lists every tracked `.mjs`, `.js`, `.cjs`, `.ts`, `.py`, `.rs`, `.sh` and Makefile file outside `TODELETE/`, `experiments/`, `node_modules` and `vendor/` with `git ls-files`, prints `file:line: text` (text cut at 80 characters) for every comment line and exits 1, exits 0 when there is none, and exits 2 when `git ls-files` fails or a Python file cannot be tokenized; it finds Python comments, whole-line and end-of-line, with `tokenize` (so docstrings are not comments), `#` lines in shell files and Makefiles, and in JavaScript, TypeScript and Rust every `//` and `/* */` comment wherever it starts, reporting each line a block comment spans, with a lexer that does not mistake comment-like text inside strings, template literals (with `${}` nesting), regular expression literals (told apart from division), Rust character literals and raw strings for a comment, exits 2 on an unterminated comment, string, template literal or regular expression, and keep a shebang on line 1 and any comment naming a tool directive or licence header (`@ts-`, `eslint`, `noqa`, `type:`, `pragma`, `pylint`, `SPDX`, `-*-`, `fmt:`, `istanbul`, `c8 `).

- Rationale: CONTRIBUTING.md and AGENTS.md put rationale in documentation, commit messages or the pull request, not in code comments; until round 7 the rule was not enforced (finding D-07). Round 7 removed the comment lines and moved what they said that the documentation lacked into the documentation. Until round 8 the check read only how each line starts, so a `//` comment after code passed (finding D-09).
- Derivation: `tools/check_comments.py`, `Makefile`, `.github/workflows/ci.yml`
- Allocated to: SDD §4 C-27 Repository checks
- Verification: T — `make test` (`gap-tools-test`); I — `.github/workflows/ci.yml` job `lint`
- Status: Baselined (round 7; changed in round 8, R12: JavaScript, TypeScript and Rust are lexed, so end-of-line and inline comments are found, and the 20 the check had missed were removed, closing D-09). In shell files and Makefiles only `#` at the start of a line is found, because `$#` and `${#x}` make end-of-line `#` ambiguous

## 11. Untested behaviour (requirement gaps)

These behaviours exist in the code at the baseline but no test in `make test` checks them. They are not
requirements until a test exists. Numbering: `GAP-EF-NNN`, never reused.

| ID | Behaviour | Location | Why untested / note |
|---|---|---|---|
| — | None open at version 2.10 | — | — |

Closed gaps (their IDs are not reused):

- GAP-EF-015, the gate CLI's `freeze` and the capability block: closed in round 7 (N1). `tools/gate/gate.mjs freeze`
  runs the loop's `capabilityProblems` and refuses a missing, malformed or disagreeing block, tested by
  `tools/test_gate_structured.mjs`; now part of REQ-GATECLI-001.
- GAP-EF-016, `make coverage` on a failing test and the CI `coverage` job: closed in round 7. The job ran on GitHub in
  PR #142 (run 42709080153): Node 953 tests passed with 93.29% of lines covered, Python 333 tests OK (3 skipped) under
  coverage.py with 84% in total, and the artifact `coverage-summary` was uploaded. On 2026-11-09 `make coverage-python`
  with a deliberately failing unittest (trace fallback, coverage.py absent) printed `FAILED (failures=1)` and make
  exited 2; under coverage.py the `&&` after `coverage run` stops the recipe the same way. Now part of REQ-REPO-009,
  verified by inspection; no automated test runs `make coverage` against a failing test.
- GAP-EF-002, factory runtime worker launch and protected provider call: closed in round 5 (P5). The
  `SandboxedWorker` cases in `tools/factory_runtime/test_runtime_gaps.py` start real workers in their sandbox with the
  `bridge.py` relay; one completes `call_protected` against a stub provider, the other shows the relay is the worker's
  only route out. They ran (not skipped) and passed on the development host on 2026-11-09. Now part of REQ-FACTORY-003.
- GAP-EF-006, campaign transfer to a real second host: closed in round 5 (P6). `RealSecondHost` in
  `tools/factory_portability/test_transfer_qualify_resume.py` transfers over real `ssh` and `scp` to
  `ENDOFORGE_SECOND_HOST`. The coordinator ran it against ds9 (a separate Omarchy x86_64 machine, with `age` 1.3.2
  installed for the run) on 2026-11-09: `test_real_second_host_resume` passed in 5.1 s, and the same-machine refusal
  case skipped because ds9 is distinct. In CI `ENDOFORGE_SECOND_HOST` is unset, so both cases skip there. Now part of
  REQ-FACTORY-005.

- GAP-EF-011, `WarmClaudeTransport` with a custom usage governor: fixed and tested on 2026-11-09; now REQ-TRANSPORT-002.
- GAP-EF-012, atomizer `bench` default example and `conduct adopt` example paths: fixed and tested on 2026-11-09; now
  REQ-ATOM-004 and REQ-COND-004.
- GAP-EF-003, glue gate CLI: tested on 2026-11-09 by `tools/test_gate_structured.mjs`; now REQ-GATECLI-001, run by
  `make gate-test`.
- GAP-EF-013, Rust lane in CI: CI job `rust-lane` added on 2026-11-09; now REQ-REPO-007. It ran and passed on GitHub
  in PR #139 (run 42600069278, job `rust-lane`: 15 tests OK).
- GAP-EF-001, delegated cgroup v2 enforcement: tested in round 4 by `core/runtime/test/gaps4-runtime.test.mjs`; now
  REQ-ISO-018. The case runs only inside a delegated user scope and skips with its reason elsewhere; it ran (not
  skipped) on the development host on 2026-11-09. Whether it runs or skips on the GitHub runner is not recorded.
  `memory.swap.max=0` is checked only where that file exists.
- GAP-EF-007, stub pool replay: tested in round 4 by `core/runtime/test/gaps4-runtime.test.mjs`; now REQ-STUB-001.
- GAP-EF-002, factory runtime: narrowed in round 4. Job specs, scheduler, runner, recovery, egress proxy, local
  provider policy and WebAssembly runner are tested by `tools/factory_runtime/test_runtime_gaps.py` (REQ-FACTORY-003);
  the sandboxed worker launch and a completed protected call remain open above.
- GAP-EF-004, project scheduler: tested in round 4 by `tools/project-scheduler/test/scheduler.test.mjs`; now
  REQ-SCHED-001.
- GAP-EF-005, approved-atoms helper: tested in round 4 by `tools/test_approved_atoms.py`; now REQ-FACTORY-004.
- GAP-EF-006, campaign repair and transfer, Wasmtime qualification and stage resume: narrowed in round 4. Repair,
  qualification, resume and the emulated transfer are tested by `tools/factory_campaign/test_repair.py` and
  `tools/factory_portability/test_transfer_qualify_resume.py` (REQ-FACTORY-005); a real second host remains open above.
- GAP-EF-008, atomizer `atomize`, `fanout`, `direct`, `report` and `cutover`: tested in round 4 by
  `tools/atomizer/test/commands.test.mjs`; now REQ-ATOM-005.
- GAP-EF-009, hillclimb fan-out, plan and scoreboard: tested in round 4 by
  `tools/hillclimb/test/fanout-plan-scoreboard.test.mjs`; now REQ-HILL-003.
- GAP-EF-010, job kinds, card compilation and source loading: tested in round 4 by
  `tools/job/test/kinds-compile-sources.test.mjs`; now REQ-JOB-003.
- GAP-EF-014, release-record generator: tested in round 4 by `tools/test_gen_release_docs.py`; now REQ-REPO-008.

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
| 2.0 | 2026-11-08 | `4d692a4` | Per-requirement fields; 45 existing requirements kept and 50 added for tested areas, gap register, N/A categories | this PR |
| 2.1 | 2026-11-09 | gap closure | 23 requirements added for the gap-closure work (structured state, commit re-run, library composition, scopes, reclaim, counterexamples and per-environment qualification, synthesis and library on every path, compatibility-lane promotion, transport defaults, nine-gate labels, tool fixes, CI secret scan); GAP-EF-011 and GAP-EF-012 closed | `dc6ba4c` |
| 2.2 | 2026-11-09 | round 2 | 9 requirements for the round-2 work: structured comparison at commit (REQ-X1-009), Python drift list and receipt label (REQ-X1-010), suspect tests as a specification correction (REQ-LOOP-007), compatibility promotion in `runNeed` (REQ-LOOP-008), caller principal (REQ-LOOP-009), judging in a cell at commit (REQ-SYNTH-004), composition across separate memories (REQ-LIB-008), make setup dependencies and the Rust lane in CI (REQ-REPO-007), glue gate CLI parity (REQ-GATECLI-001); GAP-EF-003 and GAP-EF-013 closed | this commit |
| 2.3 | 2026-11-09 | round 3 | 6 requirements for the round-3 work: structured mutation check (REQ-LIB-009), every memory metered (REQ-X1-011), structured specification correction (REQ-LOOP-010), implementation turn reads corrected tests (REQ-GEN-010), structured references and suspects (REQ-SYNTH-005), judging structured exports (REQ-SYNTH-006); REQ-LIB-008 now gives each part its own memory | this commit |
| 2.4 | 2026-11-09 | round 4 | 13 requirements for the round-4 work: delegated cgroup enforcement (REQ-ISO-018), stub pool replay (REQ-STUB-001), structured synthesized vectors (REQ-SYNTH-007), the caller's judging-cell limits on every path (REQ-SYNTH-008), atomizer commands (REQ-ATOM-005), job kinds and compilation (REQ-JOB-003), hillclimb fan-out, plan and scoreboard (REQ-HILL-003), project scheduler (REQ-SCHED-001), factory runtime (REQ-FACTORY-003), approved atoms (REQ-FACTORY-004), repair, qualification, resume and transfer (REQ-FACTORY-005), release-record generator (REQ-REPO-008), lint and coverage (REQ-REPO-009); GAP-EF-001, 004, 005, 007 to 010 and 014 closed; GAP-EF-002 and 006 narrowed | this commit |
| 2.5 | 2026-11-09 | round 5 | REQ-GEN-011 (capability block in both specification prompts, checked at the freeze, library hit on generated needs) added; REQ-COMPAT-001 (workcell runs), REQ-GATECLI-001 (pinned compiler default), REQ-FACTORY-003 (sandboxed worker and protected call), REQ-FACTORY-005 (real second host) and REQ-REPO-009 (CI coverage job) extended; REQ-STEP-001 deleted with the step harness retired to `TODELETE/`; GAP-EF-002 and GAP-EF-006 closed | this commit |
| 2.6 | 2026-11-09 | round 6 | 3 requirements added: synchronous host calls (REQ-ISO-019), declared effects, durable denials and task conformance in the kernel host (REQ-KERNEL-005), the shared lock, headroom and exit-file modules (REQ-ERR-002); REQ-GEN-011 changed (block required at the freeze on every path, G7 checks glue against it); REQ-COMPAT-001 (host-buffer calls), REQ-RUST-001 (admission of any conforming crate through the kernel host, two tasks), REQ-FACTORY-003 (local turns without agent tools, pinned Wasmtime wheel, real-Docker cases), REQ-HILL-002 (stage policy to a campaign's own runner) extended; REQ-SYNTH-008 now tested on the `current` path; REQ-LIB-003 rationale corrected; GAP-EF-015 and GAP-EF-016 opened | this commit |
| 2.7 | 2026-11-09 | round 7 | 2 requirements added: capability block on every atomizer contract path (REQ-ATOM-006) and no code comments (REQ-REPO-010); REQ-GATECLI-001 changed (`freeze` checks the capability block); REQ-REPO-009 (a failing test fails `make coverage`; the CI job ran), REQ-GEN-011 and REQ-FACTORY-003 (the `RealDocker` cases ran in CI) updated; REQ-LIFE-001 and REQ-LIFE-004 rationales give the state graph and evidence fields; GAP-EF-015 and GAP-EF-016 closed, so no gap is open | this commit |
| 2.8 | 2026-11-09 | round 8 | 2 requirements added: `verify.mjs --policy` and the helper CLIs' usage and refusals (REQ-ATOM-007, D-10 closed) and the `node` toolchain from the running Node (REQ-ATOM-008, round 7b); changed from the 2026-11-09 backfill review: REQ-LIB-005 (exact text fingerprints, grants kept on reclaim), REQ-LIB-006 (refusals per environment), REQ-GEN-011 (G7 compares nested structure), REQ-KERNEL-005 (deep-copied declaration, non-finite JSON numbers refused), REQ-HILL-002 (compose atoms mount what `hillclimb.mjs` imports), REQ-REPO-003 (`experiments-test`), REQ-REPO-008 (secret-scan statement from the workflows), REQ-REPO-009 (automated failing-test coverage check) and REQ-REPO-010 (end-of-line and inline comments, D-09 closed); no gap open | this commit |
| 2.9 | 2026-11-10 | round 9 | Changed: REQ-GEN-011 (a record, list or text value must declare its layout in the capability block; the prompts ask for it; the freeze and G7 refuse a block without it), REQ-ATOM-006 (the atomizer prompts ask for the nested layout), REQ-LIB-001 (the library key and binding include the nested layout; D-11 closed), REQ-ATOM-007 (`fanout.mjs` and `cutover.mjs` pass their policy to `verify.mjs`; D-12 closed) and REQ-ISO-010 (`LedgerBridge.pid`; the bridge-death test kills the pool's own bridge); no gap open | this commit |
| 2.10 | 2026-11-10 | round 10 | 4 requirements added: the reference sandbox deadline and its distinct errors (REQ-SYNTH-009, D-14 closed), a relaunch patch reopens a finished job (REQ-COND-005, D-15 closed), the `TRACE-NEEDED` event (REQ-COND-006) and invariants I16 and I17 (REQ-JOB-004); changed: REQ-ATOM-007 (cutover's planning steps take, use and record `--policy`; D-16 closed) and REQ-LIB-002 (union members match on nested layout and bind by export name when they share a signature); no gap open | this commit |
