# Portable campaign qualification — 18 October 2026

> Written 2026-10-18 from the P-09 audit and P-10 through P-13 execution receipts. This is a probe synthesis, not a production or campaign result.

## Purpose

Close the concrete gaps in the TX9-inspired Docker packaging smoke test without altering its original evidence, installing TX9 or changing the application. Three delegated agents executed live-role, empty-runtime recovery and lifecycle work; the coordinator executed clean dependency reconstruction and equal-resource timing, reviewed the delegated work and checked the retained evidence.

## Summary

- **Recorded (probe):** request-blind Codex evaluation and Claude generation produced a capability passing 11 independent evaluator tests and a 119-case deterministic oracle; a separate Docker continuation verified the exact outputs and rejected the wrong candidate.
- **Recorded (probe):** archive-only recovery in an initially empty private Docker/containerd runtime reproduced 19 candidates / 242 tests and all original WASM hashes.
- **Recorded (probe):** lifecycle, ownership and recovery checks covered ordinary failures, timeout, SIGINT, actual SIGKILL, retry and publication reconciliation without duplicate publication or remaining probe containers.
- **Recorded (probe):** fresh dependencies matched 151 content/symlink entries; a rebuilt offline image reproduced all 19 original candidates. Work medians were about 5 ms in the bounded equal-resource workload, while launch/exec costs differed substantially.
- **Recorded (probe):** nested bubblewrap failed under the restrictive Docker configuration. This topology remains unqualified; no protections were weakened to make it pass.

## Executed evidence

| Gap | Execution and result | Authoritative evidence |
|---|---|---|
| Actual separated model work | Two authenticated model turns; evaluator sees request only; tests frozen before generator. Peer private artefacts exist and real read/write attempts fail. Disposable credential homes removed. | [P-10 result](../../experiments/P-10-live-workers/RESULT.md) |
| Live outputs entering packaged verification | Exact generated code, frozen tests, request/contract and glue passed unchanged Docker G1–G7, identical WASM, 119 oracle checks. Constant-32 negative compiled but failed G4 and was excluded from accepted output. | P-10 `docker-verifications/20261018T190547Z-f60d7353/receipt/summary.json` |
| Recovery without original image cache | Empty image/container inventory and private containerd confirmed before loading; image identity derived from archive content. Corrupted input archive rejected before extraction/execution. Original evidence unchanged. | [P-11 result](../../experiments/P-11-clean-restore/RESULT.md), `receipt/isolated-run/` |
| Controller ownership, safe cleanup and receipt reuse | Revision 2 passed success/nonzero/missing/invalid/timeout/SIGINT/tamper/duplicate/create-failure/start-failure checks; foreign name collision left unrelated fixture untouched; repeat refusal preserved receipts. | [P-12 revision 2](../../experiments/P-12-lifecycle/revision-2/RESULT.md) |
| Hard-killed controller and partial publication | Durable journal precedes create. Supervisor confirmed controller death; reconcile removed token-matching orphan without publishing uncertain output; new-attempt retry succeeded. Existing matching publication recovered without a second link. Invalid journal rejected. | [P-12 revision 3](../../experiments/P-12-lifecycle/revision-3/RESULT.md) |
| Rebuild from fresh dependency state | New empty cache and exact lockfile, scripts disabled, 151 dependency entries match; offline rebuilt image produced identical 19-candidate results and WASM. | [P-13 result](../../experiments/P-13-rebuild-performance/RESULT.md), `attempts/04/receipt/` |

The original live orchestration failed at host-authored metadata: glue ID P10 disagreed with the candidate folder. Its passing verification belongs to separately precommitted continuations with the exact same generated code and frozen suite, not a clean rerun of the original campaign. Preliminary mount, daemon/socket and dependency-setup failures are retained in their respective probes. This distinction matters: successful recovered stages do not erase an operational failure.

## Runtime observations

**Recorded (probe), P-13:** same WASM module, 100,000 calls, ten invocations per arm, one CPU quota and 512 MiB workload memory maximum. Host invocation includes a transient systemd scope; Docker and host system libraries differ. These are shared-desktop observations, not an inference throughput comparison.

| Backend | Host invocation median | Inside-workload median |
|---|---:|---:|
| Fresh host bubblewrap + Node | 43.98 ms | 4.83 ms |
| Fresh Docker + Node | 495.25 ms | 4.83 ms |
| New Node via exec in existing Docker | 77.84 ms | 4.91 ms |

The persistent-container arm still starts a new Node process. It demonstrates lifecycle amortisation, not a persistent in-process agent service. Raw samples and all distribution summaries are in the P-13 receipts.

## Edition 3 alignment

**Proposed operating decision:** retain host bubblewrap for makers, use pinned Docker toolchains for trusted verification and portable frozen artefacts, and keep scheduler, journal and publication authority on the trusted host. P-10's tested connection is host-authenticated workers to Docker verification, not Docker containing bubblewrap or credentialed Docker agents. P-12's API is a qualified prototype, not wired into the existing atomizer or a production supervisor. No new capability was promoted into the application and no hill-climb was resumed.

This preserves the principle that a generator cannot see independent evals or authorise its own promotion. The existing gates still have their prior limits, including G6's timing check; external process deadlines do not create per-call WASM preemption. Nothing here changes the prior quality/promotion claims or validates refrigeration reference data.

## Open questions

- Live hosted-model networking still permits LAN egress. No model-only outbound policy or secret-confidentiality boundary against the authenticated worker is qualified.
- Cross-machine/architecture recovery, encrypted state backups, persistent authenticated sessions and a complete live-campaign checkpoint restore remain untested. P-11 recovers frozen replay state on this host.
- P-12 reconciliation requires an external supervisor to establish controller death. No active-controller lease, daemon-outage handling or power-loss-durable publication transaction is established. Never reconcile a live controller.
- The nested topology failed; a self-contained hybrid image is not supported by these results. No privilege escalation is recommended to bypass that failure.
- Fresh dependency content reproduced, but the installed npm CLI was recorded rather than bootstrapped independently. OCI image bytes were not required to be reproducible. Model-quality rates and concurrent fleet throughput were not measured.

## Sources

The linked probe results, their separately hashed precommits, preserved failed attempts and raw receipts are primary evidence. [P-09 choices audit](../../experiments/P-09-portable-campaign/choices.md) records why these follow-ups were required. `verification/portable-qualification-2026-10-18.json` beside this document records the coordinator's independent receipt/hash and cleanup checks. No production adoption or external service deployment follows from this synthesis.
