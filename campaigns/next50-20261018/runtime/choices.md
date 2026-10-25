# Runtime choices ledger

Audit uses `/home/user/.agents/skills/audit-choices/SKILL.md`, after implementation. Read the first three entries before treating this as a complete hosted factory. These are architecture judgments, not new implementation changes.

## Needs-user — none

No cost/product preference decision requires interrupting this authorized run. Unqualified capabilities remain visibly gated.

## Unsound — corrected or retained as explicit gaps

### U1 — Full hosted-stage durability cannot be inherited from Docker

When a controller dies while a Docker verifier runs, its journal identifies the exact container and original PID/starttime, so a fresh controller can recover safely. A hosted model currently gets a private namespace and190-second scope lifetime but no equivalent durable model-stage journal. Calling that model workflow resumable would be unsound: bounding how long it can remain alive does not recover its response or determine whether the turn already happened. The corrected decision is that each hosted attempt needs its own durable identity, terminal evidence and recovery protocol before workflow crash/resume qualification. **Gap:** the plan required a complete runner but left model-stage ownership mechanics open. **Reach:** N34/N42 remain gated. **Verdict:** unsound to generalize Docker durability; the claim is explicitly withheld. **Confidence:** high.

### U2 — Earlier authenticated success cannot qualify later security code

Correction from the stored raw receipts: the first allocated pre-prohibition Claude call returned7 (exit0,is_errorFalse,2673reported tokens); the second failed authentication (exit1,is_errorTrue,all usage0). The second model-verdict.json already records passedFalse. An earlier report incorrectly treated output-directory completion as model success. Afterward, deterministic audits added capability removal, read-only root/dev and TLS SNI checking. Those are meaningful changes to the environment in which auth runs. The existing receipts prove one successful turn and one failed attempt, while the then-current credentials could not authenticate the final code. The corrected decision is to require another deliberately allocated successful subscription turn on the final version; until then N27 stays blocked. **Gap:** no credential-expiry recovery allocation was specified. **Reach:** no broad hosted run starts from earlier auth evidence. **Verdict:** unsound to call N27 complete; retained as a blocker. **Confidence:** high.

### U3 — A CONNECT hostname is not exclusive encrypted application authority

A worker can request a tunnel only to an exact allowed provider name, and the host resolves and pins a public IPv4 address. The final proxy also checks the visible TLS server name before forwarding. It cannot see the HTTP Host header inside encrypted traffic; shared provider IPs can have routing behavior the proxy cannot inspect. The corrected decision is to describe this as a public pinned-address/SNI route policy. A stronger exclusive-origin guarantee needs an application protocol broker or deliberately trusted TLS termination. **Gap:** the plan required blocked host/LAN/metadata/management routes but did not choose an application-layer broker. **Reach:** no claim that every encrypted request is to an exclusive provider application. **Verdict:** unsound to equate route authority with encrypted application authority; limitation retained. **Confidence:** high.

### U4 — Mapped-root capability assumptions were false

An outer user namespace lets an unprivileged process set up its own loopback. The initial wrapper then entered bubblewrap as mapped root and retained namespace capabilities; a real CapEff check failed. Assuming bubblewrap removed them without an explicit option was unsound. The corrected property is that the final worker has no effective capabilities, while setup happens before capability removal. The implemented `--cap-drop ALL` now passes that check. **Gap:** nesting setup and filesystem isolation left capability lifetime unspecified. **Reach:** future wrappers must preserve the setup-then-drop ordering. **Verdict:** prior choice unsound, corrected and measured in bounds-2e981dee. **Confidence:** high.

### U5 — Named output quotas alone did not bound writable storage

Initially /out8MiB, /tmp64MiB and home64MiB were bounded, but bubblewrap's newly constructed root and /dev directories could still accept files. A worker could bypass a named output quota by writing elsewhere. The corrected property is that every undeclared path is read-only and all declared writable data paths have fixed tmpfs sizes. Final tests deny /rogue and /dev/rogue while proving intended data mounts remain usable. **Gap:** filesystem topology had no explicit writable-root policy. **Reach:** future mounts must be assessed as an entire writable tree. **Verdict:** initial choice unsound, corrected by final root/dev remounts. **Confidence:** high.

## Sound — architecture inherited by future work

### S1 — Single-controller local fencing before expanding concurrency

If two host supervisors target the same runtime root, the second cannot acquire its flock, an OS-managed exclusive lock. The owner writes a random generation and checks it before publication; recovery compares PID, process start time and boot ID so a recycled PID is not mistaken for the original controller. This deliberately serializes one runtime root. A multi-controller database would allow greater throughput but introduce a larger authority system. **Gap:** supervisor coordination was unspecified. **Reach:** current scheduler is synchronous and local; parallel throughput must be a separate change. **Verdict:** sound for this qualification slice. **Confidence:** medium.

### S2 — Stdout is the only worker artifact channel

A Docker compiler/verifier can read one validated input file and use bounded private temporary storage. It returns artifact bytes on stdout, which the trusted controller bounds and independently checks. It never writes directly into trusted host receipts or publications. Unknown-output compilation uses capture-only and never publishes; the caller separately validates the captured WASM before bounded execution. A shared writable output bind would simplify file access but weaken quota and publication authority. **Gap:** artifact transport was unspecified. **Reach:** artifact size must fit the log channel, and file-producing tools need an explicit new transport. **Verdict:** sound narrow transport. **Confidence:** medium.

### S3 — Temporary role homes preserve existing subscription authority

The supervisor copies only the required auth file into a temporary role directory, read-only binds it into a bounded ephemeral home, and deletes the copy afterward. A generator cannot inspect the evaluator's home or original host home. This does not mint a provider token with fewer permissions; the copy still has the original account's provider authority. **Gap:** provider-scoped token issuance was not available through the subscription workflow. **Reach:** filesystem isolation is qualified separately from account authority. **Verdict:** sound with the explicit authority limitation. **Confidence:** medium.

### S4 — Systemd scopes provide native memory/task ceilings

Wasmtime fuel bounds generated instructions, while a malicious module can also stress compilation or produce stdout. Each invocation therefore has a transient user scope limiting native memory/tasks/CPU, plus an external bounded pipe reader and deadline. The runtime's numeric function result is accepted only after those execution controls. A linear-memory limit by itself would miss native process memory and host pipe growth. **Gap:** external native-resource enforcement was unspecified. **Reach:** this local runner depends on a functioning user systemd manager and adds invocation overhead. **Verdict:** sound for this host; portability must provision the same mechanism. **Confidence:** medium.

### S5 — Refuse archives rather than add an unqualified extractor

A hostile file can be a symlink to a receipt, a hardlink alias or a Unix socket. Import accepts only individually validated regular files without aliases; mount trees reject links and special files. Archive extraction is explicitly unsupported, so no archive path can reach a receipt directory through this importer. A full archive extractor would need separate path, size, link and race qualification. **Gap:** supported import formats were unspecified. **Reach:** packaging layers must validate/extract through their own trusted interface before supplying regular staged files. **Verdict:** sound narrow import boundary. **Confidence:** medium.

### S6 — Trust the host for freeze authority, enforce the worker's named view

The host validates the frozen suite digest, then invokes the generator with a freeze marker. The worker receives request/typed contract only; it cannot mount frozen evals. An evaluator can mount request, bare signature and independent reference but cannot receive candidate resources through the role wrapper. This protects worker views while keeping the host as the promotion authority. It does not protect against a malicious supervisor forging a marker or placing private data directly in a prompt. **Gap:** which actor authenticates the freeze was unspecified. **Reach:** parent integration must use `role_worker_command` and verify the actual frozen artifact, not merely call the low-level wrapper. **Verdict:** sound within the trusted-host boundary. **Confidence:** high.

### S7 — Recover only already published validated output

After an uncertain controller death, logs or partially staged files are never promoted. If a no-overwrite publication already exists and its digest matches the journal's trusted expectation, recovery records it without linking another file. Otherwise the outcome remains explicitly interrupted and a fresh attempt may retry. This avoids guessing whether an incomplete output passed verification. **Gap:** publication recovery semantics were unspecified. **Reach:** staged work may be repeated, but uncertain results cannot silently become accepted artifacts. **Verdict:** sound, demonstrated across four controller-exit checkpoints. **Confidence:** high.

### S8 — Preserve failure packets and bound security telemetry

Failed directory-name, cgroup-parser and capability-assumption runs remain in separate directories. Later passing runs name their corrections rather than overwriting earlier evidence. Proxy request slots, connection count and event history are bounded so a hostile worker cannot turn unlimited diagnostics into unbounded host memory. **Gap:** telemetry retention and protection were unspecified. **Reach:** final packets need source/version identity; summaries cannot average earlier unsafe versions into the final result. **Verdict:** sound. **Confidence:** high.

### S9 — Shared strict record envelope, distinct rich raw receipts

Every job/attempt/stage/receipt has the same required identity, state, parent, usage, hash and error envelope, with a versioned kind. Rich raw Docker fields remain in result.json; the separate record.json follows the strict schema. Unknown envelope fields and unsupported versions fail explicitly. This keeps raw diagnostics expandable while maintaining a small machine-checkable lifecycle contract. **Gap:** schema normalization was unspecified. **Reach:** consumers validate record.json and preserve raw result.json as evidence rather than treating arbitrary diagnostics as accepted state. **Verdict:** sound. **Confidence:** high.

## Transport follow-up audit (new authorized pass)

### U6 — A bridge that forks for every connection can die at the process budget

Native idle Codex uses about50threads, and threads count toward the64task ceiling. The earlier socat listener forked one new process per connection; at the limit its fork failed and the listener exited, causing every subsequent model retry to see connection refused. Merely pinning a CPU or setting threadpool environment variables did not reliably reduce the variable native thread count, so those attempted mitigations were reverted. The corrected decision is a bridge that can forward bounded concurrent streams without creating a thread/process per connection. A single-process asyncio relay now does that and waits for readiness before starting the worker. Synthetic child spawns can still fail at the real process ceiling, but admitted TLS streams and a later probe continue working. **Gap:** bridge concurrency behavior at resource exhaustion was unspecified. **Reach:** future relays must remain alive when a worker reaches its declared process budget; this does not guarantee model capacity or resumption. **Verdict:** original forking bridge unsound, corrected and no-model pressure-tested. **Confidence:** high.

### S10 — Enforce the new Claude prohibition in active discovery and credential mounts

After the user prohibited Claude Code CLI, the runtime stopped discovering/mounting its executable and auth, disabled the old Claude qualification entry point, and narrowed the active default proxy allowlist to OpenAI. Previous successful Claude receipts remain history. The allowed current Codex transport was retested without credentials or model calls; its exact final authenticated qualification remains incomplete. **Gap:** the user's new constraint superseded the earlier dual-family route. **Reach:** future work must use Codex and must not treat restoring Claude login as a next action. **Verdict:** sound implementation of explicit user authority. **Confidence:** high.

## Authorized execution continuation audit

### S11 — Close the auth blocker with a real Codex turn, then keep its scope narrow

The final no-fork bridge and isolation policy successfully carried one explicitly allocated Codex subscription turn, returning7 with completed usage and cleanup. This resolves U2 for the allowed final Codex route. It does not transform that tiny transport test into an eval-quality result. **Gap:** the earlier final-version auth evidence was missing. **Reach:** downstream experiments can use the tested Codex transport while retaining their separate quality gates. **Verdict:** sound, actual source-hashed wrapper call recorded. **Confidence:** high.

### S12 — Record unknown on controller death, then require an explicit new attempt

The final role wrapper now has an actual integrated ModelJournal SIGKILL probe. The dead controller's stage becomes unknown, its scope/temp are cleaned, and a new attempt must explicitly name its predecessor; a foreign scope survives. This resolves U1 for those tested ownership/retry mechanics, while preserving uncertainty about an in-flight provider response. A separate actual generated-candidate compile crash proves a fresh verifier can republish the immutable source exactly once. **Gap:** earlier lifecycle evidence covered Docker primitives rather than the complete declared wrapper and live payload. **Reach:** recovery may repeat declared work under a new identity; it cannot infer completion from partial stdout or silently reuse unknown responses. **Verdict:** sound bounded recovery semantics. **Confidence:** high.

### S13 — Add a separate application-level local gateway instead of widening network routes

The existing Qwen weights provide a different model family without Claude CLI or paid APIs. Its dedicated server listens on one owned loopback port, while isolated workers still have no host/LAN route. A separate Unix gateway accepts only one exact chat POST alias/path, validates model/messages/token/body fields and forwards only to that fixed endpoint. Tools and arbitrary management paths are denied. This differs from adding localhost to a general proxy, which would expose unrelated host services. **Gap:** the user permitted local inference but its protected provider route was unbuilt. **Reach:** local calls need declared limits and response validation, while ordinary hosted Codex policy remains unchanged. **Verdict:** sound, actual tiny inference plus negative routes qualified. **Confidence:** high.

### S14 — Keep a leased dedicated server for the parent's experiment

The initial tiny Qwen qualification stopped its own server. Parent then explicitly requested roughly20calls over10–20minutes. A dedicated1800-second systemd service lease now owns its own port, Description, log, memory/CPU/task limits and exact cleanup record, with8192context and reasoning off. Existing user controller/config/model files are untouched. A hardcoded fixed4K-context/300-second probe service would have expired mid-campaign; an unbounded background server would obscure cleanup responsibility. **Gap:** experiment runtime exceeds probe lifetime. **Reach:** parent must stop the matching lease when finished; automatic expiry still bounds abandonment. GPU fitting has a soft free-memory target rather than a kernel GPU quota. **Verdict:** sound implementation of explicit parent authorization, with resource limitation recorded. **Confidence:** high.

### S15 — Let the caller own local journal terminal decisions

With optional journal/row parameters, the local client binds stage and prompt digest, uses the exact declared scope and records started before work. It always checks ownership before stopping that scope. The caller then records terminal outcome and cleans the journal-owned temporary directory. This keeps the model request transport from inventing success/retry decisions for the campaign. Standalone no-journal calls still clean their own temporary data. **Gap:** initial local helper only had finally cleanup and a scope lifetime, leaving controller-crash ownership unconnected. **Reach:** parent journal integration can now apply the same unknown-outcome and explicit-retry policy to Qwen. **Verdict:** sound, deterministic actual-wrapper fixture qualification without another model call. **Confidence:** high.
