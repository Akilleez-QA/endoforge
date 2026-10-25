# R12 — Recorded observations versus missing proof

> Reconstructed 2026-10-17. The original R12 was not available; this version is rebuilt from
> Edition 3 (§2, §5, §9, §14, §17, §18), Edition 2 (§14), the white paper (pp. 12–19, 22–24),
> the diagram atlas (sheets 24–28), the Field OS receipts and specification, and the
> isolate-factory-lab repository and worktrees listed under Sources. Content follows Edition 3
> where the editions differ.

## Purpose

This document lists every number the project has recorded, says exactly where each one comes from, what it was measured on, and what it does not establish. It then checks Edition 3 §14 against the receipts it cites, figure by figure, and reports every mismatch. It adds the state of the 14 October isolate lab, which Edition 3 does not mention, with its pilot numbers labelled as the lab requires. It ends with the Edition 3 list of what the evidence does not establish and the claim ladder as of 17 October 2026. Nothing here was re-measured. Where a receipt was re-verified (hash check or raw-file read) on 17 October 2026, the document says so.

## Summary

- The recorded evidence is one private Field OS adapter on one machine on 8 October 2026: warm guest reuse, a single cold observation per lane, seven contained gateway cases, five recovery methods, a source-bound return trial, and a failed local model request. It is model-free and says nothing about the complete loop [E3 §14].
- Every Edition 3 §14 value matches its receipt. The 24.04 ms denominator of the 27.8× ratio is real: it is the 50 % quota warm shared-VFS median in `FIELD-OS-MAIN-RIG-001-RECEIPT.md` and in the raw run file. Edition 3 never prints that row, though.
- No Field OS value in Edition 3 is wrong. The mismatches (§3) are in substance, wording, labelling, attribution and one Upstream figure. The most consequential: stale outputs are said to be "withheld" when the receipt shows them displayed with a rebind proposal; "about 140×" is Derived but sits in a Recorded row; "tens of megabytes" per QuickJS guest is attributed to §14, which records no per-guest footprint; the Upstream 4.2 MB tsc-rs module size was not reproduced at v0.7.0 by the lab's own build.
- The isolate lab built a full measurement harness, calibration suite and containment matrix, but produced no campaign result. Its receipts are a smoke campaign (pilot), two noise baselines (quiet gate failed), a thread-pool study and a containment smoke matrix. Ten of its twelve pre-campaign must-fix items are unresolved on `main`; six branches are unmerged.
- No rung of the Edition 3 claim ladder above rung 2 has evidence. Rung 2 is recorded only for the replaced guest adapter. Rung 1 has pilot-level lab evidence that Edition 3 does not acknowledge, but not in the intended isolate.

## 1. How to read the tables

Labels follow `CONVENTIONS.md`: **Recorded**, **Upstream**, **Derived**, **Estimated**, **Proposed**, and **Pilot (not a result)**. "Recorded" means a receipt reported it; it does not mean it was rerun. A figure the lab itself calls a smoke or development observation keeps that qualifier.

Paths:
- `FO-REV/` = `~/Work/field-ops-github-review/` (the review checkout; its receipts are byte-identical to commit `58d6826b2ac66d7d7ca7edd2f2e1bd869b5abe18`, checked by SHA-256 on 17 Oct 2026).
- `FO/` = `~/Work/field-ops/` (the device checkout; `docs/receipts/FIELD-OS-MAIN-RIG-001-RECEIPT.md` is byte-identical to the `58d6826` version; its `docs/specs/FIELD-OS-WORKER-FABRIC-V1.md` has later edits, and it has no W3/W4 receipt file).
- `FO-RAW/` = `~/.local/state/fieldops-testbed/runs/` (private raw run directories, read on 17 Oct 2026).
- `LAB/` = `~/Work/isolate-factory-lab/` at `main` = `a95a492` (14 Oct 2026, 18:21 EDT; no later commit on any branch after 18:32 EDT that day).
- `LAB-WT/` = `~/Work/isolate-factory-lab-wt/`.

## 2. Field OS recorded figures (8 October 2026)

All rows are from the Main-rig: Ryzen 9 7950X, 16 cores / 32 threads, about 125 GiB RAM, kernel `7.2.5-3-omarchy`, Node 26.8.1, Python 3.14.7, systemd 261.2, a shared desktop rather than a quiet benchmark host [`FO/docs/specs/FIELD-OS-MAIN-RIG-TEST-BED-V1.md`]. The workload for F01–F11 is the six-case `fuseEngineeringClaims` packet: equivalent and unequal power quantities, repeated source origin, gauge/absolute pressure without an assumed atmosphere, an unavailable source page, and reversed input order. It is synthetic contract data.

### 2.1 Main-rig execution receipt (cold, warm, model)

Source for F01–F11: `FO/docs/receipts/FIELD-OS-MAIN-RIG-001-RECEIPT.md`; raw: `FO-RAW/20261008-mainrig-001/`, `FO-RAW/20261008-mainrig-warm-001/`, `FO-RAW/20261008-mainrig-warm-002/`.

| ID | Observation | Value | Label | Scope | Does not establish |
|---|---|---|---|---|---|
| F01 | Cold lane, native Node, 50 % CPU quota | Whole supervision 178 ms; payload 28 ms; unit CPU 0.050 s; peak 22.61 MiB | Recorded | One cold run; 256 MiB, 32 tasks; raw `payload_duration_ms` 28, `wall_duration_ms` 178 | A distribution; native cost for any other function |
| F02 | Cold lane, Just Bash `js-exec` guest, 50 % quota | Whole supervision 814 ms; payload 669 ms; unit CPU 0.384 s; peak 117.40 MiB | Recorded | One cold run; same profile; output matched the frozen oracle | A distribution; a security-equivalent comparison with F01; any isolate or VM comparison |
| F03 | Warm, preloaded native function, 50 % quota | Median 0.146 ms; sample p95 0.224 ms; unit CPU 0.077 s (25 jobs); peak 29.54 MiB | Recorded | 5 warm-ups + 20 measured jobs; per-job latency excludes host oracle verification | Unthrottled cost; population tails (p95 of 20 samples) |
| F04 | Warm, Just Bash, shared VFS, 50 % quota | Median 24.04 ms; p95 86.22 ms; unit CPU 1.021 s; peak 163.41 MiB; 20 CPU-throttled periods | Recorded | Same protocol; raw `medianMs` 24.042244 in `warm-001/guest-warm.json` (re-read 17 Oct 2026) | Unthrottled guest cost; a stable tail |
| F05 | Warm, preloaded native function, 100 % quota | Median 0.131 ms; p95 0.182 ms; unit CPU 0.073 s; peak 29.96 MiB | Recorded | Same protocol | Cost of any function other than the reviewed one |
| F06 | Warm, Just Bash, shared VFS, 100 % quota | Median 18.64 ms; p95 46.82 ms; unit CPU 1.003 s; peak 150.62 MiB; 9 throttled periods | Recorded | Same protocol; raw median 18.643 ms, n = 20 | Unthrottled ceiling; per-guest memory (the peak is the whole unit: Node, Just Bash, worker pool, QuickJS, startup, warm-up and verification) |
| F07 | Warm, Just Bash, fresh VFS per job, 100 % quota | Median 18.65 ms; p95 40.49 ms; unit CPU 0.995 s; peak 151.93 MiB | Recorded | Same protocol; raw median 18.648 ms | That fresh and shared VFS differ (see D03) |
| F08 | First guest call in the 100 % series | About 260–265 ms | Recorded | One observation before the warm jobs | A cold-start distribution |
| F09 | Deliberate controller failures in the cold run | Sleeping child timed out; a 128 KiB output flood was stopped with at most 64 KiB retained per stream; owned cgroups removed or empty | Recorded | Controller-level native diagnostic streams, not the W1/W2 candidate transport cap | The candidate transport cap (see F12 flood) |
| F10 | Local 27B Ridge GGUF trial, CPU-only, two threads | Loaded in 4.14 s; no completed JSON before the 90 s client deadline; unit peak 9.83 GiB; 184.13 CPU-s; closed after 94.74 s | Recorded (failed criterion) | llama.cpp build 10988; one request; the experiment as a whole is recorded as failed | Model quality; useful local inference; small-device fit |
| F11 | Frozen identities | Shared compiled bundle 51,998 bytes, SHA-256 `a82e3073…4d62231e`; six-case output SHA-256 `1c5facb2…6b1033d` | Recorded | Raw `programSha256` and `expectedOutputSha256` match (re-read 17 Oct 2026) | Independent physical verification of the calculations |

### 2.2 W1/W2 private gateway receipt

Source: `FO-REV/docs/receipts/FIELD-OS-WORKER-FABRIC-W1W2-20261008.md`; private root `FO-RAW/20261008-w1w2-005`; prediction `P-w1w2-frozen-005`.

| ID | Observation | Value | Label | Scope | Does not establish |
|---|---|---|---|---|---|
| F12 | Seven full-gateway cases | Room A `{delta:6}` 937 ms / 125.2 MiB; Room B `{delta:-3}` 923 ms / 124.0 MiB; domain bundle six outputs match 984 ms / 131.1 MiB; guest child denial 925 ms / 125.9 MiB; infinite loop timeout, terminal exhausted 2,389 ms / 134.9 MiB; allocation bomb guest heap exhausted 1,067 ms / 193.2 MiB; output flood external timeout, exhausted 5,230 ms / 140.8 MiB | Recorded | Single fresh-process observations; "whole wall" includes shutdown and scheduling overhead | Latency distributions; a warm-pool comparison; the output-cap threshold (the flood timed out first); time-to-kill |
| F13 | Ledger and replay | 39 events verified on reopen; a historical retry launched no process | Recorded | Private ledger | Physical power-loss survival |
| F14 | Runtime manifest | 557 hashed public files, 166,262,332 bytes; manifest SHA-256 `e8f56819…6d46bbf` | Recorded | Installed closure including Node and shared libraries | Runtime memory; compiler WASM size |
| F15 | Opt-in execution tests | Six tests across seven contained attempts; every owned group removed and empty | Recorded | Fixture authorization journals | Multi-tenant or same-UID hostile security |
| F16 | Focused regressions | 112 tests in 3.142 s: 107 executed passes, 5 skipped opt-in Linux tests | Recorded | Focused scope | A green repository |
| F17 | Broad repository run | **Failed**: 2,106 tests, 17 failures, 325 errors, 259 skips in 90.245 s | Recorded (failed) | Dirty worktree | That residual failures were pre-existing |

### 2.3 W3/W4 return and recovery receipt

Source: `FO-REV/docs/receipts/FIELD-OS-WORKER-FABRIC-W3W4-20261008.md`; private root `FO-RAW/20261008-w3w4-001`.

| ID | Observation | Value | Label | Scope | Does not establish |
|---|---|---|---|---|---|
| F18 | Frozen gateway return (`P-w3w4-return-frozen-001`, precommit `f42c8169…4487557a2`) | All 17 named checks passed in 3.425 s; Room A 947 ms, 127,606,784 bytes peak; Room B 967 ms, 129,310,720 bytes; private ledger 23-event chain valid | Recorded | Two fresh-process samples; arithmetic and documentary interpretation synthetic | A latency distribution; visible Construct delivery; usefulness |
| F19 | Return behaviour | Cross-room projection refused; an **authorized stale** value was displayed with an unsaved rebind proposal; a retired source's payload and pointer withheld; corrupted bytes gave `source_integrity_failure` and no payload; paused authority withheld retained output | Recorded | Fault injection, not an automatic repair feature | Behaviour against a hostile same-UID process |
| F20 | Process recovery (`P-w3w4-native-frozen-002`, precommit `9a80ab23…bc7de47`) | Five Linux methods passed across six controller trials in 9.081 s; six boundaries recorded (five SIGKILL points plus active cancellation); every killed case `unknown`, cancellation `cancelled` only after verified closure | Recorded | Read-only controller boundaries | Every acceptance row; external effects; power loss |
| F21 | Published-checkout suite | 180 tests in 6.898 s: 170 executed passes, 10 explicit Linux skips | Recorded | Main-based published checkout | A broad green (F17 remains failed) |
| F22 | Native containment re-run (`P-w3w4-containment-frozen-001`) | Five pre-existing containment methods plus one fence unit method passed in 12.146 s; seven attempts' groups empty or removed | Recorded | This supervisor | Multi-tenant security |
| F23 | Concurrency defect follow-up | Critic passed 45 related tests and ten repeated concurrency trials after the hardlink-ctime fix | Recorded | Shared-context critic | Independent review |

### 2.4 Derived figures

| ID | Figure | Arithmetic | Label | Does not establish |
|---|---|---|---|---|
| D01 | Cold-to-warm ratio | 669 ms (F02 payload, 50 %) ÷ 24.04 ms (F04 median, 50 %) = 27.83 | Derived | A system or security-equivalent speedup. The operands differ in kind: one cold run including guest start-up, against a median of 20 warm jobs excluding oracle verification [W p.17] |
| D02 | Native versus guest, warm, 100 % | 18.64 ÷ 0.131 = 142.3 | Derived | That native execution is the cheaper boundary for unreviewed code; the native arm has no guest boundary |
| D03 | Fresh versus shared VFS, 100 % | 18.65 − 18.64 = 0.01 ms on rounded medians; raw 18.648 − 18.643 = 0.005 ms | Derived | Any difference; 20 samples per arm cannot resolve it |

### 2.5 Upstream figures carried by the editions

None of these was reverified for this document.

| ID | Figure | Value | Label | Source | Does not establish |
|---|---|---|---|---|---|
| U01 | tsc-rs 0.6.0 native, T3 Code without Effect | TS7 19.45 s; tsc-rs 7.95 s (2.45×); `--fast` 6.91 s (2.81×) | Upstream, 13 Oct 2026 | [W p.12; A sheet 25; E3 §14] | WASM timings; in-isolate timings |
| U02 | Same, with Effect diagnostics | 42.55 s; 14.30 s (2.98×); 9.77 s (4.35×) | Upstream | [W p.12] | As U01 |
| U03 | Six-application geometric means | 2.10× default, 2.90× fast versus TS7; 15.3× and 21.2× versus TS6 | Upstream | [W p.12] | As U01 |
| U04 | `--fast` resource trade | Up to 2.2× CPU time and 1.9× peak memory | Upstream | [W p.12; E3 §14] | Throughput per core in a dense swarm |
| U05 | tsc-rs WASM interface | 4.2 MB module, about 1.8 MB gzip or 1.5 MB Brotli; a 5.2 MB build checks 13–18 % faster; compile once, new instance per check; single-threaded; no watch or language-service mode | Upstream | [W p.13; E3 §14] | A completed integration. **The size is contradicted locally at v0.7.0; see §3, mismatch M7** |
| U06 | Cloudflare Workers limits | 128 MB per isolate including WebAssembly; 10 MB compressed Worker on paid plans; four in-flight Dynamic Workers per request; ten per Durable Object I/O context | Upstream, read 14 Oct 2026 | [E3 §13, §18] | That the compiler, harness and a module instance fit |

## 3. Edition 3 §14 cross-checked against the receipts

| E3 statement | What the receipt says | Verdict |
|---|---|---|
| Warm guest, shared VFS, 100 %: 18.64 ms median, p95 46.82 ms, peak 150.62 MiB; 5 warm-ups + 20 jobs | F06 | Matches |
| Fresh VFS: 18.65 ms, p95 40.49 ms, 151.93 MiB; "the 0.01 ms difference is not statistically meaningful" | F07, D03 | Matches. The 0.01 ms comes from rounded medians; the raw difference is 0.005 ms |
| Preloaded native function: 0.131 ms, 29.96 MiB; "about 140× cheaper to call natively", labelled Recorded | F05; 140× is not in the receipt | **Mismatch (label).** About 140× is Derived (D02 = 142.3), not Recorded |
| Cold lane 50 %: native payload 28 ms vs guest 669 ms; whole supervision 178 ms vs 814 ms | F01, F02 | Matches. Edition 3 does not say each is a single run |
| Cold-to-warm ratio 669 / 24.04 ≈ 27.8×, Derived | 24.04 ms is F04: the warm shared-VFS median at 50 % quota, in the Main-rig receipt's warm table, the white paper [W p.17] and the atlas [A sheet 24]. The raw file `FO-RAW/20261008-mainrig-warm-001/guest-warm.json` gives `medianMs` 24.042244 over 20 samples | **Value found; citation gap.** Edition 3's §14 table omits the 50 % warm rows, so its Derived figure rests on an operand the document never states. 669/24.04 = 27.83. Edition 3 §2 writes "= 27.8×"; §14 writes "≈" |
| Containment: "Infinite loop killed at 2,389 ms; allocation bomb at 1,067 ms; output flood timed out at 5,230 ms before proving the transport cap" | F12. The receipt reports *whole wall*, including shutdown and scheduling overhead; the loop outcome is "Timeout, terminal exhausted"; the bomb is "Guest heap exhausted" | **Mismatch (wording).** "Killed at" reads as a time-to-kill. The values are whole-wall times of single fresh-process cases, and the allocation bomb was exhausted by the guest heap limit, not killed |
| Recovery: five Linux methods across six controller trials in 9.081 s; ambiguous cases unknown, none success | F20 | Matches. Edition 3 §9 separately says "five named recovery boundaries"; the receipt's table has six boundaries (five SIGKILL points plus active cancellation) |
| Source-bound return: 17 checks in 3.425 s; cross-room access refused; "stale, revoked, and corrupt outputs withheld" | F18, F19. Stale output was **displayed** as a qualified value with an unapplied rebind proposal. Retired-source, corrupt and paused-authority outputs were withheld | **Mismatch (substance).** Stale outputs were not withheld. The white paper states it correctly [W p.19] |
| Test scope: 180 tests, 170 passes, 10 Linux skips; broad run failed at 2,106 tests, 17 failures, 325 errors | F17, F21 | Matches (Edition 3 omits the 259 skips and the 6.898 s) |
| Local model trial: 27B GGUF, CPU-only, two threads, loaded 4.14 s, no JSON in 90 s, 9.83 GiB | F10 | Matches |
| tsc-rs native T3 Code 7.95 s vs 19.45 s (2.45×); fast 6.91 s at up to 2.2× CPU and 1.9× memory | U01, U04 | Consistent with the white paper; not reverifiable locally |
| tsc-rs WASM 4.2 MB module, 1.8 MB gzip | U05 versus the lab's own build: at tsc-rs v0.7.0 (commit `3644f32`) the size build is 5,214,613 bytes (gzip 2,212,427; Brotli 1,790,052) and the speed build 6,518,285 bytes (gzip 2,653,873). Neither Rust 1.95.0 nor 1.98.1 reproduced 4.2 MB; the lab attributes the 4.2 MB figure to the earlier revision `144d6e0` [`LAB/docs/CHECKERS.md`] | **Mismatch (Upstream versus Recorded).** The Upstream figure describes an earlier revision. Edition 3 also drops the white paper's "or 1.5 MB Brotli" qualifier |

Mismatches elsewhere in Edition 3 that cite §14:

| E3 location | Statement | Receipt | Verdict |
|---|---|---|---|
| §5 | "a nested QuickJS guest cost tens of megabytes (recorded, Section 14)" | §14 records whole-unit peaks of 117–164 MiB for Node + Just Bash + QuickJS (F02, F04, F06, F07). No receipt isolates a per-guest footprint | **Mismatch (attribution).** "Tens of megabytes per guest" is not recorded. The nearest local figure is the lab's per-active-attempt increment of about 57–81 MiB for one tsc-rs instance plus one capped QuickJS instance, which is **Pilot (not a result)** [`LAB-WT/fastloop/docs/FASTLOOP.md` §8] |
| §15, Experiment 4 | "module footprint against the 150 MiB guest baseline" | F06: 150.62 MiB is the whole-unit peak including startup, warm-up and verification | **Scope caveat.** It is not a per-candidate baseline; Experiment 4 must measure the per-instance increment against a like-for-like guest increment |
| §6 | The six-case fixture's shape is "swapped units, dropped rows, off-by-one, reversed inputs" | The six cases are power-unit equivalence and inequality, repeated origin, gauge versus absolute pressure, an unavailable page, and reversed inputs [F01 scope] | **Mismatch (minor).** Only unit handling and reversed inputs are in the fixture; dropped rows and off-by-one are not |
| §17, rung 1 | "no in-isolate route has been exercised" | The lab ran tsc-rs WASM (v0.7.0 speed build) in a Node `worker_threads` isolate with diagnostic parity to the TS7 oracle on the w-check workloads and validator parity on S-small and S-medium [`LAB/docs/CHECKERS.md`; `LAB-WT/fastloop/docs/FASTLOOP.md` §5] | **Mismatch (omission).** An in-process WASM route has been exercised at development/pilot level. It is not the intended isolate (Wasmtime local lane or a Workers isolate), and it is not a result, so the rung-1 status "Not yet" still stands |
| §18 | Reference numbering R03 runtime guide, R04 Main-rig receipt, R05 W1/W2, R06 W3/W4 | The white paper numbers them R6, R3, R4, R5 respectively [W p.24]; the atlas uses the Edition 3 numbering [A sheets 24, 26] | **Identifier inconsistency.** Cite receipts by file name, not by R-number |
| §14 (omission) | Containment row says the flood did not prove the transport cap | F09: in the cold run, a controller-level 128 KiB flood *was* capped at 64 KiB retained per stream | Not a mismatch: a different layer (native diagnostic streams). Recorded here so it is not lost |

## 4. The isolate lab (14 October 2026)

### 4.1 What was built

The lab (`LAB/`) tests the general in-isolate factory on the Main-rig, with Field OS's testbed as its prior method, not its subject [`LAB/docs/LAB-DESIGN.md`]. Its README still says "Status: under construction. No results yet." On `main` at `a95a492` it contains:

| Component | Path | State |
|---|---|---|
| Campaign harness: arm servers in owned cgroups, precommit, block randomisation, block bootstrap, receipts | `harness/run.mjs`, `harness/arm-server.mjs`, `harness/lib/*.mjs` | Built; runs smoke adapters; real adapters runnable since M6 and N1 were merged |
| Fail-closed spec gate; receipt-set schema; verifier; verified-only report; replication compare | `harness/check-spec.mjs`, `harness/lib/receipt-schema.mjs`, `harness/verify-receipts.mjs`, `harness/report.mjs`, `harness/replicate.mjs` | Built |
| Phase 5 and 6 campaign specs (P1–P12, U1–U5) | `harness/campaigns/*.json` | Written; refused by the spec gate (placeholders and `dependsOn`) |
| Environment control: snapshot, quiet gate, pinning plan, noise baseline | `tools/env-control/` | Built; used by every lab receipt |
| Checkers: TS6-JS in-process, TS7 native (CLI, API), tsc-rs native (CLI, API, fast), tsc-rs WASM (size, speed; caller or worker thread) | `adapters/checkers/` | Built; tsc-rs v0.7.0 built from source at `3644f32` |
| Executors: native-fn, quickjs-fresh, quickjs-bwrap, isolated-vm, worker-threads, workerd, bwrap-process (cold, pool-once, pool-reuse) | `adapters/executors/` | Built |
| Renderer: Playwright Chromium with a fixed library | `adapters/renderers/pw-chromium-fixedlib` | Built |
| Frozen workloads, oracles and evaluator: w-check (small, medium, stress, dos), w-exec, w-search (S-small 120, S-medium 480, M-small 115), w-contain v2, w-ui | `workloads/`, `oracles/`, `evaluator/` | Frozen by tree digest |
| Verification layers L2–L7: conformance, calibration C1–C7, metamorphic and determinism, fault injection, end-to-end | `tests/` | Built |
| Generative-UI hill-climb pipeline | `uihill/` | Built; pilot outputs only |
| Predictions v1.0–v1.5 with prospective amendments | `docs/PREDICTIONS.md` | v1.6 exists only on an unmerged branch |

### 4.2 Receipts and what they show

| Receipt | Where | Label | What it shows | What it does not show |
|---|---|---|---|---|
| `smoke-20261014T200656Z-99f032` | `LAB/receipts/` | **Pilot (not a result)** (the precommit's `label` is `pilot`; calibration `absent`) | The harness pipeline works end to end with three toy arms (`smoke-vm`, `smoke-vm-bwrap`, `smoke-vm-faulty`): precommit before first job, block randomisation, cold and warm modes, a concurrency sweep, an inadmissible arm correctly flagged (`smoke-vm-faulty`: 32 oracle and 32 parity failures). Environment gates refused 12 of 12 blocks; pilots record and continue. `make verify` re-run on 17 Oct 2026: `ok: true`, 35 files, 205 lifetimes, 4,343 samples, precommit SHA-256 `2ecd0312…9133570d6` | Anything about real checkers or executors; its ratios compare toy arms |
| `noise-baseline-2026-10-14` (cpus 2,4) and `-quiet-cores` (cpus 8,10) | `LAB/receipts/` | Recorded (lab claim state OBSERVED); **quiet gate failed in both**, so an upper bound | Run-to-run jitter of fixed js, wasm and alloc kernels, 30 runs per cell. Quiet-core pinned CV: js 2.2 %, wasm 1.6 %, alloc 11.9 %, process wall 4.6 %; MDE at N = 30: 1.7 %, 1.3 %, 9.3 %, 3.6 %. Pinning to the scheduler's preferred cores (2,4) was slower than not pinning | A quiet-machine noise floor |
| `executors-qa-01` | `LAB/receipts/` | Recorded | isolated-vm thread count grows about 3 per lifecycle until a plateau at 41 threads (lifecycle 11 fresh, 33 warm) and stays flat to lifecycle 250: a bounded pool, not a leak | Behaviour beyond 250 lifecycles or on another Node version |
| `w-contain-smoke` (`matrix.json`, `smoke-timing.json`) | `LAB/receipts/` | Recorded as a smoke result; the lab forbids citing it as a P4 or P8 verdict [`LAB/docs/EXECUTORS.md`] | 16 cases × 15 configurations. quickjs-bwrap, workerd with bwrap and cgroup, and all bwrap configs contained every case. In-process V8 child isolates (isolated-vm, worker_threads) did **not** contain `alloc-heap-unbounded` (whole-process blast radius). workerd-bare did not bound off-heap memory or CPU; its limit enforcer is null at the tested version. QuickJS's memory limit is ineffective in the emscripten build; a host-side linear-memory watchdog was added. Smoke timings (n = 30, not pinned, not under the harness): native-fn 0.004 ms; quickjs-fresh 0.475 ms; isolated-vm new Isolate 1.115 ms; worker-threads new Worker 19.95 ms; bwrap-cold 29.36 ms | P4 or P8 verdicts; timings under the harness, pinning or cgroups |
| Calibration `calibration-6366e38abdd814c2.json` (and `-17bc7adf…`) | `LAB/tests/.out/calibration/` (git-ignored, local only) | Recorded (instrument calibration) | On `main` @ `04dfe06`, clean tree, 2026-10-14 21:13Z: C1–C7 all **pass**. C6a rejected 1,081 of 1,081 output mutants with 59 of 59 controls accepted; C6b rejected 1,435 of 1,435. C7 rests on the quiet-cores noise baseline, whose gate failed | A current calibration. The gate requires the measured commit, the same boot and age ≤ 12 h; `main` has moved to `a95a492` and the host has rebooted since |
| An earlier receipt `calibration-c431036b9ca3e4f4` | `LAB-WT/qa/tests/.out/calibration/` | Recorded | Verdict FAIL, only because ts6-js-inproc could not load `lib: ["ES2022"]` (later fixed on `fix/checkers-qa-01`) [`LAB/docs/TESTING.md`] | — |
| `pilot-dryrun-*`, `pilot-s-small-variance-*` | `feat/measure` branch only | **Pilot (not a result)** | See §4.3 | — |
| `make test` on `main` @ `a95a492` | Run 2026-10-17 from this repository; log not retained in the lab | Recorded (software test run, not a measurement) | `node --test` over `harness/test/`, `tools/env-control/test/`, `tests/metamorphic/`, `tests/faults/`, `tests/e2e/`: 92 tests, 90 pass, 0 fail, 2 skipped, 45.7 s, exit 0, Node v26.8.1, shared desktop. The carried-forward machinery (R13) is green at the commit this library cites | Conformance (`make conformance`) and calibration were not run; nothing about performance |

### 4.3 Pilot numbers

Every figure in this table is **Pilot (not a result)**. The lab's own documents say no arm-level CPU, latency or ratio from these runs may be cited as a finding.

| Figure | Value | Source | Why it is not a result |
|---|---|---|---|
| Validator reproduction of the frozen TS7 classification | 120/120 on S-small | `LAB-WT/measure/docs/PILOT-2026-10-14.md` | Dry run; wiring evidence |
| Arms C, B, E-warm on S-small, block 0 | 120 measured each; 0 oracle and 0 parity failures; 12 content-unique (3 behaviour-unique) verified accepts each | same | One of eight blocks; uncalibrated (gate failed: wrong commit, different boot); contended (load 7.7) |
| Share of warm-window CPU spent on `exec-reject` | C 0.976; B 0.995; E-warm 0.944 | same | One lifetime per arm |
| Out-of-cgroup CPU on arm cores, E-warm | 29.4 s, about 35 % of the arm's own CPU | same | Unattributed; contention or coredump helper |
| Steady state | C and E-warm did not converge (cap 360); B converged at sample 220 | same | Confirms critique M10: the rule tracks stream composition |
| Pass-to-pass CV proxy | C 0.116; E-warm 0.130 | same | Within-lifetime proxy, under contention |
| Recommended P6 sample size | 32 blocks (contended upper bound); floor 16 | same | Derived from an upper-bound variance |
| Head-to-head CPU per candidate, S-medium (445), 5 replicate lifetimes | C+ tsc-rs WASM R-stateless 30.23 ms; C+ R-batch 9.93; C+ TS6-JS R-stateless 6.58; TS6-JS R-incremental 5.70; naive C 30.55; B tsc-rs native API + bwrap pool-reuse 6.42; B′ TS7 API + charged TS6 emit 7.76; E-warm 74.44 | `LAB-WT/fastloop/docs/FASTLOOP.md` §0 | Shared desktop (load 3–28), no quiet gate, no CIs, harness front door not used |
| Where a tsc-rs WASM check goes | About 70 % of a solo check (about 18 ms) is parsing and binding the embedded ES2022 lib; tsc-rs WASM cannot retain it | same §3 | Development measurement |
| C+ ablation, naive to C+ | 50.77 ms → 29.61 ms (about 1.7×) in R-stateless; 9.33 ms in R-batch | same §2 | P11 (≥ 3×) "looks contradicted" for tsc-rs, but only a campaign decides |
| Zero filesystem I/O on the C+ hot path | 0 path-based syscalls over 141 candidates (custom seccomp tracer); naive control 176 | same §7 | Development; `io.stat` unavailable |
| Scaling, C+ R-stateless | Speedup 5.18 at M = 8 (efficiency 0.65); 8.63 at M = 16 | same §8 | Shared machine; CPU per candidate rose with M |
| Per active attempt memory | About 57–81 MiB (one tsc-rs instance plus one capped QuickJS) | same §8 | Development |
| UI hill-climb elite/seed pooled-p95 CPU ratio | 0.861 | `LAB/docs/UIHILL-IMPL.md` §2 | Labelled PILOT by the lab |

### 4.4 Unresolved must-fix items

The pre-campaign critique [`LAB/CRITIQUE-2026-10-14-precampaign.md`] found twelve must-fix items at `04dfe06`. Status on `main` at `a95a492`:

| Item | Defect | Status on `main` |
|---|---|---|
| M1 | P6 denominator behaviour-unique, not content-unique; non-marginal exclusion missing | **Partly fixed**: content-unique count merged (`harness/run.mjs`); marginal exclusion not implemented (S-small has no marginal candidates) |
| M2 | Holdout never runs the arm's own emitted artifact | Open; draft on `wip/precampaign-scoped` |
| M3 | `outcome_unknown` scored as a correct reject | Open; draft on `wip/precampaign-scoped` |
| M4 | Harness cannot load S-small; bridge unprotected | Open on `main`; a bridge exists on `fix/precampaign` and `feat/measure` (without marginal flag or pinned libs) and a fuller one on the wip branches |
| M5 | Lib bytes not pinned for w-search | Open; draft on wip branches |
| M6 | Adapter trees with `node_modules` symlinks cannot be digested | **Fixed** (merged in `a95a492`) |
| M7 | P10 contradicted by construction for arm C (intra-arm pipes) | Open; deferred; draft on `wip/precampaign-deferred` (one C4 run failed, not root-caused) |
| M8 | E-warm checker and representative options undeclared | Open; declared only in unmerged PREDICTIONS v1.6; the E-warm adapter does not exist |
| M9 | Helper processes can leave the arm cgroup via `scope` | Open; first half drafted on `wip/precampaign-scoped`, second half on `wip/precampaign-deferred` |
| M10 | Steady-state rule confounded by stream composition | Open; replacement rule drafted in v1.6; the pilot confirmed the defect |
| M11 | Official campaigns not refused on a dirty tree; calibration waivable by spec | Open; drafted in v1.6 |
| M12 | Sweep limits fixed across concurrency | Open; deferred |
| New (18:06) | E-warm/bwrap SIGABRTs run `systemd-coredump` outside the arm cgroup (uncharged CPU) | Open; no draft [`docs/BACKLOG.md` on `wip/precampaign-scoped`] |

Should-fix items S1–S12 are all open on `main`; drafts for S1–S4 and part of S12 exist on `wip/precampaign-deferred`.

### 4.5 The six unmerged branches

| Branch | Head | Ahead / behind `main` | Content |
|---|---|---|---|
| `feat/fastloop` | `f70fa25` | 15 / 7 | The C+ factory library (`factory/`), ablation, head-to-head, zero-I/O tracer, scaling, harness shim; `docs/FASTLOOP.md`. All numbers development/pilot |
| `feat/measure` | `a22ff3f` | 4 / 21 | S-small bridge, pilot specs, pilot analysis, pilot receipts, `docs/PILOT-2026-10-14.md` (incomplete: 1 of 8 blocks) |
| `fix/precampaign` | `9d35a7b` | 1 / 0 | Only the S-small → harness bridge; does not address M4/M5 fully |
| `wip/precampaign-scoped` | `cc9ccfe` | 2 / 7 | Scoped pre-campaign fixes and PREDICTIONS v1.6 (M2–M5, M8, M9 part, M10, M11); `docs/BACKLOG.md` |
| `wip/precampaign-deferred` | `007bcd5` | 3 / 7 | Backup of the full fix set including deferred items (M7, M9 second half, M12, S1–S4); the backlog says cherry-pick, never merge wholesale |
| `fix/uihill-02` | `b119edd` | 6 / 7 | UI hill-climb fixes: one format and one evaluator, render-end trace closure, Chromium `--disable-gpu`, crash relaunch |

### 4.6 What the lab does not establish

No P1–P12 or U1–U5 prediction has been decided. No official campaign has run; no calibration receipt is valid for the current `main`; P6 is not runnable because the E-warm adapter does not exist; every lab receipt was taken on a shared desktop that failed its own quiet gate. The lab is a G = 0 mechanical loop throughout: no model, no user, no hosted platform, no energy.

## 5. What these do not establish

Edition 3 states the list once so no later section can lean on the evidence [E3 §14]. The recorded evidence does not establish:

1. the compiler running inside the intended isolate;
2. any model in the loop;
3. a synthesized evaluator's error rate;
4. an escape rate on seeded faults;
5. a generated capability helping a real person with a real task;
6. a search campaign beating a baseline at equal budget;
7. density or energy on unified-memory hardware;
8. multi-tenant security;
9. physical power-loss survival.

This document adds four items the receipts themselves exclude:

10. per-candidate memory for any guest (only whole-unit peaks are recorded);
11. a latency distribution for any contained or recovery case (all are single fresh-process observations);
12. a broad green test suite (F17 remains failed);
13. useful local inference (F10 failed its criterion).

The only seeded-fault number in the corpus is the lab's C6 calibration: 0 escapes in 1,081 output mutants, so a one-sided 95 % upper bound of 0.28 % (Derived; rule of three gives 3/1,081). It applies to the lab's own w-exec oracle checker against output mutants. It is not Edition 3's escape rate, which seeds faults into candidates and runs the full harness.

## 6. The claim ladder, status 17 October 2026

| Rung | Claim | Kind of result | Edition 3 status | Local evidence note (this document) |
|---|---|---|---|---|
| 1 | A compiler runs inside the workcell | Embedding | Not yet; tsc-rs is an embedding surface and no in-isolate route has been exercised | Not yet in the intended isolate. tsc-rs WASM has run in a Node `worker_threads` isolate in the lab with oracle parity: **Pilot (not a result)** |
| 2 | A candidate module executes bounded, contained and recoverable | Execution | Recorded for the previous guest adapter; not yet for the kernel contract | Recorded: F12, F15, F18–F22. Lab containment matrix is a smoke result. No WebAssembly kernel contract exists |
| 3 | A synthesized evaluator has a measured error rate and a measured escape rate | Specification | Not yet; Experiments 2 and 3 | None. Lab C6 measures an oracle checker against output mutants, not a synthesized evaluator |
| 4 | A generated capability completes a real person's real task | Task | Not yet; no generative UI has been qualified with a user | None. The lab's UI hill-climb is a pilot with no user |
| 5 | A campaign produces more accepted improvement at equal total cost than a baseline | Optimization | Not yet; no campaign has been run | None |
| 6 | Retained capabilities make later requests cheaper over months | Lifetime economics | Not yet; the library does not exist | None |
| 7 | The factory is more effective after accepting changes to its own machinery | Recursive engineering | Not yet; requires rungs 3 and 5 | None |

No rung may stand in for the one above it [E3 §17; E2 §14].

## 7. Probe results (17 October 2026)

Six de-risking probes and one follow-up (P-04b) were run under `experiments/` on the Main-rig (AMD 7950X, 125 GiB, shared desktop at load average 10–27, no quiet gate), each precommitted and hashed before measurement. Every figure here is **Recorded (probe)**: one lifetime, no calibration, no replication. A probe may narrow a design decision; it may not decide an X1–X6 experiment or be cited as a campaign result (`experiments/README.md`). Full receipts and "what this does not show" sections are in each probe's `RESULT.md`.

| Probe | Unknown | Result | What it narrows | What it does not show |
|---|---|---|---|---|
| P-01 kernel-instantiate | Instantiation latency and resident cost of a pure WASM kernel (206-line AssemblyScript reducer, 1,594 B, zero imports) | Instantiate median: V8/Node 26.8.1 **18.6 µs** (p95 34.8), Wasmtime 49.0.3 crate **5.0 µs** (p95 9.2; pooling allocator 4.0). Resident: **≈9 KB (Wasmtime) / ≈12 KB (V8) per live instance** plus touched linear memory (74 KB with one page written; ≈1.03 MiB with 16 pages). `step` call 210–240 ns. Wasmtime CLI cold start 6.0 ms | E3 §5's "well under a millisecond" and "kilobytes to low megabytes" hold by two orders of magnitude; the lab's 150 MiB figure is whole-unit, not per candidate (E3-14) | A kernel with managed objects or imports; density under memory pressure; any host but this one |
| P-02 compiler-in-isolate | Can the AssemblyScript compiler run inside an isolate with no filesystem | asc 0.28.20 with in-memory callbacks inside a Node `worker_threads` isolate, then under bubblewrap with no home, `/etc` or network: **80/80 compiles, 0 real filesystem calls**. Warm compile of a 132–186-line kernel **40–51 ms median**; first compile 190–270 ms; correct diagnostics on 3 broken kernels. Compiler load 290–360 ms; **process RSS plateau ≈480–490 MB** after 20 compiles (binaryen's WASM-memory high-water mark) | Rung 1 for the AssemblyScript route at pilot level: the JavaScript-hosted compiler needs no filesystem. The RSS plateau is the number X6 must confront | The compiler under Wasmtime (E3-10 stands); the `web.js` shim path; memory under a hard limit |
| P-03 escape-rate-method | Does the seeded-fault method work end to end; do disagreement inputs separate survivors | Toy unit-join task, plain-JS reference, three-layer evaluator frozen before any mutant. **381 non-equivalent mutants** (23 equivalents filtered by differential execution over 2,000 inputs). Full-harness escapes **68/381 = 17.8 % (CP 95 % [14.1, 22.1])**; by stratum: mechanical 1.8 %, domain-semantic 4.3 %, model-plausible 30 %. Layer contribution: universal gates only 68.8 % escape; +invariants 35.4 %; +residual 22.6 %; all three 17.8 %. For domain-semantic faults the universal gates killed 0/23 and the invariants 19/23. Disagreement inputs found for 99.4 % of 2,346 pairs, median 1 draw; one answered disagreement frozen as a test killed 58/68 escapees. 4.65 ms per mutant | The method, strata, equivalence filter and Clopper–Pearson reporting work; the invariant layer is where discriminating power comes from (E3 §6); R19 §2.1 works for most but not all escapees. The evaluator must be total over arbitrary output (v1 crashed on mutant output; revised once, both hashes kept) | Endoforge's escape rate (toy task, hand-written and mechanical mutants, not generator errors); the precommitted "searched" stratum degenerated and is reported as such |
| P-04 model-term | The first model turn measured in the project | Hosted Opus 5.5 through the Claude Code CLI (`claude -p`), single turn each, 13/15 runs succeeded (2 hit the CLI's cost budget). wall **median 93.9 s (71.7–123.0 s)**, API time median 86.9 s; output **≈7.2k–13k tokens per turn**, of which thinking 3.8k–9.1k (about half) and visible code 3.2k–5.0k (137–234 lines for a request of "about 100"); **cache-read context ≈453k–468k tokens per turn** carried by the CLI itself, against a 2.6k-token prompt. TTFT to first text 45–59 s (thinking; first stream event at 2.1–3.0 s), visible decode 128–137 tok/s, 92–110 tok/s over the whole turn. Four parallel candidates: wall 91–123 s versus 73–117 s sequential. 13/13 generated kernels passed `asc --noEmit`. Cost $0.26–0.53 per successful turn; **$11.04 total** | E3 §10's "≈1,000 tokens, 5–10 s" does not hold for a CLI-harness turn with thinking on; four-wide parallelism costs about one in wall time through a hosted API; the first-pass *type* gate is not the bottleneck | A bare API turn (the CLI adds its own ~450k-token context); any local arm (no model on disk; not downloaded); the behavioural evaluator |
| P-04b bare-api-model-term | The P-04 prompt with the leanest context the CLI allows (MCP, settings, tools, skills and project context off; empty cwd), by effort and model; the bare API arms were dropped by user decision (subscription only) | 48/48 subscription turns via `claude -p` succeeded, n = 12 per arm. Context **7,173–7,214 tokens per turn** (S1–S3) and **5,070–5,104** with a minimal `--system-prompt` (S4), against P-04's 453k–468k: **≈63–65× less input**. Opus 5.5 default effort: wall **median 90.6 s** (76.8–122.4), 10,007 output tokens (6,447 thinking, 3,532 visible); `--effort low`: **56.4 s** (46.4–68.4), 5,921 tokens (2,306 / 3,510), 12/12 `asc`; Sonnet 5.5: **65.6 s**, 9,090 tokens, 142 tok/s. TTFT to first text 60.6/93.1 s (default), 23.5/40.7 s (low), 48–49 s (Sonnet). Four parallel: batch 69.8–96.5 s. Cache: identical turns read 6,647; a changed last line reads only the ≈2.1k system prompt — no breakpoint inside the user turn. 45/48 kernels pass `asc` (two `load` shadowing errors, one degenerate 21-token turn). `--bare` is key-gated (0/3). List-price shadow $7.83, not billed | P-04's turn time is generation, not harness context: removing ≈460k cached tokens changed wall by ≈3 s. Effort is the lever (−38 % wall, −64 % thinking, same visible code and gate yield). E3 §2's "≈1,000 tokens, 5–10 s" is not met by any arm (closest: 3.5k visible, 56 s). The "warm SDK context" lever through this CLI works only for byte-identical turns. X5's hosted side has two operating points plus a Sonnet comparison | A bare API call (not run: user chose subscription only); prefix reuse across different requests via the API; a quiet machine (load 36 → 4 during the run); the subscription's usage limits; behavioural yield (type gate only); local inference |
| P-05 hosted-fit | tsc-rs WASM + shim + kernel instance under a Workers-like isolate | workerd 2026-09-30 with tsc-rs v0.7.0 size build: diagnostics identical to Node and native. **Process RSS 77 MiB idle → 154 after first check → 183 MiB after the 50-file series; one run peaked at 352 MiB** (deferred collection of old linear memories). Plain Node: 107 → 186 MiB. 50-file check **107 ms in workerd vs 57 ms native single-threaded (1.90×)**, 88 ms in Node (1.55×); 5-file 3.01×. Bundle 2.23 MB gzip. `--max-old-space-size=128` enforced on the JS heap (fatal process OOM); **WASM linear memory not bounded** (256 MiB grow-and-touch succeeded) | X6's latency line (≤3×) is met at 50 files and touched at 5; its memory line (≤128 MiB) is **not met at process level**, and the footprint is tsc-rs-under-V8, not workerd. RISK-02 has a number | Cloudflare's production accounting or enforcement; per-isolate heap (not exposed); a smaller tsc-rs build |
| P-06 bounded-equivalence | Can an AssemblyScript and a Rust kernel of one contract be checked equivalent over a bounded domain | 32 unit/basis combinations × 2²¹ values = **67,108,864 inputs, 0 disagreements, 0.7 s** (≈190 M calls/s pairwise in Node); repeat run identical; BigInt oracle 6.4 M sampled comparisons, 0 wrong. Full i32 range for two combinations: 2 × 4.29 G inputs, 0 disagreements, 42–44 s. Planted rounding fault (truncation for round-half-even) exposed by **26,177,139 of 67,108,864 inputs (39.0 %)**, first at input 1 | R19 §2.4: for refinement with a reference implementation, exhaustive bounded checking replaces the seeded-fault budget; full i32 × 32 combinations is Derived at ≈0.4 h | Symbolic or SMT equivalence (none run); kernels with state or floating point; that two implementations sharing one contract reading share its mistakes |

| X1 dark-factory pilot | Can agents turn real small requests into gated capabilities, and how fast | 20 primary requests from the frozen X1 pool, one fresh agent each: contract + frozen tests → AssemblyScript kernel → fixed gates. **19 promoted with a stated assumption, 1 self-rejected; 20/20 under 600 s (median 95 s, p95 147 s); 18/20 first-run gate passes; 20/20 underdetermined by rater 1, 9/10 by a blind rater.** `campaigns/x1-spec-study/receipt/{factory-summary,summary}.json` | DEC-71; the specification stage for an agent specifier is minutes, not the bottleneck; "capability plus question" is the normal product; evaluator totality includes the test format | Rung 4 (no person used a capability); a registered C01 result (no named author/reviewer); correctness of the contracts beyond self-report and one blind agent |

What the probes change in this document: nothing in §2–§3 (the Field OS receipts stand as recorded) and nothing in §6 (no rung moves: P-01/P-02 are rung-1 and rung-2 evidence at probe level, not under the intended Wasmtime host for the compiler, and not under a campaign). What they change in the plan is recorded in `docs/execution/EXECUTION-PLAN.md`.

## Edition 3 alignment

- **Changed.** Edition 3 drops the white paper's validation arm B (the private Node/QuickJS adapter) as a target and keeps its numbers only as the baseline Experiment 4 must beat [E3 §14]. Edition 2's claim ladder had six rungs; Edition 3 inserts "a synthesized evaluator has a measured error rate and escape rate" as rung 3, giving seven [E2 §14; E3 §17].
- **Superseded.** Any reading of the guest numbers as evidence for the in-isolate workcell. They describe the adapter Edition 3 replaces [E3 §14].
- **Still holds.** Every value in the white paper's recorded tables matches its receipt. The containment and recovery behaviour carries forward unchanged [E3 §9, §14].
- **Not acknowledged by Edition 3.** The isolate lab. Its harness and calibration are carried forward in R13; its pilot numbers stay pilot.

## Open questions

- Should a corrected Edition 3 §14 print the 50 % warm rows so that D01 is self-contained? (Coverage errata; no experiment needed.)
- What is the per-candidate memory of a QuickJS guest, measured as an increment rather than a whole-unit peak? Needed as the baseline for E3 X4 [R14].
- Does the transport cap hold under a flood that reaches it before the deadline? A gateway case with a longer deadline would settle it.
- Can the lab's calibration and campaign gates be made valid again (fix M2–M5, M7–M12, recalibrate at the measured commit) before any lab number is promoted from pilot? [R13 Stage 0]

## Sources

- Edition 3 §2, §5, §6, §9, §14, §15, §17, §18 (`sources/text/Endoforge-Edition-3.txt`).
- Edition 2 §14 (`sources/text/Endoforge-Edition-2-The-Entire-Idea.txt`).
- White paper pp. 12–13, 16–19, 22–24 (`sources/text/In-Isolate-Software-Workshop-v1.txt`).
- Diagram atlas sheets 24–28 (`sources/text/Diagram-Atlas.txt`).
- `~/Work/field-ops/docs/receipts/FIELD-OS-MAIN-RIG-001-RECEIPT.md`; `~/Work/field-ops/docs/specs/FIELD-OS-MAIN-RIG-TEST-BED-V1.md`; `~/Work/field-ops/docs/specs/FIELD-OS-WORKER-FABRIC-V1.md` (§10–12).
- `~/Work/field-ops-github-review/docs/receipts/FIELD-OS-WORKER-FABRIC-V1-DESIGN-RECEIPT.md`, `FIELD-OS-WORKER-FABRIC-W1W2-20261008.md`, `FIELD-OS-WORKER-FABRIC-W3W4-20261008.md` (byte-identical to commit `58d6826`).
- Raw runs read on 17 Oct 2026: `~/.local/state/fieldops-testbed/runs/20261008-mainrig-001/experiment.json`, `20261008-mainrig-warm-001/{guest-warm,native-warm}.json`, `20261008-mainrig-warm-002/{guest-warm,guest-fresh-warm,native-warm,precommit}.json`.
- `~/Work/isolate-factory-lab` at `a95a492`: `README.md`; `docs/LAB-DESIGN.md`, `PREDICTIONS.md`, `END-STATE-AND-TEST-PLAN.md`, `WORKLOADS.md`, `TESTING.md`, `ENVIRONMENT.md`, `EXECUTORS.md`, `CHECKERS.md`, `UIHILL-IMPL.md`, `CRITIQUE-2026-10-14.md`; `CRITIQUE-2026-10-14-precampaign.md`; `receipts/*/summary.*`, `precommit.json`, `matrix.json`, `smoke-timing.json`, `ivm-threads-*.json`; `tests/.out/calibration/*.json`; `git branch --no-merged main`.
- `~/Work/isolate-factory-lab-wt/fastloop/docs/FASTLOOP.md`; `~/Work/isolate-factory-lab-wt/measure/docs/PILOT-2026-10-14.md`; `docs/BACKLOG.md` and `docs/PREDICTIONS.md` on `wip/precampaign-scoped`.
