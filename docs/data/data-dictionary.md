# EndoForge data dictionary

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-DD |
| Version | 1.0 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-08 |
| Baseline commit | 4d692a41853045c4e013405d8e674528745a38b9 |
| Applies to | endoforge main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

This dictionary defines the data EndoForge reads, writes and exchanges. Sections 3 to 5 are generated from the
schema files by `python3 -I tools/gen_data_dictionary.py`; `make check` runs it with `--check` and fails when this file
differs from the schemas. Do not edit those sections by hand. Hardware channels, telemetry, rate groups and recorder
formats are N/A: EndoForge has no hardware interface.

## 1. Conventions

- Identifiers are text; digests are lowercase hexadecimal SHA-256 (64 characters).
- Durations are milliseconds where a name ends in `Ms` and seconds where it ends in `Sec`; sizes are MiB where a name
  ends in `Mb`. These suffixes are the code's convention (see the [configuration reference](../configuration/configuration-reference.md)).
- "Unknown" outcomes are never passes: `outcome_unknown` delivery state and `inconclusive` outcome state.

## 2. Configuration, interfaces and outcome codes

| Data | Defined in |
|---|---|
| Environment variables (every variable the code reads; checked by `tools/check_trace.py`) | [Configuration reference](../configuration/configuration-reference.md#environment-variables) |
| X1 agent `limits` keys | [Configuration reference](../configuration/configuration-reference.md#x1-agent-limits) |
| Options objects (`createLoopPool`, `IsolatePool`, contained runner, transports, governor, capacity, stage rates, kernel limits) | [Configuration reference](../configuration/configuration-reference.md#options-objects) |
| Workcell pool results, X1 host, generator and promotion records | [Ledger ICD](../interfaces/ledger-icd.md) |
| Capacity probe and plan records | [Capacity ICD](../interfaces/capacity-icd.md#probe-record) |
| Constraint records | [Constraint record](../interfaces/constraint-record.md) |
| Names Cstack calls | [Cstack ICD](../icd/icd-cstack.md#interface) |

Process exit codes shared across tools (`tools/lib/errors.mjs`, `core/runtime/subscription-guard.mjs`,
`core/runtime/usage-governor.mjs`, `core/runtime/agent-pool.mjs`):

| Exit | Meaning | Caller action |
|---|---|---|
| 0 | Success | — |
| 2 | Usage error (for example no Codex binary found by the agent pool) | Fix the invocation |
| 75 | Transient: a busy guard, a spawn-rate refusal, or a parked model call (`USAGE_PARKED`) | Wait and retry later; never count as a failed candidate |
| 78 | Stop: configuration refused (for example a non-subscription login) or torn state | Fix the configuration; do not retry |
| other | Failure | Investigate |

## 3. Ledger records (generated)

Source: `core/ledger/record.schema.json` (Endoforge Ledger v0/v1 record). A record has these top-level fields; `data` takes the shape named by `kind`. Version 1 records require `provenance` and `license`; version 0 records must not carry them.

#### `record`

| Field | Type | Required |
|---|---|---|
| `version` | one of `0`, `1` | yes |
| `id` | text | yes |
| `kind` | one of `"task"`, `"admitted_input"`, `"frozen_evaluator"`, `"candidate"`, `"receipt"` | yes |
| `data` | object | yes |
| `provenance` | object `provenance` | no |
| `license` | object `license` | no |

#### `provenance`

| Field | Type | Required |
|---|---|---|
| `origin` | one of `"authored"`, `"generated"`, `"imported"`, `"pre-built-wasm"` | yes |
| `upstream_identity` | text, not blank | yes |
| `upstream_version` | text, not blank | yes |
| `input_scopes` | array of text, not blank, unique | yes |
| `derived_from` | array of text, unique | yes |
| `model` | object | no |

#### `license`

| Field | Type | Required |
|---|---|---|
| `expression` | text, not blank | yes |
| `evidence_sha256` | string (pattern `^[0-9a-f]{64}$`, minLength `64`, maxLength `64`) | yes |

#### `task`

| Field | Type | Required |
|---|---|---|
| `intent` | text | yes |
| `acceptance` | text | yes |
| `precommit` | object | no |

#### `admitted_input`

| Field | Type | Required |
|---|---|---|
| `task` | text | yes |
| `content` | string | yes |
| `origin` | text | yes |

#### `frozen_evaluator`

| Field | Type | Required |
|---|---|---|
| `task` | text | yes |
| `admitted_input` | text | yes |
| `content` | text | yes |
| `confirmed_by` | text | yes |
| `freeze` | object `freeze` | no |
| `revision` | object `revision` | no |

#### `freeze`

| Field | Type | Required |
|---|---|---|
| `digest` | text | yes |
| `qualification` | text | yes |
| `synthesis_context` | object | yes |

#### `revision`

| Field | Type | Required |
|---|---|---|
| `of` | text | yes |
| `reason` | one of `"specification_correction"`, `"independent_qualification"` | yes |
| `evidence` | text | yes |

#### `candidate`

| Field | Type | Required |
|---|---|---|
| `task` | text | yes |
| `admitted_input` | text | yes |
| `content` | string | yes |
| `proposer` | text | yes |

#### `precommit`

| Field | Type | Required |
|---|---|---|
| `observable` | text | yes |
| `acceptance_boundary` | text | yes |
| `oracle` | text | yes |
| `oracle_version` | text | yes |
| `artifact_identity` | text | yes |
| `environment` | object | yes |
| `failure_meaning` | text | yes |
| `stop_condition` | text | yes |

#### `receipt`

| Field | Type | Required |
|---|---|---|
| `task` | text | yes |
| `candidate` | text | yes |
| `frozen_evaluator` | text | yes |
| `precommit` | object `precommit` | yes |
| `delivery_state` | one of `"admitted"`, `"authorized"`, `"running"`, `"finished"`, `"outcome_unknown"`, `"reconciled"`, `"aborted"` | yes |
| `outcome_state` | one of `"unobserved"`, `"observed"`, `"passed"`, `"failed"`, `"failed_with_test_concern"`, `"invalid"`, `"inconclusive"` | yes |
| `observations` | array of object | yes |

## 4. Hardware record (generated)

Source: `tools/hardware_record/schema.json` (schema `endoforge/hardware-record/1`). Types are Python type names checked by `tools/hardware_record/record.py`.

| Field | Type |
|---|---|
| `schema` | str |
| `id` | str |
| `created_at` | str |
| `commit` | str |
| `status` | str |
| `limits` | list |
| `identity` | dict |
| `controls` | dict |
| `receipts` | dict |

| `identity` field | Type |
|---|---|
| `hostname` | str |
| `cpu_model` | str |
| `logical_cpus` | int |
| `physical_cores` | int |
| `ram_bytes` | int |
| `disks` | list |
| `os` | str |
| `kernel` | str |
| `firmware` | dict |
| `drivers` | dict |
| `toolchain` | dict |
| `boot_id` | str |

- `status`: one of `qualified`, `qualified-with-limits`, `failed`.
- `controls` keys: `affinity`, `cgroup_controllers`, `memory.max`, `pids.max`, `network_denial`, `io.stat`, `quiet_gate`, `noise_baseline`.
- Receipt files: `precommit.json`, `before.json`, `after.json`, `controls.json`.
- A change in any of `kernel`, `firmware`, `drivers`, `toolchain`, `boot_id` reopens the record.

## 5. Factory runtime schemas (generated)

Sources: `tools/factory_runtime/schemas/v1/`. The factory runtime has no tests at the baseline (GAP-EF-002); these are its declared shapes.

#### `attempt.json`

| Field | Type | Required |
|---|---|---|
| `version` | any | yes |
| `kind` | any | yes |
| `job` | string (pattern `^[a-zA-Z0-9_-]{1,80}$`) | yes |
| `attempt` | string (pattern `^[a-zA-Z0-9_-]{1,80}$`) | yes |
| `state` | one of `"queued"`, `"running"`, `"passed"`, `"failed"`, `"timeout"`, `"cancelled"`, `"unknown"`, `"reconciled"`, `"publication_recovered"`, `"blocked"` | yes |
| `parent` | any | yes |
| `usage` | object | yes |
| `hashes` | object | yes |
| `error` | any | yes |

#### `job-spec.json`

| Field | Type | Required |
|---|---|---|
| `version` | any | yes |
| `job` | string (pattern `^[a-zA-Z0-9_-]{1,80}$`) | yes |
| `attempt` | string (pattern `^[a-zA-Z0-9_-]{1,80}$`) | yes |
| `input` | string | yes |
| `inputSha256` | string (pattern `^[a-f0-9]{64}$`) | yes |
| `expectedSha256` | string (pattern `^[a-f0-9]{64}$`) | yes |
| `script` | string | yes |
| `timeoutSeconds` | number (maximum `600`) | yes |

#### `job.json`

| Field | Type | Required |
|---|---|---|
| `version` | any | yes |
| `kind` | any | yes |
| `job` | string (pattern `^[a-zA-Z0-9_-]{1,80}$`) | yes |
| `attempt` | string (pattern `^[a-zA-Z0-9_-]{1,80}$`) | yes |
| `state` | one of `"queued"`, `"running"`, `"passed"`, `"failed"`, `"timeout"`, `"cancelled"`, `"unknown"`, `"reconciled"`, `"publication_recovered"`, `"blocked"` | yes |
| `parent` | any | yes |
| `usage` | object | yes |
| `hashes` | object | yes |
| `error` | any | yes |

#### `receipt.json`

| Field | Type | Required |
|---|---|---|
| `version` | any | yes |
| `kind` | any | yes |
| `job` | string (pattern `^[a-zA-Z0-9_-]{1,80}$`) | yes |
| `attempt` | string (pattern `^[a-zA-Z0-9_-]{1,80}$`) | yes |
| `state` | one of `"queued"`, `"running"`, `"passed"`, `"failed"`, `"timeout"`, `"cancelled"`, `"unknown"`, `"reconciled"`, `"publication_recovered"`, `"blocked"` | yes |
| `parent` | any | yes |
| `usage` | object | yes |
| `hashes` | object | yes |
| `error` | any | yes |

#### `stage.json`

| Field | Type | Required |
|---|---|---|
| `version` | any | yes |
| `kind` | any | yes |
| `job` | string (pattern `^[a-zA-Z0-9_-]{1,80}$`) | yes |
| `attempt` | string (pattern `^[a-zA-Z0-9_-]{1,80}$`) | yes |
| `state` | one of `"queued"`, `"running"`, `"passed"`, `"failed"`, `"timeout"`, `"cancelled"`, `"unknown"`, `"reconciled"`, `"publication_recovered"`, `"blocked"` | yes |
| `parent` | any | yes |
| `usage` | object | yes |
| `hashes` | object | yes |
| `error` | any | yes |

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-08 | `4d692a4` | Initial dictionary; generated schema sections | this PR |
