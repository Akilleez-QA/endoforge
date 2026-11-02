# Run local checks

Run from the repository root with Python 3.11+, Node.js 20+, GNU Make, and
bubblewrap installed. Hosted CI also installs `age`; its Python and Node versions
are selected in [the workflow](../../../.github/workflows/ci.yml).

```sh
make check
make test ENDOFORGE_TEST_OUTPUT="$(mktemp -d)"
make test-optimized ENDOFORGE_TEST_OUTPUT="$(mktemp -d)"
```

`make check` checks local Markdown links and `sources/SHA256SUMS`. It does not
check external URLs. `make test` includes that check and the Python and JavaScript
suites selected in [Makefile](../../../Makefile). `make test-optimized` repeats
those targets with Python optimization enabled. Synthetic inputs and stubs do
not establish compatibility with a live agent client or external host.

Each `mktemp` invocation creates a separate output directory outside the checkout.
Keep those directories as local evidence. Without an explicit override, Make uses
`.test-work` inside the repository. Do not publish sensitive receipts or private
inputs.

Record `git rev-parse HEAD`, runtime versions, commands, exit statuses, failures,
and skipped checks with the result. A successful local run does not replace PR
CI or independent review. See the [verification matrix](../../verification/verification-matrix.md)
for requirement coverage and historical evidence.
