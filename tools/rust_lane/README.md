# Reproducible Rust component

This first slice compiles the P-06 pressure converter with native Rust 1.98.1
(48a229cea), targeting wasm32-unknown-unknown. It packages the result with
wasm-tools 1.262.0 and admits output only through the [kernel contract](../kernel/README.md)'s exact
interface validator. It implements reduce and describe, including borrowed-buffer reads.
It is a local build recipe for this reference task, not a production service.

The event is four little-endian i32 values: value, from-unit, to-unit, basis.
An empty event may instead read those 16 bytes from exactly one borrowed buffer.
Prior state is ignored. Output state is one little-endian i32; effects are empty.
Malformed events, buffer read errors and invalid codes return P-06's reserved
INT32_MIN sentinel. Buffer snapshots are host-owned and never dropped by Rust.
The handwritten canonical reduce adapter avoids wit-bindgen's borrowed-list
code-generation error. It uses guest-memory ABI pointers, never host pointers.

The build key covers source, Cargo manifest and dependency lock, WIT, target,
flags, complete compiler version, compiler/Cargo/wasm-tools binary hashes and
recipe. Every invocation builds in a fresh directory with a clean environment,
one Cargo job and CPU, one build-dependency codegen unit, 4 GiB address-space
and 120 CPU-second per-process limits, and a
180-second process-group timeout. Builds are offline and locked. Output records
bind component identity and say qualification is required; no previous
qualification is inherited.

Set RUSTC and CARGO to the installed toolchain's real executables, WASM_TOOLS to
wasm-tools 1.262.0, and CARGO_HOME to a writable dependency cache. Prepare with
`cargo fetch --locked --manifest-path tools/rust_lane/Cargo.toml` using that
compiler and cache. Set JCO to jco 1.16.1 and ASC to AssemblyScript 0.28.9.
Network preparation is separate; tests never download dependencies.

From the repository root run `python3 -B -m tools.rust_lane.build NEW_DIRECTORY`
or `make rust-lane-test`. The lane is not part of `make test`, so CI does not run it. Tests build twice in independent directories,
compare all output bytes and records, reject a changed artifact and toolchain,
and run P-06's hash-pinned evaluator functions through the component reducer
using jco's Component Model polyfill. This includes all 67,108,864 bounded inputs,
the frozen BigInt oracle sample, invalid codes, and the existing seeded rounding
fault. The probe sources it reads are in `experiments/P-06-bounded-equivalence/`.

This is a local build recipe for one reference task. It has no governed build service or generalized admission, and it is not Wasmtime evidence: the tests run the component through jco in Node.

## Relation to the V8 workcell

The equivalence test runs this component in V8 through jco's Component Model polyfill, without Wasmtime. The lane isn't part of the candidate loop in [core/runtime](../../core/runtime/README.md).
