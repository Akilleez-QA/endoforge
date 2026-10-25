# P-02 compiler-in-isolate — precommit

Written and hashed before the first measurement. Status of any result: **Recorded (probe)**.

## Question

Can the AssemblyScript compiler (`assemblyscript@0.28.20`, `asc` programmatic API) run inside a V8 isolate with no filesystem access and compile real 100–200-line kernels, and what does each compile cost in wall time and memory?

## Unknown it de-risks

- Claim-ladder rung 1 (Edition 3 §17): "no in-isolate route has been exercised".
- Errata E3-10: Edition 3's route table says AssemblyScript is a "JavaScript-hosted compiler, inside the isolate" but never names the JavaScript host on the Wasmtime local lane. This probe exercises the V8-hosted case only; it says nothing about Wasmtime hosting.
- X4 per-candidate compile time and memory columns.

## Procedure (exact)

Setup (done before this file was hashed; not a measurement): `setup.sh` installs `assemblyscript@0.28.20` (+ `binaryen@131.0.0-nightly.20260721`) locally and records bundle sizes and sha256 of the compiler's JS files. `gen-kernels.mjs` deterministically generates 20 kernel variants `kernels/k00.ts`…`k19.ts` (132–186 lines; different field layouts, bucket counts, arithmetic). k05, k11 and k17 contain a deliberate type error (`const bad: u32 = value * 2.0`). `kernels/manifest.json` holds line counts and sha256. One smoke compile of k00/k05/k19 was run to confirm the API shape (not a measurement; no timing recorded).

Measurements (`run.sh`):

1. `env-before.json`.
2. **In-isolate compile, host filesystem present** (`main.mjs` → `worker.mjs`): a `worker_threads` Worker (separate V8 isolate) imports `assemblyscript/asc` once (load time recorded; `process.moduleLoadList` diff recorded to show which Node built-ins the compiler pulled in). Before import the worker wraps `fs.promises.readFile/readdir/writeFile/mkdir`, `fs.readFileSync`, `fs.readdirSync`, `fs.writeFileSync` with counters so any real filesystem use by the compiler is counted. The main thread then sends the 20 kernel sources in order; the worker compiles each with `asc.main([entry, "-O3", "--runtime", "stub", "--noAssert", "--outFile", "out.wasm"], {readFile, writeFile, listFiles, reportDiagnostic})` over an in-memory map (the worker never reads the kernels from disk; the main thread does and passes the text). Per compile the worker records wall time (`hrtime.bigint`), `v8.getHeapStatistics()` in the worker (used heap, total heap), process RSS, output wasm size, diagnostics. Three passes over the 20 kernels: pass 0 is the first use of the loaded compiler (cold within a warm isolate), passes 1 and 2 are warm. Then a fourth pass with `--noEmit` (check only). Raw rows to `receipt/compile.jsonl`.
3. **Same, under bwrap** (`bwrap-run.sh`): `bwrap --unshare-all --die-with-parent --new-session --ro-bind <node binary dir> ... --ro-bind /usr/lib /usr/lib --ro-bind /usr/lib64 /usr/lib64 --ro-bind <probe dir> <probe dir> --proc /proc --dev /dev --tmpfs /tmp node main.mjs --stdout`. The probe directory is read-only; no home, no /etc beyond what node needs to start (none expected), no network. Rows to `receipt/compile-bwrap.jsonl`. If node fails to start or asc fails to load, the error is recorded verbatim.
4. **Dependency-surface check** (`deps-check.mjs`): in a fresh process, snapshot `process.moduleLoadList` before/after `import("assemblyscript/asc")`; record which `node:` built-ins were newly loaded; record whether `asc.main` with in-memory callbacks and `--noEmit` returns without error on k00; record compiler bundle sizes (`receipt/compiler-bundle-sizes.txt`).
5. `env-after.json`.

## Metrics

- Compiler load time in the worker (ms), once per process.
- Per-compile wall time (ms): n, median, p95, min, max; split into pass 0 (first use), passes 1–2 (warm), and the noEmit pass; error kernels reported separately from clean kernels.
- Worker heap used before/after each compile (bytes); process RSS before/after.
- Output wasm size per kernel.
- Count of real filesystem calls made by the compiler during compiles (expected 0).
- bwrap run: success/failure and the same per-compile table.

## Bad signs (pre-stated)

- Compiler cannot load or compile without real filesystem access (bwrap run fails for a filesystem reason, or fs counters are non-zero during compiles).
- Per-compile median above 1 s for a ~200-line kernel in the warm passes.
- Worker heap growth that does not plateau across the 80 compiles (a leak in the compiler's reuse path).

## Stop rule

Run once as written. A failing bwrap run is a result, not a reason to loosen the sandbox beyond what node needs to start; any loosening is recorded as a separate series. Script-bug reruns keep the earlier files under `receipt/aborted-*`.

## Explicit scope note

This probe hosts the JavaScript compiler in V8 (Node worker_threads), which is what Edition 3's route table literally says. It does not show the compiler running under Wasmtime, and does not address how a JavaScript engine would be provided on the Wasmtime local lane (E3-10).

## Known confounds

Shared desktop, load average 8–16 in the preceding hour; RSS is process-wide (main thread + worker) because a Worker shares the process. Binaryen is loaded as a ~13.5 MB JS bundle (it embeds its WASM) and dominates load cost.
