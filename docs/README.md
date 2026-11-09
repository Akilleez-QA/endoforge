# Documentation

EndoForge turns code that AI coding agents propose into trusted, reusable working software: it checks each proposal in
V8 isolates against tests frozen before the code existed, records the verdict in a hash-chained ledger, and keeps what
passes for reuse. New here? Start with the [project README](../README.md), then the tutorial.

## Learn

- [Getting started](guides/tutorials/getting-started.md): clone, ask for an addition kernel, see it promoted with its
  gate results, then see a wrong kernel refused. About five minutes, no model account.

## Do

- [Run local checks](guides/how-to/local-checks.md): the full test suite, as CI runs it.

## Look up

- [Configuration](configuration/configuration-reference.md): every environment variable, `limits` key and options
  object, with defaults.
- [Data dictionary](data/data-dictionary.md): ledger, hardware and factory records (generated from the schemas) and
  exit codes.
- [Runtime](../core/runtime/README.md): isolate pool, WebAssembly limits, contained JavaScript, dump list, the loop
  inside a workcell, model transports, subscription guard and usage governor.
- [Library](../core/library/README.md): reuse of promoted kernels.
- [Tools](../tools/README.md): every tool and script under `tools/`.
- [Experiments](../experiments/README.md): the measurement behind each default, by P-number.
- Interfaces: [ledger and workcell pool](interfaces/ledger-icd.md), [capacity planner](interfaces/capacity-icd.md),
  [constraint record](interfaces/constraint-record.md), [Cstack](icd/icd-cstack.md).

## Understand

- [The candidate loop](architecture/candidate-loop.md): how a need becomes a promoted kernel, and what each gate
  checks.
- [Limitations and safe use](guides/explanation/limitations.md): what a promotion does and does not mean.
- [Design description](architecture/architecture.md): components, design decisions and execution, for a reader about to
  change the code.

When you write documentation, use synthetic identifiers and local paths, and keep generated evidence outside the source
tree.

## Engineering records

EndoForge keeps a full engineering document set under the Cstack family documentation standard, organized after NASA
NPR 7150.2D and the NASA Software Engineering Handbook. The canonical standard is in the
[Cstack repository](https://github.com/Akilleez-QA/cstack/tree/main/docs/standards). EndoForge self-assesses as a Class E
analog and is not safety-critical; this is not a NASA compliance determination
([SMP §1](plan/software-management-plan.md#1-software-classification-self-assessed)).

### Control documents

| Document | ID | Path |
|---|---|---|
| Software management plan (classification, assurance, risk) | ENDOFORGE-SMP | [plan/software-management-plan.md](plan/software-management-plan.md) |
| Requirements mapping (compliance) matrix | ENDOFORGE-RMM | [plan/compliance-matrix.md](plan/compliance-matrix.md) |
| Software requirements specification | ENDOFORGE-SRS | [requirements/requirements.md](requirements/requirements.md) |
| Software design description | ENDOFORGE-SDD | [architecture/architecture.md](architecture/architecture.md) |
| Design topic: the candidate loop | ENDOFORGE-SDD-LOOP | [architecture/candidate-loop.md](architecture/candidate-loop.md) |
| ICD: Cstack | ENDOFORGE-ICD-CSTACK | [icd/icd-cstack.md](icd/icd-cstack.md) |
| ICD: ledger, workcell pool, X1 host, generator and promotion | ENDOFORGE-ICD-LEDGER | [interfaces/ledger-icd.md](interfaces/ledger-icd.md) |
| ICD: capacity planner (Mjölnir) | ENDOFORGE-ICD-CAPACITY | [interfaces/capacity-icd.md](interfaces/capacity-icd.md) |
| ICD: constraint record | ENDOFORGE-ICD-CONSTRAINT | [interfaces/constraint-record.md](interfaces/constraint-record.md) |
| Configuration reference | ENDOFORGE-CFG | [configuration/configuration-reference.md](configuration/configuration-reference.md) |
| Data dictionary (generated sections) | ENDOFORGE-DD | [data/data-dictionary.md](data/data-dictionary.md) |
| Software test plan and procedures | ENDOFORGE-STP | [verification/test-plan.md](verification/test-plan.md) |
| Verification matrix | ENDOFORGE-VM | [verification/verification-matrix.md](verification/verification-matrix.md) |
| Test reports (generated) | ENDOFORGE-STR-* | [verification/reports/](verification/reports/README.md) |
| Configuration management plan | ENDOFORGE-SCMP | [configuration/configuration-management.md](configuration/configuration-management.md) |
| Version descriptions (generated) | ENDOFORGE-VDD-* | [releases/](releases/README.md) |
| Software assurance record | ENDOFORGE-SAR | [assurance/assurance-record.md](assurance/assurance-record.md) |
| User manual map | ENDOFORGE-SUM-MAP | [guides/SUM-MAP.md](guides/SUM-MAP.md) |

ICDs live in both `icd/` and `interfaces/`. New ICDs go in `icd/`; the `interfaces/` files stay where they are until a
later change moves them and fixes the links.

### Historical records

These are kept as written and carry no metadata header:

- [Evaluator synthesis](architecture/evaluator-synthesis.md): the design written before the code (2026-11-07).
- [Verification history](verification/history-2026-10-30.md): verification evidence from 2026-10-30 to 2026-11-02.
- Experiment `PRECOMMIT.md` and `RESULT.md` files, indexed in [experiments/README.md](../experiments/README.md).

### Archived

Unused placeholder inputs are under `TODELETE/`, for example the
[independent check placeholder](../TODELETE/docs/example.json).
