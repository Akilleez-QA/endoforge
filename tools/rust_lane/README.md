# Rust lane

This lane builds one reference kernel from Rust into a WebAssembly component that satisfies the
[kernel contract](../kernel/README.md), reproducibly: the same inputs give the same bytes, and the build record names
every input that could change them. Rust is the refinement route for kernels that earn it, with stronger static checks
and near-native speed, at the cost of a toolchain that cannot live inside an isolate. This is the first slice: a local
build recipe for one task, not a build service.

## What it builds

The P-06 pressure converter. The event is four little-endian i32 values: value, from-unit, to-unit and basis; an empty
event may instead read those 16 bytes from exactly one borrowed buffer. Prior state is ignored. The output state is
one little-endian i32 and there are no effects. Malformed events, buffer read errors and invalid codes return P-06's
reserved `INT32_MIN` sentinel. Buffer snapshots are host-owned and never dropped by Rust. A handwritten `reduce`
adapter avoids a wit-bindgen code-generation error with borrowed lists; it uses guest-memory pointers, never host
pointers.

## How the build works

The build key covers the source, the Cargo manifest and lock, the WIT, the target, the flags, the complete compiler
version, the compiler, Cargo and `wasm-tools` binary hashes, and the recipe. Every build runs in a fresh directory with
a clean environment, offline and locked, with one Cargo job and CPU, one build-dependency codegen unit, 4 GiB
address-space and 120 CPU-second per-process limits, and a 180-second process-group timeout. The result is packaged
with `wasm-tools` 1.262.0 and admitted only through the kernel contract's exact interface validator. The record binds
the component identity and says `qualification: required`; no earlier qualification carries over.

## Use it

Pinned tools: Rust 1.98.1 (48a229cea) with the `wasm32-unknown-unknown` target, `wasm-tools` 1.262.0, and for the
tests jco 1.16.1 and AssemblyScript 0.28.9.

```sh
export RUSTC=$(rustup which rustc) CARGO=$(rustup which cargo)   # real executables, not shims
export WASM_TOOLS=$PWD/.tools/bin/wasm-tools                      # from make tools
export CARGO_HOME=/path/to/writable/cache
cargo fetch --locked --manifest-path tools/rust_lane/Cargo.toml   # the only step that uses the network
python3 -B -m tools.rust_lane.build NEW_DIRECTORY
make rust-lane-test                                               # also needs JCO and ASC set
```

## Example

```console
$ python3 -B -m tools.rust_lane.build /tmp/rust-lane-out
{"artifact":{"component_sha256":"f7dc69ec3614186776ed45ab5d672eff88e4809ff6d53a483c345618f5899930","contract_version":"1.0.0","id":"c12be20c…","validation":"static-interface-only","validator":"wasm-tools/1.262.0","version":1,"wit_sha256":"4768b0a5910d7adedd071b26d2eb46e1e849ea5e7988015a80e29ec91c57613e","world":"endoforge:kernel/kernel@1.0.0"},"build_key":"7187434f09f1d198c2838fa1cb5770e12bf610629a03d90daeb3e0017b86b455",...,"lane":"rust-native","qualification":"required"}
$ ls /tmp/rust-lane-out
build.json  kernel  kernel.core.wasm  kernel.wasm  rust_lane  target
```

(Trimmed: the full record also lists every input hash and the full toolchain version.) The build took about 21
seconds; a second build in another directory gave the same component SHA-256. The WIT hash is the one the kernel
contract pins.

## Limits

- One reference task, no governed build service, no generalized admission.
- It is not Wasmtime evidence: the tests run the component in Node through jco's Component Model polyfill. Loading
  the built component in [tools/kernel](../kernel/README.md)'s Wasmtime `Workcell` fails with `table count too high
  at 2`, because that host allows one table.
- The lane is not part of `make test`, so CI does not run it.

## Tests

`make rust-lane-test` builds twice in independent directories and compares every output byte and record, rejects a
changed artifact and toolchain, and runs P-06's hash-pinned evaluator functions through the component reducer: all
67,108,864 bounded inputs, the frozen BigInt oracle sample, invalid codes, and the existing seeded rounding fault. The
probe sources it reads are in `experiments/P-06-bounded-equivalence/`.

Engineering record: component C-26, requirement REQ-RUST-001.
