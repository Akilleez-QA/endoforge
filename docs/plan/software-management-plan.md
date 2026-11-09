# EndoForge software management plan

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-SMP |
| Version | 1.0 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-08 |
| Baseline commit | 0476635f53384e9db6f5743520a4d499c4d24cf5 |
| Applies to | endoforge main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see §1) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

This plan follows the Cstack family documentation standard. Its canonical copy is published in the
[Cstack repository](https://github.com/Akilleez-QA/cstack/tree/main/docs/standards).

## 1. Software classification (self-assessed)

- Assessed against: NPR 7150.2D Appendix D and NASA-STD-8739.8B §4.2, as an analog. EndoForge is not NASA software
  and no NASA authority has reviewed this assessment.
- Analog class: **Class E** (general-purpose research/technology software). Rationale: runs on general-purpose
  computers; supports no ground test, flight test or operation; a defect affects the productivity of an individual
  user or a small group; it is not used for decisions about an operational system.
- Not Class F: not Agency business or IT infrastructure.
- Safety-critical determination (SWE-205 analog): **not safety-critical.** EndoForge meets none of the five criteria in
  NASA-STD-8739.8B §4.2, and no hazard analysis assigns it a hazard cause, control or mitigation. It generates and
  checks small numeric WebAssembly kernels and commands no hardware.
- EndoForge does execute model-written code and launches model clients. That risk is a security matter, handled by
  workcell isolation and the subscription guard (§7), not a safety function.
- A promotion is a bounded check against frozen tests, not an engineering approval. Anyone who uses a promoted kernel
  in an engineering, safety or regulatory decision takes on the Class D-analog obligations for that use.
- Documentation baseline: Class E with voluntary adoption of the Class D documentation set; see the
  [compliance matrix](compliance-matrix.md).
- Re-evaluation triggers: commanding physical hardware; use in a regulated, safety or production decision path;
  handling personal or secret data beyond local configuration; external deployment as a shared service.
- Assessed by / date / baseline commit: Akilleez-QA maintainer (prepared by an agent documentation lane) / 2026-11-08 /
  `0476635f53384e9db6f5743520a4d499c4d24cf5`.

## 2. Purpose, scope and organization

EndoForge is the Cstack family **engine** repository: an in-isolate software workshop that turns a short need into a
WebAssembly kernel under frozen checks, with a hash-chained evidence ledger ([design](../architecture/architecture.md)).
Cstack (code name Mjölnir) vendors a pinned slice of it ([Cstack ICD](../icd/icd-cstack.md)).

Authority: the repository owner (Akilleez-QA) is the sole approver and merges pull requests. Agent lanes and external
contributors propose changes by pull request. `.github/CODEOWNERS` assigns all paths to the owner. `main` has no branch
protection at the baseline (`gh api .../branches/main/protection` returns 404).

## 3. Life-cycle model and work tracking

Trunk-based development on `main`. Each change is a branch and a pull request; the pull request is the review record
(§6). Work breakdown is the GitHub issue and pull-request list; no milestones exist. Defaults change only after a
precommitted measurement: a P-number reserved with `tools/experiment_id.py`, `PRECOMMIT.md` committed before the run,
then `RESULT.md` ([experiments index](../../experiments/README.md)). No release tag has been created. Cost, staffing,
schedule and CMMI planning: N/A (unfunded single-maintainer open source).

## 4. Engineering and test environment

| Item | Version / source | Where defined |
|---|---|---|
| Python | ≥ 3.11 required; CI runs 3.12 | [AGENTS.md](../../AGENTS.md), `.github/workflows/ci.yml` |
| Node.js | ≥ 22.8 required; CI runs 22 and 26 | [README](../../README.md#quickstart), `.github/workflows/ci.yml` |
| OS packages | `age`, `bubblewrap`, `gcc` (CI installs them with apt) | `.github/workflows/ci.yml` |
| Kernel test tools | Wasmtime 49.0.0 (hash-pinned wheel), wasm-tools 1.262.0, installed by `make tools` into `.tools/` | `tools/kernel/install_tools.py`, `tools/kernel/requirements.txt` |
| Compilers | AssemblyScript 0.28.20; tsrs `@tsrs/wasm` 0.22.0-ts7.1.0-beta; both by `npm ci` from lock files, checked against digests | `tools/asc/`, `tools/tscheck/pin.mjs` |
| Test runners | `node --test`, Python `unittest`, and script tests printing `PASS`/`FAIL` | `Makefile` |
| CI | GitHub Actions on push to `main` and every pull request: job `test`, matrix Node 22 and 26 on `ubuntu-latest`, steps `make tools`, `make -k test`, `make -k test-optimized` | `.github/workflows/ci.yml` |
| Dependency updates | Dependabot for GitHub Actions, monthly | `.github/dependabot.yml` |

## 5. Verification and validation approach

Verification: pull-request review, the automated suites (`make test`, which includes `make check`, and
`make test-optimized`), the trace check and the privacy lint. Records: [verification matrix](../verification/verification-matrix.md),
[test plan](../verification/test-plan.md), [test reports](../verification/reports/README.md),
[assurance record](../assurance/assurance-record.md).

Validation (does it do the intended job): the [getting-started tutorial](../guides/tutorials/getting-started.md) runs
the candidate loop end to end with a scripted model (test plan TP-3). Live model runs are measured in the experiments,
each with a precommitted bar; they are not repeated by CI.

Acceptance criteria for a recorded state (SWE-034): `make check`, `make test` and `make test-optimized` exit 0 on Node
26 and Node 22; the trace check reports zero problems; the STR and VDD are generated at the commit.

## 6. Software assurance

There is one maintainer, so there is **no organizational independence**. Agent reviewers and CI gates provide
separation of method only; agent review is not independent review.

| Gate | Command | Fails on | Record |
|---|---|---|---|
| Repository tests | `make -k test` (CI, Node 22 and 26) | Any failing test target; includes `make check` | CI log; STR |
| Optimized Python | `make -k test-optimized` (CI) | Same targets with `python3 -O` | CI log; STR |
| Links and digests | `tools/check-docs.py`, `tools/source_sums.py --check` (in `make check`) | Broken relative link; stale `sources/SHA256SUMS` | CI log |
| Experiments index and allocation | `tools/experiments_index.py --check`, `tools/experiment_id.py check` | Stale index; duplicate or missing P-number | CI log |
| Privacy lint | `tools/check-privacy.py` | Home paths, account paths or email addresses in experiment records | CI log |
| Trace check | `tools/check_trace.py` | Untraced requirement; missing test; unclassified test file; unallocated component; undocumented environment variable; dead link or anchor | CI log; STR metrics |
| Reachability | `tests/test_reachability.py` | A test file no make target runs | CI log |
| Secret scan | Not in CI. The release-record generator runs Gitleaks when installed | Recorded only | STR; SAR |
| Static analysis | No linter is configured | — | SAR notes the gap |
| Peer review | Pull request with template | Owner does not merge | PR; SAR summary |

## 7. Security, privacy and secure coding

Attack surface: model-written code (AssemblyScript, TypeScript, JavaScript) executed in V8 workcells, forked processes
and contained cohorts; model clients launched as child processes; local SQLite ledgers and journals; caller-supplied
configuration and environment variables ([configuration reference](../configuration/configuration-reference.md)).

Controls in the code: heap, stack, WebAssembly memory and deadline limits per cell; cells with no ambient authority and
bounded host calls; frozen evaluator hashes re-checked at commit; forged receipts refused; process cells optionally in
cgroups; the subscription guard refuses API-key and provider configurations and strips billing variables from child
environments; the usage governor parks calls instead of spending usage credits. Stated limits: thread mode does not
bound off-heap memory (REQ-ISO-013); a thread cell in a blocking native call cannot be interrupted
(`core/runtime/test/isolate-deadline.test.mjs`).

Secrets: none are stored; logins stay in the model clients' own configuration directories, and the agent pool and
generator do not read auth files. Privacy: tests and examples are synthetic; `make check` lints experiment records.
Reporting: [SECURITY.md](../../SECURITY.md). GitHub private vulnerability reporting is disabled at the baseline (finding
D-05), so SECURITY.md also gives the fallback.

## 8. Open-source, reused and vendored components

| Component | License | Pin method | Update policy |
|---|---|---|---|
| AssemblyScript 0.28.20 | Apache-2.0 (per `package-lock.json`) | `tools/asc/package-lock.json`; digests in `tools/asc/pin.mjs` | Version bump plus loop tests |
| `@tsrs/wasm` 0.22.0-ts7.1.0-beta | Apache-2.0 (per `package-lock.json`) | `tools/tscheck/package-lock.json`; module and core digests in `tools/tscheck/pin.mjs` | `make tscheck-requalify` must pass first (REQ-TSC-003) |
| Wasmtime (Python wheel) 49.0.0 | Apache-2.0 WITH LLVM-exception (upstream; not recorded in the repository) | Hash-pinned `tools/kernel/requirements.txt` | Change the pin and rerun `make kernel-test` |
| wasm-tools 1.262.0 | Apache-2.0 WITH LLVM-exception (upstream; not recorded in the repository) | Release archive SHA-256 in `tools/kernel/install_tools.py` | Same |
| GitHub Actions `actions/checkout@v7`, `actions/setup-python@v7`, `actions/setup-node@v7` | their own licenses | Major-version tags | Dependabot PRs |

Reuse by others: GPL-3.0-only; commercial licenses are offered in the README and [NOTICE.md](../../NOTICE.md).
Acquire versus develop (SWE-033): the engine is developed in-house; the compilers and runtimes above are reused.

## 9. Problem reporting and severity

| Severity | Meaning | Response |
|---|---|---|
| S1 | A wrong promotion (a candidate promoted without its evidence), lost acknowledged ledger records, an isolation escape, or a credential or billing exposure | Fix before the next merge |
| S2 | Feature unusable, no workaround | Next change |
| S3 | Feature degraded, workaround exists | Scheduled |
| S4 | Cosmetic or documentation | As convenient |

Problems and change requests use the GitHub issue forms in `.github/ISSUE_TEMPLATE/` (bug report and feature request);
severity is a form field and an `S1`–`S4` label applied at triage. Closure needs a linked pull request that names the
verifying test.

## 10. Configuration management

Baselines are commits; there are no release tags. See the
[configuration management plan](../configuration/configuration-management.md).

## 11. Operations, maintenance and retirement

Changes are analysed in the issue or pull request, implemented on a branch, reviewed and merged by the owner, and
recorded in `CHANGELOG.md`. A change to a default needs a precommitted experiment. Supported versions: only the latest
`main` ([SECURITY.md](../../SECURITY.md)). Delivery: the public Git repository; Cstack consumes a pinned commit.
Users find version data in the [version descriptions](../releases/README.md) and the CHANGELOG. Backup operational
software: N/A; a prior commit is the fallback. Retirement: archive the GitHub repository after a final commit that
states the status in the README.

## 12. Risk register

Reviewed at each recorded state. Likelihood (L) and consequence (C) on 1–5.

| ID | Risk | L | C | Mitigation | Status | Issue |
|---|---|---|---|---|---|---|
| R-1 | Model-written code escapes a workcell or exhausts the host (off-heap memory in thread mode, blocking native calls) | 2 | 4 | Process mode with cgroups; stated limits REQ-ISO-013; deadlines from outside; delegated cgroup enforcement is untested (GAP-EF-001) | Open | — |
| R-2 | A model launch bills an API key or usage credits | 2 | 4 | Subscription guard (exit 78) and usage governor (exit 75); `WarmClaudeTransport` ignores a custom governor (D-03) | Open | — |
| R-3 | A promotion is read as engineering approval | 2 | 3 | README Status, [limitations](../guides/explanation/limitations.md) | Open | — |
| R-4 | Documentation drifts from code under parallel agent lanes | 4 | 2 | `tools/check_trace.py` in `make check`; PR template asks for SRS and matrix updates | Open | — |
| R-5 | Optimized runs give false assurance for tests that use `assert` statements (D-01) | 3 | 2 | Recorded in the assurance record and STR | Open | — |
| R-6 | No branch protection and no secret scanning in CI | 3 | 3 | Owner-only merges; Gitleaks run by the release-record generator | Open | — |
| R-7 | Single maintainer: no independent review | 5 | 2 | Stated plainly; agent review labelled not independent; CI gates | Accepted | — |

## 13. Measurement

Each test report carries a generated metrics block: tests run, passed, failed and skipped per recorded run;
requirement, trace and gap counts; issue and PR counts from `gh`; privacy lint and Gitleaks results; commit and line
counts. Produced by `python3 -I tools/gen_release_docs.py`. Numbers are never typed by hand. No coverage tool is
configured.

## 14. Training

Not applicable. SWEHB 5.15 anticipates one training plan per NASA Center, NPR SWE-017 applies only to Classes A–C, and
the repository has no staff. Contributor onboarding is CONTRIBUTING plus the tutorial.

## 15. Documentation list

The [documentation index](../README.md) lists every control document and guide.

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-08 | `0476635` | Initial baseline | this PR |
