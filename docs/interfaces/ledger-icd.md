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
durable databases need no conversion. A ledger written by the bridge also holds a
`ledger_journal(version, digest)` table outside the hash chain, which only journal
recovery reads. The ledger does not grant execution or
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
| `new IsolatePool({hostPort, size, resourceLimits, wasmMemoryMaxMb, isolation, cgroupRoot, cgroupLimits, trustedWasmModules, sharedWasmModules, prewarm, warm, warmTimeoutMs, jobTimeoutMs})` | `hostPort` is a filesystem module path resolved relative to the caller's working directory. `size` is a positive safe integer, default `os.availableParallelism()`. Workcells are created on demand, at most `size`, unless `prewarm` (boolean, default `false`) is `true`; `isolation` is `thread` (default) or `process` (one Node fork per cell). |
| `resourceLimits` | `maxOldGenerationSizeMb` and `maxYoungGenerationSizeMb` are accepted, positive safe integers, defaults 128/16 MiB. Both modes accept an optional positive `stackSizeMb`; process mode raises the stack rlimit through `/bin/sh` first and refuses in the constructor if the host will not. Process mode maps these values to `--max-old-space-size` and `--max-semi-space-size`. Heap command-line overrides in `execArgv` or `NODE_OPTIONS` are refused. |
| `sharedWasmModules` | Optional `[{sha256, path}]` naming `trustedWasmModules` digests. A thread pool compiles each once through the guard before starting cells and posts it to them; a process pool ignores it. With the option set, thread results list the digests actually shared as `sharedWasmModules`, empty if compilation failed or the digest didn't match, and those cells compile their own. |
| `warm` | Optional options object. Each cell imports `hostPort` and awaits its exported `warm(options)` before sending `ready`. A cell still warming after `warmTimeoutMs`, a positive integer defaulting to 60000, is terminated and counts as a start failure. A rejection or a missing export rejects `ready()`, and that cell's jobs return `outcome_unknown`. After `size + 2` cells in a row exit before reporting ready, the pool stops respawning, `halted` is true, and queued and later jobs return `outcome_unknown` with reason `workcell_start_failed`. Off by default. |
| `jobTimeoutMs` | Optional positive integer. A job still running at the deadline has its workcell terminated and replaced, with `outcome_unknown`, reason `deadline`, and inconclusive receipts. A process cell gets SIGTERM, then SIGKILL after 1 s, and its result doesn't wait on stderr closing, so a port trapping the signal or a grandchild holding the stream can't keep the job pending. A cell past its deadline takes no further job. Unset keeps the previous behaviour of no deadline. |
| `wasmMemoryMaxMb` | Integer 1–4096 MiB, default 64. Applies to each workcell linear memory, separately from heap limits; oversized initial/maximum declarations and growth terminate the workcell. Untrusted module memories without declared maxima are rejected; existing declared maxima are never raised. JS Memory descriptors retain their bounded default maximum. Applies to checked JS APIs and instrumented wasm32 `memory.grow`, including start functions. |
| `trustedWasmModules` | Supervisor-only array, default `[]`, of `{name, sha256, maximumPages}`. Names are unique 1–100 character ASCII letters/digits/dot/underscore/hyphen labels; digests are unique lowercase 64-digit SHA-256 values of complete original WASM bytes. Caps are positive safe integer pages, at most `wasmMemoryMaxMb * 16`. Matching binaries receive that maximum only for omitted declarations; initial sizes must fit it. Existing maxima, instrumentation and unsupported-feature refusal remain intact. The pool copies and freezes configuration before dispatch; `run` and `portOptions` cannot change it. Every result and receipt observation includes the supervisor copy, including failures before dispatch or during import. This field records configured policy, not proof each listed module executed. |
| `cgroupRoot`, `cgroupLimits` | Process mode detects the current cgroup v2 subtree or uses `cgroupRoot`. Limits are `{memoryMax, cpuMax, pidsMax}`: positive bytes, a quota/period string (or `max PERIOD`), and positive task count. Defaults: `max(256, old + 3*young + 128)` MiB, `"100000 100000"`, 64. Successful attachment sets `memory.oom.group=1`; results record `cgroup: "enabled"` and the configured limits, otherwise `"unavailable"`. Thread mode reports `"not_applicable"`. No privilege escalation. |
| Startup | With bundled undici below 8, each workcell waits up to 2 s, holding the event loop open, for undici's lazy WebAssembly instantiation before installing the WASM guard. With undici 8 or later, which does not instantiate WebAssembly lazily, the guard is installed at once, so any later undici instantiation passes through the guard like any other module. |
| Host module | Exports async or synchronous `createPort(portOptions, { hostCall })`, imported inside each worker. A new port is created per job; module state persists per workcell. The port supplies the existing real evaluator callbacks. |
| `hostCalls` | Optional supervisor function `(request, { candidates, workcell })`, its result returned to the port's `hostCall(request)`. Requests are structured-cloneable, at most 1 MiB as JSON and 4096 per job. A throw, the limit, or no `hostCalls` rejects the port's call, and a port that lets that rejection escape records `outcome_unknown`. It grants nothing by itself; the supervisor decides what a request means. A cell has no other route to the supervisor. |
| `frozenThroughLedger` | Boolean, default `false`. When `true`, the evaluator's frozen checks go to the persistent ledger bridge instead of starting `python3` once per check. The checks and their failure handling are the same, and the bridge still re-hashes the evaluator tree each time. |
| `run({reference, candidates, receipts, portOptions})` | Returns a promise. Inputs must be structured-cloneable. `reference` is the evaluator's `{ledger, identity, root}`. `candidates` is a nonempty ordered list of unique durable candidate identities. |
| `receipts` input | One full v0/v1 ledger receipt template per candidate in candidate order. Each has a globally unique `id`, durable task/candidate/frozen references, and caller-supplied precommit, provenance/license where required. Its oracle and digest must match `reference.identity`. The host validates templates before dispatch. |
| Result | `{status, reason, report, evidence?, workcell, isolation, cgroup, resourceLimits, wasmMemoryMaxMb, trustedWasmModules, receipts}`. `evidence` is the JSON value of the port's optional `evidence()` after evaluation, absent otherwise or on a lost cell. It's a free-form observation field, not a schema change, and it grants no authority. `report` is the unmodified `evaluateCandidates` report, or null when none returned. `status` is `completed`, `outcome_unknown`, or process-limit `rejected`; completed reports may contain rejected candidates. `workcell` is the Node thread ID or child PID, scoped to this pool lifetime. |
| Worker loss | In process mode a V8 fatal heap diagnostic yields `rejected`/`heap`; the WASM guard IPC marker or reserved exit 18 yields `rejected`/`wasm_memory`. Other exits (including unclassified OS kills) remain unknown. Thread mode returns `outcome_unknown`, null report, `reason: 'limit'` for `ERR_WORKER_OUT_OF_MEMORY` or `ERR_WORKCELL_WASM_MEMORY_LIMIT`, otherwise `worker_exit`, plus `error` code and `exitCode`. Replacement starts after exit. Lost jobs are never retried automatically. Import, factory and evaluator exceptions return unknown with their message. |
| `receipts` output | Array of `{record, hash}` from Python ledger validation and append. Each pool owns one persistent Python ledger bridge speaking JSON lines, served by [ledger_writer.py](../../tools/ledger_writer.py); it drains up to 128 queued requests, groups them per ledger path in one `BEGIN IMMEDIATE` transaction with a savepoint per request, and answers only after the batch is durable (see Ledger writer journal below). Every row's sequence, link and hash are verified on each read; a cached prefix skips only decoding and re-validation of rows whose sequence, hash and id still match a verified row. SQLite validates and chains records even across pools and other writers. Observations contain the batch result, including workcell identity, configured limits, and report. |
| `stats` | Snapshot `{size, workers, busy, queued}`; queued includes submissions awaiting receipt validation. |
| `ready()` | Spawns workcells up to `size` and resolves once each has installed its WASM guard and sent `{type: 'ready'}`, and starts the persistent ledger bridge and waits for its `{id: 0, result: 'ready'}` line after imports; memoized. Rejects if a cell exits before ready or the pool is closing. `prewarm: true` calls it from the constructor. A replacement cell spawned after an exit is not awaited. |
| Supervisor death | A process cell polls its parent every 250 ms from a helper thread and kills itself with SIGKILL when the parent changes, so a hung kernel doesn't outlive its supervisor. Thread cells die with the process. |
| `close()` | Idempotent promise; refuses new submissions, drains accepted work and receipt writes, then terminates workers. There is no forced cancellation or wall-time deadline. |

The pool replaces template delivery/outcome states and observations. Unknown
batch outcomes yield `outcome_unknown`/`inconclusive` for every candidate.
A process-limit rejection yields `finished`/`failed` for the whole batch, recording the limit without inventing evaluator attempts. Otherwise any rejected attempt yields `failed`; candidates with only passed
attempts yield `passed`; candidates without attempts yield `unobserved`.
Passing checks does not imply Pareto frontier membership or activation authority.
Template validation errors reject before dispatch. A ledger append failure
rejects the job with `error.result` carrying the evaluation result. A batch's
receipt appends are individually durable, not an atomic batch; inspect the ledger
before reconciling an interrupted write. A failing request rolls back only its savepoint. If the bridge process exits, pending requests reject with `error.outcome === 'outcome_unknown'` and are never resent, later ledger requests reject, and the bridge is not respawned unless the pool was created with `restart`; `close()` drains pending requests, then closes the bridge's input so it retires its journal before exiting. The Python bridge retains the existing
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
Heap limits exclude off-heap memory: thread mode has no per-cell bound on it, and a job holding it can pass ([P-44](../../experiments/P-44-offheap/RESULT.md)). Process cgroups set `memory.swap.max=0` where the kernel has it. Where it doesn't and the host has swap, the cell has `cgroup: 'unavailable'`. Trusted host ports retain normal Node privileges; thread mode shares process-wide failures. Process mode contains child exits, but does not protect the supervisor against global OOM or privileged/malicious ports. Cgroup setup requires delegated memory/cpu/pids controllers and writable migration files. If the delegated root contains only this supervisor, setup moves it to an unbounded supervisor leaf before enabling controllers; it never moves other processes. That leaf remains for the enclosing scope to reclaim. Workcell cgroups are cleaned up after child exit on a best-effort basis. Source rationale and pinned references are in the
[runtime guidance](../../core/runtime/README.md).

### Ledger writer journal

The bridge commits each ledger's transaction without a disk sync (WAL, `synchronous=OFF`, no checkpoint by the writer; `NORMAL` on Python before 3.12; rollback-journal ledgers keep `FULL`) and records every statement the batch wrote, with its parameters, in one frame of the writer's journal segment: `EFJ1`, a 4-byte length and the SHA-256 of a JSON payload `{writer, frame, ledgers: [[path, version, digest, statements]]}`. One `fdatasync` of the segment covers every ledger in the frame; decision files are written and answers sent only after it. A journal thread coalesces batches applied during a sync, and waits up to 10 ms or 16 requests when requests arrive less than 5 ms apart. Each ledger's `ledger_journal(version, digest)` row, written in the same transaction, says which frames it holds.

Segments live in `$ENDOFORGE_LEDGER_JOURNAL`, else `$XDG_STATE_HOME/endoforge/ledger-journal` (`~/.local/state/...`), or the `journal` option of `LedgerBridge`. Each writer locks its own segment. At start, under the directory's `.recover` lock, a writer recovers every unlocked segment: a short or checksum-failing tail is copied to `<segment>.torn-<offset>.<nanoseconds>` and cut off (it was never synced, so never answered); a damaged frame followed by a valid one refuses to start; missing versions are replayed in order, a ledger whose version holds a different digest gets `<ledger>.journal-conflict` and is refused afterwards, and a ledger whose directory is gone is skipped. A segment is retired after `syncfs` of each filesystem it touched, at 128 MiB and at a clean close. `ENDOFORGE_LEDGER_STATS=<file>` makes the writer write its counters there on exit.

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

`generate({need, directory, env?, timeout?, check?})` returns `{candidate, reference,
digest, testDouble, session, repaired, timings}`. With `ENDOFORGE_SELF_CHECK=1`, `check({id, files})` returns gate failures or null; failures trigger one resumed `repair` stage. Directory must not exist. Candidate has `{id, files}`;
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
and verifies each G1–G8 verdict. It exclusively writes and fsyncs a version-1
JSON decision with issuer `endoforge.local.x1`, policy `X1-G1-G8/v1`, scope
`qualification`, candidate/oracle/receipt identities, and `decision: promote|refuse|inconclusive`.
Promotion adds evaluator digest and chain tip; refusal and inconclusive record a reason. Inconclusive means no outcome was reached, so nothing was decided. `sha256`
hashes the other fields as sorted compact JSON. Existing output paths fail closed.
This is a local trusted-host policy, not a POODO-issued lifecycle authorization or
signature. POODO has no callable approval API today; neither sibling repo changes.

## In-workcell candidate loop interface

`x1/loop.mjs` exports the loop. `createLoopPool({size, isolation, jobTimeoutMs, ascPath, hostPort, primes})` returns an `IsolatePool` with the limits of `tools/asc/pin.mjs`, warm state from `x1/loop-port.mjs`, and a 60-second default deadline. `runNeed` takes this path when `env.ENDOFORGE_LOOP === 'isolate'`, and refuses any other pool.

| Operation | Contract |
|---|---|
| `admit(pool, reference, {need, configuration})` | One bridge request. Without `reference.identity`, it appends task, input and frozen evaluator in one transaction from `reference.root`; with one, it re-verifies the tree. Returns `{identity, digest, encoded}`, where `encoded` is the ledger's canonical encoding of the record's data. |
| `checkCandidate(pool, admission, {id, files})` | One job with no durable effect. Returns the failing gates and tests, or null. Throws if the job doesn't return an outcome. |
| `evaluateInCell(pool, {candidate, admission, repair, timings})` | One job. Returns `{observed, content, sources}`. A lost cell returns an `outcome_unknown` observation and content whose `compiled.error` is `attempt lost`. |
| `commitCandidate(pool, {evaluated, reference, digest, decisionPath, timings, receiptId})` | One bridge request. Returns `{promoted, candidate, receipt, decision, problem, status, report, rounds}`. Rejects, with nothing durable, on a template the ledger refuses. |
| `evaluateAndCommit(pool, {...})` | The last two together, with optional `observe(stage)` for `committing` and `returned`. |
| `pool.run({..., ledger: 'caller'})` | Skips the pool's `prepare` and `append`, for a caller that writes its own records. `pool.ledger` is the pool's bridge. |

`problem` is `frozen_drift`, or names the report check that failed, or is null. With a problem, the observation keeps the report, sets `status: 'rejected'` and the problem as `reason`, the receipt is `finished`/`failed`, and the decision refuses. `promote` on the same ledger reaches the same decision: the rule is shared through `tools/x1_loop.py:decide`, unchanged. The decision file is written after commit, so `promoted: true` implies the records and decision are durable, and a crash between them leaves records with no decision. The port's evidence joins the observation without `content`: `{identity, compiler, rounds, timings}`. Candidate records and receipts have the existing schema.

`attemptAgent` is `runNeed`'s path for `ENDOFORGE_LOOP === 'agent'`. It takes `{need, directory, pool, observe, limits, resume}`, and `limits` defaults to `{maxTurns: 6, maxTokens: 64000}`. `new IsolatePool({hostCall})` answers `{type: 'host-call', id, call}` from a cell's job with `{type: 'host-reply', id, value | error}`; a port receives `createPort(options, {host})`. The loop's calls are `{kind: 'model', messages, remaining}` and `{kind: 'admit', files}`, one per job. The handler maps them to its job by the host's own `job.data`, so a cell can't name another job. `admit` also takes `{files}` for a tree that exists only in memory, and `{resume: true}`, which returns the ledger's latest frozen evaluator. Without `decisionPath`, `commit` inserts the decision into `x1_decisions(candidate, body)` in its own transaction. A ledger the bridge creates at admission is in WAL mode. `createLoopPool({waits})` takes `release` (default) or `hold`. Under `release` the port's job ends with status `waiting` and `evidence.waiting`, `{stage, turn, messages, overlay, receipt, compiler}`, and the host calls the model with no job held. After admission and a first reply it writes `{cell, host}` with the `park` action, `{after, body, sha256}`: the ledger checks the digest, refuses unless `after` is the latest waiting row (or null with none waiting), marks that row `resumed` and returns the new `seq` in `x1_continuations(seq, state, sha256, body)`. The next job takes `{continuation, reply}`. `commit` takes `continuation: seq` and closes that row in the receipt's transaction, refusing if it isn't the latest waiting one. `admit` with `resume` also returns `continuation`, the latest waiting row or null.

`IsolatePool.run({...job, timing:true})` additionally returns host monotonic
`timings: {gate, ledger}`. Gate spans receipt-preflight completion through worker
result delivery, including FIFO wait/startup and frozen verification. Ledger sums
preflight and append including serialization wait. Timing metadata is returned
outside the persisted observation and does not change verdicts or receipt schemas.
