# POODO review — tsrs and Endoforge, 20 October 2026

**Decision:** retain the pinned tsrs probe, defer adoption and hosted-stack tuning. Its next use requires an actual TypeScript compatibility workload or an explicit hosted-development requirement. The current scalar factory uses AssemblyScript, so no current factory speedup follows from this checker benchmark.

## Frame and acceptance

Depth: Deep, because prior-session evidence and proposed architecture choices need adversarial review. User-stated objective: assess the linked article's relevance to Endoforge, investigate, then apply poodo. Inferred acceptance: a justified project decision that distinguishes measured component effects, current factory relevance and remaining intended-use tests. Authority covers source inspection, local bounded investigations and research documentation; it does not imply adoption, production deployment, paid services, external messages or an unlimited new model campaign. No native persistent goal was requested or created. Context supplies the project and intended decision, so another opening question would repeat existing information.

Success surface: relevance decision -> actual factory entry and compile path plus compatibility/hosting needs -> source trace, raw probe records, current campaign decision -> local code and retained receipt sensors -> explicit bounded recommendation. A component result can support the future checker candidate, not accepted-capability utility, factory throughput or real hosted enforcement.

Strongest rival at entry: a cheap hosted tsrs experiment should happen immediately because the speed improvement and lower RSS could unlock fully hosted development. Discriminator: a declared hosted requirement or an actual compatibility workload on the critical path, followed by real-platform capacity measurement. We did not assume this requirement from an article about Workers.

## Observations and provenance

- O-TSRS-01, **Recorded (inspection):** `tools/factory_campaign/pipeline.py::_script('compile')` invokes AssemblyScript `asc.js`; `verify_publish` calls `compile_candidate`, then `invoke_cases`, then the trusted gate. `campaigns/x1-spec-study/factory/gate.mjs` also invokes `asc`. This is a bounded source trace of the inspected scalar pipeline, not proof that no other repository or future route uses TypeScript. Pipeline and gate identities are in `receipt/poodo-source-identity.json`.
- O-TSRS-02, **Recorded (prior probe, rechecked identity):** raw P-14 JSON has four arms, twenty measured checks for each of two fixture sizes. The 50-module warm medians are 80.95/32.43 ms Node and 86/31 ms workerd, old/new. Exported linear memory is 52/100.6875 MiB. `receipt/poodo-input-identity.json` binds the inspected artifacts. Hashes identify evidence, not independent corroboration.
- O-TSRS-03, **Recorded (inspection):** the 160 checks repeat only two deterministic projects, and the negative cases use one assignment-error class. They are not 160 distinct correctness challenges. Tiny emit/astral-position controls are Node-only. Cold means the first invocation after module compilation, not application cold start.
- O-TSRS-04, **Recorded (inspection):** old-arm timing includes a temporary WebAssembly.Instance observer and indexed legacy filesystem; new uses the upstream filesystem and memoryBytes. Both optimization profiles and compiler versions differ. The reported factor is for the tested integration; no isolated compiler-algorithm speedup follows. Sequential arm order and shared-machine load limit precision.
- O-TSRS-05, **Recorded (prior campaign decision, inspected):** `campaigns/next50-20261018/DECISION.md` and `control/decision.json` retain the incumbent; five synthetic scalar requests provide no completion advantage and no real refrigeration utility result. This is a separate workload and evidence family; it is not a baseline denominator for P-14 speedup.
- O-TSRS-06, **reported critic analysis:** a blind-opening critic inspected raw receipts and harness without reading RESULT or parent conclusions. It found the same bounded claim, and proposed prioritising actual capability/evaluator validity over compiler work without a demonstrated bottleneck. Prompt/method independence only: same model family, raw inputs and machine. Agreement does not duplicate runtime evidence. Opening and final memo are retained in `receipt/poodo-critic.md`.

## Research gate, completed before orientation

Retrieved 20 October 2026. Queries: `site:developers.cloudflare.com workers limits memory WebAssembly 128 MB isolate memory allocation`; `site:v8.dev wasm memory reservation committed memory linear memory`; `site:github.com/oxc-project/tsrs wasm maxMemory stack memory`; `site:devblogs.microsoft.com/typescript native port performance type checking benchmark`. Disconfirmation sought: compiler speed need not improve the actual pipeline; lower RSS need not improve isolate fit; native/API evidence need not apply to WASM; the old upload ceiling may be stale.

Evidence families and inspected sources:

1. Platform authority: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (updated 12 Oct 2026), memory section and bundle-size section; [metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), memory section; [profiling](https://developers.cloudflare.com/workers/observability/dev-tools/memory-usage/) (updated 8 Oct 2026). Platform documentation says 128 MB is shared per isolate, including JS and WASM. It offers sampled isolate memory metrics, not proof that a transient peak was captured. Current upload limit is **64 MiB uncompressed**, with no compressed-size limit. This contradicts using the historical 10 MB compressed screen as a current platform rule. P-14's frozen screen remains historical, not silently revised. No platform deployment or live capacity reading was obtained.
2. Compiler maintainer: [pinned WASM README](https://github.com/oxc-project/tsrs/blob/280b426b89cd4ecd6153cf48228826bd60a99c61/npm/tsrs-wasm/README.md), runtime/API limits; [defaults](https://github.com/oxc-project/tsrs/blob/280b426b89cd4ecd6153cf48228826bd60a99c61/docs/DEFAULTS.md). Fresh-instance state, 80 MiB shadow stack, WASM LSP/API exclusion and behavioral defaults are upstream statements; local small-input execution supports only the exercised interface. Multiple tsrs pages are one maintainer family.
3. Independent language authority: [Microsoft TypeScript 7 release](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) (8 July 2026), native/parallel execution and single-threaded controls. It supplies an official alternative/oracle family. Its release benchmark is neither a WASM result nor a local reproduction. A matching upstream commit and options matter before differential acceptance.
4. Runtime engineering context: [V8 wasm memory article](https://v8.dev/blog/4gb-wasm-memory) (14 May 2020). It explains logical memory/exported ArrayBuffer representation, not current Cloudflare billing/enforcement. It cannot establish that subtracting buffer size from a documented budget yields operational headroom.
5. Lifecycle challenge: [Cloudflare WASM finalization change](https://developers.cloudflare.com/changelog/post/2025-05-08-finalization-registry/) (8 May 2025). Toolchain allocation lifecycle can affect memory. No evidence shows its flag or mechanism would repair this tsrs workload; no configuration change was made.

Triangulation boundary: provider documentation establishes the platform contract, the compiler package describes its logical memory and API, and local execution measures the bound artifacts. These are distinct claims from distinct families, not three corroborations of hosted fit. The research gate is satisfied for a defer/adoption-priority decision; real platform capacity remains unresolved.

## Topology and bounded traversal

Explored: article relevance -> external architectural example; current factory -> AssemblyScript compile/eval/publication; planned compatibility -> TS diagnostics/emit and official oracle; hosting -> account limits, logical linear memory, RSS, GC, overlapping instances and missing enforcement; persistent checking -> native API versus WASM incremental files; product value -> task ambiguity, evaluator validity and actual accepted-capability usefulness. Owner/operator needs and future hosting demand remain inferred or unknown. Model costs and actual consumer utility were considered through existing records, not remeasured. Unreached: real platform operation, representative compatibility corpus, cross-host replication, adversarial recursion and user acceptance.

Exactly twenty paths, generated before ranking:

1. Defer tsrs adoption with a demand trigger; preserves the current factory and the candidate evidence.
2. Add a shadow-only checker adapter; compare outputs without affecting acceptance.
3. Run an isolated real-platform capacity study; resolve charged memory and lifecycle behavior.
4. Study native persistent API sessions; test retained semantic state across edits.
5. Build a smaller shadow stack under a declared depth contract; exchange supported recursion for capacity.
6. Use a supervised native checker service locally; move compiler state outside a tight hosted isolate.
7. Compile/check off-platform and ship checked artifacts; hosted workers only consume capabilities.
8. Put compatibility checking in a browser worker; change placement and available memory/stack constraints.
9. Use the official matching TypeScript native compiler as the compatibility implementation; reduce port divergence risk.
10. Run representative real-task utility/evaluator qualification; test the project's intended value surface.
11. Improve seeded-fault discrimination in frozen evaluators; reduce false acceptance rather than latency.
12. Prototype candidate-disagreement questions; target ambiguity before generating more code.
13. Optimise model-turn context/effort under equal quality gates; target inference cost.
14. Use sketches plus bounded deterministic synthesis; avoid generating whole programs for eligible tasks.
15. Reuse proven capabilities via retrieval; eliminate redundant generation/checking for repeated needs.
16. Measure stage-level time and checker count on a representative workflow; determine whether compiler work matters.
17. Repeat the compiler comparison with equal build profiles and randomised arms; isolate performance attribution.
18. Test hostile-input resource limits and recovery; determine whether either checker can be safely operated on the intended input class.
19. Prepare a precise maintainer question/reproducer for an unresolved WASM interface or accounting issue; external sending would require separate authorization.
20. Explicitly stop pursuing TypeScript compatibility and commit the product scope to strict kernels; avoids an entire lane but requires the owner's product decision.

## Decision and reversal

D-TSRS-01: choose path 1 now, with path 16 as the first decision gate if a compatibility workload is proposed. Keep paths 2/3/4 conditional on that demand. Do not launch another broad campaign merely to justify having a faster compiler. Paths 10–15 may better serve the overall project but are outside this article review's execution scope. Path 17 improves attribution without resolving current product relevance, so defer it. Path 20 changes the product scope and is not inferred from the present request. Path 19 may prepare evidence but cannot send an external message.

Criteria: actual critical-path relevance, preservation of acceptance semantics, resource feasibility in the intended host, lifecycle reliability, incremental integration cost, reversibility. Current evidence supplies component feasibility and promising latency, not the first, second or third criterion at intended-use scope. The strongest rival remains a cheap immediate hosted probe: it wins if the owner explicitly needs all-in-hosted creation or a concrete TS workload cannot run locally/off-platform. Retain rather than reject tsrs.

Reversal: reopen when an actual TS compatibility request or explicit hosted-development requirement exists; when stage measurements show checker calls consume a material declared budget; or when a new artifact materially changes the memory/depth envelope. Do not use arbitrary microbenchmark multipliers as the trigger. For hosted fit, define intended overlay/depth/concurrency and enforce successful requests, correct results, peak/accounted memory and recovery on the real platform. A sampled chart alone may miss the event of concern.

## Orchestration checkpoint and learning

Bounded action P-TSRS-DOC-01, prospective before report edits: revise only research documentation to say the current scalar pipeline does not use tsrs, narrow sample-count/headroom/cold-start language, and record current bundle rules without changing the frozen experiment. Oracle: inspected pipeline source, raw JSON and identified upstream pages above. Success: revised claims remain scoped and all original raw/harness hashes in `receipt/poodo-input-identity.json` remain identical. Failure means accidental evidence mutation or an unsupported claim and blocks delivery. Owner: primary agent. Monitoring: compare hashes after editing; stop on drift. Rollback: restore only this turn's report additions; never overwrite original receipts or predictions. No deployment, new benchmark or model calls required.

Fan-out checkpoints: a blind critic was used at Observe -> Orient because priority and oracle scope could alter the transition. At Pontificate -> Observe, primary framing and critic assignment proceeded together. At Orient -> Decide no additional worker was needed: the critic's raw-record challenge and direct pipeline trace already covered the live adoption-versus-defer discriminator. At Decide -> Orchestrate and Orchestrate -> Loop the action is one-owner documentation correction; another writer would add collision risk without a new evidence family. Bounded coverage is sufficient for the defer decision, not for full platform or compiler adoption.

Retrodictive learning: the first investigation followed the article's compiler/hosting frame too closely. Checking the actual current factory path earlier would have kept the promising microbenchmark separate from project priority. The example of an AI-written port and upstream-test discipline remains useful external context; it is not independent validation of Endoforge's own quality, utility or economics.

Delivery: report corrections prepared; outcome: no new runtime outcome claimed. Highest justified claim remains a faster tested checker integration on two synthetic projects, unrelated to any observed current-factory improvement. A later adoption study remains agent-executable within a concrete scope; real-task authority/acceptance and external deployment decisions remain with the owner.
