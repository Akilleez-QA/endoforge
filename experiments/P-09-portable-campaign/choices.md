# P-09 choices audit — 18 October 2026

Decision audit of this chat's TX9 research and P-09 implementation, following the audit-choices skill. No runner, test, result, frozen input or build state was changed during this audit. This ledger is the only added artefact. Confidence means confidence the owner would have made the same choice, not confidence that the observation is true.

Review these first: substituting offline replay for a live campaign; using a daemon that already held the image for restore validation; treating a client-process timeout as sufficient container lifecycle control. The completed measurements remain valid within their documented narrow scope.

## Unsound choices and corrected decisions

### U1 — Treat the reduced replay as sufficient to close the campaign-environment question

- **When:** P-09 design and final handback.
- **Choice:** After the owner accepted a portable campaign probe, I used already-written kernels and deterministic file checks. A real request arriving in Endoforge would require an authenticated generator, an independent evaluator, a compiler and gates to exchange outputs. This probe begins after generation and evaluation have already happened. It proves compilation parity but never exercises that exchange. The narrowed scope was disclosed, but the completion language made the broader operational question sound more settled than it is.
- **Gap:** The accepted recommendation did not specify a minimum live workflow.
- **Reach:** Future work could mistake this for evidence that a portable agent campaign already exists.
- **Verdict:** Unsound as task closure. Corrected decision: distinguish a completed packaging smoke test from an unbuilt live campaign runner; require one request through real separated workers, gates and receipts before claiming the latter.
- **Confidence:** Low.

### U2 — Use the existing image store to stand in for recovery from an archive

- **When:** `run.py` image save/load and roundtrip replay.
- **Choice:** Docker loads the saved image into the same daemon that still holds all its layers, then the harness tags the previously recorded image ID and runs it. If the original machine disappeared, those cached layers would be gone. This test never establishes that the archive alone can supply the runtime. The input archive did genuinely restore into a different directory, but that does not resolve the image-cache dependency.
- **Gap:** The plan specified a same-host round trip without defining how to remove dependency on the source image store.
- **Reach:** Backup/recovery and migration conclusions.
- **Verdict:** Unsound as independent restore evidence. Corrected decision: restore and execute from the archives on a separate machine or empty isolated daemon, without the source checkout or image cache. Do not remove unrelated images to manufacture that condition.
- **Confidence:** Low.

### U3 — Rely on killing the Docker client to bound container execution

- **When:** `command()` and `docker_args()`.
- **Choice:** A subprocess timeout stops the host command running `sudo docker run`. The daemon owns the container separately; stopping the client does not guarantee the workload stops. The harness uses automatic removal after container exit but assigns no run-specific container name and has no timeout cleanup path that stops it. On a hung gate, the runner could return while the container continues consuming resources. None of the completed runs timed out, and the later inspection found no leftover containers.
- **Gap:** The stop rules specified a timeout without defining the lifecycle owner.
- **Reach:** Every future long-running or faulty worker using this pattern. Timeout output also lacks the ordinary full command receipt because recording happens after subprocess completion.
- **Verdict:** Unsound. Corrected decision: the trusted scheduler must own each container identity, capture timeout evidence, and explicitly stop/remove that container on timeout, interruption and failure before reporting completion.
- **Confidence:** Low.

### U4 — Use path-absence checks as the main evidence for worker separation

- **When:** `boundary.mjs` and the request-blind follow-up.
- **Choice:** A worker confirms that paths such as `/peer` and `/in/tests.json` are absent. No second worker actually writes a private canary and tries to read the first worker's files. A real campaign has concurrently existing outputs, staged inputs and subsequent steps; those are the places where a mistaken mount can disclose evaluator data. The current checks prove the particular mounted view, not the scheduler's ability to create the correct views as jobs progress.
- **Gap:** No minimum negative-control matrix was specified.
- **Reach:** The central Endoforge requirement that a generator cannot inspect independent evals.
- **Verdict:** Unsound as sufficient isolation qualification. Corrected decision: define allowed reads/writes per role, create actual private artefacts for both roles, and verify denied cross-role reads, writes and tampering through the real scheduler. Keep the existing static checks as smoke tests.
- **Confidence:** Medium.

### U5 — Mount the generator's contract into the initial evaluator view

- **When:** Main-run role probes.
- **Choice:** Both role directories received the request and the contract. An evaluator deciding what the requester needs could therefore inherit the generator's assumptions even without seeing its code. DEC-80 requires the evaluation to come from the request independently. A separately recorded request-only follow-up corrected the tested view, but it is not part of `run.py` and is not required by `summary.json`'s success condition.
- **Gap:** The precommit said role-specific inputs without listing them by role.
- **Reach:** A repeat using the main runner alone would omit the strongest relevant boundary check.
- **Verdict:** Unsound. Corrected decision: encode the request-blind evaluator input rule in the runner and its acceptance conditions, with versioned inputs, while preserving the original run's evidence unchanged.
- **Confidence:** Medium.

### U6 — Call the harness safely one-shot without separating failed attempts from existing receipts

- **When:** `main()` guard and top-level exception handler.
- **Choice:** A second invocation refuses to run because `work/` or the first environment receipt exists. The exception handler then writes `receipt/failure.json` into that original run's evidence directory. The first repeat adds a new file outside the recorded checksum list, and a further repeat overwrites that failure file. Original success receipts survive, but the evidence directory is not immutable as implied by the one-shot description.
- **Gap:** Repeat/failure output policy was unspecified.
- **Reach:** Reproducibility, auditability and automation retry behaviour.
- **Verdict:** Unsound. Corrected decision: each attempt must have its own output directory; refusal before starting a new attempt must leave prior evidence untouched. Failure records belong to the attempt that failed.
- **Confidence:** Medium.

## Sound choices and their limits

### S1 — Retain bubblewrap provisionally and leave the hybrid architecture unqualified

- **When:** Recommendation and handback.
- **Choice:** The existing fast worker isolation mechanism remains in place. Docker is proposed as a portable outer environment, but no bubblewrap process ran inside a Docker container. If a future developer follows that diagram literally, nested namespace creation might fail under the container's security settings. Docker-per-worker and Docker-containing-bubblewrap are different designs.
- **Gap:** The user asked relevance, not selection of a final execution topology.
- **Reach:** Scheduler ownership, nested namespace permissions and resource limits.
- **Verdict:** Sound as a reversible provisional recommendation, not a measured hybrid result. Qualify the actual topology before adopting it; do not loosen container permissions just to reproduce the diagram.
- **Confidence:** Medium.

### S2 — Avoid live credentials and network for a packaging smoke test

- **When:** Precommit, image build and all measured runs.
- **Choice:** No model credentials or Executor were included, and Docker networking was disabled. This kept the smoke test narrow and avoided moving sensitive sessions unnecessarily. A real hosted agent needs authentication and network access; it may need to reach the model while being prevented from reading local services or management endpoints. No such network/credential policy was tested. No local-model runtime or GPU access was tested either.
- **Gap:** Authentication, local versus hosted inference and permitted network destinations were not chosen.
- **Reach:** Live operation, secret exposure and potential LAN access.
- **Verdict:** Sound for this limited probe. A live qualification must use an explicit credential and network policy; offline success cannot validate it.
- **Confidence:** High.

### S3 — Reuse frozen candidates and unchanged gates

- **When:** Input selection and replay.
- **Choice:** The harness compiled the same complete candidates without changing contracts, tests or gate code. That provides a clean comparison of outputs across environments. All selected candidates were previously gate-passing; no intentionally broken candidate, mismatched freeze, corrupted archive or killed worker was injected. Matching success therefore says nothing about rejection, failure receipts or recovery from interruptions.
- **Gap:** The smoke test did not include a failure/recovery matrix.
- **Reach:** Confidence in the happy path only. Trusted gate execution gets the entire candidate tree; worker promotion authority has not been implemented.
- **Verdict:** Sound for parity. Before operational use, separately qualify wrong answers, input tampering, absent output, timeout and interrupted recovery, and require each to fail safely without promotion.
- **Confidence:** High.

### S4 — Measure warm invocation latency and disclose unequal environments

- **When:** Startup and replay measurements.
- **Choice:** Ten `/bin/true` calls per backend measure the time to start and stop a fresh worker through the chosen host command. Docker includes sudo, client and daemon work, and imposes one CPU/512 MiB; bubblewrap uses host libraries and no matching resource cap. A long-running campaign or persistent container could amortise much of that launch cost. No pool throughput, model-turn time, contention, memory footprint or equal-resource comparison was measured.
- **Gap:** No performance acceptance target or campaign workload was specified.
- **Reach:** The roughly 136-fold ratio is invocation overhead, not agent throughput or a verdict against Docker generally.
- **Verdict:** Sound because the limits were disclosed. Retain the descriptive measurements; require equal-resource end-to-end work before making a throughput choice.
- **Confidence:** High.

### S5 — Pin runtime inputs and retain hashes, while relying on local dependency state

- **When:** Image construction, setup and receipt capture.
- **Choice:** The image uses a pinned base and copies the existing AssemblyScript dependency tree. File hashes, image identity and exact commands were recorded. However, `setup.sh` merely checks that P-02's local compiler already exists; it does not reconstruct it on a clean host. The image is a portable prebuilt toolchain, but the repository alone is not a complete clean-build recipe. Manifests hash regular-file contents and do not fully describe permissions or symlink identities; cross-platform restore remains untested.
- **Gap:** Reproducible rebuild and platform support were not specified.
- **Reach:** A new contributor needs either the saved image or additional dependency preparation.
- **Verdict:** Sound for local evidence capture. Keep the claim to a prebuilt artefact; qualify a clean-host build and restore before claiming reproducible setup. Existing image, archive and receipts remain available locally.
- **Confidence:** High.

### S6 — Keep the probe separate from production and TX9 adoption

- **When:** Entire implementation.
- **Choice:** No TX9 installation, Executor integration, application merge, capability promotion or hill-climb restart occurred. TX9's documented administrator-token boundary was not reproduced. Existing application work stayed untouched; the only additions were a probe, receipts and index links. This is appropriate experimental scope, but leaves persistent session portability, encrypted state backup, checkpointing, duplicated-job prevention and crash recovery unanswered. The current archives contain frozen inputs, not a resumable campaign.
- **Gap:** The original request did not choose a production platform or authorise a new campaign.
- **Reach:** P-09 is evidence about custom Docker packaging, not evidence for adopting TX9.
- **Verdict:** Sound. The next useful step is a small operational qualification with explicit live-workflow, recovery and clean-restore criteria, not an immediate platform migration.
- **Confidence:** High.

## Corrected status

P-09 completed a deterministic, offline compilation/replay smoke test with targeted file checks. It did not establish a portable live Endoforge campaign, independent backup recovery, or a qualified Docker-plus-bubblewrap worker system. No code was fixed during this audit. The existing timings and parity receipts remain evidence for their stated observations.
