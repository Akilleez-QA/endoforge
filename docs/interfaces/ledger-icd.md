# Ledger interface control document

## Scope and ownership

The engine core owns [the ledger package](../../core/ledger/__init__.py),
[record schema](../../core/ledger/record.schema.json), and
[frozen evaluator support](../../core/ledger/frozen.py). Workflow callers remain
under `tools/`; local execution pools are owned by `core/runtime/`. The move from `tools.ledger` to `core.ledger` changes module paths;
it preserves behavior and does not migrate stored data.

## Python and command interfaces

| Interface | Contract |
|---|---|
| `from core.ledger.ledger import Ledger` | Open a durable SQLite path; append validated records, read records, admit version 1 records, and query lineage |
| `from core.ledger.frozen import FrozenEvaluators` | Freeze evaluator files and configuration, require matching frozen content, and record evaluation receipts |
| `python3 -B -m core.ledger.frozen freeze LEDGER TREE MANIFEST` | Read a JSON manifest, freeze the evaluator tree into the ledger, and print its identity; refusals exit with status 2 |
| `import core` | Preserve lifecycle exports without opening a ledger or loading execution integrations |

`core.ledger` is a package marker; callers import the concrete modules explicitly.
The [engine adapter](../../core/engine/frozen.py) consumes these modules without
changing its JSON request or response contract.

## Engine interfaces

The evaluator and gates now live under `core/engine/`; callers import the concrete
JavaScript modules explicitly. `core` lifecycle exports remain unchanged.

| Interface | Contract |
|---|---|
| `core/engine/evaluator.mjs` | Exports `requireFrozen`, `evaluateCandidates`, and `paretoFrontier`; host callbacks supply candidate operations and measurements |
| `core/engine/gates.mjs` | Exports `GATE_ORDER`, individual gates, and `runUniversalGates`; preserves ordered first-failure results |
| `python3 -B -m core.engine.frozen` | Reads a JSON request on stdin with `ledger`, `identity`, and `root`; emits `identity`, `digest`, and `bundle` on stdout |

The Python module replaces `tools.engine.frozen`. JSON shapes, frozen identities,
gate order, callback contracts, Pareto selection, and failure behavior are unchanged.
The engine relocation preserves its callback contracts and grants no authority.

## Runtime interfaces

Runtime callers now resolve `core/runtime/` instead of `tools/runtime/`.
The move preserves arguments, environment variables, stdin forwarding, output,
exit statuses, account slot handling, cooldowns, and failover behavior.

| Interface | Contract |
|---|---|
| `core/runtime/agent-pool.mjs` | CLI for local client execution and pool status; selects `CODEX_POOL_BIN` or a client on PATH, with existing account, guard, state, and optional worker-registry configuration |
| `core/runtime/stub-pool.mjs` | Replays `ENDOFORGE_STUB_REPLAY` outputs into the isolate output bind and launches `CODEX_POOL_BIN` using `ENDOFORGE_ISOLATE_SPEC` |

Atomizer and hillclimb resolve the relocated launcher relative to their modules;
explicit pool overrides retain precedence. `make runtime-test` invokes the relocated
synthetic pool tests. Importing the Python `core` package does not launch a pool.

## Persistent data compatibility

[Ledger validation](../../core/ledger/ledger.py) continues to use the adjacent
schema. Record versions 0 and 1, canonical JSON encoding, record identities,
SQLite tables and triggers, and hash chain construction are unchanged. Existing
durable databases need no conversion. The ledger does not grant execution or
activation authority, and lifecycle transitions do not automatically append records.

## Verification

`make ledger-test` exercises persistence, provenance, frozen content, and the
relocated CLI. `make core-test` checks the scoped standard library boundary and
import isolation. `make engine-test` exercises the engine adapter and its callers.
See the [verification matrix](../verification/verification-matrix.md).

## Caller-supplied invariant checks

The existing evaluator callback is
`port.invariant(name, candidate, bundle, round)`. Frozen
`configuration.invariants` selects unique check names; the caller resolves each
name through a plain registry of functions supplied by its foundation. For
example, a caller can define `const registry = { identity: checkIdentity }` and
implement the callback with `registry[name](candidate, bundle, round)`.
No registry loader or domain package is imported by the engine.

Each check returns `{ passed: boolean, reason: string }` with a nonempty reason.
A false verdict rejects the candidate before measurement; malformed evidence
also rejects it. A thrown callback, including an unresolved registry name,
stops evaluation with `outcome_unknown`. Callers must preserve the existing
frozen evaluator identity and evidence contracts.
