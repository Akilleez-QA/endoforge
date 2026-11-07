# P-59 group-commit ledger writer: result

Status: **Recorded (probe)**, 2026-11-07, Node v26.13.0, Python 3.14.9, 32 threads, 125 GiB, under `HEAVY_SLOTS=4 heavy-run`, ledgers and journal on btrfs NVMe. The 1-minute load was 5.0–15.7 at every arm's start and end, so every arm is labelled acceptance. Stub models only, with no tokens spent. Precommit: [PRECOMMIT.md](PRECOMMIT.md), frozen at `13a3d80` (15:10 EST) with amendment 1 at `f9cb94e` (15:45), both pushed before the acceptance run (15:45–15:52). Receipts: [receipt/disk](receipt/disk/).

**The ledger now carries 94.7 accepted candidates a second, 15.2× the bridge P-57 measured, with 0.22 disk syncs per candidate instead of 24.3 and 9.8 ms of writer CPU instead of 50.2. In the full loop, `swarm-release` non-model time fell from 1,677 to 113 ms at p50 and `swarm-release-256` from 18.4 to 2.0 s, with throughput at 256 up from 489 to 1,114 candidates a minute. All 24 SIGKILL trials kept every acknowledged event exactly once, including 12 with the ledger files deleted after the kill.**

The bottleneck was disk syncs, not spawns or CPU: every task has its own SQLite ledger, so batching per path shared nothing and each request paid its own `synchronous=FULL` commit, plus schema setup on open and a checkpoint on close or eviction. The writer now commits each ledger without a sync and makes the whole batch durable with one `fdatasync` of a shared journal before answering.

## Speed and resources

| Arm | Accepted/s | Non-model p50 / p95 ms | Disk syncs per candidate | Python spawns per candidate | Writer CPU per candidate | Writer peak RSS |
|---|---|---|---|---|---|---|
| `ledger-new` (4,096 at width 1,024) | **94.7** | 2,601 / 3,738 | **0.218** | 0.00024 (1 process) | 9.85 ms (7.05 user, 2.80 sys) | 628 MiB |
| `ledger-old`, P-57's bridge (1,024 at width 1,024) | 6.25 | 142,868 / 153,203 | 24.3 | 0.00098 (1 process) | 50.2 ms | 512 MiB |

`ledger-new` in detail: 12,873 requests in 1,204 batches (10.7 a batch, at most 128); 882 journal `fdatasync`s (0.73 per batch), 6 directory syncs for new segments and 6 `syncfs` retirements, every one counted by the `LD_PRELOAD` shim, so 894 syncs over 4,096 candidates. The journal wrote 190 KB per candidate, about the size of the ledger rows themselves. Request latency at p50 was 788 ms for `admit`, 855 for `park` and 607 for `commit`: with 1,024 candidates starting together, their model waits end in bursts, and the writer used 40.3 CPU-seconds in the run's 43.2 s, nearly all on its one main thread. That CPU, at about 10 ms a candidate, is the next limit of the ledger alone, near 100 candidates a second.

Full loop, P-57's arms with the new writer, against [P-57's disk run](../P-57-release-waits/RESULT.md):

| Arm | Wall | Throughput / min (P-57) | Non-model p50 / p95 ms (P-57 p50) | Freeze p50 (P-57) | Park p50 / p95 (P-57) | Commit p50 | Bridge syncs per candidate | Bridge CPU per candidate | Peak tree RSS |
|---|---|---|---|---|---|---|---|---|---|
| `serial-hold` | 6.3 s | 994.3 (537.7) | 61.3 / 74.3 (112.3) | 8.5 (61) | n/a | 9.4 | 2.02 | 7.6 ms | 1,128 MiB |
| `serial-release` | 7.7 s | 815.8 (482.7) | 72.2 / 93.2 (124.5) | 9.0 (61) | 7.2 / 12.6 (7.2) | 8.6 | 3.16 | 8.4 ms | 1,368 MiB |
| `swarm-hold` (4 cells, 64) | 103.8 s | 37.0 (36.7) | 47,506 / 94,435 (47,916) | 8.9 (61) | n/a | 9.1 | 2.03 | 7.5 ms | 2,480 MiB |
| `swarm-release` (4 cells, 64) | 10.8 s | 357.2 (297.3) | **112.8** / 174.2 (1,677) | 13.9 (267) | 11.3 / 45.5 (206) | 9.5 | 2.86 | 11.3 ms | 2,210 MiB |
| `swarm-release-256` (4 cells, 256) | 13.8 s | **1,113.5** (489.4) | **1,992** / 2,547 (18,402) | 19.9 (288) | 16.9 / 31.2 (228) | 13.7 | 1.83 | 9.4 ms | 2,810 MiB |

P-57's own profile of its bridge counted 14.1 syncs per candidate at 64 and 20.1 at 256 ([profile-before](receipt/profile-before/)). In the serial arms each request is alone in its batch, so it costs one journal sync, against 3–4 SQLite syncs before; at width the syncs are shared. The bridge stayed at 149–150 MiB RSS in every loop arm. At 256, ledger requests take 14–20 ms at p50 and the four cells, each candidate needing 3.14 jobs, set the pace.

## Bar

| Item | Result | Evidence |
|---|---|---|
| L1: at least 64 accepted candidates/s, all decisions as expected | **Pass** | 94.7/s; 4,096 of 4,096 decisions equal the corpus expectation (promote for 18 kernels, refuse for 3). |
| L2: at most 1 disk sync per candidate, at most 1 per batch on the request path | **Pass** | 0.218 per candidate counting every `fsync`, `fdatasync` and `syncfs` of the writer process; 0.73 journal syncs per batch. |
| L3: no acknowledged event lost or duplicated across 24 SIGKILL trials; unacknowledged requests `outcome_unknown`, not resent, all or nothing | **Pass** | 24 of 24 trials, 6 at each kill point, 12 with every trial ledger file deleted after the kill. 2,949 acknowledged events all present once (1,590 of them only through journal replay, 1,658 frames replayed); 1,536 unacknowledged requests all rejected with `outcome_unknown`, none resent, each wholly present (306) or absent (1,230); every chain verified with `Ledger.records()`; 0 conflicts. |
| L4: torn tails detected and quarantined, never read as empty; chain tests unchanged | **Pass** | `test_writer.py`: a frame cut mid-write, a corrupted last frame and trailing garbage are each copied to a `.torn-<offset>.<ns>` file and cut, with every earlier frame replayed into deleted ledgers; corruption before a valid frame refuses to start. The 6 `half_frame` trials each quarantined one torn tail. `make ledger-test` passes with its test files unchanged. |
| L5: no regression on P-57 | **Pass** | W1: `busy` 0 at all 225 sends in `serial-release`, 1 at all 225 in `serial-hold`. W2: peak in flight 64 against 5 (12.8×). W3: 357.2 against 37.0 a minute (9.7×). W4: (72.2 − 61.3) / 2 = 5.5 ms per resume; bridge requests per candidate admit 1, park 1.14, commit 1 and 3.14 cell jobs, as in P-57. W5: no wrong verdict in any arm (90 of 105, 55 of 64, 220 of 256 promoted, 0 errors); `make loop-test` 138 of 138. W6: 29.7 against 2.1 in flight per GiB (14.4×). `swarm-release` non-model p50 112.8 ms against 1,677. |

## Predictions

1. `ledger-new` 110–170/s: **failed**, 94.7. The writer's single thread, not the width, bounds it.
2. `ledger-old` 6–10/s: **held**, 6.25.
3. 0.05–0.5 syncs per candidate: **held**, 0.218, against 24.3.
4. Writer CPU 3–8 ms per candidate: **failed**, 9.85 ms. Peak RSS 150–400 MiB: **failed**, 628 MiB: up to 1,024 cached ledgers with their parsed records, plus queued requests in a burst.
5. Request p50 under 20 ms in `ledger-new`: **failed**, 607–855 ms, from bursts against a busy writer. In the loop arms it was 7–20 ms.
6. `swarm-release-256` non-model p50 1–5 s, 900–1,800 a minute: **held**, 1,992 ms and 1,113.5.
7. `swarm-release` non-model p50 600–1,400 ms: **failed** low, 112.8 ms. Most of P-57's 1,677 ms was waiting on the bridge rather than queueing for cells: with the same four cells it is now 113 ms.
8. Crash trials pass with 6–12 torn tails: **held**, 6.

## What this changes and what it doesn't

- The ledger is no longer the width limit of the released loop: at 4 cells and 256 candidates its requests take under 20 ms at p50 and the cells set the pace. On its own it carries about 95 candidates a second, bounded by one Python thread's CPU (validation, JSON, SQLite), so a second writer process per group of ledgers, or less work per request, is the next lever there. It isn't measured here.
- Durability is now one journal frame per batch. A request is answered only after the frame with its writes is synced; SQLite commits without a sync and a power loss is repaired by replaying the journal. The ledger files on their own are a consistent prefix, so after a power loss, a reader that opens a ledger before any writer has started and recovered may see fewer records than were acknowledged.
- Crossings are unchanged: one bridge request per ledger action, one bridge process per pool, no spawn per request.

## Limits

- Development smoke runs before amendment 1 shaped the commit window and batch cap; the acceptance arms ran once, after it.
- `ledger-old` ran 1,024 candidates, not 4,096, so the two ledger arms differ in length as well as writer.
- Stub models with a fixed delay distribution, synthetic kernels, one shared host whose other lanes write to the same btrfs filesystem; `syncfs` at retirement also flushes their data.
- Power loss is simulated by deleting the trial's ledger files after a SIGKILL, with the journal kept. The disk's own write ordering and a real power cut aren't tested, and neither is a kill during recovery.
- The crash trials used the writer with captured P-57 requests and no cells; supervisor and cell kills are covered by `loop-crash.test.mjs`, which passes.
- RSS isn't PSS.
- The acceptance run measured `f9cb94e`. One later change, `38d0f76`, gives each quarantined tail a unique file name so a recovery interrupted after copying a tail can run again; it touches only recovery and wasn't re-measured.
