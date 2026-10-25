# P-09: portable campaign replay

**Proposed, 18 October 2026.** Does a portable Docker toolchain preserve a frozen X1 replay while enforcing separate generator/evaluator file views? This is a packaging probe inspired by TX9, not a TX9 evaluation or a new quality campaign.

## Procedure (frozen before measurement)

1. Snapshot every current `campaigns/x1-spec-study/work/factory/*` directory containing CONTRACT.md, tests.json, frozen.sha256, kernel.ts and glue.json. Retain their hashes and previous gate outcomes. Never alter those source directories.
2. Package the existing gate and schema unchanged, AssemblyScript 0.28.20 and its existing dependency tree, and Node 22.18.0 in a Docker image based on `node@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e`. Setup may download this base image; all measured runs have network disabled. Record all bundled regular-file hashes and the image ID. No agent logins, tokens or host home enter the bundle.
3. Extract the image's Node executable for the bubblewrap comparison. Replay the same candidates and unchanged gates in bubblewrap and in Docker, sequentially, each with a 90-second process timeout. Record stdout/stderr, exit, results, generated WASM hashes and wall time. Gate failure is data, not a reason to repair candidates. Compare semantic outcomes (including test values, excluding timing) and WASM hashes.
4. Run deterministic generator/evaluator boundary probes, each as a separate non-root, network-disabled container with a read-only root, dropped capabilities, no-new-privileges, a private scratch tmpfs, 1 CPU, 512 MiB RAM, no Docker socket and only role-specific inputs mounted read-only. Require declared input readability, input/gate write denial, absence of peer artefacts, the real host home, host canary and Docker socket. These are targeted checks, not an escape test.
5. Measure ten warm `/bin/true` runs per backend, including the synchronous host invocation (and sudo/Docker client for Docker). No cold-start or campaign speedup claim.
6. Save and reload the image; archive and restore the input tree into a different local directory. Verify all input hashes, replay in the reloaded image, and compare results. This establishes a same-host round trip only. The archive is unencrypted and contains no credentials; it is not a TX9 `.tx9` backup.
7. Capture environment before/after, hashes of runner and precommit, raw samples, median/p95/min/max/n, source immutability, receipt completeness and the exact commands. Clean up only probe-created containers. Retain the tagged image and ignored local archive for review.

## Decision and stop rules

Any role visibility/write failure, source mutation, missing receipt, differing replay result or differing WASM hash is a bad sign and blocks recommending this packaging. Existing candidate gate failures are reported separately. Stop on Docker unavailability, missing pinned dependencies, subprocess timeout, or disk space below 5 GiB. Bound the run to 10 minutes; do not launch models, alter credentials/permissions, install TX9, change gates, promote capabilities or resume hill-climb loop 2.

## Limits

All measurements are **Recorded (probe)** on one shared machine, without replication or a quiet gate. No new generation, eval quality, hostile-kernel isolation, cross-host/architecture restore, encrypted backup, nested bubblewrap, live agent authentication, multi-request scheduling or production readiness is tested. Docker and bubblewrap use the same Node executable but different system libraries. Results do not amend earlier campaign evidence.
