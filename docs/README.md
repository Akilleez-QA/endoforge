# Documentation

Start with the [getting-started tutorial](guides/tutorials/getting-started.md). It runs the candidate loop on a fresh clone
with a scripted model in about five minutes.

Use synthetic identifiers and local paths in documentation, and keep generated evidence outside the source tree.

## Tutorials

- [Getting started](guides/tutorials/getting-started.md): clone, check, and promote a first candidate.

## How-to guides

- [Run local checks](guides/how-to/local-checks.md): the full suite, as CI runs it.

## Reference

- [Configuration](configuration/configuration-reference.md): every environment variable, `limits` key and options object, with defaults.
- [Requirements](requirements/requirements.md): implemented behaviour and how each is verified.
- [Verification matrix](verification/verification-matrix.md): requirement coverage and recorded evidence.
- [Ledger ICD](interfaces/ledger-icd.md): ledger records, CLI, workcell pool and writer journal.
- [Capacity planner ICD](interfaces/capacity-icd.md): width, placement and split (Mjölnir).
- [Constraint record](interfaces/constraint-record.md): constraints kept outside compaction.
- [Cstack ICD](icd/icd-cstack.md): the interface to Cstack (Mjölnir).
- [Runtime](../core/runtime/README.md): isolate pool, WebAssembly limits, contained JavaScript, dump list, X1 loop,
  transports, subscription guard and usage governor.
- [Library](../core/library/README.md): reuse of promoted kernels.
- [Tools](../tools/README.md): every tool and script under `tools/`.
- [Experiments](../experiments/README.md): the measurements behind each default, by P-number.

## Explanation

- [Architecture](architecture/architecture.md): components, data flow and boundaries.
- [The candidate loop](architecture/candidate-loop.md): from a need to a promotion decision.
- [Evaluator synthesis](architecture/evaluator-synthesis.md): candidate-blind evaluators.
- [Configuration management](configuration/configuration-management.md): baselines, controlled inputs and releases.

## Archived

Unused placeholder inputs are under `TODELETE/`, for example the
[independent check placeholder](../TODELETE/docs/example.json).
