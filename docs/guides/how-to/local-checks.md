# Run local checks

Run from the repository root with Python 3.11+, Node.js 22.8+, GNU Make, bubblewrap, `age` and `gcc` installed.
CI runs Python 3.12 with Node 22 and Node 26; see [the workflow](../../../.github/workflows/ci.yml).

```sh
make tools
make check
make test ENDOFORGE_TEST_OUTPUT="$(mktemp -d)"
make test-optimized ENDOFORGE_TEST_OUTPUT="$(mktemp -d)"
```

`make tools` runs once per checkout. It installs the pinned wasm-tools and a Python virtual environment for the
kernel tests into `.tools/`; `make kernel-test` checks their versions first. `make loop-setup` and `make tscheck-setup`
run `npm ci` for the pinned compilers and are run by `make test` itself, so the first run needs network access.

`make check` runs five checks:

| Check | Script |
|---|---|
| Local Markdown links and `sources/SHA256SUMS` | `tools/check-docs.py` |
| The experiments index matches each experiment's `INDEX.md` | `tools/experiments_index.py --check` |
| Source digests | `tools/source_sums.py --check` |
| Every experiment number is allocated once | `tools/experiment_id.py check` |
| No home paths, account paths or email addresses in experiment records | `tools/check-privacy.py` |

It does not check external URLs. `make index` and `make sums` regenerate the index and the digests.

`make test` includes `make check` and every test target in the [Makefile](../../../Makefile). Tests are found by
glob, and `tests/test_reachability.py` fails when a test file is not run by any target. `make test-optimized` repeats
the targets with Python optimization enabled. Run a single area with its target, for example `make engine-test`,
`make isolate-test`, `make loop-test` or `make kernel-test`. Synthetic inputs and test doubles do not establish
compatibility with a live agent client or external host.

To run the suite on both Node versions, put the other Node first on `PATH`:

```sh
PATH=/path/to/node-22/bin:$PATH make test ENDOFORGE_TEST_OUTPUT="$(mktemp -d)"
```

Each `mktemp` invocation creates a separate output directory outside the checkout. Keep those directories as local
evidence. Without an explicit override, Make uses `.test-work` inside the repository. The override must be on the
make command line, not in the environment. Do not publish sensitive receipts or private inputs.

Record `git rev-parse HEAD`, runtime versions, commands, exit statuses, failures, and skipped checks with the result.
A successful local run does not replace PR CI or independent review. See the
[verification matrix](../../verification/verification-matrix.md) for requirement coverage and historical evidence.
