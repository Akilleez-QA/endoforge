# P-12 trusted container lifecycle — result

**Superseded runner:** use [revision 2](revision-2/RESULT.md), which adds token-checked cleanup and create/start/collision fault qualification. Revision 1 frozen code and evidence are preserved.

Complete, 18 October 2026. **Recorded (probe)** on one shared Linux host. All nine fault/ownership checks passed; no model called. P-09 sources and receipts were untouched.

## What this does not show

This is a small deterministic worker qualification, not a live-agent campaign or production scheduler. It does not demonstrate SIGKILL/power-loss/daemon-loss recovery, durable publication across filesystem crash, cross-host restore, hostile-kernel containment, output directory transfer, concurrent duplicate scheduling, reference truth or evaluator independence. SIGINT and SIGTERM are caught; only SIGINT was fault-injected. A trusted host can change chmod-sealed receipts; immutability here means exclusive names, refusal before existing receipt writes, and accidental-write protection.

## Evidence

`receipt/frozen-hashes.json` records precommit and implementation hashes before measurement. Environment before/after includes kernel, CPU, memory, load, Python, git, Docker and full pinned image inspection. Raw command argv, stdout/stderr and exit are retained under each attempt, together with complete terminal container state, container identity, copied stdout artifact and cleanup check. No worker receives host credentials, network or Docker socket; workers mount only their frozen input read-only. Root is read-only, user non-root, capabilities dropped, no-new-privileges enabled, 1 CPU / 128 MiB RAM / 32 processes / bounded tmpfs and rotated 1 MiB logs.

| Check | Recorded result |
|---|---|
| Valid output | Passed SHA validation; one host publication |
| Worker nonzero | Exit 7 captured, no publication |
| Hung worker | Timed out at 0.4-second wait budget, killed, terminal state and logs captured, removed |
| Controller interruption | Separate controller received SIGINT after container start; captured logs and terminal state, removed, no publication |
| Missing stdout artifact | Rejected, no publication |
| Incorrect artifact | SHA validation rejected, no publication |
| Tampered frozen input | Rejected before container creation |
| Duplicate job publication | Atomic no-overwrite link refused; original unchanged |
| Attempt reuse | Exclusive directory creation refused; complete attempt manifest unchanged |

Eight attempts completed in 5.47 seconds for the main matrix; reuse is checked without creating another attempt. The final Docker label inventory was empty. Exactly one publication exists, and the frozen input hash stayed unchanged. A separate full-run rerun also refused before modifying any existing receipts, proved by before/after manifests in `receipt/runner-reuse.json`. Timing is descriptive and includes deliberate timeout/failure arms; raw values and median/p95/min/max/n are in `receipt/summary.json`.

## API and reproduction

`lifecycle.py` exports `run_attempt(root, attempt, job, frozen_input, input_sha, expected_sha, script, timeout=3)`. The caller controls the trusted input/output hashes. It returns a result dict, or raises `FileExistsError` before writing when the attempt name exists. Safe identifiers are required. Each container receives a random name/ID; the controller tracks ownership before creation and removes only that name. Catchable signals set a flag, allowing Docker commands to finish and cleanup to run. The artifact channel is **stdout**: read the input then emit only the artifact to stdout; diagnostics belong on stderr. Log rotation bounds capture and truncation causes validation failure for this exact-hash contract. Private `/out` is scratch, not the artifact channel.

Host validation occurs after container termination and before publication; the host records logs/status and verifies removal. It stages the validated stdout into its attempt directory, then atomically hard-links the read-only file into `published/<job>.txt`. Workers have no mount to either location. A second publisher cannot overwrite that pathname. This handles file publication within one filesystem; arbitrary directory artifacts, fsync durability and a multi-file ledger are not implemented.

`bash setup.sh` only checks Python and the existing immutable P-09 image; it never pulls or builds. `bash run.sh` runs the qualification once and refuses existing `receipt/`. To repeat, copy PRECOMMIT.md, run.py, lifecycle.py, run.sh and setup.sh into a fresh sibling experiment directory, preserving the implementation hashes or declaring changes before measurement. No existing evidence must be deleted. Fault tests live in `run.py` and are directly runnable through this workflow.

## Interpretation

P-09's timeout-container leak and receipt reuse failure modes can be avoided with explicit ownership, catchable interruption handling, terminal receipts and exclusive attempt creation. This implementation passes the bounded fault matrix and is reusable for deterministic stdout-producing workers. It is not yet a recovery scheduler: daemon/host loss needs an external owner reconciler, and SIGKILL cannot run Python cleanup. Promotion is local atomic visibility only, without crash-durability claims. Generalizing artifact outputs requires a reviewed transfer/validation contract rather than handing workers a publication mount.
