# core/runtime

The runtime is where coding agents' work runs: the workcell pool that keeps V8 isolates warm, the candidate loop that
takes a need from a specification to a ledger decision inside those cells, the transports that reach real coding
agents (Claude Code and Codex), and the machinery around them (capacity planning, memory shedding, stage rates, the
compatibility lane). This README maps the files and states each module's contract briefly. The architecture pages
explain the mechanisms:

| Mechanism | Page |
|---|---|
| The loop, its three paths and its evidence | [Candidate loop](../../docs/architecture/candidate-loop.md) |
| The agent conversation inside a cell | [Agent loop](../../docs/architecture/agent-loop.md) |
| `IsolatePool`, limits, the WASM guard, the ledger bridge, the dump list, stage rates | [Workcells](../../docs/architecture/workcells.md) |
| G1 to G9 and the promotion rule | [Gates](../../docs/architecture/gates.md) |
| A blind second evaluator | [Evaluator synthesis](../../docs/architecture/evaluator-synthesis.md) |
| TypeScript as JavaScript in a contained cohort | [Compatibility lane](../../docs/architecture/compatibility-lane.md) |

Try it: `make loop-setup` installs the pinned compiler, then `node examples/first-loop.mjs` runs the agent loop with a
scripted model and prints the result ([output](../../docs/architecture/agent-loop.md#run-it)).

## Files

| File | Role |
|---|---|
| [isolate-pool.mjs](isolate-pool.mjs) | `IsolatePool`: thread or process cells, queue, limits, warm state, results, receipts |
| [isolate-workcell.mjs](isolate-workcell.mjs) | The cell's entry: installs the WASM guard, warms, imports the host port, runs the job |
| [isolate-wasm.mjs](isolate-wasm.mjs), [isolate-wasm-compile.mjs](isolate-wasm-compile.mjs) | The WASM memory guard, and the one-shot compiler for shared modules |
| [isolate-cgroup.mjs](isolate-cgroup.mjs) | cgroup v2 groups for process cells |
| [isolate-ledger.mjs](isolate-ledger.mjs) | `LedgerBridge`, the persistent Python ledger process |
| [dump-list.mjs](dump-list.mjs) | Sheddable-memory registration for the machine's memory guard |
| [stage-rates.mjs](stage-rates.mjs) | Per-stage rates, queues and a bottleneck verdict |
| [capacity/](capacity/index.mjs) | The capacity planner ([ICD](../../docs/interfaces/capacity-icd.md)) |
| [contained/](contained/runner.mjs) | The contained JavaScript cohort |
| [x1/](x1/pipeline.mjs) | The candidate loop: `pipeline`, `loop`, `loop-port`, `agent`, `generator`, `compiler`, `gates`, `measure`, `meter`, `contract`, `dimensions`, `oracle`, `transports`, `synth/` |
| [subscription-guard.mjs](subscription-guard.mjs) | Refuses `claude -p` launches that aren't on a claude.ai subscription |
| [usage-governor.mjs](usage-governor.mjs) | Parks model calls near the usage ceiling |
| [agent-pool.mjs](agent-pool.mjs) | Codex launcher over several accounts |
| [stub-pool.mjs](stub-pool.mjs) | A replaying stand-in for the agent pool, for atomizer tests |

## Workcell pool

```js
import { IsolatePool } from './core/runtime/isolate-pool.mjs';

const pool = new IsolatePool({ hostPort: 'path/to/host-port.mjs', size: 4, isolation: 'process' });
try {
  const result = await pool.run({ reference, candidates, receipts, portOptions: {} });
} finally {
  await pool.close();
}
```

`reference`, `candidates` and the receipt templates come from the caller's ledger. The full contract is the
[V8 workcell pool interface](../../docs/interfaces/ledger-icd.md#v8-workcell-pool-interface); the mechanism is in
[Workcells](../../docs/architecture/workcells.md). Keep ledgers and other evidence outside the source tree.

`make isolate-test` covers evaluator parity, chain verification and tampering, concurrency at 1, 4 and 16 cells, real
heap exhaustion, WASM declaration and growth breaches with a healthy neighbour mid-job, worker exit and replacement,
frozen drift and shutdown. The tests use local synthetic ports and need no model service.

### Source basis

One JavaScript job runs at a time per isolate; parallelism comes from several cells. V8's
`ResourceConstraints`, `AddNearHeapLimitCallback` and `Heap::CheckHeapLimitReached` (V8 commit `b13350f841bb`) and
Node v22.21.0's `worker_threads` (`Worker::UpdateResourceConstraints`, `Worker::NearHeapLimit`) define the per-worker
heap limit and `ERR_WORKER_OUT_OF_MEMORY`. The WebAssembly core and JS API specifications (commit `6057acdb1a21`) define
memory limits in 64 KiB pages, `memory.grow` returning -1 past a declared maximum, and `Memory.grow` throwing
`RangeError`; V8's `WasmMemoryObject::Grow` is the matching implementation. These references explain the semantics;
the tests, run on the installed Node, establish the behaviour. [P-16](../../experiments/P-16-workerd-isolates/RESULT.md)
found standalone workerd killing every isolate on one heap breach and accepting 256 MiB of WASM memory under a 128 MiB
heap flag, which is why the pool uses Node's per-worker termination plus its own WASM ceiling.

## The loop inside the workcell

`ENDOFORGE_LOOP=isolate` keeps the Codex generation of the `current` path but moves the freeze, compile, gates,
repair and commit into one warm cell and one bridge. `createLoopPool` in [x1/loop.mjs](x1/loop.mjs) builds the pool
(process cells, `jobTimeoutMs` 60 s, `jobDeadlineMs` 900 s, the compiler's limits from
[tools/asc/pin.mjs](../../tools/asc/pin.mjs), the `tools.x1_loop` bridge extension, `waits: 'release'`).

| Operation | Contract |
|---|---|
| `admit(pool, reference, { need, configuration, files?, resume? })` | One bridge request. Without `reference.identity` it appends task, input and frozen evaluator in one transaction; with one it re-verifies the tree. Returns `{ identity, digest, encoded }` |
| `checkCandidate(pool, admission, { id, files })` | One cell job with no durable effect; returns failing gates and tests, or `null` |
| `evaluateInCell(pool, { candidate, admission, repair?, timings? })` | One cell job; returns `{ observed, content, sources }`. A lost cell gives an `outcome_unknown` observation |
| `commitCandidate(pool, { evaluated, reference, digest, decisionPath?, timings?, receiptId?, continuation?, evaluator? })` | Re-runs the gates on the supervisor when the report claims a pass (`checkAtCommit`), applies a frozen synthesized `evaluator`, then one bridge request; returns `{ promoted, inconclusive?, candidate, receipt, decision, problem, status, report, rounds, rerun, synthesis? }` |
| `evaluateAndCommit(pool, {...})` | The last two together |
| `repair: { module, maxRounds, options }` | Runs a host-supplied repair module inside the cell, a fresh compile and instances each round; it may not change the oracle files |

The commit re-reads the frozen tree and the repository implementation files inside its transaction, so a change on
disk after admission refuses. Before that, the supervisor runs `runGates` again on the committed bytes and rejects the
receipt if the verdict or any test outcome differs from the cell's report. `attemptInIsolate` also takes `library`
(served right after the freeze, with `principal`; a pass returns `{ promoted: true, reused }`), `synthProvider`,
`confirm` and `suspect` (evaluator synthesis, written into the oracle root before `admit`, judged at commit in a
bounded worker thread, and a suspect report turned into a specification correction through the bridge's `revise`),
and `containedRoute` (the [compatibility lane](../../docs/architecture/compatibility-lane.md#the-route-on-a-candidate),
frozen after `admit` and decided after the commit). The cell never receives the ledger path or the frozen root.
[x1/reference.mjs](x1/reference.mjs), used by `ENDOFORGE_CODEX_TERSE=reference`, keeps its own permission-restricted
process: a `vm` context is not a boundary, and from a cell its escape reached the file system, while under
`--permission` in its own process it didn't ([P-50](../../experiments/P-50-in-isolate/RESULT.md)).

## The agent loop in the workcell

`ENDOFORGE_LOOP=agent` moves the agent's conversation in too. Create the pool with `createLoopPool({ provider })`. The
cell holds the messages, an in-memory file overlay, and the tools `read_file`, `edit_file`, `check` and `done`; it asks
the host only for model turns and the freeze, and under `waits: 'release'` a waiting conversation is parked in the
ledger instead of holding a cell. `maxTokens` is a budget per stage. With `library` the host asks the library right
after admission; with `ENDOFORGE_SYNTH=1` it freezes `synth/evaluator.json` in the admitted bundle, turns suspect frozen tests
into a specification correction before the implementation turn, and judges at commit in a bounded worker thread. [Agent loop](../../docs/architecture/agent-loop.md) is the full description.

A provider is `{ name, testDouble, start(), send({ session, messages, remaining, timeoutMs }), endSession(session),
close() }` returning `{ text, usage }`. [x1/transports.mjs](x1/transports.mjs) has `WarmClaudeTransport`,
`SpawnClaudeTransport` and `scriptedProvider`. Another source can replace them without touching the loop. Both Claude
transports pass `--model sonnet` unless given `model` (`defaultModel`), mark themselves `testDouble: true` when
`command` is not named `claude`, and accept a `governor` (the warm one also per `instances` entry). Each calls the
governor's `admit()` before every turn and its `observe()` on every `rate_limit_event`.

`createLoopPool({ rates: createStageRates({ stages: loopStages({ cells }) }) })` adds
[stage rates](../../docs/architecture/workcells.md#stage-rates); `node tools/stage-rates.mjs <snapshot> --watch`
prints a published view.

## Subscription guard

[subscription-guard.mjs](subscription-guard.mjs) runs before every `claude -p` launch: both transports, the
atomizer's `runIsolated`, and the hillclimb `workerCommand` used by the conductor, fan-out and job smoke. Model calls
run on a claude.ai subscription login, never on API billing. It refuses with `SubscriptionRefused` (exit 78) unless:

- the launch environment has no `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_FOUNDRY_API_KEY`,
  `AWS_BEARER_TOKEN_BEDROCK`, `CLAUDE_CODE_USE_BEDROCK`, `_VERTEX` or `_FOUNDRY`, `ANTHROPIC_PROFILE` or
  `ANTHROPIC_FEDERATION_RULE_ID`;
- no user, local, managed or project settings file, and no `--settings` argument, sets an `apiKeyHelper`, an AWS or
  OTel helper, a non-claude.ai `forceLoginMethod` or a billing variable;
- the config directory's `.credentials.json` holds a `claudeAiOauth` login with a token, the `user:inference` scope
  and a `subscriptionType` of `max`, `pro` or `team`, and `.claude.json` has no `primaryApiKey` or non-subscription
  `billingType`;
- the arguments contain no `--bare` and the environment doesn't turn on `CLAUDE_CODE_SIMPLE`, since bare mode
  authenticates only with an API key or helper.

Anything it cannot read or parse is a refusal. It reads metadata only and never prints a token. The child's
environment loses every `ANTHROPIC_*`, `CLAUDE_CODE_USE_*`, `CLAUDE_CODE_OAUTH_*` and Bedrock token variable. A proof
is cached per process for 30 s. `node core/runtime/subscription-guard.mjs [--config-dir DIR]` prints the proof and
exits 0 or 78. A login kept only in the macOS keychain is refused, because the file proof is absent.

## Usage governor

[usage-governor.mjs](usage-governor.mjs) reads every `rate_limit_event` from both Claude transports and keeps each
window's utilization, reset time and status in memory and in one state file (`ENDOFORGE_USAGE_STATE`, default
`$XDG_RUNTIME_DIR/endoforge/usage-governor.json`), keyed by the login, so processes on one login agree. Before each
call it admits only if utilization plus a per-call reserve for calls in flight stays under the ceiling
(`ENDOFORGE_USAGE_CEILING`, default 0.85). The reserve is the measured usage per call in the current window, or 0.001
until usage moves. A warning or rejected status, a window at the ceiling, or a login drawing on usage credits refuses
new calls with `UsageParked` (code `USAGE_PARKED`, exit 75, `outcome_unknown`, `resumeAt` the reset): the caller parks
until then, and it doesn't count as a failed candidate. The warm transport routes around a parked login. `governor:
null` turns it off. `watchdog: true`, or `CLAUDE_CODE_RETRY_WATCHDOG=1` in the base environment, passes Claude Code's
retry watchdog variables with the wait capped below the transport timeout.

## Agent pool contract

[agent-pool.mjs](agent-pool.mjs) is a drop-in `codex` launcher that spreads calls over several Codex accounts. Set it
as `ENDOFORGE_CODEX_CMD` (or `ENDOFORGE_CODEX_POOL` for the atomizer); its arguments go to the client
unchanged.

- **Accounts.** A directory holding `auth.json`: `CODEX_POOL_PRIMARY` (default `~/.codex`), logged as `default`,
  then each subdirectory of `CODEX_POOL_ACCOUNTS_DIR` (default `~/.codex-accounts`). Only the file's presence is
  checked; its contents are never read.
- **Slots.** At most `CODEX_POOL_PER_ACCOUNT` launches per account at once (default 2), tracked by owner-PID slot
  directories under `CODEX_POOL_STATE_DIR` (default `~/.codex-pool`). The least-loaded account goes first; a dead
  owner's slot is reclaimed by rename, so one reclaimer wins.
- **Rate limits.** A run that exits nonzero with a rate-limit message puts its account in cooldown until the reset
  time the message names, or for 300 s, and the pool fails over to the next account. Each try is logged to
  `<state>/log`.
- **Child.** `CODEX_POOL_BIN`, or the first `codex` on `PATH` that isn't this script, with `CODEX_HOME` set to the
  chosen account. A regular file on stdin is reopened for each try, so a retry sees the whole prompt.
- **Exits.** The child's code; 75 when every account is cooling down or no slot frees within `CODEX_POOL_WAIT`
  seconds (600); the guard's code when `CODEX_POOL_GUARD` refuses; 2 when no client is found.
- **Worker registry.** With `WORKERS_BIN` set, the child runs under `workers run`, never this launcher, so the pool
  can't recurse. The registry's spawn-rate refusal reaches the caller as exit 75 with no failover. Without
  `WORKERS_BIN` no registry gate applies.

`make runtime-test` runs its tests.

### Stub pool

[stub-pool.mjs](stub-pool.mjs) stands in for the agent pool in atomizer replays. It reads the bubblewrap arguments
from `ENDOFORGE_ISOLATE_SPEC`, copies the recorded outputs for that atom from `ENDOFORGE_STUB_REPLAY/atoms/<id>/out`
into the atom's `/out` bind after `ENDOFORGE_STUB_LATENCY_MS`, logs a stub account line with `pid=` (the form the
atomizer scheduler attributes), and runs `CODEX_POOL_BIN`, forwarding `SIGTERM` and `SIGINT` and returning its exit
status. A missing replay, a spec without an `/out` bind or an unreadable spec fails with a message.
`test/gaps4-runtime.test.mjs` tests it (REQ-STUB-001) in `make isolate-test`, together with delegated cgroup
enforcement inside a `systemd-run --user --scope` (REQ-ISO-018), which skips with its reason where no delegated scope
exists.

## Contained JavaScript

[contained/](contained/runner.mjs) runs JavaScript emitted from TypeScript in child V8 isolates: the compatibility
lane's executor, for imported code and behaviour that doesn't fit the kernel split. Every result carries
`lane: compatibility`, and nothing runs it unless a caller asks.

```js
import { createContainedRunner } from './core/runtime/contained/runner.mjs';

const cohort = createContainedRunner({ width: 8, heapMb: 64, deadlineMs: 1000 });
await cohort.ready();
const result = await cohort.run({ modules: { '/proj/a.js': source }, entry: '/proj/a.js', exportName: 'main', input: {} });
```

The default is one `node --permission` child process with an empty environment, holding `width` reused Worker
isolates; each attempt gets a fresh guest context with only standard globals. Clock and randomness exist only as
contract grants (`grants: { clock: { fixedMs }, random: { seed } }`), and anything else goes through named, budgeted
ports. `runTwice` refuses a difference between two runs; `runChecked` type checks, emits and runs in the cohort.
[Compatibility lane](../../docs/architecture/compatibility-lane.md) covers the layouts, refusals and measurements.
Requires Node 22.8 or later.

## Memory on the dump list

EndoForge spends RAM for speed and gives it back when the machine's memory guard asks. [dump-list.mjs](dump-list.mjs)
(and its Python twin [tools/dump_list.py](../../tools/dump_list.py)) registers a holder file
`${XDG_STATE_HOME:-~/.local/state}/memguard/dump-list.d/<pid>-<name>.json` with schema `memguard-dump/1`, its priority
and its sheddable bytes, and sheds on `SIGUSR2`. Off unless that directory exists or `ENDOFORGE_DUMP_LIST=1`. The pool
(priority 20), the contained cohort (40) and the ledger writer (110) register;
[Workcells](../../docs/architecture/workcells.md#the-dump-list) has what each gives back.

## Capacity planner

[capacity/](capacity/index.mjs) (Mjölnir) picks widths, CPUs and cohorts from a probe of the machine.
`node core/runtime/capacity/cli.mjs probe | plan [--queues=N] [--allotment=CPUS] | share [--ms=N]` prints JSON. The
compatibility route uses it when no width is given; `IsolatePool` defaults to `availableParallelism()`. The
[capacity ICD](../../docs/interfaces/capacity-icd.md) is the interface.

## X1 host port, compiler and generator

- [x1/host.mjs](x1/host.mjs) is the host port for the `current` path: candidates by SHA-256, the nine gates as the
  evaluator's residual check, measurement through [x1/measure.mjs](x1/measure.mjs) and [x1/meter.mjs](x1/meter.mjs).
- [x1/compiler.mjs](x1/compiler.mjs) compiles on the supervisor: `ENDOFORGE_ASC_CMD` (AssemblyScript 0.28.20 `asc`)
  with `--runtime stub -O3 --noAssert --maximumMemory 1024`, a 60 s timeout and bounded output. A killed or
  resource-starved compiler is marked `unavailable`, which the evaluator treats as an unknown outcome.
- [x1/generator.mjs](x1/generator.mjs) runs the two Codex sessions. `ENDOFORGE_CODEX_CMD` (an executable or a JSON
  argv array; a relative path is resolved against the caller's working directory) and `CODEX_HOME` are required; the adapter never reads or copies account files. The executable is trusted
  and Codex enforces its own workspace-write sandbox. CI uses an explicitly labelled
  [fake Codex](test/fixtures/x1/fake-codex.mjs), a test double that supplies no evidence of synthesis quality.
- `ENDOFORGE_CODEX_TERSE=scalar` adds a finite-scalar boundary rule: before the freeze it drops tests with non-numeric
  or non-finite arguments, and `expectError` tests with fractional values at integer-typed parameters; every function
  must keep a value test. `scalar-filter.json` records what was dropped ([P-42](../../experiments/P-42-scalar/PRECOMMIT.md)).

`make loop-test` runs the loop's tests, including kills of the cell, the supervisor and the bridge at each stage;
`make pipeline-test` runs the `current` path's. The gap-closure tests `test/gaps-*.test.mjs` and `test/gaps2-commit.test.mjs` (structured state and its comparison at
commit, commit re-run, library and synthesis on the in-cell paths, judging cell, suspect tests and specification
correction, transports, compatibility promotion, caller principal), `test/gaps3-*.test.mjs` and
`test/gaps4-synth.test.mjs` (structured synthesized vectors at width 1 and 2, and the caller's `synthCell` limits at
commit) run in `make isolate-test`, which first runs
`make loop-setup` (the pinned compiler) and `make tscheck-setup` (the checker), so it works on a fresh clone.
