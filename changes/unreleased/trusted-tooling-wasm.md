### Security
- Admit digest-pinned tool modules that use exception handling or SIMD through a separate
  `toolingWasmModules` path with a pinned memory maximum; candidate kernels and every
  unpinned module still take the unchanged WebAssembly guard.
