# Factory quality v1

Zero-dependency Node ESM library and CLI. This is a bounded local kit, not a deployed factory. Generic code contains no refrigeration tables. Domain fixtures and recorded evidence live under `campaigns/next50-20261018/quality/`.

## Execute

```sh
node tools/factory_quality/test.mjs
node tools/factory_quality/cli.mjs validate request campaigns/next50-20261018/quality/development-request.json
node tools/factory_quality/cli.mjs cases campaigns/next50-20261018/quality/test-frozen.json
node tools/factory_quality/cli.mjs check campaigns/next50-20261018/quality/test-frozen.json campaigns/next50-20261018/quality/test-candidate.json
node tools/factory_quality/cli.mjs qualify campaigns/next50-20261018/quality/test-packet.json
python tools/factory_quality/reference_boundary.py
python campaigns/next50-20261018/quality/reference_probe.py
```

`test.mjs` recreates its *deterministic fixture* receipts; real model attempts and frozen campaign receipts are separate and retained. `live.py` creates a new unique directory and precommit before invoking at most six subscription CLI turns, with a 180-second process-group deadline per turn and ephemeral auth homes. Do not invoke it during a different declared budget without a new precommit. No API keys, SDKs or purchases are used.

## Stable integration API

Import from `tools/factory_quality/index.mjs`:

* `validateRequest(request)`, `validateSignature(signature)`, `validateContract(contract)`, `validateProvider(provider)` return input or throw an explicit error, including unknown versions.
* `routeRequest(request)` returns `{requestId,route,stratum,reason,counted:true}`. Class mapping: closed-form→compute; lookup→reference-lookup; text-check→text-validation; workflow→workflow; process-rule/unsupported→unsupported. A route is classification, not evidence of a qualified execution backend.
* `resolveFacts(request,signature)` returns per-path required-input, stable-default, sourced-lookup or underdetermined. Required inputs report a hash of paired evidence; suite freeze rejects absent evidence or decision-stable facts asserted as required. Missing evidence never justifies an omitted default. This validates supplied evidence; it does not invent unknown facts from prose or independently validate caller arithmetic.
* `evalView(request,signature,provider?)` constructs an allowlisted `{version,request:{id,raw},signature,reference}` view. Full contracts, generator code, previous questions, defaults and verdicts are not carried through. Full request schema rejects extra top-level fields; bare signature rejects unlisted keys.
* `expandProcedure(procedure)` emits repeatable finite numeric cases; v1 supports affine, threshold and provider lookup families, count 2–256, unsigned 32-bit LCG seed. Lookup is exact-only; interpolation requests explicitly return missing until qualified.
* `validateSuite(bundle)` returns `{cases,facts}` or throws on disagreement, refusal/domain contradiction, duplicates, unsupported procedure and output-unit mismatch. Two distinct writer family records are required. The orchestrator must bind these records to actual raw model receipts; strings alone are not authentication.
* `freezeSuite(bundle,{generatorStartedAt:null})` returns `{version,suite,suiteHash,procedureHash,casesHash,frozenAt}`. `verifyFreeze(frozen)` verifies hashes. The orchestrator enforces actual stage ordering and immutable storage; the library cannot stop a caller lying about timestamps.
* `checkCandidate(frozen,{signature,outputs},provider?)` checks existing outputs only, executes no untrusted code and returns `{passed,failures,caseCount,suiteHash,referenceHash}`. Each output is `{caseId,value,unit}` or `{caseId,error:{path,message?}}`. It checks exact signature identity (name, arguments, domains, units and output type), missing/duplicate/unknown cases, values, units, input paths and named refusals. Run candidate code in the bounded runtime and collect these outputs there.
* `physicalChecks(signature,inputs)` names missing inputs, types, non-finite values and domain violations, citing ECMA-262 or the declared request. No domain-specific constants are inferred.
* `referenceLookup(provider,key,inputs)` returns ok, unavailable, out-of-domain or missing, never extrapolates. Provider identity binds records with `hash(records)`; caller also retains whole-file provenance hash and source hashes. Provider content is supplied only to trusted evaluation.
* `qualify(frozen,controls,thresholds)` checks canaries, known-good controls and non-equivalent mutations. Controls: `{id,kind:'good'|'canary'|'mutation',expectedCode?,candidate,provider?}`. Default gates: recall1, false rejection0, sensitivity1. Equivalent mutations must be classified separately and excluded explicitly.

CLI syntax: `validate request|signature|contract|provider|suite file`; `freeze bundle new-destination`; `cases frozen`; `check frozen candidate [provider]`; `qualify packet [output]`. A packet is `{frozen,controls,thresholds}`. Failed validation/checks exit1.

## Data shapes

Request v1: `{version:1,id,raw,artifactClass,requiredFacts:[{path,unit,domain:[min,max],tolerance,plausible?:[{value,result},{value,result}],resolution?:{kind:'default',value}|{kind:'lookup',provider,source}}],sources:[]}`.

Bare signature v1: `{version:1,name,inputs:[{path,type:'number'|'string'|'boolean',unit,domain?:[min,max]}],output:{type:'number'|'string'|'boolean'|'object',unit}}`. Numeric domains must be finite. JSON fixtures represent non-finite invalid arguments as strings `NaN`, `Infinity`, `-Infinity`; runtime adapters convert those to numeric non-finites before invoking numeric capabilities. Empty case input objects represent missing inputs and require named refusal rather than silently becoming zero.

Contract v1: `{version:1,signature,refusals:[{path,reason}],tolerance,sources:[nonempty]}`.

Provider v1: `{version:1,name,providerVersion,source,contentHash,units:{...},limits:{key:{input:[min,max]}},interpolation:'exact-only'|'linear',records:[{key,inputs:{...},value,unit}],provenance?:{...}}`. Linear is declared but intentionally unimplemented and fails closed on non-exact requests.

Bundle v1: `{version:1,request,signature,writers:[{family,viewHash,outputHash},...],procedures:[{version:1,id,kind,input,domain,count,seed,tolerance,unit,slope?,offset?,threshold?,below?,above?,referenceKey?}],cases:[{id,inputs,expect?,expectError?,errorPath?,tolerance,unit,referenceKey?}]}`.

## Evidence boundaries

Deterministic controls qualify mechanics, not whether a model discovered every real requirement. The current small packet contains three synthetic development requests. Historical criteria and genuine technician requests require separate qualified procedures; arbitrary workflow/text schemas are not executable through the numeric checker. Missing physical limits require an explicit consuming-provider hook. No cross-host, production, general utility or restricted model-network claim follows from these tests.
