# P-57 waiting releases compute: result

Status: **Recorded (probe)**, 2026-11-07, Node v26.13.0, 32 threads, 125 GiB, under `HEAVY_SLOTS=4 heavy-run`. The 1-minute load was 1.5–5.3 at every arm's start and end, so every arm is labelled acceptance. Stub models only, with no tokens spent. Precommit: [PRECOMMIT.md](PRECOMMIT.md), with amendment 1.

**Waiting no longer holds a cell, and four cells now carry every candidate submitted, 64 or 256. Throughput at 64 rose 8.1× and in flight per GiB 11.5×. Each resume added 6 ms of non-model time at p50. With the cells freed, the single ledger bridge becomes the width limit: at 64 candidates the freeze and the park each wait about 200 ms for it, and at 256 a candidate's non-model time reaches 18 s.**

Two runs. `first` put its ledgers on tmpfs, where `fsync` is free (amendment 1). `disk` is the same commit's harness with the ledgers on btrfs NVMe, as in P-50. The tables are from `disk` unless they say otherwise.

## Bar

| Item | Result | Evidence |
|---|---|---|
| W1: no cell held while waiting | **Pass** | `busy` read at the send: 0 at all 225 sends in `serial-release`, and 1 at all 225 in `serial-hold`. Same in `first`. |
| W2: at least 8× the peak in flight | **Pass** | 64 against 5 (12.8×). `hold` reaches 5 on 4 cells because one candidate commits while the next one's model turn starts. |
| W3: at least 5× the throughput | **Pass** | 297.3 against 36.7 candidates a minute (8.1×). `first`: 356.6 against 36.5 (9.8×). |
| W4: added per resume at most 25 ms p50, and only one new crossing per parked wait | **Pass** | (124.5 − 112.3) / 2 = 6.1 ms at p50; 6.2 ms at p95. A park takes 7.2 ms at p50 and 13.0 ms at p95. Bridge requests per candidate went from admit 1 and commit 1 to those plus 1.14 parks. Cell jobs went from 1 to 3.14 per candidate, so there are still 2 cell messages per turn: a job's result and the next job, in place of a host call and its reply. |
| W5: verdicts unchanged | **Pass** | Promoted equals the corpus expectation for every candidate in all 10 arm runs (90 of 105 serial, 55 of 64 and 220 of 256 swarm), with 0 errors. `make loop-test` passed locally (138 of 138) with `release` as the default. CI is in the PR. |
| W6: at least 5× the in flight per GiB | **Pass** | 26.5 against 2.3 (11.5×). |

## Measures

| Arm | Wall | Throughput / min | Non-model p50 / p95 ms | Freeze p50 | Park p50 / p95 | Peak in flight | Occupancy (useful) | Peak RSS |
|---|---|---|---|---|---|---|---|---|
| `serial-hold` | 11.7 s | 537.7 | 112.3 / 124.4 | 61 | n/a | 1 | 92.1% (91.9%) | 1,350 MiB |
| `serial-release` | 13.1 s | 482.7 | 124.5 / 136.7 | 61 | 7.2 / 13.0 | 1 | 84.3% (84.3%) | 1,099 MiB |
| `swarm-hold` (4 cells, 64) | 104.7 s | 36.7 | 47,916 / 95,486 | 61 | n/a | 5 | 99.5% (1.8%) | 2,207 MiB |
| `swarm-release` (4 cells, 64) | 12.9 s | 297.3 | 1,677 / 2,490 | 267 | 206 / 215 | 64 | 38.0% (38.0%) | 2,478 MiB |
| `swarm-release-256` (4 cells, 256) | 31.4 s | 489.4 | 18,402 / 20,254 | 288 | 228 / 2,246 | 256 | 68.7% (68.7%) | 2,496 MiB |

Model time per candidate was about 6.0 s at p50 in every swarm arm (2 turns at 2–4 s). Under `hold`, non-model time is mostly the wait for a free cell, since 60 of the 64 candidates queue behind 4 cells that each sit in a model call.

Memory: a process cell is about 281 MiB RSS, from (`swarm-hold` idle − `serial-hold` idle) / 3. The remaining 1.07 GiB at one cell is the harness process (supervisor, corpus and stub provider) plus the bridge, not attributed further. Each waiting candidate costs about 0.09 MiB: (2,496 − 2,478) / 192 on disk, 0.67 MiB in `first`. RSS peaks are noisy at this scale. Roughly 10,000 continuations fit in a GiB, against 3.6 cells.

Per machine: under `hold`, in flight equals the cell count, and each cell costs 281 MiB plus a core while it waits. Under `release`, memory and cells stop being the limit; the bridge is. It finished about 8 candidates a second at 256 in flight (each candidate is one freeze, 1.14 parks and one commit, all serialized in one Python process with one `fsync` each). Past about 64 in flight at 6 s of model time, extra candidates queue for the bridge rather than running.

## Predictions

1. `serial-hold` p50 120–170 ms: **failed**, 112.3 ms at load 3. P-50's 116 ms was at load 10–12.
2. Added per resume 5–15 ms: **held**, 6.1 ms. Park 8–20 ms: **failed** low, 7.2 ms. Bridge requests 1 park for passing kernels and 2 for the 3 that fail: **held**, 1.14 per candidate: (18 × 1 + 3 × 2) / 21.
3. W1 0 and 1: **held**.
4. Peak in flight 4 and 64: **failed** for `hold`, which reached 5. Wall 90–110 s and 8–15 s: **held**, 104.7 and 12.9 s. Gain 7–12×: **held**, 8.1×.
5. Occupancy: `hold` 90–100% with under 5% useful: **held**, 99.5% and 1.8%. `release` 5–30%: **failed**, 38.0%. A cell that freezes waits inside its job for the bridge, at 267 ms, and that counts as busy.
6. Each cell 120–250 MiB: **failed**, about 281 MiB. Totals 0.7–1.3 GiB: **failed**, 2.2–2.5 GiB. In flight per GiB 3–6 under `hold`: **failed**, 2.3. Release 50–90: **failed**, 26.5. Marginal memory 0.05–1 MiB per waiting candidate: **held**, 0.09 MiB.
7. `swarm-release` non-model p50 300–1,500 ms, bridge-bound: **failed**, 1,677 ms. It was bridge-bound as predicted, by more. In `first`, on tmpfs, it was 56 ms, which puts nearly all of the gap on `fsync`.

## What this changes and what it doesn't

- E3 §9 in P-50's acceptance table moves from fail to pass on this path, for model waits. Human review and network waits aren't on this path.
- The next limit is the bridge: one process, one transaction and one `fsync` per request, each against its own task ledger. Grouping commits across ledgers, or giving each ledger its own writer, is the next lever. It isn't measured here.
- A freeze holds its cell while it waits for the bridge. Freezing between jobs, like the park, would free the cell during that wait too. It isn't built.

## Limits

- Stub models with a fixed delay distribution and no tokens.
- Synthetic kernels.
- One shared host.
- RSS, not PSS: shared pages are counted once per process.
- Peak in flight under `hold` counts a candidate from its first model call, so a candidate queued for a cell isn't in flight.
- Recovery after a supervisor loss is tested in `loop-waits.test.mjs` with a supervisor that goes silent, not with a SIGKILL of the supervisor during a parked wait. `loop-crash.test.mjs` kills the supervisor at `model`, `admitting`, `admitted` and `committing`, and all of those pass under `release`.
- A power loss isn't tested.
