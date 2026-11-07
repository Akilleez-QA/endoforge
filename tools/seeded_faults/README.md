# Seeded faults

`generate(known_good, anchor_id=..., inputs=..., faults=..., seed=...)` takes a trusted synchronous JSON-to-JSON anchor with a caller-pinned identity, a non-empty input list and explicit mutation sites. Each fault is a closed JSON object with a family and a path of dictionary keys or non-negative array indices.

| Family | Parameter | Effect |
|---|---|---|
| `swapped_units` | `other` | Swaps output unit labels without converting values |
| `dropped_rows` | `index` | Removes that output row when present |
| `off_by_one` | `delta` (-1 or 1) | Shifts an integer output |
| `reversed_inputs` | `other` | Swaps input operands before running the anchor |
| `stale_binding` | `stale` | Replaces an output binding with an explicit prior revision |

These are semantic injections, not typed-IR source mutations, and the caller names the fields they touch. A structurally valid swap can be a semantic no-op, so every candidate goes through the filter. Canonical JSON is the observation contract: object key order is ignored, while list order and numeric representations count. A match on a finite input set is reported only as `equivalent_on_extended_set`.

The receipt carries the generator digest, seed, anchor identity, input and baseline digests, candidate identities, one distinguishing input with both outputs for each emitted fault, the filtered descriptors and counts. Empty sets, duplicates, invalid paths or types, non-finite outputs, exceptions and more than 100,000 executions abort the batch.

Callbacks are trusted. This is not a sandbox, it does not enforce a timeout and it does not check that an anchor was independently verified. Run `make seeded-fault-test`.
