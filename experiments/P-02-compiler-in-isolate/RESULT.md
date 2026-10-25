# P-02 compiler-in-isolate — result

Status: **Recorded (probe)**. One lifetime, one machine, shared desktop (load average 16.0 at start, 15.8 at end; `receipt/env-before.json`, `receipt/env-after.json`). Precommit hash: `receipt/precommit.sha256` (`9b4e13a8…7432`), hashed 2026-10-17 before any measurement.

**Scope statement (E3-10).** This probe hosts the AssemblyScript compiler, which is JavaScript, in V8: a Node 26.8.1 `worker_threads` Worker, i.e. a separate V8 isolate in the Node process. That is what Edition 3's route table literally says ("JavaScript-hosted compiler, inside the isolate"). It does **not** show the compiler running under Wasmtime, and it does not say how a JavaScript engine would be provided on the Wasmtime local lane. Errata E3-10 stands.

## Question

Can the AssemblyScript compiler (`assemblyscript@0.28.20`, programmatic `asc` API) run inside a V8 isolate with no filesystem access and compile real 100–200-line kernels, and what does each compile cost?

## Procedure as run

- Dependencies: `assemblyscript@0.28.20` (integrity `sha512-5PM7GZ…`), `binaryen@131.0.0-nightly.20260721`, `long`; sha256 of the loaded bundles in `receipt/compiler-bundle-sha256.txt`.
- Kernels: `gen-kernels.mjs` produced `kernels/k00.ts`–`k19.ts` deterministically (132–186 lines; 6–12 state fields of mixed f64/f32/i32/u32/i64 with per-variant offsets, 8/16/32 buckets, differing arithmetic). k05, k11, k17 contain `const bad: u32 = value * 2.0;` (deliberate type error). `kernels/manifest.json` has line counts and sha256.
- Host run (`main.mjs` → `worker.mjs`): the main thread read the sources and posted them to one Worker. The Worker wrapped `fs.promises.{readFile,readdir,writeFile,mkdir,stat,access}` and `fs.{readFileSync,readdirSync,writeFileSync,mkdirSync,statSync,existsSync,accessSync}` with counters, then `import("assemblyscript/asc")` once, then for each message ran `asc.main([name.ts, -O3, --runtime stub, --noAssert, --noColors, --outFile out.wasm], {readFile, writeFile, listFiles, reportDiagnostic, stdout, stderr})` over an in-memory map. Passes 0–2 emit; pass 3 is `--noEmit`. 80 compiles per run. Per compile: wall time, `v8.getHeapStatistics()` in the worker, process RSS from `/proc/self/status`, diagnostics, output size, asc's own phase timers.
- bwrap run (`bwrap-run.sh`): the same program under `bwrap --unshare-all --die-with-parent --new-session --clearenv`, with read-only binds of the Node install dir (`~/.local/share/mise/installs/node/26.8.1`), `/usr/lib`, `/usr/lib64` (plus `/lib`, `/lib64` symlinks), and the probe directory read-only; `--proc /proc`, `--dev /dev`, `--tmpfs /tmp`; no home, no `/etc`, no network. Output went to stdout, captured by the host into `receipt/compile-bwrap.jsonl`.
- `deps-check.mjs`: fresh main-thread process; `process.moduleLoadList` diff around the import; `--noEmit` over in-memory callbacks on k00; bundle sizes.

## Results

### Load and sandbox outcome

| | host run | bwrap run |
|---|---|---|
| bwrap exit code | — | **0** (`receipt/bwrap-config.txt`), stderr empty |
| compiles completed / attempted | 80 / 80 | 80 / 80 |
| `import("assemblyscript/asc")` in worker | 359 ms | 292 ms |
| Worker spawn → compiler ready | 393 ms | 323 ms |
| Worker heap used after load | 26.9 MB | 27.0 MB |
| Process RSS: before Worker → after load | 54 MB → 151 MB | 54 MB → 147 MB |
| real `fs` calls during the 80 compiles | **0** | **0** |
| `fs.readFileSync` calls during import | 4 | 4 |
| clean kernels (17) produced wasm in every emit pass | yes | yes |
| type-error kernels (3) failed with 1 diagnostic each | yes (`Conversion from type 'f64' to 'u32' requires an explicit cast.`, code 200) | yes |

The 4 `readFileSync` calls at import are Node's ESM loader reading the four module files (`asc.js`, `binaryen/index.js`, `assemblyscript.js`, `long/index.js`; `receipt/load-readfilesync-paths.json`), i.e. loading the compiler's own code, not compiler I/O. asc's own `stats.readCount`/`writeCount` (its default filesystem callbacks) were 0 in all 160 compiles.

### Per-compile wall time (ms), inside the Worker

| Series | run | n | median | p95 | min | max |
|---|---|---|---|---|---|---|
| first compile ever (k00, pass 0) | host | 1 | 269.0 | | | |
| | bwrap | 1 | 192.0 | | | |
| pass 0, clean kernels (first use of loaded compiler) | host | 17 | 75.7 | 269.0 | 56.8 | 269.0 |
| | bwrap | 17 | 53.6 | 192.0 | 45.6 | 192.0 |
| passes 1–2, clean kernels, emit | host | 34 | **51.1** | 71.3 | 41.3 | 74.5 |
| | bwrap | 34 | **40.0** | 47.4 | 34.1 | 51.0 |
| passes 1–2, type-error kernels | host | 6 | 34.1 | 44.2 | 23.7 | 44.2 |
| | bwrap | 6 | 25.1 | 27.1 | 21.3 | 27.1 |
| pass 3, `--noEmit`, clean | host | 17 | 46.0 | 56.1 | 41.4 | 56.1 |
| | bwrap | 17 | 40.1 | 46.3 | 37.0 | 46.3 |
| pass 3, `--noEmit`, type-error | host | 3 | 30.9 | 35.1 | 23.8 | 35.1 |
| | bwrap | 3 | 27.6 | 28.0 | 23.7 | 28.0 |

The bwrap run being faster than the host run is noise, not a sandbox effect: the host run went first while the desktop load average was rising from 12 to 16 (`receipt/run.log`, env files); the two runs are the same program.

asc's phase timers, warm clean compiles, host run, medians: parse 25.7 ms, initialize 4.3 ms, compile 1.6 ms, optimize (binaryen -O3) 17.1 ms, emit 0.4 ms, validate 0.2 ms. Parsing dominates because every compile re-parses the bundled standard library (asc parses all `libraryFiles` each `main` call); `--noEmit` saves only emit, so checking is not much cheaper than compiling.

Per-kernel warm medians (host, passes 1–2) ranged 41.3–65.4 ms for clean kernels of 132–186 lines, with no visible dependence on line count within that band; output modules were 1,144–2,430 bytes (`receipt/summary.json → perKernelWarmMedianMs`).

### Memory

| Point (end of pass, after kernel k19) | host: worker heap used / heap total / process RSS | bwrap: same |
|---|---|---|
| after first compile (k00) | 52 / — / 264 MB | 52 / — / 260 MB |
| end of pass 0 (20 compiles) | 65 / 137 / 424 MB | 98 / 144 / 424 MB |
| end of pass 1 (40) | 78 / 142 / 453 MB | 211 / 269 / 491 MB |
| end of pass 2 (60) | 95 / 161 / 477 MB | 161 / 202 / 490 MB |
| end of pass 3, noEmit (80) | 62 / 170 / 478 MB | 128 / 172 / 490 MB |
| max worker heap used during run | 247 MB | 261 MB |

V8 `external_memory` in the worker stayed at 26 MB throughout. Worker heap used fluctuates with GC timing (it fell back to 62 MB at the end of the host run), so the JS heap is collectable; process RSS, however, climbed from about 150 MB after load to about 424 MB after 20 compiles and then plateaued at 478–490 MB. The RSS that does not return is consistent with binaryen's WebAssembly linear memory (binaryen is loaded as a 13.6 MB JS bundle embedding its WASM and runs in the same worker) growing to its high-water mark and never shrinking; this probe did not isolate it.

### Dependency surface (`receipt/deps-check.json`)

- `asc.js` detects Node by `Object.prototype.toString.call(globalThis.process) === "[object process]"` and then `await import("fs")`, `"module"`, `"path"`, `"url"` and uses `globalThis.process`; otherwise it falls back to bundled shims (`fs.promises = {}`, `createRequire` that throws, pure-JS `path`, a `process` shim with `cwd()="."`, `hrtime`, `exit` that throws). So: **at load in Node it imports `fs`/`path`/`module`/`url`; the real `fs` is used only by the default `readFile`/`writeFile`/`listFiles`, which are bypassed when callbacks are supplied, and if `fs.promises.readFile` is absent asc requires all three callbacks.** The standard library (`libraryFiles`) is bundled into `asc.js` as strings, so no stdlib files are read from disk.
- Node built-ins newly loaded by the import (main-thread process): `module`, `url`, `assert`, `http`, `https`-side `tls`/`crypto`, `http2`, `zlib`, `perf_hooks`, `worker_threads`, `stream/web`, `undici`, `wasm_web_api` and their internals (84 modules). Most of this is Node eagerly loading the `module` built-in's dependency closure, not code asc calls.
- `--noEmit` over in-memory callbacks: works (`noEmitOk: true`, 0 reads, 0 writes).
- Compiler bundle: `asc.js` 880,639 B + `assemblyscript.js` 755,797 B + `binaryen/index.js` 13,572,386 B (+ `transform.js`, `web.js` < 1 KB) = **15.2 MB** of JavaScript; `node_modules/` on disk 106 MB (includes `.d.ts`, source maps, stdlib sources). `web.js` (949 B) is the browser entry.

### Bad-sign check

- Compiler cannot run without real fs: **not observed.** 80/80 compiles under bwrap with the probe dir read-only, no home, no /etc, no network; 0 fs calls during compiles in both runs.
- Per-compile median above 1 s for a 200-line kernel: **not observed** (warm median 40–51 ms; worst single compile 269 ms, the very first).
- Worker heap growth that does not plateau: **ambiguous.** JS heap used is collectable and fell at the end; process RSS plateaued at about 480–490 MB after roughly 20 compiles. Not a leak on this evidence, but a large high-water mark.

## What this does not show

- It does not show the compiler running under Wasmtime or any non-V8 host, and does not address how the Wasmtime local lane would host it (E3-10). The isolate here is a V8 isolate inside a Node process with Node's built-ins available; the compiler in fact imported `fs`, `module`, `path`, `url` at load and would need the shim path (`web.js`-style, no `process` object) to run where those are absent. That path was not exercised.
- bwrap removed the filesystem, network and IPC namespaces, but the Node process still had `/proc`, `/dev`, the Node install and system libraries. It is not the 128 MB hosted isolate of X6/P-05 and not a workerd or cgroup-limited environment; the ~480 MB process RSS is a Node-process figure (main thread + worker + binaryen), not a per-isolate figure.
- The kernels are generated variants of one template: same constructs, no classes, no managed objects, no imports, no multi-file projects, no `--transform`, no bindings generation. Compile time for kernels using the managed runtime, generics or large stdlib surface was not measured.
- One lifetime, load average 12–16, no CI, no quiet gate; medians are reported, tails are not reliable. The host-vs-bwrap difference is within that noise.
- It does not measure route yield, repair rounds, or model behaviour (X4); it measures the compiler only.
- It does not show that the compiler is safe to run on untrusted input inside the isolate (no fuzzing; `asc` crashes call `process.exit(1)` via its shim, which in the worker would be an uncaught throw — not exercised).

## Interpretation

The AssemblyScript 0.28.20 compiler, loaded once into a Node 26 worker isolate, compiled every one of 20 generated 132–186-line kernels through purely in-memory `readFile`/`writeFile`/`listFiles` callbacks, made no filesystem calls while compiling, reported the three deliberate type errors correctly, and did so unchanged under a bwrap sandbox with the probe directory read-only and no network, home or /etc. Warm compiles took about 40–50 ms each (first compile about 0.2–0.3 s), dominated by re-parsing the bundled standard library and binaryen's -O3 pass, which is well under the 1 s bad-sign line and small against any model turn. The cost that deserves attention is memory: the compiler and binaryen bring the process to about 150 MB at load and about 480 MB steady state after a few dozen compiles, which is tolerable on a local lane but is the number P-05/X6 must confront for a 128 MB hosted isolate. All of this is V8 hosting a JavaScript compiler — exactly Edition 3's route-table wording and nothing more; the Wasmtime-lane hosting question (E3-10) is untouched by this probe.

## Files

- `PRECOMMIT.md`, `receipt/precommit.sha256`, `receipt/precommit-hashed-at.txt`
- `setup.sh`, `gen-kernels.mjs`, `run.sh`, `main.mjs`, `worker.mjs`, `bwrap-run.sh`, `deps-check.mjs`, `env.sh`, `stats.mjs`, `summarize.mjs`
- `kernels/k00.ts` … `kernels/k19.ts`, `kernels/manifest.json`
- `receipt/tool-versions.txt`, `receipt/compiler-bundle-sha256.txt`, `receipt/compiler-bundle-sizes.txt`
- `receipt/env-before.json`, `receipt/env-after.json`
- Raw samples: `receipt/compile-host.jsonl`, `receipt/compile-bwrap.jsonl` (84 lines each: process, ready, 80 compiles, done, worker-exit)
- `receipt/bwrap-config.txt`, `receipt/bwrap-stderr.txt` (empty), `receipt/load-readfilesync-paths.json`, `receipt/deps-check.json`, `receipt/summary.json`, `receipt/run.log`
- `node_modules/` git-ignored (versions and hashes in receipt/)
