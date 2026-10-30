# Requirements

These requirements describe implemented behavior, not authority to execute work.
Verification methods: T = test; I = inspection. Commands run from the repository root.
The selected tests cover these behaviors; they do not qualify live model services.

| ID | Requirement | Rationale | Verification |
|---|---|---|---|
| REQ-CORE-001 | The core shall import only its standard library allowlist and shall not load concrete integrations on import. | Keep execution outside the lifecycle model. | T: `make core-test`; `tests/test_endoforge_core_boundary.py`. |
| REQ-LIFE-001 | The lifecycle shall refuse transitions outside its legal state graph. | Prevent skipped lifecycle stages. | T: `make core-test`; `tests/test_endoforge_lifecycle.py`, `TransitionTests`. |
| REQ-LIFE-002 | Qualification shall require a passing receipt for the exact candidate under the frozen oracle. | Bind qualification to independently checked bytes. | T: `make core-test`; `tests/test_endoforge_lifecycle.py`, `TransitionTests`. |
| REQ-LIFE-003 | Applying a transition shall require a decision bound to the current proposal digest and shall refuse reused decisions. | Prevent stale or replayed authorization references. | T: `make core-test`; `tests/test_endoforge_lifecycle.py`, `DecisionTests`. |
| REQ-LIFE-004 | Generation shall not confer qualification or activation. | Separate candidate production from acceptance. | T: `make core-test`; `tests/test_endoforge_lifecycle.py`, `GenerationGrantsNothingTests`. |
| REQ-LIFE-005 | Artifact identity shall distinguish generation inputs, candidate bytes, and qualification receipt. | Preserve evidence identity across stages. | T: `make core-test`; `tests/test_endoforge_lifecycle.py`, `IdentityTests`. |
| REQ-LEDGER-001 | Evaluation shall refuse changes to frozen evaluator components before judging. | Prevent the candidate's checks from changing during evaluation. | T: `make ledger-test`; `tools/ledger/test_frozen.py`, `FrozenTests.test_every_component_change_refuses_before_judging`. |
| REQ-DOCS-001 | Repository checks shall validate local Markdown link targets and source digests. | Keep navigation and supplied source evidence reproducible. | I: `make check`; inspect `tools/check-docs.py` and `sources/SHA256SUMS`. |
