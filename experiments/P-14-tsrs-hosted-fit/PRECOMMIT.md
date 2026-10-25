# P-14 tsrs hosted fit — precommit

Label: **Proposed** procedure, frozen 20 October 2026 before measurements.

Question: does published @tsrs/wasm improve the old tsc-rs checker on Endoforge P-05 inputs, and does it justify reconsidering the hosted compatibility lane?

Pins: @tsrs/wasm 0.18.0-ts7.1.0-dev.20260929 (npm integrity retained); old tsc-rs v0.7.0 from P-05/lab pins. Source inspection: oxc-project/tsrs 280b426b89cd4ecd6153cf48228826bd60a99c61; source HEAD is not asserted to be the npm build commit.

Procedure: reuse P-05 deterministic generator unchanged (5 modules/1 planted TS2322; 50 modules/5 planted TS2322). Check both compiler builds in separate fresh Node processes and separate local workerd processes. Use each upstream in-memory filesystem API; old P-05 indexed filesystem retained for the old compiler. Reuse compiled modules; fresh instance per invocation. One cold check, 3 warmups then 20 samples per size; alternate size order between engines. Run sequentially on this shared desktop, no quiet gate, no campaign inference. Record module/core hashes, compressed sizes, module compile time where observable, environment before/after, all samples, stdout/stderr, exit status, diagnostics and linear-memory size. Node samples include post-call JS heap and process RSS/HWM; workerd samples record process RSS/HWM and exported linear memory, not isolate heap. Include the same trivial kernel instance as P-05. Use old workerd 1.20260930.1 to isolate compiler changes.

Checks: every timed invocation must report exactly the planted TS2322 diagnostics by file/line/column/code/category/text; retain differences rather than treating old compiler as a full oracle. Also check clean 50-module input and a UTF-16 diagnostic position fixture, and emit a tiny pure function with both compilers for byte comparison. No broad compatibility claim.

Bad signs: missing/wrong diagnostics, trap or crash, linear memory alone >=128 MiB, warm median regression >20%, or compressed module+glue >10 MB. Report medians, p95, min/max, n and raw samples. Stop an arm on crash or after 60 s per request; keep failures. No production deploy, replacement, source rebuild, model calls or auto-adoption. Do not tune compiler builds after seeing results. Historical P-05 remains unchanged.

Limitations: different compiler implementations and bundled TypeScript lib versions; old size-optimised custom build vs new published speed build; different host filesystem bridges; sequential/shared-machine timing; caller-stack Node rather than package worker API. This tests a candidate integration, not isolated algorithm speed. No native comparator means no new X6 WASM/native ratio. No real Cloudflare enforcement or isolate heap measurement. Below 128 MiB linear memory does not prove hosted fit. No hypothesis that native headline percentages transfer to WASM.
