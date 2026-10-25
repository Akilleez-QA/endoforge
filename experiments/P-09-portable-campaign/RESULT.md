# P-09 portable campaign replay — result

**Complete, 18 October 2026. Recorded (probe).** One shared Linux desktop, one sequential replay per backend; startup has ten warm samples per backend. This is a Docker packaging probe inspired by [TX9](https://github.com/davis7dotsh/tx9), not an installation or validation of TX9.

## Summary

- All 19 complete frozen candidates produced identical gate outcomes, test values and WASM hashes under bubblewrap, Docker and the reloaded image. All 242 tests passed in each replay (57 candidate executions total). The existing gate's `promotable` flag is not a new promotion or evidence of requester usefulness.
- Image save/load retained the image ID. Input archive restore retained every input hash. The restore was to a different directory on this same host.
- Initial generator/evaluator file-view probes passed. An additional request-only evaluator check passed with the generator's contract also absent.
- All 57 replay receipts were captured; source request and candidate files remained unchanged.
- Warm container startup was much slower than bubblewrap startup. Keep bubblewrap for individual atoms; Docker is a viable optional packaging layer under these limited checks.

## What this does not show

No model was called. No credentials, subscription sessions, Executor, TX9 CLI, networked agent, encrypted backup or capability promotion was exercised. This does not test a hostile escape, a nested bubblewrap worker, other machines, architectures, parallel execution, long-lived campaign recovery, fresh generation or the quality changes in DEC-80/DEC-81. The 19 directories are today's complete frozen artefacts, not a fresh or representative sample; they are not the earlier set of 18 delivered capabilities. CC-001 lacked a required input file and was excluded by the precommitted completeness rule.

The image packages the compiler and unchanged gates, not a full live-agent campaign. The role probes are deterministic programs exercising declared file access. They have only request/contract inputs and private scratch; the trusted replay runner separately gets the whole candidate tree. Inputs and image archives are **unencrypted**, local and git-ignored; neither contains agent credentials. They may still contain private request text and must be treated accordingly.

The Docker arm has a one-CPU/512-MiB limit; bubblewrap does not enforce matching resource limits. The Node executable is identical but host/container system libraries differ. Replay times are descriptive and cannot isolate the cost of containerisation. Startup includes the Python subprocess, sudo, Docker client/daemon and container lifecycle, versus Python/bubblewrap lifecycle. Base-image download happened before measurement. No cold-start or statistical confidence claim is made.

## Measurements

Every value in this table is **Recorded (probe)** from `receipt/summary.json`; p95 is nearest-rank, so at n=10 it is the maximum. Unit: milliseconds.

| Operation | n | Median | p95 | Min | Max |
|---|---:|---:|---:|---:|---:|
| Warm bubblewrap `/bin/true` | 10 | 3.31 | 3.87 | 3.11 | 3.87 |
| Warm Docker `/bin/true` | 10 | 449.88 | 522.96 | 434.91 | 522.96 |
| Bubblewrap compile + gates per candidate | 19 | 488.87 | 554.67 | 443.41 | 554.67 |
| Docker compile + gates per candidate | 19 | 1376.32 | 1743.96 | 1067.69 | 1743.96 |
| Reloaded Docker compile + gates per candidate | 19 | 1542.06 | 2709.09 | 1096.76 | 2709.09 |

Image build: 6198.94 ms; save: 675.19 ms; load: 962.36 ms (`receipt/commands.json`). Image archive: 104,060,928 bytes; input archive: 61,403 bytes. Main run elapsed: 80.61 s. These are individual observations, not distributions. Environment, image identity, dependency file hashes and exact commands are retained in the receipts.

## File-view checks and follow-up

`receipt/boundary.json` records non-root execution, readable declared inputs, denial of input/gate write access, private writable scratch, and absent test/kernel files, peer path, real host home, host canary and Docker socket. Network is disabled by Docker configuration. This is targeted visibility evidence, not a general security proof.

Both initial role views included the contract. That establishes filesystem separation but would not implement DEC-80's request-blind evaluator. The additional `request-blind.mjs` check therefore receives **only the request**, with no contract or implementation; it passed. Its command, output, script/input hashes and duration are in `receipt/request-blind-boundary.json`. It was added after the precommitted main run and is reported separately, without changing that precommit or its results. It tests visibility, not eval quality.

## Interpretation and recommendation

**Derived from the startup medians:** 449.88 / 3.31 is approximately 136 times more startup overhead for the Docker invocation in this setup. Actual agent turns were not measured here, so this ratio says nothing about end-to-end model throughput.

**Proposed:** use a pinned container image as an optional campaign toolchain package. Retain the current bubblewrap atom boundary and host-controlled scheduler/gates. Before running bubblewrap inside such an image, separately qualify nested namespaces and resource behaviour; do not add privileged Docker or expose the Docker socket to make nesting work. Keep promotion authority and evaluator inputs outside generator control.

The packaging hypothesis passed this local replay. That justifies retaining the prototype, not replacing the existing runner or diverting loop 2 from the eval corrections. No application branch, campaign gate, frozen candidate, integration or hill-climb was changed.

## Sources and retained artefacts

- `PRECOMMIT.md`, hashed in `receipt/precommit.sha256` before execution.
- `run.py`, `boundary.mjs`: exact main-run scripts; hashes in both environment receipts.
- `receipt/source-manifest.json`, `input-manifest.json`, `bundle-manifest.json`: source, input and toolchain hashes.
- `receipt/bubblewrap/`, `docker/`, `roundtrip/`: all replay outputs, gate results and WASM hashes.
- `receipt/startup.json`, `commands.json`, `toolchain.json`, `image.json`, `env-before.json`, `env-after.json`, `summary.json`.
- Local ignored `work/context/Dockerfile`, `work/image.tar`, `work/inputs.tar.gz`; retained image tags `endoforge-p09:probe` and `endoforge-p09:roundtrip`. No probe containers remain running.

`bash setup.sh` checks the pinned existing compiler and fetches only the digest-pinned base if absent. `bash run.sh` is intentionally one-shot and refuses to overwrite an existing run. To repeat, copy the probe scripts and precommit into a fresh directory immediately under `experiments/`, omit old `work/` and receipts, hash that precommit into `receipt/precommit.sha256`, then run setup and the harness. Retain the new evidence separately. The request-blind follow-up's exact invocation is recorded in its receipt.
