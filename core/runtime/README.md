# Runtime

Generic utilities for independent local workflows. Supply your own inputs and output directory. Use synthetic examples when sharing configurations.

Run agent-pool.mjs with an explicitly configured client and account directories. It supports public Codex CLI invocations and checks account-marker presence without reading credential contents.

Worker-registry integration requires WORKERS_BIN explicitly; no host registry is discovered automatically.

### Agent pool contract

- **Accounts.** An account is a directory holding `auth.json`: `CODEX_POOL_PRIMARY`, logged as `default`, then each subdirectory of `CODEX_POOL_ACCOUNTS_DIR`. Only the file's presence is checked.
- **Slots.** Each account takes at most `CODEX_POOL_PER_ACCOUNT` launches at once (default 2), tracked by owner-PID slot directories in `CODEX_POOL_STATE_DIR`. The least-loaded account goes first, and a dead owner's slot is reclaimed by rename, so one reclaimer wins.
- **Rate limits.** A rate-limited account cools down until the time its error names, or for 300 s if it names none. The pool then fails over to the next account and logs each try to `<state>/log`.
- **Child.** The child is `CODEX_POOL_BIN`, or the first `codex` on `PATH` that isn't this script. A regular file on stdin is reopened for each try, so a retry sees the whole prompt.
- **Exits.** The child's code; 75 when every account is cooling down or no slot frees within `CODEX_POOL_WAIT`; the guard's code when `CODEX_POOL_GUARD` refuses; 2 when no client is found.
- **Worker registry.** With `WORKERS_BIN` set, only the child runs under `workers run`, never this launcher, so the pool can't recurse. The registry's spawn-rate gate reaches the caller as exit 75 with no failover. Without `WORKERS_BIN` no gate applies, so a host relying on the gate must set it.

## V8 isolate workcells

[IsolatePool](isolate-pool.mjs) schedules real
[evaluateCandidates](../engine/evaluator.mjs) calls inside Node thread or process workcells through
[isolate-workcell.mjs](isolate-workcell.mjs). Each workcell executes one batch at a
time, including the real gates and frozen-content checks. Callers provide a host
port module exporting `createPort(options)` and durable ledger inputs, not replacement
contracts in the runtime. The bounded FIFO pool defaults to available CPU parallelism;
workers are created on demand and retained until `close()`.
[P-15](../../experiments/P-15-workcell-concurrency/RESULT.md) showed contention at
large widths; [P-17](../../experiments/P-17-workcell-gap/RESULT.md) measured a
throughput plateau at 20–32 workcells, with 28 best on 28 pinned cores. These
synthetic probes support sizing throughput pools to available cores, rather than
using P-15’s latency-driven width of 10. Latency-sensitive callers can set a smaller
`size`; the probes do not establish an optimum for every workload.

```js
import { IsolatePool } from './core/runtime/isolate-pool.mjs';
const pool = new IsolatePool({ hostPort: '/tmp/example/host-port.mjs', size: 4, isolation: 'process',
  resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
  wasmMemoryMaxMb: 64 });
try {
  const result = await pool.run({ reference, candidates, receipts, portOptions: {} });
  console.log(result.report, result.receipts);
} finally {
  await pool.close();
}
```

Here `reference`, `candidates`, and receipt templates come from the caller's durable
ledger. The [ICD](../../docs/interfaces/ledger-icd.md#v8-workcell-pool-interface)
defines all fields and failure states; the
`synthetic fixture` demonstrates their construction.
[isolate-ledger.mjs](isolate-ledger.mjs) invokes Python's existing `Ledger` validation
and append implementation on the host. Every batch produces one receipt per
candidate, preserving candidate/oracle binding without changing the schema. A host port may export `evidence()`; its JSON value joins that batch's result as `evidence`, and so the observation of each of the batch's receipts.
Unknown worker outcomes produce inconclusive receipts and never a retry or a pass.
`warm: {...}`, off by default, has each cell import the host module and await its exported `warm(options)` before it reports ready. A failure, or a `warm` still running after `warmTimeoutMs` (default 60000), rejects `ready()` and makes that cell's jobs unknown, never a pass. Replacement cells warm themselves and aren't awaited. Cells that exit before reporting ready, as a `warm` calling `process.exit` does, stop being respawned after `size + 2` in a row. `halted` turns true, and later jobs get `outcome_unknown` with reason `workcell_start_failed` and start no cell.
Keep ledger files and other generated evidence outside the source tree.

Run `make isolate-test` for native evaluator parity, multi-isolate chain verification
and tampering, concurrency at 1/4/16, real heap exhaustion, WASM declaration and
growth breaches, worker exit, replacement, frozen drift, and graceful shutdown.
Both memory breach tests hold a healthy neighbor mid-job and verify complete
accepted/rejected reports after the breached cell exits and is replaced. Tests use
local synthetic ports and Python;
they require no model service, compiler download, or WebAssembly runtime package.

## Source basis and limits

The R02 scheduling rule is one JavaScript job at a time per isolate, with CPU
parallelism supplied by multiple workers. V8 may use internal helper threads.
The P-15 and P-17 probes inform scheduling only: their synthetic contracts and
private hash encodings are not runtime implementations or qualification evidence.
[P-16](../../experiments/P-16-workerd-isolates/RESULT.md) found that standalone
workerd killed every isolate on a JS heap breach and accepted 256 MiB of WASM
memory despite a 128 MiB heap flag. This pool uses Node’s worker-local
heap termination by default, or one forked Node process per cell, plus a separate in-workcell WASM ceiling; its own tests establish
neighbor survival, rather than inferring it from workerd or from throughput.

V8 source inspected read-only at `~/work/ref/v8`, commit
`b13350f841bb1b868a2490bf554945d0e580fba2`:
`include/v8-isolate.h`, `ResourceConstraints` and `AddNearHeapLimitCallback`, specify
old/young generation limits and near-limit callbacks. `src/heap/heap.cc`,
`Heap::CheckHeapLimitReached` and `Heap::InvokeNearHeapLimitCallback`, show that a
callback may increase the limit and an unresolved limit can cause fatal OOM.
Those V8 primitives alone do not establish worker-local recovery.

Node v22.21.0's
[doc/api/worker_threads.md](https://github.com/nodejs/node/blob/v22.21.0/doc/api/worker_threads.md)
defines worker heap limits and termination. Its
[src/node_worker.cc](https://github.com/nodejs/node/blob/v22.21.0/src/node_worker.cc),
`Worker::UpdateResourceConstraints` and `Worker::NearHeapLimit`, supplies the embedding:
separate isolates, generation constraints, and `ERR_WORKER_OUT_OF_MEMORY` shutdown.
The pool waits for exit before replacement. Heap flags that override these limits
are refused. Limits exclude ArrayBuffers, native allocations, and total RSS:
[P-44](../../experiments/P-44-offheap/RESULT.md) measured a job with a 128 MiB heap retain 3 GiB of ArrayBuffer,
Buffer, Blob or separate WASM memories and still pass, in thread mode and in process mode without a cgroup.
Thread mode can't bound off-heap memory; only a delegated cgroup in process mode can.
Global OOM can still terminate the host, as can native crashes in thread mode. Host modules are
trusted code with normal Node privileges. Workcells are not an OS sandbox.

## WebAssembly memory enforcement

[isolate-wasm.mjs](isolate-wasm.mjs) patches the worker’s `WebAssembly.Memory`,
`Memory.prototype.grow`, `compile`, `Module`, `instantiate`, and `Instance` before
importing the host port. `compileStreaming` and `instantiateStreaming` buffer their
responses and use the same checked path. `wasmMemoryMaxMb` is an integer from 1
through 4096 MiB, default 64; the ceiling applies to each linear memory created in
that workcell. It is separate from the JS heap limits and does not bound the sum
of multiple memories or total RSS.

Untrusted module memories without declared maxima, including imports, and declarations or
JS descriptors with initial/maximum above the ceiling terminate the cell before
allocation. Existing module declaration limits are preserved, never raised.
JS Memory descriptors still default to the ceiling; V8’s native maximum remains a backstop. JS `grow()` checks the requested size before calling V8. Checked
modules receive appended growth helpers and a mutable breach flag; each original
`memory.grow` calls its helper, which checks the requested size and traps after
setting the flag if the configured ceiling would be exceeded. Helpers preserve
existing function/global indices. A start function is exported under a unique
internal name and invoked once after flag registration. The flag is checked before
any evaluator result is returned, including when a host callback catches the trap.
Flags remain internal implementation evidence and must not be modified by ports.
The appended exports are visible to module/instance reflection.

The supervisor may declare `trustedWasmModules: [{name, sha256, maximumPages}]`
when constructing the pool. A matching original binary receives that explicit
maximum only where a memory declaration omits one, before compilation or
allocation. Each cap must fit `wasmMemoryMaxMb`; initial sizes must fit the cap.
Names label the policy; SHA-256 of the complete original bytes establishes the
match. Candidate inputs and `portOptions` cannot add trust. The supervisor copies
the policy into every result and ledger observation, including worker losses.
Growth past a cap the policy supplied, from an instruction or from JS, is a breach:
it stops the cell and leaves its siblings running, so a pinned compiler can't continue on a `-1` the policy produced.
An empty policy is the default. All binary parsing, growth instrumentation and
unsupported-feature checks still apply. This is a toolchain compatibility policy,
not authority for arbitrary candidate modules.

`sharedWasmModules: [{sha256, path}]` lets a thread pool instrument and compile a pinned module once, in a short-lived guarded worker, and post it to its cells. It must name a `trustedWasmModules` digest. A cell given matching bytes gets that module instead of recompiling; other bytes are still checked, and modules from anywhere else stay refused. Bytes that don't match the digest fall back to compiling per cell, and results list what was shared. A `Module` can't cross a process boundary, so process cells always compile their own. [P-45](../../experiments/P-45-shared-module/RESULT.md) records the measurements.

[`tools/tscheck`](../../tools/tscheck/README.md) uses the same policy for the pinned TypeScript checker, with `stackSizeMb` for deep input.

[AssemblyScript toolchain helper](../../experiments/assemblyscript-toolchain.mjs)
pins the AssemblyScript 0.28.20 `f64_pow` helper to 16 pages (1 MiB).
Binaryen already declares 65,536 pages; kernel output retains `--maximumMemory 16`.
The [P-20 harness](../../experiments/P-20-pool-speed-rerun/run.mjs) supplies the
policy before importing the compiler in each workcell and during supervisor builds.

A breach sends `ERR_WORKCELL_WASM_MEMORY_LIMIT` to the pool and exits that worker.
The host waits for exit, emits `outcome_unknown` with `reason: 'limit'`, appends
inconclusive receipts, and replaces only that workcell. Heap exhaustion in thread mode uses
`ERR_WORKER_OUT_OF_MEMORY` through the same exit/replacement path. Process mode
returns `rejected` with reason `heap` or `wasm_memory`, and supervisor-appended
`finished`/`failed` receipts; other exits remain inconclusive. Neither lost job
is retried. A smaller module-declared maximum retains normal WASM failure behavior:
`memory.grow` can return -1 below the configured ceiling without being a pool breach.

The binary guard supports wasm32 scalar functions, ordinary reference types,
bulk memory, imported/defined memories, and shared memory declarations. Unsupported
features in memory-bearing modules (including SIMD, atomics, GC types, exceptions,
and memory64) fail closed with a compilation error; there is no unchecked fallback.
Modules without memories need no growth instrumentation. Modules transferred from
outside the workcell cannot be instantiated: they must be compiled locally through
the guard, or come from the supervisor's `sharedWasmModules`. Ports are trusted Node code and must use this realm’s checked API;
new realms, native addons, or other workers can bypass JavaScript wrappers and are
outside this interface. No Wasmtime dependency is introduced.

The WebAssembly specification was inspected read-only at `~/work/ref/spec`, commit
`6057acdb1a213f85369c64454c078a15f11ac4b1` (short `6057acdb1a21`):

- `document/core/syntax/types.rst`, **Limits** and **Memory Types**: memory limits
  use pages; an omitted maximum permits growth to any valid size.
- `document/core/exec/runtime.rst`, **Memory Instances**: a page is 65536 bytes.
- `document/core/exec/instructions.rst`, **memory.grow**: growth must fail beyond
  a declared maximum and failure returns -1; resource shortages may also fail.
  See the [core specification](https://webassembly.github.io/spec/core/exec/instructions.html#exec-memory-grow).
- `document/core/binary/types.rst`, **Limits** and **Memory Types**, and
  `document/core/binary/modules.rst`, **Import**, **Memory**, **Start**, and **Code**
  sections: encodings used for checking limits and appending instrumentation.
- `document/js-api/index.bs`, **Memory**, **grow the memory buffer**, and
  **Memory.grow**: JS growth failure throws `RangeError`, unlike the instruction’s
  -1 result. See the [JS API specification](https://webassembly.github.io/spec/js-api/#dom-memory-grow).

V8 source at `~/work/ref/v8`, commit
`b13350f841bb1b868a2490bf554945d0e580fba2` (short `b13350f841bb`), supplies the
implementation cross-check:

- `src/wasm/wasm-js.cc`, `WebAssemblyMemory` and `WebAssemblyMemoryGrowImpl`:
  descriptor handling and the JS maximum-size check/`RangeError` path.
- `src/wasm/wasm-objects.cc`, `WasmMemoryObject::Grow`: compares requested pages
  with the memory’s maximum and returns -1 before growth if exceeded.
- `src/runtime/runtime-wasm.cc`, `Runtime_WasmMemoryGrow`: the instruction runtime
  delegates to `WasmMemoryObject::Grow` and returns its result.

These pinned references explain memory semantics; they do not claim that the
installed Node binary was built from this V8 checkout. Tests use the installed
Node runtime to demonstrate actual worker-local enforcement.

## Process workcells

`isolation: 'process'` forks one Node child per cell with the same configured
old/young values passed as `--max-old-space-size` and `--max-semi-space-size`.
With `stackSizeMb`, the child starts through `/bin/sh`, which raises `RLIMIT_STACK` and `exec`s Node with `--stack-size` 192 KiB below it, less the size of the environment and arguments, which share that stack; the constructor refuses if the host won't raise the limit. The flag alone dies with SIGSEGV on deep recursion, as [P-47](../../experiments/P-47-process-stack/RESULT.md) measured, and with the rlimit raised the same probes throw `RangeError`.
V8's young generation can include several semi-spaces; these are heap settings,
not RSS quotas. The child uses V8's fatal heap-limit exit; it does not install
`v8.setHeapSnapshotNearHeapLimit`, which is a snapshot API, or a native callback.
At pinned V8 commit `b13350f841bb`, `include/v8-isolate.h`
`AddNearHeapLimitCallback` and `src/heap/heap.cc`
`Heap::InvokeNearHeapLimitCallback`/`Heap::CheckHeapLimitReached` explain the path:
a callback can raise the limit; an unresolved limit calls fatal OOM. The
supervisor recognizes V8's fatal heap diagnostic on stderr, waits for child
close, records rejection, and replaces only that child. It retains no heap dump
or stderr transcript. The installed Node build is not identified by that V8 pin.

Process mode tries the current cgroup v2 delegation, or `cgroupRoot`, before
dispatching any job. `cgroupLimits: {memoryMax: 268435456,
cpuMax: '100000 100000', pidsMax: 64}` controls bytes, quota/period and tasks.
The [ICD](../../docs/interfaces/ledger-icd.md#v8-workcell-pool-interface) defines
defaults and setup side effects. Root privileges are never requested. A delegated
root must expose memory/cpu/pids and writable migration/controller files; a
populated shared desktop cgroup is insufficient. A suitably delegated user
scope or empty writable `cgroupRoot` can supply this. Setup follows the kernel's
[no-internal-process constraint](https://docs.kernel.org/admin-guide/cgroup-v2.html#no-internal-process-constraint).
Each attached child gets its own group with `memory.max`, `memory.swap.max=0` where the kernel has it,
`memory.oom.group=1`, `cpu.max` and `pids.max`. Without the swap limit, P-44 saw every off-heap kind reach its 3 GiB cap
with no kill on a host with swap, and with it every kind was killed. Its receipt has no swap reading, so swap as
where the excess went is inferred. The limit is part of the bound, so a kernel without `memory.swap.max` on a host
with swap in `/proc/swaps` gets no cgroup. Failure records `cgroup: 'unavailable'`; V8 limits and
the WASM gate still apply. Cgroup OOM kills without V8 diagnostics remain unknown
and are not mislabeled as JS heap exhaustion. Host ports remain trusted Node code.
The supervisor stops waiting 500 ms after a child's exit even if a grandchild still holds its stderr. Without a cgroup, that grandchild keeps running; with one, the group kill ends it. A cell whose process has exited takes no job during that wait, so the next job goes to its replacement.
A deadline can't interrupt a thread cell in a blocking native call such as `execSync`: `terminate()` waits for the call to return, so the job can overrun by that call's length. Its outcome stays unknown, never a pass. Use process cells where the bound has to hold for code like that.
[P-18](../../experiments/P-18-pool-breach/RESULT.md) records N=8 breach results
for both modes, including the unavailable-delegation limitation.

## Contained JavaScript

`contained/` runs JavaScript emitted by the TypeScript route in a child V8 isolate. It's the compatibility lane's executor, for imported code and behaviour that resists the kernel split; the strict path stays a WebAssembly kernel plus declarative glue, and nothing here runs on it. Every result carries `lane: compatibility`, and nothing runs it unless a caller asks.

```js
import { createContainedRunner } from './contained/runner.mjs';

const cohort = createContainedRunner({ width: 8, heapMb: 64, deadlineMs: 1000 });
await cohort.ready();
const result = await cohort.run({ modules: { '/proj/a.js': source }, entry: '/proj/a.js', exportName: 'main', input: {} });
```

- **Layout.** The default is one supervised cohort: a single `node --permission` child process with an empty environment and no file grant, holding `width` Worker isolates that are kept between attempts. Each attempt gets a fresh guest context with an allowlist of standard globals and code generation off. The supervisor, its watchdog and the caller's ledger stay outside the cohort. [P-54](../../experiments/P-54-contained-js/RESULT.md) measured this layout at the throughput of one process per cell with about a third of the memory, and at a twentieth of the CPU of a fresh Worker per attempt.
- **Failure scope.** Isolates in one process share its death. A V8 fatal allocation error ends the cohort whatever a Worker's `resourceLimits` say. The supervisor then kills what's left, reports every attempt the cohort held as `outcome_unknown`, starts one replacement and carries on with the queue. It retries nothing: a retry is a new admission by the caller. Heap, stack and deadline breaches that a Worker contains cost only that attempt.
- **Preparation in the cohort.** With `prepare` (from `tools/tscheck/cohort-check.mjs`), `runChecked()` sends one job and gets one result per attempt: the cohort type checks and emits in checker Workers of its own process (`layout: 'sibling'`) or in the guest's Worker (`'fused'`), then runs the output twice. The cohort may read only the pinned compiler module, which it verifies and compiles once for every Worker. A check that traps, loses its Worker or overruns `checkDeadlineMs` is `outcome_unknown`, and a cohort loss makes every checked attempt in flight `outcome_unknown`. [P-58](../../experiments/P-58-cohort-typecheck/RESULT.md) measured 380–516 accepted per second at width 16 against 58–63 with the check on the supervisor, at 1.1–1.5× the CPU per attempt.
- **Other layouts.** `reuse: false` gives a fresh Worker per attempt. `createContainedPool({ width })` runs one process per cell, for a cohort whose failure budget can't share a process; it loses no neighbour to a fatal error and costs about 70 MiB per cell. `tools/tscheck/contained-route.mjs` takes `layout: 'shared-reuse' | 'shared-fresh' | 'process-per-cell'`.
- **Modules.** CommonJS only, since `import` needs host hooks. A source containing `import` followed by `(`, even in a string or after comments, is refused as `dynamic_import`, because `import()` near a stack overflow throws a host-realm error into the guest. Set `module: commonjs` in the project.
- **Authority.** Nothing unless the contract grants it: `contract: { grants: { clock: { fixedMs }, random: { seed } }, ports: { name: { maxCalls, maxBytes } } }`. The two grants are deterministic. A real clock or anything else goes through a port. Ports are reached by `require('host:ports')`, carry JSON text, and reject with guest-realm errors.
- **Refusals.** `heap`, `memory`, `deadline`, `stack`, `string_limit`, `thrown`, `never_settled`, `output_not_json`, `output_too_large`, `compile`, `dynamic_import`, `process_exit`. A lost process is attributed to its attempt only when it held one; otherwise every attempt it held is `outcome_unknown`. The deadline is enforced by the cell's main thread, with a process kill behind it from the supervisor, and an RSS watchdog behind that, since a single flat string can pass the heap limit.
- **Determinism.** `runTwice` compares two runs and refuses a difference. A guest that catches its own stack overflow can make depth-dependent output, and only the comparison sees that. Mathematical and Unicode results follow the V8 and ICU of the running Node.

This isn't an OS sandbox and it isn't a Spectre boundary. The permission model doesn't cover signals, and on Node 22 it doesn't cover the network. Passing the attack suite doesn't mean no escape exists; it doesn't test V8 memory-safety bugs. Requires Node 22.8 or later.

## X1 host port

[x1/host.mjs](x1/host.mjs) runs the eight X1 gates as the real evaluator's
residual check in either workcell mode. Universal gates measure the candidate through [x1/measure.mjs](x1/measure.mjs): two fresh instances in opposite call orders, usage read from outside the guest, and a scan of imports and calls. A wall-only overrun reads as an unknown outcome; fuel, stack and memory overruns refuse.
[x1/compiler.mjs](x1/compiler.mjs) compiles on the supervisor with a 60-second
watchdog, bounded diagnostic output and `--maximumMemory 1024` (64 MiB). Set
`ENDOFORGE_ASC_CMD` to the AssemblyScript 0.28.20 `asc` executable. Compilation
is outside the workcell heap quota. Candidate identity binds source, glue, frozen
checks and compiler bytes; the port checks source and frozen implementation bindings.
Original WASM exports exclude guard helpers; the closed glue schema preserves X1 constraints.
[x1/meter.mjs](x1/meter.mjs) adds fuel to the module at function entry and each loop header, charging an upper bound on instructions executed, so a kernel that never returns stops in the guest. G6 reports that bound; bulk memory operations are charged a fixed cost, so the pool's `jobTimeoutMs` stays a backstop. G7 also checks glue against kernel parameters and the frozen contract, and G8 probes float parameters with NaN and infinity, judged by [x1/contract.mjs](x1/contract.mjs) ([P-52](../../experiments/P-52-real-gates/RESULT.md)).
Host ports are trusted; workcells are not an OS sandbox.

[x1/generator.mjs](x1/generator.mjs) exposes
`generate({need, directory, env?, timeout?})`. Use a fresh output directory outside
the checkout. It invokes two `codex exec` sessions: specification, then implementation.
Between sessions the supervisor hashes contract/tests and durably freezes the oracle
and gate implementation using the existing ledger. Specification/marker drift,
premature code, unexpected files, symlinks and files above 1 MiB are refused.
Set `ENDOFORGE_CODEX_CMD` to an executable or JSON argv array, and `CODEX_HOME`
to the configured client home. The adapter forwards this environment; it never
reads, copies or discovers account/auth files. Client output is bounded and discarded.
The executable is trusted and Codex enforces its own workspace-write sandbox.
The returned candidate grants no promotion. CI uses the explicitly labelled
[fake Codex script](test/fixtures/x1/fake-codex.mjs), which always authors addition;
it is a test double and supplies no evidence of live synthesis quality.

`ENDOFORGE_CODEX_TERSE=scalar` opts into the exact prompt plus a finite numeric
scalar boundary rule. The default remains `exact`. Before freeze, scalar mode
drops tests containing nonnumeric or non-finite arguments and fractional
`expectError` inputs at explicitly typed integer parameter positions. Signature
types such as `n: i32`, `n: int`, and `n: integer` are recognized; untyped or
ambiguous prose is not inferred. Retained expectations and tolerances are unchanged.
Every function identified in signatures or original tests must retain a value
test, or generation fails before freeze. The request's `scalar-filter.json`
records dropped ids (name or index when no id exists), count, reasons and functions
missing value tests, including coverage failures. Successful generation and
pipeline results also include `scalarFilter`; implementation receives the filtered
frozen specification. This addresses unrepresentable inputs at the WASM boundary
without changing gates. [P-42 precommit](../../experiments/P-42-scalar/PRECOMMIT.md)
defines the prospective comparison; its copied harness uses `P22_OUTPUT` outside
the checkout and `ENDOFORGE_CODEX_TERSE=exact` or `scalar` for each arm.

### The loop inside the workcell

`ENDOFORGE_LOOP=isolate` runs everything between generation and promotion in one warm cell, with a pool from [x1/loop.mjs](x1/loop.mjs)'s `createLoopPool`. The existing path stays the default until parity is accepted, and it is unchanged. [P-50](../../experiments/P-50-in-isolate/RESULT.md) has the measurements.

- **Compile.** [x1/loop-port.mjs](x1/loop-port.mjs) compiles in the cell through the pinned AssemblyScript toolchain, over an in-memory overlay holding only `kernel.ts`, with the existing flags. No process or temp file. `import` of any other path fails, because the compiler's only reader is the overlay. `warm` checks the toolchain's digests from [tools/asc/pin.mjs](../../tools/asc/pin.mjs) and primes the compiler. The compiler needs the pool's WASM ceiling raised to 4 GiB, because binaryen declares that maximum, so the port refuses any kernel declaring more than the existing 1024 pages (64 MiB). Compile now counts against the cell's heap limit; a job past `jobTimeoutMs`, default 60 s here, loses the cell and records an unknown outcome.
- **Frozen check.** The freeze and the admission are one bridge request, which returns the frozen record's encoded data. The cell recomputes the evaluator identity and digest from that string at each of the evaluator's verifications, so a change to what it holds fails at the next one. A change on disk after admission, or a repository implementation file that no longer matches the bundle, is caught by the commit, which re-reads both inside its transaction: the receipt records `failed` and the decision refuses. A self-consistent forged bundle doesn't match the ledger's digest, and the commit refuses that too.
- **Gates and repair.** Round evaluation is unchanged and runs in the same cell. `repair: {module, maxRounds, options}` runs a host-supplied module in the cell, with a new compile and fresh instances each round, and may not change the oracle. A generator repair uses `checkCandidate`, one job with no durable effect, and releases the cell while the model works.
- **Durable crossing.** One `commit` request per candidate, batched with others by the persistent bridge. In one transaction it registers the candidate, appends the receipt and evaluates the unchanged promotion rule, then the bridge's journal frame holding those writes is synced, one `fdatasync` shared by every ledger in the batch, before any decision file is written and fsynced or any answer leaves ([writer journal](../../docs/interfaces/ledger-icd.md#ledger-writer-journal)). A crash before commit leaves nothing of the attempt, and a crash after it returns no promotion over complete records, which the existing `promote` can read. The commit also checks the report against the frozen bundle and candidate: oracle files, source and module digests, every frozen test present, and each recorded value against its expectation.
- **Left outside.** The ledger and supervisor stay out of every cohort: the cell never gets the ledger path or the frozen root. Generation, including the freeze's oracle files, is still a client process and a workspace. [x1/reference.mjs](x1/reference.mjs) keeps its process: a `vm` context is not a boundary, and from a cell its escape reaches the file system, while under `--permission` in its own process it doesn't. `make loop-test` shows this. The cell's report is trusted code's: one that is self-consistent in every field can't be told from a real one without running the kernel again.

### The agent loop in the workcell

`ENDOFORGE_LOOP=agent` also moves generation in. Create the pool with `createLoopPool({ provider })`.

- **Cell.** [x1/agent.mjs](x1/agent.mjs) holds the turn loop in the bounded style of a thin agent: turn and token limits, one reply object with up to 16 calls, `read_file`, `edit_file`, `check`, `done`, an error reply instead of a crash on junk. Files are an in-memory overlay. Editable paths are `CONTRACT.md` and `tests.json`, then `kernel.ts` and `glue.json`. A failed check is the next prompt in the same job.
- **Freeze.** The cell sends the frozen files and its implementation bytes over the worker channel, and the host writes them into the ledger. There is no frozen tree on disk. The ledger's own chain guards the bundle, and the commit still compares the repository's implementation files with it. `resume: true` starts a lost attempt again from the ledger's evaluator.
- **Decision.** It commits in the receipt's transaction, in a separate `x1_decisions` table outside the hash chain. `promote` reaches the same answer from the chain. The ledger's WAL file sits beside it.
- **Waits.** `createLoopPool({ waits })` is `release` by default. A cell needing a model reply ends its job with status `waiting` and its continuation, and the cell goes back to the pool while the host calls the model. Once the task is frozen and the conversation holds a reply no durable record has, the host first writes the continuation to `x1_continuations` in the task's ledger. The reply is a fresh admission into any free cell: the host rechecks deadline and limits, and the cell rechecks the frozen evaluator, its implementation files, the frozen files and the compiler identity. Each park names the continuation it resumes, and the commit closes the last, so one resumed twice can't promote. A failed model call ends the attempt as under `hold`; a supervisor lost during the wait leaves the continuation for a rerun to resume. The continuation carries the check rounds so far, so `rounds` lists every turn's checks, failed candidates included, as under `hold`. `hold` keeps the cell through the call, as before. [P-57](../../experiments/P-57-release-waits/PRECOMMIT.md) measures both.
- **Deadline.** `jobTimeoutMs` covers compute. It starts when the cell is warm, so a replacement cell's start isn't charged to the job it takes, stops while the host answers a call and restarts after, and the transport's own timeout bounds the model.
- **Provider port.** `{name, testDouble, start(), send({session, messages}), endSession(session), close()}`, returning `{text, usage}`. Only those two reach the cell. [x1/transports.mjs](x1/transports.mjs) has `WarmClaudeTransport`, `SpawnClaudeTransport` and `scriptedProvider`. Another source, such as a warm `codex app-server`, can replace them without touching the loop.
- **Warm Claude.** One long-lived `claude -p --input-format stream-json` per lane, with `--tools ""`, `--no-session-persistence`, `--strict-mcp-config`, `--setting-sources ""`, `--safe-mode`, a structured reply schema, and an allow-listed environment that has no API key variables. Each `instances` entry has one existing `CLAUDE_CONFIG_DIR`, so accounts never share state; the transport never reads credentials. A session reporting another tool, an API key source or an MCP server is refused. `/clear` separates sessions. A dead lane takes no further prompt, and the next send starts a new process with the full history. An idle lane is released after `idleMs` if its generation hasn't changed, and a usage-limit event routes work away from that instance until it resets. Nothing retries a lost attempt automatically.
- **Usage governor.** [usage-governor.mjs](usage-governor.mjs) reads every `rate_limit_event` from both Claude transports and keeps each window's utilization, reset time and status in memory and in one small state file (`ENDOFORGE_USAGE_STATE`, default `$XDG_RUNTIME_DIR/endoforge/usage-governor.json`), written by atomic rename and keyed by the login the child uses (its config directory, else `$HOME/.claude`), so concurrent processes on one login agree and accounts stay separate. Before each model call it admits only if utilization plus a per-call reserve for the calls already in flight stays under the ceiling (`ENDOFORGE_USAGE_CEILING`, default 0.85, leaving 15% for interactive use). The reserve is the measured usage per call in the current window, or 0.001 until usage moves. An `allowed_warning` or `rejected` status, a window at the ceiling, or a login drawing on usage credits refuses new calls with `UsageParked` (`code` `USAGE_PARKED`, exit code 75, `outcome` `outcome_unknown`, `resumeAt` the reset time): the caller parks until then and doesn't count a failed candidate. Calls in flight finish. The warm transport routes around a parked instance. When every instance is parked it refuses at once if the earliest reset is past `queueTimeoutMs`, and otherwise waits for that reset in the queue. Replies carry `rateLimit`, and `metric()` reports weekly usage spent per call and per accepted candidate since the window's first reading. Pass `governor: null` to turn it off. `watchdog: true`, or `CLAUDE_CODE_RETRY_WATCHDOG=1` in the base environment, passes Claude Code's retry watchdog variables to the child, with the wait capped below the transport timeout.

[x1/pipeline.mjs](x1/pipeline.mjs) connects generation, supervisor compilation,
pool evaluation, receipt storage and local promotion. POODO currently supplies
instructions, not a callable approval API. EndoForge's `ledger('promote', request)`
is the interface for a future POODO caller; it persists an exclusive qualification
decision bound to candidate, oracle, receipt hash and verified chain tip. It refuses
incomplete rounds, any failed X1 gate or chain/hash mismatch. It does not activate
artifacts. Host and ledger writers are trusted; the hash chain is not a signature
or an external witness. [P-22](../../experiments/P-22-real-need-to-candidate/README.md)
provides the sixty-request harness and prospective measurement protocol. `runNeed` takes an optional `containedRoute`; with one, the candidate's TypeScript is also checked, emitted and run contained, and the report joins the result under `contained` without changing the decision. See `tools/tscheck/contained-route.mjs`.
