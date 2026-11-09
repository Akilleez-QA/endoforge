![EndoForge social preview](.github/assets/social-preview.png)

# EndoForge

In-isolate software workshop for running many coding agents with fast checks, caching and evidence receipts

<img src="https://img.shields.io/badge/license-GPL--3.0--only-2400FF?style=flat-square&labelColor=000000" alt="License: GPL-3.0-only">

## Status

Research software. EndoForge turns a short need into a small numeric WebAssembly kernel. A model writes a contract
and tests, the supervisor freezes them in a hash-chained ledger, the model writes the kernel, and a frozen evaluator
runs nine gates inside V8 workcells. A candidate is promoted only when every gate passes for its exact bytes; a lost
cell or a parked model call is an unknown outcome, never a pass. Defaults change only after a precommitted
measurement in [experiments](experiments/README.md). Interfaces may change.

Version: unreleased; only the latest `main` is supported. Classification: self-assessed Class E analog, not
safety-critical; the documentation follows the Cstack family standard organized after NASA NPR 7150.2D. This is not a
NASA compliance determination ([software management plan](docs/plan/software-management-plan.md)).

## Quickstart

Requirements: Git, GNU Make, Python 3.11+ and Node.js 22.8+ (CI runs Node 22 and 26). The full suite also needs
bubblewrap, `age` and `gcc`, and kernel tools installed by `make tools`.

```sh
git clone https://github.com/Akilleez-QA/endoforge.git
cd endoforge
make check
make tools
make test
```

The [getting-started tutorial](docs/guides/tutorials/getting-started.md) runs the candidate loop with a scripted model in
about five minutes, with no model account. Tests use synthetic inputs and test doubles. Keep generated evidence
outside the source tree: `make test ENDOFORGE_TEST_OUTPUT="$(mktemp -d)"`.

## What is inside

| Component | Purpose |
|---|---|
| [Candidate loop](docs/architecture/candidate-loop.md) | Need to specification, freeze, implementation, compile, gates, commit and decision (`core/runtime/x1/`) |
| [Runtime](core/runtime/README.md) | V8 isolate workcells, WebAssembly memory limits, contained JavaScript, model transports, subscription guard, usage governor, dump list |
| [Capacity planner](docs/interfaces/capacity-icd.md) | Width, placement on cache domains and split into cohorts (Mjölnir) |
| [Ledger](docs/interfaces/ledger-icd.md) | Hash-chained evidence records and a group-commit writer |
| [Evaluator](core/engine/evaluator.mjs) | Evaluate candidates against frozen checks through host callbacks |
| [Library](core/library/README.md) | Reuse a promoted kernel for a need it already satisfies |
| [Lifecycle model](core/lifecycle.py) | Validate artifact identities, state changes, evidence and decision references |
| [Tools](tools/README.md) | Atomizer, conductor, job intake, hillclimb, TypeScript checker, kernel host and repository scripts |

## Documentation

Start with the [documentation index](docs/README.md). It links the tutorial, the
[configuration reference](docs/configuration/configuration-reference.md), the architecture, interface documents,
[local checks](docs/guides/how-to/local-checks.md) and the control documents (plan, requirements, verification matrix,
test plan and reports, configuration management, version descriptions and assurance record).

## Limitations

- A promotion means the frozen, model-written tests and the gates passed for the exact bytes. It is not proof of
  correctness for every input, and not an engineering or safety approval.
- Repository tests use synthetic inputs and test doubles; they do not qualify live model services.
- Thread workcells do not bound off-heap memory; use process isolation with a delegated cgroup for that.
- Model calls must use a claude.ai subscription login.

Details: [limitations and safe use](docs/guides/explanation/limitations.md).

## Related projects

EndoForge belongs to the Cstack family (code name Mjölnir):

| Repository | Role |
|---|---|
| [cstack](https://github.com/Akilleez-QA/cstack) | Host. Vendors part of EndoForge at a pinned commit; the [Cstack ICD](docs/icd/icd-cstack.md) lists what |
| endoforge | Engine (this repository) |
| [poodo](https://github.com/Akilleez-QA/poodo) | Reasoning skill |
| [foundation-engine](https://github.com/Akilleez-QA/foundation-engine), [foundation-math](https://github.com/Akilleez-QA/foundation-math), [foundation-film](https://github.com/Akilleez-QA/foundation-film), [foundation-refrigeration](https://github.com/Akilleez-QA/foundation-refrigeration), [foundation-robotics](https://github.com/Akilleez-QA/foundation-robotics), [foundation-template](https://github.com/Akilleez-QA/foundation-template) | Foundations |

## Layout

| Path | Contents |
|---|---|
| `core/` | Lifecycle model, ledger, engine evaluator and gates, constraints, library and runtime (workcells, X1 loop, capacity planner) |
| `tools/` | Workflow tools and repository scripts; see [tools/README.md](tools/README.md) |
| `tests/` | Lifecycle, boundary and repository-check tests |
| `experiments/` | Precommitted measurements, one P-number each, indexed in [experiments/README.md](experiments/README.md) |
| `docs/` | Documentation |
| `sources/` | Source digest manifest checked by `make check` |
| `TODELETE/` | Archived unused placeholders at their original relative paths |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## License

This project is available under the GNU General Public License v3.0 only (GPL-3.0-only). If you want to use it to create a product or service under different terms, commercial licenses are available from Refrigeration.AI. Contact craig@nh3.biz.
