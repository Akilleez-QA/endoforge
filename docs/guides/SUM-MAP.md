# EndoForge user manual map

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-SUM-MAP |
| Version | 2.0 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-08 |
| Baseline commit | 63e95c79afb282a7fcae4decd57d2e7ed6cf0d40 |
| Applies to | endoforge main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

EndoForge has no single user manual. The README and the guides together are the manual (SWEHB 5.12, tailored). This
page says where each part of a user manual lives and how it was checked. Reference material is the configuration
reference, the interface control documents, the data dictionary and the component READMEs, not a separate
`guides/reference/` folder.

## The guides

| Guide | Kind | What it covers |
|---|---|---|
| [Getting started](tutorials/getting-started.md) | Tutorial | Clone, check, run the agent loop with a scripted agent, read the ledger, then the commands for Claude Code and Codex |
| [Run the agent loop](how-to/run-the-agent-loop.md) | How-to | `createLoopPool`, providers and transports, the three loop paths, waits, limits, results, resume |
| [Run a job](how-to/run-a-job.md) | How-to | A job from manifest to card, go and a Conductor run that merges an agent's change |
| [Split work with the atomizer](how-to/split-work-with-the-atomizer.md) | How-to | An `atoms.json` graph planned, run in sandboxes, verified and reported |
| [Reuse with the library](how-to/reuse-with-the-library.md) | How-to | Admitting a promotion, serving a later need from it, miss reasons, revocation |
| [Turn on evaluator synthesis](how-to/turn-on-evaluator-synthesis.md) | How-to | A second evaluator written blind to the code, and what it catches |
| [Run local checks](how-to/local-checks.md) | How-to | `make check`, `make test`, single areas, both Node versions |
| [Limitations](explanation/limitations.md) | Explanation | What a promotion does and does not mean |
| [Configuration reference](../configuration/configuration-reference.md) | Reference | Every environment variable, option, manifest setting and Makefile variable with its default |

## Where each manual element lives

| Manual element | Where | Verified how |
|---|---|---|
| Application summary and intended users | [README](../../README.md) opening and [Why](../../README.md#why) | Read against the code and the design at baseline |
| Inventory | [README: what is inside](../../README.md#what-is-inside); [version descriptions](../releases/README.md) | Version description generated from `git` |
| Environment and prerequisites | [Getting started §1](tutorials/getting-started.md#1-check-the-prerequisites); [run local checks](how-to/local-checks.md#what-you-need); [test plan §3](../verification/test-plan.md#3-test-environment) | Commands run at baseline |
| Modes and states of operation | [Run the agent loop](how-to/run-the-agent-loop.md#the-three-loop-paths) (three loop paths, thread and process cells, `waits`); [candidate loop](../architecture/candidate-loop.md); [SDD §5](../architecture/architecture.md#5-execution-concept) | Example scripts run at baseline; inspection |
| Security and privacy | [SECURITY.md](../../SECURITY.md); the subscription guard in the [configuration reference](../configuration/configuration-reference.md#refused-and-stripped-variables); [SMP §7](../plan/software-management-plan.md#7-security-privacy-and-secure-coding) | Guard refusal run at baseline (exit 78 without a login); inspection |
| Assistance and problem reporting | [SUPPORT.md](../../SUPPORT.md); issue forms in `.github/ISSUE_TEMPLATE/` | Inspection |
| First-time use | [Getting started](tutorials/getting-started.md) | Every command run at baseline with scripted agents and test-double CLIs; no real model called |
| Starting and stopping | Each `make` target and example script runs to completion; pools stop with `close()`; the Conductor stops with `conduct stop` or `--max-ticks` ([run a job](how-to/run-a-job.md)) | Run at baseline; REQ-ISO-005 test |
| Capabilities and commands | The how-to guides above; [configuration reference](../configuration/configuration-reference.md); [tools index](../../tools/README.md); [runtime README](../../core/runtime/README.md); the ICDs in the [docs index](../README.md) | `make check` fails on an environment variable missing from the configuration reference |
| Conventions (IDs, units, file layout) | [Data dictionary §1](../data/data-dictionary.md#1-conventions); [README: what is inside](../../README.md#what-is-inside) | Inspection |
| Processing procedures | [Run the agent loop](how-to/run-the-agent-loop.md); [run a job](how-to/run-a-job.md); [split work with the atomizer](how-to/split-work-with-the-atomizer.md); [run local checks](how-to/local-checks.md) | Commands run at baseline |
| Data backup and recovery from errors | Ledgers are append-only and hash-chained; the writer journal rebuilds lost ledger files ([writer journal](../interfaces/ledger-icd.md#ledger-writer-journal)); needs resume from the ledger ([run the agent loop](how-to/run-the-agent-loop.md#resume)); the Conductor resumes from `state.json` | Resume run at baseline; REQ-LEDGER-002 and REQ-LOOP-003 tests |
| Messages, errors and exit codes | [Data dictionary §2](../data/data-dictionary.md#2-configuration-interfaces-and-outcome-codes) exit codes; outcome states in [data dictionary §3](../data/data-dictionary.md#3-ledger-records-generated); library miss reasons in [reuse with the library](how-to/reuse-with-the-library.md#why-a-lookup-misses) | Generated from the schema; exit codes and reasons checked against the code |
| Assumptions and limitations | [README: limitations](../../README.md#limitations); [limitations](explanation/limitations.md) | Inspection |
| Safety-related constraints | [Limitations: what a promotion means](explanation/limitations.md#what-a-promotion-means) | Inspection |
| Version-specific changes | [CHANGELOG](../../CHANGELOG.md); [version descriptions](../releases/README.md) | Generated version description |

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-08 | `4d692a4` | Initial map | #131 |
| 1.1 | 2026-11-08 | `ea7b8d6` | README links follow its reader-first sections (Why, What is inside); first-time use re-run at `ea7b8d6` | #132 |
| 2.0 | 2026-11-08 | `63e95c7` | Guides table added; five new how-tos mapped; getting started rewritten around the agent loop; first-time use re-run at `63e95c7` | this PR |
