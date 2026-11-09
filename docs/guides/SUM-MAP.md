# EndoForge user manual map

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-SUM-MAP |
| Version | 1.0 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-08 |
| Baseline commit | 4d692a41853045c4e013405d8e674528745a38b9 |
| Applies to | endoforge main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

The user manual (SWEHB 5.12, tailored) is the README plus the guides. This map shows where each element lives. The
reference material is the configuration reference, the ICDs, the data dictionary and the component READMEs rather than
a separate `guides/reference/` folder.

| SUM element | Where | Verified how |
|---|---|---|
| Application summary and intended users | [README](../../README.md) intro and Status | Read against code at baseline |
| Inventory (what is in the repository) | [README](../../README.md#what-is-inside) What is inside and Layout; [version descriptions](../releases/README.md) | VDD generated from `git` |
| Environment and prerequisites | [README](../../README.md#quickstart) Quickstart; [test plan §3](../verification/test-plan.md#3-test-environment) | Quickstart commands run at baseline |
| Modes and states of operation | [Candidate loop](../architecture/candidate-loop.md) (thread and process isolation, `waits`, opt-in stages); [SDD §5](../architecture/architecture.md#5-execution-concept) | Inspection |
| Security and privacy | [SECURITY.md](../../SECURITY.md); [SMP §7](../plan/software-management-plan.md#7-security-privacy-and-secure-coding) | Inspection |
| Assistance and problem reporting | [SUPPORT.md](../../SUPPORT.md); issue forms in `.github/ISSUE_TEMPLATE/` | Inspection |
| First-time use | [Getting started](tutorials/getting-started.md) | Run end to end at `4d692a4` in a fresh clone (test plan TP-3) |
| Starting and stopping | Each `make` target and the tutorial script run to completion; pools stop with `close()` ([ledger ICD](../interfaces/ledger-icd.md#v8-workcell-pool-interface)) | Inspection; REQ-ISO-005 test |
| Capabilities and commands reference | [Configuration reference](../configuration/configuration-reference.md); [tools index](../../tools/README.md); [runtime README](../../core/runtime/README.md); ICDs listed in the [docs index](../README.md) | Trace check fails on an environment variable missing from the configuration reference |
| Conventions (IDs, units, file layout) | [Data dictionary §1](../data/data-dictionary.md#1-conventions); [README layout](../../README.md#layout) | Inspection |
| Processing procedures | [Run local checks](how-to/local-checks.md); [candidate loop](../architecture/candidate-loop.md) | Commands run at baseline |
| Data backup and recovery from errors | Ledgers are append-only and hash-chained; the writer journal rebuilds lost ledger files ([writer journal](../interfaces/ledger-icd.md#ledger-writer-journal)); tasks resume from the ledger ([candidate loop](../architecture/candidate-loop.md)) | REQ-LEDGER-002, REQ-LOOP-003 tests |
| Messages, errors and exit codes | [Data dictionary §2](../data/data-dictionary.md#2-configuration-interfaces-and-outcome-codes) exit codes; outcome states in [data dictionary §3](../data/data-dictionary.md#3-ledger-records-generated) | Generated from the schema; exit codes checked against the code |
| Assumptions and limitations | [README](../../README.md#limitations) Limitations; [limitations](explanation/limitations.md) | Inspection |
| Safety-related constraints | [Limitations: what a promotion means](explanation/limitations.md#what-a-promotion-means) | Inspection |
| Version-specific changes | [CHANGELOG](../../CHANGELOG.md); [version descriptions](../releases/README.md) | Generated VDD |

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-08 | `4d692a4` | Initial map | this PR |
