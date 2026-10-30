# Architecture

## Context

EndoForge separates a Python lifecycle model from execution and evidence utilities.
The [core](../../core/lifecycle.py) represents proposals and decision references;
it does not issue external decisions, run agents, or activate artifacts in a host.
See the [requirements](../requirements/requirements.md) for the tested boundaries.

## Components

| Component | Responsibility | Evidence |
|---|---|---|
| `core/lifecycle.py` | Immutable artifact identities, proposals, receipts, state transitions, and history replay | [Lifecycle tests](../../tests/test_endoforge_lifecycle.py) |
| `core/__init__.py` | Public lifecycle exports without concrete integrations | [Boundary tests](../../tests/test_endoforge_core_boundary.py) |
| `tools/ledger/ledger.py` | Schema validation, durable references, SQLite records, and hash chaining | [Ledger tests](../../tools/ledger/test_ledger.py) |
| `tools/ledger/frozen.py` | Freeze evaluator content and reject changed components | [Frozen evaluator tests](../../tools/ledger/test_frozen.py) |
| `tools/engine/evaluator.mjs` | Coordinate candidate evaluation with frozen checks and host callbacks | [Evaluator tests](../../tools/engine/evaluator.test.mjs) |
| `tools/runtime/` | Execution pool utilities separate from lifecycle state | [Runtime guidance](../../tools/runtime/README.md) |

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

The ledger and evaluator are separate utilities, not automatic effects of
applying a lifecycle transition. Frozen evaluation checks bind evaluator files
and configuration before judgment. Receipts and ledger records preserve evidence
for callers to inspect; generation alone cannot authorize later lifecycle stages.

## Design decisions

The core's standard library boundary is enforced by import inspection and a fresh
Python process in the boundary tests. Proposal digest binding and history replay
reject stale decisions and hand-set states. Evaluator freezing prevents edited
checks from being accepted as the original evaluation basis.

These describe existing code decisions. No historical architecture decision
records are present, and this document does not create new integration behavior.

## Not included

- An implemented Cstack bridge or pinned Cstack protocol.
- Decision issuance or host activation inside the core.
- Qualification of live model services by the synthetic repository tests.
