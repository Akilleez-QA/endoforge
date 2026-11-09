# Architecture

## Context

EndoForge groups the Python lifecycle model, evidence ledger, and evaluator and
gates and local agent execution pools in the engine core.
The [lifecycle model](../../core/lifecycle.py) represents proposals and decision
references without issuing external decisions or activating artifacts in a host.
The runtime runs candidate evaluation in V8 workcells and drives the X1 candidate loop; workflow orchestration stays
in `tools/`. [The candidate loop](candidate-loop.md) explains one attempt from need to decision.
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
| `core/constraints/` | Constraint records kept separately from transcript compaction | [Constraint tests](../../tests/test_constraint_record.py); [interface](../interfaces/constraint-record.md) |
| `core/library/` | Reuse a promoted kernel for a need it satisfies, behind a canonical contract key and a discrimination gate | [Library tests](../../core/library/test/library.test.mjs) |
| `core/runtime/isolate-*.mjs` | `IsolatePool`: thread or process workcells, heap and WebAssembly memory limits, cgroups, deadlines, persistent ledger bridge | [Runtime guidance](../../core/runtime/README.md); `make isolate-test` |
| `core/runtime/x1/` | The X1 candidate loop: generator, compiler, gates G1–G9, agent loop, formula oracle, evaluator synthesis, transports | [Candidate loop](candidate-loop.md); `make loop-test`, `make pipeline-test` |
| `core/runtime/contained/` | Run emitted JavaScript in a supervised V8 cohort (compatibility lane) | [Contained JavaScript](../../core/runtime/README.md#contained-javascript) |
| `core/runtime/capacity/` | Width, placement and split from the machine probe (Mjölnir) | [Capacity ICD](../interfaces/capacity-icd.md); `capacity.test.mjs` |
| `core/runtime/subscription-guard.mjs`, `usage-governor.mjs` | Refuse non-subscription `claude -p` launches; park calls near the weekly usage ceiling | `subscription-guard.test.mjs`, `usage-governor.test.mjs` |
| `core/runtime/dump-list.mjs`, `tools/dump_list.py` | Register sheddable memory for a machine memory guard | `dump-list.test.mjs`, `tools/test_dump_list.py` |
| `core/runtime/agent-pool.mjs`, `stub-pool.mjs` | Launch local Codex clients across accounts, or replay stub outputs | [Agent pool contract](../../core/runtime/README.md#agent-pool-contract) |
| `tools/ledger_writer.py` | Group-commit ledger writer with a crash journal | [Writer journal](../interfaces/ledger-icd.md#ledger-writer-journal) |
| `tools/tscheck/` | Pinned tsrs TypeScript checker for pool workcells, exposed as an evaluator invariant | [Checker tests](../../tools/tscheck/test/tscheck.test.mjs) |

[tools/README.md](../../tools/README.md) lists the workflow tools.

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

- A callable Cstack bridge. Cstack vendors a fixed slice at a pinned commit; see the [Cstack ICD](../icd/icd-cstack.md).
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
