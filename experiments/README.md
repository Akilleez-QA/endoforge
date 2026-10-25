# Experiments: de-risking probes

A probe is a small, self-contained experiment that turns one named unknown into a recorded number on this machine. Probes are not campaigns: they are run once on a shared desktop, without the quiet gate, calibration or replication that a campaign (R14, `docs/templates/CAMPAIGN-PRECOMMIT.md`) requires. Their results are labelled **Recorded (probe)** and may narrow a design decision; they may never be cited as a campaign result or as deciding an X1–X6 experiment.

## Rules

1. **Precommit before run.** `PRECOMMIT.md` states the question, the unknown it de-risks (cite the errata, risk or rung), the exact procedure, the metrics, what would count as a bad sign, and the stop rule. It is written and hashed (`sha256sum PRECOMMIT.md > receipt/precommit.sha256`) before the first measurement.
2. **One directory per probe**, `experiments/P-nn-<slug>/`, containing `PRECOMMIT.md`, the runnable (`run.sh` or `run.mjs`, idempotent, no network after setup), `setup.sh` for dependencies (pinned versions), `receipt/` (raw samples, environment before/after, summary JSON) and `RESULT.md`.
3. **Environment is captured**: kernel, CPU model and count, load average before and after, memory, Node/Rust/tool versions, git commit of this repo, exact module hashes. `receipt/env-before.json` and `env-after.json`.
4. **Raw samples are kept.** Summaries report median, p95, min, max and n. No CI is claimed from a single lifetime.
5. **RESULT.md says what it does not show**, in a section with that name, before any interpretation.
6. **No claim beyond the probe.** A probe that runs the AssemblyScript compiler in a Node worker does not show it runs under Wasmtime; say so.
7. **Dependencies are local** to the probe (`node_modules/`, downloaded binaries under `.tools/`), git-ignored, with versions and hashes recorded in `receipt/`.
8. **Nothing is deleted** from the lab or Field OS checkouts; probes read them only.

## Probes

| Probe | Unknown | De-risks |
|---|---|---|
| P-01 kernel-instantiate | Instantiation latency and resident footprint of a pure WASM kernel under V8 and Wasmtime | E3 §5 claims ("well under a millisecond", "kilobytes to low megabytes"); errata E3-13, E3-14; X4 footprint column |
| P-02 compiler-in-isolate | Can an in-isolate WASM route (AssemblyScript) compile real kernels inside an isolate with no filesystem, and at what cost | Claim-ladder rung 1; E3-10; X4 |
| P-03 escape-rate-method | Does the seeded-fault harness and its statistics work end to end on a toy task; does disagreement-input generation separate survivors | X3 method; R14 §2; R19 §2.1; RISK-10 |
| P-04 model-term | The first measured model turn in the project: hosted (`claude -p`) with and without prompt cache; local if a GGUF and runtime exist | E3 §10 "the one term never measured"; X5; E3-20, E3-25 |
| P-04b bare-api-model-term | P-04 follow-up: the same prompt with the leanest context the CLI allows (MCP, settings, tools, skills, project context off), Opus 5.5 at default and low effort, Sonnet 5.5, minimal system prompt; the bare API arms were dropped (user: subscription only) and `--bare` proved key-gated | WP24a; X5 hosted baseline; P-04 §2 ("a bare API call is a different measurement"); E3-20, E3-25. Result: context 7.2k vs P-04's ≈460k (63–65×), turn time unchanged; effort is the lever |
| P-05 hosted-fit | tsc-rs WASM plus a harness shim plus a module instance under workerd: working set against 128 MB, 50-file check latency against native | X6; RISK-02; E3-24 |
| P-06 bounded-equivalence | Can an AssemblyScript kernel and a Rust kernel of the same contract be checked equivalent over a bounded domain, and how long does it take | R19 §2.4; refinement without a seeded-fault budget |

Results feed `docs/reference/R12` (§7, "Probe results") and the execution plan. They do not change any evidence label in R12 §2–§3.

- `P-07-isolate-cli-turn/`: Claude (tool-less and tool-using) and Codex model turns inside a bubblewrap isolate with a minimal home and only declared mounts; boundary enforced; 7 ms sandbox start (2026-10-17).
- [P-09-portable-campaign](P-09-portable-campaign/RESULT.md): offline Docker packaging replay of 19 frozen candidates, identical gate outcomes and WASM hashes across bubblewrap/container/same-host archive restore; targeted role visibility checks. No model calls or quality campaign. Warm startup medians: Docker 450 ms, bubblewrap 3.3 ms (Recorded (probe), 2026-10-18).
- [P-10-live-workers](P-10-live-workers/RESULT.md): real request-blind evaluator/generator turns, real peer-path denials, 119-case oracle, wrong-candidate rejection and Docker verification continuation. Original orchestration failure preserved; nested bwrap denied.
- [P-11-clean-restore](P-11-clean-restore/RESULT.md): archive-only 19-candidate replay in initially empty private Docker/containerd store, integrity control and owned-runtime cleanup; same host.
- [P-12 lifecycle revision 2](P-12-lifecycle/revision-2/RESULT.md) and [revision 3](P-12-lifecycle/revision-3/RESULT.md): qualified ordinary lifecycle/ownership faults and external reconciliation after actual controller SIGKILL, retry and partial-publication recovery.
- [P-13-rebuild-performance](P-13-rebuild-performance/RESULT.md): fresh dependency reconstruction, offline replay parity and equal-resource workload/launch comparison, including persistent-container exec. Preserved setup failures and amendments.

- [P-14 tsrs hosted fit](P-14-tsrs-hosted-fit/RESULT.md): published tsrs WASM vs pinned tsc-rs on P-05 inputs under Node/workerd; faster checks but higher linear memory, hosted fit still unproven (Recorded (probe), 20 Oct 2026).
