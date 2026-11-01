# Ledger interface control document

## Scope and ownership

The engine core owns [the ledger package](../../core/ledger/__init__.py),
[record schema](../../core/ledger/record.schema.json), and
[frozen evaluator support](../../core/ledger/frozen.py). Execution callers remain
under `tools/`. The move from `tools.ledger` to `core.ledger` changes module paths;
it preserves behavior and does not migrate stored data.

## Python and command interfaces

| Interface | Contract |
|---|---|
| `from core.ledger.ledger import Ledger` | Open a durable SQLite path; append validated records, read records, admit version 1 records, and query lineage |
| `from core.ledger.frozen import FrozenEvaluators` | Freeze evaluator files and configuration, require matching frozen content, and record evaluation receipts |
| `python3 -B -m core.ledger.frozen freeze LEDGER TREE MANIFEST` | Read a JSON manifest, freeze the evaluator tree into the ledger, and print its identity; refusals exit with status 2 |
| `import core` | Preserve lifecycle exports without opening a ledger or loading execution integrations |

`core.ledger` is a package marker; callers import the concrete modules explicitly.
The [engine adapter](../../tools/engine/frozen.py) consumes these modules without
changing its JSON request or response contract.

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
