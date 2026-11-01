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
| Evaluator files and configuration | [Frozen evaluator](../../core/ledger/frozen.py), tested by `make ledger-test` | Requires callers to use the freeze and evaluation path |
| Execution policy and routing | [Policy](../../tools/atomizer/policy.json) and [routing](../../tools/atomizer/routing.json) tracked in Git | Local tool paths and model names are not immutable dependency pins |
| CI environment | [Workflow](../../.github/workflows/ci.yml) selects Python and Node versions | Action major-version references and OS packages are not content pins |

The [README](../../README.md) lists local prerequisites. CI's selected runtimes
are visible in its workflow; they do not define the runtime installed on a local
machine. Capture actual runtime identity with `python3 --version`, `node --version`,
`make --version`, and `bwrap --version` when collecting environment evidence.

## Archived placeholders

Unused filler inputs and their placeholder-only directory READMEs are preserved
under `TODELETE/` at their original relative paths. These archives are not active
input guidance. The source example remains in `sources/` because
`tools/check-docs.py` reads it through the digest manifest during `make check`.
The substantive atomizer example also remains at its existing path.

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

## Ledger relocation

The ledger package and its schema are controlled under `core/ledger/`;
`sources/SHA256SUMS` includes their digests using paths relative to `sources/`.
The package move changes Python import and CLI module paths only. Record versions,
SQLite layout, validation, and hash encoding remain unchanged. `make ledger-test`
runs the relocated tests; `make test` and `make test-optimized` also check engine
callers and the scoped core import boundary.

## Engine relocation

Evaluator, gates, frozen-reference adapter, and their tests are controlled under
`core/engine/`. Their digests are listed in `sources/SHA256SUMS`; `make engine-test`
runs the relocated JavaScript tests. Python adapter invocation uses
`core.engine.frozen`; JavaScript gates still import the shared quality helpers
from `tools/factory_quality/index.mjs`. The move preserves evaluator policy,
request and response formats, and test expectations. The Git commit containing
this section identifies the relocation baseline; local verification is recorded
in the verification matrix.

## Runtime relocation

Local agent and stub pools, their README, and synthetic tests are controlled under
`core/runtime/`. `sources/SHA256SUMS` records their digests; `make runtime-test`
uses the relocated test path. Workflow callers resolve the new location while
retaining explicit overrides. CLI, environment, pool state, and replay formats
are unchanged. The Git commit containing this section identifies the relocation
baseline; the verification matrix records local checks.

## Interface baseline

No Cstack adapter or pinned cross-repository protocol is implemented in this
checkout. `core/lifecycle.py` mentions an external bridge in a docstring, but
only models decision references. There is no Cstack ICD to version here.
Recheck with `rg -n -i 'cstack|endoforgeport' core tools tests` before documenting
an interface contract in a later change.

## Domain extraction

Film utilities are archived at `TODELETE/tools/film/` for transfer to
foundation-film. The refrigeration adapter and its README are archived at
`TODELETE/tools/invariants/` for transfer to foundation-refrigeration. These
are byte-preserving Git moves; the destination repository changes are separate.
The digest manifest records all ten archived files at their new paths.
Neither the Makefile nor engine or workflow modules reference these adapters.
Engine checks remain caller-supplied, with synthetic identity checks in tests.
The Git commit containing this section identifies this extraction baseline.
