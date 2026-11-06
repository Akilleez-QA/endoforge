# Architecture

## Context

EndoForge groups the Python lifecycle model, evidence ledger, and evaluator and
gates and local agent execution pools in the engine core.
The [lifecycle model](../../core/lifecycle.py) represents proposals and decision
references without issuing external decisions or activating artifacts in a host.
The runtime launches configured agent clients; workflow orchestration stays in `tools/`.
See the [requirements](../requirements/requirements.md) for the tested boundaries.

## Components

| Component | Responsibility | Evidence |
|---|---|---|
| `core/lifecycle.py` | Immutable artifact identities, proposals, receipts, state transitions, and history replay | [Lifecycle tests](../../tests/test_endoforge_lifecycle.py) |
| `core/__init__.py` | Public lifecycle exports without concrete integrations | [Boundary tests](../../tests/test_endoforge_core_boundary.py) |
| `core/ledger/ledger.py` | Schema validation, durable references, SQLite records, and hash chaining | [Ledger tests](../../core/ledger/test_ledger.py) |
| `core/ledger/frozen.py` | Freeze evaluator content and reject changed components | [Frozen evaluator tests](../../core/ledger/test_frozen.py) |
| `core/engine/evaluator.mjs` | Coordinate candidate evaluation with frozen checks and host callbacks | [Evaluator tests](../../core/engine/evaluator.test.mjs) |
| `core/engine/gates.mjs` | Apply schema, interface, bounds, determinism, and forbidden-effects gates in order | [Gate tests](../../core/engine/gates.test.mjs) |
| `core/engine/frozen.py` | Verify frozen evaluator references through the core ledger | [Evaluator tests](../../core/engine/evaluator.test.mjs) |
| `core/runtime/` | Launch local agent clients and replay stub outputs, separate from lifecycle state | [Runtime guidance](../../core/runtime/README.md) |
| `tools/tscheck/` | Pinned tsrs TypeScript checker for pool workcells, exposed as an evaluator invariant | [Checker tests](../../tools/tscheck/test/tscheck.test.mjs) |

The [ledger ICD](../interfaces/ledger-icd.md) defines Python, CLI, and storage
interfaces. Importing `core` keeps its lifecycle exports and does not load the ledger.

## Data flow

A caller creates a proposed record with generation input identity and a frozen
oracle identifier. It requests a legal transition with stage-specific evidence.
The core validates the evidence and returns a proposal digest. A caller supplies
a decision reference bound to that digest; applying it creates a new record and
appends the decided transition to history.

Qualification binds a passing receipt to the candidate and frozen oracle.
Preview requires a preview reference. Activation requires a host approval
reference after preview. These are validated references, not host-side actions
or proof that an external approver is authentic. The caller supplies that trust.

The core ledger stores evidence explicitly; ledger writes and evaluator execution
are not automatic effects of applying a lifecycle transition. Frozen evaluation
checks bind evaluator files and configuration before judgment. Receipts and ledger
records preserve evidence for callers to inspect; generation alone cannot authorize later lifecycle stages.

## Design decisions

The Python core's standard library boundary, including scoped ledger and test allowlists,
is enforced by import inspection and a fresh Python process in the boundary tests.
The engine Python adapter alone may import `core`, `pathlib`, and `sys` in addition
to the lifecycle allowlist. The JavaScript gates retain their explicit dependency
on `tools/factory_quality/index.mjs`; host operations remain caller callbacks.
Proposal digest binding and history replay reject stale decisions and hand-set states. Evaluator freezing prevents edited
checks from being accepted as the original evaluation basis.

These describe existing code decisions. No historical architecture decision
records are present, and this document does not create new integration behavior.

## Not included

- An implemented Cstack bridge or pinned Cstack protocol.
- Decision issuance or host activation inside the core.
- Qualification of live model services by the synthetic repository tests.

## Domain ownership

Film utilities and the refrigeration invariant adapter are preserved unchanged
under `TODELETE/tools/film/` and `TODELETE/tools/invariants/`. Their destination
repositories are foundation-film and foundation-refrigeration, respectively;
the cross-repository transfers are handled separately. They are outside the
active engine and workflow tools.

The evaluator calls `port.invariant` for names in the frozen configuration.
Callers own the registry and domain dependencies. The job invariant catalog
contains workflow rules and imports no refrigeration implementation. Existing
engine tests use a synthetic identity invariant, including failure propagation.
