# Changelog

Notable changes are recorded here using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Structured state at the kernel boundary: glue kinds `record`, `list` and `text` with a declared little-endian,
  naturally aligned layout, passed through host-owned linear memory; every gate and the commit-time measured port
  handle them, and the agent's stage prompts carry `stateRules`. Evidence: an AssemblyScript to-do reducer passes all
  nine gates (`core/runtime/test/gaps-gluestate.test.mjs`).
- Library: composition (unions, output-to-input pipelines, argument adapters linked into one module, gated on the
  need's tests), opt-in semantic retrieval (`retrieval: 'semantic'`), tenant and lineage scopes with journaled grants,
  `reclaim()` with journal compaction, refusals kept as counterexamples, and qualification per environment.
- Compatibility-lane promotion rule `COMPAT-TS-CHECK-RUN2-TESTS/v1` (`tools/compat_policy.py`,
  `core/runtime/contained/promotion.mjs`, `route.freeze` and `route.promote`), with an independent re-score of the
  route's output.
- Evaluator synthesis: judging in a worker-thread cell with heap, stack and deadline limits; suspect frozen tests
  reported at freeze (`synth/suspect.json`, `begin({ suspect })`).
- CI job `secret-scan` (Gitleaks 8.28.0, checksum verified, full history).
- `tools/atomizer/LEDGER.md`, `tools/conductor/examples/` (adopt map with an old manifest and loop state),
  `tools/hillclimb/bin/run-atoms.mjs` (the default campaign runner, on the atomizer scheduler).
- Requirements REQ-X1-005 to 008, REQ-LOOP-005 and 006, REQ-GEN-009, REQ-SYNTH-002 and 003, REQ-TRANSPORT-002,
  REQ-CONTAINED-002, REQ-LIB-002 to 007, REQ-ATOM-004, REQ-COND-003 and 004, REQ-JOB-002, REQ-HILL-002 and
  REQ-REPO-006, traced in the verification matrix; GAP-EF-011 and GAP-EF-012 closed.
- Specification correction from suspect frozen tests: on every loop path a suspect report from evaluator synthesis
  is recorded in the ledger (`admitted_input`) and a revised `frozen_evaluator` (`specification_correction`) is
  frozen before any candidate; the commit judges against the corrected tests. New ledger action `revise`
  (`python3 -B -m tools.x1_loop revise`); `runNeed({ suspect })`; results carry `revision` and `suspects`.
- `runNeed` decides the compatibility lane on every path: a route with `freeze` and `promote` is frozen into
  `compatibility.sqlite` before any candidate and promoted under `COMPAT-TS-CHECK-RUN2-TESTS/v1`, returned as
  `compatibility`.
- `runNeed({ principal })` is passed to `library.serve` on every path.
- Library composition across parts with linear memory or tables: each part gets a bounds-checked region of the
  module's memory and its own table; structured values cross between parts as layout-checked copies.
- CI job `rust-lane` runs `make rust-lane-test` on Rust 1.98.1; new target `rust-lane-setup`.
- Requirements REQ-X1-009, REQ-X1-010, REQ-LOOP-007 to 009, REQ-SYNTH-004, REQ-LIB-008, REQ-REPO-007 and
  REQ-GATECLI-001; GAP-EF-003 and GAP-EF-013 closed.
- After a specification correction, the implementation turn on the `current` and `isolate` paths reads the
  corrected frozen tests: `generate` checks them against the frozen digest and sends them in the implementation
  prompt with a notice that they replace the earlier version.
- Structured specification corrections: synthesis references may return records, lists and text against a declared
  layout in the binding (`core/runtime/x1/synth/layout.mjs`); structured suspects carry that layout, and `revise`
  freezes the agreed value in declared field order.
- `judge` runs synthesized vectors against exports over records, lists and text through the declared layout.
- Library composition gives each part its own WebAssembly memory (multi-memory) instead of a region of one shared
  memory, with memory 0 holding the host's buffers; the meter reads, exports and counts every memory.
- The library's mutation check builds its probe grid for exports over records, lists and text from the declared
  layout, calls the kernel and its mutants through host buffers on a metered instance, and compares results field by
  field.
- Requirements REQ-LIB-009, REQ-X1-011, REQ-LOOP-010, REQ-GEN-010, REQ-SYNTH-005 and REQ-SYNTH-006, traced to
  `core/runtime/test/gaps3-generator.test.mjs`, `core/runtime/test/gaps3-meter.test.mjs` and
  `tools/test_x1_revise_structured.py`.
- Evaluator synthesis generates vectors for exports over records, lists and text: inputs for a structured parameter
  come from the layout the binding declares for it (empty, full and seeded random values), the frozen tests' values
  and reference results that fit the layout; they are qualified under M1 to M5, kept by `combine` at width 1, and at
  width 2 only where both references give the same whole value. The binding prompt asks for parameter layouts.
- `runNeed({ synthCell })`: the synthesis judging cell's deadline and heap limits, passed to `begin` on every path and
  to the commit's `judgeInCell` on `isolate` and `agent`.
- `make lint` (ruff 0.17.0 with a repository `ruff.toml`, and `node --check` on every JavaScript module) and a CI job
  `lint`; `make coverage` (Node built-in coverage; coverage.py, else trace counts, for Python); `make gap-tools-test`
  in `make test`.
- Tests for the factory runtime, approved atoms, campaign repair, Wasmtime qualification, stage resume and an
  emulated campaign transfer, the project scheduler, the atomizer commands `atomize`, `direct`, `fanout`, `report` and
  `cutover`, hillclimb fan-out, plan and scoreboard, job kinds and prompt compilation, the release-record generator,
  the stub pool, and delegated cgroup enforcement inside a `systemd-run --user --scope`.
- Requirements REQ-ISO-018, REQ-STUB-001, REQ-SYNTH-007, REQ-SYNTH-008, REQ-ATOM-005, REQ-JOB-003, REQ-HILL-003,
  REQ-SCHED-001, REQ-FACTORY-003 to 005, REQ-REPO-008 and REQ-REPO-009; GAP-EF-001, 004, 005, 007 to 010 and 014
  closed, GAP-EF-002 and 006 narrowed to the parts still untested.
- Both specification prompts (the agent path's `stagePrompts.specification` and the Codex-path prompt in `generate`)
  ask for a fenced ```capability block in `CONTRACT.md` (exports, kinds, units, ranges, precision, codes, traps). The
  freeze checks a block that is present (`capabilityProblems` in `core/runtime/x1/generator.mjs`), and the
  implementation prompts ask glue.json to declare the same capability, so a generated need can hit a promoted kernel
  through library lookup on the `current` and `agent` paths.
- `tools/compatibility` checks reducers inside `IsolatePool` workcells (`probeInWorkcell` in
  `tools/compatibility/workcell.mjs`), with source, WIT, evaluator, runtime and compiler identities in the receipt.
- Tests that start real sandboxed factory workers through the `bridge.py` relay and complete
  `local_provider.call_protected` against a stub provider, and a campaign transfer over real `ssh` and `scp` to
  `ENDOFORGE_SECOND_HOST` (passed against a separate machine on 2026-11-09; skips when the variable is unset).
- CI job `coverage`: runs `make coverage -k` under coverage.py 7.10.7 and uploads `coverage-summary.txt` as the
  artifact `coverage-summary`.
- Requirement REQ-GEN-011; REQ-COMPAT-001, REQ-GATECLI-001, REQ-FACTORY-003, REQ-FACTORY-005 and REQ-REPO-009
  extended; GAP-EF-002 and GAP-EF-006 closed, so no gap is open.
- `IsolatePool` option `syncHostCalls` and export `connectSyncHostCall`: a cell can make a blocking host call (a
  shared buffer in a thread cell, pipes on file descriptors 4 and 5 in a process cell) under the same per-job limits
  as asynchronous host calls, with the job timeout paused while the host answers.
- `tools/kernel`: effect declarations checked before a transition is released (`effects.py`), an append-only,
  hash-chained `DenialJournal` for broker, effect and admission denials (`journal.py`), and `conformance.check`, which
  runs a frozen task's cases through the workcell (`conformance.py`, also `python -m tools.kernel.conformance`).
- `tools/rust_lane/admit.py`: admits any Rust kernel crate that meets the kernel contract, only after the kernel host
  runs its frozen task; two frozen tasks, `tasks/p06-pressure.json` and `tasks/tally.json` (crate
  `kernels/tally/`), and `build.py --crate`.
- `tools/factory_runtime/wasm_host.py`: runs a WebAssembly export under the pinned Wasmtime 49.0.0 wheel from
  `make tools`, with fuel, epoch and memory limits.
- Tests: the capability block required on every path and checked at G7 (`gaps6-capability.test.mjs`), synchronous
  host calls (`gaps6-hostcall.test.mjs`), `synthCell` on the `current` path (`gaps6-synthcell.test.mjs`), kernel
  effects, journal and conformance (`tools/kernel/test_effects.py`, `test_conformance.py`), generalized Rust
  admission, local-provider turns, the pinned Wasmtime wheel and a real Docker daemon (`RealDocker`, which skips with
  its reason and has not run yet), and direct tests of `tools/lib/lock.mjs`, `headroom.mjs` and `exitfile.mjs`.
- Requirements REQ-ISO-019, REQ-KERNEL-005 and REQ-ERR-002; REQ-GEN-011, REQ-COMPAT-001, REQ-RUST-001,
  REQ-FACTORY-003 and REQ-HILL-002 changed or extended; REQ-SYNTH-008 tested on every path. GAP-EF-015 (the gate
  CLI's `freeze` does not require a capability block) and GAP-EF-016 (`make coverage` failing on a test failure and
  the CI `coverage` job, not yet verified) opened.

- `examples/first-loop.mjs` and `examples/show-gates.py`: the README and getting-started example (a scripted model
  promotes an addition kernel and refuses a subtracting one), tested by `core/runtime/test/loop-example.test.mjs`.
- Documentation to the Cstack family standard (NASA-organized, self-assessed Class E analog): software management
  plan, compliance matrix, a requirements specification with per-requirement fields and an untested-gap register, a
  re-baselined verification matrix, test plan, design description, data dictionary, assurance record, user manual map
  and limitations page; `tools/check_trace.py` in `make check`; `tools/gen_release_docs.py` generates the test report
  and version description from recorded runs.
- Documentation: a getting-started tutorial that runs the candidate loop on a fresh clone with a scripted model, an
  explanation of the candidate loop, a configuration reference covering every environment variable, `limits` key and
  options object with defaults from the code, a tools index and READMEs for every tool, and a refreshed docs index.
- Formula oracle behind `limits.oracle`, off by default: frozen expectations are recomputed from the contract's
  formula, ranges and a model-written `reference.js`, with `verified`, `corrected`, `flagged`, `unverified` and
  `abstained` statuses; round 2 evaluates piecewise rules branch by branch and reads more formula and range shapes
  (#126, #127, #130; P-69, P-70, P-71).
- Weekly usage governor in both Claude transports: new calls park at a 0.85 ceiling, on `allowed_warning` or
  `rejected`, or when a login draws on usage credits, as `USAGE_PARKED` with exit 75 (#125).
- Subscription guard: every `claude -p` launch must prove a claude.ai subscription login, or it is refused with exit
  78 (#113).
- Capacity planner (`core/runtime/capacity/`, Mjölnir): width, L3-domain placement and split from a machine probe,
  with a fixed default and an opt-in occupancy-capped tuner; `docs/interfaces/capacity-icd.md` (#114, #124; P-67, P-68).
- Gate `G9_units`, a static units check independent of the evaluators; promotion now requires G1–G9 (#119; P-65).
- Live per-stage rates and a bottleneck verdict for the loop, opt-in through `rates`, and `tools/stage-rates.mjs`
  (#117; P-62).
- Memory dump list: the contained cohort, isolate pool and ledger writer register sheddable memory and shed idle
  capacity on `SIGUSR2` when a memory guard asks; off unless the directory exists or `ENDOFORGE_DUMP_LIST=1` (#111; P-61).
- Group-commit ledger writer with one journal `fdatasync` per batch (#110; P-59).
- Type check inside the contained cohort, with tsrs instance reuse and a host incremental baseline; `fused` is the
  route's default placement (#108, #109; P-58, P-60).
- Evaluator synthesis stage behind `ENDOFORGE_SYNTH=1` (#104, #105, #106; P-56).
- The agent loop releases its cell while it waits on the model (`waits: 'release'`, the default) (#107, #121; P-57).
- Library v0: a need that a promoted kernel already satisfies skips implementation (#95).
- Constraint records kept separately from compaction (#96, #97, #98; P-55).
- Kernel contract, Wasmtime host and broker, seeded-fault generator, escape-rate harness, Rust and TypeScript lanes
  (#83–#87, #90–#92).
- TypeScript checker in pool workcells, with emit hashes in receipts, incremental build info and requalification
  (#71, #78–#80); workcell off-heap limits, policy caps, shared modules, warm start, stack size and host calls
  (#72–#76, #88).
- `make tools` installs pinned kernel test tools; `make check` adds a privacy lint over experiment records (#120).
- `make index`, `make sums`, glob test discovery and an experiment-number allocator (#123).


- Contained execution of emitted JavaScript in a child isolate, one per owned
  process, behind an off-by-default `runNeed` option, with P-54's evidence.

- X1 gates that measure the candidate: real universal gates, metered fuel, a direct non-finite probe judged from the contract, glue checks against kernel parameters and the contract, and an `inconclusive` decision for a stall or unavailable store. The code-label check still refuses one good kernel of 177 ([P-52](experiments/P-52-real-gates/RESULT.md)).

- X1 candidate loop inside the workcell, off by default: `ENDOFORGE_LOOP=isolate` compiles, verifies the frozen evaluator from memory, gates and repairs in one warm cell, with one bridge commit per candidate. `ENDOFORGE_LOOP=agent` adds the agent turn loop over an in-memory overlay, with the model behind a provider port and a warm no-tools Claude transport. [P-50](experiments/P-50-in-isolate/RESULT.md) records 0 spawns and temp files up to commit, matching verdicts, and a missed 100 ms line.

- Local promotion decisions with verified chain/receipt and complete X1 pool
  evidence, plus P-22 prospective harness and explicit test-double validation.

- Environment-configured two-stage Codex generation with durable freeze before
  implementation and labelled CI test doubles; no account discovery or auth reads.

- X1 G1–G7 host port through the real thread/process evaluator, supervisor
  compiler and closed glue schema with local parity/refusal fixtures.
- Supervisor-declared, digest-bound WASM compiler helper maxima, recorded in pool
  results and receipt observations; untrusted omitted maxima remain rejected.

- Optional process-per-workcell isolation with fork/IPC, V8 heap limits, detected
  cgroup v2 limits and supervisor-written rejection receipts. P-18 records N=8
  heap/WASM breaches in both modes; process tests cover parity and ledger replay.

- Bounded V8 isolate workcells in `core/runtime/`, configurable worker heap limits,
  replacement after worker loss, and host-appended receipts using the existing
  ledger schema and hash chain. Core-count default sizing follows P-15/P-17.
  A separate 64 MiB default WASM linear-memory ceiling checks declarations and
  JS/internal growth, with explicit worker-local limit outcomes. `make isolate-test`
  covers evaluator parity, concurrency at 1/4/16, tampering, heap/WASM breaches
  during neighboring work, replacement, and shutdown.
- GPL-3.0-only license, contribution and conduct guidance, security policy,
  GitHub Actions CI, and secret-scanning configuration in
  [PR #1](https://github.com/Akilleez-QA/endoforge/pull/1).
- Repository layout planning through ADR 0001 and PATHMAP in
  [PR #4](https://github.com/Akilleez-QA/endoforge/pull/4).
  These were plans for later moves; neither planning file is in the current tree.

### Changed

- The freeze requires a ```capability block in `CONTRACT.md` on the `current`, `isolate` and `agent` paths (the
  `required: false` switch is gone), and G7 fails when `glue.json` disagrees with the frozen block
  (`capabilityAgreement` in `core/runtime/x1/contract.mjs`). A contract without the block is no longer frozen, so a
  generated need no longer reaches library lookup to miss with `no_capability`. The test fixtures and
  `examples/counter-loop.mjs` and `examples/agent-loop.mjs` carry blocks. `tools/gate/gate.mjs freeze` still freezes a
  contract without one; `gate run` refuses it at G7 (GAP-EF-015).
- The compatibility workcell keeps snapshots in the host and serves each borrowed buffer's `size` and `read` through
  synchronous host calls instead of copying snapshots in with the job; receipts carry `hostBuffers`.
- `tools/factory_runtime/wasm.py` uses the pinned Wasmtime wheel by default; `ENDOFORGE_WASMTIME` now names an
  optional CLI and defaults to empty. A local-provider turn no longer needs or mounts `node`, `codex` or the Codex
  credential.
- Hillclimb passes `--policy <stage>.policy.json` to a campaign's own runner as well as to the default one.

- `tools/gate/gate.mjs` compiles with the pinned compiler in `tools/asc` (`ASC_PATH`, run in-process) when
  `ENDOFORGE_ASC` is unset, instead of `node_modules/.bin/asc` at the repository root, which `make loop-setup` does
  not create.

- The library and evaluator synthesis work on all three loop paths: `isolate` and `agent` consult a library after the
  freeze or admission and skip implementation on a pass, and freeze `synth/evaluator.json` before code and refuse at
  commit what it refuses.
- Commit re-runs the gates on the supervisor whenever the cell report claims a pass and rejects a disagreeing report;
  results carry `rerun`.
- The agent loop's `maxTokens` is a budget per stage, not per attempt (`tokenBudget = 'stage'`).
- New ledger records carry `X1 G1-G9` and policy `X1-G1-G9/v2`; older records keep their labels and still verify
  (`LABEL_MIGRATION` in `tools/x1_loop.py`).
- The frozen implementation list includes `dimensions.mjs`, `generator.mjs`, `ledger.mjs`, `reference.mjs` and
  `scalar.mjs`.
- Claude transports default `--model` to `sonnet` and report `testDouble: true` for a stand-in command; the Conductor
  passes `conductor.claudeTools` to workers, and the default list allows `make`, `npm` and `python3`.
- The Conductor runs an atom's criteria checks when no `conductor.checks` entry names it.
- The Rust lane installs its pinned `jco` and AssemblyScript itself and fetches missing crates under `Cargo.lock`.
- Synthesis failure messages print structured arguments and expected values as JSON, so a scalar failure now reads
  `add([10,3]) gives 14, expected 13`.
- `fanout` exits 1 when a request fails verification; an extra job kind file with an unknown rule key stops the job
  tool loading; the release-record generator reads its lint and coverage lines from the Makefile, CI and the logs.

- README rewritten for first-time readers: what EndoForge is, why, a diagram of the loop, the gate table, a real
  example run and a quickstart; the engineering records moved to one section at the end. The docs index now leads with
  learn, do, look up and understand. The candidate-loop page keeps its document control at the end.
- `IsolatePool`'s default size is `availableParallelism()` again (#124; P-68).
- A job's budget starts when its cell is warm (#115).
- Tests not reached by any target now run, and `tests/test_reachability.py` fails on an unreached test (#94).

- WASM compilation now rejects missing module memory maxima instead of supplying
  them; explicit limits and existing growth instrumentation remain enforced.

- Public-facing README rewrite in
  [PR #2](https://github.com/Akilleez-QA/endoforge/pull/2).
  The current README describes the lifecycle model, generic tools, and test commands.
- Commercial licensing contact added to the README in
  [PR #5](https://github.com/Akilleez-QA/endoforge/pull/5), without changing LICENSE.
  The current README includes that contact in its License section.

### Removed

- The step harness (`tools/step_harness/harness.py` and its tests) moved to `TODELETE/tools/step_harness/`, and
  REQ-STEP-001 is deleted. Nothing in EndoForge called it and no caller belongs here: it needs a POODO decision core,
  which this repository does not have. `make harness-test` now runs `tools/step_harness/test_retired.py`.

### Fixed

- The commit's evidence re-check compares structured results by structure (records by field name, `tol` on every
  numeric leaf, kinds and limits from the declared glue) instead of by their string form; the to-do reducer now
  promotes through the in-cell commit on the `isolate` and `agent` paths.
- The bridge's drift check (`IMPLEMENTATION_FILES` in `tools/x1_loop.py`) names all 14 frozen x1 files; receipts
  carry `acceptance_boundary: 'X1 G1-G9'` instead of `G1-G7`.
- On the `isolate` and `agent` paths the synthesized evaluator judges at commit in a bounded worker thread
  (`judgeInCell`), not on the controller thread.
- `make isolate-test` installs the compiler and checker it needs (`loop-setup`, `tscheck-setup`) first, so `make test`
  works on a fresh clone; the heap-breach test allows 240 s.
- `tools/gate` judges with the core `runGates` and the core glue schema, so a kernel on disk gets the nine gates and
  structured state; tested by `tools/test_gate_structured.mjs` in `make gate-test`.
- `WarmClaudeTransport` honours a caller-supplied usage governor (per transport or per instance).
- A relative `ENDOFORGE_CODEX_CMD` resolves against the caller's working directory.
- The Conductor's collect lock works when the repository is a git worktree.
- Bare runs print usage and exit 2: `testcheck.mjs`, `hc-patch.sh`, `run-atoms.mjs`, `python3 -m tools.x1_ledger`,
  `python3 -m tools.compat_policy`; `bench.mjs` defaults to an atoms file that exists.
- The job tool no longer cites a playbook the repository does not ship; hillclimb `plan-review` works from any
  directory.
- The Rust lane's component runs in the `tools/kernel` Wasmtime workcell.
- Three tool tests that used bare `assert` use `unittest` assertions, so `make test-optimized` checks them.
- Factory runtime: `durable()` writes a temporary file and swaps it in, so a failed write no longer corrupts
  `scheduler.json` or the fence record; the scheduler checks the saved version on reload and no longer crashes on a run
  with no outcome; `run_attempt` restores its signal handlers when the journal already exists; `run_bounded` closes
  its pipes; `wasm.run` refuses instead of crashing when Wasmtime is missing.
- Approved atoms: a write reported as failed is rolled back instead of taking effect on the next replay; replay
  refuses a consumer row for an atom that was never approved.
- Campaign repair patches a previous round's output, refuses an empty frozen-path list, and removes its file when a
  frozen path changes. `qualify_wasmtime.py` no longer checks with `assert`, which passed anything under `python -O`.
  `campaign_transfer.py` sends `checkpoint.py` and the bundle, creates the remote staging directory and removes it on
  failure. `resume_stage.py` refuses a symlinked directory out of the checkpoint and files missing from the inventory.
- The stub pool logs `pid=` so the atomizer scheduler attributes its account, and forwards `SIGTERM` to its child;
  `releaseCgroup` retries a busy `rmdir` instead of leaking the cell group.
- The project scheduler refuses a GPU step without a queue before any step runs, lets two projects name the same
  relative path, and handles a `null` project or job.
- Atomizer `cutover` no longer crashes without arguments, on an unknown arm or with no matching case; `fanout` no
  longer crashes when the scheduler refuses a graph; `schedule` and `atomize` no longer crash when the subscription
  guard refuses a model call.
- Hillclimb `waveSize(0, ...)` gives zero slots instead of one; the job tool refuses a kind named `toString` and a
  kind file with a misspelled rule key.
- The release-record generator refuses a run without `--log` or a log without a label.
- Unused imports and the remaining ruff findings are fixed, so `make lint` passes on the whole tree.
- Inside the worker sandbox, which mounts no `/etc/hosts`, `bridge.py` listens on `127.0.0.1:18080` and the worker's
  proxy variables name that address, so the relay works. `campaign_transfer.py` runs `ssh` and `scp` with
  `BatchMode=yes` and no inherited standard input, and no longer fails on a remote host without `/lib64`.
- The compatibility workcell refuses shared memory before dispatch instead of letting IPC copy it into a pass.
- On the `current` path a refusal by the synthesized evaluator carries the same `problem` text as on the other paths.
- `Egress.test_run_bounded_outcomes` no longer fails when garbage left by other test modules (leaked sqlite
  connections) raises `ResourceWarning`s inside its window.

- A missing exit code or a torn state is no longer read as success, and ledgers and locked decisions survive a
  failed read (#99, #100).
- The random-kill loop-crash test is bounded by progress, not wall clock (#122).

- Synthetic atomizer fan-out timing now disables host headroom throttling for
  that scheduler invocation. The fixture sleeps rather than consuming a core;
  inherited load and memory limits could serialize its independent workers on
  small runners despite concurrency 9. The >2x speedup and six-second wall
  assertions, receipt timing and rounding, and production throttling are
  unchanged. See the [verification matrix](docs/verification/verification-matrix.md)
  for two-core before/after measurements.
- Node 22 X1 test discovery by passing explicit test-file paths in
  [PR #3](https://github.com/Akilleez-QA/endoforge/pull/3).
  This is a historical fix; the current Makefile discovers tests by glob.
