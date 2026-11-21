# Forge Core

Forge Core is EndoForge's device layer. Packet F1 adds recursive child jobs to the existing bounded workcell pool.
Craig launches kernels (envelopes); the device schedules the individual jobs. Host drivers S1–S3 are later work.

| GPU concept | Forge Core mapping |
|---|---|
| Host CPU | Craig |
| Kernel launch | Envelope |
| SM/block | Isolate group on one host |
| Warp | Same specification over variants |
| Reduction | Order-independent merge |
| ECC | F2 verifier-first outcomes |

## Rules

Budget inheritance is conserved by the host, never the child. Merges are associative and order-free. Atom results
are content-addressed by SHA-256 of canonical JSON containing goal, inputs and code version. Locality comes first:
children use the same host's pool and its in-memory cache. No remote dispatch or model transport is added.

## Device interface

Configure `IsolatePool` with `forge: { codeVersion, maxDepth, maxFanOut }` and submit an envelope with
`budget: { tokens, verifyMs, dollars }`. All dimensions are nonnegative safe integers; dollars are microdollars,
not floating-point currency. The host pins the code version to its deployed host-port implementation and must
change it whenever that implementation or its relevant dependencies change. A child cannot select another version,
provide a job object, change the reference, or supply its own depth.

A port calls `hostCall({ op: 'spawn', children, budget, merge: 'set-union' })` (also reachable through `host`). Each
child is `{ goal, inputs, codeVersion, budget }`. Inputs become the child port's options, with authoritative `goal`
and `inputs` fields. The same host-port module, candidates and frozen evaluator are inherited. Child ports return
an array in `evidence.value`. The workcell context also exposes `spawn(children, budget, merge)` as a convenience.
These calls traverse the existing host-call relay, including the 4,096-call and 1 MiB request limits.

The pool reserves the launch cap atomically, checks every child slice and their sum, and settles each actual
execution once. Identical addresses share an in-flight promise or successful result; the cache is additionally
scoped by the inherited reference. Cache reads consume no child slice. Failures are evicted for retry. Cache lifetime
is one pool; F1 adds no durable object store. Child receipts remain part of the envelope's result rather than creating
competing candidate decisions in the ledger.

The result contains child addresses, status, cache-hit flags and host budget snapshots (`ownSpent` for that node and `spent` including its descendants). `set-union` canonicalizes
JSON array members, removes duplicates and sorts by canonical JSON. Its identity is an empty array, and union is
associative, commutative and idempotent. The reduction hash covers its merge identifier and canonical value, excluding
arrival order, cache flags and timing. Arbitrary user reducers are refused because declarations cannot establish
associativity. A lost or rejected child prevents a successful reduction; its receipt retains its status and available evidence,
without a merged value.

## Scheduling and enforcement

The private pool `#spawn` still creates replacement capacity; `#spawnChildren` creates budget and scheduling tree
nodes. Siblings are queued together on existing cells. Each waiting parent occupies its cell. A nested launch with
no available capacity, or with previously queued work, refuses immediately rather than deadlocking. Configure enough
cells for the desired recursion; F1 does not serialize a running JavaScript continuation or exceed the pool width.

The host measures elapsed dispatched verification time, rounding up milliseconds and terminating the cell at its
remaining limit. Time waiting inside a recursive spawn is charged to the descendants rather than twice to the parent.
External host operations require a trusted synchronous `hostCost` returning all three dimensions before execution;
missing costs refuse. This is a reservation tariff: the handler must enforce that its operation cannot exceed the
precharged tokens and microdollars. No child-reported usage can refund a charge. Killing a cell conservatively spends
its remaining slice because its actual usage is unknown. Only host-known unused reservations return to the parent.
Settlement waits for accepted descendants even if their parent dies. Close refuses further spawns and drains accepted
work. S2 adds the kill hierarchy below; outbox commits remain the host’s responsibility.

The acceptance tests in [forge-core.test.mjs](../../core/runtime/test/forge-core.test.mjs) use the existing ledger
fixture and host-call port, with test doubles only. REQ-ISO-020 traces this packet.

## ECC: verifier-first outcomes (F2)

A trusted, pinned host port returns `evidence.outcome` with `verdict` (`pass`, `fail`, or `unknown`),
`evidenceHash`, `verifyCost`, and `generateCost`, alongside `evidence.value` and `evidence.verification`.
The costs use the same host-defined unit for both phases (for example milliseconds); they are separate from
F1's multidimensional reservation accounting. Verification cost must be finite and nonnegative, generation
cost finite and positive, and verification strictly cheaper than generation. Missing or invalid costs refuse
admission. A zero generation cost cannot establish a meaningful ratio and refuses admission.

`forgeEvidenceHash({ address, value, verdict, evidence })` hashes canonical JSON, where `address` binds the
original goal, inputs and pinned code version, and `evidence` is the port's replayable verification data.
Object key order does not change this hash; changed inputs, values, verdicts or evidence do. Verification
must use deterministic checks and replay evidence, not another generative assertion. The host port is the
trusted verifier boundary: the pool validates its contract and hash binding, but cannot establish the quality
of an arbitrary port's oracle or independently meter a port's supplied phase costs.

Both `reduceForgeResults` and the pool's cache-promotion boundary require a passing outcome. The pool also
recomputes the evidence hash before cache promotion. Failed, unknown, malformed and mismatched results are
evicted for retry and recorded as rejected children with their available outcome and rejection reason.
Child receipts retain the replay data as `verification` alongside the bound outcome.
They never contribute values to a successful merge. In-flight sharing still deduplicates execution; it grants
no promotion authority. A launch with any rejected or lost child returns an `unknown` outcome, a null
`verifyGenerateRatio`, and child receipts, without a merged value or reduction hash.

Successful merge receipts expose an explicit `outcome`: passing verdict, deterministic evidence hash over the
canonical value and sorted child evidence hashes, summed `verifyCost` and `generateCost`, and
`verifyGenerateRatio` (verification divided by generation). These metrics describe logical merge inputs,
including cache hits and duplicate inputs; they do not represent incremental physical spend. The F1 `hash`
continues to identify the canonical merged value independently of evidence and costs. An empty reduction
retains the set-union identity but has an unknown outcome and null ratio, so it cannot be promoted as verified.

[forge-verifier.test.mjs](../../core/runtime/test/forge-verifier.test.mjs) covers F2 admission, evidence replay,
ratio validation and rejected-cache retries; REQ-ISO-021 traces these checks. The F1 tests continue to cover
budget conservation, deduplication and 100 shuffled merges.

## Kill hierarchy and pure kernels (S2)

`ForgeKillScope` in `core/runtime/forge-kill.mjs` is a host-owned cancellation scope. Construct it with
`{ level: 'block' }`, give warp scopes that block as `parent`, and give isolate scopes a warp as `parent`.
Pass the scope to `pool.run(envelope, { scope })`. `scope.kill(reason)` aborts that scope and every descendant;
`pool.run(envelope, { signal })` also accepts an AbortSignal. An already killed scope refuses dispatch.
Use `kill('budget-unknown')` when the host cannot establish remaining authority. Cancellation never grants reuse,
verification or outbox authority.

Every spawned job belongs to its launching job. Parent cancellation, deadline, worker loss (including SIGKILL)
and early parent completion terminate outstanding descendants, including queued work. Cancellation sends immediate
SIGKILL to process cells or terminates thread cells; it does not wait for cooperative kernel polling. The parent
result waits for descendant termination and budget settlement. Independent roots share completed verified cache
entries; in-flight cache entries belong to one root so a killed root cannot strand another root's work.

A requested kill returns `status: 'cancelled'`, a null report and no candidate evidence. Unexpected worker loss
retains `outcome_unknown` and the observed exit signal. Noncompleted parents carry child shutdown receipts as
values in `children`. Unknown and cancelled child outcomes cannot merge or enter the verified cache, and their
unsettled budget is conservatively charged. The host may record these values through its outbox.

Kill receipts contain `level`, `reason`, `requestedAt`, `observedAt`, `stoppedAt`, `propagationMs` and `stopMs`.
The host can supply a monotonic `now` function on a scope; descendants inherit it. Signal propagation and termination
requests run synchronously, while `stoppedAt` is measured after worker exit and descendant settlement. The default
latency budget is 1000 ms, configurable through `latencyLimitMs` on the scope. `withinBound` reports whether the
observed stop met that budget; exceeding it still returns cancellation and never successful work. This is an
observable latency budget, not a hard real-time operating-system scheduling guarantee.

Kernels retain the existing G2 restriction: only the trapping `env.abort` import is admitted. The kernel loader
provides no filesystem, network, process or host-outbox bindings; forbidden imports trap even before admission.
Effects are proposed data returned to the host, which alone owns the outbox and commit decision. SIGKILL discards
unreturned values. Trusted Node host-port modules and host callbacks are privileged adapter code, not untrusted
kernels or an OS security sandbox. Host callbacks receive a cancellation signal (`hostCalls` and `syncHostCalls`
in their context; `hostCall` in its third argument). Hosts must gate world effects through their outbox; an already
started host effect cannot be undone by killing an isolate. Replies arriving after cancellation are discarded.

[forge-kill.test.mjs](../../core/runtime/test/forge-kill.test.mjs) measures deterministic-clock propagation and
termination at isolate, warp and block levels in thread and process pools, hierarchical queued cancellation,
and real SIGKILL of parent and leaf processes while a pure WebAssembly kernel runs. Forbidden world imports are
exercised and an uncommitted effect proposal is observed as data, with zero host world-effect calls or file writes.
