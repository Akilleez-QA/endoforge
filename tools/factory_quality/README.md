# Factory quality

The typed request, contract, eval-suite and candidate checks used by the evaluator. `core/engine/gates.mjs` imports `canonical`, `validateContract` and `validateSignature` from `index.mjs`.

## Entry points

- `index.mjs` exports, among others:
  - `canonical(x)` and `hash(x)`: sorted-key JSON and its SHA-256.
  - `validateRequest`, `validateSignature`, `validateContract`, `validateProvider`, `validateSuite`: schema version 1 checks that throw on bad input.
  - `routeRequest(request)` and `resolveFacts(request, signature)`.
  - `expandProcedure(procedure)`: deterministic `affine`, `threshold` or `lookup` cases from a seed.
  - `freezeSuite(bundle)` and `verifyFreeze(frozen)`: hash a suite before any generator runs, then detect changes.
  - `checkCandidate(frozen, candidate, provider)`: returns `{passed, failures, caseCount, suiteHash, referenceHash}`.
  - `qualify(frozen, controls, thresholds)`: canary recall, false rejection and mutation sensitivity over control candidates.
  - `referenceLookup` and `resolveDisagreement`: exact-record reference lookups.
- A suite needs writers from at least two model families and at least one executable procedure.
- `cli.mjs` wraps these for JSON files:

```
node tools/factory_quality/cli.mjs validate request|signature|contract|provider|suite <file>
node tools/factory_quality/cli.mjs freeze <bundle> <output>
node tools/factory_quality/cli.mjs cases <frozen>
node tools/factory_quality/cli.mjs check <frozen> <candidate> [provider]
node tools/factory_quality/cli.mjs qualify <packet> [output]
```

It prints JSON and exits 1 when the result has `passed: false` or on an error. Running `node tools/factory_quality/cli.mjs` with no arguments prints that usage as a JSON error and exits 1. No environment variables are read.

## Tests

There is no dedicated target. `make engine-test` exercises it through `core/engine/gates.mjs`.
