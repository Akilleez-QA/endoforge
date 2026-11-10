# EndoForge software assurance record

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-SAR |
| Version | 1.6 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-09 |
| Baseline commit | 4d692a41853045c4e013405d8e674528745a38b9 |
| Applies to | endoforge main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

Rolling record of requirements, design, test, code-quality and configuration analyses (SWEHB 5.21, 5.22, 5.23, 5.25,
5.26) and the peer-review summary (5.03). Newest entry first.

## Entry 2026-11-08 — baseline 4d692a4 (NASA documentation re-baseline)

- Analyzed by: agent documentation lane N7 for the Akilleez-QA maintainer. Agent analysis is not independent.
- Inputs: all source, tests, `Makefile`, CI workflow and documents at `4d692a41853045c4e013405d8e674528745a38b9`; the
  accuracy-pass audit tables in PRs #128 and #129; `gh` issue and PR lists; the family documentation standard.
- Environment: Linux, Python 3.14.9 and Node 26.13.0 / 22.23.3 (local); CI definition Python 3.12, Node 22 and 26.

### Requirements analysis

Techniques: comparison of each requirement with the code and the test titles; testability review (every requirement
names a test file and test); orphan check by `tools/check_trace.py`; a search for tested behaviour with no requirement
(every glob-discovered test file) and for code with no test (every tool directory).

Findings:

- The previous SRS had 45 requirements in one table, without derivation, allocation or status fields. The test files
  for the tools, ledger provenance, engine gates, library, contained JavaScript, agent loop and crash behaviour,
  constraint records and repository checks traced to none of them. 50 requirements were added from what those tests
  check; the 45 existing statements were kept, with secondary "shall" clauses reworded so each has one.
- F15 (#130) changed the formula oracle during this pass. The trace check caught the renamed test, and REQ-ORACLE-001
  was updated to branch-by-branch evaluation of piecewise rules.
- Behaviours with no test are registered as GAP-EF-001 to GAP-EF-014 in
  [SRS §11](../requirements/requirements.md#11-untested-behaviour-requirement-gaps), not as requirements. After round
  4 two remained open, each narrowed to the part still untested: GAP-EF-002 (the factory runtime's sandboxed worker
  launch and a completed protected provider call) and GAP-EF-006 (campaign transfer to a real second host). Round 5
  closed both: the sandboxed-worker tests ran and passed on the development host, and the real second-host test
  passed against ds9, a separate machine, on 2026-11-09 (it skips in CI, where `ENDOFORGE_SECOND_HOST` is unset).
  Round 6 opened two: GAP-EF-015 (`tools/gate/gate.mjs freeze` does not require a capability block, while the loop's
  freeze does and `gate run` refuses its absence at G7) and GAP-EF-016 (`make coverage` failing on a test failure and
  the CI `coverage` job, round-6 item M2, not finished). Round 7 closed both: `freeze` now runs the loop's capability
  check, tested by `tools/test_gate_structured.mjs` (REQ-GATECLI-001), and the `coverage` job ran on GitHub in PR
  #142 (run 42709080153) while a deliberately failing test was shown to fail `make coverage-python` (REQ-REPO-009,
  by inspection and that recorded run, not by an automated test). No gap is open.
- Round 7 found a regression from round 6 while closing GAP-EF-015: round 6 made the capability block required at the
  freeze, but no atomizer prompt asked a model for it, and the compose atom's sandbox could not load the gate's own
  modules (`core/`, `tools/asc`) while its `asc` toolchain pointed at a directory that does not exist. Every real
  atomizer run since round 6 would have failed at the freeze or at G7; the atomizer tests use script workers, so they
  did not show it. REQ-ATOM-006 now covers the prompts and the compose sandbox.
- Trace check after the update (`python3 -I tools/check_trace.py`): 95 requirements, 95 traced, 14 gaps, 0 TBD; 97
  discovered test files, 92 traced and 5 supporting; 0 problems. After the round-2 records pass on 2026-11-09: 127
  requirements, 127 traced, 10 gaps; 111 discovered test files, 105 traced and 6 supporting; 0 problems. After the
  round-3 records pass: 133 requirements, 133 traced, 10 gaps; 114 discovered test files, 108 traced and 6
  supporting; 0 problems. After the round-4 records pass: 146 requirements, 146 traced, 2 gaps; 125 discovered test
  files, 119 traced and 6 supporting; 0 problems. After the round-5 records pass: 147 requirement IDs, of which
  REQ-STEP-001 is deleted and traces to its retirement check, 147 traced, 0 gaps; 127 discovered test files, 120
  traced and 7 supporting (one more: the archived step harness tests); 0 problems. After the round-6 records pass: 150
  requirement IDs (one deleted), 150 traced, 2 gaps; 135 discovered test files, 128 traced and 7 supporting; 0
  problems. After the round-7 records pass: 152 requirement IDs (one deleted), 152 traced, 0 gaps; 137 discovered
  test files, 129 traced and 8 supporting (one more: the library-reuse example test); 0 problems.

### Design analysis

Technique: comparison of the design's component table with `git ls-files` and the requirement allocations.

Findings: the previous table had no requirement column and omitted the kernel host, escape measurement, step harness,
hardware record, atomizer, conductor, hillclimb, factory tools, Rust lane and repository checks. All are now components
C-01 to C-31; each lists its requirements. After round 5 every live component has a tested requirement; C-20, the
step harness, is retired to `TODELETE/` with REQ-STEP-001 deleted, because nothing here called it and it needs a POODO
decision core this repository does not have. Round 6 gave C-17, the kernel host, its first caller outside its own
tests: C-26's admission. C-27 and C-30 named the round-6 gaps (GAP-EF-016, GAP-EF-015); round 7 closed both and
allocated REQ-ATOM-006 to C-22 and REQ-REPO-010 (the no-comments check) to C-27.

### Testing analysis

Techniques: matrix rows against the test tree (file discovery plus a literal search for each cited test name); reading
test bodies where a title was ambiguous; the full suites on both Node versions (results in the
[test report](../verification/reports/README.md)).

Findings:

- D-01: three tool tests checked only with `assert` statements, which `make test-optimized` strips (`python3 -O`);
  closed on 2026-11-09.
- `make coverage` measures coverage (Node built-in coverage; coverage.py or trace counts for Python). Its first run,
  on the round-4 worker's tree before integration, reported 90.74% of Node lines; no recorded STR includes a coverage
  run yet, and no coverage target is set. Round 5 added the CI job `coverage`, which uploads the summary as an
  artifact; it had not run on GitHub then. Its worker found that
  `tools/factory_runtime/test_runtime_gaps.py` `Egress.test_run_bounded_outcomes` passes alone but fails when it
  shares one process with the other coverage modules (leaked sqlite connections raise `ResourceWarning`s inside its
  window), so the Python half of the job is expected to fail; and without coverage.py the Makefile's trace fallback
  exits 0 even when a unittest fails. Round 6 fixed the first cause in the test (REQ-FACTORY-003:
  `Egress.test_run_bounded_outcomes` now ignores garbage other modules leave, with a regression test). Making
  `make coverage` fail on any test failure and getting the CI job to pass (item M2) was registered as GAP-EF-016. The
  job first ran in PR #142 (run 42709080153) and passed: Node 953 tests, 0 failed, 93.29% of lines; Python 333 tests
  OK (3 skipped) under coverage.py, 84% in total; artifact `coverage-summary` uploaded. On 2026-11-09 a deliberately
  failing unittest made `make coverage-python` (trace fallback) print `FAILED (failures=1)` and exit 2. GAP-EF-016 is
  closed; no coverage target is set.
- Delegated cgroup enforcement is tested inside a delegated user scope (REQ-ISO-018, GAP-EF-001 closed) and skips
  with its reason elsewhere; it ran on the development host on 2026-11-09, and the GitHub runner result is not
  recorded. The Rust lane runs in its own CI job and passed in PR #139 (run 42600069278).
- Round 4 added eleven test files: ten for formerly untested parts and one for structured synthesis. Run against the
  code before the fixes, they exposed defects, since fixed, in the factory runtime (non-atomic `durable()` writes, scheduler reload, leaked signal handlers,
  unclosed pipes, a crash without Wasmtime), the approved-atoms registry (a failed write took effect on replay),
  repair, `qualify_wasmtime.py` (checked with `assert`, so it passed anything under `python -O`),
  `campaign_transfer.py` (never sent the checkpoint tool or bundle), `resume_stage.py` (symlink escape), the stub pool
  (no `pid=` in its log; SIGTERM not forwarded), `releaseCgroup` (leaked a group when `rmdir` failed), the project
  scheduler, atomizer commands, hillclimb `waveSize`, job kinds and the release-record generator. The
  [CHANGELOG](../../CHANGELOG.md) lists each fix.
- `tools/test_gate_structured.mjs` (REQ-GATECLI-001) is run by `make gate-test`, part of `make test`.
- Round 6 added eight test files (`gaps6-capability`, `gaps6-hostcall` and `gaps6-synthcell` under
  `core/runtime/test/`, `tools/kernel/test_effects.py` and `test_conformance.py`, and `tools/lib/test/lock`,
  `headroom` and `exitfile`) and extended five more. Requiring the capability block at the freeze showed that 25
  existing tests and two examples froze contracts without one; in `loop-review.test.mjs` the weak-test cases had been
  refused at the freeze for that reason instead of the fault they name, so they passed without testing it. They now
  carry agreeing blocks. The new `current`-path `synthCell` test found that a synthesized-evaluator refusal there had
  no `problem` field (fixed). The new `gaps6-hostcall` cases failed against the round-5 pool first; the `tools/lib`
  tests found no defect. Each atom's conductor check passed on 2026-11-09; none of these files is in a recorded STR
  yet, and no CI run of them is recorded.
- The factory runtime's `RealDocker` cases skip on the development host, where the Docker socket needs `sudo` and the
  tests never escalate. They ran and passed on GitHub in PR #142 (run 42709080153), in jobs `test (22)` and
  `test (26)`, in both the repository tests and the optimized Python run, so the runner is now shown working against a
  real Docker daemon.
- `examples/library-reuse.mjs` and its how-to were written to show a third need that misses with `no_capability`.
  Since round 6 the test double's default contract carries a block, so the third need was served from the library.
  Round 7 gave the third need a capability block whose argument range disagrees with the promoted kernel's, so it
  misses with `no_contract_match` and is generated; `core/library/test/library-reuse-example.test.mjs` runs the
  example and checks its three outcomes so it cannot drift unnoticed again.
- Round 7 added two test files (`core/library/test/library-reuse-example.test.mjs` and
  `tools/test_check_comments.py`) and extended `tools/test_gate_structured.mjs` and
  `tools/atomizer/test/commands.test.mjs`. Written before the fixes, three gate tests and six atomizer tests failed
  against the round-6 code (worker report); the new sandboxed compose test exposed the missing gate modules and
  compiler path above.
  Each atom's conductor check passed on 2026-11-09; none of these files is in a recorded STR, and no CI run of round 7
  is recorded.

### Source code quality

| Tool | Command | Findings |
|---|---|---|
| ruff 0.17.0, rules E4, E7, E9 and F with the `ruff.toml` ignores (CI job `lint`) | `make lint` | 0 findings at `b71eebf` on 2026-11-09 ("All checks passed!"). On 2026-11-08 it found 9 F401 unused imports (D-02, now closed) |
| Gitleaks 8.30.1 | `gitleaks git --no-banner --redact --log-opts=HEAD .` | 1 `generic-api-key` match in `experiments/P-51-escape-rate/controls.test.mjs:21`: the synthetic kernel key `synthetic/run/k`, a false positive |
| Privacy lint | `python3 -I tools/check-privacy.py` | 0 failures |
| JavaScript syntax | `node --check` on every `.mjs`, `.js` and `.cjs` (in `make lint`) | 0 failures at `b71eebf`; a syntax check only, no style or semantic lint |
| Comment check (REQ-REPO-010) | `python3 -I tools/check_comments.py` (in `make lint`) | 0 comment lines at `b1b6418` on 2026-11-09, after round 7 removed them (D-07). It counts whole comment lines only in JavaScript, TypeScript, Rust and shell files; 20 end-of-line `//` comments remain (D-09) |

### Configuration audit

- `make check` at the PR head: digests, experiments index and P-number allocation pass (see the PR body).
- Docs versus code: the stale claims found and fixed are in the PR body's docs audit table. Main ones: the verification
  matrix was still the 2026-10-30 eight-row baseline; the runtime README, configuration reference, candidate-loop page
  and CHANGELOG described the pre-#130 oracle ("abstains on piecewise rules").
- Cstack still pins EndoForge `6dffea9` (`contracts/SOURCE-PINS.json` in Cstack, read 2026-11-08); main is ahead of the
  pin. A repin is a Cstack change.
- No release tag exists, so no tag-versus-docs audit applies. The VDD records the digests at its commit.

### Peer review summary

`gh pr list --state merged` on 2026-11-08: 129 merged pull requests; 8 have a GitHub review and 60 have a review or a
comment. No pull request was open when this entry was written. All merges are by the owner or by agent lanes the owner
authorized; agent review is not independent.

### Findings

No issues were filed for these findings; they are reported to the maintainer through this record and the PR.

| ID | Severity | Finding | Location | Status |
|---|---|---|---|---|
| D-01 | S3 | Tests that check only with `assert` statements pass vacuously under `make test-optimized`, which runs them with `python3 -O` | `tools/factory_campaign/test_state.py`, `tools/factory_campaign/test_model_journal.py`, `tools/factory_portability/test_checkpoint.py` (its refusal checks raise `AssertionError` explicitly and still run) | Closed 2026-11-09: `unittest` assertions |
| D-02 | S4 | 9 unused imports (ruff F401) | see Source code quality | Closed 2026-11-09: `make lint` reports none |
| D-03 | S3 | Until 2026-11-09 `WarmClaudeTransport` replaced a caller-supplied `governor` with the default per-login one: the constructor passed `governor === null ? null : undefined` to `governed()`. The defect was which governor was used, not whether one was: both transports call the governor's `admit()` before every turn and its `observe()` on every `rate_limit_event` (`transports.mjs` lines 95, 105, 156 and 277). Now an `instances` entry's `governor`, else the caller's, else the default is used | `core/runtime/x1/transports.mjs:216` | Closed 2026-11-09: REQ-TRANSPORT-002 |
| D-04 | S4 | Referenced inputs missing: `bench.mjs` defaults to `tools/atomizer/examples/C-005/atoms.json`; `lib/ledger.mjs` names a `LEDGER.md` schema; `conduct adopt` points to `tools/conductor/examples`. None exist | `tools/atomizer/`, `tools/conductor/` | Closed 2026-11-09: REQ-ATOM-004, REQ-COND-004 |
| D-05 | S3 | SECURITY.md directs reporters to GitHub private vulnerability reporting, which is disabled for the repository (`gh api repos/Akilleez-QA/endoforge/private-vulnerability-reporting` returns `enabled: false`). SECURITY.md now gives the fallback; enabling it is a repository setting for the owner | `SECURITY.md`, repository settings | Open |
| D-06 | S4 | `main` has no branch protection; CI has no secret-scanning job | repository settings, `.github/workflows/ci.yml` | Secret scan added to CI 2026-11-09; branch protection still open (risk R-6) |
| D-07 | S4 | Code comments exist despite the no-comments rule, for example `tools/conductor/lib/adopt.mjs:5`, `tools/atomizer/lib/ledger.mjs:2`, `tools/atomizer/test/run.mjs:1`, `tools/job/lib/kinds.mjs` (top block) | several files | Closed 2026-11-09 (round 7): the comment lines were removed, usage blocks moved into the programs' usage output, information the docs lacked moved into the tool READMEs and `docs/`, and `tools/check_comments.py` in `make lint` (REQ-REPO-010) reports 0 |
| D-08 | S4 | Stale documentation (verification matrix baseline, oracle wording, missing control documents) | `docs/` | Closed in this PR |
| D-09 | S4 | 20 end-of-line `//` comments remain after code, which `tools/check_comments.py` does not count in JavaScript files (it finds Python end-of-line comments): 15 in `tools/conductor/lib/` (`adopt`, `checks`, `collect`, `daemon`, `handlers`), 5 in `tools/atomizer/` (`bin/backfill.mjs:10`, `bin/speed.mjs:41`, `test/lessons.test.mjs:12`, `test/run.mjs:19` and `:101`) | `tools/conductor/lib/`, `tools/atomizer/` | Open (round 7) |
| D-10 | S4 | `tools/atomizer/bin/verify.mjs` prints `[--policy file]` in its usage and the README listed it, but the program always loads the `policy.json` next to it and ignores the flag. `ledger-export.mjs` and `repair-noop.mjs` print no usage; a bare `ledger-export.mjs` with no ledger throws `ENOENT` | `tools/atomizer/bin/` | Open (round 7); the README now says the flag is ignored |

### Overall assessment

Every requirement traces to tests that exist, and every discovered test file traces to a requirement or is classified.
No behaviour is registered as untested: GAP-EF-015 (the gate CLI's freeze) and GAP-EF-016 (the coverage target and CI
job), opened in round 6, were closed in round 7, after the other fourteen. GAP-EF-016's closure rests on inspection,
the first CI run and one recorded failing-test run, not on an automated test.
The real second-host case and the sandboxed-worker cases skip where their host prerequisites are missing, including in CI for the second host. Assurance is author-side only; no independent review has been performed.

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-08 | `4d692a4` | First entry | this PR |
| 1.1 | 2026-11-09 | round 2 | D-03 restated: the transports always called the governor's `admit()` and `observe()`; the defect was replacing the caller's governor. Gap count 10; the unrun gate CLI test noted | this commit |
| 1.2 | 2026-11-09 | round 3 | Round-3 trace counts; the gate CLI test now runs under `make gate-test` | this commit |
| 1.3 | 2026-11-09 | round 4 | Round-4 trace counts; lint and coverage now exist (D-02 closed); the Rust lane's first CI run passed; two gaps open | this commit |
| 1.4 | 2026-11-09 | round 5 | Round-5 trace counts; GAP-EF-002 and GAP-EF-006 closed (no gap open); C-20 retired; the CI coverage job and its expected Python failure recorded | this commit |
| 1.5 | 2026-11-09 | round 6 | Round-6 trace counts; GAP-EF-015 and GAP-EF-016 opened; the round-6 test files and the defects they exposed; the unrun `RealDocker` cases; C-17 gains a caller | this commit |
| 1.6 | 2026-11-09 | round 7 | Round-7 trace counts; GAP-EF-015 and GAP-EF-016 closed (no gap open); the round-6 atomizer regression; the `RealDocker` cases and the `coverage` job ran in CI; D-07 closed; D-09 and D-10 opened | this commit |
