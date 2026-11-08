# Contributing to EndoForge

Thanks for your interest. Contributions are welcome.

## How to contribute

1. Open an issue describing the problem or proposal before starting larger work.
2. Fork the repository and create a branch from `main`.
3. Keep each pull request small and focused on one change.
4. Run `make check`, `make test` and `make test-optimized` (see [local checks](docs/guides/how-to/local-checks.md)) and make sure they pass.
5. Open a pull request that explains what changed and why, with evidence such as test output or receipts.

## Conventions

Read [docs/README.md](docs/README.md) before writing your own documentation. Keep claims tied to reproducible evidence and examples synthetic.

- Put rationale in documentation, commit messages or the pull request, not in code comments.
- Add a test for a new behaviour. Tests are found by glob; `tests/test_reachability.py` fails if a test file is not
  run by `make test`.
- A change to a default needs a measurement: reserve a P-number with `python3 -I tools/experiment_id.py reserve
  <slug>`, write and commit `PRECOMMIT.md` before the run, then `RESULT.md` and an `INDEX.md` row. Run `make index`.
- Run `make sums` after changing a file listed in `sources/SHA256SUMS`.
- Update the [configuration reference](docs/configuration/configuration-reference.md) when you add or change a setting, and
  [CHANGELOG.md](CHANGELOG.md) for notable changes.
- Don't commit home-directory paths, account names, credentials or email addresses; `make check` runs a privacy lint.

## Licensing of contributions

EndoForge is licensed under GPL-3.0-only. By submitting a contribution, you agree that it is licensed under the same terms.
