# P-23 RESULT: generator contract and faster sessions, P-22 re-run

Precommit: `PRECOMMIT.md`, sha256 in `receipt/precommit.sha256` (97a1b1e6…). Valid run: `receipt/real-2026-11-01` (Node v22.23.3, the P-22 Node version, started 2026-11-01 22:58 EST). Wall time 433.5 s for 60 records (P-22: 929.3 s).

## Targets

| Target | Threshold | P-22 | P-23 | Verdict |
|---|---|---|---|---|
| T1 precision refusals | 0 | 16 | 0 | Pass |
| T2 add total p50, thread / process | <= 48 s | 96.6 / 95.1 s | 43.1 / 39.8 s | Pass |
| T3 P-21 total p50, thread | <= 91.3 s | 130.4 s | 62.4 s | Pass |
| T3 P-21 total p50, process | <= 84.6 s | 120.9 s | 67.4 s | Pass |
| T4 promoted | >= 41/60 | 41/60 | 26/60 | Miss |

## Latency (s, p50 / p95)

| Mode | Cohort | Promoted | Generate | Total |
|---|---|---|---|---|
| thread | P-21 | 9/20 | 61.2 / 77.7 | 62.4 / 78.7 |
| thread | add | 3/10 | 42.0 / 53.0 | 43.1 / 53.9 |
| process | P-21 | 9/20 | 66.2 / 102.0 | 67.4 / 103.0 |
| process | add | 5/10 | 38.7 / 44.7 | 39.8 / 45.7 |

Post-generation stages (freeze, compile, gate, ledger, promote) stay near 1 s in total.

## Refusals

34 of 60 did not promote; each is in `receipt/real-2026-11-01/refusals.json`, with the reason and failed gates read from its ledger receipt.

- 32 failed at G4 only: the generated kernel failed its own frozen tests.
- 2 failed at G4 and G7: C-015 and C-016 (process). The glue did not label the return codes used in the tests. Neither cites precision.

The contract-up-front fix removed the precision failure class (16 to 0). G7 failures fell from 16 to 2. G4 failures rose from 3 to 34. Faster sessions traded correctness for speed. The run cannot attribute that loss to resumed sessions or auto effort, because both changed together.

## Invalid run A

The first attempt (`receipt/invalid-node26-2026-11-01`) ran on main-rig's `/usr/bin/node` v26.12.0, which a system upgrade installed on 2026-10-18. It promoted 0/60 because every workcell exited with code 13. Node 26 does not lazily instantiate undici WebAssembly, and the workcell's unreferenced startup timer let the event loop empty. PR #41 fixed this and added Node 26 to CI. Run A is excluded from the targets, and the targets were not revised.

## What it does not show

- Which change caused the G4 regression (resume session or auto effort). An ablation that varies one setting at a time is needed.
- Variance: one run per mode, with no repeats.
- Whether the speed holds on other hardware, other Codex accounts or a different model load.
- Correctness beyond each candidate's own frozen tests and the G1–G7 gates.
