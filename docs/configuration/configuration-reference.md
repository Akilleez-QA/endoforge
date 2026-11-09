# Configuration reference

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-CFG |
| Version | 2.0 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-08 |
| Baseline commit | 4d692a41853045c4e013405d8e674528745a38b9 |
| Applies to | endoforge main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

Every environment variable, `limits` key and main options object that EndoForge reads, with the default the code
computes. Checked against `main` at `d4d7efa` and re-checked at `4d692a4` (2026-11-08). Where this page and the code disagree, the code is right;
please fix this page.

Conventions:

- A flag such as `=1` is compared as an exact string. `true` or `yes` do not count unless a row says so.
- `Number(x) || d` style reads treat `0`, empty and non-numeric values as unset.
- `~` means the home directory as the code finds it (`os.homedir()`, `Path.home()`).

## Environment variables

### X1 loop and generation

| Variable | Default | Values | Effect | Read in |
|---|---|---|---|---|
| `ENDOFORGE_LOOP` | unset: the current path | `agent`, `isolate` | Which loop `runNeed` drives. See [candidate loop](../architecture/candidate-loop.md#three-loop-paths). | `core/runtime/x1/pipeline.mjs` |
| `ENDOFORGE_CODEX_CMD` | none; required by the generator | Command string, or a JSON argv array when it starts with `[` | The Codex CLI used for generation. | `core/runtime/x1/generator.mjs` |
| `CODEX_HOME` | none; required by the generator | Directory | Passed through to the Codex child. The adapter never reads auth files. | `core/runtime/x1/generator.mjs` |
| `ENDOFORGE_CODEX_TERSE` | `exact` | `exact`, `scalar`, `reference`, `review`, `1`, `fallback`; anything else adds no rule | Prompt rules for generation. `fallback` (pipeline only) runs once with `1`, then retries once with `0` in `<dir>-retry` if not promoted. | `generator.mjs`, `pipeline.mjs` |
| `ENDOFORGE_RETRY_BUDGET_MS` | `Infinity` | Positive ms | Wall budget across both attempts under `fallback`. | `pipeline.mjs` |
| `ENDOFORGE_CODEX_EFFORT` | `auto` | `auto`, `default`, any other string | `auto` gives `low` when the requester's words are at most 400 characters; `default` leaves the client setting; other values pass through as `model_reasoning_effort`. | `generator.mjs` |
| `ENDOFORGE_CODEX_SESSION` | `resume` | `resume`, `packed`, other | `resume` continues the specification thread for implementation; `packed` embeds the frozen files in a fresh implementation prompt; other values do neither. | `generator.mjs` |
| `ENDOFORGE_CODEX_PREFIX` | unset | `stable` | Puts prompt keys in a fixed order. | `generator.mjs` |
| `ENDOFORGE_SELF_CHECK` | off | `1` | Compiles and gates the first candidate and sends one repair turn with the failures. | `generator.mjs` |
| `ENDOFORGE_CODEX_TEST_DOUBLE` | off | `1` | Labels results `testDouble: true`. Changes no behaviour. | `generator.mjs`, `pipeline.mjs`, `loop.mjs` |
| `ENDOFORGE_ASC_CMD` | none; required by the current path | Path to `asc` (AssemblyScript 0.28.20) | Compiler on the supervisor. The `isolate` and `agent` paths use the pinned [tools/asc](../../tools/asc/README.md) instead. | `core/runtime/x1/compiler.mjs` |
| `ENDOFORGE_ASC` | `node_modules/.bin/asc` at the repository root | Path to `asc` | Compiler for `tools/gate/gate.mjs`. | `tools/gate/gate.mjs` |
| `ENDOFORGE_SYNTH` | off | `1` | Turns on evaluator synthesis on the current path. | `core/runtime/x1/synth/stage.mjs` |
| `ENDOFORGE_SYNTH_PROVIDER` | unset: `SpawnClaudeTransport` | Module specifier exporting `createProvider(env)` | Replaces the synthesis model provider. | `synth/stage.mjs` |
| `ENDOFORGE_SYNTH_MODEL` | `sonnet` | Model name | Model for the default synthesis transport. | `synth/stage.mjs` |
| `ENDOFORGE_SYNTH_CONFIG_DIR` | unset | Existing directory | Claude login directory for synthesis. | `synth/stage.mjs` |
| `ENDOFORGE_SYNTH_WIDTH` | `1` | `2` gives 2; anything else gives 1 | Independent need-sheet and binding members. | `synth/stage.mjs` |

### Model transports, usage governor and subscription guard

| Variable | Default | Values | Effect | Read in |
|---|---|---|---|---|
| `ENDOFORGE_USAGE_STATE` | `$XDG_RUNTIME_DIR/endoforge/usage-governor.json`, else the same under `os.tmpdir()` | File path | Shared governor state, one entry per login. `make test` sets it to `.test-work/usage-governor.json`. | `core/runtime/usage-governor.mjs` |
| `ENDOFORGE_USAGE_CEILING` | `0.85` | Number in (0, 1] | Projected utilization at which new `claude -p` calls park. A `ceiling` option wins. | `usage-governor.mjs` |
| `CLAUDE_CODE_RETRY_WATCHDOG` | off | `1` | Turns on Claude Code's retry watchdog in transport children when the `watchdog` option is unset. | `usage-governor.mjs` |
| `CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS` | half the transport timeout, else 900000 | Positive integer below the transport timeout | Watchdog maximum wait passed to the child. | `usage-governor.mjs` |
| `CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS` | 300000 | 60000 to 10800000 | Watchdog recheck interval passed to the child. | `usage-governor.mjs` |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Directory | Login the subscription guard inspects when no `configDir` is given. Transports set it on each child from their own `configDir`. | `core/runtime/subscription-guard.mjs` |

Transport children do not inherit the environment. Only `PATH`, `HOME`, `LANG`, `LC_ALL`, `TERM`, `USER` and the
`XDG_*` directories are copied, then `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` are set.

### Codex account pool

Read by `core/runtime/agent-pool.mjs`. The [runtime README](../../core/runtime/README.md#agent-pool-contract) has the
full contract.

| Variable | Default | Effect |
|---|---|---|
| `CODEX_POOL_STATE_DIR` | `~/.codex-pool` | Slots, cool-downs and the log. |
| `CODEX_POOL_PRIMARY` | `~/.codex` | Primary login, used as account `default` if it holds `auth.json`. |
| `CODEX_POOL_ACCOUNTS_DIR` | `~/.codex-accounts` | More logins, one `<name>/auth.json` each, in sorted order. |
| `CODEX_POOL_PER_ACCOUNT` | `2` | Concurrent launches per account. |
| `CODEX_POOL_WAIT` | `600` seconds | Wait for a slot or a cooled-down account before exit 75. |
| `CODEX_POOL_GUARD` | `none` | Executable run before each launch with `CODEX_POOL_ACCOUNT` set; a non-zero exit aborts with that code. |
| `CODEX_POOL_BIN` | first `codex` on `PATH` that isn't the pool | The real client. None found gives exit 2. |
| `WORKERS_BIN` | unset | Wraps each launch as `<WORKERS_BIN> run --bot <bot> -- ...`. Its spawn-rate refusal reaches the caller as exit 75. |
| `WORKERS_REGISTERED` | unset | `1` skips the wrapper. |
| `CODEX_POOL_BOT`, `WORKER_BOT` | empty | The `--bot` name for `WORKERS_BIN`. |

### Isolate pool and ledger

| Variable | Default | Effect | Read in |
|---|---|---|---|
| `NODE_OPTIONS` | n/a | Must not contain `--max-old-space-size` or `--max-semi-space-size`; the pool constructor refuses heap overrides. | `core/runtime/isolate-pool.mjs` |
| `ENDOFORGE_LEDGER_JOURNAL` | `$XDG_STATE_HOME/endoforge/ledger-journal`, else `~/.local/state/endoforge/ledger-journal` | Ledger writer journal directory. The pool sets it from `ledgerBridge.journal`. | `tools/ledger_writer.py` |
| `ENDOFORGE_LEDGER_STATS` | unset | On shutdown the writer writes a JSON stats report (batches, syncs, rusage) here. | `tools/ledger_writer.py` |
| `ENDOFORGE_DUMP_LIST` | auto | `1` forces dump-list registration on, `0` off; otherwise on only if `<state>/memguard/dump-list.d` exists. `<state>` is `XDG_STATE_HOME` when absolute, else `~/.local/state`. | `core/runtime/dump-list.mjs`, `tools/dump_list.py` |

### Throttle and headroom

Read by `tools/lib/headroom.mjs`, used by the atomizer scheduler and the project scheduler before starting more work.

| Variable | Default | Effect |
|---|---|---|
| `ENDOFORGE_THROTTLE` | on | `0` turns the headroom check off. |
| `ENDOFORGE_MAX_LOAD` | 0.875 × available CPUs | New work waits while the 1-minute load is at or above this. |
| `ENDOFORGE_RESERVE_GB` | max(8, 12% of RAM in GiB) | New work waits while available memory is below this. |

### Atomizer

| Variable | Default | Effect |
|---|---|---|
| `ENDOFORGE_WORKER` | `native` | `codex` turns every model atom into a Codex atom. |
| `ENDOFORGE_CODEX_CONCURRENCY` | `3` with the Codex backend (native default 8) | Concurrent atoms; `--concurrency` wins. |
| `ENDOFORGE_CODEX_POOL` | `core/runtime/agent-pool.mjs` | Codex pool launcher. |
| `ENDOFORGE_TOOLCHAIN_<NAME>` | `policy.toolchain[<name>]` in `tools/atomizer/policy.json` | Host path of a toolchain mounted into atoms; `<NAME>` is upper-cased with non-alphanumerics as `_`. |
| `ENDOFORGE_CLAUDE_ACCOUNTS` | `~/.claude-accts` | Directory of Claude logins; `claude` atoms rotate through them. Also read by hillclimb. |
| `ENDOFORGE_CREDENTIAL_HOME` | unset | With no account pool, credential files are copied from this approved home template. |
| `ATOMIZER_LEDGER_DIR` | `tools/atomizer/ledger` | Atomizer ledger. Set it outside the source tree. |
| `ENDOFORGE_TRACE` | on | `0` turns off `trace.jsonl`. |
| `ENDOFORGE_STUB_REPLAY`, `ENDOFORGE_STUB_LATENCY_MS` | latency `0` | Stub Codex pool (`core/runtime/stub-pool.mjs`) that replays recorded atom outputs. |

`ENDOFORGE_ISOLATE_SPEC` and `ENDOFORGE_ISOLATE_TRACE` are internal plumbing between the atomizer and its bubblewrap
trampoline.

### Conductor, job, hillclimb and project scheduler

| Variable | Default | Effect | Read in |
|---|---|---|---|
| `ENDOFORGE_SYSTEMCTL` | `systemctl` | Command used to poll launched user units. | `tools/conductor/lib/launch.mjs` |
| `WORKER_STATE_DIR` | `$XDG_STATE_HOME/workers`, else `~/.local/state/workers` | Capacity dial: a `DRAIN` file means 0%; `CAPACITY` holds 0 to 100; else 100%. | `tools/hillclimb/lib/fanout.mjs` |
| `ENDOFORGE_NOTIFY` | on | `none` stops job events calling `notify-send`. | `tools/job/lib/events.mjs` |
| `ENDOFORGE_EVENT_HOOKS` | none | Colon-separated executables that receive every job event as JSON on stdin. | `events.mjs` |
| `ENDOFORGE_PUSH_HOOKS` | none | Same, for `FIRED`, `GATE`, `NEEDS-YOU` and `DONE` only. | `events.mjs` |
| `ENDOFORGE_COORDINATOR_HOOKS` | none | Same, for `NEEDS-COORDINATOR` only. | `events.mjs` |
| `ENDOFORGE_JOB_KINDS` | only `tools/job/kinds` | Colon-separated directories of extra job-kind files. | `tools/job/lib/kinds.mjs` |
| `ENDOFORGE_JOBS` | `./jobs` | Colon-separated roots searched for earlier jobs' lessons. | `tools/job/lib/lessons.mjs` |
| `ENDOFORGE_VOLATILE` | `/tmp:/var/tmp:/dev/shm:/run/user` | Paths job validation treats as volatile. | `tools/job/lib/validate.mjs` |
| `ENDOFORGE_GPU_QUEUE` | none | Python GPU-queue script; required for GPU pieces. | `tools/project-scheduler/scheduler.mjs` |

### Kernel, runtime and build tools

| Variable | Default | Effect | Read in |
|---|---|---|---|
| `WASM_TOOLS` | `wasm-tools` on `PATH` | Binary for component checks; `make tools` installs the pinned 1.262.0 in `.tools/bin`. | `tools/kernel/contract.py`, `install_tools.py` |
| `ENDOFORGE_WASMTIME` | `wasmtime` | Wasmtime binary for factory-runtime runs. | `tools/factory_runtime/wasm.py` |
| `ENDOFORGE_WASMTIME_SHA256` | none; required | Must equal that binary's SHA-256. | `wasm.py` |
| `ENDOFORGE_WORKER_IMAGE` | empty | Container image for the factory runner. | `tools/factory_runtime/runner.py` |
| `RUSTC`, `CARGO` | `rustc`, `cargo` on `PATH` | Rust lane toolchain. | `tools/rust_lane/build.py` |
| `CARGO_HOME` | none; required | Cargo cache for the Rust lane. | `build.py` |
| `XDG_CONFIG_HOME` | `~/.config` | job-locks registry is `<config>/job-locks/active.json`. | `tools/job-locks/job-locks.py` |

### Refused and stripped variables

The [subscription guard](../../core/runtime/README.md#the-agent-loop-in-the-workcell) keeps model calls on a claude.ai
subscription login. These are not settings:

- **Refused** in the launch environment, with `SubscriptionRefused` (exit 78): `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_FOUNDRY_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `CLAUDE_CODE_USE_BEDROCK`,
  `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `ANTHROPIC_PROFILE`, `ANTHROPIC_FEDERATION_RULE_ID`, and
  `CLAUDE_CODE_SIMPLE` when on (anything but empty, `0`, `false`, `no`, `off`). The same names, and key helpers, are
  refused in settings files' `env` blocks.
- **Stripped** from every Claude child: the refused list plus every `ANTHROPIC_*`, `CLAUDE_CODE_USE_*`,
  `CLAUDE_CODE_OAUTH_*`, `CLAUDE_CODE_SKIP_*` and `CLAUDE_CODE_API_KEY*` name.
- **Refused in a transport's `environment` option**: names matching `ANTHROPIC_`, `API_KEY`, `AUTH_TOKEN`,
  `OAUTH_TOKEN`, `CLAUDE_CODE_USE_`, `AWS_`, `GOOGLE_` or `VERTEX_`.

### Set for children only

Not read as configuration: `ENDOFORGE_JOB`, `ENDOFORGE_PROMPTS`, `ENDOFORGE_PROJECT`, `ENDOFORGE_PIECE`,
`ENDOFORGE_TOKEN_BUDGET`, `ENDOFORGE_RESULTS`, `ENDOFORGE_EVENT_KIND`, `ENDOFORGE_EVENT_PUSH`, `CODEX_POOL_ACCOUNT`,
`CODEX_POOL_TIER`, `CODEX_POOL_THROWAWAY`, `WORKERS_ALLOW_UNREGISTERED`.

Test-only names, read by tests and fake doubles: `FAKE_CLAUDE_*`, `FAKE_CODEX_*`, `EF_*`, `P22_*`,
`ENDOFORGE_LOAD_GUARD`, `ENDOFORGE_LOAD_THRESHOLD`, `ENDOFORGE_TEST_OUTPUT`.

## X1 agent `limits`

Passed as `attemptAgent({ limits })` or `runNeed({ limits })` on the agent path. Default
`agentLimits = { maxTurns: 6, maxTokens: 64000 }` in `core/runtime/x1/loop.mjs`. Values are not validated.

| Key | Default | Effect |
|---|---|---|
| `maxTurns` | `6` | Turns per agent stage (specification, then implementation) before exit `max_turns`. The host refuses any model call after `2 × maxTurns` calls. |
| `maxTokens` | `64000` | Token budget for the whole job. The remainder is passed to the provider; reaching it ends with `max_tokens`. |
| `oracle` | off | When truthy, the specification stage may write `reference.js`, and `tests.json` is checked against the contract's formula, ranges and the reference before the freeze. Each test becomes `verified`, `corrected`, `flagged`, `unverified` or `abstained`; flagged tests go back to the model, corrected values are frozen, and the result carries an `oracle` report. P-69, P-70 and P-71 left it off by default; it may change. |

Fixed: 64 KiB per file, four times that per reply, 16 calls per reply (`core/runtime/x1/agent.mjs`).

## Options objects

### `createLoopPool(options)` (`core/runtime/x1/loop.mjs`)

| Option | Default | Effect |
|---|---|---|
| `size` | `1` | Workcells. |
| `isolation` | `process` | `thread` or `process`. Process cells run under Node's permission model with read-only grants. |
| `jobTimeoutMs` | `60000` | Compute budget per job; starts when the cell is warm and pauses during host calls. |
| `jobDeadlineMs` | `900000` | Hard wall deadline per job. |
| `provider` | none | Model provider; required for the agent path. |
| `waits` | `release` | `release` frees the cell while a model call is pending; `hold` keeps it. |
| `rates` | `null` | A `createStageRates` object to record per-stage timings. |
| `cellEnv` | `{}` | Environment for process cells. The default gives them an empty environment. |
| `primes` | unset | Passed to the cell's warm step. |
| `ascPath`, `hostPort` | the pinned `tools/asc` compiler; `x1/loop-port.mjs` | Compiler module and cell port. |
| others | | Passed to `IsolatePool`. The pinned compiler's limits (`wasmMemoryMaxMb: 4096`, 1024/32 MiB heap, its trusted modules) apply unless overridden. |

Per call, `attemptInIsolate` and `evaluateAndCommit` take `repair: { module, maxRounds, options }`.

### `new IsolatePool(options)` (`core/runtime/isolate-pool.mjs`)

| Option | Default | Effect |
|---|---|---|
| `hostPort` | required | Module each cell imports; exports `createPort(options)`. |
| `size` | `os.availableParallelism()` | Workcells. |
| `isolation` | `thread` | `thread` or `process`. |
| `resourceLimits` | `{ maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 }` | Per-cell V8 heap; optional `stackSizeMb`. |
| `wasmMemoryMaxMb` | `64` | Ceiling per WebAssembly memory, 1 to 4096. |
| `trustedWasmModules` | `[]` | `{ name, sha256, maximumPages }` entries that may omit a memory maximum. |
| `sharedWasmModules` | `[]` | `{ sha256, path }`; thread pools compile once and share. |
| `prewarm` | `false` | Start every cell in the constructor. |
| `warm`, `warmTimeoutMs` | unset, `60000` | Await the port's `warm(options)` before a cell is ready. |
| `jobTimeoutMs`, `jobDeadlineMs` | unset | Compute budget and wall deadline per job. |
| `retireAfterJobs` | `256` | Replace a cell after this many jobs. |
| `cgroupRoot`, `cgroupLimits` | own cgroup; `memoryMax` max(256, old + 3 × young + 128) MiB, `cpuMax: '100000 100000'`, `pidsMax: 64` | Process mode only. |
| `ledgerBridge` | unset | `{ extension, restart = false, journal }` for the persistent ledger bridge. |
| `dumpList` | auto | `false`, `true` or `{ name, priority, floor, holdMs, intervalMs, settleMs, directory }`; pool defaults: priority 20, floor 1, hold 30 s. |
| `rates` | `null` | Stage-rates object. |

The [ledger ICD](../interfaces/ledger-icd.md#v8-workcell-pool-interface) defines every field and failure state.

### Contained JavaScript (`core/runtime/contained/runner.mjs`)

`createContainedRunner` defaults: `width` 1, `maxWidth` = width, `spare` = width, `heapMb` 64, `youngMb` 8, `stackMb` 2,
`deadlineMs` 1000, `outputMaxBytes` 1 MiB, `stuckMs` 1500, `reuse` true, `harden` true, `affinity` none.
`prepare.layout` defaults to `sibling` with `checkDeadlineMs` 10000. `dumpList` defaults: name `endoforge-cohort`,
priority 40, floor 1, hold 30 s. `createContainedPool({ width })` runs one process per cell.

### Claude transports (`core/runtime/x1/transports.mjs`)

| Option | Default | Effect |
|---|---|---|
| `model` | none | Passed to `--model`. Always set it. |
| `timeoutMs` | `300000` | Per-turn timeout. |
| `instances` (warm) | `[{ name: 'default' }]` | `{ name, configDir, lanes = 1 }`; one long-lived `claude -p` per lane. |
| `configDir` (spawn) | unset | Login directory; must exist. |
| `queueTimeoutMs` (warm) | `timeoutMs` | Wait for a free lane; when every login is parked past this, fail at once with `UsageParked`. |
| `idleMs` (warm) | `300000` | Idle lane lifetime. |
| `governor` | a governor per login | `null` turns governing off. The warm transport ignores a custom governor object. |
| `usageState` | `ENDOFORGE_USAGE_STATE` default | Governor state file. |
| `watchdog` | from `CLAUDE_CODE_RETRY_WATCHDOG` | `true`, `false` or `{ maxWaitMs, recheckMs }`. |
| `effort`, `system`, `cwd`, `command`, `base`, `environment` | none, built-in prompt, temp dir, `claude`, `process.env`, `{}` | |

### Usage governor (`core/runtime/usage-governor.mjs`)

`new UsageGovernor({ scope = 'default', ceiling, statePath, perCallPrior = 0.001 })`. A call parks when
`utilization + (inFlight + 1) × perCall >= ceiling`, when the last status is `allowed_warning` or `rejected`, or when
the login draws on usage credits. `UsageParked` has `code: 'USAGE_PARKED'`, exit code 75, `outcome: 'outcome_unknown'`
and `resumeAt`. Windows are kept 8 days.

### Capacity planner (`core/runtime/capacity/`)

```sh
node core/runtime/capacity/cli.mjs probe
node core/runtime/capacity/cli.mjs plan --queues=2 --allotment=16
node core/runtime/capacity/cli.mjs share --ms=1000
```

Output is one JSON line with `interface: 1`. Flags take the `--name=value` form; a bad flag prints usage and exits 2.
`plan({ queues = 1, allotment, policy = POLICY })`; `POLICY` is
`{ mode: 'fixed', width: 'cores', perDomain: 1, headroom: 1.25 }`. `TUNED_POLICY` adds the occupancy-capped tuner.
The [capacity ICD](../interfaces/capacity-icd.md) has every record, rule and default.

### Stage rates (`core/runtime/stage-rates.mjs`)

`createStageRates({ stages, slots = 16384, recent = 2048, history = 900, tickMs = 1000 })`. `view({ windowMs = 5000 })`
returns per-stage rates, utilisation, queue and a bottleneck verdict; `publish(path)` writes it every second.
`node tools/stage-rates.mjs <snapshot.json> [--watch] [--json]` prints it.

### Kernel limits (`tools/kernel/limits.py`)

`fuel` 100000 (1 to 10,000,000), `memory_bytes` 16 MiB, `output_bytes` 1 MiB, `wall_seconds` 5.0 (0.01 to 60). Pinned
Wasmtime 49.0.0 and wasm-tools 1.262.0.

## Makefile variables

| Variable | Default | Effect |
|---|---|---|
| `PYTHON` | `python3` | Interpreter; `test-optimized` reruns `test` with `-O`. |
| `ENDOFORGE_TEST_OUTPUT` | `.test-work` in the checkout | Test scratch root. Override on the make command line (`make test ENDOFORGE_TEST_OUTPUT=...`); an environment variable does not override it. |
| `ENDOFORGE_USAGE_STATE` | `.test-work/usage-governor.json` | Keeps test governors off the shared state file. Same override rule. |
| `TOOLS_DIR` | `.tools` | Where `make tools` installs the kernel test tools. |
| `WORK`, `TSC` | empty | Required by `make tscheck-requalify`. |

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | before 2026-11-08 | — | Written in PR #129 at `d4d7efa` | earlier PRs |
| 2.0 | 2026-11-08 | `4d692a4` | Metadata header and change history added; content re-baselined | this PR |
