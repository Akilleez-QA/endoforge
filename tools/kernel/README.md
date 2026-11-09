# Kernel contract

This directory defines the kernel contract as a WebAssembly component interface (WIT), validates components against
it byte for byte, and hosts them in Wasmtime with fuel, memory and call limits. A kernel is the application logic of a
candidate: a pure function from state and an event to the next state plus effects, where effects are requests
returned as data that the kernel can never carry out itself.

The candidate loop in [core/runtime](../../core/runtime/README.md) runs in V8 isolates and imports nothing from here;
this is where the portable, language-neutral form of the kernel contract is pinned and tested, with Wasmtime as the
reference host. [compatibility](../compatibility/README.md) binds the same contract to TypeScript.
[rust_lane](../rust_lane/README.md) builds Rust kernel crates against it and admits them only through this host:
its admission runs each component's frozen task cases through `tools.kernel.conformance`.

## The contract

`kernel.wit` defines `endoforge:kernel/kernel@1.0.0`:

```wit
interface reducer {
  use buffers.{buffer};
  record effect { capability: string, operation: string, payload: list<u8> }
  record transition { state: list<u8>, effects: list<effect> }
  record metadata { contract-version: string, state-schema: string, event-schema: string, effect-schema: string }
  reduce: func(state: list<u8>, event: list<u8>, inputs: list<borrow<buffer>>) -> transition;
  describe: func() -> metadata;
}
world kernel { import buffers; export reducer; }
```

- `reduce(state, event, inputs)` returns the next state and ordered effects. State, event and effect payloads are
  bytes whose encodings belong to the task's frozen schemas. Replaying the same state, event and snapshots must give
  the same transition. Guest heaps are disposable: anything needed by the next call must be in the returned state.
- A `buffer` is a host-owned resource borrowed only for the call: `size()` and `read(offset, length)`, which returns a
  copy, `out-of-bounds` or `limit-exceeded`. There is no constructor, pointer, write or ownership transfer.
- An effect names a capability, an operation and a byte payload. It grants no authority; the host must check it
  against the task's frozen effect schema and permitted effects before any dispatch.
- `describe()` returns the contract version and the three schema identities, which must match the admitted contract.

The component imports only `buffers` and exports only `reducer`: no WASI, clock, randomness, file system, network,
renderer, broker or ledger.

## How validation works

`validate_component(bytes)` reads the actual component binary (not a manifest the candidate supplies) with
`wasm-tools`, and rejects any added import, export, function or type, and any changed type, even inside a correctly
named interface. It accepts components up to 16 MiB, caps each tool call at 10 seconds and limits expanded interface
complexity.

Every record it produces carries the component SHA-256, the exact WIT SHA-256, the contract version, the world and the
validator version, and a record id that hashes that envelope with the ledger encoder. `validate_artifact(record,
bytes)` revalidates and rejects missing, extra or changed fields. The result is `static-interface-only`: it is not
qualification and not a ledger record. Any change to the WIT bytes, even within a major version, invalidates these
records; there is no carry-forward.

## Running a kernel

- `Workcell(component_bytes, (state_schema, event_schema, effect_schema))` validates the contract and compiles once.
  `run(state, event, inputs)` instantiates into a fresh store for every attempt, checks `describe`, calls `reduce`,
  cleans up and destroys the store, and returns state, effects, artifact and cache identity, timings, fuel used and
  bytes read. Guest limits: 16 MiB memory, two tables (a compiled language's function table beside the Component
  Model import shim's), 1 MiB total input, 64 snapshots, 1 MiB cumulative reads, at most 10 million fuel. Attempts
  serialize.
- `run(..., authorize=checker, max_host_calls=4096)` creates a fresh broker per attempt. The checker sees
  `(buffer_index, operation)` on every `size` and `read` before any bytes are fetched and must return exactly `True`;
  revocation or an exception aborts with `BrokerDenied`. The host-call limit (1 to 4096) counts size calls, zero-length
  reads and typed read errors. Results carry a `broker` report; at most 64 denial records are kept, never source bytes.
- `declared_imports` (default `("endoforge:kernel/buffers@1.0.0",)`) must match the fixed import list exactly;
  declaring an extra capability cannot grant it.
- `effects=declaration` checks every returned effect before the transition is released. A declaration is
  `{"id", "max_effects", "effects": [{"capability", "operation", "payload": {"encoding", "min_bytes", "max_bytes",
  "schema"}}]}`; its `id` must equal the frozen effect-schema identity the kernel's `describe` returns. Encodings are
  `bytes`, `utf8` and `json`; a `json` payload may carry a schema (the ledger's schema subset, no `$ref`) and rejects
  non-finite constants. Without a declaration no effect is permitted. Any undeclared effect, out-of-bounds payload,
  bad encoding, schema mismatch or excess count rejects the whole transition with `EffectDenied`. The declaration's
  SHA-256 is part of the cache key and every result.
- `journal=DenialJournal(path)` makes denials durable: every broker denial (authority, host-call limit, stale handle,
  typed read error) and every effect denial is appended, with the artifact id and effect schema, to an append-only
  SQLite journal hash-chained with the ledger's `event_hash` and `encode`. Reopening verifies the whole chain;
  update and delete are refused by triggers. Entry kinds are `broker`, `effect` and `admission`.
- `tools.kernel.conformance.check(component, task, journal)` runs a frozen task (`id`, the three schemas, the effect
  declaration and up to 256 hex-encoded cases with expected state and effects) through a `Workcell` and reports each
  case as `passed`, `wrong`, `denied`, `trapped` or `refused`. `python -m tools.kernel.conformance` reads
  `{"component", "task", "journal"}` on stdin so callers without Wasmtime can use it in a separate process.
- `tools.kernel.limits.run_candidate(component, schemas, state, event, inputs, limits=Limits(...), effects=None)`
  checks effects the same way and reports `denied` with the denials. It runs one candidate
  in a new host process watched from outside Wasmtime, including compilation, and kills the process group on timeout
  or output overflow. `Limits`: fuel 1–10,000,000 (default 100,000), memory 64 KiB–16 MiB (default 16 MiB), combined
  output 1 byte–1 MiB (default 1 MiB), wall time 0.01–60 s (default 5). Receipts give `wall_ns`, `time_to_stop_ns` and
  `time_to_kill_ns`; a failure to confirm the process group is gone is `cleanup_failed`.

## Example

`reference.wat` is a hand-written control kernel: its next state is state plus event plus the first byte of the first
buffer, modulo 256. Build it into a component, validate it, then run it:

```console
$ make tools
...
kernel tools ready: <repo>/.tools/venv/bin/python (wasmtime 49.0.0), <repo>/.tools/bin/wasm-tools (1.262.0)
$ export PATH=$PWD/.tools/bin:$PATH
$ wasm-tools component embed tools/kernel/kernel.wit tools/kernel/reference.wat -o /tmp/core.wasm
$ wasm-tools component new /tmp/core.wasm -o /tmp/kernel.wasm
$ .tools/venv/bin/python -B -m tools.kernel.contract /tmp/kernel.wasm
{"component_sha256":"fe2ee95d88f8e16567f7588e374e3a5015a2f78ac37790823320b0fc2a3bb493","contract_version":"1.0.0","id":"2c0892d9abf4db0e24d87857d2a7b735ecc0056703797d02946ce4a64ba12e27","validation":"static-interface-only","validator":"wasm-tools/1.262.0","version":1,"wit_sha256":"4768b0a5910d7adedd071b26d2eb46e1e849ea5e7988015a80e29ec91c57613e","world":"endoforge:kernel/kernel@1.0.0"}
$ .tools/venv/bin/python -B -c "
from pathlib import Path
from tools.kernel.workcell import Workcell
cell = Workcell(Path('/tmp/kernel.wasm').read_bytes(), ('test:byte', 'test:byte', 'test:none'))
r = cell.run(bytes([5]), bytes([3]), [bytes([2, 9])])
print({k: r[k] for k in ('state', 'effects', 'fuel_consumed', 'buffer_bytes_read')})"
{'state': b'\n', 'effects': [], 'fuel_consumed': 184, 'buffer_bytes_read': 1}
```

5 + 3 + 2 = 10, the byte `\n`. The kernel read one byte of its buffer and used 184 units of fuel.

## Tools

`make tools` installs the pinned `wasm-tools` 1.262.0 and Python `wasmtime` 49.0.0, hash-checked, into the
git-ignored `.tools/` (a virtual environment and `.tools/bin/wasm-tools`); CI runs the same target. `make kernel-test`
uses `.tools/` when present and fails naming `make tools` when a tool is missing. Pins live in `requirements.txt` and
`install_tools.py`; the x86_64 Linux `wasm-tools` archive has SHA-256
`655b8df67d54c3ef9b52fc237c4e94bbfbb5f5f43825245cb0940a7002a9ed65`
([release](https://github.com/bytecodealliance/wasm-tools/releases/tag/v1.262.0),
[WIT reference](https://component-model.bytecodealliance.org/design/wit.html)). `WASM_TOOLS` overrides the
executable. `make test` runs `make kernel-test` and never downloads.

## Limits

- `validate_component` is static. Semantic conformance comes from `conformance.check` against a frozen task's cases;
  the denial journal is separate from the ledger and nothing here writes ledger records. Effects are validated as
  data; this host never dispatches them.
- The in-process `Workcell` bounds guest instructions (fuel) and linear memory only. `run_candidate` adds a
  process-group watchdog on Linux; it does not claim cgroup or hostile native-code containment, OS sandboxing or
  calibrated timings.
- The tests run 1,000 attempts with one compilation and distinct stores; performance is not claimed.

## Tests

`make kernel-test` runs `test_contract.py`, `test_workcell.py`, `test_broker.py`, `test_limits.py`,
`test_effects.py` (declarations, payload checks, the denial journal and its chain, denials from the workcell and
`run_candidate`) and `test_conformance.py` (frozen task cases in process and through the host-process entry). They compile
fresh dummy components from the WIT as positive and negative controls (their functions trap), and build test
components in temporary directories without changing fixtures.

Engineering record: component C-17, requirements REQ-KERNEL-001 to REQ-KERNEL-004 and REQ-TOOLS-001.
