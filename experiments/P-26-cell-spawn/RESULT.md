# P-26 RESULT: cell spawn and instantiate overhead

Precommit: `PRECOMMIT.md`, sha256 in `receipt/precommit.sha256`. Before phase: `receipt/before-node22-2026-11-02`, `receipt/before-node26-2026-11-02`. After phase: `receipt/after-node22-2026-11-02`, `receipt/after-node26-2026-11-02`, on main cd1325f (PR #44 undici 8 startup skip, PR #47 pre-warm, PR #48 persistent ledger bridge). Node v22.23.3 (undici 6.28.1) and v26.12.0 (undici 8.11.2), main-rig, under `flock /tmp/ef-bench.lock`, size-1 pools, 10 reps per row.

## Targets

| Target | Threshold | Before | After | Verdict |
|---|---|---|---|---|
| S1 Node 26 spawn cost median, thread / process | <= 300 ms | 2025 / 2037 ms | 63.2 / 73.3 ms | Pass |
| S2 pre-warm first job within 20% of second job, all four | first <= 1.2 x second | | first 42.9–47.6 ms vs second 0.7–1.2 ms | Miss |
| S3 WASM guard refusal tests unchanged, Node 22 and 26 CI | pass | pass | pass on #47 at ced5deb | Pass |

## Spawn (median ms)

| Node | Mode | Pre-warm | First job before | First job after | Second job before | Second job after | Spawn cost after | First-job gate ms |
|---|---|---|---|---|---|---|---|---|
| 22 | thread | no | 100.4 | 86.3 | 65.6 | 0.9 | 85.3 | 47.3 |
| 22 | thread | yes | | 43.6 | | 1.0 | 42.7 | 3.3 |
| 22 | process | no | 118.1 | 119.0 | 64.2 | 1.3 | 117.2 | 75.5 |
| 22 | process | yes | | 47.6 | | 1.1 | 46.5 | 3.5 |
| 26 | thread | no | 2093 | 64.1 | 66.5 | 1.0 | 63.2 | 21.1 |
| 26 | thread | yes | | 42.9 | | 0.7 | 42.1 | 3.7 |
| 26 | process | no | 2101 | 74.8 | 64.1 | 1.3 | 73.3 | 33.6 |
| 26 | process | yes | | 47.5 | | 1.2 | 46.0 | 4.8 |

Pre-warm ready time (constructor to `ready()`), median: Node 22 thread 56.5 ms, process 68.9 ms; Node 26 thread 44.5 ms, process 53.5 ms.

## Why S2 missed
S2 was written when every job paid about 65 ms of per-call ledger spawns, so first and second jobs were comparable. PR #48 made the second job about 1 ms. With pre-warm the in-cell first gate falls to 3–5 ms, but the first job still pays about 40 ms to start the pool's persistent Python ledger bridge, which starts lazily on the first ledger request. Pre-warm removes the cell's share of first-job cost, not the ledger bridge's. The target is not revised; starting the bridge inside `ready()` is a candidate follow-up.

## Instantiate overhead (median µs, no target)

| Node | Mode | Cell before | Direct before | Cell after | Direct after | Cell minus direct after |
|---|---|---|---|---|---|---|
| 22 | thread | 73.7 | 12.6 | 55.6 | 16.7 | 38.9 |
| 22 | process | 54.6 | 13.0 | 68.1 | 13.9 | 54.2 |
| 26 | thread | 46.7 | 11.7 | 53.3 | 13.6 | 39.7 |
| 26 | process | 47.2 | 11.6 | 52.5 | 15.2 | 37.3 |

Instantiate overhead stays at roughly 40–55 µs per call, small next to spawn costs.

## What it does not show

- That pre-warming the ledger bridge would close S2; that has not been run.
- Behaviour with pools wider than one cell, or under concurrent load.
- Variance across runs: one run per Node version, 10 reps (3 for instantiate).
- Hardware other than main-rig.
