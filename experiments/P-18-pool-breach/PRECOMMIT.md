# P-18 pool breach — precommit

Before measurement, record this file's SHA-256 in `receipt/precommit.sha256`.
The harness must verify that digest before starting any workcell.

Run one repetition of each combination of thread/process and heap/WASM breach,
N=8, using the real pool, evaluator, gates and supervisor-owned Python ledger.
Heap limits are 24/4 MiB; the WASM cap is 64 MiB. The heap job retains on-heap
objects until V8 exits; the WASM job requests 4096 pages (256 MiB) of growth.
Seven healthy jobs rendezvous with the breacher before allocation, then remain
mid-job until its exit receipt. Each checks a passing and forbidden-effects
candidate against the native evaluator. Queue one further good job to test
replacement. No lost job is retried. Close every pool and replay its ledger.

Record runtime, elapsed time, distinct initial workcells, workcells lost,
siblings lost, breach status/reason, replacement verdict, receipt hashes and
chain verification in `receipt/summary.json`. A lost workcell has a null report;
a lost sibling fails to complete with the full native report. Expect exactly
one lost workcell, zero lost siblings, eight distinct initial cells, a distinct
replacement, and 17 verified candidate receipts per combination. Any discrepancy
fails the harness. Record cgroup availability, without requiring delegation.

This is one synthetic local lifetime, not throughput qualification, hostile-code
containment, total-RSS enforcement, or proof of delegated cgroup operation when
delegation is unavailable. The WASM guard should reject before allocating the
requested 256 MiB. Raw temporary ledgers remain outside the source tree.
