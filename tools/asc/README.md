# AssemblyScript pin

This directory pins the AssemblyScript compiler (`assemblyscript` 0.28.20) that EndoForge's workcells use to compile
a candidate's `kernel.ts` into WebAssembly. AssemblyScript is a TypeScript-like language that compiles straight to
WebAssembly, and its compiler is itself JavaScript plus WebAssembly, so it runs inside the same V8 isolate as the
agent loop: compiling a candidate costs no process spawn. It holds no code beyond the pin.

## What it pins

[pin.mjs](pin.mjs) exports:

- `ASC_VERSION`: `'0.28.20'`.
- `ASC_PATH`: `node_modules/assemblyscript/dist/asc.js` under this directory.
- `ASC_FILES`: the SHA-256 of `asc.js`, `assemblyscript.js`, `binaryen/index.js` and `long/index.js`. The loop port
  checks these before it loads the compiler; a mismatch stops the loop.
- `WORKCELL`: the pool limits for a compile cell: 4096 MiB WebAssembly memory, 1024 MiB old generation, 32 MiB young
  generation, and the `trustedWasmModules` list from
  [experiments/assemblyscript-toolchain.mjs](../../experiments/assemblyscript-toolchain.mjs).

The users are [core/runtime/x1/loop.mjs](../../core/runtime/x1/loop.mjs) and
[core/runtime/x1/loop-port.mjs](../../core/runtime/x1/loop-port.mjs): the `isolate` and `agent` paths warm this
compiler in each cell and compile every candidate with it. The [runtime README](../../core/runtime/README.md) explains
why the WebAssembly ceiling is 4 GiB. The `current` path uses an `asc` on the supervisor instead
(`ENDOFORGE_ASC_CMD`).

## Install

```console
$ make loop-setup
npm ci --ignore-scripts --no-audit --no-fund --prefix tools/asc

added 3 packages in 410ms
$ node -e "import('./tools/asc/pin.mjs').then(m => console.log(m.ASC_VERSION, m.ASC_PATH.endsWith('dist/asc.js')))"
0.28.20 true
```

`make loop-setup` needs the npm registry. `make loop-test` runs it, then the `core/runtime/test/loop*.test.mjs`
tests. [gate](../gate/README.md) loads this pinned compiler (`ASC_PATH`) in-process when
`ENDOFORGE_ASC` is unset.

## Changing the version

Update `package.json`, `package-lock.json`, `ASC_VERSION` and every digest in `ASC_FILES` together, then run
`make loop-test`.

Engineering record: part of component C-07 (the candidate loop).
