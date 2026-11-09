# Run local checks

This page shows how to run the same checks CI runs, on your machine, before you open a pull request.

## What you need

- Python 3.11 or later, Node.js 22.8 or later and GNU Make. CI uses Python 3.12 with Node 22 and Node 26
  ([the workflow](../../../.github/workflows/ci.yml)).
- bubblewrap (`bwrap`), `age` and `gcc`, which some test areas use. CI installs them with apt.
- Network access the first time, for the pinned tools and compilers.

## Run everything

From the repository root:

```sh
make tools
make check
make test ENDOFORGE_TEST_OUTPUT="$(mktemp -d)"
make test-optimized ENDOFORGE_TEST_OUTPUT="$(mktemp -d)"
```

`make tools` runs once per checkout. It installs the pinned wasm-tools 1.262.0 and a Python virtual environment with
wasmtime 49.0.0 into `.tools/`, which the kernel tests use; `make kernel-test` checks both versions before it starts.
`make test` runs `npm ci` for the pinned AssemblyScript compiler (`make loop-setup`) and the TypeScript checker
(`make tscheck-setup`) itself.

`make test-optimized` runs the whole suite again with Python's `-O`, which strips `assert` statements, so a test that
relies on `assert` for its checks fails there.

## The repository checks

`make check` takes about a second and runs seven scripts. `make test` runs it too.

| Script | What it checks |
|---|---|
| `tools/check-docs.py` | Local Markdown links resolve, and `sources/SHA256SUMS` is consistent. |
| `tools/experiments_index.py --check` | `experiments/README.md` matches each experiment's `INDEX.md`. |
| `tools/source_sums.py --check` | Source file digests. |
| `tools/experiment_id.py check` | Every experiment number is allocated once. |
| `tools/check-privacy.py` | No home paths, account paths or email addresses in experiment records. |
| `tools/check_trace.py` | Requirements trace to tests and design, every test file is classified, every environment variable the code reads is in the [configuration reference](../../configuration/configuration-reference.md), and relative links and anchors resolve. |
| `tools/gen_data_dictionary.py --check` | The [data dictionary](../../data/data-dictionary.md) matches the schema files. |

External URLs are not checked. To regenerate what the checks compare against, run `make index` (experiments index),
`make sums` (source digests) or `python3 -I tools/gen_data_dictionary.py` (data dictionary).

## Run one area

Each test area has its own target, which is faster while you work:

| Target | Runs |
|---|---|
| `make loop-test` | The agent loop and the `isolate` loop (`core/runtime/test/loop*.test.mjs`), including `examples/first-loop.mjs` |
| `make pipeline-test` | `runNeed` on the current path, the generator, promotion and evaluator synthesis |
| `make isolate-test` | The rest of `core/runtime/test`: the workcell pool and its limits, the ledger writer, the subscription guard, the usage governor, the formula oracle and the contained JavaScript lane |
| `make library-test` | The library (`core/library/test`) |
| `make atomizer-test` | The atomizer's scheduler, isolation, validation and routing |
| `make lib-test` | The job tool, the Conductor, hillclimb and shared tool libraries |
| `make kernel-test` | The kernel contract tools, with the pinned wasmtime and wasm-tools |
| `make engine-test`, `make core-test`, `make ledger-test` | The engine, the repository-level tests and the ledger |

The [Makefile](../../../Makefile) lists the rest. Tests are found by glob, and `tests/test_reachability.py` fails if a
test file is not run by any target, so a new test file is picked up as long as it matches a target's pattern.

## Run on both Node versions

CI runs the suite on Node 22 and Node 26. Put the other Node first on `PATH`:

```sh
PATH=/path/to/node-22/bin:$PATH make test ENDOFORGE_TEST_OUTPUT="$(mktemp -d)"
```

## Where test output goes

Tests write scratch files under `ENDOFORGE_TEST_OUTPUT`. Without an override it is `.test-work` inside the checkout.
The Makefile sets it with `:=`, so it must be given on the `make` command line, not in the environment. The same
holds for `ENDOFORGE_USAGE_STATE`, which keeps the tests' usage-governor state in `.test-work/usage-governor.json`
instead of the shared file. Each `mktemp -d` above gives a fresh directory outside the checkout; keep it as local
evidence and do not publish private inputs from it.

No test calls a real model. Model clients are replaced by test doubles (`fake-claude.mjs`, `fake-codex.mjs` and
scripted providers), so a green run says the machinery works, not that a live agent client is compatible.

## Report the result

Record `git rev-parse HEAD`, the Node and Python versions, the commands, their exit statuses, and any failures or
skipped checks. A local run does not replace PR CI or review. The
[verification matrix](../../verification/verification-matrix.md) maps requirements to tests, the
[test plan](../../verification/test-plan.md) describes the procedures, and the
[test reports](../../verification/reports/README.md) hold recorded runs.
