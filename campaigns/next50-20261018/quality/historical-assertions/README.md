# Historical structural assertion adapter

This adapter reads actual frozen legacy `glue.json`, `CONTRACT.md` and `kernel.wasm` files without altering them. It validates and decodes WASM type/import/function/export sections without instantiating or executing generated code. Claimed argument paths are bound to real exported parameter positions.

```sh
node tools/factory_quality/historical_assertions.mjs selftest
node campaigns/next50-20261018/quality/historical-assertions/build_profiles.mjs
node tools/factory_quality/historical_assertions.mjs replay /home/user/Work/endoforge campaigns/next50-20261018/audit/historical-development/paired-artifact-inventory.json campaigns/next50-20261018/quality/historical-assertions/profiles.json
```

Exports: `wasmSignatures(bytes)`, `loadHistoricalArtifact(repositoryRoot,relativeArtifactDirectory)`, `checkHistoricalAssertion(assertion,artifact,arm)`, `replayHistoricalAssertions(root,inventory,assertions)`.

An assertion is `{version:1,id,requestId,kind,routes:{incumbent:{export,names?,units?,minimumDecimals?},'fast-path':{...}},criteria:[{path,sourceLine,fileSha256,lineSha256,scope}],scope,rationale}`. Optional `onlyArm` is for schema qualification of a single observed export. Supported kinds are `binding`, `required-input`, `argument-unit`, `output-unit`, `precision` and `trap-binding`.

Each profile uses exact field paths and explicit permitted unit aliases. Its semantic role is authored from the raw historical criterion; the checker does not discover role meanings through keywords. Missing decisive inputs remain failures. Sources include whole-file and source-line hashes. No clause is completed merely because a keyword occurs in an artifact.

`binding` checks actual argument count, numeric ABI families, declared kinds, unique argument names, units and result kind. `number` requires f32/f64; `code` and `boolean` require i32. A declared `integer` may have an integer or floating ABI because historical adapters sometimes accept a floating value and reject non-integral values inside WASM. This structural check does not prove that integral-value guard; behavioral procedures must do so.

`trap-binding` checks only that a nonempty condition/message is attached to the selected actual export. It does not prove that the message names the correct argument or that a particular input traps. Numeric/refusal execution comes from the independent auditor/runtime lane.

`CONTRACT.md` is hashed as provenance. This adapter deliberately does not turn free prose into validated source authenticity, applicability or standards truth. Those source criteria remain unresolved unless a separate verified provider procedure covers them.

The power-versus-energy intake profile records the absence of a quantity-dimension envelope in the scalar interface. It does not alone prove the labeled kW conversion is numerically wrong. The PS output-label profile records generic hp metadata on the incumbent convention overload; its numeric metric conversion is a separate question. Whole-clause trace updates must retain these distinctions.

`controls.json` contains positive/negative checks for each kind, changed f64-to-i32 ABI controls, unknown-kind controls, and malformed-WASM rejection. `replay.json` preserves every actual arm outcome. Passing a checker control is separate from passing an artifact. All work here is deterministic, with no model calls or Claude CLI invocation.
