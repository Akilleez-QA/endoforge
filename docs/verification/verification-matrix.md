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
| REQ-LEDGER-001 | T | `make ledger-test`; `core/ledger/test_frozen.py`, `FrozenTests.test_every_component_change_refuses_before_judging` | Pass | `3083a5a` |
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


## Ledger relocation verification

On 2026-11-01, the relocation to `core/ledger/` passed the checks below locally
with Python 3.14.8, Node.js 26.12.0, and bubblewrap 0.13.1. The source identity is
the Git commit containing this section. Earlier baseline results above remain
historical; ledger test paths now refer to their relocated equivalents.

| Scope | Command | Observed result |
|---|---|---|
| REQ-DOCS-001 and relocated source digests | `make check` | Exit 0; no link or digest failures |
| REQ-CORE-001, REQ-LIFE-001 through REQ-LIFE-005, REQ-LEDGER-001 | `make core-test ledger-test` | Exit 0; 18 lifecycle/boundary and 32 ledger tests passed |
| Full suite, including engine callers | `make test ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-ledger.KCM0Ow/test` | Exit 0 |
| Full suite with Python optimization | `make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-ledger.KCM0Ow/optimized` | Exit 0 |

The scoped import check retains the lifecycle allowlist and permits only the
ledger's standard library dependencies plus test-only dependencies under the
ledger package. Ledger test assertions and fixtures are unchanged; subprocess
imports and the CLI module name use `core.ledger`. Output and logs were kept
outside the source tree under `/tmp/endoforge-ledger.KCM0Ow/`.

## Engine relocation verification

On 2026-11-01, the engine relocation was checked locally with Python 3.14.8,
Node.js 26.12.0, and bubblewrap 0.13.1. The source baseline is the Git commit
containing this section. Earlier results above remain historical.

| Scope | Command | Observed result |
|---|---|---|
| REQ-DOCS-001; engine source digests and links | `make check` | Exit 0; no link or digest failures |
| REQ-CORE-001 and lifecycle boundaries; evaluator and gates | `make core-test engine-test` | Exit 0; 18 lifecycle/boundary and 19 engine tests passed |
| Full suite, including relocated evaluator and frozen adapter | `make test ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-engine.MNFEVS/test` | Exit 0 |
| Full suite with Python optimization | `make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-engine.MNFEVS/optimized` | Exit 0 |

The relocated evaluator and gate tests and Python adapter are byte-for-byte
unchanged. Engine tests exercise fixed gate order, frozen-content drift refusal,
host failures, fresh finalist evaluation, and Pareto selection. The core boundary
check grants imports only to the engine adapter's exact file path; lifecycle and
ledger allowlists and import-isolation assertions remain in place. Full-suite logs
and evidence are outside the source tree under `/tmp/endoforge-engine.MNFEVS/`.

## Runtime relocation verification

On 2026-11-01, the runtime relocation passed locally with Python 3.14.8,
Node.js v26.13.0, and bubblewrap 0.13.1. The Git commit containing this section
identifies the relocation baseline.

| Scope | Command | Observed result |
|---|---|---|
| REQ-DOCS-001; runtime source digests and links | `make check` | Exit 0; no link or digest failures |
| Full suite, including relocated pool tests and workflow callers | `make test ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-runtime.IwV9kx/test` | Exit 0 |
| Full suite with Python optimization | `make test-optimized ENDOFORGE_TEST_OUTPUT=/tmp/endoforge-runtime.IwV9kx/optimized` | Exit 0 |

Pool tests retain their assertions for client selection, registry recursion
prevention, stdin forwarding, cooldown refusal, and rate-limit failover.
Only module paths and code comments changed in the touched JavaScript sources.
Test expectations and fixtures are unchanged. Logs and configured test evidence
are outside the source tree under `/tmp/endoforge-runtime.IwV9kx/`.
