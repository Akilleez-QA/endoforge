# Browser engine pin

This directory pins the WebAssembly build of `kitesurf-core` (Kitesurf by Cloudflare, Apache-2.0, commit
[`4a29038`](https://github.com/cloudflare/kitesurf/tree/4a29038)) that the workcell browser
([design](https://github.com/Akilleez-QA/endoforge/pull/152)) loads. It holds no code beyond the pin yet.

[pin.mjs](pin.mjs) exports:

- `KITESURF_ARTIFACT`: the file name and SHA-256 of the release tarball. The tarball is the source of truth: the wasm
  is not byte-reproducible, so a rebuild of the same commit gets a different digest.
- `KITESURF_CORE`: the SHA-256 of `kitesurf_core_bg.wasm` inside that tarball, with `maximumPages` 4096 (256 MiB). One
  800 by 1200 render used 15.1 MiB of linear memory.
- `WORKCELL`: a 256 MiB WebAssembly ceiling and `toolingWasmModules` with `KITESURF_CORE`.

The engine is built with exception handling and SIMD, which the workcell guard refuses. `toolingWasmModules` admits
this one digest through a separate path ([workcells](../../docs/architecture/workcells.md#the-wasm-guard)); candidate
kernels are unaffected.
