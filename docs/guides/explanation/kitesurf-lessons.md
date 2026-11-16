# What Kitesurf's design suggests for EndoForge

Date: 2026-11-16. Status: research note; no code change and no default change.

[Kitesurf](https://github.com/cloudflare/kitesurf) was built for Cloudflare Workers: no ambient network or file
system, short-lived isolates, and tight limits on script size and startup time. EndoForge's workcells live under
similar rules. This note reads Kitesurf for the choices those rules forced and asks which of them carry over to
EndoForge, beyond running its engine (the [workcell browser](../../architecture/workcell-browser.md) design and the
[measurement note](kitesurf-fit.md)). References are to Kitesurf commit
[`4a29038`](https://github.com/cloudflare/kitesurf/tree/4a29038) as `KS:path:line`, and to EndoForge `main` at
`f834d21`. Each item says what Kitesurf does, what EndoForge does today, and what would change. Nothing here was run
against a model, and the ideas in it are unmeasured.

## Capabilities are handed in, not ambient

Kitesurf gives every loaded worker its network as an explicit object. The page runtime gets a sandboxed outbound
(KS:packages/engine/src/eval/page-script.ts:392), dedicated workers get the same
(KS:packages/engine/src/eval/dedicated-worker.ts:153), and the renderer gets one that refuses everything, because
resources reach it through engine callbacks (KS:packages/engine/src/eval/page-renderer.ts:112-113). Its contributor
guide adds a rule it marks as never to undo: "Every outbound request needs a deadline, and an ignored response body
must be cancelled" (KS:AGENTS.md:90). `withDeadline` errors the stream and cancels its source on expiry
(KS:packages/engine/src/read-capped.ts:231-244).

EndoForge today: process cells under the loop's flags have no network at all, and the workcell browser design makes
network a host effect answered through `hostCall`, with an allowlist "designed after the first slice"
([workcell browser](../../architecture/workcell-browser.md#risks-and-open-questions)).

Suggestion: shape that allowlist like `globalOutbound`. The supervisor passes each browser job one outbound function,
refusing by default, and every request it admits carries a deadline and a byte cap, with an unread body cancelled.

## One isolate per unit of work, then thrown away

Each `Page.navigate` loads a fresh anonymous page worker and kills the previous one: "Use `load()`, never a named
`LOADER.get`" (KS:AGENTS.md:65-66). Per-connection state lives in a closure, and nothing persists across connections
(KS:AGENTS.md:63-64).

EndoForge today: cells are kept warm and replaced after `retireAfterJobs` jobs, 256 by default
([workcells](../../architecture/workcells.md)); each job gets fresh mutable state while the machinery is reused. The
browser design gives each render a fresh engine instance from a reused compiled module.

Suggestion: keep the warm cells, which is where EndoForge's speed comes from, and add a test that a second render in
the same cell cannot observe anything the first left at module scope: globals, registered fonts beyond the pinned
set, or the fetch bridge's state.

## Untrusted JavaScript runs in an interpreter compiled to WebAssembly

Kitesurf never runs runtime code generation (`eval`, `new Function`, `Runtime.evaluate`, computed `import()`) in the
parent Worker. It runs on Boa, a JavaScript interpreter compiled into the WebAssembly, inside the per-page isolate,
and the loaded worker never gets a native-eval flag (KS:AGENTS.md:60-62).

EndoForge today: tooling modules admitted through `toolingWasmModules` are not rewritten, so they carry no fuel meter
(`core/runtime/isolate-wasm-tooling.mjs:72` returns `flag: null`); only the job deadline bounds their CPU. That is
enough for static renders. Once page JavaScript runs through Boa inside `kitesurf-core`, a page loop runs until the
job deadline.

Suggestions:

- Before the page-script port, give browser jobs a short `jobTimeoutMs` and record it with the evidence.
- An idea, unmeasured: an interpreter in WebAssembly can sit behind the same guard and fuel meter as a kernel. A
  pinned JavaScript interpreter built for the guard could run JavaScript candidates under G5 and G6, where today the
  TypeScript compatibility path runs emitted JavaScript in a contained V8 process. It would be slower than V8; whether
  the trade is worth it is an experiment, not a default.

## How a trap is read depends on the panic strategy

Kitesurf builds its wasm with `panic=unwind`, rebuilding the standard library for it, so a panic does not lock the
live DOM (KS:AGENTS.md:67-68; KS:packages/core/.cargo/config.toml:33 and :55). In that build a Rust panic should
surface as a WebAssembly exception, and an `unreachable` trap should come mostly from an abort, such as the standard
library's default response to an allocation failure.

EndoForge today: the open [#155](https://github.com/Akilleez-QA/endoforge/pull/155) reports any `unreachable` trap
from a tooling export as `ERR_WORKCELL_WASM_MEMORY_LIMIT`, and its caveat notes that an abort-mode panic traps the
same way.

Suggestion: for this pinned build the mapping may be closer to right than the caveat suggests, but that is a reading
of the build settings, not a measurement. A test that makes the pinned module panic, and checks that the result is a
`WebAssembly.Exception` and not a memory breach, would settle it for this pin and catch a future build that changes
strategy.

## Size and startup were designed for

Workers' limits pushed Kitesurf to compressed WebAssembly, a `wasm-opt` pass (KS:scripts/wasm-opt.mjs) and a smaller
module for the renderer isolate: `renderer-core`, the `SceneRasterizer` slice of core, at 5.0 MiB against 25.9 MiB for
the whole core ([workcell browser](../../architecture/workcell-browser.md#measured-in-a-check-run-main-rig-2026-11-14-853-859-pm-et)).

EndoForge today: the browser design estimates about 190 MiB resident per browser process cell and about 1.5 GiB for
eight, both unmeasured in a cell. Process cells compile their own copy of the module, so the shared-module saving
does not apply.

Suggestion: measure resident memory per browser cell in the spike before choosing a pool size, and record it next to
`render.json` `seconds`.

## Checks that hold an agent-written code base steady

Kitesurf is written with coding agents in the loop (its guide addresses "contributors and coding agents",
KS:AGENTS.md:3), and many of its rules are checks rather than prose:

- **Expectations pinned in both directions.** The web-platform-tests run fails on any deviation from
  `tests/wpt-expectations.json`, unexpected passes included; rebaselining is a separate commit, and the test corpus
  revision is pinned (KS:AGENTS.md:53-54 and :151-153; KS:scripts/wpt-batched.mjs:1076-1080). The expectations file
  had 9,696 entries at this commit.
- **Ratchets instead of bans.** `KS:scripts/ts-strict-ratchet.mjs` holds strictness at a baseline, a complexity
  lint lives in `KS:scripts/lint/complexity.mjs`, and comments are allowed but capped at four lines of 100 columns by
  `KS:scripts/lint/comment-policy.mjs` (KS:AGENTS.md:180-181).
- **Narrow lint rules with their own tests.** `KS:scripts/lint/rules/` holds six custom rules, among them
  `no-chained-type-assertions` and `no-widen-then-assert`, adapted from an "anti-slop" rule set
  (KS:scripts/lint/ANTI_SLOP_LICENSE.txt), with `rules.test.ts` beside them.
- **Coverage of the checks themselves.** Every TypeScript file must be under a type-checked `tsconfig`
  (KS:AGENTS.md:185-186), and a declaration-twin guard fails the build if a type declaration for a runtime-supplied
  module gets bundled (KS:AGENTS.md:182-184).
- **One entry point for checks.** "Add a build step or check as a Bazel target, not as a pnpm script or a script
  that CI calls directly" (KS:AGENTS.md:110-111).
- **Hermetic tests with their own markup.** End-to-end tests boot the engine in-process and give each test its own
  page through `setContent` (KS:AGENTS.md:197-200).

EndoForge already enforces several of the same ideas: `make lint` fails on a code comment, `make check` fails on
untraced requirements, dead links and privacy leaks, and `tests/test_reachability.py` fails when `make test` does not
reach a test file.

Suggestions for the browser work:

- Replace the single blue-box fixture in the spike with a small pinned corpus of pages and an expectations file of
  PNG digests, failing on any change in either direction and rebaselined only in a separate commit. The digests stay
  valid only within one pin, as the [workcell browser](../../architecture/workcell-browser.md#pinning-and-determinism)
  design already says.
- Record each render's pin, page digest and PNG digest with the evidence, so a reviewer can look at the image the gate
  saw rather than at the code.

## What not to copy

- The build: a pinned nightly Rust toolchain with `-Zbuild-std`, and Bazel. The first build took 665 s for #151.
  Pinning the release tarball instead of rebuilding, as `tools/browser/pin.mjs` does, keeps that out of EndoForge's CI.
- The Workers surfaces: `env.LOADER`, `WorkerEntrypoint`, Dynamic Workers and anything on a paid plan.
- The CDP server. EndoForge has no CDP surface, and the workcell design drops it.
- Byte-unstable builds. A rebuild of `4a29038` gives a different wasm digest
  ([tools/browser](../../../tools/browser/README.md)); a reproducible build would let the pin name a source commit
  instead of a tarball. That is a question for upstream, not an EndoForge change.

## Next step

Fold the items that fit into the workcell browser design's open questions when the page-script port is planned, and
treat the interpreter idea as a candidate experiment with a written plan before it runs.
