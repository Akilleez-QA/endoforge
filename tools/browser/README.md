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

`make browser-test` runs [test/render.test.mjs](test/render.test.mjs). Without a verified artifact the tests that need
the engine report skipped, never passed.
