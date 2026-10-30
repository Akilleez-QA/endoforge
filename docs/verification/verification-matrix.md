# Verification matrix

Requirement definitions are in
[docs/requirements/requirements.md](../requirements/requirements.md).

The implementation baseline below is `3083a5a5c277d6caec99eba698f6040698751400`.
Results were observed locally
on 2026-10-30; they are not hosted CI status or live-provider qualification.
T means test; I means inspection.

| Requirement | Method | Existing test or command | Result | Implementation commit |
|---|---|---|---|---|
| REQ-CORE-001 | T | `make core-test`; `tests/test_endoforge_core_boundary.py` | Pass | `3083a5a` |
| REQ-LIFE-001 | T | `make core-test`; `tests/test_endoforge_lifecycle.py`, `TransitionTests` | Pass | `3083a5a` |
| REQ-LIFE-002 | T | `make core-test`; `tests/test_endoforge_lifecycle.py`, `TransitionTests` | Pass | `3083a5a` |
| REQ-LIFE-003 | T | `make core-test`; `tests/test_endoforge_lifecycle.py`, `DecisionTests` | Pass | `3083a5a` |
| REQ-LIFE-004 | T | `make core-test`; `tests/test_endoforge_lifecycle.py`, `GenerationGrantsNothingTests` | Pass | `3083a5a` |
| REQ-LIFE-005 | T | `make core-test`; `tests/test_endoforge_lifecycle.py`, `IdentityTests` | Pass | `3083a5a` |
| REQ-LEDGER-001 | T | `make ledger-test`; `tools/ledger/test_frozen.py`, `FrozenTests.test_every_component_change_refuses_before_judging` | Pass | `3083a5a` |
| REQ-DOCS-001 | I | `make check`; inspect `tools/check-docs.py` | Pass: link existence and digest checks present | `3083a5a` |

## Reproduction

Run from the repository root:

```sh
make check
make core-test ledger-test
make test ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-style-test
```

The full suite passed locally with the output override above. The override keeps
generated evidence outside the source tree. The commit body records checks for
this documentation change. `make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-style-optimized`
also passed locally on this documentation branch.
