# Limitations and safe use

EndoForge is research software. This page states what a result from it does and does not mean. Each limit links to the
requirement, test or experiment that shows it.

## What a promotion means

A promotion means every gate (G1–G9) passed for the exact candidate bytes under the exact frozen evaluator, with a
verified hash chain (REQ-PROMOTE-001). It does not mean the kernel is correct for every input:

- The frozen tests are written by a model from the need. A kernel can pass them and still be wrong on inputs they do
  not cover. [P-51](../../../experiments/P-51-escape-rate/RESULT.md) and [P-52](../../../experiments/P-52-real-gates/RESULT.md)
  measured such escapes.
- Evaluator synthesis and the formula oracle add independent checks, but both are off by default. The oracle missed its
  adoption bars in [P-71](../../../experiments/P-71-oracle-round2/RESULT.md).
- A promotion is not an engineering, safety or regulatory approval. If you use a promoted kernel in such a decision,
  verify it against an authoritative source first. EndoForge is not safety-critical software
  ([SMP §1](../../plan/software-management-plan.md#1-software-classification-self-assessed)).

## What the tests show

The repository tests use synthetic inputs and test doubles for model clients. They show the code's behaviour; they do
not qualify a live model service or an external host. They are written by the code's authors, not by an independent
reviewer.

## Isolation limits

- Thread workcells do not bound off-heap memory (ArrayBuffer, Buffer, Blob, the sum of WebAssembly memories). Use
  process isolation with a delegated cgroup for that (REQ-ISO-013).
- A thread workcell in a blocking native call cannot be interrupted by `terminate`
  (`core/runtime/test/isolate-deadline.test.mjs`).
- Delegated cgroup enforcement is not tested locally or in CI (GAP-EF-001).
- Process cells, cgroups and bubblewrap assume Linux. The capacity probe also reads macOS counters, but the suite runs
  only on Linux in CI.

## Model access

Model calls must use a claude.ai subscription login; any API-key or provider configuration is refused with exit 78
(REQ-SUB-001). Near the weekly usage ceiling new calls park with exit 75 (REQ-GOV-001). A parked or lost call is an
unknown outcome, never a pass and never a failed candidate.

## Project limits

One maintainer reviews and merges every change; there is no independent review. Interfaces may change, and only the
latest `main` is supported ([SECURITY.md](../../../SECURITY.md)). Untested behaviour is listed in
[SRS §11](../../requirements/requirements.md#11-untested-behaviour-requirement-gaps).
