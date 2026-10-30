# EndoForge

EndoForge runs coding agents under independent checks and records their evidence

<img src="https://img.shields.io/badge/license-GPL--3.0--only-2400FF?style=flat-square&labelColor=000000" alt="License: GPL-3.0-only">

## Status

Research software. The lifecycle model validates proposals, evidence, and decision references. Execution and evaluation utilities live separately under `tools/`. Interfaces may change; the core does not execute agents or grant authority.

## Quickstart

Requirements: Python 3.11+, Node.js 20+, GNU Make, and bubblewrap for isolate checks.

Run from the repository root:

```sh
make check
make test
```

Tests use synthetic inputs and stubs. Public agent clients are optional. Keep generated evidence outside the source tree; the test output directory can be set with `make test ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-test-output`.

## What is inside

| Component | Purpose |
|---|---|
| [Lifecycle model](core/lifecycle.py) | Validate artifact identities, state changes, evidence, and decision bindings |
| [Ledger](tools/ledger/ledger.py) | Store and validate linked evidence records |
| [Evaluator](tools/engine/evaluator.mjs) | Evaluate candidates against frozen checks |
| [Runtime](tools/runtime/README.md) | Manage local execution pools |

## Documentation

Start with the [documentation index](docs/README.md). Input examples are described in [campaigns](campaigns/README.md), [experiments](experiments/README.md), and [sources](sources/README.md).

## Related projects

EndoForge is part of the Cstack family. See [Cstack](https://github.com/Akilleez-QA/cstack) and [poodo](https://github.com/Akilleez-QA/poodo). This repository does not implement the external Cstack bridge.

## Layout

| Path | Contents |
|---|---|
| `core/` | Python lifecycle model |
| `tools/` | Execution, ledger, evaluation, and scheduling utilities |
| `tests/` | Lifecycle and core boundary tests |
| `docs/` | Documentation and an input example |
| `campaigns/`, `experiments/` | Input examples and guidance |
| `sources/` | Source example and digest manifest |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## License

This project is available under the GNU General Public License v3.0 only (GPL-3.0-only). If you want to use it to create a product or service under different terms, commercial licenses are available from Refrigeration.AI. Contact craig@nh3.biz. See [LICENSE](LICENSE).
