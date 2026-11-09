# Rust lane

This lane builds any Rust kernel crate that satisfies the [kernel contract](../kernel/README.md) into a WebAssembly
component, reproducibly, and admits it only when the kernel host runs it through its frozen task: the same inputs give
the same bytes, and the build record names every input that could change them. Rust is the refinement route for
kernels that earn it, with stronger static checks and near-native speed, at the cost of a toolchain that cannot live
inside an isolate. It is a local build and admission recipe, not a governed build service.

## Admission

`python3 -B -m tools.rust_lane.admit CRATE TASK DESTINATION --journal JOURNAL` (`admit()` in `admit.py`):

1. The crate is checked before any build: a `Cargo.toml` with a named package and a `cdylib`, a `Cargo.lock`,
   `src/lib.rs`, regular files only under `src/` (at most 4 MiB), no build script or workspace, and dependencies only
   from crates.io as `Cargo.lock` pins them. The crate references the WIT as `../kernel/kernel.wit`, which the build
   directory provides. The core module name follows the `[lib]` name or the package name.
2. The build below runs and the component passes the exact interface validator.
3. The kernel host checks it: `tools.kernel.conformance` runs every case of the frozen task (schemas, effect
   declaration, cases with expected state and effects) in the Wasmtime `Workcell`, in a separate process using
   `.tools/venv` when present. Effects are validated against the task's declaration.
4. Passing writes `admission.json` (task and task SHA-256, build key, artifact, effect declaration SHA-256, cases,
   `qualification: required`). A build failure or any failed, denied, trapped or refused case raises
   `AdmissionRejected` and appends an `admission` entry to the hash-chained denial journal, after the host's own
   `broker` and `effect` entries for that component.

Two tasks are frozen in `tasks/`, each with its own crate:

| Task | Crate | State, event, effects |
|---|---|---|
| `tasks/p06-pressure.json` | this directory | P-06 conversion below; no effects permitted |
| `tasks/tally.json` | `kernels/tally/` | u64 total; a batch of 1–16 u32 amounts inline or from one buffer; a `notify/threshold` JSON effect when the total first reaches 1000, an `audit/malformed` 4-byte effect for a malformed batch |

## The P-06 kernel

The P-06 pressure converter. The event is four little-endian i32 values: value, from-unit, to-unit and basis; an empty
event may instead read those 16 bytes from exactly one borrowed buffer. Prior state is ignored. The output state is
one little-endian i32 and there are no effects. Malformed events, buffer read errors and invalid codes return P-06's
reserved `INT32_MIN` sentinel. The host owns the buffer snapshots; Rust releases each borrowed handle before `reduce`
returns, as the Component Model requires. A handwritten `reduce`
adapter avoids a wit-bindgen code-generation error with borrowed lists; it uses guest-memory pointers, never host
pointers.

## How the build works

The build key covers the source, the Cargo manifest and lock, the WIT, the target, the flags, the complete compiler
version, the compiler, Cargo and `wasm-tools` binary hashes, and the recipe. Every build runs in a fresh directory with
a clean environment. Crates come from the Cargo cache; only if some are missing does the build download them, limited
to the versions and checksums `Cargo.lock` pins. The compile itself is offline and locked, with one Cargo job and CPU, one build-dependency codegen unit, 4 GiB
address-space and 120 CPU-second per-process limits, and a 180-second process-group timeout. The result is packaged
with `wasm-tools` 1.262.0 and admitted only through the kernel contract's exact interface validator. The record binds
the component identity and says `qualification: required`; no earlier qualification carries over.

## Use it

Pinned tools: Rust 1.98.1 (48a229cea) with the `wasm32-unknown-unknown` target, `wasm-tools` 1.262.0, and for the
tests jco 1.16.1 and AssemblyScript 0.28.9.

```sh
make tools                                                        # pinned wasm-tools in .tools/
python3 -B -m tools.rust_lane.build NEW_DIRECTORY [--crate CRATE]
python3 -B -m tools.rust_lane.admit tools/rust_lane/kernels/tally tools/rust_lane/tasks/tally.json NEW_DIRECTORY --journal JOURNAL
make rust-lane-test
```

The tests take `jco` and `asc` from `JCO` and `ASC`, then `tools/rust_lane/node_modules`, then `PATH`, and otherwise
run `npm ci` without install scripts from this lane's lockfile; `make rust-lane-test` runs that install first
(`make rust-lane-setup`). The lane locks AssemblyScript 0.28.9, the version P-06
froze, separately from the newer compiler in `tools/asc`.

The build asks rustup for the real binaries of the pinned toolchain, uses `.tools/bin/wasm-tools` when present, and
caches crates in `~/.cargo`. Set `RUSTC`, `CARGO`, `WASM_TOOLS` or `CARGO_HOME` to override any of these; `RUSTC` and
`CARGO` must name real executables, not rustup shims.

## Example

```console
$ python3 -B -m tools.rust_lane.build /tmp/rust-lane-out
{"artifact":{"component_sha256":"<sha256>","contract_version":"1.0.0","id":"<sha256>","validation":"static-interface-only","validator":"wasm-tools/1.262.0","version":1,"wit_sha256":"4768b0a5910d7adedd071b26d2eb46e1e849ea5e7988015a80e29ec91c57613e","world":"endoforge:kernel/kernel@1.0.0"},"build_key":"<sha256>",...,"lane":"rust-native","qualification":"required"}
$ ls /tmp/rust-lane-out
build.json  kernel  kernel.core.wasm  kernel.wasm  rust_lane  target
```

(Trimmed: the full record also lists every input hash and the full toolchain version.) The build took about 21
seconds; a second build in another directory gave the same component SHA-256. The WIT hash is the one the kernel
contract pins.

## Limits

- No governed build service. Admission evidence is the frozen task's cases, not a campaign qualification.
- The P-06 bounded equivalence runs in Node through jco's Component Model polyfill. In Wasmtime, components are
  checked on their frozen task cases through the [tools/kernel](../kernel/README.md) `Workcell`.
- The lane is not part of `make test`. CI runs it in its own job, `rust-lane`, which installs Rust 1.98.1 with the
  `wasm32-unknown-unknown` target, runs `make tools`, then `make rust-lane-test` (REQ-REPO-007). It ran and passed on
  GitHub in PR #139 (run 42600069278, job `rust-lane`, 15 tests OK at `def5f24`).

## Tests

`make rust-lane-test` builds twice in independent directories and compares every output byte and record, rejects a
changed artifact and toolchain, and runs P-06's hash-pinned evaluator functions through the component reducer: all
67,108,864 bounded inputs, the frozen BigInt oracle sample, invalid codes, and the existing seeded rounding fault. It
also runs the component in the Wasmtime `Workcell`, with the event inline, read from a buffer, and malformed; that
step uses `.tools/venv` when present. The probe sources it reads are in `experiments/P-06-bounded-equivalence/`.
Admission tests check crate shapes refused before building, admit both frozen tasks with distinct components and
effect declarations, reject a tally crate that emits an undeclared effect (with `effect` then `admission` journal
entries), refuse a component run against another task's schemas, and journal a build failure.

Engineering record: component C-26, requirement REQ-RUST-001; the kernel host's conformance check it calls is
REQ-KERNEL-005 (component C-17).
