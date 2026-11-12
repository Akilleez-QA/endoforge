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
- `tools/check_comments.py`, run by `make lint` and so by the CI job `lint`: exits 1 and lists `file:line: text` for
  every code comment line in tracked source files, keeping a line-1 shebang, licence headers and tool directives;
  docstrings are not comments. Tested by `tools/test_check_comments.py` in `make gap-tools-test`.
- `tools/atomizer/bin/plan-template.mjs --fixture <interface-lines.txt>` reads the interface from a file instead of a
  model, and the program prints its usage and exits 2 without `<need.md>` or `--out`.
- `atomize.mjs --fixture` writes each rendered prompt to `receipt/<label>-prompt.md` (for example `turn-1-prompt.md`).
- Tests: `tools/gate/gate.mjs freeze` against missing, malformed, disagreeing and agreeing capability blocks; the
  rendered atomizer prompts; `compose-kernel.mjs` refusing a block-less contract; the compose helper gating to a
  promotable kernel inside a real atom sandbox; and `core/library/test/library-reuse-example.test.mjs`, which runs
  `examples/library-reuse.mjs` and checks its three printed outcomes.
- Requirements REQ-ATOM-006 (capability block on every atomizer contract path) and REQ-REPO-010 (no code comments);
  REQ-GATECLI-001 and REQ-REPO-009 extended. GAP-EF-015 and GAP-EF-016 closed, so no gap is open.
- `make experiments-test`, part of `make test`, runs every `experiments/*/analyze.test.mjs` except P-51's by-hand
  `controls.test.mjs`; the P-64, P-65, P-70 and P-71 analysis tests are the first.
- `tests/test_coverage_fails.py` runs the real `make coverage-node`, `make coverage-python` (both modes) and
  `make coverage` against a temporary failing test and checks each fails (REQ-REPO-009). Makefile variable
  `COVERAGE_SETUP` names `coverage-node`'s setup targets so the test can skip `npm ci`.
- `verify.mjs` records the policy it used (`path`, `sha256`) as `policy` in `receipt/verify.json`; `ledger-export.mjs`
  and `repair-noop.mjs` print their usage for `--help`.
- Requirements REQ-ATOM-007 (`verify.mjs --policy` and the helper CLIs' refusals) and REQ-ATOM-008 (the `node`
  toolchain from the running Node); nine requirements changed for the round-8 fixes. D-09 and D-10 closed; D-11 to
  D-13 opened in the assurance record.
- `fanout.mjs` and `cutover.mjs` take `--policy <file>` and record the policy's `path` and `sha256` as `policy`
  (fanout in `fanout.json` and `pool.start`, cutover in `cutover.start`). `LedgerBridge` has a read-only `pid`.
- Round 9 changed REQ-GEN-011, REQ-ATOM-006, REQ-LIB-001, REQ-ATOM-007 and REQ-ISO-010, closed D-11 and D-12, and
  opened D-14 and D-15 in the assurance record.
- Job invariants I16 and I17. I16 refuses a collect gate or a criterion check that runs a records check
  (`check_trace`, `test_*trace*`, or a `Makefile` target that reaches one, such as `make check`). I17: `job.mjs stage`
  runs every criterion check once on the base commit in a throwaway worktree, records `proofs.baseline` (passed,
  failed or broken, and why), and refuses a check broken by a missing module, file or make target. Manifest keys
  `stage.base` (default `HEAD`) and `stage.checkTimeoutSec` (default 1800).
- The conductor emits `TRACE-NEEDED` (a `NEEDS-COORDINATOR` event with `data.event: 'TRACE-NEEDED'`) when an atom
  freezes with new test files, listing them. The collect step records the files each commit added (`added` in the
  gate file).
- `atomize.mjs`, `plan-template.mjs` and `direct.mjs` take `--policy <file>` and record its `path` and `sha256` as
  `policy` in their receipt and events; `cutover.mjs` records each arm's `planPolicy` and `planPolicyMatches`.
  `runReferences` takes `startupMs`, and its exported `referenceDeadline` gives the deadline it uses.
- Round 10 added REQ-SYNTH-009, REQ-COND-005, REQ-COND-006 and REQ-JOB-004, changed REQ-ATOM-007 and REQ-LIB-002,
  closed D-14, D-15 and D-16, and opened D-17 in the assurance record.

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
- `tools/gate/gate.mjs freeze` refuses, with exit 2 and no `frozen.sha256`, a `CONTRACT.md` whose capability block is
  missing, malformed or disagrees with the tests, using the loop's own check (`capabilityProblems`). Before, only
  `gate run` caught a missing block, at G7, after the code was written (GAP-EF-015 closed).
- Every atomizer path that writes `CONTRACT.md` asks for the capability block in the loop's own words
  (`capabilityRule`): rule 12 of `atomize.mjs`, a new `contract` kind procedure in `tools/atomizer/policy.json`, the
  contract atom of `plan-template.mjs` and the `direct` procedure. The `glue` procedure says to match the block, and
  the templated glue atom now reads the contract. `compose-kernel.mjs` exits 3 before freezing when the contract atom's
  `CONTRACT.md` has no block or a block that is not JSON. Stale "G1-G7" labels in the atomizer now read G1-G9.
- The atomizer's compose, compose-draft, repair and direct atoms mount `core/`, `tools/asc` and
  `experiments/assemblyscript-toolchain.mjs` (toolchains `gate-core`, `gate-asc`, `gate-asc-trust`), and `asc` points
  at `tools/asc/node_modules`; the compose helper takes its toolchain from `policy.kindToolchain.compose`.
- `examples/library-reuse.mjs`: the third need's capability block widens the argument range to `-100..100`, so it
  misses the library with `no_contract_match` and is generated; the example prints each library verdict and the miss
  reason. The library how-to shows the new output.
- Code comments are removed across `core/` and `tools/` (D-07). Header usage blocks moved into the programs'
  own usage output: `tools/job/bin/job.mjs`, `tools/conductor/bin/conduct.mjs` and `tools/hillclimb/bin/hillclimb.mjs`
  now print a `USAGE` constant instead of reading their own source lines (which also printed import lines);
  `hillclimb.mjs` now prints its last line, `(inside atoms) compose-review … | compose-fix …`, which it cut before;
  `job.mjs` says I1–I15 and lists `patch`; `hc-patch.sh`, `speed.mjs`, `testcheck.mjs`, `verify.mjs`, `fanout.mjs`,
  `direct.mjs` and `compose-kernel.mjs` print their full usage. Information the comments held and the
  docs lacked is now in the tool READMEs and `docs/`. `tools/conductor/demo.sh` writes the generated worker's `#!`
  line with `printf`.
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

- The ledger writer's journal lost a `retire_syncs` count when two segment retirements overlapped: each background
  thread read the old count before its sync and wrote back old + its own, so one thread's syncs were overwritten.
  The count is now added under a lock after the sync. `WriterTests.test_rotation_retires_the_full_segment` failed
  this way on `main` (`1 not greater than or equal to 2`); `test_overlapping_retirements_count_every_sync` forces
  the overlap and fails on the old code.
- CI's "Install test dependencies" step (jobs `test` and `coverage`) retries `apt-get update` and `apt-get install`
  up to five times, waiting 10, 20, 40 and 80 s between attempts. In CI run 43043833441 on `main`, name resolution
  for the Ubuntu archives failed for about four and a half minutes (`Temporary failure resolving`), longer than
  apt's own retries within one run, and `test (22)`, `test (26)` and `coverage` all failed before any test ran.

- Job staging expands the conductor's check placeholders (`${repo}` and the input and output paths) before calibrating a check, so valid checks are no longer classed as broken; I16 inspects the checks the conductor will actually run (`conductor.checks` and the slice command), not only the criterion commands (Codex review of PR #144).
- The comment check's lexer treats postfix `++`/`--` as ending an expression, so `n++ / d` is division rather than an unterminated regular expression (Codex review of PR #144).

- The freeze refuses a structured result whose nested number field has no `precision` or whose nested boolean field has no `labels`. Such a contract used to freeze and then fail G7 whatever the glue declared, so it could never be implemented (Codex review of PR #144).

Round 10 fixes the round-9 findings D-14 and D-15 and the cutover-planning gap (D-16), adds tests for the library's
union path, and turns two coordinator lessons into tool changes. Each change has a test. The relaunch, trace-event,
union and invariant tests failed first against the old code; the sandbox and cutover workers could not run theirs
against the old files.

- The reference sandbox (`runReferences`) ran every reference call in one child under a single 30-second wall-clock
  limit and reported every failure as "failed or timed out", so `gaps4-synth` S1 failed when several full suites ran
  at once (D-14). The deadline now grows with the work: 30 s of startup plus, per reference variant, 2 s of load time
  and 400 ms per call up to 4.4 s. An explicit `timeout` still wins. The error says which case happened: timed out
  after N ms (with the deadline), exited with a code, exited with a signal, or exceeded its output limit.
- A coordinator patch with `relaunch`, applied after the conductor job reached `done`, left the atom in `relaunch`
  forever (D-15). The patch now reopens a job past `streaming` back to `streaming`, logs the transition, emits a
  `GATE` event (from `done` it says to start the conductor again) and returns `reopened: true`; the restarted daemon
  runs only the relaunched atoms. A relaunch on a job the user stopped is refused. The daemon no longer overwrites a
  reopen that lands while it advances a phase.
- `cutover.mjs` passed `--policy` to `schedule.mjs` and `verify.mjs` but not to its planning steps, so the atomized,
  templated and direct arms planned under the default `policy.json` (D-16). Every planning step now takes, validates
  against and records the policy; an arm whose plan used another policy, or breaks it, is marked `planValid: false`
  and not run. `direct.mjs` validates its plan for the first time and exits 1 when it breaks the policy.
  `plan-template.mjs` writes an invalid receipt when the model call is refused, where it crashed before.
- The library's union path had no test. The first one showed that members sharing one signature (state in, state out
  over the same record) were all bound to the first entry that fit, so the union never composed or composed the wrong
  function. Such members now bind to the entry export with the same name. The new tests also show that a member whose
  nested layout differs leaves no union.

Round 9 fixes a flaky test from PR #143's CI and the round-8 findings D-11 and D-12. Each fix has a test; five of the seven
capability-layout cases and the policy cases failed first against the old code.

- The bridge-death test in `core/runtime/test/isolate-pool.test.mjs` read the test process's children once, right
  after `pool.run()`, and expected exactly one `python3`. The pool spawns its ledger bridge only after its shared
  modules are ready, so under load there could be none yet (CI on Node 26: 0 found, 1 expected), and a `python3` it
  found might not be the pool's bridge, so the test could kill the wrong process. It now waits for `pool.ledger.pid`,
  checks that the test process is that pid's parent, kills exactly that pid, and checks that the bridge was not
  respawned.
- A capability block could declare a result or argument of kind `record`, `list` or `text` without its layout, and it
  then agreed with any glue (D-11); the prompts did not ask for the layout, and the library key compared only the top
  level, so a need could reuse an entry whose nested units differ. The freeze and G7 now refuse a record, list or text
  value, at any depth, without its layout (record `fields` with kinds, units and codes; list `items` and `max`; text
  `maxBytes`). Every prompt that asks for the block asks for the layout, and glue prompts ask for the same layout in
  `glue.json`. The library key and binding include the nested layout; record fields compare by name, and a capability
  with only scalar values keeps its old key. A contract with a structured block and no layout no longer freezes, and a
  library entry admitted earlier with a structured value is keyed without its layout and is no longer found.
- `fanout.mjs` and `cutover.mjs` called `verify.mjs` without `--policy`, so a run scheduled with another policy was
  verified against the default `policy.json` (D-12). Both now take `--policy`, pass it to `schedule.mjs` and
  `verify.mjs`, and refuse a missing, unreadable or non-object policy with exit 2 before running anything. Cutover's
  planning steps still read the default policy.

Round 8 fixes the findings of the 2026-11-09 backfill review, a local Codex review of about 60 merged pull requests
that had no completed review, plus D-09 and D-10 from the round-7 records. Each fix has a test that failed first.

- Library fingerprints turned text results into numbers, so two modules returning different strings (`"!"` and
  `"\""`) both printed `NaN` and `reclaim()` discarded one as a duplicate. Text, booleans and missing values are now
  printed exactly; number and record output is unchanged, so existing fingerprints stay the same.
- `reclaim()` released a duplicate without its grants, so a tenant granted only that entry lost access. The kept entry
  now takes the released entries' grants, and a grant, ungrant or composition plan naming a released entry resolves to
  the kept one, also after the journal is replayed.
- A library refusal recorded in one environment was replayed in another after the entry requalified there. Refusals
  and counterexamples are now kept per environment; older refusals carry none and still apply everywhere.
- G7 compared only the top level of each capability value, so a nested Celsius result relabelled Fahrenheit in
  `glue.json` passed. `capabilityAgreement` now compares record fields by name, list items and `max`, text `maxBytes`,
  and every nested kind, unit, range, precision, rounding, code and label.
- The kernel host's frozen effect declaration kept references to the caller's payload specs, so changing `max_bytes`
  afterwards changed enforcement while its SHA-256 and the Workcell cache key stayed the same. The declaration is now
  deep-copied before it is checked and hashed.
- A `json` effect payload such as `{"x":1e999}` parsed to infinity and passed. Any non-finite number is now refused as
  `payload-not-json`.
- Hillclimb's compose atoms mounted only `/hc-tool`, but `hillclimb.mjs` imports `tools/lib/lock.mjs` and
  `core/runtime/subscription-guard.mjs`, so every compose stage failed at module load after the model atoms finished.
  They now mount each file `hillclimb.mjs` imports at its repository path under `/hc-src`.
- Generated version descriptions said "CI has no secret-scanning job", though the CI job `secret-scan` runs Gitleaks.
  The sentence is now derived from the workflow files. `docs/releases/VDD-main-20261108.md` still carries the old
  sentence (D-13); SECURITY.md is corrected.
- P-70's clustered bootstrap counted a specification drawn twice once, which understated the spec-level interval
  (100 specifications, 1 flagged: upper bound 1.72% instead of 3.00%); P-71 reused it. Both receipts were regenerated
  from their hash-checked rows: P-70's held-out upper bound is 2.57% (was 2.21%), P-71's 6.00% (was 5.46%). B1 was
  missed before and still is.
- P-65's `run.sh` wrote rows `U1` and `U2` while `analyze.mjs` reads `U1a` and `U2a`. They now agree, and an unknown
  step exits 2.
- P-64's streaming tail added two overlapping waits. A turn is now ready at the latest of the final check, the result
  and the last token. Regenerated from the raw rows: the end-to-end drop on H is 1.16% (was 1.13%), and no verdict
  changes.
- `tools/check_comments.py` read only how each line starts, so 20 end-of-line `//` comments passed (D-09). It now lexes
  JavaScript, TypeScript and Rust, so comments after code are found and comment-like text in strings, template literals
  and regular expressions is not; unterminated input exits 2. The 20 comments were removed.
- `verify.mjs` listed `--policy` in its usage but ignored it (D-10). It now loads the named policy and refuses a
  missing or malformed one with exit 2. `ledger-export.mjs` and `repair-noop.mjs` print usage and refuse missing or bad
  arguments with exit 2; a bare `ledger-export.mjs` no longer throws `ENOENT`.
- No automated test showed that a failing test fails `make coverage`; `tests/test_coverage_fails.py` now does.

- The atomizer's `node` toolchain no longer assumes a system Node at `/usr/bin/node`: it defaults to the running Node's install prefix, and a configured home without `bin/node` is refused. Compose atoms failed with `execvp node` on hosts without a system Node, including GitHub's runners (PR #143's coverage job).

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
- Round-6 regression in the atomizer: round 6 made the capability block required at the freeze, but no atomizer
  prompt asked the model for one, and the compose atom's sandbox could not load the gate's modules or find the pinned
  compiler, so every real atomizer run since round 6 failed at the freeze or at G7. The tests use script workers and
  did not show it. Fixed in round 7 (see Changed).

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
