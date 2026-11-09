# EndoForge software assurance record

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-SAR |
| Version | 1.1 |
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
- Ten behaviours have no test and are registered as GAP-EF-001 to GAP-EF-014 (003, 011, 012 and 013 closed) in
  [SRS §11](../requirements/requirements.md#11-untested-behaviour-requirement-gaps), not as requirements.
- Trace check after the update (`python3 -I tools/check_trace.py`): 95 requirements, 95 traced, 14 gaps, 0 TBD; 97
  discovered test files, 92 traced and 5 supporting; 0 problems. After the round-2 records pass on 2026-11-09: 127
  requirements, 127 traced, 10 gaps; 111 discovered test files, 105 traced and 6 supporting; 0 problems.

### Design analysis

Technique: comparison of the design's component table with `git ls-files` and the requirement allocations.

Findings: the previous table had no requirement column and omitted the kernel host, escape measurement, step harness,
hardware record, atomizer, conductor, hillclimb, factory tools, Rust lane and repository checks. All are now components
C-01 to C-31; each lists its requirements or names its gap (C-28, the release-record generator, and C-29 to C-31).

### Testing analysis

Techniques: matrix rows against the test tree (file discovery plus a literal search for each cited test name); reading
test bodies where a title was ambiguous; the full suites on both Node versions (results in the
[test report](../verification/reports/README.md)).

Findings:

- D-01: three tool tests checked only with `assert` statements, which `make test-optimized` strips (`python3 -O`);
  closed on 2026-11-09.
- No coverage tool is configured, so coverage is not measured.
- Delegated cgroup enforcement is skipped without a delegated scope (GAP-EF-001). The Rust lane runs in its own CI
  job from 2026-11-09 (GAP-EF-013 closed; first run pending).
- `tools/test_gate_structured.mjs` (REQ-GATECLI-001) is run by no `make` target, so `tests/test_reachability.py`
  fails on it and `make test` is red until it is wired in or listed with a reason.

### Source code quality

| Tool | Command | Findings |
|---|---|---|
| ruff 0.17.0, rules E9 and F (not in CI) | `ruff check --no-cache --isolated --select E9,F $(git ls-files '*.py')` | 9 F401 unused imports in 105 tracked Python files: `tools/factory_runtime/wasm.py` ×3, `runner.py` ×2, `egress.py`, `local_provider.py`, `recovery.py`, `tools/factory_portability/campaign_transfer.py` (D-02) |
| Gitleaks 8.30.1 | `gitleaks git --no-banner --redact --log-opts=HEAD .` | 1 `generic-api-key` match in `experiments/P-51-escape-rate/controls.test.mjs:21`: the synthetic kernel key `synthetic/run/k`, a false positive |
| Privacy lint | `python3 -I tools/check-privacy.py` | 0 failures |
| JavaScript lint | none configured | not run |

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
| D-02 | S4 | 9 unused imports (ruff F401) | see Source code quality | Open |
| D-03 | S3 | Until 2026-11-09 `WarmClaudeTransport` replaced a caller-supplied `governor` with the default per-login one: the constructor passed `governor === null ? null : undefined` to `governed()`. The defect was which governor was used, not whether one was: both transports call the governor's `admit()` before every turn and its `observe()` on every `rate_limit_event` (`transports.mjs` lines 95, 105, 156 and 277). Now an `instances` entry's `governor`, else the caller's, else the default is used | `core/runtime/x1/transports.mjs:216` | Closed 2026-11-09: REQ-TRANSPORT-002 |
| D-04 | S4 | Referenced inputs missing: `bench.mjs` defaults to `tools/atomizer/examples/C-005/atoms.json`; `lib/ledger.mjs` names a `LEDGER.md` schema; `conduct adopt` points to `tools/conductor/examples`. None exist | `tools/atomizer/`, `tools/conductor/` | Closed 2026-11-09: REQ-ATOM-004, REQ-COND-004 |
| D-05 | S3 | SECURITY.md directs reporters to GitHub private vulnerability reporting, which is disabled for the repository (`gh api repos/Akilleez-QA/endoforge/private-vulnerability-reporting` returns `enabled: false`). SECURITY.md now gives the fallback; enabling it is a repository setting for the owner | `SECURITY.md`, repository settings | Open |
| D-06 | S4 | `main` has no branch protection; CI has no secret-scanning job | repository settings, `.github/workflows/ci.yml` | Secret scan added to CI 2026-11-09; branch protection still open (risk R-6) |
| D-07 | S4 | Code comments exist despite the no-comments rule, for example `tools/conductor/lib/adopt.mjs:5`, `tools/atomizer/lib/ledger.mjs:2`, `tools/atomizer/test/run.mjs:1` | several files | Open |
| D-08 | S4 | Stale documentation (verification matrix baseline, oracle wording, missing control documents) | `docs/` | Closed in this PR |

### Overall assessment

Every requirement traces to tests that exist, and every discovered test file traces to a requirement or is classified.
Ten behaviours remain untested (GAP-EF-003, GAP-EF-011, GAP-EF-012 and GAP-EF-013 were closed on 2026-11-09). Assurance is author-side only; no independent review has been performed.

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-08 | `4d692a4` | First entry | this PR |
| 1.1 | 2026-11-09 | round 2 | D-03 restated: the transports always called the governor's `admit()` and `observe()`; the defect was replacing the caller's governor. Gap count 10; the unrun gate CLI test noted | this commit |
