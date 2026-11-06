# P-45 one verified compiled module across thread workcells: precommit

Label: **Proposed** procedure, frozen 2026-11-06 before measurement.

Question: can one guard-instrumented `WebAssembly.Module` be posted to thread workcells, with guard and instance limits unchanged, and does this beat compiling per cell?

Design under test: `IsolatePool({sharedWasmModules: [{sha256, path}]})`. A short-lived worker with the guard installed reads the bytes, checks the digest, instruments and compiles once. The supervisor passes the module and its guard metadata in `workerData`. A cell's checked `Module` or `compile`, given bytes whose SHA-256 matches, returns that module. Modules a port receives any other way stay refused. Each cell's checker still verifies its own bytes against the pin.

Arms: per-cell (current) and shared, each with `tools/tscheck/pin.mjs` `WORKCELL`, at N = 1, 8, 16 thread cells, 3 reps, each rep in a fresh Node process on `medium/ill`. One rep: `new IsolatePool`, `ready()`, N first jobs (one per cell), then 8 × N jobs. Record first-batch wall, per-cell `compileMs`, the shared compile's time, peak RSS from `VmHWM`, checks per second and the diagnostic count.

A separate cost split, one thread, 3 reps: hash, `validate`, native compile of the original bytes, and guarded `new WebAssembly.Module`, with instrumentation as the remainder.

Containment: the implementation carries tests that a shared module growing past the cap stops only its cell with siblings intact, that the breach flag is per instance, that a module posted through port options stays refused, and that a digest mismatch falls back to per-cell compile.

Predictions:

1. Shared per-cell `compileMs` p50 is at most 150 ms at 8 cells, against at least 1,000 ms per-cell. That figure is core import plus the hash.
2. First-batch wall at 8 cells falls by at least half.
3. Peak RSS at 8 cells falls by at least 25%, because instrumentation allocates JS arrays per cell. V8's native module cache may already share the code, so code sharing alone isn't predicted to help.
4. Throughput after the first batch does not change by more than 10%.
5. Diagnostics stay identical across arms and every containment test passes.

Decision: a failed containment test keeps per-cell compile and the reason is recorded. Shipping as default for tscheck also needs predictions 1 and 3 to hold; otherwise the pool option stays available but off and the result says so.

Failure meaning: a prediction miss is a result and stays in the receipt. Sharing is thread-only: a `WebAssembly.Module` can't cross a process boundary.

Limits: a shared desktop with other work running, one host, Node as recorded. RSS is process-wide and includes the ledger's bridge only indirectly (the bridge is a separate process, excluded from `VmHWM`).
