# P-25 PRECOMMIT: pool throughput and the supervisor ledger

Written before any P-25 measurement. Code under test for the before phase: endoforge main 04d2d7e.

## Question
The P-20 addendum measured about 11 jobs/s through IsolatePool at widths 4 to 48, against 324 checks/s for the same bwrap check run directly (2026-10-29). The in-cell check took 34 to 43 ms. Is the limit the supervisor ledger, which runs one `python3` bridge per prepare and per append, chained one at a time, and re-reads and re-verifies the whole chain on every call?

## Protocol
Main-rig, Node 22.23.3, held under flock /tmp/ef-bench.lock. Same bwrap isofix check and the same P-20 addendum ramp port.
1. Ledger microbench: with no cells running, call the bridge directly, alternating prepare and append for one receipt, on one ledger, 200 jobs in a row. Record each call's ms and the ledger size.
2. Ramp: thread IsolatePool at widths 1, 4, 8, 16, 32. Each width is a fresh ledger, a 10 s window after one warm job per cell, and `timing: true` on every job. Record checks/s, pool ms, in-cell check ms, and the supervisor's gate and ledger ms.
3. Process mode at width 16 only, same window.

## Decision rule (fixed now)
L1. The ledger is confirmed as the limit if, at width 16, (a) the ceiling predicted from the microbench, 1000 / (median prepare ms + median append ms) at the ledger sizes reached, is within 30% of measured checks/s, and (b) the median supervisor ledger ms per job is at least 5x the median in-cell check ms.
If L1 fails, the report says the ledger is not shown to be the limit, and the after phase is not run.

## After phase (only if L1 holds)
After a fix merges, the same harness runs again at the fix commit, under the same lock, into a separate receipt. The fix must leave chain verification at least as strong: every operation still recomputes the hash of every stored row against the chain, and still validates each new record against all prior records.
T1. Thread checks/s at width 16 is at least 150.
T2. Zero failed checks, and the ledger written by each width verifies in full with `Ledger(path)` after the run.
T3. All existing pool and ledger tests pass unchanged, on Node 22 and 26 CI.
Any miss is reported as a miss.
