# P-54 emitted JavaScript in a contained child isolate: precommit

Label: **Proposed** procedure, frozen 2026-11-06 before any measurement or option was run. Amendments go below with a new digest appended to `receipt/precommit.sha256`; the first digest stays.

Question: which V8-isolate arrangement can run JavaScript emitted by the TypeScript route with no ambient authority, killing only the guest on a heap breach, infinite loop or stack overflow, deterministically, under a deadline enforced from outside, with no process spawn per candidate on the warm path?

Prior evidence, not re-run: P-16 (standalone `workerd`: 0 of 9 neighbours survive a JS heap breach, and off-heap memory isn't bounded), P-18 (pool: 0 of 7 siblings lost), P-44 (off-heap allocation passes a thread cell's heap limit), PR 93's P-50 (a `vm` escape from a thread reached the file system). Bubblewrap isn't an option in this probe.

## Arms

Every arm gets an empty environment except `TZ=UTC` and `LC_ALL=C`, except the control.

| Arm | Boundary |
|---|---|
| `vm-thread` | Positive control. `node:vm` context from a plain object in a Worker of an unrestricted process. Expected to be escapable; the attack suite isn't discriminating if it isn't |
| `cohort-oneshot` | One long-lived `node --permission` process for the cohort. A fresh Worker (V8 isolate) per run, prepared ahead of the job. Guest in a stripped context in that Worker |
| `cohort-reuse` | Same process, Worker kept, fresh stripped context per run |
| `process-cell` | One `node --permission` process per cell, guest in a stripped context on its main thread, killed from the supervisor |
| `isolated-vm` | The `isolated-vm` library in one `--permission --allow-addons` process, if a pinned version builds on both Node versions. A build failure is a result |

Node 22.23.3 and 26.13.0, both, for the attack suite and the breach arm. Speed and memory arms run on 26.13.0, and on 22.23.3 for the arm that's selected.

## Attacks

Each runs as a guest in each arm and on each Node. A canary file, a marker path, a local TCP listener, an environment canary and a decoy child process are checked from outside the guest, so a guest's report alone can't pass or fail it. "Reached" means the outside check saw it, or the guest returned a real host authority object it could call.

`constructor.constructor` from global, from a function, from every value the runner hands in; prototype pollution of the host through input, output and port values; `Error.prepareStackTrace` with `getFunction`, `getThis`, frames on the host side; `Error.captureStackTrace`; a host-realm error obtained by `import()` rejection, by stack overflow during a port call, by a thrown port handler and by a thrown getter; `import()` of builtins and of a file; `require`, `process`, `globalThis` walks; `eval` and `new Function`, including through an async and a generator function's constructor; async work after the deadline by microtask loop, thenable chain and a never-settling promise; `SharedArrayBuffer` by global and by `WebAssembly.Memory`; `Atomics.wait`; `WebAssembly` compile and instantiate, both sync and async; huge strings by `repeat`, concat, flatten, `join`, `padEnd`, `JSON.stringify` and regex; off-heap `ArrayBuffer`; `Map` and `Array` growth to V8's fatal table and array limits; non-interruptible builtins; clock and randomness by `Date`, `performance`, `Intl`, `Temporal`, `Math.random`, `WeakRef`, `FinalizationRegistry`; a poisoned `then`, `toJSON`, `Symbol.toPrimitive` on a returned value; results over the size bound. A separate assume-breach arm hands the guest the real host-realm `process` and `Function` deliberately, to measure what the outer layer alone stops: file read, file write, child process, network, new Worker, native addon, and signal to a decoy child that the harness itself owns.

## Measures

Warm start (ready to first result); per-candidate p50 and p95 at width 1, 8, 16; process spawns per candidate by the ptrace counter from `experiments/P-50-in-isolate/syscount.c` on PR 93's branch, with a positive control; RSS per cell, idle and after 200 candidates; neighbours lost per breach kind at width 8 and 16, 3 reps per kind; deadline overrun from the outside; byte equality of two runs. Against the AssemblyScript route if a suitable corpus exists: same needs, same checks, per-candidate time and memory. If no suitable corpus exists, the result says so.

Shared desktop, no quiet gate, heavy work under `heavy-run` with 6 slots. Load and elapsed time are recorded.

## Predictions

1. The control reaches the file system by `this.constructor.constructor` on both Nodes.
2. Stripped arms: 0 authority reached across the suite, on both Nodes. The likeliest path to break this is a host-realm error reaching the guest through `import()` rejection or a stack overflow in the port's host function. If it isn't handled it's an escape, and a stripped context without handling is expected to fall to it.
3. Assume-breach: under `--permission` file read, write, child process, Worker and addon are denied on both Nodes. Network is reachable on 22 and denied on 26. Signals to a decoy reach it on both, because the permission model doesn't cover them, unless the worker realm removes the route.
4. `cohort-oneshot`: 0 neighbours lost at width 8 and 16 for heap, loop and stack. Huge strings and V8's fatal table limits are the likeliest process-fatal case; I give it about 1 in 3 that at least one takes the cohort down at the 128 MiB limit on at least one Node.
5. `isolated-vm` either doesn't build on Node 26 or takes the process down on at least one breach kind, as the lab smoke matrix saw.
6. Per-candidate wall on a trivial guest at width 1: `cohort-oneshot` under 40 ms p50, `cohort-reuse` under 5 ms, `process-cell` under 5 ms, `isolated-vm` under 10 ms.
7. Marginal RSS per cell: thread cells 8–15 MiB, `process-cell` 40–60 MiB, `isolated-vm` under 8 MiB.
8. Spawns: 0 per candidate on the warm path in every arm, once the cohort has started. A breach costs `process-cell` 1 spawn and the thread arms 0.
9. Deadline: an interruptible runaway dies within 50 ms of the deadline at p95, measured from outside. A long builtin dies within 500 ms. A builtin that V8 can't interrupt inside a Worker is reported with its overrun and whether the cohort watchdog had to kill the process.
10. Determinism: two runs are byte-equal on every corpus input and on Node 22 against 26, except for attacks that read V8's own stack depth.
11. Off-heap: with binary types absent from the default contract, no `ArrayBuffer` allocation is reachable. If the contract grants them, a guard outside the guest stops an allocation that passes the budget within 100 ms of touching it.
12. Against AssemblyScript, on the same needs: running the emitted JavaScript costs at least 10× a fresh wasm instance per candidate, and any AS total including compile is within a factor of 3 of the JS route's check and run.

## Failure meaning

- A stripped arm with any attack reaching authority isn't contained. The escape is reported with its path, whether or not it gets fixed. A fix counts only once the whole suite is rerun.
- An arm that loses a neighbour on a named breach can't be the default for a cohort of mixed trust. If it's process-fatal at any width, the process boundary is the failure boundary and the result has to say so.
- A deadline that a guest can extend is a failure of the arm, not a tuning problem.
- Non-equal runs without a clock or randomness grant is a failure of the determinism contract, not noise.

## Decision

The default is the arm with 0 authority reached on both Nodes, 0 neighbours lost at width 8 and 16 on every breach kind, 0 warm spawns and a deadline a guest can't extend. Among those, it's the lowest per-candidate time, then the lowest RSS. If nothing qualifies, no arm is called contained, the module stays off, and the result says which requirement failed.

The result reports what the permission model doesn't cover, and that a thread boundary isn't a Spectre boundary. This probe doesn't test V8 memory-safety bugs. Passing the suite doesn't mean no escape exists.

## Stop conditions

- `lane-governor status` load over 26: pause and wait.
- Available RAM under 24 GiB: stop the arm that's allocating, and don't resume it until it has a tighter bound.
- A guest that affects anything outside its own cohort, other than the decoy the harness owns: stop and report.
- The supervisor process dying from a guest's behaviour in any arm: stop that arm, record it as a failure of the arm, and keep the core dump's existence in the result.
- Three reruns of one arm for infrastructure reasons: stop and report it unmeasured.

Scratch stays under `.scratch/` in the clone, and generated files that aren't small receipts aren't committed. Nothing touches the core gates, the x1 stages or the agent loop beyond one off-by-default option.

## Amendment 1, 2026-11-06, after one first pass of `cohort-oneshot` only

The first pass is kept in `receipt/initial/`. No other arm had run, and no speed, memory or width number existed. It showed two things.

- Prediction 4 fails as written: on both Nodes `string-regex`, `array-fatal`, `map-table-limit` and `object-dictionary` end the cohort with V8's `FATAL ERROR ... heap out of memory`, whatever the Worker's limits. A thread's `resourceLimits` doesn't contain a large allocation near the limit. That stands as a failed prediction, and these four kinds join the breach arm for every arm.
- `stack-near-error` obtained a host-realm error object: a stack overflow in Node's stack-trace callback, reached through `.stack` near the limit. Code generation was blocked, so no authority was reached, but it's a leak through the context boundary. The attacks now also try to use a leaked host object beyond `Function`, and the harness's false positives on null-prototype objects are fixed.

New arm, decided before any measurement of it: `cohort-cell`, one `--permission` process per cell, with one fresh guest Worker per run and one prepared spare. It's the `cohort-oneshot` code at width 1, N times. Its failure boundary is the process, as in `process-cell`, but it has ports and a deadline enforcer inside the process.

Predictions for it, in the terms of the originals: 0 neighbours lost at width 8 and 16 on every breach kind, because no two guests share a process. Per-candidate wall under 8 ms p50 at width 1. Marginal RSS 50–90 MiB per cell, or about twice `process-cell`. A fatal breach costs 1 spawn; the deadline and heap paths that a Worker contains cost 0.

New attacks: `string-flatten-many`, which holds several flat strings to test whether the heap limit applies to them, and `leak-use`. Decision rule unchanged. An arm with no ports doesn't meet the host-port requirement and can't be the default, whatever its speed.

## Amendment 2, 2026-11-06, before any measurement under it

The question changes. Containment was the first question; this one is speed, concurrency and resource pressure for the compatibility lane, which runs TypeScript emitted as JavaScript in a child V8 isolate. The strict path stays a WebAssembly kernel plus declarative glue, and nothing here changes it. The topology follows Edition 3 section 15 and Atlas diagram 18: isolates in one supervised process are a trust-compatible cohort sharing one failure scope, the controller and its watchdog stay outside the cohort, and a separate process is for a different trust level or failure budget. A lost attempt is `outcome_unknown` (REQ-ISO-003): no arm retries it, and a retry would be a fresh admission.

Arms, all on Node 26.13.0, the selected one also on 22.23.3:

| Arm | Layout | On a fatal V8 error |
|---|---|---|
| `cohort-cell` | One `--permission` process per cell, fresh Worker per attempt (the shipped arm) | That cell's attempt is refused; a new process |
| `process-cell` | One `--permission` process per cell, guest on its main thread, no ports | That attempt is refused; a new process |
| `shared-fresh` | One supervised `--permission` child process, W Workers, a fresh Worker per attempt | Kill the cohort, every in-flight attempt `outcome_unknown`, one replacement process, the queue continues |
| `shared-reuse` | The same, Workers kept, a fresh stripped context per attempt | The same |

Measures at width 1, 8, 16 and 32, with the 1-minute load average recorded at the start and end of every row:

- Two workloads. A trivial guest, for the runtime's own overhead. The contained route over the 20 P-15 scalar needs: type check and emit, run twice, compare and score. That is accepted work.
- Accepted attempts per second; p50 and p95 latency, and for the route its split into check, run and evaluate, with queue wait.
- CPU-seconds per attempt, supervisor plus children, from `/proc`.
- Peak RSS of the supervisor's children, per active attempt, and the marginal RSS per extra cell from a fit over widths; from that, the number of active attempts within a 4 GiB budget.
- Process spawns and Worker starts per attempt, and IPC messages per attempt as the count of process crossings.
- Recovery, shared arms, width 8, 16 and 32, 3 reps each with `map-table-limit` and `string-regex`: one fatal attempt injected into a stream of benign ones. Blast radius is the attempts reported `outcome_unknown`; cost is the spawns, the time from the loss to the replacement's first result, and the elapsed time against the same stream without the fatal. `cohort-cell` gets the same stream for comparison.

Rows taken at load above 16 are labelled loaded and aren't acceptance figures. Heavy runs go through `heavy-run` with 4 slots and wait while load is over 20.

Predictions:

13. `shared-reuse` is within 20% of `process-cell` in attempts per second at every width on the trivial guest, and both beat `cohort-cell` by at least 3× at width 8 and above.
14. RSS per active attempt at width 16: `shared-reuse` 15–30 MiB, `shared-fresh` 20–35, `cohort-cell` and `process-cell` 60–80. In 4 GiB, `shared-reuse` fits at least twice as many active attempts as either per-process arm.
15. On the route workload the type check dominates, and the runtime arms differ by less than 25% in accepted per second at width 16.
16. A fatal in a shared cohort reports every attempt then in flight as `outcome_unknown`, between 1 and W, loses nothing queued, and costs 1 spawn and under 100 ms from the loss to the replacement's first result. The elapsed cost over the stream is dominated by the breacher's own time to reach the fatal limit.
17. 0 process spawns and 0 Worker starts per warm attempt for `shared-reuse`; 1 Worker start per attempt for `shared-fresh` and `cohort-cell`; 2 IPC messages per attempt for every arm without ports.

Decision: the default is the arm with ports and 0 authority reached in the attack suite that has the highest accepted attempts per second on the route workload at width 16. Within 10% of each other, the lower RSS per active attempt wins. A shared arm is eligible only if a fatal's blast radius is bounded to the attempts then in flight, every one of them is recorded `outcome_unknown`, and nothing is retried silently. The others stay as options, and the result says plainly if one process per cell still wins.
