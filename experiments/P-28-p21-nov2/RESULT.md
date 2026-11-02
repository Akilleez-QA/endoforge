# P-28 RESULT: the twenty P-21 requests, end to end, 2026-11-02

Precommit: [PRECOMMIT.md](PRECOMMIT.md), sha256 in [receipt/precommit.sha256](receipt/precommit.sha256). Code under test: main b8f0bba. Recorded run started 2026-11-02 01:39 ET; receipts in [receipt/real-2026-11-02/](receipt/real-2026-11-02/).

## Targets

| Target | Result | Verdict |
|---|---|---|
| T1 promoted >= 19/20 | 16/20 | miss |
| T2 median total <= 59.4 s | 72.6 s | miss |
| T3 whole-set wall <= 147.2 s | 168.3 s | miss |

Stage p50 / p95 (s): generate 75.4 / 94.5 (n 19), freeze 0.2 / 0.2, compile 0.5 / 0.7, gate 0.2 / 0.2, ledger 0.1 / 0.1, promote 0.0 / 0.1, total 72.6 / 94.4.

Not promoted ([refusals.json](receipt/real-2026-11-02/refusals.json)): CC-025, CC-036 and C-012 were refused at the gates (first failure `residual`, chain intact); C-007 failed in the generate stage with no candidate record.

## Reading
- Everything except generation takes about 1 s per request (freeze, compile, gate, ledger, promote). The rest is the Codex worker, so speed tracks the model and host load, not the runtime.
- The P-27 thread run three hours earlier, with the same code minus #53, gated 19/20 at a 59.3 s total p50. This run is slower and promoted fewer on the same requests. That points to Codex variance: the refusals are kernel residual failures, not bridge or ledger faults.
- Host load average at start was in [env-before.txt](receipt/real-2026-11-02/env-before.txt).

## What it does not show
- Like-for-like with P-21 Nov 1: that run used the P-21 Codex loop and gate.mjs re-gate; this one runs the full `runNeed` pipeline with promotion. Oct 17 and Oct 18 used Claude workers.
- Whether #53 changed promotion: one run only, and the misses are model-side.
- Variance: one run, one machine, at night.
