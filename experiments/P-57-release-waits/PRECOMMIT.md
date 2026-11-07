# P-57 waiting releases compute: precommit

Label: **Proposed** procedure, frozen 2026-11-07 before measurement. No model calls and no spending: every model is a scripted stub with a set delay.

Question: [P-50](../P-50-in-isolate/RESULT.md) put the agent loop in the workcell, and its acceptance table records a failure against Edition 3 §9: during a model turn the cell stays held and idle. If a candidate waiting on its model instead parks its continuation in the task's ledger and gives the cell back, and each reply is a fresh admission into any free cell, how many more candidates does one machine carry, how busy are the cells, and how many non-model milliseconds does each resume add to P-50's 116 ms p50?

## Design under test

`createLoopPool({waits})`, `release` by default, `hold` for the P-50 behaviour.

- A cell runs the loop until it needs a model reply, then ends its job with status `waiting` and the continuation: stage, turn, messages, file overlay, the agent receipt and the compiler identity.
- Once the task is frozen and the conversation holds a reply that no durable record has, the supervisor writes `{cell, host}` to `x1_continuations` in the task's ledger, one bridge request, digest checked, before it calls the model. The host part is its own shadow of the files and its call and token counts. Other waits aren't written: before the freeze nothing about the task is durable and a lost wait starts again from the caller's need, as in P-50; a wait with no reply yet is rebuilt from the frozen evaluator. No cell is held during any model call.
- The reply is a fresh admission: the supervisor rechecks deadline, call and token limits, and on recovery the record's digest; the new job, in any free cell, rechecks the frozen evaluator against its digest, the cell's implementation files against the frozen bundle, the frozen files against the continuation, and the compiler identity against the one the continuation was parked under.
- Fencing: a park names the continuation it resumes, and the ledger refuses one that is not the latest waiting row. The commit closes the last one in the receipt's transaction, so a continuation resumed twice cannot reach a promotion.
- A model call that fails, or a deadline passed during it, ends the attempt as before: after admission, an inconclusive receipt, which closes the continuation. A supervisor gone during the wait leaves the continuation waiting; a rerun resumes it and asks the model again, treating the lost call as never answered.

## Arms

Process cells (the default) throughout, the 21 kernels of P-50's corpus and its stage-scripted replies, 2 model turns per candidate (specification, implementation), under `HEAVY_SLOTS=4 heavy-run`.

- `serial-hold`, `serial-release`: 1 cell, one candidate at a time, replies at once. 5 reps of the 21.
- `swarm-hold`, `swarm-release`: 4 cells, 64 candidates submitted at once (the corpus cycled), each turn delayed by a seeded uniform 2–4 s.
- `swarm-release-256`: as `swarm-release`, 256 candidates, for memory per waiting candidate.

## Measures

- **Non-model ms**: attempt wall minus time inside the provider call, nearest-rank p50 and p95. **Added per resume** is (`serial-release` p50 − `serial-hold` p50) / 2, since each candidate has two waits.
- **Crossings per wait**: bridge requests by action and cell jobs per candidate, counted by wrapping `pool.ledger.request` and `pool.run`; each park request's own time is recorded.
- **Cell held at the send**: `pool.stats.busy` read in the provider at each send, serial arms.
- **In flight**: candidates between their first model send and their return; peak, sampled at each send and return. **Waiting at once**: peak concurrent provider calls.
- **Throughput**: candidates finished per minute over the arm's wall time.
- **Slot occupancy**: `pool.busyMs / (cells × wall)`. **Useful occupancy** subtracts model time spent inside a job, which is all of it under `hold` and none under `release`.
- **Memory**: summed RSS of the run's process tree (supervisor, cells, bridge), sampled every 250 ms; peak per arm. RSS double-counts shared pages, so it overstates. **In flight per GiB** is peak in flight over peak GiB. **Marginal memory per waiting candidate** is (`swarm-release-256` peak − `swarm-release` peak) / 192.
- Each arm records the 1-minute load at start and end; above 16 at either, its timings are labelled loaded and don't count for W4.

## Bar, fixed here

- **W1** No cell held while waiting: `busy` is 0 at every send in `serial-release`, and 1 at every send in `serial-hold` as the control.
- **W2** At 4 cells and 64 candidates, `swarm-release` peak in flight is at least 8× `swarm-hold`'s.
- **W3** Throughput at 4 cells and 64 candidates is at least 5× `swarm-hold`'s.
- **W4** Added non-model ms per resume at most 25 ms at p50, and the only new crossing is one bridge request per parked wait; cell messages per turn stay 2.
- **W5** Verdicts unchanged: every candidate's `promoted` equals the corpus expectation in all arms, and `make loop-test` passes with `release` as the default, plus `loop-waits.test.mjs`.
- **W6** In flight per GiB at 64 candidates is at least 5× higher under `release`.

W1 or W5 failing means `hold` becomes the default again and the failure is named. W2, W3, W4 or W6 failing is reported as measured, with no retuning.

## Predictions

1. `serial-hold` non-model p50 120–170 ms (P-50: 116 at load 10–12; load is higher now).
2. Added per resume 5–15 ms at p50, averaged over a candidate's two waits: a new job's dispatch and port for each, plus for the one parked wait a WAL commit with `synchronous=FULL` (P-50 measured a 9.4 ms fsync p50 on this disk) and the bridge round trip, park p50 8–20 ms. Bridge requests per candidate: 1 park for kernels that pass, 2 for the 3 that fail to compile and take a third turn; nothing else new.
3. W1 holds: 0 and 1.
4. `swarm-hold` peak in flight 4, `swarm-release` 64. Wall for 64: hold 90–110 s, release 8–15 s; throughput gain 7–12×.
5. Slot occupancy: hold 90–100% with useful under 5%; release 5–30%, all useful.
6. Peak RSS: each process cell 120–250 MB; hold-4 and release-64 both 0.7–1.3 GiB, so in flight per GiB 3–6 under hold and 50–90 under release. Marginal memory per waiting candidate 0.05–1 MB, so at least 1,000 waiting per GiB beyond the cells.
7. `swarm-release` non-model p50 300–1,500 ms: one bridge process serializes 64 freezes (each a new SQLite file), about 70 parks and 64 commits, as the 8-cell arms of P-50 were bridge-bound at 562 ms. The bridge, not the cells, becomes the width limit.

## Limits

One shared desktop, no quiet gate, Node as recorded. Stub models: their delay is a constant distribution, not a real model's, and no tokens are spent. The corpus kernels are synthetic. RSS isn't PSS. A power loss isn't tested; WAL with `synchronous=FULL` is relied on, as in P-50.
