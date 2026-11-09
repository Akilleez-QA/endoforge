# EndoForge software configuration management plan

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-SCMP |
| Version | 2.0 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-08 |
| Baseline commit | 0476635f53384e9db6f5743520a4d499c4d24cf5 |
| Applies to | endoforge main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

## 1. Organization and policy

The repository owner (Akilleez-QA) approves and merges every change; `.github/CODEOWNERS` assigns all paths to the
owner. Agent lanes and contributors work on branches and open pull requests. [CONTRIBUTING](../../CONTRIBUTING.md) and
the [agent guide](../../AGENTS.md) set the rules: focused branches, `make check`, `make test` and `make test-optimized`
before merge, expected results and independent checks kept intact. Every runtime setting and its default is listed in
the [configuration reference](configuration-reference.md).

## 2. Configuration identification

Identify a source baseline by its full commit SHA (`git rev-parse HEAD`). Capture local changes with
`git status --short` before using results as evidence.

The repository has no release tags and no released version; `experiment-id/P-*` tags are reservations made by
`tools/experiment_id.py`, not releases. The [changelog](../../CHANGELOG.md) records an Unreleased section. SemVer is the
naming convention for future releases; there is no automated release mechanism. Recorded states are identified by
their [version descriptions](../releases/README.md) (`VDD-main-<date>`).

### 2.1 Controlled inputs

| Input | Existing control | Limit |
|---|---|---|
| Source examples | [Digest manifest](../../sources/SHA256SUMS), checked by `make check` | Covers listed sources, not the entire checkout |
| Lifecycle model | Git revision and `make core-test` | Decision references are supplied by the caller |
| Evaluator files and configuration | [Frozen evaluator](../../core/ledger/frozen.py), tested by `make ledger-test` | Requires callers to use the freeze and evaluation path |
| Execution policy and routing | [Policy](../../tools/atomizer/policy.json) and [routing](../../tools/atomizer/routing.json) tracked in Git | Local tool paths and model names are not immutable dependency pins |
| CI environment | [Workflow](../../.github/workflows/ci.yml) selects Python 3.12 and Node 22 and 26 | Action major-version references and OS packages are not content pins |
| AssemblyScript compiler for the loop | [tools/asc/pin.mjs](../../tools/asc/pin.mjs) digests and `package-lock.json` | Checked by the loop's warm step before use |
| TypeScript checker | [tools/tscheck/pin.mjs](../../tools/tscheck/pin.mjs) digests; `make tscheck-requalify` reruns parity | A version bump needs requalification |
| Kernel test tools | [install_tools.py](../../tools/kernel/install_tools.py) pins Wasmtime 49.0.0 and wasm-tools 1.262.0; `make tools` installs them into `.tools/` | `kernel-test` checks versions first |
| Experiment numbers and index | `experiments/ALLOCATED`, `tools/experiment_id.py`; index generated from `INDEX.md` fragments | Checked by `make check` |

The [README](../../README.md) lists local prerequisites. CI's selected runtimes
are visible in its workflow; they do not define the runtime installed on a local
machine. Capture actual runtime identity with `python3 --version`, `node --version`,
`make --version`, and `bwrap --version` when collecting environment evidence.

The [README](../../README.md) lists local prerequisites. CI's selected runtimes are visible in its workflow; they do
not define the runtime installed on a local machine. Capture actual runtime identity with `python3 --version`,
`node --version`, `make --version`, and `bwrap --version` when collecting environment evidence.

### 2.2 Digest identities

`sources/SHA256SUMS` lists the SHA-256 of controlled sources (91 entries at the baseline, `wc -l sources/SHA256SUMS`
at `0476635`); `make check` verifies it and `make sums` regenerates it. Each version description records the SHA-256
of `sources/SHA256SUMS`, the compiler pin files and lock files, the kernel tool pins, the ledger schema and the kernel
WIT, plus the `git archive` of the commit. Those generated tables are the digest record for a recorded state.

### 2.3 Archived placeholders

Unused filler inputs and their placeholder-only directory READMEs are preserved
under `TODELETE/` at their original relative paths. These archives are not active
input guidance. The source example remains in `sources/` because
`tools/check-docs.py` reads it through the digest manifest during `make check`.
The substantive atomizer example also remains at its existing path.

## 3. Change control

A change is a pull request against `main`, reviewed and merged by the owner. `main` has no branch protection at the
baseline, so the owner's merge is the only enforced control; CI runs on every pull request but is not required to pass
before merge. Agent lanes merge their own pull requests only with the owner's authorization and after the local checks
in the [test plan](../verification/test-plan.md) pass. A change to a default needs a precommitted experiment. A change
to a requirement or test updates the SRS and the verification matrix in the same pull request; `make check` fails on an
untraced requirement or test file.

## 4. Status accounting

- Changes: `CHANGELOG.md` (Keep a Changelog) and the merged pull requests.
- Baselines: control documents carry a baseline commit in their header; the version descriptions carry the full commit.
- Experiments: `experiments/ALLOCATED` and the generated `experiments/README.md` index.
- Open problems: GitHub issues, listed in each version description.

## 5. Generated outputs

| Output | Generator | Inputs | Check |
|---|---|---|---|
| `sources/SHA256SUMS` | `make sums` (`tools/source_sums.py`) | Listed source files | `make check` (`--check`) |
| `experiments/README.md` | `make index` (`tools/experiments_index.py`) | Each experiment's `INDEX.md` fragment | `make check` (`--check`) |
| `experiments/ALLOCATED`, `experiment-id/P-*` tags | `tools/experiment_id.py reserve <slug>` | Git tags | `make check` (`check`) |
| `docs/verification/reports/STR-*.md`, `docs/releases/VDD-*.md` | `tools/gen_release_docs.py` | Recorded `make` logs, `git`, `gh`, `tools/check_trace.py` | Reviewed in the PR; never hand-edited |

No generated source code is shipped. Generated documents are committed with the generator command recorded in their
header.

## 6. Configuration audits

At each recorded state the assurance record gets a configuration-audit entry: the documentation baseline against the
commit, `make check` (digests, index, allocation) and the VDD digests against the files. See the
[assurance record](../assurance/assurance-record.md).

## 7. Release management and delivery

For a future release, review the intended source SHA and test evidence, update the changelog with the chosen SemVer and
date, generate the STR and VDD at that commit, and associate the approved tag with that SHA. This is release guidance,
not a claim that a release or tag exists. No release workflow is present under `.github/workflows/` at this baseline.
Delivery is the public Git repository; Cstack consumes a pinned commit ([Cstack ICD](../icd/icd-cstack.md)). The
[capacity ICD](../interfaces/capacity-icd.md) versions its interface with `INTERFACE_VERSION`.

## 8. Records of earlier baseline moves

These sections record past package moves. They are kept as written.

### Ledger relocation

The ledger package and its schema are controlled under `core/ledger/`;
`sources/SHA256SUMS` includes their digests using paths relative to `sources/`.
The package move changes Python import and CLI module paths only. Record versions,
SQLite layout, validation, and hash encoding remain unchanged. `make ledger-test`
runs the relocated tests; `make test` and `make test-optimized` also check engine
callers and the scoped core import boundary.

### Engine relocation

Evaluator, gates, frozen-reference adapter, and their tests are controlled under
`core/engine/`. Their digests are listed in `sources/SHA256SUMS`; `make engine-test`
runs the relocated JavaScript tests. Python adapter invocation uses
`core.engine.frozen`; JavaScript gates still import the shared quality helpers
from `tools/factory_quality/index.mjs`. The move preserves evaluator policy,
request and response formats, and test expectations. The Git commit containing
this section identifies the relocation baseline; local verification is recorded
in the verification matrix.

### Runtime relocation

Local agent and stub pools, their README, and synthetic tests are controlled under
`core/runtime/`. `sources/SHA256SUMS` records their digests; `make runtime-test`
uses the relocated test path. Workflow callers resolve the new location while
retaining explicit overrides. CLI, environment, pool state, and replay formats
are unchanged. The Git commit containing this section identifies the relocation
baseline; the verification matrix records local checks.

### Domain extraction

Film utilities are archived at `TODELETE/tools/film/` for transfer to
foundation-film. The refrigeration adapter and its README are archived at
`TODELETE/tools/invariants/` for transfer to foundation-refrigeration. These
are byte-preserving Git moves; the destination repository changes are separate.
The digest manifest records all ten archived files at their new paths.
Neither the Makefile nor engine or workflow modules reference these adapters.
Engine checks remain caller-supplied, with synthetic identity checks in tests.
The Git commit containing this section identifies this extraction baseline.

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-08 | `d4d7efa` | Baseline, controlled inputs and release guidance (accuracy pass) | PR #129 |
| 2.0 | 2026-11-08 | `0476635` | Metadata header; organization, change control, status accounting, generated outputs, audits | this PR |
