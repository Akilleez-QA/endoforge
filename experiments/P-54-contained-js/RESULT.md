# P-54 emitted JavaScript in a contained child isolate: result

Status: **Recorded (probe)**, 2026-11-06, Node 26.13.0 and 22.23.3, a shared desktop with other agent work running and no quiet gate. Precommit: [PRECOMMIT.md](PRECOMMIT.md); the last digest in `receipt/precommit.sha256` covers Amendment 1, made after one pass of one arm. Raw results: [receipt/raw/](receipt/raw/). The first pass is in [receipt/initial/](receipt/initial/). Local paths in the raw files are shortened, and the spawn traces keep only spawn, thread and mark events.

**`cohort-cell` is the only arm that met every requirement, and it's what `core/runtime/contained/` ships.** It's one `node --permission` process per cell, a fresh Worker per guest with one prepared spare, an allowlisted context and ports. No stripped arm reached authority on either Node in the final suite. A V8 fatal allocation error ends the process whatever a Worker's `resourceLimits` say, so every arm that puts two guests in one process lost neighbours to it, and `isolated-vm` did too.

Load: the speed rows record a load average of 17–25 on 26.13.0, so those are **loaded** figures and not acceptance numbers. The 22.23.3 speed rows were taken at load 11.6–15.9. The breach, attack, deadline and route batches didn't record load; samples taken while they ran ranged from 5 to 50, so treat their timings as loaded too. Neighbour counts and authority results don't depend on load.

## Containment

67 attacks per thread arm and 63 per arm without ports, on each Node. "Reached" is checked from outside the guest: canary in output, marker file written, marker spawn, a TCP connection, or a decoy process killed.

| Arm | 26.13.0 reached | 22.23.3 reached | Host-realm objects | Host pollution |
|---|---|---|---|---|
| `vm-thread` control | 8 attacks, file write, spawn, network, signal | 9 attacks, the same | 9 | not measured |
| `cohort-oneshot`, `cohort-reuse`, `cohort-cell` | 0 | 0 | 0 | 0 |
| `process-cell` | 0 | 0 | 0 | 0 |
| `isolated-vm` (7.0.2 on 26, 6.2.0 on 22) | 0 | 0 | 0 | 0 |

**Leak found and fixed.** In the first pass, `stack-near-error` obtained a host-realm error object through a stack overflow inside Node's stack-trace callback, reached by reading `.stack` near the limit. Code generation was off, so it reached no authority, but it crossed the context boundary. A second route to the same thing was `import()` near a stack overflow, which rejects with a host-realm error. Both are closed: the guest realm fixes `Error.stackTraceLimit` and `Error.prepareStackTrace` to `undefined`, so reading `.stack` no longer calls into Node's callback, ports and refusals throw errors made in the guest realm, and any source with `import` followed by `(` is refused before it runs, even inside a string or comment. The whole suite was rerun after the fix, and those rows are the table above.

Assume-breach, where the guest is handed the real host `process` and `Function` on purpose:

| | Permission model only | Hardened worker realm |
|---|---|---|
| File read, write, child process | denied, both Nodes | denied |
| Native addon | denied (`ERR_DLOPEN_DISABLED`) | denied |
| Network | **reached on 22**, denied on 26 | denied |
| New Worker | **started**, both Nodes | denied |
| Signal to the decoy | **reached**, both Nodes | denied |

The cells need `--allow-worker`, so the permission model alone doesn't stop a Worker. The hardened realm deletes `process.binding`, `kill`, `dlopen`, `getBuiltinModule` and similar entries, and the networking and timer globals, from the cell's Worker before the guest runs, and that's what stops the last three. This is the second layer; the first is that the guest never gets these objects.

## Neighbours lost on a breach

3 reps of each of 7 kinds at width 8 and 16: heap, loop, stack, and four that hit V8's fatal limits (`string-regex`, `array-fatal`, `map-table-limit`, `object-dictionary`). Siblings lost, out of 7×21 at width 8 and 15×21 at width 16:

| Arm | 26.13.0, w8 | w16 | 22.23.3, w8 | w16 |
|---|---|---|---|---|
| `cohort-oneshot` | 84 | 180 | 84 | 180 |
| `cohort-cell` | **0** | **0** | **0** | **0** |
| `process-cell` | **0** | **0** | **0** | **0** |
| `isolated-vm` | 0, not discriminating | 0, not discriminating | 63 | 135 |

`cohort-oneshot` lost the whole cohort on every fatal kind, on both Nodes, and none on heap, loop or stack. On 26.13.0 the `isolated-vm` process died 6 times out of 21 at each width, but its siblings had already finished, so that row can't show a loss. On 22.23.3 it took them down. `process-cell` on 22.23.3 reported 9 of 21 heap breaches as `process_exit` with SIGABRT instead of `heap`, so the refusal holds and the reason is coarser.

## Speed, memory, spawns

Trivial guest, 200 candidates per cell. Times are ms, RSS is MiB.

| Arm, Node | Width | Ready | p50 | p95 | Per s | RSS per cell | Load |
|---|---|---|---|---|---|---|---|
| `cohort-cell`, 26 | 1 | 25 | 7.4 | 44.6 | 91 | 77.8 | 24.6 |
| | 8 | 40 | 10.7 | 39.5 | 638 | 76.4 | 24.9 |
| | 16 | 51 | 20.8 | 96.7 | 465 | 75.1 | 23.7 |
| `cohort-cell`, 22 | 1 | 26 | 18.9 | 60.6 | 55 | 78.6 | 15.9 |
| | 8 | 32 | 24.8 | 96.6 | 254 | 76.9 | 14.6 |
| | 16 | 57 | 54.1 | 135.6 | 274 | 75.4 | 11.6 |
| `process-cell`, 26 | 1 / 8 / 16 | 63 / 41 / 60 | 0.42 / 0.63 / 0.78 | 1.0 / 1.5 / 2.3 | 1,945 / 10,509 / 12,873 | 69 | 22–24 |
| `process-cell`, 22 | 1 / 8 / 16 | 51 / 33 / 223 | 0.31 / 0.98 / 1.88 | 0.8 / 3.5 / 9.9 | 2,627 / 4,275 / 3,946 | 62–64 | 11.6 |
| `cohort-reuse`, 26 | 1 / 8 / 16 | 27 / 31 / 40 | 0.46 / 0.52 / 0.71 | 1.0 / 1.2 / 1.6 | 1,925 / 13,078 / 17,228 | 77 / 29 / 26 | 24.6–24.8 |
| `cohort-oneshot`, 26 | 1 / 8 / 16 | 27 / 147 / 41 | 7.3 / 15.4 / 24.6 | 17.6 / 35.8 / 143.6 | 134 / 479 / 396 | 78 / 29 / 23 | 24.0–24.8 |
| `isolated-vm`, 26 | 1 / 8 / 16 | 55 / 140 / 52 | 2.5 / 6.9 / 13.9 | 5.4 / 24.8 / 66.7 | 328 / 798 / 808 | 64 / 10 / 6 | 21.9–22.4 |

Ready is supervisor start to first result. The cost of `cohort-cell` over `process-cell` is a fresh Worker per guest, a thread spawn, which the spare hides only in part. That's the price of a guest that can't see the previous guest's isolate.

Spawns, by the ptrace counter from P-50 (`fork`, `vfork`, `execve` and `clone` without `CLONE_THREAD`), over 200 warm candidates at width 1:

| Arm | Warm, per candidate | Deadline | Heap | Stack | Fatal |
|---|---|---|---|---|---|
| `cohort-cell` | 0 (200 threads) | 0 | 0 | 0 | 1 process |
| `cohort-oneshot` | 0 (200 threads) | 0 | 0 | 0 | 1 process, and the whole cohort |
| `process-cell` | 0 | 1 process | 1 process | 0 | 1 process |
| Control, 5 × `spawnSync` | 5 processes counted | | | | |

## Deadline from outside

200 ms deadline, 10 runs per kind, overrun measured by the supervisor after the deadline. `cohort-cell`:

| Kind | 26.13.0 p50 / p95 | 22.23.3 p50 / p95 |
|---|---|---|
| `loop` | 10.3 / 13.5 | 44.2 / 72.8 |
| `loop-swallow` (catches and retries) | 22.0 / 62.4 | 23.1 / 43.4 |
| `async-microtask-loop` | 9.9 / 13.1 | 23.8 / 54.0 |
| `async-thenable-chain` | 16.3 / 52.0 | 32.8 / 96.2 |
| `regex-catastrophe` | 11.0 / 18.7 | 23.0 / 23.6 |
| `bigint-big` | 19.4 / 60.9 | 63.1 / 117.7 |
| `sort-big` | 7 of 10 refused as heap first; deadline p95 81.2 | 9 deadline, 1 heap; 51.4 / 83.1 |
| `deep-json-stringify` | 26.8 / 51.8 | refused as `stack` before the deadline |

No guest extended a deadline: every run ended with a refusal, and a port that never answers can't hold one open. `isolated-vm` on 26.13.0 lost its process on all 10 `bigint-big` runs (3.1 s each) and overran by 686 ms at p95 on `deep-json-stringify`. `process-cell` overran by 37–122 ms at p95.

## Determinism

10 guests including the attacks that read a clock, randomness, globals, code generation and `prepareStackTrace`: two runs gave one distinct output on each Node, every one. Across Nodes, 7 of 10 matched. The 3 that differ are `depth` (reads V8's stack depth, as predicted), `globals-walk` (26.13.0's V8 exposes 424 reachable objects to 22.23.3's 413), and `math`, where `Math.pow` differs in the last digit on 35 of 299 inputs between the two V8 versions. `sin`, `exp`, `log`, `cbrt` and `atan2` matched.

## Against the AssemblyScript route

The P-15 corpus has 20 AssemblyScript kernels. None of them type-checks as TypeScript whole (39–57 diagnostics each, from AssemblyScript-only types and builtins), so the comparison uses each kernel's scalar pair, `toBaseFactor` and `convertUnit`, with the scalar types declared as `number`. 20 needs, 7 tests each. Load wasn't recorded.

| | p50 | p95 |
|---|---|---|
| `asc -O3` compile | 31.6 ms | 123 ms |
| wasm instantiate | 0.08 ms | 0.14 ms |
| wasm run | 0.01 ms | 0.02 ms |
| TypeScript check and emit | 17.3 ms | 35.1 ms |
| Contained run, twice and compared | 12.4 ms | 31.0 ms |

All 20 passed their tests on the contained JavaScript route, and the two runs were equal on all 20.

## Rerun on the committed runner, at load 7–11

The attack and deadline batches above ran before two fixes went into the shipped runner: `close()` waits for a cohort that's still starting, and a port is looked up only among the contract's and caller's own names. After those, with load 7.5–10.5, `cohort-cell` alone was run again on both Nodes. Raw files are in [receipt/rerun/](receipt/rerun/).

- Attacks: 67 on each Node, 0 reached, 0 host-realm objects.
- Deadline overrun, ms, p95 on 26.13.0 then 22.23.3: `loop` 11.9, 35.9; `loop-swallow` 9.9, 27.6; microtask loop 10.2, 28.8; thenable chain 10.7, 27.6; regex 10.3, 26.4; `bigint-big` 17.7, 61.7; `deep-json-stringify` 38.0 on 26 and refused as `stack` on 22. Every interruptible runaway was within 50 ms.
- Speed on 26.13.0, p50 and p95 ms: `cohort-cell` 4.9 and 9.2 at width 1, 7.7 and 15.4 at 8, 17.5 and 60.9 at 16, with 205, 1,017 and 734 per second. `process-cell` 0.34 and 0.75, 0.47 and 1.18, 0.67 and 1.78. RSS per cell 76–77 and 69 MiB. Ready 24–46 ms.

## Predictions

1. Control reaches the file system by `this.constructor.constructor`: **held**, both Nodes.
2. Stripped arms reach 0 authority: **held** in the final suite. The predicted route, a host-realm error through a stack overflow or `import()`, did reach the guest in the first pass, without authority, and was fixed before the rerun.
3. Assume-breach: file read, write, child process and addon denied: **held**. Worker denied: **failed**, since the cells need `--allow-worker`. Network reached on 22 and denied on 26: **held**. Signals reach the decoy: **held**, unless the worker realm removes the route, which it does.
4. `cohort-oneshot` loses no neighbour on heap, loop or stack: **held**. The 1 in 3 chance of a fatal kind taking the cohort down: **failed**, all four did on both Nodes (Amendment 1).
5. `isolated-vm` doesn't build on 26 or takes the process down: **held**, it built on both and took the process down on both.
6. Width 1 p50, `cohort-oneshot` under 40 ms, `cohort-reuse` and `process-cell` under 5, `isolated-vm` under 10: **held**, 7.3, 0.46, 0.42 and 2.5 (loaded). Amendment 1's `cohort-cell` under 8 ms: **held on 26**, 7.4 loaded and 4.9 in the rerun, **failed on 22** at 18.9 (load 15.9).
7. Marginal RSS: thread cells 8–15 MiB, **failed**, about 19–22; `process-cell` 40–60, **failed**, 62–69; `isolated-vm` under 8, **held**, about 2. `cohort-cell` 50–90: **held**, 75–79.
8. 0 warm spawns: **held** in every arm. A breach costs `process-cell` 1 spawn: **held**, except stack, which it contains. Thread arms 0 on a breach: **failed** for fatal kinds, which restart the cohort. `cohort-cell` 1 on fatal and 0 on deadline and heap: **held**.
9. Interruptible runaway within 50 ms at p95: **failed**. `cohort-cell` met it on 26 for `loop`, the microtask loop and the regex, not for `loop-swallow` (62) or the thenable chain (52), and on 22 only for `loop-swallow` and the regex, all at high load. In the rerun at load 7–11 it **held** on both Nodes, 36 ms at worst. Long builtins within 500 ms: **held** for `cohort-cell`, not for `isolated-vm`.
10. Byte-equal runs, and 22 equal to 26 except stack depth: **held** within a Node, **failed** across Nodes for `globals-walk` and `Math.pow`.
11. No `ArrayBuffer` without a grant: **held**, binary types aren't in the context. The granted case wasn't measured.
12. JS run at least 10× a fresh wasm instance: **held**, about 140×. AS total including compile within 3× of the JS check and run: **held**, 31.7 against 29.7 ms at p50.

## What this does not show

- It isn't an OS sandbox and isn't a Spectre boundary. V8 memory-safety bugs aren't tested. Passing the suite doesn't mean no escape exists.
- Results across Node versions aren't equal, so a verdict is bound to the Node that produced it.
- The granted-binary path (prediction 11), the RSS watchdog against a guest that passes the heap limit with one flat string at width above 1, and a cgroup bound on a cell weren't measured.
- The AssemblyScript comparison uses scalar extracts, not whole kernels, and 20 needs.
- Apart from the rerun, every timing here is from a loaded desktop, and even the rerun had other agents' work running. The rerun didn't repeat the breach, spawn or route batches, which ran on the runner before the two fixes.
