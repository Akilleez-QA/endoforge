# Factory quality

Typed checks for the evaluator side of a job: the request, the function signature, the contract, the eval suite and a
candidate's outputs against that suite. `core/engine/gates.mjs` imports `canonical`, `validateContract` and
`validateSignature` from here, and the isolate workcell (`core/runtime/isolate-workcell.mjs`) runs those engine gates through `core/engine/evaluator.mjs`,
so the workcell and this tool agree on what a valid contract is.

## How it works

`index.mjs` exports schema-version-1 checks that throw on bad input, plus the pieces of a freeze-then-check flow:

- `canonical(x)` and `hash(x)`: sorted-key JSON and its SHA-256.
- `validateRequest`, `validateSignature`, `validateContract`, `validateProvider`, `validateSuite`.
- `routeRequest(request)` and `resolveFacts(request, signature)`: route by artifact class (closed-form, lookup,
  text-check, workflow; process rules are unsupported) and classify each required fact as an input, a sourced lookup,
  a stable default or underdetermined.
- `expandProcedure(procedure)`: deterministic `affine`, `threshold` or `lookup` cases from a seed.
- `freezeSuite(bundle)` and `verifyFreeze(frozen)`: hash a suite before any generator runs, then detect any change.
  A suite needs writers from at least two model families and at least one executable procedure.
- `checkCandidate(frozen, candidate, provider)`: returns `{passed, failures, caseCount, suiteHash, referenceHash}`.
- `qualify(frozen, controls, thresholds)`: canary recall, false rejection and mutation sensitivity over control
  candidates, so a suite is shown to reject known-bad candidates before it is trusted.
- `referenceLookup` and `resolveDisagreement`: exact-record reference lookups.

`cli.mjs` wraps these for JSON files. It prints JSON and exits 1 when the result has `passed: false` or on an error:

```sh
node tools/factory_quality/cli.mjs validate request|signature|contract|provider|suite <file>
node tools/factory_quality/cli.mjs freeze <bundle> <output>
node tools/factory_quality/cli.mjs cases <frozen>
node tools/factory_quality/cli.mjs check <frozen> <candidate> [provider]
node tools/factory_quality/cli.mjs qualify <packet> [output]
```

## Example

```console
$ echo '{"version":1,"name":"quote.total","inputs":[{"path":"grams","type":"number","unit":"g","domain":[0,30000]}],"output":{"type":"number","unit":"cents"}}' > sig.json
$ node tools/factory_quality/cli.mjs validate signature sig.json
{
  "version": 1,
  "name": "quote.total",
  ...
}
$ echo '{"version":1,"name":"quote.total","inputs":[{"path":"grams","type":"number","unit":"g"}],"output":{"type":"number","unit":"cents"}}' > bad.json
$ node tools/factory_quality/cli.mjs validate signature bad.json; echo "exit $?"
{"passed":false,"error":"invalid finite domain"}
exit 1
```

A numeric input without a domain is refused. With no arguments the CLI prints its usage as a JSON error and exits 1.

## Limits

- Carried over from the earlier factory design. Only the three functions `core/engine` imports are on a live path
  (through the isolate workcell); the rest is reachable through the CLI.
- `index.mjs` is written as long single-line functions, which makes review hard.
- No environment variables are read.

## Tests

No dedicated target. `make engine-test` exercises the imported functions through `core/engine/gates.mjs`.

Engineering record: part of component C-03 (engine evaluator and gates).
