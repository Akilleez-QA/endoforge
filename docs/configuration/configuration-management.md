# Configuration management

## Baseline and version identity

The implementation baseline is `3083a5a5c277d6caec99eba698f6040698751400`,
obtained with `git rev-parse origin/main` during this documentation pass.
Use a full commit SHA to identify a source baseline. Capture local changes with
`git status --short` before using results as evidence.

`git tag --list` returned no tags in this clone on 2026-10-30.
The [changelog](../../CHANGELOG.md) records an Unreleased section, not a released
version. No released SemVer version is asserted here. SemVer is the standard's
release naming convention for future releases; it is not an existing automated
release mechanism in this repository.

## Controlled inputs

| Input | Existing control | Limit |
|---|---|---|
| Source examples | [Digest manifest](../../sources/SHA256SUMS), checked by `make check` | Covers listed sources, not the entire checkout |
| Lifecycle model | Git revision and `make core-test` | Decision references are supplied by the caller |
| Evaluator files and configuration | [Frozen evaluator](../../tools/ledger/frozen.py), tested by `make ledger-test` | Requires callers to use the freeze and evaluation path |
| Execution policy and routing | [Policy](../../tools/atomizer/policy.json) and [routing](../../tools/atomizer/routing.json) tracked in Git | Local tool paths and model names are not immutable dependency pins |
| CI environment | [Workflow](../../.github/workflows/ci.yml) selects Python and Node versions | Action major-version references and OS packages are not content pins |

The [README](../../README.md) lists local prerequisites. CI's selected runtimes
are visible in its workflow; they do not define the runtime installed on a local
machine. Capture actual runtime identity with `python3 --version`, `node --version`,
`make --version`, and `bwrap --version` when collecting environment evidence.

## Change and release process

[Contributing](../../CONTRIBUTING.md) describes issue discussion for larger work,
focused branches, test execution, and pull request evidence. The repository
[agent guide](../../AGENTS.md) also calls for `make check`, `make test`, and
`make test-optimized`. Keep expected results and independent checks intact.

For a future release, review the intended source SHA and test evidence, update
the changelog with the chosen SemVer and date, and associate the approved tag
with that SHA. This is release guidance, not a claim that a release or tag exists.
No release workflow is present under `.github/workflows/` at this baseline.
This documentation pass creates local commits only.

## Interface baseline

No Cstack adapter or pinned cross-repository protocol is implemented in this
checkout. `core/lifecycle.py` mentions an external bridge in a docstring, but
only models decision references. There is no Cstack ICD to version here.
Recheck with `rg -n -i 'cstack|endoforgeport' core tools tests` before documenting
an interface contract in a later change.
