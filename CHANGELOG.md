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

### Fixed

- `WarmClaudeTransport` honours a caller-supplied usage governor (per transport or per instance).
- A relative `ENDOFORGE_CODEX_CMD` resolves against the caller's working directory.
- The Conductor's collect lock works when the repository is a git worktree.
- Bare runs print usage and exit 2: `testcheck.mjs`, `hc-patch.sh`, `run-atoms.mjs`, `python3 -m tools.x1_ledger`,
  `python3 -m tools.compat_policy`; `bench.mjs` defaults to an atoms file that exists.
- The job tool no longer cites a playbook the repository does not ship; hillclimb `plan-review` works from any
  directory.
- The Rust lane's component runs in the `tools/kernel` Wasmtime workcell.
- Three tool tests that used bare `assert` use `unittest` assertions, so `make test-optimized` checks them.

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
