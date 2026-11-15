# Workcell browser (design)

Date: 2026-11-14. Status: design for review; nothing here is built, and no default changes.

The direction is that the engine can run a browser, inside a V8 isolate. This note proposes running the Rust and
WebAssembly core of [Kitesurf](https://github.com/cloudflare/kitesurf) as pinned machinery inside an existing workcell,
the way the TypeScript checker already runs its pinned WebAssembly compiler there. No browser process, CDP server,
Chromium or `workerd` sidecar is involved. Kitesurf references are to commit
[`4a29038`](https://github.com/cloudflare/kitesurf/tree/4a29038) as `KS:path:line`.
The measured `wrangler dev` and CDP numbers for Kitesurf are in endoforge
[#151](https://github.com/Akilleez-QA/endoforge/pull/151); they describe a different path from this one.

## The isolate model

- **Where it runs.** A render is a job in an `IsolatePool` cell ([workcells](workcells.md)). The browser engine is a
  pinned WebAssembly module that the cell's host port compiles once in `warm()` and checks against SHA-256 digests,
  like the compiler pin in [tools/asc/pin.mjs](../../tools/asc/pin.mjs) and the tsrs pin in
  [tools/tscheck](../../tools/tscheck/README.md). Each render gets a fresh engine instance; the compiled module is
  reused; the cell is replaced after `retireAfterJobs`.
- **No process per render.** Cells are spawned once and kept warm, so the "no container, virtual machine or process
  spawn per attempt" property in the [README](../../README.md#why) holds for renders too.
- **Process cells only.** Browser jobs use `isolation: 'process'` with the loop's permission flags. On Node 26.13.1,
  `--permission` without `--allow-net` refuses sockets: `net.connect` returned `ERR_ACCESS_DENIED` and `fetch`
  failed in a check run for this note. A thread cell has normal Node privileges (workcells.md:213), so a browser port
  refuses to start in one.
- **Network is a host effect.** The engine never opens a socket. Kitesurf core asks for resources through one
  JavaScript bridge (`__setBridgeFetchResource` in its generated glue); the port answers it through `hostCall` or
  `syncHostCall`, and the supervisor applies a per-job allowlist. The first slice allows nothing.
- **No host filesystem, no credentials.** The cell reads only the pinned artifact files; the HTML arrives in the job.
  No cookies, profiles or logins exist, and nothing persists between renders.
- **Not an operating-system sandbox.** Workcells are for speed and concurrency (workcells.md:7). Separation of failure
  budgets comes from process cells and cgroups, as for every other cell.

## What the code says

The corrected brief described the architecture as follows. Each claim was checked against `main` at `b4bf587` and
Kitesurf `4a29038`.

| Claim | Verdict | Evidence |
|---|---|---|
| A workcell is a warm V8 isolate | Confirmed, with a nuance: a cell is a `worker_threads` Worker or a forked Node process, and the loop pool defaults to process cells | workcells.md:3-7 and :41-43; isolate-pool.mjs:291; x1/loop.mjs:37 |
| The kernel is WebAssembly that imports only `abort`, and the host does the effects | Confirmed for candidate kernels. It is a gate on the candidate module (G2, `forbidden_effects`), not a rule for the cell: trusted machinery in the same cell, such as the pinned compiler, imports more | gates.md:76 and :248; x1/measure.mjs:6; library/link.mjs:54; candidate-loop.md:16; asc/pin.mjs:12-16 |
| Kitesurf is built the same way, Rust compiled to WebAssembly in V8 isolates | Partly. The core is Rust on Blitz, Stylo, Taffy, Parley and `vello_cpu`, with Boa running page JavaScript inside the WebAssembly. Its isolates are `workerd` Workers created with the Dynamic Workers loader, and its TypeScript layer imports `cloudflare:workers` | KS:AGENTS.md:10-12, :65-66; KS:README.md:13-14, :245, :340-343; KS:packages/page-script/src/index.ts:9 |
| The browser can load into a workcell isolate | Not as built. EF's WebAssembly guard refuses all three Kitesurf modules (measured below): the core and renderer use WebAssembly exceptions and SIMD, which the guard does not accept | workcells.md:93; isolate-wasm.mjs:103 and :218; KS:packages/core/.cargo/config.toml:67-69 |
| The egress rule still holds | Corrected. EF's egress allowlist is the factory runtime's CONNECT proxy for model-provider hosts in its sandboxed worker, not a workcell rule. Workcells have no allowlist; process cells under the loop's flags have no network at all. A browser allowlist is new work in the host port | factory_runtime/egress.py:1-7; x1/loop.mjs:32-35; workcells.md:213 |
| A browser already runs somewhere in a run | Only outside the engine: hill-climb `render` runs each campaign's shell command on the host | tools/hillclimb/bin/hillclimb.mjs:62-69 |

Paths are relative to the repository root, `docs/architecture/` or `core/` as written.

## Kitesurf pieces: as-is or port

Rust crates are `cdylib` builds for `wasm32-unknown-unknown` with wasm-bindgen 0.2.127, toolchain
`nightly-2026-05-14`, `-Zbuild-std` and `panic=unwind` (KS:Cargo.toml:17; KS:rust-toolchain.toml;
KS:packages/core/.cargo/config.toml). The TypeScript packages are bundled to strings and loaded with `env.LOADER.load`
(KS:AGENTS.md:96-104).

| Piece | What it is | Worker-specific dependencies | Into a workcell |
|---|---|---|---|
| `kitesurf-core` (`packages/core`) | Engine: DOM, style, layout, paint, screenshots, Boa eval, network provider. Exports `ks_render_html_to_png` and `ks_render_html_to_image` (KS:packages/core/src/paint/screenshot.rs:118, :128), `DomHandle`, `register_ua_fonts` | None in the generated glue (0 matches for `cloudflare`). 149 imports, all from its own wasm-bindgen glue: the fetch bridge, `crypto.getRandomValues`, `performance.now`, `Date` | Runs as-is in plain Node 26 (measured below). Refused by the guard: exception tag section, `+simd128`, no declared memory maximum. Needs a guard-compatible build or a guard change, plus a `trustedWasmModules` entry |
| `renderer-core` | `SceneRasterizer` slice of core for partial frames | None in the module; consumed by `page-renderer` | Not needed for whole-page renders. Refused by the guard for the same reasons |
| `scene-host-wasm` | The terminal client's scene rasterizer; `panic=abort` | None: zero imports | Rasterizes Kitesurf's scene protocol, not HTML. Refused by the guard (SIMD opcode `0xfd`) |
| `@kitesurf/page-script` | Per-page runtime: navigation, script execution through Boa (`ks_eval_page`, KS:packages/page-script/src/scripts.ts:192) | `WorkerEntrypoint`, `RpcTarget`, `abortIsolate` from `cloudflare:workers` (index.ts:9); `class PageScript extends WorkerEntrypoint` (:3035); loaded by `env.LOADER.load` with a `globalOutbound` (KS:packages/engine/src/eval/page-script.ts:376, :392) | Port: replace the entrypoint and RPC with a plain module and host calls. Needed only for pages that run JavaScript |
| `@kitesurf/dom-shim` | The in-sandbox DOM used by page-script | No `cloudflare:` or `node:` imports found | Likely as-is with page-script; unmeasured |
| `@kitesurf/page-renderer` | Stateless raster worker with the resource cache | `WorkerEntrypoint`, `abortIsolate` (index.ts:9, :420); `env.KS_TAIL_TOKEN` (:737); a denied outbound (KS:packages/engine/src/eval/page-renderer.ts:113) | Not needed: core paints whole pages itself |
| `@kitesurf/worker-script` | Runs a page's `new Worker()` | `WorkerEntrypoint` (index.ts:9, :52) | Out of scope |
| `@kitesurf/engine` | The Worker and CDP server | `worker_loaders` binding `LOADER` and assets binding `FONT_ASSETS` (KS:packages/engine/wrangler.jsonc:50, :54) | Dropped. EndoForge has no CDP surface |
| `@kitesurf/script-gate`, `@kitesurf/jsrpc-types` | Script policy; type-only RPC contracts | Not checked in detail | Script policy may be reused with page-script; unmeasured |
| `kitesurf` CLI | Terminal client with Browser Run and OAuth | Hosted service | Out of scope |

### Measured in a check run (main-rig, 2026-11-14, 8:53-8:59 PM ET)

The artifacts are the ones `pnpm run dev` built for #151 (`kitesurf_core_bg.wasm` 25.9 MiB, `renderer_core_bg.wasm`
5.0 MiB, `scene_host.wasm` 2.2 MiB). EF's guard was loaded from this commit's `core/runtime/isolate-wasm.mjs` and given a
`trustedWasmModules` entry with a 4,096 MiB ceiling for each module:

```console
packages/core/pkg/kitesurf_core_bg.wasm REFUSED: unsupported wasm feature in bounded workcell
packages/renderer-core/pkg/renderer_core_bg.wasm REFUSED: unsupported wasm feature in bounded workcell
packages/engine/public/rbi/scene_host.wasm REFUSED: unsupported wasm feature in bounded workcell
```

The first two stop at section 13, the exception tag section (isolate-wasm.mjs:103); `scene_host.wasm` stops at the
SIMD prefix `0xfd` (isolate-wasm.mjs:218). All three declare a memory with no maximum.

Outside a workcell, plain Node 26.13.1 loaded the core through its unmodified glue, registered Noto Sans, Noto Sans
Italic, Noto Serif and Noto Sans Mono from Kitesurf's font directory, and rendered a 400 by 200 page with a heading and
a blue box to a correct PNG. Five renders in each of three processes gave one PNG digest:

```console
{"node":"v26.13.1","compileMs":26,"initMs":16,"renders":[{"ms":78.5,"bytes":8958,"sha":"1ff3d2de123a7af8"},{"ms":1.4,"bytes":8958,"sha":"1ff3d2de123a7af8"},{"ms":1.1,"bytes":8958,"sha":"1ff3d2de123a7af8"},{"ms":1,"bytes":8958,"sha":"1ff3d2de123a7af8"},{"ms":0.9,"bytes":8958,"sha":"1ff3d2de123a7af8"}],"fontsOk":true,"rssMiB":157.6,"wasmMemMiB":0}
```

Twenty different 800 by 1,200 pages of 30 styled paragraphs each:

```console
{"n":20,"size":"800x1200","p50":10,"min":7.3,"max":97.3,"wasmLinearMiB":15.125,"rssMiB":236.3}
```

A bare `node` process measured 46.4 MiB resident on the same host. The host was shared (load averages 14.5 over 1 minute and 26.5 over 5 minutes). The
probe scripts are kept outside the source tree. Page JavaScript was not exercised: `ks_render_html_to_png` parses,
styles, lays out and paints, and does not fetch HTTP resources (its doc comment in the generated `kitesurf_core.d.ts`).

## Pinning and determinism

EndoForge's rules: gates are deterministic and G5 reruns on a fresh instance (gates.md:3 and :80); pinned machinery is
verified by digest before use (workcells.md:103-105; tools/asc/pin.mjs; tools/tscheck/README.md:20); WebAssembly with no
declared maximum loads only through a `trustedWasmModules` digest (workcells.md:88-89); the ledger's `evidence` is
observation data with no authority (interfaces/ledger-icd.md:114), and pass or fail comes from code such as an invariant
callback (interfaces/ledger-icd.md:65).

- **Artifact.** A `tools/browser/pin.mjs` would hold the SHA-256 of the core module, its glue and each font file, and
  the cell limits. `warm()` refuses a mismatch.
- **Fonts.** The production core embeds no fonts: its `include_bytes!` font uses are in `#[cfg(test)]` code
  (KS:packages/core/src/paint/font_container.rs:140), and `system_fonts` is off (KS:packages/core/Cargo.toml:77). Fonts
  come from the caller through `register_ua_fonts` (KS:packages/core/src/resources/fonts.rs:1098). The font set is
  therefore exactly the pinned files. Web fonts are not fetched in the first slice.
- **Time.** The core imports `performance.now`, `Date.getTime` and `getTimezoneOffset`. The port builds the import
  object, so a render-gate mode can supply a fixed clock and UTC. Whether a static render reads the clock is unmeasured.
- **Randomness.** `getrandom` uses its `wasm_js` backend, which calls `crypto.getRandomValues`
  (KS:Cargo.toml:55-56; KS:packages/core/.cargo/config.toml:71). A render-gate mode supplies a seeded source. The effect
  on output is unmeasured; the probe's repeated digests suggest none for static pages.
- **Raster backend.** CPU only. The workspace uses `vello_cpu` 0.3 and `anyrender_vello_cpu` 0.18 (KS:Cargo.toml:26-31);
  `Cargo.lock` has no `vello` (GPU) or `wgpu` package. No GPU is needed.
- **Scope of a digest.** One pinned artifact on one machine gave identical PNG bytes. Equality across CPUs, Node
  versions or a build without SIMD is unmeasured, so a render gate compares digests only within one pin and records
  the pin with the evidence.

## Memory and warm-pool cost

| Quantity | Value | Source |
|---|---|---|
| Kitesurf as a whole runtime (`workerd`, CDP path) | 87.6-87.9 MiB resident; the `wrangler dev` tree 1,641 MiB | #151, measured |
| Core in plain Node, after compile, fonts and 20 renders | 236.3 MiB resident against 46.4 MiB for bare `node`; 15.1 MiB linear memory | Measured above |
| Compile and instantiate the 25.9 MiB module | 26 ms and 7-16 ms | Measured above |
| Per render, 800 by 1,200 text page | p50 10-14.7 ms; first render 62-100 ms | Measured above, two runs |
| Default WebAssembly ceiling per memory | 64 MiB (15.1 MiB fits) | workcells.md:68 |
| Default pool size | `availableParallelism()`; plateau at 20-32 cells in P-17 | workcells.md:66, :206-208 |
| Shared compiled module | Thread cells only; 56% less peak RSS at 8 cells for tsrs in P-45 | workcells.md:48; tools/tscheck/README.md:145 |
| Idle cells given back | Beyond a floor of 1, on the memory guard's signal | workcells.md:176 |
| Resident cost per browser process cell | About 190 MiB (236.3 minus 46.4) | Estimate, unmeasured in a cell |
| Eight warm browser cells | About 1.5 GiB | Estimate, unmeasured |

Process cells compile their own copy of the module, so the shared-module saving does not apply. A guard-compatible
build without SIMD may change both size and speed; unmeasured.

## Licensing

EndoForge is GPL-3.0-only. The measured facts, from the Kitesurf checkout and the crate sources Bazel fetched for it:

- Kitesurf is Apache-2.0 (`KS:LICENSE`) and ships a `NOTICE` that lists third-party fonts, data and patched crates
  and says generated Rust notices list each artifact's dependencies.
- The FSF lists Apache-2.0 as compatible with GPLv3
  ([license list](https://www.gnu.org/licenses/license-list.html#apache2)). Apache-2.0 §4(d) requires keeping the
  `NOTICE` text when distributing the work or a derivative
  ([license](https://www.apache.org/licenses/LICENSE-2.0#redistribution)).
- Fourteen fetched crates are MPL-2.0 only: `stylo`, `stylo_atoms`, `stylo_derive`, `stylo_dom`, `stylo_static_prefs`,
  `stylo_traits`, `selectors`, `cssparser`, `cssparser-macros`, `dtoa-short`, `app_units`, `to_shmem`,
  `to_shmem_derive` and `uluru`; `stylo_taffy` is MIT, Apache-2.0 or MPL-2.0. The Stylo crates carry the MPL header
  in each source file and no separate license file.
- No `.rs` file in any fetched crate, patched copies included, carries the Exhibit B notice "Incompatible With Secondary
  Licenses" (0 files). MPL-2.0 §3.3 therefore allows distributing those files under the GPL as part of a Larger Work,
  while keeping them available under the MPL ([MPL-2.0](https://www.mozilla.org/en-US/MPL/2.0/),
  [FAQ Q14](https://www.mozilla.org/en-US/MPL/2.0/FAQ/); [FSF](https://www.gnu.org/licenses/license-list.html#MPL-2.0)).
  Kitesurf patches some of these crates (`scripts/patches/`); modified MPL files stay MPL and their source must be
  available.
- The other 348 fetched crates declare permissive licenses (MIT, Apache-2.0, BSD, Zlib, BSL-1.0, Unicode-3.0,
  Unlicense, IJG); for each, the license or one of its options is listed as GPL-compatible by the FSF. This tally covers every crate Bazel fetched, not only the
  core artifact.
- Fonts are SIL OFL 1.1. The FSF lists the OFL as a free license for fonts without calling it GPL-compatible. The core
  does not embed them; they stay separate data files with their OFL texts, loaded at run time.

Integration choice: depend on a pinned build artifact outside the source tree, set up by a `make` target, as tsrs is.
Nothing is vendored, so the repository distributes no Kitesurf code. If EndoForge ever ships the artifact, it ships
Kitesurf's `LICENSE`, `NOTICE`, the generated Rust notices and a pointer to the MPL sources with it. This is a reading
of the licenses, not legal advice.

## The smallest spike

Goal: render one local HTML file to pixels inside a workcell, with no network and no process per render.

1. Outside EndoForge, build `kitesurf-core` at `4a29038` in a guard-compatible profile: without `+simd128` and with
   `panic=abort` and the stock standard library. Record the digests. This needs no EndoForge change but is a Kitesurf
   build change; see risks.
2. `tools/browser/pin.mjs` (about 30 lines): artifact and font digests, `wasmMemoryMaxMb` 64, a `trustedWasmModules`
   entry with a declared `maximumPages`.
3. `tools/browser/port.mjs` (about 110 lines): `warm()` verifies digests, compiles the module through the guard and
   registers the four UA fonts; `createPort` refuses thread cells and returns `evaluate`, which renders the job's HTML
   at the job's width and height on a fresh instance with a fixed clock and seeded randomness, and answers the fetch
   bridge with a refusal; `evidence()` returns the PNG digest, size and pin.
4. `tools/browser/test/render.test.mjs` (about 120 lines) with a 10-line HTML fixture: a process-cell pool renders the
   fixture; the PNG has the requested size; a pixel inside the blue box has the expected colour; two cells and two runs
   give one digest; a digest mismatch fails `warm()`; a thread cell is refused; a fetch attempt is refused. Without the
   artifact the test reports skipped, never passed.
5. `tools/browser/README.md` (about 40 lines), a `browser-setup` and `browser-test` `make` target (about 8 lines) and a
   changelog fragment.

Size: about 320 to 380 lines. Proven: a pinned browser engine renders HTML to pixels inside a guarded process workcell,
deterministically within one pin, with no network and no process per render, and `ready()` and per-render time and
RSS are recorded. Not proven: page JavaScript (needs the page-script port), web fonts, images, fidelity against
Chromium, thread cells, CI (the artifact takes a Bazel build; 665 s on main-rig for #151).

## Risks and open questions

- **Top risk: the guard.** The shipped modules fail EndoForge's guard. Kitesurf relies on `panic=unwind` so a panic
  does not lock the live DOM (KS:AGENTS.md:67-68), and on SIMD for raster speed. A `panic=abort`, no-SIMD build may
  not compile, may lose speed, or may need Kitesurf patches. The alternative, teaching the guard to parse SIMD and
  exception opcodes for trusted modules, changes a security-relevant file. Which way to go is open.
- Kitesurf calls itself a proof of concept (KS:AGENTS.md:14-15), on a pinned nightly toolchain with `-Zbuild-std`.
- Page JavaScript needs a port of page-script off `WorkerEntrypoint` and `env.LOADER`; its `index.ts` alone runs past
  3,000 lines.
- A browser cell costs about 190 MiB resident (estimate), several times a plain loop cell.
- CI needs the artifact: a pinned release build or a Bazel build in CI. Neither exists yet.
- A fetch allowlist in the host port, and how fetched bytes enter the ledger, are designed after the first slice.
- Render-gate thresholds and pixel comparison rules belong in the frozen evaluator, decided per campaign.

Out of scope: authenticated sessions, cookies and logins; hosted Cloudflare, Browser Run, Dynamic Workers and anything
paid; CDP, Puppeteer, Playwright and Chromium; any deployment or exposed endpoint.
