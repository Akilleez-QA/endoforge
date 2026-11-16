### Added
- `tools/browser` renders HTML to PNG inside a process workcell with the digest-pinned Kitesurf engine
  (`kitesurf-core` at `4a29038`), admitted through `toolingWasmModules`; thread cells, fetch and network are refused.
- `make browser-setup` downloads and verifies the pinned release tarball, and `make browser-test` skips, never
  passes, without a verified artifact.
