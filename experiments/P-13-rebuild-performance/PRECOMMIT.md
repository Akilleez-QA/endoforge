# P-13: clean dependency reconstruction and bounded runtime comparison

**Proposed, 18 October 2026.** Resolve P-09's reliance on an installed dependency tree, and distinguish fresh-worker launch cost from work inside an already running container. This is a toolchain/overhead probe, not an agent-throughput campaign.

## Frozen procedure

1. Build a new toolchain image from the same digest-pinned Node base as P-09, the P-02 package.json/package-lock.json and unchanged X1 gate/schema only. Install with `npm ci --ignore-scripts --no-audit --no-fund` in an uncached Docker build. Network is allowed only during dependency setup. Do not copy existing node_modules or credentials. Record source hashes, commands, image ID and dependency symlink/content manifests.
2. Compare the reconstructed dependency content with P-09's recorded bundle, excluding npm's generated `.package-lock.json` installation metadata. Recompile and gate the 19 frozen input candidates offline from this image, with 90-second job timeout and recorded semantic results/WASM hashes. Require semantic and WASM parity with P-09. Record any dependency differences rather than claiming reproducibility when they differ.
3. Select one existing small WASM candidate, validate the same function/output in each backend, then time an identical Node script that instantiates the module and calls its first ordinary numeric test 100,000 times. Ten fresh worker invocations in Docker and bubblewrap; both constrained by a transient systemd user scope to one CPU quota and 512 MiB memory, with Docker enforcing the same limits. Record child-reported workload time separately from host invocation time. No quiet-gate or speed confidence claim.
4. Time ten repetitions of the same script via `docker exec` in one persistent, equally constrained, unprivileged, offline, read-only container; preserve start cost separately. This tests lifecycle amortisation, not a live model workload. If transient systemd resource controls are unavailable, report the equal-resource arm unqualified instead of substituting an unmatched comparison.
5. Capture raw outputs, image identity, source hashes, environment, median/p95/min/max/n, and clean up only this probe's named container. Preserve prior receipts and archives. Stop on setup failure, workload mismatch, timeout or <5 GiB free disk. Bound individual commands to 120 seconds, total to ten minutes.

## Acceptance and limits

Clean rebuild passes only if reconstructed dependency contents (apart from explicitly excluded npm metadata), gate semantics and WASM hashes match. Timing observations do not adopt a topology. Record a missing resource-control facility as a limitation, not evidence that either backend is slower. No models, credentials, app merges, new capability promotions or hill-climb changes. All results are **Recorded (probe)** on this shared desktop. This does not test cross-architecture recovery, hostile escape, inference throughput or production readiness.
