# Kernel contract v1

`kernel.wit` defines `endoforge:kernel/kernel@1.0.0`. The component imports only
the `buffers` interface and exports only the `reducer` interface. There is no
WASI, clock, randomness, filesystem, network, renderer, broker or ledger import.
Validation rejects added imports, exports, functions, types and changed types,
including within an otherwise correctly named interface. It reads the actual
component binary, not a candidate-supplied interface manifest.

`reduce(state, event, inputs)` returns a transition containing the next state
and ordered effects. State, event and effect payloads are byte sequences whose
encodings belong to the task's frozen schemas. The host supplies immutable
buffer snapshots in `inputs` for large values. Replaying the same state, event
and snapshots must produce the same transition. Guest heaps are disposable;
state needed by another call must be in the returned state.

A buffer is a host-owned WIT resource, borrowed only for the call. There is no
constructor, pointer, address, write operation or ownership transfer. `size`
returns its byte length. `read(offset, length)` returns a copy, or
`out-of-bounds` when the range exceeds that snapshot, or `limit-exceeded` when
the host's admission read budget would be exceeded. The host must bound reads,
check ranges without integer overflow and reject stale or foreign handles.
These are runtime obligations; this slice checks their interface only.

An effect has a capability name, operation name and byte payload. It requests
an action as data; it grants no authority and is never executed by the kernel.
The host must validate each effect against the frozen task effect schema and
permitted effects before any dispatch. `describe()` returns the exact contract
version and the state/event/effect schema identities. They must match the
admitted contract; this slice validates the function's type, not its result.

Every record produced by `validate_component(bytes)` contains the component
SHA-256, exact WIT SHA-256, contract version, world and validator version. The
record ID hashes that canonical envelope using the existing ledger encoder.
`validate_artifact(record, bytes)` revalidates and rejects missing, extra or
changed fields. These are standalone static artifact records, not a new
Ledger v0 record kind. Their `static-interface-only` result is not qualification.

A major contract change invalidates qualification and requires requalification
of every affected artifact. Any WIT byte change, including within a major
version, invalidates these static records; there is no automatic carry-forward
or implicit semver compatibility. Version and hash are both pinned.

Checks require the upstream `wasm-tools` 1.262.0 executable on PATH, or its path
in `WASM_TOOLS`. No download occurs in tests. The x86_64 Linux release archive
used here has SHA-256
`655b8df67d54c3ef9b52fc237c4e94bbfbb5f5f43825245cb0940a7002a9ed65`.
See the [upstream release](https://github.com/bytecodealliance/wasm-tools/releases/tag/v1.262.0)
and [WIT reference](https://component-model.bytecodealliance.org/design/wit.html).
`make test` runs `make kernel-test`, so it needs this executable too, and CI installs it from that archive.
From the repository root, run `make kernel-test` or
`python3 -B -m tools.kernel.contract component.wasm` for a JSON artifact record.
The validator accepts binary components up to 16 MiB, caps each tool call at
10 seconds and limits expanded interface complexity. The caller must still
govern process memory and concurrent validations.

Tests compile fresh dummy components from WIT as static positive/negative
controls. Their functions trap; they are not a working reference kernel.
This is a static slice. It doesn't run a reference kernel, check semantic conformance or admit artifacts into the ledger.

## Relation to the V8 workcell

The candidate loop in [core/runtime](../../core/runtime/README.md) runs in V8 isolates. This lane targets Wasmtime in Python and is separate from that loop: nothing in `core/` imports it, and neither Wasmtime nor a Python process is part of the loop. `kernel.wit` and its validator don't depend on Wasmtime. A Wasmtime host in this directory is a conformance host for kernels, not a loop component.
