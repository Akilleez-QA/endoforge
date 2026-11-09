# Documentation

Start with the [getting-started tutorial](guides/tutorials/getting-started.md). It runs the candidate loop on a fresh clone
with a scripted model in about five minutes.

Use synthetic identifiers and local paths in documentation, and keep generated evidence outside the source tree.

The control documents follow the Cstack family documentation standard, organized after NASA NPR 7150.2D and the NASA
Software Engineering Handbook. The canonical standard is in the
[Cstack repository](https://github.com/Akilleez-QA/cstack/tree/main/docs/standards). EndoForge self-assesses as a Class E
analog and is not safety-critical; this is not a NASA compliance determination
([SMP §1](plan/software-management-plan.md#1-software-classification-self-assessed)).

## Tutorials

- [Getting started](guides/tutorials/getting-started.md): clone, check, and promote a first candidate.

## How-to guides

- [Run local checks](guides/how-to/local-checks.md): the full suite, as CI runs it.

## Reference

- [Configuration](configuration/configuration-reference.md): every environment variable, `limits` key and options object, with defaults.
- [Data dictionary](data/data-dictionary.md): ledger, hardware and factory records (generated from the schemas) and exit codes.
- [Runtime](../core/runtime/README.md): isolate pool, WebAssembly limits, contained JavaScript, dump list, X1 loop,
  transports, subscription guard and usage governor.
- [Library](../core/library/README.md): reuse of promoted kernels.
- [Tools](../tools/README.md): every tool and script under `tools/`.
- [Experiments](../experiments/README.md): the measurements behind each default, by P-number.

## Explanation

- [The candidate loop](architecture/candidate-loop.md): from a need to a promotion decision.
- [Limitations and safe use](guides/explanation/limitations.md): what a promotion does and does not mean.
- [User manual map](guides/SUM-MAP.md): where each user-manual element lives.

## Control documents

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

## Historical records

These are kept as written and carry no metadata header:

- [Evaluator synthesis](architecture/evaluator-synthesis.md): the design written before the code (2026-11-07).
- [Verification history](verification/history-2026-10-30.md): verification evidence from 2026-10-30 to 2026-11-02.
- Experiment `PRECOMMIT.md` and `RESULT.md` files, indexed in [experiments/README.md](../experiments/README.md).

## Archived

Unused placeholder inputs are under `TODELETE/`, for example the
[independent check placeholder](../TODELETE/docs/example.json).
