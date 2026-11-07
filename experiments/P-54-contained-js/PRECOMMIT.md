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
