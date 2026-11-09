# Limitations and safe use

EndoForge is research software. Coding agents build software in it, and it records whether that software passed the
checks frozen before the code existed. This page says what such a result does and does not tell you, and where the
system's own limits are. Each limit links to the requirement, test or experiment that shows it.

## What a promotion means

A promotion means that every gate (G1–G9) passed for the exact compiled bytes of the candidate, under the exact frozen
evaluator, in both evaluator rounds, with a verified hash chain (REQ-PROMOTE-001). It does not mean the code is right
for every input.

- **The tests decide, and a model wrote them.** On the agent path the same model writes the tests and then the code,
  in one conversation. Freezing stops it from editing the tests after it sees a failure. It does not stop it from
  writing weak tests, or from reading the need the same wrong way twice. Code can pass the frozen tests and still be
  wrong on inputs they do not cover. [P-51](../../../experiments/P-51-escape-rate/RESULT.md) and
  [P-52](../../../experiments/P-52-real-gates/RESULT.md) measured this by seeding faults into promoted candidates: with
  P-52's gates, 280 of 7,883 broken candidates (3.6%) still passed.
- **The independent checks are opt-in.** Evaluator synthesis (a check written by a model that has seen no candidate)
  and the formula oracle add evidence the coding agent did not produce. Both are off by default. Synthesis runs on every loop path
  when turned on and judges in a bounded worker thread; when two of its references agree against a frozen test, the
  test is corrected as a ledger revision before any code, and the implementation turn reads the corrected tests on
  every path. Synthesized vectors also cover exports over records, lists and text, with inputs generated from the
  layout the binding declares for each structured parameter; where the binding declares none, such a parameter is
  varied only over the frozen tests' values. The oracle missed its adoption bars in
  [P-71](../../../experiments/P-71-oracle-round2/RESULT.md).
- **A promotion is not an approval.** It is not an engineering, safety or regulatory sign-off. Before you rely on
  promoted code for such a decision, check it against an authoritative source. EndoForge is not safety-critical
  software ([SMP §1](../../plan/software-management-plan.md#1-software-classification-self-assessed)).

## What the candidate form covers

The nine gates check one candidate form: a WebAssembly kernel plus `glue.json`, which declares each input's and
output's kind and unit. Inputs and outputs are scalars or structured state (records, lists and text in a declared memory
layout), so a kernel can take state and an event and return the next state. The ledger's evidence re-check at commit
compares structured values field by field against the declared layout. The stage prompts ask for the kernel in AssemblyScript. Code that does not fit that split goes
through the TypeScript compatibility lane, where a WebAssembly build of the TypeScript 7 checker type checks it and the
emitted JavaScript runs twice in a contained V8 process. That lane has its own checks
([contained JavaScript](../../../core/runtime/README.md#contained-javascript)); the G1–G9 gates do not apply to it.

## What the tests show

The repository tests use synthetic inputs and test doubles in place of model clients. They show how the code behaves.
They do not qualify a live model service or an external host, and they were written by the code's authors, not by an
independent reviewer. A run marked `testDouble: true` shows the machinery works and says nothing about a real model.
Some tests need the host to provide something and skip with their reason when it doesn't. The campaign transfer to a
real second host runs only when `ENDOFORGE_SECOND_HOST` is set: it passed against a separate machine on 2026-11-09 and
skips in CI. The sandboxed factory-worker tests need `bwrap` and a systemd user manager.

## Isolation limits

The workcells are V8 isolates chosen for speed, concurrency and low memory use. They are not an operating-system
sandbox.

- Thread workcells do not bound memory outside the JavaScript heap (ArrayBuffer, Buffer, Blob, the sum of WebAssembly
  memories). Use process isolation with a delegated cgroup for that (REQ-ISO-013).
- `terminate` cannot interrupt a thread workcell stuck in a blocking native call
  (`core/runtime/test/isolate-deadline.test.mjs`).
- Delegated cgroup enforcement is tested only where a delegated user scope exists (REQ-ISO-018); the test skips with
  its reason elsewhere, and its result on the GitHub runner is not recorded.
- Process cells, cgroups and bubblewrap assume Linux. The capacity probe also reads macOS counters, but CI runs the
  suite only on Linux.

## The ledger

The ledger is append-only and hash-chained, so an edited record breaks the chain and is detected. It is not a
signature: someone who rewrites the whole file can build a new valid chain.

## Model access

Claude Code must be signed in with a claude.ai subscription; an API-key or other provider configuration is refused with
exit 78 (REQ-SUB-001). Near the weekly usage ceiling, new calls park with exit 75 (REQ-GOV-001). A parked or lost call
is an unknown outcome: never a pass, and never a failed candidate.

## Project limits

One maintainer reviews and merges every change; there is no independent review. There are no releases, interfaces may
change, and only the latest `main` is supported ([SECURITY.md](../../../SECURITY.md)). Untested behaviour is listed in
[SRS §11](../../requirements/requirements.md#11-untested-behaviour-requirement-gaps).
