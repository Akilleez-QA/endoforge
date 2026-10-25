# R18 — Source register

> Reconstructed 2026-10-17. The original R18 was not available; this version is rebuilt from
> Edition 3 (§2, §8, §13, §14, §16, §18), Edition 2 (§4, §7, §10–§13, App. B), the white paper
> (pp. 3, 12–15, 24–25), the diagram atlas (sheets 01–30 and its source register), the source package
> of *The In-Isolate Software Factory* (`~/Work/isolate-factory-lab/reference/Isolate_Software_Factory/sources.json`)
> and the isolate-factory-lab records. Content follows Edition 3 where the editions differ.

## Purpose

This register lists every external and repository source that the editions, the white paper, the atlas and the lab cite, with a stable SRC-xx identifier. For each source it records what claim the source supports, when the source documents say it was read, its URL if a source document gives one, and whether it must be rechecked before an Edition 3 experiment relies on it. It also maps the two incompatible numbering schemes the sources use, so that a citation like "U09" can be resolved.

## Summary

- Two receipt and upstream numbering schemes exist. The 25-page white paper uses **R1–R9 / U1–U10**. The 33-page *In-Isolate Software Factory* report, the diagram atlas and Edition 3 use **R01–R11 / U01–U15**. The same number names different sources under the two schemes (for example U4 is the workerd README in the white paper; U04 is Dynamic Workers getting-started in the atlas). Each entry below lists both.
- URL rule: a URL is given only when a source document records it (mostly the Factory report's `sources.json`, also used by the atlas). URLs not recorded in any source are marked "URL not recorded" or, where this reconstruction resolved a canonical project URL on 2026-10-17 and received HTTP 200 (202 for two DOI resolvers), "looked up 2026-10-17". Looked-up URLs are not evidence that the source supports any specific claim.
- Every upstream figure must be rechecked against the exact build and host before the experiment that depends on it [E3 §18]. Status "needs recheck before X#" names the first Edition 3 experiment that relies on the source.
- Two pins conflict in the sources: workerd `9f247e0d…` [A sheet 18; U14] versus `587bab1` [W p.15]. Both are recorded at SRC-37.
- Prior-art sources in Edition 3 §16 are cited by name only. No source document records a read date or URL for them.

## Numbering cross-reference

| SRC | Factory report / atlas / E3 id | White paper id | Short title |
|---|---|---|---|
| SRC-10 | R01 | R1 | Field OS Worker Fabric v1 specification |
| SRC-11 | R02 | R2 | Worker fabric design council |
| SRC-12 | R03 | R6 (guide part) | Worker fabric runtime guide |
| SRC-13 | R04 | R3 | Main-rig execution receipt |
| SRC-14 | R05 | R4 | W1/W2 receipt |
| SRC-15 | R06 | R5 | W3/W4 receipt |
| SRC-16 | R07 | — | Admission and fence implementation |
| SRC-17 | R08 | R8 | Supervised execution implementation |
| SRC-18 | R09 | R7 | Guest bridge implementation |
| SRC-19 | R10 | R6 (gateway part) | Private gateway implementation |
| SRC-20 | R11 | R9 | Operational instrument binding contract |
| SRC-21 | U01 | U1 | ts-rust / tsc-rs README and benchmarks |
| SRC-23 | U02 | U2 | ts-rust WASM interface |
| SRC-24 | — | U3 | ts-rust runtime-independent WASM core |
| SRC-25 | U03 | — | ts-rust benchmark raw JSON |
| SRC-29 | U07 | — | Workers platform limits |
| SRC-30 | U04 | — | Dynamic Workers getting started |
| SRC-31 | U05 | U7 | Dynamic Workers API reference |
| SRC-32 | U06 | — | Dynamic Workers platform limits |
| SRC-33 | U08 | — | Dynamic Workers custom resource limits |
| SRC-34 | U09 | — | Workers performance and timers |
| SRC-35 | U10 | — | Dynamic Workers pricing |
| SRC-36 | U11 | U6 | Cloudflare Code Mode |
| SRC-38 | U12 | U10 | Dynamic Workers Playground |
| SRC-39 | — | U8 | Workers WebAssembly API |
| SRC-40 | — | U9 | Cloudflare Project Think |
| SRC-41 | U13 | U4 | workerd README |
| SRC-37 | U14 | U5 | workerd server / worker-factory source |
| SRC-42 | U15 | — | Dynamic Workers announcement |

Mapping of white-paper R-numbers to the R01–R11 scheme is by matching titles and descriptions [W p.24; A source register; `sources.json`]. Two are approximate: white-paper R6 "Worker fabric runtime guide and gateway" covers both R03 and R10.

## Endoforge source documents

### SRC-01 — Endoforge Edition 3

- **Supports:** the governing architecture.
- **Identity:** `sources/pdf/Endoforge-Edition-3.pdf`, 34 pages, 17 Oct 2026, sha256 `cf141a25…49892a` (`sources/SHA256SUMS`).
- **URL:** not applicable (repository file).
- **Status:** current.

### SRC-02 — Endoforge Edition 2, "The Entire Idea"

- **Supports:** the broad concept narrative.
- **Identity:** `sources/pdf/Endoforge-Edition-2-The-Entire-Idea.pdf`, 29 pages, 16 Oct 2026, sha256 `8604883c…dae9b153`.
- **Status:** current; superseded where Edition 3 differs.

### SRC-03 — The In-Isolate Software Workshop (white paper)

- **Supports:** the original TypeScript/QuickJS workshop design; transcriptions of the Field OS receipts and upstream compiler reports.
- **Identity:** `sources/pdf/In-Isolate-Software-Workshop-v1.pdf`, version 1.0, 25 pages, 14 Oct 2026, sha256 `f8f49017…d16b6bf6`. Uses R1–R9 / U1–U10. Live documentation read 14 Oct 2026 [W p.24].
- **Status:** current as a historical record.

### SRC-04 — Diagram Atlas

- **Supports:** thirty diagram sheets of the original design.
- **Identity:** `sources/pdf/Diagram-Atlas.pdf`, 30 sheets (34 pages per E2 App. B), 14 Oct 2026, sha256 `8c9937dc…e7678e2`. Its source register uses R01–R11 / U01–U14 and points to `SOURCES.md` and `source/sources.json`, which are not in this repository.
- **Status:** current as a historical record.

### SRC-05 — The In-Isolate Software Factory (report package)

- **Supports:** the source register used by the atlas and Edition 3 (R01–R11, U01–U15, with URLs and check dates); the section numbering the isolate lab cites (for example "§19 The decisive benchmark" in `docs/LAB-DESIGN.md`).
- **Identity:** version 1.0, 14 Oct 2026, a 33-page reading edition with its own section numbering. A separate document from SRC-03. Local copies: `~/Work/isolate-factory-lab/reference/Isolate_Software_Factory/` (PDF sha256 `d604984d…17fecc4`) and `~/Downloads/The_In_Isolate_Software_Factory_Package.zip` (sha256 `53f69465…0adce5d`).
- **Note:** Edition 3's edition history does not list this report [E3 §18], although its §18 identifiers come from its register.
- **Status:** current as a historical record.

### SRC-06 — Mononoke source study (M)

- **Supports:** the ledger mechanisms Edition 2 draws on [E2 §3, §7, §10].
- **Identity:** original study dated 16 Oct 2026; nineteen files or ranges inspected at `79071c2a3ea20c36ed71332608535e5801101bba`; prior clone failed; no build or tests [E2 §10, App. B; E3 §18]. The original is lost. A reconstruction is at `docs/studies/mononoke/STUDY.md`.
- **URL:** not recorded (the original studied the source "through the connector" [E2 §10]).
- **Status:** reconstructed; see SRC-49 for the upstream repository.

### SRC-07 — Edition 2 engineering reference library (original R01–R18)

- **Supports:** subsystem detail, the original source register with its EXT-PHY-01 to EXT-PHY-06 identifiers [E2 §11], 32 work packages and 18 campaign records [E2 App. A].
- **Identity:** written in a ChatGPT conversation under `05_Engineering_Reference`; not available [CONVENTIONS].
- **Status:** lost; this repository reconstructs it.

## Field OS repository receipts (private, `Akilleez-QA/field-ops` at `58d6826b2ac66d7d7ca7edd2f2e1bd869b5abe18`, 8 Oct 2026)

URLs below are from `sources.json`. The repository is private; links need access. Local copies of the receipts are under `~/Work/field-ops-github-review/docs/receipts/` and the specification under `~/Work/field-ops/docs/specs/`. None was rerun for Edition 3 [E3 §18]. All are **Recorded** sources for their own scope; none needs a recheck to remain valid as a record, but none supports any claim about the Edition 3 kernel contract.

| SRC | Title | Supports | URL |
|---|---|---|---|
| SRC-10 | R01 Field OS Worker Fabric v1 specification | Architecture, authority, lifecycle, budgets, lineage; design dated 7 Oct 2026 [W p.24] | `https://github.com/Akilleez-QA/field-ops/blob/58d6826b…/docs/specs/FIELD-OS-WORKER-FABRIC-V1.md` |
| SRC-11 | R02 Worker fabric design council | Alternatives and rationale (R16 DEC-01, DEC-02) | `…/docs/research/2026-10-07-worker-fabric-design-council.md` |
| SRC-12 | R03 Worker fabric runtime guide | Private adapter, dependencies, limits; host versions (Python 3.14.7, systemd 261.2, Bubblewrap 0.12.0, Node 26.8.1) [W p.18] | `…/tools/worker-fabric/README.md` |
| SRC-13 | R04 Main-rig execution receipt | Cold and warm tables (incl. 24.04 ms warm shared-VFS median at 50% quota), oracle scope, failed 27B model trial; frozen identities: shared domain bundle 51,998 bytes, sha256 `a82e3073…231e`; six-case output sha256 `1c5facb2…033d` [E3 §14, §18; W pp. 17–18, 24] | `…/docs/receipts/FIELD-OS-MAIN-RIG-001-RECEIPT.md` |
| SRC-14 | R05 W1/W2 receipt | Seven gateway cases, containment, broad-suite failures [E3 §14] | `…/docs/receipts/FIELD-OS-WORKER-FABRIC-W1W2-20261008.md` |
| SRC-15 | R06 W3/W4 receipt | Return and recovery tests, published-checkout scope [E3 §14] | `…/docs/receipts/FIELD-OS-WORKER-FABRIC-W3W4-20261008.md` |
| SRC-16 | R07 Admission and fence implementation | Closed contracts and durable control boundaries | `…/src/fieldops/worker_fabric.py` |
| SRC-17 | R08 Supervised execution and host accounting | Owned execution, cgroup readback | `…/src/fieldops/worker_fabric_execution.py` |
| SRC-18 | R09 Guest bridge | Fresh QuickJS/VFS, removed host ports | `…/tools/worker-fabric/guest-runner.mjs` |
| SRC-19 | R10 Private gateway implementation | Private state, pinned runtime, single-script staging | `…/src/fieldops/worker_fabric_gateway.py` |
| SRC-20 | R11 Operational instrument binding contract | Source and owner identity, typed presentation boundaries | `…/docs/specs/OPERATIONAL-INSTRUMENT-BINDING-V1.md` |

`…` abbreviates `https://github.com/Akilleez-QA/field-ops/blob/58d6826b2ac66d7d7ca7edd2f2e1bd869b5abe18`. Edition 3 §18 lists R01, R03–R09 and R11 and omits R02 and R10.

## Compiler sources

### SRC-21 — ts-rust / tsc-rs README and native benchmarks (U01; W U1)

- **Supports:** native tsc-rs vs TypeScript 7 on T3 Code: 7.95 s vs 19.45 s (2.45×); fast mode 6.91 s at up to 2.2× CPU and 1.9× peak memory; 16 vCPU runners, 13 Oct 2026 (**Upstream**) [E3 §14; W p.12]. Parity claims: tested against ported Go tests and 120 open-source repositories [E3 §8].
- **Read:** 14 Oct 2026 [W p.25; `sources.json`]; Edition 3 "read for this edition" (README as of 13 Oct) [E3 §18].
- **URL:** `https://github.com/pingdotgg/ts-rust/blob/144d6e0f862089df2d2628e9eb0de26a26439c1d/README.md` (`sources.json`).
- **Local check (2026-10-17, lab source clone `~/Work/isolate-factory-lab-cache/ts-rust-src`):** the README's ported-Go-test count is 181,711 at `43bc0ab0` (12 Oct), 184,745 at `a7deaa28` (12 Oct), 184,749 at `a18df3ec` (13 Oct) and at the benchmark pin `144d6e0`, and 184,773 at `3644f324` (v0.7.0, 14 Oct). Edition 3's 181,711 matches only the 12 Oct revision (see errata).
- **Status:** needs recheck before E3 X4 and E3 X6.

### SRC-22 — ts-rust releases

- **Supports:** first public preview 7 Oct 2026; LLM-written Rust port of the TypeScript 7 compiler [E3 §13, §18].
- **Read:** "read for this edition" [E3 §18].
- **URL:** not recorded in the editions. Release-asset pattern `https://github.com/pingdotgg/ts-rust/releases/download/<tag>` appears in the lab's `adapters/checkers/tscrs-native/verify-release.mjs`. Releases page `https://github.com/pingdotgg/ts-rust/releases` looked up 2026-10-17.
- **Local check:** tag `v0.1.0-preview.1` was created 2026-10-06 20:41 -0700, which is 7 Oct in UTC. Tags v0.2.0 to v0.7.0 follow between 9 and 14 Oct. The lab pinned v0.7.0 (`3644f3244d9a93082c69e6691e8b280a0ccc98d0`) and verified release provenance (`isolate-factory-lab/docs/CHECKERS.md`).
- **Status:** needs recheck before E3 X4 and E3 X6 (every bump re-qualifies [E3 §13]).

### SRC-23 — ts-rust WASM interface (U02; W U2)

- **Supports:** 4.2 MB module, about 1.8 MB gzip or 1.5 MB Brotli; compile once, new instance per check; single-threaded; no watch, LSP or API mode; publication disabled [E3 §14, §18; W p.13].
- **Read:** 14 Oct 2026; carried from Edition 2 and not reverified for Edition 3 [E3 §18].
- **URL:** `https://github.com/pingdotgg/ts-rust/blob/144d6e0f862089df2d2628e9eb0de26a26439c1d/npm/wasm/README.md` (`sources.json`).
- **Local check:** the lab built the module at v0.7.0 and measured 5,214,613 bytes (size build, Rust 1.95.0) and 5.17 MB (Rust 1.98.1); neither reproduces 4.2 MB (`isolate-factory-lab/docs/CHECKERS.md`). The lab also ran an incremental regime by carrying an in-memory `.tsbuildinfo` between fresh instances (same file).
- **Status:** needs recheck before E3 X6.

### SRC-24 — ts-rust runtime-independent WASM core (W U3)

- **Supports:** host filesystem bridge, WASI imports, module and instance integration [W pp. 4, 13, 25].
- **Read:** 14 Oct 2026 [W p.24].
- **URL:** not recorded. The Factory register's U03 is a different item (SRC-25).
- **Status:** needs recheck before E3 X6.

### SRC-25 — ts-rust benchmark raw JSON (U03)

- **Supports:** raw evidence linked by SRC-21; the report's tables are transcribed from the README, not recomputed [`sources.json`].
- **URL:** `https://github.com/pingdotgg/ts-rust/blob/144d6e0f862089df2d2628e9eb0de26a26439c1d/docs/benchmarks/2026-10-13-blacksmith.json`.
- **Read:** 14 Oct 2026.
- **Status:** needs recheck before E3 X4.

### SRC-26 — TypeScript 7 (Microsoft native compiler)

- **Supports:** the parity oracle for tsc-rs [E3 §13]; the reference for the 2.45× figure [E3 §2, §14].
- **Read:** not recorded in the editions. The lab pinned TypeScript 7.0.2 as its canonical oracle (`isolate-factory-lab/docs/CHECKERS.md`); the tsc-rs README pins `typescript@7.1.0-dev.20261008.1` as its comparison revision (SRC-21 local clone).
- **URL:** not recorded; `https://github.com/microsoft/typescript-go` looked up 2026-10-17.
- **Status:** needs recheck before E3 X4 and E3 X6 (pin an exact build).

### SRC-27 — TypeScript 6 (JavaScript compiler)

- **Supports:** the lab's in-isolate JavaScript checker arm and its separate parity class (npm `typescript@6.0.3`) (`isolate-factory-lab/docs/CHECKERS.md`). Not cited by the editions.
- **URL:** not recorded.
- **Status:** lab-scoped; no recheck needed for the editions.

## Cloudflare and workerd sources

### SRC-29 — Workers platform limits (U07)

- **Supports:** 128 MB per isolate including WebAssembly allocations; 10 MB compressed Worker size on paid plans (**Upstream**) [E3 §13, §18].
- **Read:** 14 Oct 2026 (`sources.json`); "read for this edition" [E3 §18].
- **URL:** `https://developers.cloudflare.com/workers/platform/limits/`.
- **Status:** needs recheck before E3 X6.

### SRC-30 — Dynamic Workers: getting started (U04)

- **Supports:** runtime loading, supported JS/Python/WASM inputs, TypeScript precompilation [A source register].
- **Read:** 14 Oct 2026; carried, not reverified [E3 §18].
- **URL:** `https://developers.cloudflare.com/dynamic-workers/getting-started/`.
- **Status:** needs recheck before E3 X6.

### SRC-31 — Dynamic Workers API reference (U05; W U7)

- **Supports:** `load()` versus `get(id, callback)`; content identity; warm residency not guaranteed; inherited outbound access unless `globalOutbound: null` [W p.14].
- **Read:** page updated 12 Oct 2026, read 14 Oct [W p.25].
- **URL:** `https://developers.cloudflare.com/dynamic-workers/api-reference/`.
- **Status:** needs recheck before E3 X6.

### SRC-32 — Dynamic Workers platform limits (U06)

- **Supports:** four in-flight Dynamic Workers per request; ten per Durable Object I/O context [E3 §13, §18; A sheet 17].
- **Read:** 14 Oct 2026; carried, not reverified [E3 §18].
- **URL:** `https://developers.cloudflare.com/dynamic-workers/platform/limits/`.
- **Status:** needs recheck before E3 X6.

### SRC-33 — Dynamic Workers custom resource limits (U08)

- **Supports:** CPU and subrequest ceilings; lower limits per invocation [A sheet 17].
- **URL:** `https://developers.cloudflare.com/dynamic-workers/usage/limits/`.
- **Read:** 14 Oct 2026.
- **Status:** needs recheck before E3 X6.

### SRC-34 — Workers performance and timers (U09)

- **Supports:** production timer restrictions; no guest self-measurement [E3 §13, §18; A sheet 17].
- **URL:** `https://developers.cloudflare.com/workers/runtime-apis/performance/`.
- **Read:** 14 Oct 2026; carried [E3 §18].
- **Status:** needs recheck before E3 X6.

### SRC-35 — Dynamic Workers pricing (U10)

- **Supports:** creation, request and CPU billing (Factory report register only).
- **URL:** `https://developers.cloudflare.com/dynamic-workers/pricing/`.
- **Read:** 14 Oct 2026.
- **Status:** needs recheck before E3 X6 (creation cost per candidate).

### SRC-36 — Cloudflare Code Mode (U11; W U6)

- **Supports:** generated programs composing typed tools; experimental status; precedent for keeping deterministic orchestration out of model turns [W pp. 7, 15; E3 §16].
- **URL:** `https://developers.cloudflare.com/agents/tools/codemode/how-it-works/` (`sources.json`).
- **Read:** 14 Oct 2026; carried [E3 §18].
- **Status:** prior art; recheck before citing current behaviour.

### SRC-37 — workerd server / worker-factory source (U14; W U5)

- **Supports:** null isolate and request limit enforcers in the single-tenant policy; self-hosted designs need outer containment [W p.15; A sheet 18; E3 §18].
- **Pins (conflicting):** `9f247e0d5feae1f98ffcee5c9f44a0ded87bb334` [A sheet 18; `sources.json`]; `587bab1` [W p.15]. Edition 3 cites "the pinned server source" without a revision [E3 §18].
- **URL:** `https://github.com/cloudflare/workerd/blob/9f247e0d5feae1f98ffcee5c9f44a0ded87bb334/src/workerd/server/server.c%2B%2B` (`sources.json`). No URL is recorded for `587bab1`.
- **Read:** 14 Oct 2026.
- **Status:** needs recheck before any self-hosted workerd lane; do not generalize to uninspected revisions. The lab pinned workerd 1.20260930.1 (`isolate-factory-lab/docs/EXECUTORS.md`).

### SRC-38 — Dynamic Workers Playground (U12; W U10)

- **Supports:** runtime TypeScript bundling, Dynamic Worker execution and caching; not evidence of full tsc-rs checking [W p.14].
- **URL:** `https://developers.cloudflare.com/dynamic-workers/examples/dynamic-workers-playground/`.
- **Read:** 14 Oct 2026.
- **Status:** prior art; recheck before citing.

### SRC-39 — Workers WebAssembly API (W U8)

- **Supports:** instantiation of precompiled WASM modules only [W p.14].
- **URL:** not recorded.
- **Read:** 14 Oct 2026.
- **Status:** needs recheck before E3 X6.

### SRC-40 — Cloudflare Project Think (W U9)

- **Supports:** durable execution, sub-agents, sessions, dynamic execution, self-authored extensions as prior art [W p.15; E3 §16].
- **URL:** not recorded; `https://blog.cloudflare.com/project-think/` looked up 2026-10-17.
- **Read:** 14 Oct 2026 [W p.25].
- **Status:** prior art; recheck before citing.

### SRC-41 — workerd README (U13; W U4)

- **Supports:** nanoservices sharing a thread and process, capability bindings, and the warning that standalone workerd is not a hardened sandbox [W p.15; E3 §13, §16, §18].
- **URL:** `https://github.com/cloudflare/workerd` (`sources.json`).
- **Read:** 14 Oct 2026; carried [E3 §18].
- **Status:** needs recheck before any self-hosted workerd lane.

### SRC-42 — Cloudflare Dynamic Workers announcement (U15)

- **Supports:** vendor context for isolate startup and footprint claims; not a matched benchmark (Factory register only).
- **URL:** `https://blog.cloudflare.com/dynamic-workers/`.
- **Read:** 14 Oct 2026.
- **Status:** vendor context only.

### SRC-43 — Durable Objects

- **Supports:** ledger option for the hosted lane [E3 §13]; durable-execution prior art [E3 §16].
- **URL:** not recorded; `https://developers.cloudflare.com/durable-objects/` looked up 2026-10-17.
- **Read:** not recorded.
- **Status:** needs recheck before E3 X6.

## WebAssembly runtimes, languages and JavaScript engines

| SRC | Source | Supports | Read | URL | Status |
|---|---|---|---|---|---|
| SRC-44 | Wasmtime | Local lane runtime; Component Model native [E3 §5, §13, §16] | not recorded | not recorded; `https://github.com/bytecodealliance/wasmtime` looked up 2026-10-17 | needs recheck before E3 X4 (pin version) |
| SRC-45 | WebAssembly Component Model / WIT | Intended typed contract across the module boundary; "mature in Wasmtime, polyfilled in V8" [E3 §5]; precedent [E2 §4] | not recorded | not recorded; `https://github.com/WebAssembly/component-model` looked up 2026-10-17 | needs recheck before E3 X4 |
| SRC-46 | Spin | Prior art for per-request fresh instances [E3 §16] | not recorded | not recorded; `https://spinframework.dev/` looked up 2026-10-17 | prior art |
| SRC-47 | AssemblyScript | Candidate default kernel route; JavaScript-hosted compiler [E3 §5]; TypeScript-like direct-WASM route [E2 §4] | not recorded | not recorded; `https://www.assemblyscript.org/` looked up 2026-10-17 | needs recheck before E3 X4 |
| SRC-48 | MoonBit | Second in-isolate route; browser-hosted compiler; GC-based WASM output [E3 §5] | not recorded | not recorded; `https://www.moonbitlang.com/` looked up 2026-10-17 | needs recheck before E3 X4 |
| SRC-50 | Javy | Runtime-backed JavaScript → WASM route [E2 §4]; absent from E3 | not recorded | not recorded; `https://github.com/bytecodealliance/javy` looked up 2026-10-17 | dormant (no E3 route) |
| SRC-51 | QuickJS | The nested guest of the recorded Field OS adapter and of the lab's arm C [W pp. 4, 16; E3 §5, §14]. Lab pin: quickjs-emscripten 0.32.0 (QuickJS 2025-09-13+f1139494), wasm sha256 `105c3bed…2232` (`isolate-factory-lab/docs/EXECUTORS.md`) | not recorded | not recorded; `https://bellard.org/quickjs/` looked up 2026-10-17 | historical (leaves the architecture [E3 §2]) |
| SRC-52 | isolated-vm | Lab arm D child-isolate executor; unbounded-allocation containment failure on Node 26.8.1 (`isolate-factory-lab/docs/PREDICTIONS.md` v1.5) | 14 Oct 2026 (lab) | not recorded; `https://github.com/laverdet/isolated-vm` looked up 2026-10-17 | lab-scoped |

SRC-49 is the Mononoke/Sapling entry below.

## Ledger and source control

### SRC-49 — Mononoke (in facebook/sapling)

- **Supports:** Bonsai changesets, derivation on demand, ephemeral bubbles, sharded maps, conditional publication, the test-only memory-store reclamation warning [E2 §3, §7, §10]; mechanisms, not an embedded dependency [E2 §10].
- **Pin:** `79071c2a3ea20c36ed71332608535e5801101bba`, studied 16 Oct 2026 [E2 §10; E3 §18].
- **URL:** not recorded in the editions; `https://github.com/facebook/sapling/tree/main/eden/mononoke` looked up 2026-10-17. See `docs/studies/mononoke/STUDY.md` for the reconstructed source study.
- **Status:** pinned; recheck only if a new commit is studied.

### SRC-53 — Scion (Anthropic source control)

- **Supports:** the "Scion discussion" that motivated treating source control as a potential bottleneck when machine-generated change volume rises [E2 §10]. Edition 2 did not newly verify Scion availability [E2 App. B].
- **Identity:** Anthropic engineering post "Redesigning source control at Anthropic", published 13 Oct 2026, updated 15 Oct 2026 (as reported by the coordinating agent).
- **URL:** not recorded in the source documents. `https://www.anthropic.com/engineering/redesigning-source-control` was found by search on 2026-10-17 (coordinator). This register does not restate its claims; see `docs/studies/scion/STUDY.md` (being written separately).
- **Disambiguation:** Google has an unrelated multi-agent project also named Scion; it is not this source.
- **Status:** needs recheck (contents being verified in the study).

## Method

### SRC-54 — POODO

- **Supports:** the proposer discipline and precommit record schema Endoforge adopts; repository statements that a passing checker does not demonstrate sound reasoning, that behavioural improvement is unmeasured, and that routine execution is outside its scope [E3 §7, §8, §18].
- **Read:** "read for this edition" [E3 §18].
- **URL:** not recorded in the editions; `https://github.com/Akilleez-QA/poodo` looked up 2026-10-17. A local copy at `~/.claude/skills/poodo` (commit `bbcd8998…`, 2 Oct 2026) contains all three statements (`README.md` lines 31 and 61; `SKILL.md` line 3).
- **Status:** needs recheck before E3 X2 (X2 has POODO synthesize residuals).

## Physical limits (Edition 2 §11; Edition 3 keeps only two consequences)

Edition 2 cites these through the lost reference library as EXT-PHY-01 to EXT-PHY-06 [E2 §11]. Published results; no recheck needed for the physics. Edition 3 states the discussion predicts nothing about the system's performance [E3 §17].

| SRC | Source | Supports | E2 id | URL |
|---|---|---|---|---|
| SRC-55 | Speed of light in vacuum (exact SI value) | ~33 ps/cm, 3.3 ns/m, 3.3 ms/1,000 km propagation floors (**Derived**) [E2 §11] | EXT-PHY-01 | URL not recorded |
| SRC-56 | Landauer, "Irreversibility and heat generation in the computing process", IBM J. Res. Dev. 5(3), 1961 | k_B T ln 2 per erased bit, ≈ 2.87e-21 J at 300 K [E2 §11] | within EXT-PHY-02–04 | not recorded; `https://doi.org/10.1147/rd.53.0183` looked up 2026-10-17 |
| SRC-57 | Margolus and Levitin, "The maximum speed of dynamical evolution", Physica D 120, 1998 | τ ≥ πħ/(2E) for orthogonal-state evolution [E2 §11] | within EXT-PHY-05–06 | not recorded; `https://doi.org/10.1016/S0167-2789(98)00054-2` looked up 2026-10-17 |
| SRC-58 | Lloyd, "Ultimate physical limits to computation", Nature 406, 2000 | ~5.4e50 operations per second for 1 kg, 1 L [E2 §11] | within EXT-PHY-05–06 | not recorded; `https://doi.org/10.1038/35023282` looked up 2026-10-17 |

Reversible and finite-time erasure work is mentioned in E2 §11 (EXT-PHY-02–04) without a named publication; the exact assignment of EXT-PHY identifiers to papers is not recoverable from the available text.

## Prior art cited by Edition 3 §16 and Edition 2

None of these has a read date or URL in the source documents. They support positioning only (**Upstream** context, not evidence about Endoforge). Status for all: prior art; recheck before quoting any specific claim.

| SRC | Source | Cited for | URL |
|---|---|---|---|
| SRC-59 | FunSearch (Romera-Paredes et al., Nature 2023) | LLM-guided evolutionary search works where a cheap exact evaluator exists [E3 §16] | not recorded; `https://www.nature.com/articles/s41586-023-06924-6` looked up 2026-10-17 |
| SRC-60 | AlphaEvolve | Same lineage as SRC-59 [E3 §16] | not recorded; `https://arxiv.org/abs/2506.13131` looked up 2026-10-17 |
| SRC-61 | GenProg (Le Goues et al., IEEE TSE 2012) and genetic improvement | Mutate, evaluate on tests, keep improvements; patches overfit their test suite [E3 §16] | not recorded; `https://doi.org/10.1109/TSE.2011.104` looked up 2026-10-17 |
| SRC-62 | e-graphs and equality saturation (egg) | Representing justified equivalent alternatives [E2 §7] | not recorded; `https://github.com/egraphs-good/egg` looked up 2026-10-17 |
| SRC-63 | Unison | Definitions named by hash [E3 §16] | not recorded; `https://www.unison-lang.org/` looked up 2026-10-17 |
| SRC-64 | Nix | Derived results keyed by all inputs [E3 §16] | not recorded; `https://nixos.org/` looked up 2026-10-17 |
| SRC-65 | Bazel action caches | Derived results keyed by all inputs [E3 §16] | not recorded; `https://bazel.build/` looked up 2026-10-17 |
| SRC-66 | Salsa | Change-proportional re-analysis [E3 §16] | not recorded; `https://github.com/salsa-rs/salsa` looked up 2026-10-17 |
| SRC-67 | rust-analyzer | Same [E3 §16] | not recorded; `https://rust-analyzer.github.io/` looked up 2026-10-17 |
| SRC-68 | tsserver builder | Same [E3 §16] | URL not recorded |
| SRC-69 | Roslyn | Same [E3 §16] | not recorded; `https://github.com/dotnet/roslyn` looked up 2026-10-17 |
| SRC-70 | Temporal | Durable tasks outlive attempts; outcome unknown as first-class state [E3 §16] | not recorded; `https://temporal.io/` looked up 2026-10-17 |
| SRC-71 | DBOS | Same [E3 §16] | not recorded; `https://www.dbos.dev/` looked up 2026-10-17 |
| SRC-72 | Firecracker snapshot restore | Environment setup amortized to roughly 100 ms (unlabelled in E3) [E3 §16] | not recorded; `https://firecracker-microvm.github.io/` looked up 2026-10-17 |
| SRC-73 | E2B | Warm-sandbox baseline the agent substrate must beat [E3 §3, §16] | not recorded; `https://e2b.dev/` looked up 2026-10-17 |
| SRC-74 | Modal | Same [E3 §16] | not recorded; `https://modal.com/` looked up 2026-10-17 |
| SRC-75 | Live programming: Smalltalk, Lisp images, Pharo | The runtime can contain its own compiler and grow while running [E3 §16] | not recorded; `https://pharo.org/` looked up 2026-10-17 (Smalltalk and Lisp: URL not recorded) |
| SRC-76 | Nardi (end-user programming) | People want results, not software [E3 §16] | URL not recorded. The specific work is not named in the sources. |
| SRC-77 | Ko (end-user software engineering) | End users rarely verify; generated artifacts go unmaintained [E3 §16] | URL not recorded. The specific work is not named in the sources. |
| SRC-78 | E (object-capability language) | Capabilities as references [E3 §16] | not recorded; `http://erights.org/` looked up 2026-10-17 |
| SRC-79 | Cap'n Proto | Same [E3 §16] | not recorded; `https://capnproto.org/` looked up 2026-10-17 |
| SRC-80 | Apple MLX/Metal; AMD GPU tooling | Implementation directions for unified-memory placement [E2 §12] | URL not recorded; Edition 2 asserts no current hardware specifications |

## Local evidence

### SRC-81 — isolate-factory-lab

- **Supports:** lab decisions (R16 DEC-15 to DEC-27), lab-scoped risks (R15), pre-registered predictions, critiques, smoke and pilot observations. Lab numbers are **Pilot (not a result)** unless a campaign receipt says otherwise; no official campaign had run when these docs were read.
- **Identity:** `~/Work/isolate-factory-lab` main at `a95a492`; worktrees under `~/Work/isolate-factory-lab-wt/` (notably `fastloop` at `f70fa25`, `measure` at `a22ff3f`, `precampaign-fix` at `9d35a7b`). Read 2026-10-17.
- **Toolchain pins recorded by the lab:** tsc-rs 0.7.0 (`3644f32…`), TypeScript 7.0.2, TypeScript 6.0.3, Rust 1.95.0, quickjs-emscripten 0.32.0, workerd 1.20260930.1, Node 26.8.1 (`docs/CHECKERS.md`, `docs/EXECUTORS.md`, `fastloop/docs/FASTLOOP.md`).
- **Status:** current; re-read before any reference document cites a lab number.

## Edition 3 alignment

- **What changed.** Edition 3 reread only three upstream sources for its edition (ts-rust releases, Workers limits, POODO) and carried the rest from Edition 2 without reverification [E3 §18]. It added the prior-art lineage table [E3 §16] and dropped Javy and Python routes.
- **What is superseded.** The white paper's R1–R9 / U1–U10 numbering is not used by Edition 3; use the SRC-xx identifiers to avoid collisions.
- **What still holds.** The Field OS receipts at `58d6826b…` remain the only recorded evidence [E3 §14].

## Open questions

- Which workerd revision is correct for the null-enforcer observation, `9f247e0d…` or `587bab1`, or were both inspected? (SRC-37.)
- Which works by Nardi and Ko does Edition 3 mean? (SRC-76, SRC-77.)
- Which publications did the lost EXT-PHY-02 to EXT-PHY-06 entries name? (SRC-56 to SRC-58.)
- Does the 4.2 MB WASM module size hold for any pinned revision used by X6? (SRC-23.)

## Sources

- `sources/text/Endoforge-Edition-3.txt` — §2, §5, §8, §13, §14, §16, §18.
- `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt` — §3, §4, §7, §10–§13, App. A–B.
- `sources/text/In-Isolate-Software-Workshop-v1.txt` — pp. 3–4, 12–19, 24–25.
- `sources/text/Diagram-Atlas.txt` — sheets 01–30 and the source register pages.
- `sources/SHA256SUMS`.
- `~/Work/isolate-factory-lab/reference/Isolate_Software_Factory/sources.json` and `README.md`.
- `~/Work/isolate-factory-lab/docs/CHECKERS.md`, `EXECUTORS.md`, `PREDICTIONS.md`; `~/Work/isolate-factory-lab-cache/ts-rust-src` (git history of `README.md`, tags).
- `~/.claude/skills/poodo/README.md`, `SKILL.md`.
- HTTP lookups of canonical project URLs, 2026-10-17 (status codes only).
