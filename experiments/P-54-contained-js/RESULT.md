# P-54 emitted JavaScript in a contained child isolate: result

Status: **Recorded (probe)**, 2026-11-06, Node 26.13.0 and 22.23.3, on a shared desktop with other agents' work running and no quiet gate. Precommit: [PRECOMMIT.md](PRECOMMIT.md). Amendment 2 moved the question to speed, concurrency and resource pressure and was committed before any of its measurements; its digest is the last line of `receipt/precommit.sha256`. Raw results for this question are in [receipt/pressure/](receipt/pressure/). The containment work that came first is in [receipt/raw/](receipt/raw/), [receipt/initial/](receipt/initial/) and [receipt/rerun/](receipt/rerun/); local paths there are shortened, and the spawn traces keep only spawn, thread and mark events.

This is the compatibility lane: TypeScript emitted as JavaScript and run in a child V8 isolate, for imported code and behaviour that resists the kernel split. The strict path is still a WebAssembly kernel plus declarative glue, and nothing here runs on it.

**The default is `shared-reuse`: one supervised `--permission` child process holding `width` Worker isolates that are kept between attempts, with a fresh guest context per attempt.** It matches one process per cell in attempts per second at every width, uses about a third of the memory per active attempt, and fits about 178 active attempts in 4 GiB to the per-process arms' 55–59. A fresh Worker per attempt, the arm this PR first shipped, costs 9.6–27 ms of CPU per attempt against 0.46–1.1 ms and peaks at 1,132 attempts per second against 15,000–19,000. One process per cell does not win on these numbers. Its one advantage is that a V8 fatal error loses no neighbour; in the shared cohort it loses every attempt then in flight, and those are recorded `outcome_unknown` and never retried.

## Arms

| Arm | Layout | A fatal V8 error costs |
|---|---|---|
| `shared-reuse` (default) | One supervised child process, `width` Workers kept between attempts, fresh guest context per attempt | The cohort: every attempt it held is `outcome_unknown`; 1 replacement process; the queue continues |
| `shared-fresh` | The same, with a fresh Worker per attempt | The same |
| `process-cell` | One process per cell, guest on its main thread, no ports | That attempt, refused; 1 process |
| `cohort-cell` | One process per cell, fresh Worker per attempt (the first shipped arm) | That attempt, refused; 1 process |

The supervisor, its deadline watchdog and RSS watchdog stay outside every cohort. `process-cell` has no ports, so it can't be the default whatever its numbers.

Load is the 1-minute average at the start and end of each row. A row over 16 at either end is marked *loaded* and isn't an acceptance figure. At width 32 the arms themselves keep the 32-thread machine busy, so some of that load is self-inflicted.

## Throughput, latency, CPU and memory

Trivial guest (`BENIGN`, spin 10), so this is the runtime's own overhead. Closed loop with `width` submitters, at least 1,000 attempts and 200 per submitter. Latency in ms; CPU is supervisor plus children per attempt; RSS in MiB is the children's peak.

Node 26.13.0:

| Arm | Width | Per s | p50 / p95 | CPU ms | Peak RSS | RSS per active | Workers started per attempt | Load |
|---|---|---|---|---|---|---|---|---|
| `shared-reuse` | 1 | 2,865 | 0.31 / 0.54 | 0.46 | 81 | 80.6 | 0.001 | 2.5–2.5 |
| | 8 | 15,323 | 0.46 / 0.96 | 0.64 | 236 | 29.4 | 0.005 | 2.5–3.4 |
| | 16 | 18,928 | 0.72 / 1.59 | 0.87 | 416 | 26.0 | 0.005 | 3.4–3.4 |
| | 32 | 16,304 | 1.34 / 3.24 | 1.12 | 778 | 24.3 | 0.005 | 3.4–3.4 |
| `shared-fresh` | 1 | 208 | 4.67 / 9.10 | 9.71 | 93 | 93.1 | 1 | 3.4–3.3 |
| | 8 | 781 | 5.60 / 19.93 | 11.69 | 233 | 29.1 | 1 | 3.3–3.3 |
| | 16 | 867 | 16.58 / 36.77 | 14.07 | 367 | 22.9 | 1 | 3.3–3.6 |
| | 32 | 916 | 33.66 / 52.46 | 14.53 | 581 | 18.1 | 1 | 3.6–6.5 |
| `process-cell` | 1 | 2,709 | 0.30 / 0.71 | 0.48 | 74 | 73.9 | 0 | 6.5–6.5 |
| | 8 | 12,702 | 0.50 / 1.36 | 0.82 | 553 | 69.1 | 0 | 6.5–6.5 |
| | 16 | 20,072 | 0.63 / 1.67 | 0.95 | 1,112 | 69.5 | 0 | 6.5–6.5 |
| | 32 | 17,996 | 1.29 / 3.60 | 1.02 | 2,196 | 68.6 | 0 | 6.5–6.5 |
| `cohort-cell` | 1 | 211 | 4.69 / 8.99 | 9.62 | 94 | 94.5 | 1 | 6.5–6.3 |
| | 8 | 1,132 | 7.07 / 13.91 | 14.65 | 606 | 75.7 | 1 | 6.3–6.3 |
| | 16 | 754 | 16.96 / 58.94 | 23.93 | 1,213 | 75.8 | 1 | 6.3–5.9 |
| | 32 | 660 | 44.00 / 101.78 | 27.27 | 2,387 | 74.6 | 1 | 5.9–15.2 |

Node 22.23.3, same workload, load 3.5–4.7 throughout:

| Arm | Per s at width 1 / 8 / 16 / 32 | p50 at 16 | CPU ms at 16 | RSS per active at 16 |
|---|---|---|---|---|
| `shared-reuse` | 2,969 / 15,965 / 23,969 / 22,999 | 0.56 | 0.69 | 27.1 |
| `process-cell` | 3,551 / 17,376 / 23,439 / 23,770 | 0.53 | 0.75 | 64.1 |
| `cohort-cell` | 96 / 595 / 457 / 403 | 27.99 | 39.55 | 76.4 |

With about 0.65 ms of guest work per attempt (spin 200,000) on Node 26, at load 13–26, so **loaded**: `shared-reuse` 986 / 5,496 / 6,382 / 4,927 per second at width 1 / 8 / 16 / 32, `process-cell` 1,080 / 6,586 / 9,078 / 7,670, `shared-fresh` 193–847, `cohort-cell` 202–916. Load moved through that batch, so it can't settle the gap between `shared-reuse` and `process-cell` at width 16. Raw rows: `throughput-spin200000-26.13.0.json`.

Every attempt in these tables completed. Throughput falls from width 16 to 32 in most arms: the machine has 32 hardware threads and the supervisor shares them.

**Memory budget.** A least-squares fit of peak RSS against width over 8–32, then the number of active attempts whose fitted RSS fits in 4 GiB (`budget-*.json`). These are trivial guests. A real guest's heap adds to the marginal, up to the 64 MiB old-space and 8 MiB young-space limits per Worker, so admission should be against measured headroom and not this table alone.

| Arm | Marginal MiB per cell, Node 26 / 22 | Base MiB, Node 26 / 22 | Active attempts in 4 GiB, Node 26 / 22 |
|---|---|---|---|
| `shared-reuse` | 22.6 / 22.5 | 55 / 62 | **178 / 179** |
| `shared-fresh` | 14.3 / not run | 126 | 276 / not run |
| `process-cell` | 68.4 / 63.2 | 11 / 11 | 59 / 64 |
| `cohort-cell` | 74.1 / 75.3 | 19 / 11 | 55 / 54 |

**Spawns and crossings.** 0 process spawns per warm attempt in every arm; the cohort-start counter didn't move in any throughput row. Every arm makes 2 IPC messages per attempt, one process crossing each way, and a port call adds 2. The Worker arms add 2 thread messages inside the cohort. `shared-reuse` starts `width` Workers once and none after; `shared-fresh` and `cohort-cell` start one per attempt, which is where their CPU goes. Running the cohort inside the supervisor would remove the process crossing, but a fatal error would then take the controller with it, so 2 is the floor for this design.

## The route: accepted work per second

The contained route over the 20 P-15 scalar needs: type check and emit with tsc-rs on the supervisor, run twice in the cohort, compare and score. Every attempt was accepted. Latency in ms; "evaluate and wait" is what's left of the attempt after check and run, which is scoring plus queueing.

| Layout | Width | Accepted per s | p50 / p95 | Check p50 | Run twice p50 | Evaluate and wait p50 | CPU ms | RSS per active | Load |
|---|---|---|---|---|---|---|---|---|---|
| `shared-reuse` | 1 | 62.0 | 15.6 / 20.5 | 13.7 | 1.9 | 0.03 | 33.6 | 79.0 | 16.2–16.2, *loaded* |
| | 8 | 66.8 | 113.8 / 164.5 | 30.1 | 66.3 | 14.5 | 30.4 | 25.5 | 16.2–15.4, *loaded* |
| | 16 | 71.7 | 221.8 / 306.9 | 68.9 | 56.5 | 41.8 | 27.3 | 21.8 | 15.4–14.4 |
| | 32 | 66.0 | 487.3 / 697.3 | 166.7 | 94.2 | 129.0 | 31.4 | 20.1 | 14.4–13.1 |
| `shared-fresh` | 1 | 41.6 | 24.0 / 25.6 | 13.2 | 10.6 | 0.03 | 48.4 | 77.0 | 13.1–12.1 |
| | 16 | 67.2 | 232.7 / 345.7 | 68.4 | 63.9 | 44.9 | 53.4 | 18.2 | 11.2–10.8 |
| `process-per-cell` (`cohort-cell`) | 1 | 41.1 | 24.2 / 26.0 | 13.3 | 10.9 | 0.04 | 49.8 | 77.2 | 10.0–9.5 |
| | 16 | 67.7 | 215.7 / 395.8 | 14.3 | 200.6 | 0.02 | 52.7 | 69.0 | 9.5–9.1 |
| | 32 | 66.8 | 454.8 / 721.5 | 14.3 | 439.5 | 0.02 | 55.7 | 68.5 | 9.1–8.2 |

Widths 8 and 32 for `shared-fresh` and 8 for `process-per-cell` are in `route-26.13.0.json`; they fall between the rows shown.

The route tops out at 62–72 accepted per second at every width and in every layout, because the type check runs synchronously on the supervisor's main thread at about 14 ms each. Wider runs only queue behind it: the check and run columns grow with width while throughput doesn't. The layout still decides the cost: `shared-reuse` spends 27–34 ms of CPU per accepted attempt against 48–56 ms for a fresh Worker per attempt, and 20–26 MiB per active attempt against 69. Moving the check into the cohort, so it scales with width, is the next step for this lane and isn't done here.

## Recovery from a fatal error

One `map-table-limit` or `string-regex` attempt injected halfway through a stream of `width` × 60 benign attempts of about 3 ms each, 3 reps per kind. Blast radius counts every attempt reported `outcome_unknown`, the breacher included. No attempt was retried, and every queued attempt completed. Node 26.13.0.

| Arm | Width | Clean stream ms | With a fatal, ms | Blast radius | Spawns | Loss to the replacement's first result, ms | Load |
|---|---|---|---|---|---|---|---|
| `shared-reuse` | 8 | 230 | 359–371 | 8 (7 innocent) | 1 | 37.1–37.8 | 8.2–8.5 |
| | 16 | 258 | 405–414 | 16 (15 innocent) | 1 | 41.1–50.2 | 8.5–9.3 |
| | 32 | 619 | 697–786 | 32 (31 innocent) | 1 | 46.1–54.6 | 9.3–11.3 |
| `shared-fresh` | 8 | 611 | 744–1,060 | 8, or 1 when the breacher outlived the stream | 1 | 35.4–38.7 | 11.3–11.9 |
| | 16 | 1,214 | 1,267–1,547 | 16, or 1 | 1 | 47.5–54.8 | 11.9–12.2 |
| | 32 | 3,069 | 3,163–3,434 | 32 | 1 | 44.8–54.1 | 15.1–23.4, partly *loaded* |
| `cohort-cell` | 8 | 482 | 521–927 | 0 | 1 | under 3.3 | 18.1–18.3, *loaded* |
| | 16 | 1,321 | 1,333–1,747 | 0 | 1 | under 1 | 16.1–18.1, *loaded* |
| | 32 | 3,007 | 3,083–3,492 | 0 | 1 | under 1 | 11.1–16.1 |

The breacher took 134–325 ms to reach the fatal limit in `shared-reuse`, and the replacement's first result came 37–55 ms after the loss. On Node 22.23.3 at width 16, `map-table-limit` took about 500 ms to die, by which time its 959 neighbours had finished, so the blast radius was 1 (load 3.5–4.6).

What a fatal costs `shared-reuse`, then: one process start, about 40–55 ms before work resumes, and `width − 1` innocent attempts that the caller has to admit again as new attempts. At width 16 with 3 ms attempts that's 15 × (3 + 0.9) ms of CPU plus a process start. `cohort-cell` pays 23 ms more CPU than `shared-reuse` on every attempt at width 16, so the shared cohort costs less unless roughly one attempt in four is fatal. A trust cohort with that failure rate, or one whose attempts can't be admitted again, should use `createContainedPool`.

## Predictions 13–17

13. `shared-reuse` within 20% of `process-cell` in attempts per second at every width on the trivial guest: **held on Node 22** (−16%, −8%, +2%, −3%), and on Node 26 **held except at width 8**, where `shared-reuse` was 21% faster (+6%, +21%, −6%, −9%). Both beat `cohort-cell` by at least 3× at width 8 and above: **held**, 11–59×.
14. RSS per active attempt at width 16: `shared-reuse` 15–30 MiB, **held** at 26.0; `shared-fresh` 20–35, **held** at 22.9; `cohort-cell` and `process-cell` 60–80, **held** at 75.8 and 69.5. At least twice the per-process arms' active attempts in 4 GiB: **held**, 178 against 59 and 55.
15. Layouts within 25% of each other in accepted per second on the route at width 16: **held**, 67.2–71.7, because the type check on the supervisor is the ceiling.
16. A fatal in a shared cohort reports between 1 and `width` attempts `outcome_unknown`, loses nothing queued, costs 1 spawn and under 100 ms from the loss to the replacement's first result: **held**, 35–55 ms. Elapsed cost dominated by the breacher's own time to the fatal limit: **held**; in `shared-reuse` the breacher's 134–325 ms and the replacement's 37–55 ms make up the 80–170 ms difference.
17. 0 process spawns and 0 Worker starts per warm attempt for `shared-reuse`: **held**, 0 and 0.005 (the initial `width`, spread over the run). 1 Worker start per attempt for `shared-fresh` and `cohort-cell`: **held**. 2 IPC messages per attempt without ports: **held** in every arm.

## The decision, and where it departs from the rule

Amendment 2's rule: the highest accepted per second on the route at width 16, and within 10% the lower RSS per active attempt. All three layouts landed within 7% (67.2–71.7), and `shared-fresh` had the lowest RSS per active attempt, 18.2 MiB to `shared-reuse`'s 21.8. **Read literally, the rule picks `shared-fresh`. The shipped default is `shared-reuse`, and that's a departure from the precommit.** The route's throughput tie comes from the supervisor's type check, not the runtime, and the rule didn't anticipate that. Off the route, `shared-fresh` runs 14–22× fewer attempts per second than `shared-reuse` and spends 13–21× the CPU per attempt; on the route it spends about twice the CPU per accepted attempt (53.4 against 27.3 ms) to save 3.6 MiB per active attempt. Resource pressure counts CPU too, so `shared-reuse` is the default. `shared-fresh` stays available as `reuse: false`.

`createContainedRunner` now defaults to `reuse: true`. `tools/tscheck/contained-route.mjs` defaults to `layout: 'shared-reuse'` and also takes `'shared-fresh'` or `'process-per-cell'`. `createContainedPool` is the option for a cohort whose failure budget can't share a process.

## Reliability note

The guest context is the same in every arm. These results were measured first, under Amendment 1; the full tables are in this file's history and in the receipts.

- **Escapes.** 67 attacks per Node, checked from outside the guest. In the final suite no stripped arm reached authority or a host-realm object on Node 26 or 22. `shared-reuse` was run again on both Nodes after this change: 0 reached, 0 host-realm objects (`receipt/pressure/attacks-*.json`). One leak was found and fixed along the way: a host-realm error object reached the guest through a stack overflow in Node's stack-trace callback, and `import()` near an overflow did the same. Code generation was off, so no authority was reached. The guest realm now fixes `Error.stackTraceLimit` and `Error.prepareStackTrace`, and any `import(` is refused before the guest runs.
- **Assume-breach.** With the real host `process` handed to the guest on purpose, the permission model alone denied file, child-process and addon access, but not a new Worker, a signal, or the network on Node 22. The hardened Worker realm removes those routes.
- **Neighbours.** Heap, stack and deadline breaches cost only their attempt in every Worker arm. Four V8 fatal kinds end the whole process whatever a Worker's `resourceLimits` say, which is the failure scope measured above.
- **Deadlines.** Enforced from outside. On the committed runner at load 7–11, every interruptible runaway ended within 36 ms of a 200 ms deadline at p95 on both Nodes, and no guest extended a deadline.
- **Determinism.** Two runs were byte-equal for every guest in the determinism set on each Node, for `shared-reuse` as for `cohort-cell`, and the two arms gave identical outputs on Node 26. Across Nodes, stack depth, the reachable-global count and the last digit of `Math.pow` differ, so a verdict is bound to its Node.
- **Against AssemblyScript**, 20 P-15 scalar needs, load not recorded: `asc -O3` compile p50 31.6 ms and a wasm run 0.01 ms; the TypeScript check 17.3 ms and a contained run twice 12.4 ms with a fresh Worker per attempt. All 20 passed.

## What this does not show

- It isn't an OS sandbox or a Spectre boundary, and V8 memory-safety bugs aren't tested. No cgroup bounds the cohort.
- All timings are from a shared desktop. Rows marked *loaded* aren't acceptance figures, and the spin-200,000 batch was loaded throughout.
- The memory budget is fitted from trivial guests. A guest that uses its heap raises the marginal; the hard bound per Worker is its heap limits plus what the RSS watchdog allows.
- The route was measured on Node 26 only, with the check on the supervisor's main thread, so its ceiling says nothing about the runtime arms beyond that.
- Recovery used two fatal kinds at three widths, and only `shared-reuse` at width 16 on Node 22.
- Admitting `outcome_unknown` attempts again is the caller's job and isn't implemented or measured here.
