# Library v0

A need that a promoted kernel already satisfies can skip the implementation stage. Off by default: `runNeed` consults a library only when a caller passes one from `openLibrary`.

The specification stage still runs, because the frozen evaluator is what a hit is judged against. So v0 saves the implementation model turn and the compile and gate spawns behind it, not the first model turn.

## Flow

| Step | Module | Process cost |
|---|---|---|
| Admit: verify chain, promotion, receipt, candidate and evaluator bindings; re-pass the kernel's own tests under the current gates | `verify_promotion.py`, `library.mjs` | One Python process per batch, cold path |
| Look up by canonical contract key | `key.mjs` | In memory |
| Run the new need's frozen tests through `runGates`, then the discrimination gate | `cell.mjs`, `cells.mjs`, `discriminate.mjs`, `mutants.mjs` | Warm worker thread, no spawn |
| Write a reuse or refusal receipt naming the source promotion | `journal.mjs` | One `fsync` |

A miss before any cell run writes nothing. A cell timeout, breach or crash is a refusal, never a pass.

## What the key decides

The key hashes per-export and positional, without export or argument names: argument kind, unit, parsed range and openness, code tables; result kind, unit, precision, declared rounding, code tables, labels; whether the export traps; and the set of numerals in the frozen contract, headings excluded. Need text is not an input.

| A near-miss that differs in | Handled by |
|---|---|
| A declared unit | Key |
| Declared precision or rounding mode | Key |
| A declared range bound or its openness | Key |
| A constant or threshold written as a numeral in the contract | Key |
| Sign, or any behaviour the tests can see | Evaluator in the cell |
| A variant the tests can't see | Discrimination gate refuses, if a wasm mutant or result wrapper of the kernel reaches it |

Where it can't decide:

- An English-only difference that changes no numeral and no declared field: "sign reversed", "round down", "exclusive". The key doesn't read prose. If the tests and capability still describe the kernel, nothing here sees it.
- A wrong label. Glue units and code labels aren't verified by any gate, so an admitted kernel can carry a unit it doesn't compute. A need declaring that unit matches, and only its tests stand in the way.
- Unit aliases are a small closed table, and `F` and `C` read as temperature, not farad or coulomb. Any other spelling keeps its exact case and misses.
- Equivalent contracts written with different numerals miss. That is a cost, not a soundness risk.
- A fault the mutant set and probe grid can't reach. Both are bounded: 600 sites and 512 rows per export.

Two kernels with different fingerprints under one key prove the key doesn't pin the meaning, so that key is a miss, `ambiguous_key`.

## Capability

A live need declares its capability in a fenced `capability` JSON block in the frozen `CONTRACT.md`, so its hash is bound at freeze. The generator's specification prompt doesn't ask for this yet, so generated needs currently miss with `no_capability`. Admitted kernels take theirs from their promoted glue.

## Revocation

`revoke(id, reason)` stops the kernel and every implementation with the same key and fingerprint, journals it, and returns the reuse receipts that named them. `dependants(id)` finds them later. Past receipts are retained. `requalify()` re-runs own tests for entries qualified against older gate or host bytes and retires failures; until then those entries aren't served.

## Boundary with the engine

Cells here are worker threads with the pool's heap limits and memory guard, but not `IsolatePool`: `evaluateCandidates` starts a Python process per frozen check, which the warm path must not do. The receipts live in their own hash chain, not `core/ledger`, whose schema has no reuse record.

Run `make library-test`. Measurements: [P-53](../../experiments/P-53-library-v0/PRECOMMIT.md).
