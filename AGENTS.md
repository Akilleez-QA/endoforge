# Agent guide

## Read first

Read [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md),
[docs/README.md](docs/README.md), and the README nearest the files you change.
Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and
[SECURITY.md](SECURITY.md) when reporting problems.

## Repository boundaries

- `core/` contains the Python lifecycle model. It models proposals and decisions;
  it does not execute agents or grant authority.
- `tools/` contains execution, ledger, evaluation, and scheduling utilities,
  including Python and JavaScript modules.
- `tests/` exercises lifecycle behavior and the core boundary.
- `campaigns/`, `experiments/`, and `docs/` provide guidance for supplying inputs.
- `sources/SHA256SUMS` records source digests checked by `make check`.

Keep changes focused. Open an issue before larger work, as CONTRIBUTING requires.
Use synthetic identifiers and local paths in examples. Keep generated evidence
outside the source tree. Do not publish credentials, account directories,
private inputs, or sensitive receipts.

## Verification

The README requires Python 3.11+, Node.js 20+, GNU Make, and bubblewrap for
isolate checks. CI uses Python 3.12 and Node.js 22 and installs `age` and bubblewrap.
Public agent clients are optional; tests use synthetic inputs and stubs.

Run from the repository root:

```sh
make check
make test
make test-optimized
```

`make check` checks Markdown links and source digests. `make test` includes that
check and the test targets in [Makefile](Makefile); `make test-optimized` repeats
the suite with Python optimization enabled. Report commands and actual results,
including failures or unavailable prerequisites. Do not claim unrun checks passed.

## Contributions

Keep claims tied to reproducible evidence. Preserve independent checks and
expected results; do not weaken them to obtain a pass. Add rationale and usage
to documentation instead of code comments. Explain what changed, why, and how it
was verified in the pull request. Contributions use GPL-3.0-only under
[CONTRIBUTING.md](CONTRIBUTING.md).
