# P-14 — tsrs relevance and hosted-fit follow-up

**Purpose.** Assess Cloudflare's 20 October 2026 announcement against Endoforge's existing tsc-rs compatibility lane and P-05 measurements. This is a new source investigation and **Recorded (probe)** measurement, not a reconstructed document or an X6 campaign verdict.

## Decision review — 20 October 2026

**Proposed, after adversarial review:** retain this checker candidate and defer adoption/stack tuning until an actual TypeScript compatibility workload or explicit hosted-development requirement exists. The inspected current scalar factory path (`tools/factory_campaign/pipeline.py::_script('compile')`, reached through `verify_publish` -> `compile_candidate`) invokes AssemblyScript, so this probe establishes no improvement to current factory throughput. See [the POODO review](POODO-REVIEW-20261020.md) for source identities, alternatives, the critic's limits and the reversal conditions. This prioritisation supersedes the original next-gates ordering below; historical measurements and their frozen procedure remain unchanged.

**Claim clarifications:** 160 timed checks repeat two deterministic fixture projects, not 160 independently diverse compatibility cases. The self-authored planted-error oracle has limited coupling independence and is not an official TypeScript conformance oracle. The old timing arm includes additional instance-observer instrumentation; combined with different builds/bridges and fixed arm order, the speedup is an integration observation, not an isolated algorithm effect. Cold-call numbers exclude module compilation and application startup. The derived 27.3125 MiB remainder is arithmetic against the project's assumed 128 MiB target, **not measured production headroom**; Cloudflare documents its limit as 128 MB, shared across an isolate. The exact charged quantity and lifecycle peak still need the intended platform's sensor.

**Upstream, checked 20 October 2026:** the [current Workers limits page](https://developers.cloudflare.com/workers/platform/limits/) (updated 12 October) lists **64 MiB uncompressed** for Worker size and says there is no compressed-size limit. The historical 10 MB compressed screen below is retained as a precommitted experiment criterion, not a current platform rule. [Platform memory metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/) are sampled isolate measurements; no such production observation was obtained here.

## Summary

- **Recorded (probe):** the published tsrs WASM package runs under the existing workerd configuration with a small adapter change. The 50-module check is 2.77× faster than the old size build in this run.
- **Recorded (probe):** linear memory is higher: 100.688 MiB instead of 52 MiB on that input, despite lower whole-process RSS. These measurements answer different questions.
- **Recorded (probe):** 160 timed checks match the independent planted-error expectations. Clean, UTF-16 and tiny emit controls pass within their stated scope.
- **Upstream:** the WASM package has an 80 MiB shadow stack and no LSP or persistent API server; the native compiler has those interfaces. Native headline savings do not establish a hosted fit.
- **Proposed:** retain tsrs as an alternative checker candidate; leave the current factory and the hosted-fit evidence label unchanged pending the checks below.

## What this does not show

This is a sequential, single-lifetime-per-arm probe on a shared Ryzen desktop, not a quiet or replicated campaign. It does not measure Cloudflare production isolate accounting or enforcement, concurrent compiler instances, large overlays, adversarial recursion, a new WASM/native latency ratio, general TypeScript conformance or generated-kernel quality. A post-call Node heap reading is not the in-call heap peak. Local workerd process RSS is not isolate memory. Linear memory includes reserved stack space even if those pages are not all resident. The Node path calls the core on the caller's stack; the package's normal Node API uses a fresh worker with a larger stack. No real platform deployment was made.

The old baseline is a locally built size-optimised tsc-rs v0.7.0 artifact, while the new candidate is a published speed-oriented package. The bridges and bundled libraries differ. This is an integration comparison with the incumbent, not an isolated attribution of gains to Rust algorithms or a reproduction of Cloudflare's headline benchmark. There is no evidence here for reducing the stack reservation.

## Exact inputs and identity

**Recorded (probe):** procedure frozen in `PRECOMMIT.md`; hash in `receipt/precommit.sha256`. The baseline compiler and core hashes match the lab's P-05 pins. The P-05 generator is imported unchanged and hashed in `receipt/artifacts.sha256`. It constructs five modules with one deliberate TS2322 and fifty modules with five deliberate TS2322 errors, with the same compiler options as P-05. Every call also instantiates and calls P-05's trivial add kernel.

**Recorded (probe):** candidate `@tsrs/wasm@0.18.0-ts7.1.0-dev.20260929`, pinned tarball integrity and contents in `receipt/npm-pack.json`; package metadata in `receipt/new-package.json`. It identifies TypeScript commit `b85298b6a81f772d080b0455de0ca9d744cd6fd6`. Inspected source HEAD is `280b426b89cd4ecd6153cf48228826bd60a99c61`. That source commit is not asserted to be the npm artifact's build commit. In particular, the published module is 9,766,093 bytes; the source build notes describe a different measured artifact. This probe uses the actual published bytes and records their hashes.

**Recorded (probe):** Node v26.8.1, V8 14.6.202.34-node.28, workerd 2026-09-30 (same binary as P-05), Linux 7.2.8-9-omarchy, Ryzen 9 7950X, 32 logical CPUs. Environments and loads are in `receipt/env-*.json` and the first attempt's files. Each arm uses one compiled module, a fresh instance per call, three warm-ups and twenty measured calls per size. Size order is reversed between compilers. Timing includes instantiation, the checker, filesystem bridge and JSON diagnostic decoding; workerd's inside clock is coarsened to whole milliseconds. HTTP host timing is retained separately.

## Measurements

**Recorded (probe):** milliseconds, median (p95), n=20 per cell. Full min/max and raw samples are in `receipt/summary.json` and the arm receipts. Speedups are **Derived**, old median ÷ new median.

| Runtime / modules | Old ms | tsrs ms | Speedup | Linear memory MiB, old → tsrs |
|---|---:|---:|---:|---:|
| node, five | 34.82 (38.58) | 9.46 (10.40) | 3.68× | 45.125 → 96.250 |
| node, fifty | 80.95 (85.71) | 32.43 (34.76) | 2.50× | 52.000 → 100.688 |
| workerd, five | 37.00 (45.00) | 10.00 (15.00) | 3.70× | 45.125 → 96.250 |
| workerd, fifty | 86.00 (95.00) | 31.00 (36.00) | 2.77× | 52.000 → 100.688 |

**Recorded (probe):** on fifty modules, Node's peak process RSS through the measured cell was 160.7 MiB old versus 141.6 MiB new. workerd's was 369.8 MiB old versus 286.7 MiB new. The latter includes retained allocations from previous calls and is sensitive to collection timing. Neither is a production isolate reading. **Derived:** 128 − 100.6875 = 27.3125 MiB remains before the target ceiling when considering the candidate's linear memory alone. The reservation increase is compatible with lower RSS because logical linear-memory allocation and physical resident pages are different quantities; this probe does not attribute all RSS differences to that mechanism.

**Recorded (probe):** module plus core, individually gzip-9 compressed, is 2,230,395 bytes old and 2,844,876 bytes new. This is comfortably below the probe's 10 MB negative screen, but is not a deployment bundle measurement or a new verification of the platform's current limits.

## Correctness checks and failures retained

**Recorded (probe):** `analyse.mjs` independently constructs the planted-error locations from the generator's source strings and checks file, UTF-16 offset, line, column, code, category, message and exit code for all 160 timed calls and the four cold calls. Every timed cell has n=20; stderr is empty. Both runtimes' clean fifty-module controls report exit 0 and zero diagnostics. Node's astral-character fixture reports UTF-16 offset 32 / column 33 from both compilers. Both Node emit controls report no errors and write byte-identical JavaScript for one small addition function. These checks establish limited fixture parity, not full compatibility.

**Recorded (probe):** the first workerd attempt failed before compiler execution because the generated Cap'n Proto configuration omitted required whitespace around an assignment to a qualified constant. Its error receipts, initial environment and successful Node measurements remain in `receipt/attempt-1/`. The configuration was repaired to match P-05's spacing and only workerd was rerun with `node run.mjs --workerd-only`. Setup verification also initially assumed the older array-shaped npm pack JSON; npm 12 returns a package-keyed object. The setup parser was corrected to accept either shape, then tarball integrity and all artifact hashes passed. No compiler build, workload, options, sample count or memory setting was tuned after seeing measurements. The final Node receipts come from attempt 1 and final workerd receipts from the repaired attempt. `receipt/harness.sha256` records the final harness, which includes the configuration repair.

## Source findings that matter to Endoforge

### The compiler can run in the proposed host, but needs adapter work

**Upstream**, confirmed by this **Recorded (probe)** integration: `@tsrs/wasm/core` is runtime independent. Its `runTsc(module, request, host, io)` takes a different request and filesystem interface from tsc-rs v0.7.0. `memoryFileSystem` accepts an object of absolute paths and exposes byte-based reads, `readDir`, explicit missing-path errors and nanosecond metadata. The old adapter cannot simply swap the binary. `check.mjs` is a minimal comparison bridge; it is not wired into the factory. The WASI target alone does not make this a self-contained WASI command: the binary also needs the custom `tsrs_host` filesystem imports and protocol implemented by the JS core. A Wasmtime lane would need that host bridge ported or an appropriate JS host.

### The 80 MiB stack is a deliberate trade-off

**Upstream:** package README and `notes/wasm-build.md` document an 80 MiB shadow stack, selected to tolerate deep-recursion fixtures. The Node worker reserves a separate 256 MB engine stack. These are different stacks; the latter is not another 256 MB of WASM linear memory. Every invocation creates a new instance because compiler process-wide state is not reused and linear memory never shrinks. Multiple instances awaiting collection can therefore consume more than the single-instance figure. A lower shadow-stack build is a separate proposed experiment with a changed supported-depth envelope, not an optimisation justified by this probe.

### Incremental files are available; a retained semantic checker is not available in WASM

**Upstream:** WASM supports `.tsbuildinfo` and output-file feedback between calls, but excludes `--lsp`, `--api` and `--watch`. Native `tsrs/unstable/sync` and `unstable/async` spawn an API process with snapshots and semantic diagnostic methods. The Node API is explicitly unstable and protocol coverage remains incomplete. **Proposed relevance:** native sessions merit a separate investigation for repeated compatibility checks. Neither native LSP nor on-disk incremental metadata establishes R19's token-granular partial-program checker or removes the fresh-instance behaviour of the WASM interface.

### The compatibility evidence is useful, with limits

**Upstream:** `docs/COMPATIBILITY.md` reports strong conformance against a pinned TypeScript commit. `docs/DEFAULTS.md` also records changed checker assignment/history, lazy-member behaviour, extra tsbuildinfo fields and unsupported commands. A stable 100% conformance release remains a goal. Endoforge should compare against the matching official TypeScript commit, not treat another Rust port as an independent authoritative oracle.

**Upstream:** the article describes daily upstream review and compatibility regeneration as the maintenance process to apply. At inspected HEAD, the broad 400-repository conformance automation is documented as disabled and its workflow has a `.bak` suffix. Node API parity automation is also disabled. Core CI conformance and release gates exist; the release workflow says the broader WASM differential gate remains available locally. **Proposed conclusion:** count each actual suite and gate separately. Do not infer that all the advertised future maintenance coverage is already automated or release-blocking. No upstream suites were independently rerun here.

### It changes a checker candidate, not the kernel compiler or trust contract

**Proposed interpretation:** this is relevant to WP22 (TypeScript compatibility lane), WP25/X6 (hosted fit) and possible future R19 checker interfaces. It does not compile TypeScript into Endoforge's strict WASM kernels: the AssemblyScript, MoonBit and Rust kernel routes are separate. It does not settle the JavaScript-hosting gap on the Wasmtime local lane, the correctness of generated capabilities, searched escape rate, real-user acceptance or the economics of the entire model-driven loop. Saving tens of milliseconds per small check is useful but does not establish an end-to-end improvement when model turns dominate.

## Edition 3 alignment and recommendation

**Proposed:** preserve the kernel contract, external evaluator/ledger boundary, pinned tooling identity, process containment and X6's Unproven hosted label. P-05 is still valid evidence for its old pinned build and conditions. P-14 adds a faster alternative with a different memory trade-off; it does not supersede that historical result or promote a production lane.

**Proposed next gates**, in order:

1. Compare tsrs and the matching official TypeScript oracle on Endoforge's actual compatibility corpus, including malformed input, UTF-16, imports, diagnostics, exit statuses and emit. Retain all semantic differences and pin both toolchains and declaration libraries.
2. Measure real platform isolate accounting and cleanup across repeated requests, including bounded concurrent instances and deliberate recursion/size failures. Local workerd's process RSS and its JS-only heap flag cannot establish the platform's WASM enforcement.
3. If the 128 MiB target remains worth pursuing, precommit a separate lower-stack build experiment and measure failures against a declared maximum input depth. Do not infer safety from passing these small inputs.
4. Independently investigate the native persistent API for repeated checks; benchmark total lifecycle and memory, not only a single call. Token-granular decoding remains a separate interface requirement.

## Reproduce

From this directory, run `bash setup.sh` (network setup only), then `node run.mjs`, then `node analyse.mjs`. The runner overwrites current receipt names, so archive receipts before intentionally repeating it. Setup verifies npm tarball integrity and the baseline/new artifacts against the retained hashes. It requires the unchanged local lab baseline and workerd binary. No network is used by the measurement runner beyond its own loopback HTTP endpoint. The complete-arm Node subprocess has a 120 s bound; workerd requests have a 60 s bound. This differs from the precommit's intended per-request 60 s Node bound: Node calls are synchronous and were only bounded at the arm level. No request approached either threshold; maximum observed times are in the receipts. No fault-containment claim follows from those timeouts.

## Open questions

- What does the real platform charge for the mostly reserved shadow stack, and what is peak charged memory during instance turnover?
- Does tsrs preserve all diagnostic/emit behaviour required by the actual compatibility lane against its official pinned oracle?
- What workload size or depth exhausts the available memory or native engine stack?
- Does a native API session reduce end-to-end factory latency enough to justify another trusted interface and retained state?
- Will the announced convergence with tsc-rs retain the current WASM API and improve the stack requirement?

## Sources

- [Cloudflare announcement, 20 October 2026](https://blog.cloudflare.com/typescript-rust-port/).
- [Pinned tsrs source](https://github.com/oxc-project/tsrs/tree/280b426b89cd4ecd6153cf48228826bd60a99c61).
- [WASM package README](https://github.com/oxc-project/tsrs/blob/280b426b89cd4ecd6153cf48228826bd60a99c61/npm/tsrs-wasm/README.md), plus the exact published package README preserved in `receipt/upstream/PACKAGE-README.md`.
- [WASM build notes](https://github.com/oxc-project/tsrs/blob/280b426b89cd4ecd6153cf48228826bd60a99c61/notes/wasm-build.md).
- [Compatibility](https://github.com/oxc-project/tsrs/blob/280b426b89cd4ecd6153cf48228826bd60a99c61/docs/COMPATIBILITY.md), [defaults](https://github.com/oxc-project/tsrs/blob/280b426b89cd4ecd6153cf48228826bd60a99c61/docs/DEFAULTS.md), [native Node API](https://github.com/oxc-project/tsrs/blob/280b426b89cd4ecd6153cf48228826bd60a99c61/docs/NODE_API.md).
- [Release gate definition](https://github.com/oxc-project/tsrs/blob/280b426b89cd4ecd6153cf48228826bd60a99c61/.github/workflows/release.yml); no independent upstream CI execution claimed.
- `../P-05-hosted-fit/RESULT.md`, `../P-05-hosted-fit/gen-overlay.mjs`; old local lab pins copied into `receipt/baseline-pins.json`.
- All local measurements: `receipt/node-{old,new}.json`, `receipt/workerd-{old,new}.json`, `receipt/summary.json`, `receipt/sizes.json`, environment and attempt receipts. Upstream excerpts are pinned by `receipt/upstream.sha256`.
