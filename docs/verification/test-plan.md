# EndoForge software test plan and procedures

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-STP |
| Version | 1.8 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-10 |
| Baseline commit | 4d692a41853045c4e013405d8e674528745a38b9 |
| Applies to | endoforge main at baseline commit, plus the trace and release-record tooling added in this re-baseline |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

## 1. Scope and approach

The automated tests are the test procedures for every T requirement. They use synthetic inputs and test doubles; no
test calls a live model service. Test files are discovered by glob in the `Makefile`, and `tests/test_reachability.py`
fails when a discovered test file is run by no target. The Python targets run twice: normally and with `python3 -O`
(`make test-optimized`). Procedures TP-1 to TP-8 below cover runs that are not a single test file. Formal witnessing:
N/A; the owner's merge is the sign-off. How-to detail: [run local checks](../guides/how-to/local-checks.md).

## 2. Test levels and targets

`make test` runs every target below, plus `make check`. Commands are those in the `Makefile`.

| Level | Target | What it runs |
|---|---|---|
| Repository consistency | `check` | `tools/check-docs.py`, `tools/experiments_index.py --check`, `tools/source_sums.py --check`, `tools/experiment_id.py check`, `tools/check-privacy.py`, `tools/check_trace.py` |
| Unit (Python core and repository) | `core-test` | `python3 -B -m unittest discover -s tests -v` |
| Unit (ledger, writer, dump list) | `ledger-test` | `core/ledger/test_*.py`, `tools/test_*.py` |
| Unit (engine) | `engine-test` | `node --test core/engine/*.test.mjs` |
| Integration (workcells, contained JS, capacity, transports, oracle, the gap-closure tests) | `isolate-test` | `loop-setup` and `tscheck-setup` first, then `core/runtime/test/*.test.mjs` except the loop, pipeline, retry and agent-pool files |
| Integration (X1 pipeline) | `pipeline-test` | `x1*`, `generator*`, `promotion*`, `synth*`, `pipeline-contained*` tests |
| Integration (retry) | `pipeline-retry-test` | `pipeline-fallback*`, `pipeline-retry*` tests |
| System (candidate loop, crash) | `loop-test` | `npm ci` in `tools/asc`, then `core/runtime/test/loop*.test.mjs` |
| Integration (TypeScript checker) | `tscheck-test` | `npm ci` in `tools/tscheck`, then `tools/tscheck/test/*.test.mjs` |
| Tools | `atomizer-test`, `harness-test`, `hardware-test`, `runtime-test`, `lib-test`, `library-test`, `portability-test`, `factory-state-test`, `seeded-fault-test`, `escape-test`, `compatibility-test`, `gate-test` | The test files under each tool |
| Tools (round 4) | `gap-tools-test` | `tools/factory_runtime/test_runtime_gaps.py`, `tools/test_approved_atoms.py`, `tools/test_gen_release_docs.py`, `tools/test_check_comments.py` (round 7), `tools/project-scheduler/test/scheduler.test.mjs` |
| Kernel host | `kernel-test` | Version check of `.tools/`, then `tools/kernel/test_*.py` |
| Experiment receipt | `receipt-test` | `experiments/P-19-need-to-candidate/verify.py` |
| Experiment analysis (round 8) | `experiments-test` | Every `experiments/*/analyze.test.mjs` except P-51's `controls.test.mjs` (today P-64, P-65, P-70 and P-71) |
| Regression | CI `test` job | `make -k test` and `make -k test-optimized` on Node 22 and 26 |
| Rust lane | CI `rust-lane` job | `make tools`, then `make rust-lane-test` on Rust 1.98.1 |
| Static analysis | `lint`; CI `lint` job | ruff 0.17.0 with `ruff.toml`, `tools/check_comments.py` (no code comment lines, REQ-REPO-010), and `node --check` on every `.mjs`, `.js` and `.cjs` file |
| Coverage | `coverage`; CI `coverage` job | Node suites under `--experimental-test-coverage`; Python under coverage.py, else trace counts. The CI job installs coverage.py 7.10.7, runs `make coverage -k` and uploads `coverage-summary.txt` as the artifact `coverage-summary` |

Outside `make test`: `make rust-lane-test` (needs the pinned Rust toolchain, TP-6; CI runs it in its own job),
`make lint` and `make coverage` (CI runs each in its own job), `make tscheck-requalify` (TP-7) and the P-51 controls (TP-8). The glue gate CLI test runs in `make test` through
`make gate-test`.

## 3. Test environment

| Item | Values | Source |
|---|---|---|
| OS | `ubuntu-latest` (GitHub-hosted) in CI; any Linux locally, recorded in the STR | `.github/workflows/ci.yml` |
| Python | 3.12 in CI; ≥ 3.11 required | `.github/workflows/ci.yml`, [AGENTS.md](../../AGENTS.md) |
| Node.js | 22 and 26 in CI (matrix); ≥ 22.8 required | `.github/workflows/ci.yml` |
| OS packages | `age`, `bubblewrap`, `gcc` | `.github/workflows/ci.yml` |
| Kernel tools | Wasmtime 49.0.0 and wasm-tools 1.262.0 via `make tools` | `tools/kernel/install_tools.py` |
| Network | `npm ci` in `loop-setup` and `tscheck-setup`, and `make tools`, need network once | `Makefile` |
| Output | `ENDOFORGE_TEST_OUTPUT` (default `.test-work/`) and `ENDOFORGE_USAGE_STATE` set by the `Makefile` | `Makefile` |

## 4. Pass criteria and acceptance

- `make check`, `make test` and `make test-optimized` exit 0 on Node 26 and on Node 22.
- Zero failed tests. Skips are allowed only where a test states a missing prerequisite (for example the delegated
  cgroup cases in `isolate-offheap.test.mjs` and `gaps4-runtime.test.mjs`, the Wasmtime CLI case, `RealPinnedWasmtime`
  and `RealDocker` in `test_runtime_gaps.py`, and the transfer cases without `age` or `bwrap`); the STR lists skip
  counts.
- `make lint` exits 0.
- Trace check: zero problems.
- A run killed or timed out by host load may be rerun once for that single file; the STR or PR records the rerun.

## 5. Coverage

`make coverage` measures line, branch and function coverage of the Node suites with Node's built-in coverage, and
Python coverage with coverage.py when it is installed (else `python3 -m trace` line counts, which give no percentage).
No coverage target is set, and coverage is not a pass criterion. The first run, on the round-4 worker's tree before
integration, reported 822 Node tests passing, 1 skipped, with 90.74% of lines covered across all files, and 230
Python tests OK under trace counts; a recorded STR has not yet included a coverage run. The trace check gives
file-level coverage of requirements as well: every discovered test file traces to a requirement or is listed as
supporting. Round 6 made `Egress.test_run_bounded_outcomes` ignore the `ResourceWarning`s other modules leak into a
shared process (REQ-FACTORY-003). The CI `coverage` job first ran in PR #142 (run 42709080153) and passed: Node 953
tests, 0 failed, 93.29% of lines; Python 333 tests OK (3 skipped) under coverage.py 7.10.7, 84% in total; the
`coverage-summary` artifact was uploaded. A failing test fails `make coverage` in either Python mode: on 2026-11-09 a
deliberately failing unittest made `make coverage-python` print `FAILED (failures=1)` and exit 2 under the trace
fallback (GAP-EF-016 closed, REQ-REPO-009). Since round 8 `tests/test_coverage_fails.py`, in `make core-test`, runs
the real `make coverage-node`, `make coverage-python` (trace fallback and coverage.py branch) and `make coverage`
against a temporary failing test and its passing twin and checks the exit codes; where coverage.py is not installed
its branch runs through a stand-in module, which checks the Makefile wiring, not coverage.py itself. MC/DC: N/A (not
safety-critical, SWE-219).

## 6. Test data and fixtures

All data is synthetic: fixtures under `core/runtime/test/fixtures/`, `tests/fixtures/`, `tools/atomizer/test/fixtures/`
and values built inside the tests. Model calls use labelled test doubles (fake Codex and Claude scripts). No private or
external data is used.

## 7. Procedures

Automated tests: the code is the procedure. Run one Node file with `node --test <file>` and one Python module with
`python3 -B -m unittest <module>` from the repository root.

### TP-1 — Full suite, both Node versions

- Purpose / requirements: all T requirements.
- Preconditions: `make tools` done once; network for the first `npm ci`.
- Steps, for Node 26 and again with Node 22 first on `PATH`:
  ```sh
  make check
  make test ENDOFORGE_TEST_OUTPUT="$(mktemp -d)"
  ```
- Expected result: each command exits 0.
- Last run: recorded in the [test reports](reports/README.md).

### TP-2 — Optimized Python suite

- Purpose: the code must not depend on `assert`.
- Steps: `make test-optimized ENDOFORGE_TEST_OUTPUT="$(mktemp -d)"` on both Node versions.
- Expected result: exit 0. The three tool tests that used bare `assert` now use `unittest` assertions (D-01 closed).
- Last run: recorded in the test reports.

### TP-3 — Getting-started tutorial

- Purpose / requirements: validation of REQ-LOOP-001, REQ-LOOP-002 and REQ-PROMOTE-001 by a user path.
- Preconditions: a fresh clone; Node ≥ 22.8; network for `make loop-setup`.
- Steps: the commands in the [tutorial](../guides/tutorials/getting-started.md), sections 2 to 7.
- Expected result: `make check` exits 0; `first-loop.mjs` prints `"promoted": true` with ledger kinds `task`,
  `admitted_input`, `frozen_evaluator`, `candidate`, `receipt`; `first-loop.mjs wrong` prints `"promoted": false` with
  `exit` `max_turns`.
- Last run: 2026-11-08 at `4d692a4` in a fresh clone, Node 26.13.0: as expected (see the assurance record).

### TP-4 — Secret scan

- Purpose: no credentials in history. CI also runs this as the `secret-scan` job.
- Steps: `gitleaks git --no-banner --redact --log-opts=HEAD .`
- Expected result: `no leaks found`.
- Last run: recorded in the STR (the generator runs it when Gitleaks is installed).

### TP-5 — Release records

- Purpose: generate the STR and VDD from recorded runs.
- Preconditions: committed tree at the commit to record; logs from TP-1 and TP-2, each starting with `# node: <version>`,
  `# python: <version>` and `# command: <command>` lines and ending with a `make-exit=<status>` line.
- Steps:
  ```sh
  python3 -I tools/gen_release_docs.py --name main-<date> --pr <n> --since <previous baseline> \
    --log node26-test=<log> --log node26-test-optimized=<log> --log node22-test=<log> --log node22-test-optimized=<log>
  ```
  then copy the logs' digests from the STR, commit the two records and the two index rows.
- Expected result: exit 0; the STR states no failed run and zero trace problems.
- Last run: 2026-11-08, this re-baseline.

### TP-6 — Rust lane (manual)

- Purpose / requirements: REQ-RUST-001.
- Preconditions: the pinned Rust toolchain from `tools/rust_lane/README.md`.
- Steps: `make rust-lane-test` (runs `make rust-lane-setup` first). CI runs the same target in the `rust-lane` job
  from 2026-11-09.
- Expected result: exit 0.
- Last run: CI, PR #139, run 42600069278, job `rust-lane` at `def5f24`: 15 tests OK, exit 0. Not run locally in this
  baseline. Round 6 added the admission cases: `make kernel-test rust-lane-test` passed as the round-6 conductor check
  on 2026-11-09 (worker report: 23 Rust lane tests OK in 472 s); no CI run of them is recorded.

### TP-7 — TypeScript checker requalification (manual)

- Purpose / requirements: REQ-TSC-003 on a real workload after a tsrs version bump.
- Steps: `make tscheck-requalify WORK=<workload directory> TSC=<tsc path>`; see `tools/tscheck/README.md`.
- Expected result: exit 0 with a report naming no difference.
- Last run: not run in this baseline; the requalification logic itself is tested by `requalify.test.mjs`.

### TP-8 — P-51 controls (manual)

- Purpose: the escape-rate controls behind P-51.
- Steps: as in `experiments/P-51-escape-rate/RESULT.md`, with `ENDOFORGE_ASC_CMD` set to AssemblyScript 0.28.20.
- Last run: as recorded in that result; not rerun in this baseline.

Live model runs (experiments) follow each experiment's `PRECOMMIT.md`; they are measurements, not regression tests.

## 8. Test risks and limitations

- Tests are written by the authors of the code; they are not independent or blind evaluation.
- Test doubles stand in for model clients; compatibility with a live client is not established by the suite.
- Timing assertions can be disturbed by host load; `core/runtime/test/fixtures/timing.mjs` lets a run report them as
  skipped under load only when opted in.
- Delegated cgroup enforcement (REQ-ISO-018) is checked only where a delegated user scope exists; it ran on the
  development host on 2026-11-09, and whether it runs or skips on the GitHub runner is not recorded.
- No behaviour is registered as untested
  ([SRS §11](../requirements/requirements.md#11-untested-behaviour-requirement-gaps)); GAP-EF-015 and GAP-EF-016 were
  closed in round 7. Since round 8 an automated test checks that a failing test fails `make coverage`.
- Round 8's defects (from a backfill review of merged pull requests) all sat inside requirements whose tests passed:
  no test reached the failing case. The new tests reproduce each reported case; other untested cases of the same kind
  may remain.
- Tests that need a timeout or a process to appear can fail under heavy host load. Round 9 made the bridge-death test
  in `core/runtime/test/isolate-pool.test.mjs` wait for the pool's own bridge pid instead of reading the process's
  children once (it failed in CI on Node 26 under load). `core/runtime/test/gaps4-synth.test.mjs` S1 still fails with
  "M2 reference sandbox failed or timed out" when several full suites run at once (finding D-14): the reference
  sandbox has one 30-second wall-clock limit over all its reference calls.
- The atomizer tests use script workers and fixtures. Round 6's regression (no prompt asked for the capability block)
  passed them all; round 7 added tests that assert on the rendered prompt text and run the compose helper in a real
  sandbox, but a real model run is still not part of the suite.
- Some cases skip with their reason where the host lacks a prerequisite: the sandboxed factory workers need `bwrap`,
  a systemd user manager and unprivileged namespaces (a local-provider turn no longer needs `node` or `codex`); the
  real second-host transfer needs `ENDOFORGE_SECOND_HOST` and skips in CI, where it is unset (it passed against a
  separate machine on 2026-11-09); `RealPinnedWasmtime` needs `make tools` and a systemd user manager; `RealDocker`
  needs a Docker daemon reachable without `sudo` and a local image: it skips on the development host and ran and
  passed in CI in PR #142 (run 42709080153); the two hillclimb compose-mount cases that start `bwrap` skip where it
  cannot start (they ran on 2026-11-09, 26 of 26 hillclimb tests with none skipped).

## 9. Traceability

See the [verification matrix](verification-matrix.md).

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-08 | `4d692a4` | Initial baseline | this PR |
| 1.1 | 2026-11-09 | round 2 | TP-6 runs in CI; gap count 10 | this commit |
| 1.2 | 2026-11-09 | round 3 | The glue gate CLI test runs in `make test` through `make gate-test` | this commit |
| 1.3 | 2026-11-09 | round 4 | `gap-tools-test`, `lint` and `coverage` targets; coverage section; TP-6 records its first CI run; gap count 2 | this commit |
| 1.4 | 2026-11-09 | round 5 | CI `coverage` job; `harness-test` runs the step harness retirement check; no gap open | this commit |
| 1.5 | 2026-11-09 | round 6 | New skip cases (`RealPinnedWasmtime`, `RealDocker`); TP-6 records the round-6 admission cases; the coverage section and §8 record GAP-EF-015 and GAP-EF-016 | this commit |
| 1.6 | 2026-11-09 | round 7 | `lint` runs the no-comments check; `gap-tools-test` runs its test; the coverage section records the first CI `coverage` run and a failing-test run (GAP-EF-016 closed); §8 records no open gap, the script-worker limit of the atomizer tests and the first `RealDocker` run | this commit |
| 1.7 | 2026-11-09 | round 8 | `experiments-test` runs the experiment analysis tests in `make test`; the coverage section and §8 record the automated failing-test coverage check and the backfill-review lesson; the hillclimb compose-mount skip case | this commit |
| 1.8 | 2026-11-10 | round 9 | §8 records the load-sensitive tests: the bridge-death test's pid-based wait (round 9) and the open `gaps4-synth` reference-sandbox timeout (D-14) | this commit |
