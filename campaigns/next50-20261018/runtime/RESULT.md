# Runtime qualification — current state

Recorded local implementation and qualification,18October2026. Active APIs are documented in `tools/factory_runtime/README.md`; item-status.json defines item scopes. No production deployment or quality-effect claim follows from runtime qualification.

## New accepted evidence

**Exact final allowed Codex wrapper:** `final-codex-20261018/qualification.json` records one allocated subscription turn returning exactly7, exit0 and completed usage. Tokens11694 (11689input+5output), wall4.783s. The final private network namespace, bounded asyncio bridge, zero capabilities, read-only root/dev, fixed writable tmpfs, scope limits, provider allowlist and TLS SNI enforcement were active. Temporary Codex auth was removed and owned scope cleanup recorded. Claude Code CLI remains prohibited; no Claude executable/auth was discovered, mounted or invoked.

**Integrated ModelJournal controller crash:** `model-recovery-0be33dfd/` starts the declared final wrapper under actual ownership Description, records active scope/member identities, refuses a second live controller, then SIGKILLs the controller. Fresh reconciliation records unknown, removes temporary data and confirms original members dead, without promotion or automatic retry. An unrelated live scope survives. A fresh explicit retry links to the old attempt and succeeds. This probe used a deterministic sleeping worker and zero model calls. It qualifies namespace/scope/journal mechanics, not preservation of an in-flight provider response or every workflow boundary.

**Independent acceptance:** `model-recovery-0be33dfd/independent-acceptance.json` rejects a forged worker success flag/value against trusted expected bytes, accepts a known-good artifact and blocks a duplicate publication. Earlier actual fsync-boundary controller exits remain in `recovery-42fe2ece/`; source mutation, create/start/collision/SIGTERM faults remain in `faults-7b67440c/`.

**Independent local Qwen family:** `local-qwen-20261018/qualification.json` records a dedicated owned server running the existing12.6GB GGUF through an isolated evaluator role. It returned exactly7,21tokens (19prompt+2output). The gateway permits only POST to `qwen.endoforge.invalid/v1/chat/completions`, maps it to one fixed trusted loopback endpoint, validates model/messages/token/body policy and forbids tools. Direct host/metadata/management routes are denied. No credentials or paid provider were used. Existing model/config/controller files were unchanged; model full SHA256 and binary/config identities are recorded. The first qualification server was stopped and its temporary data removed.

**Current local service lease:** parent explicitly requested a dedicated1800s lease for roughly20bounded calls. `persistent-qwen-20261018/lease.json` identifies service ownership, endpoint and cleanup recipe. It serves `qwen-local` at `http://127.0.0.1:55905/v1/chat/completions`,8192context, reasoningoff, parallel1. The tested initial server used4096context; the leased server has a declared8192context and max output3072 policy for the parent's approved experiment. Per-request deadline180s; CPU400%, native memory32GiB, tasks128 and bounded logs. GPU fitting reserves1536MiB as an allocator target, not a kernel-enforced GPU quota. The user controller is untouched. Keep the owned service until parent signals completion, then stop only its matching Description/unit with the lease API.

## What this does not show

The one Codex turn and tiny Qwen turn establish actual provider transport/auth/protocol under the stated boundaries. They do not establish independent eval quality or improved fresh-request utility. Full N20/N34/N42/N49 claims belong to their separate qualification packets. ModelJournal crash evidence does not prove provider-response preservation, exactly-once remote execution, power-loss durability or all workflow-boundary resumption. Unknown outcomes remain unknown and require explicit new attempts.

Subscription auth is a temporary role-specific copy of existing account authority; no narrower provider token was minted. The hosted proxy checks CONNECT authority, public pinned IPv4 and visible TLS SNI, but cannot inspect encrypted HTTP Host. It therefore proves route restrictions, not exclusive encrypted application origins on shared IPs. The local gateway is a separate exact application-level exception to one owned endpoint, not a generic LAN opening. Parent owns local call journaling/budget/retry policy; `call_protected` supplies one isolated no-retry turn with raw receipts.

Filesystem fsync claims use its documented crash contract and actual process kills; no storage power-cycle was performed. Trusted supervisor/admin tampering and mutable staged-tree races by the trusted host remain outside worker isolation. Scheduler is synchronous local FIFO batches; no multi-host queue or archive extraction is implemented.

## Stable deterministic packets

- `attempt-a4b596bb/`: normal/wrong/missing/timeout/trap/duplicate, exclusive attempts, live fencing, SIGKILL recovery, Wasmtime fuel/epoch/memory/trap.
- `faults-7b67440c/`: create/start/collision/source-change/SIGTERM with owned cleanup.
- `recovery-42fe2ece/`: artifact/validation/publication/terminal fsync exits, idempotent recovery, PID/generation checks and hostile imports/schema fixtures.
- `transport-8a40346d/`, `transport-capacity-554b5ea1/`: native idle Codex pressure, admitted TLS completion and surviving listener after process-limit refusal.
- `policy-c15c2d33/`, `bounds-c52ad45b/`: final hosted role/SNI/redirect/mount/budget controls.

Historical failures and superseded auth blockers remain under their original directories and `historical/`. The proved transport fix replaced fork-per-connection socat, which died at TasksMax64, with a bounded single-process asyncio bridge. Unreliable CPU-affinity/threadpool tuning was reverted. `choices.md` records the decisions and later corrections.

## Actual workflow compile-stage recovery and local journal ownership

`actual-workflow-recovery-6595fe3e/qualification.json` closes the additional live-job compile-stage experiment. It copies the actual generated Celsius capability and six normative/frozen files from `work/executed50/clean-3d58d848/jobs/dev-affine-01` into a fresh runtime-owned probe. Real `pipeline.compile_candidate` runs in owned Docker with an explicit readiness marker and deliberately partial stdout. After observing marker/ownership/running state, the host SIGKILLs its controller and confirms the container is an actual running orphan. Exact dead-attempt reconciliation removes it and never promotes the partial bytes. A new trusted subprocess runs full compile, bounded evals and trusted Docker gate/publication on the same immutable payload. WASM hash matches the original live output. A second new subprocess validates the known publication and reuses it without a new attempt; repeat interrupted-attempt reconciliation leaves it intact. One publication exists, and original/clone normative hashes remain identical. No model calls were used. This is an actual compile-boundary workflow recovery; other boundaries retain their own required evidence.

`local_provider.call_protected` now accepts optional `journal` and `row`. It binds the exact journal stage/prompt digest, creates the journal-owned private home, declares the recorded scope/Description and records started before execution. Its finally block checks that Description before stopping only its own scope. Caller records terminal outcome and invokes `cleanup_owned` for journal-owned temporary data. Standalone calls retain automatic temp cleanup. `local-journal-d871bcb6/` and its later repeat prove this with a deterministic HTTP fixture under the actual role wrapper, without invoking a model.

## Source-backed historical auth correction

The stored pre-prohibition receipts show **one success and one failure**, not two successes: `egress-6efdcdc2/subscription-model.json` has exit0,is_errorFalse,result7,2673reported tokens; `egress-5d54d8f2/subscription-model.json` has exit1,is_errorTrue,revoked-token authentication failure and all usage0. Its `model-verdict.json` records passedFalse. An earlier summary incorrectly interpreted a completed output directory as successful model qualification. Raw receipts remain unchanged; current Codex qualification is separate and successful. Count2historical attempts/2673reported tokens. No Claude CLI was invoked for this correction.
