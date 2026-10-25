# R09 — Unified memory and local reasoning placement

> Reconstructed 2026-10-17. The original R09 was not available; this version is rebuilt from
> Edition 2 (§8, §12, §15), Edition 3 (§10, §13, §14, §15), the white paper (pp. 11, 18, 21), the
> diagram atlas (sheet 08) and the isolate-factory-lab ENVIRONMENT and FASTLOOP documents.
> Content follows Edition 3 where the editions differ.

## Purpose

Edition 2 connected the RAM-resident factory to unified-memory SoCs: reasoning, compilation, evaluation, data and candidate state placed close together on one integrated machine [E2 §12]. Edition 2's own heading is the thesis of this document: a physical fit, not an automatic win. Edition 3 narrows the question to one decision: where should inference run, and is unified memory a deployment lane or a preference [E3 §10, §15]? This document covers placement, the shared-bandwidth budget, capacity versus speed, thermals, zero-copy, the discrete-GPU comparator, decode-speed arithmetic, batched decode, prompt-cache residency, and the design of Edition 3's Experiment 5. No hardware specification is asserted here; capacities, bandwidths and APIs are host-qualification tasks [E2 §12]. Use `docs/templates/HARDWARE-QUALIFICATION.md`.

## Summary

- Placement is proposed: CPU for compilation, semantics, scheduling, WASM and branch-heavy tests; integrated GPU for local inference and large numerical batches; shared host-managed allocations for admitted reusable data; private allocations for candidate state [E2 §12].
- Shared memory means shared demand: B_inference + B_compiler + B_evaluator + B_other ≤ B_sustainable. Overlap can help or hurt; measure both [E2 §12].
- Decode is bandwidth-bound: tokens per second is at most effective bandwidth divided by bytes read per token. Edition 3's estimates are consistent with that bound but imply uneven efficiency across model sizes (**Derived** below).
- Batched decode reads weights once per step for all sequences, so four candidates cost close to one in time. That is the strongest latency argument for unified memory, and it is E3 X5 [E3 §10].
- The only recorded local-model trial (27B GGUF, CPU-only, two threads) failed its deadline. It is evidence of bounded cleanup, not of local inference, and says nothing about unified-memory decode [E3 §14; W p.18].

## 1. Proposed placement

| Resource | Proposed use [E2 §12] |
|---|---|
| CPU | Compilation, semantic work, scheduling, ordinary WASM execution, branch-heavy tests |
| Integrated GPU | Local inference; sufficiently large compatible numerical batches |
| Shared host-managed allocations | Admitted reusable data, where the software stack supports it |
| Private allocations | Candidate state |
| Persistent storage | Accepted artifacts, evidence and checkpoints; not mandatory scratch round trips between operations |

The reasoning model is shared production machinery, not a copy per agent. Its service can be physically local while remaining outside the candidate's trust domain. One physical memory pool does not require one unrestricted address space [E2 §12]. The atlas keeps model service and GPU memory outside the worker group's accounting boundary, to be measured separately [A sheet 08].

Edition 3's local lane is a Wasmtime-based runtime under OS sandboxing, cgroups and an external watchdog, with a native Rust lane beside it; its named hard limits include "memory headroom measured per host" and "unified-memory bandwidth shared with inference" [E3 §13].

## 2. The shared-bandwidth budget

Edition 2's inequality [E2 §12]:

```
B_inference + B_compiler + B_evaluator + B_other ≤ B_sustainable
```

The terms are concurrent demand on one memory system, not guaranteed allocations. Overlapping inference and compilation can raise throughput, or contention can make the combined result worse; the factory must measure both [E2 §12].

**Derived illustration**, using Edition 3's own estimate. A 4-bit 7B model holds about 7 × 10⁹ × 0.5 B = 3.5 GB of weights. At E3's estimated ~100 tokens/s [E3 §10], single-stream decode reads about 3.5 GB × 100 = 350 GB/s, which is about 44% of the 800 GB/s part E3 assumes. Under that estimate, compilation and evaluation share the remaining ~450 GB/s nominal, less whatever the memory system cannot sustain. This is arithmetic on an **Estimated** figure; neither number has been measured on any Endoforge host.

Edition 2 notes the opportunity in the same inequality: reducing compiler traffic may free bandwidth for inference, batching evaluations may reduce bridge overhead, and scheduling may overlap cache-local work with bandwidth-heavy work [E2 §12]. The lab's finding that a tsc-rs check spends about 70% of its time parsing the same lib closure (**Pilot (not a result)**, [`FASTLOOP.md` §3]) is such traffic; retaining it (R06) would lower B_compiler as well as CPU.

## 3. Capacity is not speed

Memory capacity determines what fits, not how fast the loop runs. Model weights, context state, compiler graphs, guest memory, GPU buffers, caches and the host all compete for capacity [E2 §12]. Binary size is not peak RAM [E2 §8; W p.13]. The lab's pilot is a reminder that capacity was not the binding term there: per-worker RSS 340–390 MiB, about 6 GiB at 16 workers on a 125–128 GiB host, and CPU bound first (**Pilot (not a result)**, [`FASTLOOP.md` §8]; host memory per [`ENVIRONMENT.md`]). That host is an x86 desktop with a discrete memory system, not a unified-memory part.

## 4. Thermals and sustained operation

Thermal limits and sustained operating conditions belong in the experiment. A cold burst is not a sustained-production guarantee [E2 §12]. The lab's host shows why recording it matters even on a desktop: Tctl ranged 67–85 °C during noise campaigns and idled at about 73–80 °C, boost clocks depend on temperature and active core count, and the lab recommends recording Tctl per run (**Recorded**, lab receipts, [`ENVIRONMENT.md`]). A fanless or laptop unified-memory machine running inference and compilation together for an hour is a different regime from a ten-second benchmark. Qualification needs a steady-state thermal phase before any measured window (template §4).

## 5. Zero-copy is an interface property

Shared physical memory can avoid some transfers between separate device memories, but allocations still need compatible layout, ownership, synchronisation and lifetime rules. Ordinary WASM does not run on a GPU; accelerated kernels need an appropriate backend and a governed host interface [E2 §12]. Locality does not remove UTF-8/UTF-16 conversions, object construction or WASM-memory copies [E2 §8]. Whether a boundary is zero-copy is an implementation question to test, not an architecture label [E2 §8]. Edition 3 adds the trust constraint: large inputs stay in host-owned buffers reached through handles, and a candidate never receives a pointer into trusted state [E3 §5]. So the zero-copy surface is the host's, not the candidate's.

## 6. The discrete-GPU comparator

An optimised discrete-GPU system can keep data resident instead of uploading it repeatedly, so it is an important comparator. Measure useful output and energy under matched workloads; a packaging label does not decide the outcome [E2 §12]. A unified-memory machine is not an excuse to skip a suitable discrete or cloud comparison [E2 §15]. Edition 3's X5 compares against a hosted stream [E3 §15]; a discrete-GPU arm is a separate comparison that X5 does not include (see Open questions).

## 7. Decode-speed arithmetic

Edition 3's estimates: on the order of 100 tokens/s for a 4-bit 7B model on an 800 GB/s part, 30–40 for a 30B, 15–20 for a 70B (**Estimated** [E3 §10]).

For single-stream decode, each new token reads every weight once, plus the KV cache for the context. So:

```
tokens/s ≤ B_effective / (bytes of weights read per token + KV bytes read per token)
```

**Derived** upper bounds at 800 GB/s, weights only, dense models:

| Model | Bytes at 4.0 bits/weight | Bound | Bytes at ~4.5 bits/weight (quantisation scales) | Bound | E3 estimate | Implied efficiency |
|---|---|---|---|---|---|---|
| 7B | 3.5 GB | 229 tok/s | 3.9 GB | 203 tok/s | ~100 | 44–49% |
| 30B | 15.0 GB | 53 tok/s | 16.9 GB | 47 tok/s | 30–40 | 56–85% |
| 70B | 35.0 GB | 23 tok/s | 39.4 GB | 20 tok/s | 15–20 | 65–98% |

All three E3 estimates sit below the bound, so none is impossible. They are not internally consistent, though: the 7B figure implies under half the bandwidth bound, and the 70B figure up to nearly all of it. If one efficiency applied to all three, either the 7B estimate is conservative or the 30B and 70B estimates are optimistic. E3 labels them estimates; X5 replaces them with a measurement.

Three more qualifications, all background reasoning rather than measurement:

- KV-cache reads add to bytes per token and grow with context length, so long contexts decode slower than the weights-only bound.
- A mixture-of-experts model reads only its active experts per token, so "30B" alone does not set the bound.
- For one sequence, decode is bandwidth-bound; prefill (processing the prompt) is compute-bound. Prompt caching (§9) attacks prefill, not decode.

Edition 3 concludes that local is slower per token than hosted for any model large enough to match hosted quality, and routes short calls (retrieval judgements, criterion drafting, single-diagnostic repairs) local while large generation stays on whichever model has the best yield [E3 §10]. That is **Proposed**.

## 8. The batched-decode argument

Batched decode reads the weights once per step for all sequences, so four candidates cost close to one in time [E3 §10].

**Derived.** For a batch of k sequences, bytes per step ≈ W + k × KV, producing k tokens. While W dominates and the step stays bandwidth-bound, step time is roughly unchanged and throughput rises nearly k-fold. It stops holding when the KV terms grow comparable to W, or when the step becomes compute-bound. That makes batching the natural pairing with E3's parallel candidates: four candidates at 50% yield give a 94% chance that one passes (**Derived** in R05). It also pairs badly with evaluator leaks; candidate width is bounded by discriminating power first (R05).

## 9. Prompt-cache residency

A permanently resident prompt cache turns the SDK context into warm state and cuts time-to-first-token from seconds to tens of milliseconds, three or four times per request (**Estimated** [E3 §10]). Residency costs capacity.

**Derived form.** KV bytes = 2 (K and V) × layers × KV heads × head dimension × bytes per element × tokens. For an illustrative configuration (hypothetical, not a named model) of 32 layers, 8 KV heads, head dimension 128 and 16-bit elements: 2 × 32 × 8 × 128 × 2 = 131,072 B = 128 KiB per token. A 20,000-token SDK context would then hold about 2.4 GiB resident. Real figures depend on the model and on cache quantisation, and must be measured. The point is that residency is a capacity term in §3 and a bandwidth term in §7, not free warm state.

## 10. Experiment 5: the model term

Edition 3's X5 [E3 §15]:

- **Procedure.** One model turn against the actual SDK context with prompt caching. Then four-way batched generation of a 1,000-token kernel on the target unified-memory machine against one hosted stream, with compilation running concurrently.
- **Produces.** The first measured model latency in this project; time to first passing candidate, local versus hosted; bandwidth contention.
- **Decides.** Inference placement, and whether unified memory is a lane or a preference.
- **Kill criterion.** Local batched time-to-pass, yield-adjusted, worse than 1.5× hosted: local inference serves short calls only.

Every recorded number in this project is model-free [E3 §10]. X5 measures the term E3 says has never been measured.

**Derived — what the kill line implies.** Assume (a) hosted single-stream generation takes T_h per attempt with yield p_h, (b) local batched generation takes T_l per step for all four with per-candidate yield p_l, and (c) failures are retried as full regenerations. Expected time to pass is then T_h / p_h hosted and T_l / (1 − (1 − p_l)^4) local. With p_h = p_l = 0.5, local passes the gate when T_l / 0.9375 ≤ 1.5 × T_h / 0.5, that is T_l ≤ 2.81 T_h. Taking E3's estimate that a 1,000-token kernel takes 5–10 s to generate [E3 §2] as T_h, local must finish in about 14–28 s, which is a per-stream decode of about 36–71 tokens/s. Against E3's own estimates, the 7B class (~100 tok/s, ~10 s) clears it, the 30B class (25–33 s) is marginal, and the 70B class (50–67 s) fails. The assumption p_l = p_h is generous to local: a smaller local model is likely to have lower yield. This is arithmetic on estimates; X5 exists to replace it.

The design needs three arms the summary sentence does not spell out: inference alone, compilation and evaluation alone, and the combined loop, followed by concurrency and memory sweeps, with accepted output per unit time and measured total energy as the metric [E2 §12]. Without the alone arms, contention cannot be separated from slowness.

## 11. The recorded 27B CPU-only trial

The only recorded local-model observation: a 27B GGUF model, CPU-only, two threads, loaded in 4.14 s, produced no completed JSON within the 90 s client deadline, peaked at 9.83 GiB, consumed 184.13 CPU-seconds and closed after 94.74 s of whole supervision (**Recorded** [E3 §14; W p.18]).

Correct scope:

- It is evidence that a bounded attempt was supervised, deadlined and cleaned up. That is the claim the record makes [E3 §14; W p.18].
- It is not evidence about model quality, useful local inference, or small-device fit [W p.18].
- It says nothing about unified-memory or GPU decode. It used two CPU threads; 184.13 / 94.74 ≈ 1.94 cores busy (**Derived**), consistent with that configuration and far from any bandwidth bound.
- The quantisation level is not stated in the sources read here, so bytes per token cannot be derived from it.

The white paper's lesson stands: WASM tooling and isolate efficiency do not make model weights disappear, and remote or shared inference has latency, cost, permissions and connectivity that belong in the task budget [W p.18].

## Edition 3 alignment

- **Holds:** placement, the bandwidth inequality, capacity versus speed, thermals, zero-copy as an interface property, the discrete comparator, and the alone/combined/sweep experiment shape [E2 §12].
- **Narrowed:** Edition 3 reduces the unified-memory case to one decision, inference placement, and makes batched decode its strongest argument [E3 §10]. Energy is no longer in the X5 metric; Edition 2's experiment included measured total energy [E2 §12]. Recording energy where instrumentation exists remains good practice.
- **Changed:** the local lane is Wasmtime-based, and unified-memory bandwidth shared with inference is a named hard limit of that lane [E3 §13].
- **Discrepancy noted:** E3's decode estimates imply efficiencies from under 50% to near 100% of the bandwidth bound across model sizes (§7).

## Open questions

- Effective sustainable bandwidth of the target machine, alone and under concurrent compilation. E3 X5; template §3.
- Does a discrete-GPU host with resident data beat the unified-memory host on accepted output per unit energy? Not in X5; needs its own matched arm.
- Local yield versus hosted yield on the same 1,000-token kernel tasks. X5's yield adjustment depends on it.
- Prompt-cache residency cost for the actual SDK context on the chosen model.
- Thermal steady state under combined load on the target machine.

## Sources

- `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt` §8, §12, §15.
- `sources/text/Endoforge-Edition-3.txt` §2, §5, §10, §13, §14, §15.
- `sources/text/In-Isolate-Software-Workshop-v1.txt` pp. 13, 18.
- `sources/text/Diagram-Atlas.txt` sheet 08.
- `~/Work/isolate-factory-lab/docs/ENVIRONMENT.md`.
- `~/Work/isolate-factory-lab-wt/fastloop/docs/FASTLOOP.md` (unmerged branch `feat/fastloop`).
