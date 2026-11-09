# Agent guide

## Read first

Read [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md),
[docs/README.md](docs/README.md), and the README nearest the files you change.
Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and
[SECURITY.md](SECURITY.md) when reporting problems.

## Repository boundaries

- `core/` holds the Python lifecycle model (`core/lifecycle.py`), ledger (`core/ledger/`), constraint records
  (`core/constraints/`), the engine evaluator and gates (`core/engine/`), the kernel library (`core/library/`) and the
  runtime (`core/runtime/`: isolate workcells, the X1 candidate loop, contained JavaScript, model transports, the
  subscription guard, the usage governor, the capacity planner and the dump list). Lifecycle transitions validate
  references without granting authority.
- `tools/` holds workflow tools and repository scripts; [tools/README.md](tools/README.md) lists each.
- `tests/` exercises lifecycle behaviour, the core boundary and the repository checks.
- `experiments/` holds precommitted measurements. Don't rewrite a merged `PRECOMMIT.md` or `RESULT.md`; their hashes are
  recorded.
- `sources/SHA256SUMS` and the index in `experiments/README.md` are generated: run `make sums` and `make index` after
  changing a listed file or an experiment's `INDEX.md`. Reserve a new P-number with `python3 -I tools/experiment_id.py
  reserve <slug>`.
- `docs/` is indexed by [docs/README.md](docs/README.md). Add new docs there.

Keep changes focused. Open an issue before larger work, as CONTRIBUTING requires.
Use synthetic identifiers and local paths in examples. Keep generated evidence
outside the source tree. Do not publish credentials, account directories, home-directory paths,
private inputs, or sensitive receipts; `make check` runs a privacy lint over experiment records.
Model calls must run on a subscription login: the subscription guard refuses anything else, and tests use test doubles.

## Verification

Requirements: Python 3.11+, Node.js 22.8+, GNU Make, and bubblewrap. CI uses Python 3.12 and Node.js 22 and 26 and
installs `age`, bubblewrap and `gcc`. Run `make tools` once per checkout; it installs the pinned wasm-tools and a
Python virtual environment for the kernel tests into `.tools/`.

Run from the repository root:

```sh
make check
make test
make test-optimized
```

`make check` checks Markdown links, source digests, the experiments index, experiment number allocation and the
privacy lint. `make test` includes that check and the test targets in [Makefile](Makefile); `make test-optimized`
repeats the suite with Python optimization enabled. Report commands and actual results,
including failures or unavailable prerequisites. Do not claim unrun checks passed.

Tests are discovered by glob in the Makefile. `tests/test_reachability.py` fails when a test file is not reached by
`make test`. Wire a new test into a target, or list it with a reason in `tests/test-reachability.json`.

## Contributions

Keep claims tied to reproducible evidence. Preserve independent checks and
expected results; do not weaken them to obtain a pass. Add rationale and usage
to documentation instead of code comments. Explain what changed, why, and how it
was verified in the pull request. Contributions use GPL-3.0-only under
[CONTRIBUTING.md](CONTRIBUTING.md).
