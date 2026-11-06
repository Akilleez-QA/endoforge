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

## Resident component host

Install `requirements.txt` into a virtual environment and select that interpreter
with `make kernel-test PYTHON=/path/to/venv/bin/python`. It is not part of `make test`, so it adds no prerequisite there; missing dependencies fail these checks.

`Workcell(component_bytes, (state_schema, event_schema, effect_schema))` validates
the kernel contract and compiles once. Call `run(state_bytes, event_bytes, inputs)`
with immutable byte snapshots. Each attempt instantiates into a fresh store,
checks `describe`, invokes `reduce`, performs canonical post-return cleanup,
and destroys the store on success or failure. Results include state/effect data,
artifact identity, cache identity, host timings, fuel use and buffer-read bytes.
Effects grant no authority and are never dispatched by this host.

The cache holds one component for this engine's lifetime, keyed by the kernel
artifact identity and pinned runtime/compiler configuration. Attempts serialize;
compiler parallelism is disabled. Guest limits: 16 MiB memory, 1 MiB total input,
64 snapshots, 1 MiB cumulative reads and at most 10 million fuel units.

`reference.wat` is a hand-written conformance control, not a generation route.
Its byte reducer adds state, event and the first buffer byte modulo 256; a
mutable call counter deliberately detects accidental instance reuse. Tests build
components in temporary directories without changing existing fixtures.

The tests run 1,000 attempts with one actual compilation and distinct closed
stores. Performance is not claimed.
This embedding is for local conformance controls until the remaining slices
provide OS sandboxing, cgroup ownership and helper containment, an external
watchdog, compile-process limits, integrated cheap gates and calibration. Full effect-payload validation and ledger admission also remain open.

## Declared buffer imports and per-call broker

`Workcell(..., declared_imports=("endoforge:kernel/buffers@1.0.0",))` binds
the candidate declaration to the fixed v1 WIT import list. This is also the
default declaration. Missing or additional entries fail admission before
compilation; the binary still undergoes exact interface validation. Declaring
an extra capability cannot grant it. No WIT or artifact identity changes.

`run(..., authorize=checker, max_host_calls=4096)` creates a fresh broker for
each attempt. The trusted host checker receives `(buffer_index, operation)`
on every size/read, before retrieving snapshot bytes; it must return exactly
`True`. Revocation or a checker exception aborts with `BrokerDenied`, even
after a successful read of that same buffer. The checker must consult current
authority and return promptly; the default `None` treats the explicit immutable
inputs as attempt-scoped grants.

The host-call limit is an integer from 1 to 4096. Size calls, zero-length reads
and typed read errors consume it; the next call traps before authority lookup
or data access. Canonical resource drops only release handles and confer no
capability, so they are outside this service-call count. Fuel still bounds guest
instructions. The existing cumulative byte budget remains in force.

Successful results include a `broker` report with host-call/byte counters,
the declared limit and denial records. Fatal broker denials carry the same
report on `BrokerDenied.report`; the host retains it after store destruction.
At most 64 denial records are retained, with the last slot tracking the newest
denial, plus an exact total count. Records contain operation, buffer index and
reason, never source bytes or authority-service exception text.

Declarations are tested at admission and the broker through real guest calls. Effects remain return data. There is no durable record of denials yet.
