# P-25 RESULT: pool throughput and the supervisor ledger

Precommit: `PRECOMMIT.md`, sha256 in `receipt/precommit.sha256`. Before phase: `receipt/before-2026-11-02` (main 04d2d7e). After phase: `receipt/after-2026-11-02` (main with PR #48, persistent batched ledger bridge, merge 4f8d67b). Node v22.23.3, main-rig, under `flock /tmp/ef-bench.lock`.

## L1: is the ledger the limit? (before phase)

| Check | Rule | Measured | Verdict |
|---|---|---|---|
| (a) predicted ceiling vs measured, width 16 | within 30% | 1000 / (42.8 + 47.3) = 11.1/s vs 11.89/s (7%) | Holds |
| (b) supervisor ledger ms vs in-cell check ms, width 16 | >= 5x | 1264 ms vs 36.0 ms (35x) | Holds |

L1 holds, so the after phase ran.

## Fix
PR #48 replaced one `python3` spawn per prepare and per append with one persistent bridge per pool. The bridge groups queued requests per ledger path in one `BEGIN IMMEDIATE` transaction with a savepoint per request, and answers only after commit. Every read still recomputes every stored row's hash against the chain. A cached prefix skips only re-validation of rows whose sequence, hash and body match, and every new record is still validated against all prior records.

## Targets (after phase)

| Target | Threshold | Before | After | Verdict |
|---|---|---|---|---|
| T1 thread checks/s, width 16 | >= 150 | 11.89 | 152.9 | Pass |
| T2 failed checks; ledger verifies with `Ledger(path)` | 0; every width | 0; yes | 0; yes (all six ledgers) | Pass |
| T3 existing pool and ledger tests, Node 22 and 26 CI | unchanged, pass | | pass on #48 at af530e6 | Pass |

## Ramp

| Mode | Width | Checks/s before | Checks/s after | Check ms p50 after | Ledger ms p50 before → after |
|---|---|---|---|---|---|
| thread | 1 | 9.18 | 23.26 | 37.2 | 74.2 → 4.6 |
| thread | 4 | 12.35 | 67.84 | 38.7 | → 18.5 |
| thread | 8 | 12.28 | 102.98 | 42.7 | → 32.2 |
| thread | 16 | 11.89 | 152.91 | 47.4 | 1264 → 51.4 |
| thread | 32 | 11.33 | 189.92 | 67.1 | → 75.5 |
| process | 16 | 12.20 | 154.89 | 44.9 | → 48.2 |

The microbench (prepare 41.7 ms, append 45.9 ms) is unchanged because it times the one-shot bridge, which the fix keeps for direct callers.

## What it does not show

- Margin: T1 passed by 2%. A non-receipt smoke run on the same code an hour earlier measured 164.5/s, so run-to-run variance is about the size of the margin. One run per width.
- Where the remaining time goes. At width 16 the ledger and the in-cell check are now similar (51 and 47 ms), and the in-cell check slows as width rises, so host CPU now matters as much as the ledger.
- Behaviour on ledgers much larger than about 2,000 records, or with many concurrent pools.
- The 324 checks/s direct figure was not re-measured.
