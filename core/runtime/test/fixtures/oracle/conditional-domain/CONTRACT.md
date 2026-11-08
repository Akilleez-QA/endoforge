# C-012: Generic name identifiers

The document sweep must replace every name with a generic identifier, with no denylist or exemptions.
Assumption: “names” means all spans identified as names by the caller, regardless of name type.
This kernel decides replacement identifiers; it does not detect names or process text.
The caller detects name spans, resolves repeated entities, and assigns entity ordinals.
Ordinals are consecutive positive integers assigned in first-appearance order across the document set.
The caller reuses an ordinal for the same entity and keeps the name-to-ordinal mapping private.
Generic identifiers contain no source-name text and are rendered exactly as `ENTITY_<ordinal>`.
The caller must supply all detected names; completeness of detection is outside this kernel.

## Pure bounded AssemblyScript interface

Export `genericIdentifier(isName: f64, entityOrdinal: f64): f64` only.
All inputs and outputs are finite numeric scalars; both parameters represent integers.
No storage, text, imports, allocation, external state, or unbounded loops are required.
Maximum supported entity ordinal is 1000000; exceeding it traps, never wraps or aliases.
Validate all inputs before returning a result.
`isName` must be exactly 0 or 1.
When `isName = 0`, `entityOrdinal` must be exactly 0.
When `isName = 1`, `entityOrdinal` must be an integer in [1, 1000000].
Formula: `genericIdentifier(0, 0) = 0`; `genericIdentifier(1, n) = n`.
Result 0 means preserve the caller's non-name span; positive n means replace the entire name span with `ENTITY_<n>`.
Every numeric result is shown with **0 decimal places** (glue result kind: number, precision: 0).
Repeated calls have identical results and do not allocate new ordinals.

## Traps

For `genericIdentifier`, when any input is nonfinite, nonintegral, or violates the flag/ordinal rules above,
trap with message `invalid name identifier input`.
Finite integer trap tests cover invalid flags, mismatched ordinals, and bounds.
The implementation must also reject nonfinite and fractional inputs even though those are outside the test boundary.
