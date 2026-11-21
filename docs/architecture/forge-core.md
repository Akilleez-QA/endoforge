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
| ECC | Later F2 verdicts |

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
associativity. A lost child has an explicit unknown status and contributes an empty array; a reduction is not an
F2 verdict that every child succeeded.

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
work. F2 verdicts and S2 kill/outbox semantics come later.

The acceptance tests in [forge-core.test.mjs](../../core/runtime/test/forge-core.test.mjs) use the existing ledger
fixture and host-call port, with test doubles only. REQ-ISO-020 traces this packet.
