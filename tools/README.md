# Tools

Every tool directory and top-level script under `tools/`. Each line gives what it is, its entry point, and the `make` target that tests it. Run commands from the repository root. "None" means no `make` target exercises it.

## Directories

| Tool | What it is | Entry point | Tested by |
|---|---|---|---|
| [asc](asc/README.md) | Pinned AssemblyScript compiler and its digests and workcell limits for the in-isolate loop | `pin.mjs` | `make loop-test` (installs via `make loop-setup`) |
| [atomizer](atomizer/README.md) | Splits a need into atoms and runs them as a DAG in isolates, with validation, verification and a ledger | `node tools/atomizer/bin/schedule.mjs run <atoms.json> --run-dir <dir>` | `make atomizer-test` |
| [atomizer/examples](atomizer/examples/README.md) | A minimal valid atoms file with one script atom and no model | `example.json` | None |
| [compatibility](compatibility/README.md) | TypeScript binding of `kernel.wit` and a trusted reducer probe | `contract.ts` (`probeTrustedReducer`) | `make compatibility-test` |
| [conductor](conductor/README.md) | Resumable per-job daemon that launches atoms, gates each landed diff, runs checks, then freezes, relaunches or escalates | `node tools/conductor/bin/conduct.mjs <command> <job.json>` | `make lib-test` |
| [escape_harness](escape_harness/README.md) | Escape-rate harness over seeded faults | `harness.py` (`run`, `seeded`), `stats.py` | `make escape-test` |
| [factory_campaign](factory_campaign/README.md) | Hash-chained stage state, a model ownership journal and bounded candidate repair | `state.py`, `model_journal.py`, `repair.py` (modules) | `make factory-state-test` |
| [factory_portability](factory_portability/README.md) | Encrypted campaign checkpoints and offline WASM stage resume on another machine | `checkpoint.py pack\|unpack`, `resume_stage.py`, `qualify_wasmtime.py`, `campaign_transfer.py` | `make portability-test` |
| [factory_quality](factory_quality/README.md) | Typed request, contract, suite freeze, candidate check and qualification | `index.mjs`, `cli.mjs` | `make engine-test` (indirectly) |
| [factory_runtime](factory_runtime/README.md) | Trusted-host runner for one container attempt with checked publication, a scheduler and recovery | `python3 -B -m tools.factory_runtime run\|reconcile` | None |
| [gate](gate/README.md) | Freezes a contract and tests, then checks an AssemblyScript kernel through gates G1 to G7 | `node tools/gate/gate.mjs freeze\|run <dir>` | None |
| [hardware_record](hardware_record/README.md) | Read-only machine record with a quiet gate and noise baseline | `python3 -I tools/hardware_record/record.py collect\|validate\|check-current <dir>` | `make hardware-test` |
| [hillclimb](hillclimb/README.md) | Round-based improvement campaigns with a lessons ledger | `node tools/hillclimb/bin/hillclimb.mjs <command> <campaign.json>` | `make lib-test` |
| [job](job/README.md) | Job intake: checks a job manifest against the POODO gates and invariants, renders the card, compiles prompts, stages or fires | `node tools/job/bin/job.mjs <command> <job.json>` | `make lib-test` |
| [job-locks](job-locks/README.md) | Prints the locked decisions of active jobs for a session-start hook | `python3 -B tools/job-locks/job-locks.py [add\|rm <manifest>]` | `make lib-test` |
| [kernel](kernel/README.md) | Kernel WIT contract validator and Wasmtime component host | `python3 -B -m tools.kernel.contract component.wasm`, `Workcell` | `make kernel-test` (pinned tools via `make tools`) |
| [lib](lib/README.md) | Shared exit-code taxonomy, typed retry, file locks, headroom and exit files | `errors.mjs`, `lock.mjs`, `headroom.mjs`, `exitfile.mjs`, `run-typed` | `make lib-test` |
| [project-scheduler](project-scheduler/README.md) | Runs one cross-project batch of disjoint pieces plus a recombine step under token budgets and an optional GPU queue | `node tools/project-scheduler/scheduler.mjs <batch.json> [--check]` | None |
| [rust_lane](rust_lane/README.md) | Reproducible Rust WASM component build for the P-06 task | `python3 -B -m tools.rust_lane.build <dir>` | `make rust-lane-test` (not in `make test`) |
| [seeded_faults](seeded_faults/README.md) | Seeded semantic fault generator | `generator.py` (`generate`) | `make seeded-fault-test` |
| [step_harness](step_harness/README.md) | Bounded agent step loop that records every step as POODO evidence | `harness.py` (`StepHarness`) | `make harness-test` |
| [tscheck](tscheck/README.md) | Pinned tsrs TypeScript checker in V8 workcells | `checker.mjs`, `port.mjs`, `contained-route.mjs`, `requalify.mjs` | `make tscheck-test`; `make tscheck-requalify` |

## Top-level scripts

| Script | What it is | Entry point | Tested by |
|---|---|---|---|
| [check-docs.py](check-docs.py) | Fails on broken relative Markdown links and on an invalid `sources/SHA256SUMS` | `python3 -I tools/check-docs.py` | `make check`; `make core-test` |
| [check-privacy.py](check-privacy.py) | Fails on home paths, Claude project paths, scratch workspace ids and email addresses in experiment records, except allowlisted files in `privacy-allowlist.json` | `python3 -I tools/check-privacy.py` | `make check`, `make check-privacy`; `make core-test` |
| [experiment_id.py](experiment_id.py) | Checks `experiments/ALLOCATED` and reserves the next P-number | `python3 -I tools/experiment_id.py check\|reserve <slug>` | `make check`; `make core-test` |
| [experiments_index.py](experiments_index.py) | Builds the index in `experiments/README.md` from each probe's `INDEX.md` | `python3 -I tools/experiments_index.py [--check]` (`make index`) | `make check`; `make core-test` |
| [source_sums.py](source_sums.py) | Regenerates or checks `sources/SHA256SUMS` | `python3 -I tools/source_sums.py [--check] [--add PATH ...] [--remove PATH ...]` (`make sums`) | `make check`; `make core-test` |
| [dump_list.py](dump_list.py) | Registers a process's sheddable memory in the memguard dump list and sheds it on `SIGUSR2`; reads `ENDOFORGE_DUMP_LIST` and `XDG_STATE_HOME` | `register(name, priority, measure, shed)` | `make ledger-test` |
| [ledger_writer.py](ledger_writer.py) | Persistent ledger writer with a crash journal, served by the isolate ledger bridge; reads `ENDOFORGE_LEDGER_JOURNAL` and `ENDOFORGE_LEDGER_STATS` | `serve(process, extension)` | `make ledger-test` |
| [x1_loop.py](x1_loop.py) | Ledger-bridge extension that admits, parks and commits X1 promotion decisions | loaded by `core/runtime/x1/loop.mjs` as `tools.x1_loop` | `make loop-test`, `make pipeline-test` |
| [x1_ledger.py](x1_ledger.py) | Freezes the evaluator, registers candidates and decides promotions for the X1 pipeline, JSON on stdin | `python3 -B -m tools.x1_ledger freeze\|register\|promote` | `make pipeline-test`, `make loop-test` |
| [constraint_store.py](constraint_store.py) | Hash-chained JSONL store for constraint records | `JsonlStore(path)` | `make core-test` |
| [library_verify_promotion.py](library_verify_promotion.py) | Verifies promotion decisions against their ledger, one JSON result per row read from stdin | `python3 -B -m tools.library_verify_promotion` | `make library-test` |
| [approved_atoms.py](approved_atoms.py) | Append-only JSONL registry of approved atoms with approval, retirement and consumers | `python3 -I tools/approved_atoms.py --store <file> add\|get\|consumers\|approve\|retire ...` | None |
| [stage-rates.mjs](stage-rates.mjs) | Prints a stage-rates snapshot, once or every second | `node tools/stage-rates.mjs <snapshot.json> [--watch] [--json]` | `make isolate-test` |
| [privacy-allowlist.json](privacy-allowlist.json) | Hash-pinned exceptions for `check-privacy.py` | data | `make check` |

The tests for `dump_list.py` and `ledger_writer.py` are `tools/test_dump_list.py`, `tools/test_ledger_shed.py` and `tools/test_ledger_writer.py`.
