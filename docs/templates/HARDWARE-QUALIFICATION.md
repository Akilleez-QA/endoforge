# Hardware qualification record — template

> Reconstructed 2026-10-17. The original hardware qualification template was not available; this
> version is rebuilt from Edition 2 (§8, §12, §15, Appendix A), Edition 3 (§9, §10, §13, §15) and the
> isolate-factory-lab ENVIRONMENT, HARNESS and TESTING documents. Content follows Edition 3 where
> the editions differ.

## Purpose

Fill in one copy of this record per host before any experiment that depends on that host's performance, memory or isolation (E3 X4, X5, X6 and any matched campaign). Edition 2 leaves exact capacities, bandwidths, APIs and compatibility to host qualification and asserts no hardware specification [E2 §12]. Edition 3 requires every upstream figure to be rechecked against the exact build and host before the experiment that depends on it [E3 §18]. This record is where that recheck lives.

**Rules for filling it in**

- Every value carries a label: **Recorded** (with a receipt path), **Upstream** (vendor or maintainer figure, with source and date), **Derived** (show arithmetic) or **Estimated**. A vendor datasheet figure is Upstream, never Recorded.
- Pilot or smoke measurements are labelled **Pilot (not a result)** and cannot satisfy a qualification line.
- Record what is *enforced*, not what was *requested*. Probe every control (see §6).
- Write the record and its precommit before the first measured run. Fill measured values only from receipts.
- A record is valid only for the firmware, driver, runtime and kernel versions in §2. Any change re-opens it.

---

## 0. Record identity

| Field | Value |
|---|---|
| Record ID | `HQ-<host>-<YYYYMMDD>` |
| Prepared by / date | |
| Experiments this record serves | e.g. E3 X5; matched campaign C0x |
| Precommit file and sha256 | |
| Receipt directory | |
| Status | draft / qualified / qualified-with-limits / failed |

## 1. Host identity

| Field | Value | Label / source |
|---|---|---|
| Host name and role | local lane / site / hosted comparator / discrete-GPU comparator | |
| Machine class | unified-memory SoC / discrete CPU + discrete GPU / other | |
| CPU model, core and thread counts, SMT state | | |
| Cache and LLC domains (e.g. CCDs) | | |
| Integrated or discrete GPU model | | |
| Memory type, channels, installed capacity | | |
| Usable memory (MemTotal) | | |
| NUMA nodes | | |
| Storage devices relevant to the run | | |
| Power source and profile (mains, battery, platform profile) | | |
| Cooling (fan, fanless, chassis) | | |
| Serial or asset identifier (not a personal identifier) | | |

## 2. Firmware, driver and runtime versions

| Component | Version / hash | How read |
|---|---|---|
| Firmware / BIOS / microcode | | |
| Kernel release and relevant cmdline parameters (not the whole cmdline) | | |
| CPU mitigations, per vulnerability | | |
| Frequency driver, governor, EPP, boost state | | |
| GPU driver and compute stack (e.g. Metal/MLX, ROCm, Vulkan) | | |
| Inference runtime and version | | |
| Model file(s): name, quantisation, sha256, size on disk | | |
| WebAssembly runtime (Wasmtime / V8) and version | | |
| Node / Rust toolchain versions | | |
| Compiler modules under test (e.g. tsc-rs build) and sha256 | | |
| Sandbox tools (bwrap, systemd) and versions | | |
| Clocksource | | |

## 3. Memory capacity and bandwidth

**Capacity**

| Item | Value | Label |
|---|---|---|
| Memory available to the factory after host and OS | | |
| Maximum allocation visible to GPU / shared pool limit | | |
| Model weights resident (bytes) | | |
| Prompt / KV cache resident at the declared context length (bytes) | | |
| Per-worker machinery (RSS, anon/file split) | | |
| Per-active-attempt increment (bytes) | | |
| Headroom at declared concurrency | | Derived |

**Bandwidth** (measured, not datasheet)

| Measurement | Tool and parameters | Result | Label |
|---|---|---|---|
| Datasheet peak bandwidth | vendor source and date | | Upstream |
| CPU streaming read bandwidth, all cores | | | |
| CPU streaming read bandwidth, declared core set | | | |
| GPU streaming read bandwidth | | | |
| Combined CPU + GPU concurrent bandwidth | | | |
| Sustained bandwidth after thermal steady state (§4) | | | |
| Decode bandwidth implied by measured tokens/s × bytes per token | show arithmetic | | Derived |

Check the shared-bandwidth inequality on measured values:
`B_inference + B_compiler + B_evaluator + B_other ≤ B_sustainable` [E2 §12]. Record which term dominates.

## 4. Thermal steady state

| Item | Value |
|---|---|
| Temperature sensor(s) and how read | |
| Idle temperature before the run | |
| Steady-state rule (predeclared, e.g. sensor change < x °C over y min under the combined load) | |
| Time to steady state under: compile/eval alone; inference alone; combined | |
| Steady-state temperature and sustained clocks under each | |
| Throttling events observed (counter or log source) | |
| Sustained versus burst ratio for the primary metric | Derived |

A cold burst is not a sustained-production guarantee [E2 §12]. No measured window opens before the steady-state rule holds.

## 5. Timer resolution and measurement clocks

| Item | Value |
|---|---|
| Harness clock source and resolution (e.g. `hrtime`, `clock_getres`) | |
| Measured minimum observable interval at the harness | |
| Timer resolution exposed to candidate code | |
| Is candidate code denied fine-grained timers? How enforced? | |
| CPU-time source (cgroup `cpu.stat`, schedstat) and its calibration result | |

Edition 3 requires that candidate code never receives fine-grained timers, because isolates in one process are not a side-channel boundary and self-hosted runtimes lack the hosted platform's timer coarsening [E3 §13]. Measurement comes from counters the candidate cannot touch [E3 §9].

## 6. Isolation and control features (probe, do not assume)

| Control | Requested | Enforced? | Evidence (readback, probe) |
|---|---|---|---|
| Memory limit and swap limit | | | |
| Task / pid limit | | | |
| CPU quota (only for calibration; never on timed runs) | | | |
| CPU affinity / exclusive cores (cpuset delegation) | | | |
| I/O accounting (`io.stat`) | | | |
| Network denial (namespace, firewall) | | | |
| Filesystem restriction (read-only binds, no writable mount) | | | |
| Outer sandbox (bwrap, OS sandbox) | | | |
| WASM runtime limits (fuel/epoch, memory maximum, stack) | | | |
| External watchdog able to kill the execution unit | | | |
| Separate processes per trust cohort | | | |
| GPU memory isolation between model service and candidates | | | |

The lab's probes on its desktop found, for example, that cpuset and the io controller were not delegated to user units and that `IPAddressDeny` was accepted but not enforced, while `PrivateNetwork` was [`~/Work/isolate-factory-lab/docs/HARNESS.md`]. That is why every row here is probed on the host being qualified.

## 7. Environment noise and quiet-machine gate

| Item | Value |
|---|---|
| Quiet-gate thresholds (predeclared) | |
| Gate result before each block (pass / refused, reasons) | |
| Ambient load sources and how controlled | |
| Noise baseline: CV and p95/median for compute, allocation and process-start kernels, pinned and unpinned | |
| Minimum detectable effect at the planned n | Derived |
| Sentinel benchmark drift across blocks | |

## 8. Measured loop sweeps: alone and combined

Edition 2's first experiment shape: compilation/evaluation alone, inference alone and the combined loop, then concurrency and memory sweeps [E2 §12]. E3 X5 adds batched generation against a hosted stream with compilation running concurrently [E3 §15].

| Arm | Concurrency / batch | Accepted per wall-s | CPU-s per accepted | Peak and retained memory | Bandwidth | Tokens/s (per stream, aggregate) | Energy (if instrumented) | Temperature | Receipt |
|---|---|---|---|---|---|---|---|---|---|
| Compile + evaluate alone | 1 | | | | | n/a | | | |
| Compile + evaluate alone | sweep: … | | | | | n/a | | | |
| Inference alone, single stream | 1 | n/a | | | | | | | |
| Inference alone, batched | 4 | n/a | | | | | | | |
| Combined loop | 1 + 1 | | | | | | | | |
| Combined loop | 4-way batch + concurrent compile | | | | | | | | |
| Memory sweep (context length, model size) | | | | | | | | | |
| Comparator: hosted stream | 1 | | | | n/a | | n/a | n/a | |
| Comparator: discrete GPU, data resident (where relevant) | | | | | | | | | |

Derived lines to complete:

- Contention factor = combined time / max(alone times), per resource.
- Batched speedup = aggregate tokens/s at batch 4 / single-stream tokens/s.
- X5 gate: local batched time-to-pass, yield-adjusted, ÷ hosted time-to-pass. Kill above 1.5 [E3 §15].

## 9. Qualification verdict

| Question | Answer | Evidence |
|---|---|---|
| Does the declared workload fit with headroom at the declared concurrency? | | |
| Which term binds first: CPU, memory capacity, bandwidth, thermal? | | |
| Are all required isolation controls enforced? List any that are not. | | |
| Is the host quiet enough for the planned minimum detectable effect? | | |
| Lane decision supported (lane / preference / short calls only) | | |
| Limits on any claim made from this host | | |

## 10. Receipts

| Receipt | Path | sha256 |
|---|---|---|
| Precommit | | |
| Environment snapshot before / after | | |
| Controls probe | | |
| Bandwidth runs | | |
| Thermal steady-state runs | | |
| Noise baseline | | |
| Loop sweeps | | |
| Calibration receipt (instruments) | | |
| SHA256SUMS over the set | | |

## Edition 3 alignment

Edition 2 named this template alongside R09 [E2 Appendix A]. Edition 3 adds the timer and side-channel row (§5) [E3 §13], makes the Wasmtime local lane the primary target [E3 §13], and makes inference placement the decision this record most often serves [E3 §10, §15]. Energy remains a column "if instrumented"; X5's metric does not require it [E3 §15].

## Sources

- `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt` §8, §12, §15, Appendix A.
- `sources/text/Endoforge-Edition-3.txt` §9, §10, §13, §15, §18.
- `~/Work/isolate-factory-lab/docs/ENVIRONMENT.md`, `HARNESS.md`, `TESTING.md`.
