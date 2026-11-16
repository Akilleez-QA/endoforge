# Workcell browser

This directory renders HTML to PNG inside a process workcell with the WebAssembly build of `kitesurf-core` (Kitesurf by
Cloudflare, Apache-2.0, commit [`4a29038`](https://github.com/cloudflare/kitesurf/tree/4a29038)). It is the first spike
of the [workcell browser design](../../docs/architecture/workcell-browser.md).

[pin.mjs](pin.mjs) exports:

- `KITESURF_ARTIFACT`: the file name and SHA-256 of the release tarball. The tarball is the source of truth: the wasm
  is not byte-reproducible, so a rebuild of the same commit gets a different digest.
- `KITESURF_CORE`: the SHA-256 of `kitesurf_core_bg.wasm` inside that tarball, with `maximumPages` 4096 (256 MiB).
- `WORKCELL`: a 256 MiB WebAssembly ceiling and `toolingWasmModules` with `KITESURF_CORE`.

The engine is built with exception handling and SIMD, which the workcell guard refuses. `toolingWasmModules` admits
this one digest through a separate path ([workcells](../../docs/architecture/workcells.md#the-wasm-guard)); candidate
kernels are unaffected.

## Setup

`make browser-setup` runs [setup.mjs](setup.mjs). It downloads
`https://github.com/Akilleez-QA/endoforge/releases/download/kitesurf-core-4a29038/endoforge-kitesurf-core-4a29038.tar.gz`,
checks the tarball digest, extracts it into `tools/browser/.artifact/` (ignored by git) and checks the wasm, the
JavaScript glue and the four Noto fonts against the digests in [artifact.mjs](artifact.mjs). A present, matching
artifact is not downloaded again. When the download fails or a digest differs, it removes what it wrote, prints why and
exits 0, so the tests skip.

## The port

[port.mjs](port.mjs) is a workcell host port:

- `warm()` verifies the artifact, compiles the wasm once through the workcell `WebAssembly` hook (so the tooling path
  admits its digest), sets a fetch bridge that refuses every request, and registers the UA fonts. A missing or
  mismatched artifact throws.
- `createPort({ html, width, height })` returns `evaluate`, which renders on a fresh engine instance from the same
  compiled module with a fixed `Date.now` and seeded `crypto.getRandomValues`, and `evidence()`, which returns the PNG
  digest, byte size, dimensions read from the PNG header, timings, RSS and the pin.
- Process cells only. `createPort` and `warm` refuse a thread cell, and `createBrowserPool` refuses any isolation but
  `process`. Cells get the permission model with read access to the repository and no network grant; the global
  `fetch` and the engine's fetch bridge both refuse.

## The engine Worker

This is the canonical way to run the engine in the repair loop (slice 2 of the render-gates design). The port above
and `createBrowserPool` stay as the PNG spike and its pinned-digest evidence; they are not wired into the loop.

`createLoopPool({ render: true })` adds `KITESURF_CORE` to the pool's `toolingWasmModules`, and the loop cell's warm
step ([loop-port.mjs](../../core/runtime/x1/loop-port.mjs)) starts one engine Worker through
[engine-host.mjs](engine-host.mjs). The Worker ([engine.mjs](engine.mjs)) inherits the cell's permission flags, because
it is created without `execArgv`. It installs the workcell wasm guard with the Kitesurf tooling entry, verifies the
artifact, compiles the wasm once, loads the glue, registers the four fonts and primes once. Off by default; refused in
thread cells and in any thread that is not a process's main thread.

`inspect({ html, viewport: [w, h], expect, png })` checks the request, then the Worker parses the document, sets the
viewport, runs each assertion, frees the `DomHandle`, waits one macrotask turn so queued engine work finishes, and
replies. Every engine call runs with `new Date()` and `Date.now()` fixed at 2026-01-01 and a seeded
`crypto.getRandomValues`, restored afterwards. The fetch bridge refuses every request and counts it; a document that
fetches fails the check. `png: true` also returns the PNG of the same document.

| Assertion | Passes when | Failure says, for example |
|---|---|---|
| `{ select, count }` | the selector matches that many nodes | `li count 2, needs 1` |
| `{ select, text }` | the first match's rendered text, whitespace collapsed, equals it | `li text "Milk", needs "Bread"` |
| `{ select, attr: { name: value } }` | the first match also matches `:is(select)[name="value"]` | `#add role absent, needs "button"` |
| `{ select, style: { property: value } }` | each computed value equals its value | `#add display block, needs inline` |
| `{ select, box }` | the first match's rectangle meets `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `inViewport` | `#add box 30x20 at 8,48, needs minWidth 44, minHeight 44` |
| `{ select, apart }` | the first matches of the two selectors do not overlap | `#add and #overlap overlap by 10x10, needs apart` |
| `{ page: 'noHorizontalOverflow' }` | no element passes the viewport's right edge | `page overflows horizontally: div right edge 500 passes the viewport width 390, needs noHorizontalOverflow` |

`pixel` is not built yet. The Worker is reused as it is, never restored from a memory image. The host replaces it
after a fault (the Worker replies `outcome_unknown` and exits), an error or exit before the reply, a check over
`timeoutMs` (10 s), 1,000 checks, or 16 MiB of wasm memory growth since warm. A check the Worker did not answer is
`outcome_unknown`, never a pass. Results carry `engine: { generation, checks }`, and `stats()` counts starts,
replacements, checks and faults.

`make browser-test` runs [test/render.test.mjs](test/render.test.mjs) and [test/engine.test.mjs](test/engine.test.mjs). Without a verified artifact the tests that need
the engine report skipped, never passed.
