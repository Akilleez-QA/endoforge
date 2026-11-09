# Contributing to EndoForge

Contributions are welcome: bug reports, fixes, measurements and documentation. EndoForge is where coding agents build
software inside V8 isolate workcells; the [system overview](docs/architecture/architecture.md) is the quickest way to
find the part you want to change.

## How to contribute

1. For anything larger than a small fix, open an issue first and describe the problem or proposal.
2. Fork the repository and branch from `main`.
3. Keep each pull request to one change.
4. Run `make check`, `make test` and `make test-optimized` ([run local checks](docs/guides/how-to/local-checks.md)) and
   make sure they pass.
5. Open a pull request that says what changed and why, with evidence such as test output or receipts. The pull request
   template is the peer-review record: it names the reviewers (human or agent; agent review is not independent), the
   findings and the outcome. The owner merges.

CI runs the same commands on every pull request: `make tools`, `make -k test` and `make -k test-optimized`, on Node 22
and 26 with Python 3.12, and in separate jobs `make lint`, `make rust-lane-test` on Rust 1.98.1 and a Gitleaks secret
scan ([workflow](.github/workflows/ci.yml)). Run `make lint` before you push; `make coverage` reports test coverage.

## Conventions

- Add a test for each new behaviour. Tests are found by glob; `tests/test_reachability.py` fails if `make test` does
  not run a test file.
- Put rationale in documentation, commit messages or the pull request, not in code comments.
- A change to a default needs a measurement. Reserve a P-number with `python3 -I tools/experiment_id.py reserve
  <slug>`, commit `PRECOMMIT.md` before the run, then add `RESULT.md` and an `INDEX.md` row and run `make index`.
- Run `make sums` after changing a file listed in `sources/SHA256SUMS`.
- Update the [configuration reference](docs/configuration/configuration-reference.md) when you add or change a setting,
  and [CHANGELOG.md](CHANGELOG.md) for notable changes.
- Keep examples synthetic. Don't commit home-directory paths, account names, credentials or email addresses;
  `make check` runs a privacy lint.

## Documentation changes

Read [docs/README.md](docs/README.md) first. Run every command you show and paste only output you got. The control
documents follow the Cstack family documentation standard, whose checklist is in the
[Cstack standards folder](https://github.com/Akilleez-QA/cstack/tree/main/docs/standards). A change to behaviour
updates the [requirements](docs/requirements/requirements.md) and the
[verification matrix](docs/verification/verification-matrix.md) in the same pull request. `make check` runs
`tools/check_trace.py`, which fails on an untraced requirement or test file, an environment variable missing from the
configuration reference, or a dead link.

## Licensing of contributions

EndoForge is licensed GPL-3.0-only. By submitting a contribution, you agree that it is licensed under the same terms.
