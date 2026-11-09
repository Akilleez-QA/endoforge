# Independent gate runner

`gate.mjs` checks an AssemblyScript kernel against a contract and tests that were frozen before the code existed.

## Usage

```
node tools/gate/gate.mjs freeze <dir>
node tools/gate/gate.mjs run <dir>
```

- `freeze` needs `CONTRACT.md` and `tests.json` in `<dir>` and refuses if `kernel.ts` already exists. It writes `frozen.sha256` with both hashes.
- `run` writes `result.json` and prints the gate summary. It exits 0 only when every gate passes (`promotable: true`):
  - `G1_frozen`: the contract and tests still match `frozen.sha256`.
  - `G2_compiles`: `kernel.ts` compiles with `asc --runtime stub -O3 --noAssert` to `kernel.wasm` with no imports.
  - `G3_exports`: every `fn` named in `tests.json` is exported.
  - `G4_tests`: each test's `expect` (number with optional `tol`, boolean, string) or `expectError` holds.
  - `G5_deterministic`: a second run gives the same outputs.
  - `G6_bounded`: no call takes over 2000 ms.
  - `G7_glue`: `glue.json` matches [glue.schema.json](glue.schema.json), its `id` is the folder name, and it describes exactly the module's exports, arities, result codes and traps.

With no arguments it prints `usage: gate.mjs freeze|run <dir>` and exits 2. `freeze` on a synthetic directory with a one-line `CONTRACT.md` and `[]` in `tests.json` succeeded. `run` was not exercised, since no AssemblyScript compiler was installed.

## Environment

- `ENDOFORGE_ASC`: path to the `asc` compiler. Default: `node_modules/.bin/asc` at the repository root.

The atomizer locates this tool through `toolchain.gate` in [policy.json](../atomizer/policy.json). No `make` target runs `gate.mjs` directly.
