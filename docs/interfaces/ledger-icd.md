# Ledger interface control document

## Scope and ownership

The engine core owns [the ledger package](../../core/ledger/__init__.py),
[record schema](../../core/ledger/record.schema.json), and
[frozen evaluator support](../../core/ledger/frozen.py). Workflow callers remain
under `tools/`; local execution pools are owned by `core/runtime/`. The move from `tools.ledger` to `core.ledger` changes module paths;
it preserves behavior and does not migrate stored data.

## Python and command interfaces

| Interface | Contract |
|---|---|
| `from core.ledger.ledger import Ledger` | Open a durable SQLite path; append validated records, read records, admit version 1 records, and query lineage |
| `from core.ledger.frozen import FrozenEvaluators` | Freeze evaluator files and configuration, require matching frozen content, and record evaluation receipts |
| `python3 -B -m core.ledger.frozen freeze LEDGER TREE MANIFEST` | Read a JSON manifest, freeze the evaluator tree into the ledger, and print its identity; refusals exit with status 2 |
| `import core` | Preserve lifecycle exports without opening a ledger or loading execution integrations |

`core.ledger` is a package marker; callers import the concrete modules explicitly.
The [engine adapter](../../core/engine/frozen.py) consumes these modules without
changing its JSON request or response contract.

## Engine interfaces

The evaluator and gates now live under `core/engine/`; callers import the concrete
JavaScript modules explicitly. `core` lifecycle exports remain unchanged.

| Interface | Contract |
|---|---|
| `core/engine/evaluator.mjs` | Exports `requireFrozen`, `evaluateCandidates`, and `paretoFrontier`; host callbacks supply candidate operations and measurements |
| `core/engine/gates.mjs` | Exports `GATE_ORDER`, individual gates, and `runUniversalGates`; preserves ordered first-failure results |
| `python3 -B -m core.engine.frozen` | Reads a JSON request on stdin with `ledger`, `identity`, and `root`; emits `identity`, `digest`, and `bundle` on stdout |

The Python module replaces `tools.engine.frozen`. JSON shapes, frozen identities,
gate order, callback contracts, Pareto selection, and failure behavior are unchanged.
The engine relocation preserves its callback contracts and grants no authority.

## Runtime interfaces

Runtime callers now resolve `core/runtime/` instead of `tools/runtime/`.
The move preserves arguments, environment variables, stdin forwarding, output,
exit statuses, account slot handling, cooldowns, and failover behavior.

| Interface | Contract |
|---|---|
| `core/runtime/agent-pool.mjs` | CLI for local client execution and pool status; selects `CODEX_POOL_BIN` or a client on PATH, with existing account, guard, state, and optional worker-registry configuration |
| `core/runtime/stub-pool.mjs` | Replays `ENDOFORGE_STUB_REPLAY` outputs into the isolate output bind and launches `CODEX_POOL_BIN` using `ENDOFORGE_ISOLATE_SPEC` |

Atomizer and hillclimb resolve the relocated launcher relative to their modules;
explicit pool overrides retain precedence. `make runtime-test` invokes the relocated
synthetic pool tests. Importing the Python `core` package does not launch a pool.

## Persistent data compatibility

[Ledger validation](../../core/ledger/ledger.py) continues to use the adjacent
schema. Record versions 0 and 1, canonical JSON encoding, record identities,
SQLite tables and triggers, and hash chain construction are unchanged. Existing
durable databases need no conversion. The ledger does not grant execution or
activation authority, and lifecycle transitions do not automatically append records.

## Verification

`make ledger-test` exercises persistence, provenance, frozen content, and the
relocated CLI. `make core-test` checks the scoped standard library boundary and
import isolation. `make engine-test` exercises the engine adapter and its callers.
See the [verification matrix](../verification/verification-matrix.md).

## Caller-supplied invariant checks

The existing evaluator callback is
`port.invariant(name, candidate, bundle, round)`. Frozen
`configuration.invariants` selects unique check names; the caller resolves each
name through a plain registry of functions supplied by its foundation. For
example, a caller can define `const registry = { identity: checkIdentity }` and
implement the callback with `registry[name](candidate, bundle, round)`.
No registry loader or domain package is imported by the engine.

Each check returns `{ passed: boolean, reason: string }` with a nonempty reason.
A false verdict rejects the candidate before measurement; malformed evidence
also rejects it. A thrown callback, including an unresolved registry name,
stops evaluation with `outcome_unknown`. Callers must preserve the existing
frozen evaluator identity and evidence contracts.

## V8 workcell pool interface

The caller imports `IsolatePool` from
[isolate-pool.mjs](../../core/runtime/isolate-pool.mjs). This interface adds no
lifecycle exports or ledger schema fields and does not change the Cstack pin.

| Operation or field | Contract |
|---|---|
| `new IsolatePool({hostPort, size, resourceLimits, wasmMemoryMaxMb, isolation, cgroupRoot, cgroupLimits, trustedWasmModules})` | `hostPort` is a filesystem module path resolved relative to the caller's working directory. `size` is a positive safe integer, default `os.availableParallelism()`. Workcells are created on demand, at most `size`; `isolation` is `thread` (default) or `process` (one Node fork per cell). |
| `resourceLimits` | Only `maxOldGenerationSizeMb` and `maxYoungGenerationSizeMb` are accepted, positive safe integers, defaults 128/16 MiB. Process mode maps these values to `--max-old-space-size` and `--max-semi-space-size`. Heap command-line overrides in `execArgv` or `NODE_OPTIONS` are refused. |
| `wasmMemoryMaxMb` | Integer 1–4096 MiB, default 64. Applies to each workcell linear memory, separately from heap limits; oversized initial/maximum declarations and growth terminate the workcell. Untrusted module memories without declared maxima are rejected; existing declared maxima are never raised. JS Memory descriptors retain their bounded default maximum. Applies to checked JS APIs and instrumented wasm32 `memory.grow`, including start functions. |
| `trustedWasmModules` | Supervisor-only array, default `[]`, of `{name, sha256, maximumPages}`. Names are unique 1–100 character ASCII letters/digits/dot/underscore/hyphen labels; digests are unique lowercase 64-digit SHA-256 values of complete original WASM bytes. Caps are positive safe integer pages, at most `wasmMemoryMaxMb * 16`. Matching binaries receive that maximum only for omitted declarations; initial sizes must fit it. Existing maxima, instrumentation and unsupported-feature refusal remain intact. The pool copies and freezes configuration before dispatch; `run` and `portOptions` cannot change it. Every result and receipt observation includes the supervisor copy, including failures before dispatch or during import. This field records configured policy, not proof each listed module executed. |
| `cgroupRoot`, `cgroupLimits` | Process mode detects the current cgroup v2 subtree or uses `cgroupRoot`. Limits are `{memoryMax, cpuMax, pidsMax}`: positive bytes, a quota/period string (or `max PERIOD`), and positive task count. Defaults: `max(256, old + 3*young + 128)` MiB, `"100000 100000"`, 64. Successful attachment sets `memory.oom.group=1`; results record `cgroup: "enabled"` and the configured limits, otherwise `"unavailable"`. Thread mode reports `"not_applicable"`. No privilege escalation. |
| Host module | Exports async or synchronous `createPort(portOptions)`, imported inside each worker. A new port is created per job; module state persists per workcell. The port supplies the existing real evaluator callbacks. |
| `run({reference, candidates, receipts, portOptions})` | Returns a promise. Inputs must be structured-cloneable. `reference` is the evaluator's `{ledger, identity, root}`. `candidates` is a nonempty ordered list of unique durable candidate identities. |
| `receipts` input | One full v0/v1 ledger receipt template per candidate in candidate order. Each has a globally unique `id`, durable task/candidate/frozen references, and caller-supplied precommit, provenance/license where required. Its oracle and digest must match `reference.identity`. The host validates templates before dispatch. |
| Result | `{status, reason, report, workcell, isolation, cgroup, resourceLimits, wasmMemoryMaxMb, trustedWasmModules, receipts}`. `report` is the unmodified `evaluateCandidates` report, or null when none returned. `status` is `completed`, `outcome_unknown`, or process-limit `rejected`; completed reports may contain rejected candidates. `workcell` is the Node thread ID or child PID, scoped to this pool lifetime. |
| Worker loss | In process mode a V8 fatal heap diagnostic yields `rejected`/`heap`; the WASM guard IPC marker or reserved exit 18 yields `rejected`/`wasm_memory`. Other exits (including unclassified OS kills) remain unknown. Thread mode returns `outcome_unknown`, null report, `reason: 'limit'` for `ERR_WORKER_OUT_OF_MEMORY` or `ERR_WORKCELL_WASM_MEMORY_LIMIT`, otherwise `worker_exit`, plus `error` code and `exitCode`. Replacement starts after exit. Lost jobs are never retried automatically. Import, factory and evaluator exceptions return unknown with their message. |
| `receipts` output | Array of `{record, hash}` from actual Python `Ledger.append`. The host serializes ledger operations; SQLite validates and chains records even across pools. Observations contain the batch result, including workcell identity, configured limits, and report. |
| `stats` | Snapshot `{size, workers, busy, queued}`; queued includes submissions awaiting receipt validation. |
| `close()` | Idempotent promise; refuses new submissions, drains accepted work and receipt writes, then terminates workers. There is no forced cancellation or wall-time deadline. |

The pool replaces template delivery/outcome states and observations. Unknown
batch outcomes yield `outcome_unknown`/`inconclusive` for every candidate.
A process-limit rejection yields `finished`/`failed` for the whole batch, recording the limit without inventing evaluator attempts. Otherwise any rejected attempt yields `failed`; candidates with only passed
attempts yield `passed`; candidates without attempts yield `unobserved`.
Passing checks does not imply Pareto frontier membership or activation authority.
Template validation errors reject before dispatch. A ledger append failure
rejects the job with `error.result` carrying the evaluation result. A batch's
receipt appends are individually durable, not an atomic batch; inspect the ledger
before reconciling an interrupted write. The Python bridge retains the existing
`python3` dependency and uses the repository root as its working directory.
Threads start with empty `execArgv`; processes receive only their two heap flags so host-only command-line and test-runner
flags are not forwarded as worker flags; environment options still apply.

Heap limits cover V8-managed old/young generations. The WASM limit is enforced
inside the worker before port import through checked Memory/Module/Instance,
compile/instantiate and streaming APIs. A WASM breach message is diagnostic;
the job resolves only after worker exit. Its null report and mode-specific failed/inconclusive receipts
prevent a swallowed growth trap from establishing a passing verdict. Smaller
module maxima retain native -1 instruction failure semantics below the pool cap.
Memory-bearing binaries outside the guard’s supported scalar wasm32 subset fail
closed, and modules compiled outside the workcell are refused. Instrumentation
adds exports reserved for breach detection and start invocation; ports must not
modify them. Streaming APIs buffer the response before compilation.
Without enabled cgroups neither limit bounds the sum of multiple linear memories, ordinary buffers,
native allocations, subprocesses, or total process RSS.
Trusted host ports retain normal Node privileges; thread mode shares process-wide failures. Process mode contains child exits, but does not protect the supervisor against global OOM or privileged/malicious ports. Cgroup setup requires delegated memory/cpu/pids controllers and writable migration files. If the delegated root contains only this supervisor, setup moves it to an unbounded supervisor leaf before enabling controllers; it never moves other processes. That leaf remains for the enclosing scope to reclaim. Workcell cgroups are cleaned up after child exit on a best-effort basis. Source rationale and pinned references are in the
[runtime guidance](../../core/runtime/README.md).

## X1 host interface

`x1/host.mjs:createPort({candidates})` maps SHA-256 of `JSON.stringify(candidate)`
to `{id, files, compiled}`. `files` contains CONTRACT.md, tests.json, frozen.sha256,
kernel.ts and glue.json text. `compiled` contains source SHA-256 and base64 WASM,
or an error. The frozen tree includes contract, tests, freeze record and exact
host/gates/schema bytes. `x1/compiler.mjs:compile(files, executable)` supplies
that compilation evidence on the supervisor. The residual reason carries the
complete X1 result, including per-gate verdicts and observed test durations.
G4/G5/G6 operate on two fresh WASM instances, with the original X1 comparisons.
The additional compiler memory maximum satisfies the pool's existing WASM guard;
unsupported binaries remain fail-closed. Compiler callers and host modules are trusted.

## Candidate generator interface

`generate({need, directory, env?, timeout?})` returns `{candidate, reference,
digest, testDouble, timings}`. Directory must not exist. Candidate has `{id, files}`;
its id is the directory basename. Two stdin JSON prompts describe the specification
and implementation stages, including the glue schema. The executable/optional prefix
argv comes from `ENDOFORGE_CODEX_CMD`; `CODEX_HOME` is required and passed unchanged.
Each invocation appends `exec --skip-git-repo-check --sandbox workspace-write -`.
Default timeout is 600 seconds per session. Nonzero exits/timeouts refuse without
retaining client transcripts. Freeze timing includes durable oracle registration;
generate timing sums the two client sessions and their output validation.
The specification request carries `glueRules`; the implementation request carries
`glueSchema`, `glueRules` and `glueTemplate`, all exported by the generator module.
Both turns use `codex exec --json`; the implementation turn is `codex exec resume <thread_id>`
when a `thread.started` id was observed and resume is enabled. The result adds
`session: {effort, resumed}`.
`ENDOFORGE_CODEX_TEST_DOUBLE=1` explicitly marks synthetic smoke runs.

## Local promotion interface for POODO

`x1/ledger.mjs:ledger('promote', {reference, candidate, receipt: {id, hash},
decisionPath})` replays the existing Python ledger under a SQLite write lock,
checks exact candidate/oracle/receipt bindings and both complete evaluator rounds,
and verifies each G1–G7 verdict. It exclusively writes and fsyncs a version-1
JSON decision with issuer `endoforge.local.x1`, policy `X1-G1-G7/v1`, scope
`qualification`, candidate/oracle/receipt identities, and `decision: promote|refuse`.
Promotion adds evaluator digest and chain tip; refusal records a reason. `sha256`
hashes the other fields as sorted compact JSON. Existing output paths fail closed.
This is a local trusted-host policy, not a POODO-issued lifecycle authorization or
signature. POODO has no callable approval API today; neither sibling repo changes.

`IsolatePool.run({...job, timing:true})` additionally returns host monotonic
`timings: {gate, ledger}`. Gate spans receipt-preflight completion through worker
result delivery, including FIFO wait/startup and frozen verification. Ledger sums
preflight and append including serialization wait. Timing metadata is returned
outside the persisted observation and does not change verdicts or receipt schemas.
