# AssemblyScript pin

Pins the AssemblyScript compiler that the in-isolate loop uses to compile `kernel.ts`. It holds no code beyond the pin.

- `package.json` and `package-lock.json` name `assemblyscript` 0.28.20.
- [pin.mjs](pin.mjs) exports:
  - `ASC_VERSION`: `'0.28.20'`.
  - `ASC_PATH`: `node_modules/assemblyscript/dist/asc.js` under this directory.
  - `ASC_FILES`: the SHA-256 of `asc.js`, `assemblyscript.js`, `binaryen/index.js` and `long/index.js`. The loop port checks these before it loads the compiler.
  - `WORKCELL`: the pool limits for a compile cell: 4096 MiB WASM memory, 1024 MiB old generation, 32 MiB young generation, and the `trustedWasmModules` list from [experiments/assemblyscript-toolchain.mjs](../../experiments/assemblyscript-toolchain.mjs).

Users are [core/runtime/x1/loop.mjs](../../core/runtime/x1/loop.mjs) and [core/runtime/x1/loop-port.mjs](../../core/runtime/x1/loop-port.mjs). The [runtime README](../../core/runtime/README.md) explains why the WASM ceiling is 4 GiB.

## Install and test

```sh
make loop-setup
make loop-test
```

`make loop-setup` runs `npm ci --ignore-scripts --no-audit --no-fund --prefix tools/asc`, which needs the npm registry. `make loop-test` runs it first, then the `core/runtime/test/loop*.test.mjs` tests. Neither was run for this README; `node_modules` was not present in this worktree.

On a version bump, update `package.json`, the lock file, `ASC_VERSION` and every digest in `ASC_FILES` together. A digest mismatch stops the loop.
