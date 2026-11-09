# Configuration reference

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-CFG |
| Version | 3.2 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-09 |
| Baseline commit | 63e95c79afb282a7fcae4decd57d2e7ed6cf0d40 |
| Applies to | endoforge main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

Every setting EndoForge reads: environment variables, the agent loop's `limits`, the options of the main entry points,
the job and atomizer settings, and the Makefile variables. Each default is the one the code computes, read from the
code at the baseline commit. If this page and the code disagree, the code is right; please fix this page.
`make check` fails when the code reads an environment variable that is not on this page.

How to read the tables:

- A flag such as `=1` is compared as an exact string. `true` or `yes` do not count unless a row says so.
- Where the code reads `Number(x) || default`, a value of `0`, empty or non-numeric counts as unset.
- `~` is the home directory as the code finds it (`os.homedir()`, `Path.home()`).

## The settings you are most likely to need

| To | Set |
|---|---|
| Run the agent loop in a workcell | `runNeed({ env: { ENDOFORGE_LOOP: 'agent' } })` with `createLoopPool({ provider })` |
| Use Claude Code as the agent | `new WarmClaudeTransport({ model, effort, instances })` as the provider; a claude.ai subscription login |
| Use Codex as the generator | `ENDOFORGE_LOOP=isolate`, `ENDOFORGE_CODEX_CMD=codex`, `CODEX_HOME=~/.codex` |
| Rotate over several Codex logins | `ENDOFORGE_CODEX_CMD` set to `["node","<absolute path>/core/runtime/agent-pool.mjs"]`, logins under `~/.codex-accounts` |
| Give the agent more room | `runNeed({ limits: { maxTurns, maxTokens } })` |
| Run more needs at once | `createLoopPool({ size })` |
| Add a second, independent evaluator | `ENDOFORGE_SYNTH=1` (any path) |
| Reuse promoted kernels | `runNeed({ library: await openLibrary({ journal }) })` (any path) |
| Promote a TypeScript candidate in the compatibility lane | `route.freeze(...)`, then `route.promote(candidate, { ledger, frozen })` on `createContainedRoute()` |
| Keep test output out of the checkout | `make test ENDOFORGE_TEST_OUTPUT="$(mktemp -d)"` |

## Environment variables

### X1 loop and generation

| Variable | Default | Values | Effect | Read in |
|---|---|---|---|---|
| `ENDOFORGE_LOOP` | unset: the current path | `agent`, `isolate` | Which loop `runNeed` drives. `agent`: the whole agent loop in a workcell. `isolate`: Codex generates on the host, checks and commit run in a workcell. Unset: Codex generates and the compiler runs on the host, gates run in a workcell. | `core/runtime/x1/pipeline.mjs` |
| `ENDOFORGE_CODEX_CMD` | none; required on the `isolate` and current paths | A command, or a JSON argv array when it starts with `[` | The Codex CLI the generator runs as `<cmd> exec --json --skip-git-repo-check --sandbox workspace-write -`, in the need's `candidate/` directory. A relative path (the command itself when it contains `/`, or any `./` or `../` entry of the JSON argv) is resolved against the caller's working directory first; a bare name is looked up on `PATH`. | `core/runtime/x1/generator.mjs` |
| `CODEX_HOME` | none; required with `ENDOFORGE_CODEX_CMD` | Directory | Passed to the Codex child, which reads its login there. EndoForge never reads the auth file. | `generator.mjs` |
| `ENDOFORGE_CODEX_TERSE` | `exact` | `exact`, `scalar`, `reference`, `review`, `1`, `fallback`; any other value adds no rule | Extra prompt rules. `exact` asks for one edit and derived expectations; `scalar` also limits exports to finite numbers; `reference` has the model write `reference.js`, from which expectations are filled; `review` asks for a silent self-check; `1` asks for one edit. `fallback` (read by `runNeed`) runs once with `1`, then once more with `0` in `<directory>-retry` if not promoted. | `generator.mjs`, `pipeline.mjs` |
| `ENDOFORGE_RETRY_BUDGET_MS` | `Infinity` | Positive milliseconds | Wall budget across both attempts under `fallback`. | `pipeline.mjs` |
| `ENDOFORGE_CODEX_EFFORT` | `auto` | `auto`, `default`, any other string | `auto` gives `low` when the requester's words are at most 400 characters, else the client default; `default` leaves the client setting; any other value is passed as `model_reasoning_effort`. | `generator.mjs` |
| `ENDOFORGE_CODEX_SESSION` | `resume` | `resume`, `packed`, other | `resume` continues the specification thread for implementation; `packed` sends the frozen files in a fresh implementation prompt; other values do neither. | `generator.mjs` |
| `ENDOFORGE_CODEX_PREFIX` | unset | `stable` | Puts prompt keys in a fixed order, so a prompt cache can reuse the prefix. | `generator.mjs` |
| `ENDOFORGE_SELF_CHECK` | off | `1` | Compiles and gates the first candidate and sends one repair turn with the failures. | `generator.mjs` |
| `ENDOFORGE_CODEX_TEST_DOUBLE` | off | `1` | Labels results `testDouble: true`. Changes no behaviour. | `generator.mjs`, `loop.mjs` |
| `ENDOFORGE_ASC_CMD` | none; required on the current path | Path to `asc` (AssemblyScript 0.28.20) | The compiler on the host. The `isolate` and `agent` paths use the pinned [tools/asc](../../tools/asc/README.md) inside the workcell instead. | `core/runtime/x1/compiler.mjs`, `pipeline.mjs` |
| `ENDOFORGE_ASC` | `node_modules/.bin/asc` at the repository root | Path to `asc` | The compiler for `tools/gate/gate.mjs`. | `tools/gate/gate.mjs` |
| `ENDOFORGE_SYNTH` | off | `1` | Turns on [evaluator synthesis](../guides/how-to/turn-on-evaluator-synthesis.md) on every loop path. | `core/runtime/x1/synth/stage.mjs` |
| `ENDOFORGE_SYNTH_PROVIDER` | unset: a `SpawnClaudeTransport` | Module specifier that exports `createProvider(env)` | Replaces the synthesis model provider. | `synth/stage.mjs` |
| `ENDOFORGE_SYNTH_MODEL` | `sonnet` | Model name | Model for the default synthesis transport. | `synth/stage.mjs` |
| `ENDOFORGE_SYNTH_CONFIG_DIR` | unset: the subscription guard's default login | Existing directory | Claude login directory for synthesis. | `synth/stage.mjs` |
| `ENDOFORGE_SYNTH_WIDTH` | `1` | `2` gives 2; anything else gives 1 | Independent evaluator members; with 2, only checks both agree on are kept. | `synth/stage.mjs` |

### Model transports, usage governor and subscription guard

| Variable | Default | Values | Effect | Read in |
|---|---|---|---|---|
| `ENDOFORGE_USAGE_STATE` | `$XDG_RUNTIME_DIR/endoforge/usage-governor.json`, else the same under `os.tmpdir()` | File path | Shared governor state, one entry per login. `make test` sets it to `.test-work/usage-governor.json`. | `core/runtime/usage-governor.mjs` |
| `XDG_RUNTIME_DIR` | unset | Directory | Base of the default `ENDOFORGE_USAGE_STATE`. Also copied into transport children. | `usage-governor.mjs`, `transports.mjs` |
| `ENDOFORGE_USAGE_CEILING` | `0.85` | Number in (0, 1] | Projected utilization at which new `claude -p` calls park. A `ceiling` option wins. | `usage-governor.mjs` |
| `CLAUDE_CODE_RETRY_WATCHDOG` | off | `1` | Turns on Claude Code's retry watchdog in transport children when the `watchdog` option is unset. | `usage-governor.mjs` |
| `CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS` | half the transport timeout, else 900000 | Positive integer below the transport timeout | Watchdog maximum wait passed to the child. | `usage-governor.mjs` |
| `CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS` | 300000 | 60000 to 10800000 | Watchdog recheck interval passed to the child. | `usage-governor.mjs` |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Directory | Login the subscription guard inspects when no `configDir` is given. Transports set it on each child from their own `configDir`. | `core/runtime/subscription-guard.mjs`, `transports.mjs` |

Transport children do not inherit the environment. Only `PATH`, `HOME`, `LANG`, `LC_ALL`, `TERM`, `USER`,
`XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `XDG_DATA_HOME` are copied, then `CLAUDE_CONFIG_DIR` and
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` are set.

### Refused and stripped variables

The subscription guard keeps every `claude -p` launch on a claude.ai subscription login (Pro, Max or Team). These
are not settings:

- **Refused** in the launch environment, with `SubscriptionRefused` (exit 78): `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_FOUNDRY_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `CLAUDE_CODE_USE_BEDROCK`,
  `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `ANTHROPIC_PROFILE`, `ANTHROPIC_FEDERATION_RULE_ID`, and
  `CLAUDE_CODE_SIMPLE` when on (anything but empty, `0`, `false`, `no`, `off`). The same names, and key helpers such
  as `apiKeyHelper`, are refused in settings files' `env` blocks. `--bare` is refused as an argument.
- **Refused as a login**: no `.credentials.json` in the login directory, no `user:inference` scope, a subscription
  type other than `max`, `pro` or `team`, or an account file that stores an API key or a non-subscription billing type.
- **Stripped** from every Claude child: the refused list plus every `ANTHROPIC_*`, `CLAUDE_CODE_USE_*`,
  `CLAUDE_CODE_OAUTH_*`, `CLAUDE_CODE_SKIP_*` and `CLAUDE_CODE_API_KEY*` name.
- **Refused in a transport's `environment` option**: names matching `ANTHROPIC_`, `API_KEY`, `AUTH_TOKEN`,
  `OAUTH_TOKEN`, `CLAUDE_CODE_USE_`, `AWS_`, `GOOGLE_` or `VERTEX_`.

### Codex account pool

Read by `core/runtime/agent-pool.mjs`, a drop-in for `codex` that runs the real client with the next free login's
`CODEX_HOME` and cools a login down when its output reports a rate limit. The
[runtime README](../../core/runtime/README.md) has the full contract.

| Variable | Default | Effect |
|---|---|---|
| `CODEX_POOL_STATE_DIR` | `~/.codex-pool` | Slots, cool-downs and the `log`. |
| `CODEX_POOL_PRIMARY` | `~/.codex` | Primary login, used as account `default` if it holds `auth.json`. |
| `CODEX_POOL_ACCOUNTS_DIR` | `~/.codex-accounts` | More logins, one `<name>/auth.json` each, in sorted order. |
| `CODEX_POOL_PER_ACCOUNT` | `2` | Concurrent launches per login. |
| `CODEX_POOL_WAIT` | `600` seconds | Wait for a slot or a cooled-down login before exit 75. |
| `CODEX_POOL_GUARD` | `none` | Executable run before each launch with `CODEX_POOL_ACCOUNT` set; a non-zero exit aborts with that code. |
| `CODEX_POOL_BIN` | the first `codex` on `PATH` | The real client. None found gives exit 2. |
| `WORKERS_BIN` | unset | Wraps each launch as `<WORKERS_BIN> run --bot <bot> -- ...`. Its spawn-rate refusal reaches the caller as exit 75. |
| `WORKERS_REGISTERED` | unset | `1` skips the wrapper. |
| `CODEX_POOL_BOT`, `WORKER_BOT` | empty | The `--bot` name for `WORKERS_BIN`. |

The hillclimb and Conductor login discovery reads `CODEX_POOL_PRIMARY` and `CODEX_POOL_ACCOUNTS_DIR` with the same
defaults.

### Isolate pool and ledger

| Variable | Default | Effect | Read in |
|---|---|---|---|
| `NODE_OPTIONS` | n/a | Must not contain `--max-old-space-size` or `--max-semi-space-size`; the pool constructor refuses heap overrides. | `core/runtime/isolate-pool.mjs` |
| `ENDOFORGE_LEDGER_JOURNAL` | `$XDG_STATE_HOME/endoforge/ledger-journal`, else `~/.local/state/endoforge/ledger-journal` | Ledger writer journal directory. The pool sets it from `ledgerBridge.journal`. | `tools/ledger_writer.py` |
| `ENDOFORGE_LEDGER_STATS` | unset | On shutdown the writer writes a JSON stats report (batches, syncs, resource usage) to this path. | `tools/ledger_writer.py` |
| `ENDOFORGE_DUMP_LIST` | auto | `1` forces dump-list registration on, `0` off; otherwise on only if `<state>/memguard/dump-list.d` exists. | `core/runtime/dump-list.mjs`, `tools/dump_list.py` |
| `XDG_STATE_HOME` | `~/.local/state` | `<state>` above (the JavaScript side uses it only when absolute), and the base of the ledger journal and `WORKER_STATE_DIR` defaults. | `dump-list.mjs`, `dump_list.py`, `ledger_writer.py`, `tools/hillclimb/lib/fanout.mjs` |

### Throttle and headroom

Read by `tools/lib/headroom.mjs`, which the atomizer scheduler and the project scheduler consult before starting
more work.

| Variable | Default | Effect |
|---|---|---|
| `ENDOFORGE_THROTTLE` | on | `0` turns the headroom check off. |
| `ENDOFORGE_MAX_LOAD` | 0.875 × available CPUs | New work waits while the 1-minute load is at or above this. |
| `ENDOFORGE_RESERVE_GB` | max(8, 12% of RAM in GiB) | New work waits while available memory is below this. |

### Atomizer

| Variable | Default | Effect |
|---|---|---|
| `ENDOFORGE_WORKER` | `policy.workerBackend`, else `native` | `codex` turns every model atom into a Codex atom. |
| `ENDOFORGE_CODEX_CONCURRENCY` | `3` with the Codex backend (otherwise 8) | Concurrent atoms; `--concurrency` wins. |
| `ENDOFORGE_CODEX_POOL` | `core/runtime/agent-pool.mjs` | Codex pool launcher for Codex atoms. |
| `ENDOFORGE_TOOLCHAIN_<NAME>` | `policy.toolchain[<name>]` in `tools/atomizer/policy.json` | Host path of a toolchain mounted into atoms; `<NAME>` is the name upper-cased with non-alphanumerics as `_`, for example `ENDOFORGE_TOOLCHAIN_CODEX`. |
| `ENDOFORGE_CLAUDE_ACCOUNTS` | `~/.claude-accts` | Directory of Claude logins, one per subdirectory with `.credentials.json`; `claude` atoms rotate through them. Also read by hillclimb and Conductor login discovery. |
| `ENDOFORGE_CREDENTIAL_HOME` | unset | With no Claude logins, credential files are copied from this approved home template into the atom's home. |
| `ATOMIZER_LEDGER_DIR` | `tools/atomizer/ledger` | Atomizer ledger. Set it outside the source tree. |
| `ENDOFORGE_TRACE` | on | `0` turns off `trace.jsonl`. |
| `ENDOFORGE_STUB_REPLAY` | unset | Directory of recorded atom outputs for the stub Codex pool (`core/runtime/stub-pool.mjs`). |
| `ENDOFORGE_STUB_LATENCY_MS` | `0` | Delay the stub pool adds per launch. |

`ENDOFORGE_ISOLATE_SPEC` and `ENDOFORGE_ISOLATE_TRACE` are internal plumbing between the atomizer and its bubblewrap
trampoline.

### Job, Conductor, hillclimb and project scheduler

| Variable | Default | Effect | Read in |
|---|---|---|---|
| `ENDOFORGE_SYSTEMCTL` | `systemctl` | Command the Conductor uses to see whether a launched user unit has ended. | `tools/conductor/lib/launch.mjs` |
| `WORKER_STATE_DIR` | `$XDG_STATE_HOME/workers`, else `~/.local/state/workers` | Capacity dial: a `DRAIN` file means 0%; `CAPACITY` holds 0 to 100; else 100%. | `tools/hillclimb/lib/fanout.mjs` |
| `ENDOFORGE_NOTIFY` | on | `none` stops job events calling `notify-send`. | `tools/job/lib/events.mjs` |
| `ENDOFORGE_EVENT_HOOKS` | none | Colon-separated executables that receive every job event as JSON on stdin. | `events.mjs` |
| `ENDOFORGE_PUSH_HOOKS` | none | The same, for `FIRED`, `GATE`, `NEEDS-YOU` and `DONE` only. | `events.mjs` |
| `ENDOFORGE_COORDINATOR_HOOKS` | none | The same, for `NEEDS-COORDINATOR` only. | `events.mjs` |
| `ENDOFORGE_JOB_KINDS` | only `tools/job/kinds` | Colon-separated directories of extra job-kind files. | `tools/job/lib/kinds.mjs` |
| `ENDOFORGE_JOBS` | `./jobs` | Colon-separated roots searched for earlier jobs' lessons. | `tools/job/lib/lessons.mjs` |
| `ENDOFORGE_VOLATILE` | `/tmp:/var/tmp:/dev/shm:/run/user` | Colon-separated paths job validation treats as volatile, not durable disk. | `tools/job/lib/validate.mjs` |
| `ENDOFORGE_GPU_QUEUE` | none | Python GPU-queue script; required for GPU pieces. | `tools/project-scheduler/scheduler.mjs` |
| `HC_WORK` | `/work` | Working directory of `tools/hillclimb/scripts/hc-patch.sh` (`<work>/base` and `<work>/edit`). | `hc-patch.sh` |

### Kernel, runtime and build tools

| Variable | Default | Effect | Read in |
|---|---|---|---|
| `WASM_TOOLS` | `wasm-tools` on `PATH` | Binary for component checks; `make tools` installs the pinned 1.262.0 in `.tools/bin`. | `tools/kernel/contract.py`, `tools/kernel/install_tools.py` |
| `ENDOFORGE_WASMTIME` | `wasmtime` | Wasmtime binary for factory-runtime runs. | `tools/factory_runtime/wasm.py` |
| `ENDOFORGE_WASMTIME_SHA256` | none; required | Must equal that binary's SHA-256. | `wasm.py` |
| `ENDOFORGE_WORKER_IMAGE` | empty; required by the runner | Qualified container image digest for the factory runner. | `tools/factory_runtime/runner.py` |
| `RUSTC`, `CARGO` | `rustc`, `cargo` on `PATH` | Rust lane toolchain. | `tools/rust_lane/build.py` |
| `CARGO_HOME` | none; required | Cargo cache for the Rust lane. The build sets `CARGO_TARGET_DIR` and `RUSTFLAGS` itself. | `build.py` |
| `XDG_CONFIG_HOME` | `~/.config` | The job-locks registry is `<config>/job-locks/active.json`. Also copied into transport children. | `tools/job-locks/job-locks.py` |

### Set for children only

Not read as configuration: `ENDOFORGE_JOB`, `ENDOFORGE_PROMPTS`, `ENDOFORGE_PROJECT`, `ENDOFORGE_PIECE`,
`ENDOFORGE_TOKEN_BUDGET`, `ENDOFORGE_RESULTS`, `ENDOFORGE_EVENT_KIND`, `ENDOFORGE_EVENT_PUSH`, `CODEX_POOL_ACCOUNT`,
`CODEX_POOL_TIER`, `CODEX_POOL_THROWAWAY`, `WORKERS_ALLOW_UNREGISTERED`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.

Test-only names, read by tests and test doubles: `FAKE_CLAUDE_*`, `FAKE_CODEX_*`, `EF_*`, `P22_*`,
`ENDOFORGE_LOAD_GUARD`, `ENDOFORGE_LOAD_THRESHOLD`, `ENDOFORGE_TEST_OUTPUT`.

## X1 agent `limits`

Passed as `runNeed({ limits })` on the agent path. The default is `agentLimits = { maxTurns: 6, maxTokens: 64000 }`
in `core/runtime/x1/loop.mjs`. Values are not validated.

| Key | Default | Effect |
|---|---|---|
| `maxTurns` | `6` | Turns per stage (specification, then implementation) before exit `max_turns`. The host refuses any model call after `2 × maxTurns` calls. |
| `maxTokens` | `64000` | Token budget per stage (`tokenBudget = 'stage'` in `loop.mjs`): the specification and the implementation each get it, counted from each reply's `usage`. The stage's remainder is passed to the provider; reaching it ends the stage with `max_tokens`. |
| `oracle` | off | When truthy, the specification stage may also write `reference.js`, and `tests.json` is checked against the contract's formula, ranges and the reference before the freeze. Each test becomes `verified`, `corrected`, `flagged`, `unverified` or `abstained`; flagged tests go back to the model, corrected values are frozen, and the result carries an `oracle` report. Off by default after P-69, P-70 and P-71. |

Fixed limits in `core/runtime/x1/agent.mjs`: 64 KiB per file, four times that per reply, 16 calls per reply.

## Options objects

### `runNeed(options)` (`core/runtime/x1/pipeline.mjs`)

| Option | Paths | Default | Effect |
|---|---|---|---|
| `need` | all | required | The request, a non-empty string. |
| `directory` | all | required | Where the ledger (`ledger.sqlite`) goes. Its last segment is the candidate id. The current and `isolate` paths create it and refuse an existing one. |
| `pool` | all | required | `createLoopPool()` for `agent` and `isolate`; an `IsolatePool` with `hostPort` `core/runtime/x1/host.mjs` for the current path. |
| `env` | all | `process.env` | Selects the path and supplies the `ENDOFORGE_*` settings above. |
| `deadline` | all | `Infinity` | Absolute time in ms since the epoch; no model turn starts after it. |
| `observe` | all | none | Called with stage names (`need`, `model`, `admitted`, `committing`, `returned` and others) as the need moves. |
| `limits` | agent | `agentLimits` | See [above](#x1-agent-limits). |
| `resume` | agent | `false` | Resume from the ledger. An existing ledger in `directory` resumes anyway. |
| `repair` | isolate | none | `{ module, maxRounds, options }`: repair rounds inside the cell. |
| `compiler` | current | `ENDOFORGE_ASC_CMD` | Path to `asc`. |
| `library` | all | none | A library from `openLibrary`, consulted once the specification is frozen; a pass skips implementation. See [below](#openlibraryoptions-corelibrarylibrarymjs). |
| `principal` | all | the library's own (`openLibrary({ principal })`) | `{ tenant, lineage }` passed to every `library.serve`, so the library's scopes apply to this caller. |
| `synthProvider`, `confirm` | all | `createProvider(env)`, none | Evaluator synthesis provider and confirmation callback (with `ENDOFORGE_SYNTH=1`). |
| `suspect` | all | none | Called with the `suspect_frozen_tests` report when synthesis finds suspect frozen tests. The pipeline also freezes a [specification correction](../architecture/evaluator-synthesis.md#4b-acting-on-suspects-a-specification-correction) from it whether or not this is given; the result then carries `revision` and `suspects`. |
| `containedRoute` | all | none | A compatibility-lane route. With only `check`, its report after the kernel decision is returned as `contained`. With `freeze` and `promote` (`createContainedRoute()`), its tests are frozen into `<directory>/compatibility.sqlite` before any candidate, and `route.promote` decides the candidate's TypeScript (decision file `<directory>/compatibility-promotion.json`), returned as `compatibility`. Never changes `promoted`. |

### `createLoopPool(options)` (`core/runtime/x1/loop.mjs`)

| Option | Default | Effect |
|---|---|---|
| `provider` | none | Model provider; required for the agent path. Needs `send({ session, messages, remaining, timeoutMs })` returning `{ text, usage }` and `endSession(session)`. |
| `size` | `1` | Workcells. |
| `isolation` | `process` | `thread` or `process`. Process cells run under Node's permission model with read-only grants for the repository and the compiler. |
| `waits` | `release` | `release` parks the agent's state in the ledger while a model call is pending and frees the cell; `hold` keeps the cell. |
| `jobTimeoutMs` | `60000` | Compute budget per job; starts when the cell is warm and pauses during host calls. |
| `jobDeadlineMs` | `900000` | Hard wall deadline per job. |
| `rates` | `null` | A `createStageRates` object to record per-stage arrivals and timings. |
| `cellEnv` | `{}` | Environment for process cells; the default gives them an empty environment. |
| `primes` | unset (the warm step's default, 8) | Passed to the cell's warm step. |
| `ascPath`, `hostPort` | the pinned `tools/asc` compiler; `core/runtime/x1/loop-port.mjs` | Compiler module and cell port. |
| others | | Passed to `IsolatePool`. The pinned compiler's limits apply unless overridden: `wasmMemoryMaxMb: 4096`, `maxOldGenerationSizeMb: 1024`, `maxYoungGenerationSizeMb: 32` and its trusted modules. |

### `new IsolatePool(options)` (`core/runtime/isolate-pool.mjs`)

| Option | Default | Effect |
|---|---|---|
| `hostPort` | required | Module each cell imports; it exports `createPort(options)`. |
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
| `cgroupRoot`, `cgroupLimits` | the pool's own cgroup; `memoryMax` max(256, old + 3 × young + 128) MiB, `cpuMax: '100000 100000'`, `pidsMax: 64` | Process mode only. |
| `cellEnv`, `cellFlags` | unset, `[]` | Environment and Node flags for process cells. |
| `hostCall` | unset | Answers a cell's `hostCall(...)`; the loop pool uses it for model turns and the freeze. |
| `ledgerBridge` | unset | `{ extension, restart = false, journal }` for the persistent ledger bridge. |
| `dumpList` | auto | `false`, `true` or an object; see [dump list](#dump-list). |
| `rates` | `null` | Stage-rates object. |

The [ledger ICD](../interfaces/ledger-icd.md) defines the pool's job fields and failure states.

### Claude transports

`SpawnClaudeTransport` (one `claude -p` per turn) and `WarmClaudeTransport` (one long-lived stream-json session per
lane), in `core/runtime/x1/transports.mjs`.

| Option | Default | Effect |
|---|---|---|
| `model` | `sonnet` (`defaultModel`) | Passed to `--model`. |
| `effort` | none | Passed to `--effort`. |
| `timeoutMs` | `300000` | Per-turn timeout. |
| `instances` (warm) | `[{ name: 'default' }]` | `{ name, configDir, lanes = 1, governor? }`; one long-lived `claude -p` per lane. `configDir` must exist. An instance's `governor` overrides the transport's. |
| `configDir` (spawn) | unset | Login directory; must exist. |
| `queueTimeoutMs` (warm) | `timeoutMs` | Wait for a free lane; when every login is parked past this, fail at once with `UsageParked`. |
| `idleMs` (warm) | `300000` | An idle lane's process is stopped after this. |
| `governor` | a governor per login | A `UsageGovernor` to admit every turn through; `null` turns governing off. |
| `usageState` | the `ENDOFORGE_USAGE_STATE` default | Governor state file. |
| `watchdog` | from `CLAUDE_CODE_RETRY_WATCHDOG` | `true`, `false` or `{ maxWaitMs, recheckMs }`. |
| `system` | EndoForge's tool-call system prompt | Replaces it. |
| `cwd` | a fresh temporary directory | Working directory of the child. |
| `command` | `claude` | The CLI to run; a test double can stand in. |
| `testDouble` | `true` when the basename of `command` is not `claude` | Copied to the provider's `testDouble`, which labels results. |
| `base`, `environment` | `process.env`, `{}` | Where the copied variables come from, and extra child variables (credential-shaped names are refused). |

`scriptedProvider(script)` in the same module is the test-double provider: `script({ session, messages, turn,
remaining })` returns `{ text, usage }`.

### Usage governor (`core/runtime/usage-governor.mjs`)

`new UsageGovernor({ scope = 'default', ceiling, statePath, perCallPrior = 0.001 })`. A call parks when
`utilization + (inFlight + 1) × perCall >= ceiling`, when the last status is `allowed_warning` or `rejected`, or when
the login draws on usage credits. `UsageParked` has `code: 'USAGE_PARKED'`, exit code 75,
`outcome: 'outcome_unknown'` and `resumeAt`. Usage windows are kept 8 days.

### `openLibrary(options)` (`core/library/library.mjs`)

| Option | Default | Effect |
|---|---|---|
| `journal` | `null`: in memory only | Path of the library's hash-chained journal (JSON lines, one `fsync` per record). |
| `cells` | `1` | Worker threads that run qualification. |
| `deadlineMs` | `5000` | Per-run deadline in a cell; a timeout is a refusal. |
| `keyMode` | `contract` | Lookup key: `contract` (exports plus contract numerals), `interface` (exports only) or `prose` (exports plus contract text). |
| `gate` | `full` | Discrimination gate: `full` refuses surviving mutants, wrappers and untested bounds; `none` skips it; any other value checks mutants only. Exports over records, lists or text are mutated and probed through their declared layout. |
| `retrieval` | `key` | `semantic` ranks entries by contract-text similarity first and lets a need with no capability block adopt the capability of an entry scoring at least 0.4. |
| `principal` | `null` | Default `{ tenant, lineage }` for admission, lookup, serving and composition; each call can pass its own. |
| `environment` | the running Node, V8, platform and architecture | Replaces the environment that qualifications are recorded under (for tests). |

`library.reclaim({ compact = true })` rewrites the journal after reclaiming; `compact: false` keeps it as it is.

The [reuse how-to](../guides/how-to/reuse-with-the-library.md) shows `admit`, `serve`, `revoke` and `requalify`.

### Evaluator synthesis `begin` (`core/runtime/x1/synth/stage.mjs`)

`begin({ need, env, provider, confirm, suspect, cell })`. `runNeed` passes `need`, `env`, `synthProvider`, `confirm`
and a `suspect` hook of its own that records the report and then calls the caller's `suspect`.

| Option | Default | Effect |
|---|---|---|
| `suspect` | none | Called with the `suspect_frozen_tests` report before `finish` returns, when width 2 finds suspect frozen tests. |
| `cell.deadlineMs` | `30000` (`cellDeadlineMs`) | Deadline of the judging worker thread used by `evaluate`. |
| `cell.resourceLimits` | `{ maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }` (`cellLimits`) | Its heap and stack limits. |

### Compatibility route promotion (`tools/tscheck/contained-route.mjs`)

| Call | Effect |
|---|---|
| `route.freeze({ ledger, need, tests })` | Freezes `tests` (a JSON string) and the pinned checker digest into the ledger at path `ledger`; returns `{ identity, digest }`. |
| `route.promote(candidate, { ledger, frozen, decisionPath?, contract? })` | Registers the candidate, runs `route.check`, records the receipt and decides under `COMPAT-TS-CHECK-RUN2-TESTS/v1`; returns `{ candidate, receipt, report, decision, promoted }`. `frozen` is the identity from `freeze`. |

### Specification correction (`tools/x1_loop.py` `revise`)

`python3 -B -m tools.x1_loop revise < request.json`, with `{ "reference": { "ledger", "identity" }, "report" }` on
stdin; the pool's ledger bridge takes the same action as `revise`. `identity` must be the latest frozen evaluator and
`report` a `suspect_frozen_tests` report made `before: "implementation"`; the ledger must hold no candidate. It prints
`{ identity, digest, encoded, decision: null, revision: { of, evidence }, files }` and exits 0; a refusal prints
`revise refused: <reason>` and exits 1; any other arguments print the usage and exit 2.

### Contained JavaScript (`core/runtime/contained/runner.mjs`)

`createContainedRunner` defaults: `width` 1, `maxWidth` = `width`, `spare` = `width`, `heapMb` 64, `youngMb` 8,
`stackMb` 2, `deadlineMs` 1000, `outputMaxBytes` 1 MiB, `stuckMs` 1500, `bootAllowanceMs` 5000, `reuse` true,
`harden` true, `affinity` none (`taskset` `/usr/bin/taskset`). `prepare.layout` defaults to `sibling` with
`checkDeadlineMs` 10000. `createContainedPool({ width })` runs one process per cell.

### Dump list

`dumpList` on `IsolatePool` and `createContainedRunner`: `false` disables, `true` or `{ directory }` enables, otherwise
`ENDOFORGE_DUMP_LIST` decides. Object keys override these defaults:

| Key | `IsolatePool` | Contained runner | Effect |
|---|---|---|---|
| `name` | `endoforge-isolate-pool` | `endoforge-cohort` | Holder record name. |
| `priority` | `20` | `40` | Shed priority, 0 to 199. |
| `floor` | `1` | `1` | Idle cells kept when shedding. |
| `holdMs` | `30000` | `30000` | Time after a shed before cells are respawned. |
| `intervalMs` | `2000` | `2000` | Record refresh interval. |
| `settleMs` | `1500` | `1500` | Time to wait for shed cells to exit. |

A registered holder writes `<pid>-<name>.json` and sheds idle cells on `SIGUSR2`. The ledger writer registers as
`endoforge-ledger-writer` with priority 110.

### Capacity planner (`core/runtime/capacity/`)

```sh
node core/runtime/capacity/cli.mjs probe
node core/runtime/capacity/cli.mjs plan --queues=2 --allotment=16
node core/runtime/capacity/cli.mjs share --ms=1000
```

Each prints one JSON line with `interface: 1`. Flags take the `--name=value` form; a bad command prints usage and exits
2. `plan({ queues = 1, allotment, policy = POLICY })`; `POLICY` is
`{ mode: 'fixed', width: 'cores', perDomain: 1, headroom: 1.25 }`. `TUNED_POLICY` adds the occupancy-capped tuner.
The [capacity ICD](../interfaces/capacity-icd.md) has every record, rule and default.

### Stage rates (`core/runtime/stage-rates.mjs`)

`createStageRates({ stages, slots = 16384, recent = 2048, history = 900, tickMs = 1000 })`. `view({ windowMs = 5000 })`
returns per-stage rates, utilisation, queues and a bottleneck verdict; `publish(path)` writes it every second.
`node tools/stage-rates.mjs <snapshot.json> [--watch] [--json]` prints a snapshot.

### Kernel limits (`tools/kernel/limits.py`)

`fuel` 100000 (1 to 10,000,000), `memory_bytes` 16 MiB (64 KiB to 16 MiB), `output_bytes` 1 MiB (1 byte to 1 MiB),
`wall_seconds` 5.0 (0.01 to 60). Pinned Wasmtime 49.0.0 and wasm-tools 1.262.0.

## Job and Conductor manifest settings

The `conductor` block of an `endoforge/job/1` manifest:

| Key | Default | Effect |
|---|---|---|
| `launcher` | `systemd` | `systemd` starts each worker as a user unit in `heavy.slice`; `local` starts a detached child. |
| `maxIterations` | `3` | Tries per atom before escalation. |
| `maxLaunches` | `200` | Launch budget for the job. |
| `atomTimeoutSec` | `2400` | `RuntimeMaxSec` of a worker unit. |
| `gate` | none | Collect gate: a shell command run in the job's repository after an atom's diff is applied, with `${atom}` expanded. A failure reverts only that atom and its error goes into the atom's next prompt. An atom's own `gate` wins. |
| `gateTimeoutSec` | `300` | Time limit for one collect-gate run. |
| `dir` | `<directory of job.json>/conductor` | The Conductor's state directory (`state.json`, prompts, logs, gate results). |
| `codexPool` | `core/runtime/agent-pool.mjs` | Command run for Codex atoms. |
| `claudeBin`, `claudeModel` | `claude`, `opus` | Command and model for Claude atoms. |
| `claudeTools` | `Read Edit Write Glob Grep Bash(node:*) Bash(npm:*) Bash(make:*) Bash(python3:*) Bash(git diff:*) Bash(git status:*) Bash(ls:*)` | `--allowedTools` for Claude atoms. |
| `checks` | none | Per-atom checks. An atom no check names runs the runnable checks of the criteria it lists. |
| `codexModel` | the client default | Passed as `-m` to Codex atoms. |
| `worktrees` | `<state directory>/worktrees` | Where atom worktrees go. |
| `links` | `[]` | `{ path, target }` symlinks made in each worktree. |
| `checkConcurrency`, `busyBaseSec`, `busyWaitSec` | see the [Conductor README](../../tools/conductor/README.md) | Check parallelism and back-off when logins are busy (2 s base, 900 s cap). |

`conduct run` takes `--tick` (default 5 seconds) and `--max-ticks` (default unlimited). `resources.health` in the
manifest is the health check; without it the job tool runs `.local/bin/system-safety-status` in the home directory.

## Atomizer command defaults

`schedule.mjs run <atoms.json> --run-dir <dir>` takes `--concurrency` (8, or `ENDOFORGE_CODEX_CONCURRENCY` with the
Codex backend), `--retries` (1), `--timeout-ms` (900000), `--policy` (`tools/atomizer/policy.json`), `--force` and
`--no-augment`. Policy limits: at most 64 atoms, `size.work` at most 3, atom timeouts capped at 5400 seconds.

## Hillclimb campaign defaults

In an `endoforge/hillclimb/1` campaign, `runner` defaults to `node tools/hillclimb/bin/run-atoms.mjs`, which runs the
atoms on the atomizer scheduler with a per-stage policy (`<stage>.policy.json`) whose `bindRoots` add the campaign
`workdir`, the hillclimb directory and `repo`. `concurrency` defaults to 3 and `runTimeoutSec` to 14400. A campaign's
own `runner` gets `<atoms.json> --out <dir> --concurrency N --timeout S`, without the policy.

## Makefile variables

| Variable | Default | Effect |
|---|---|---|
| `PYTHON` | `python3` (`?=`, so the environment or the command line can set it) | Interpreter for Python targets; `test-optimized` reruns `test` with `PYTHON="$(PYTHON) -O"` and `PYTHONOPTIMIZE=1`. |
| `PYTHONDONTWRITEBYTECODE` | `1` (exported) | No `.pyc` files. |
| `ENDOFORGE_TEST_OUTPUT` | `$(CURDIR)/.test-work` (exported) | Test scratch root. Set with `:=`, so only the command line overrides it (`make test ENDOFORGE_TEST_OUTPUT=...`), not the environment. |
| `ENDOFORGE_USAGE_STATE` | `$(CURDIR)/.test-work/usage-governor.json` (exported) | Keeps test governors off the shared state file. Same override rule. |
| `TOOLS_DIR` | `$(CURDIR)/.tools` | Where `make tools` installs the kernel test tools; `kernel-test` uses `$(TOOLS_DIR)/venv/bin/python` and puts `$(TOOLS_DIR)/bin` first on `PATH` when they exist. |
| `WORK`, `TSC` | empty | Required by `make tscheck-requalify` (`--work DIR --tsc PATH`). |

Setup targets run `npm ci --ignore-scripts` from a lockfile: `loop-setup` (`tools/asc`), `tscheck-setup`
(`tools/tscheck`) and `rust-lane-setup` (`tools/rust_lane`). `isolate-test` depends on `loop-setup` and
`tscheck-setup`, `loop-test` on `loop-setup`, `tscheck-test` on `tscheck-setup`, and `rust-lane-test` on
`rust-lane-setup`.

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | before 2026-11-08 | — | Written in PR #129 at `d4d7efa` | earlier PRs |
| 2.0 | 2026-11-08 | `4d692a4` | Metadata header and change history added; content re-baselined | #131 |
| 3.0 | 2026-11-08 | `63e95c7` | Rewritten and re-verified against the code: common-settings table, `runNeed`, `openLibrary`, dump-list, job and atomizer settings added; `HC_WORK`, `XDG_RUNTIME_DIR`, `XDG_STATE_HOME` listed | this PR |
| 3.1 | 2026-11-09 | gap closure | Library `retrieval`, `principal`, `environment`; synthesis `begin` options; compatibility route `freeze`/`promote`; transport `model` default, `testDouble` and per-instance `governor`; per-stage `maxTokens`; relative `ENDOFORGE_CODEX_CMD`; Conductor `claudeTools` and criteria checks; hillclimb default runner | `dc6ba4c` |
| 3.2 | 2026-11-09 | round 2 | `runNeed` `principal` and `suspect`; `containedRoute` on every path with promotion; `revise` ledger action; `rust-lane-setup` and the `isolate-test` setup dependencies | this commit |
| 3.3 | 2026-11-09 | round 3 | Library `gate` covers structured exports through the declared layout; no new option or environment variable | this commit |
