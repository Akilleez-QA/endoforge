# P-22 result: real need to candidate

Real run on 2026-11-01, 21:40 to 21:56 ET, under the hashed PRECOMMIT
(`a7a721c4…07c6`), Node v22.23.3, concurrency ten, shared benchmark lock held,
real Codex generation, AssemblyScript 0.28.20, pool G1–G7 gates, linked ledger
and local EndoForge qualification policy. No warmups, retries or exclusions.
All 60 records completed; 41 promoted. Total wall time 929.3 s.

Stage latency in ms, nearest-rank p50 / p95 with sample counts. Read is under
1 ms in every cohort and is omitted. Wall time is per cohort in seconds.

| Mode | Cohort | Promoted | Wall s | Generate | Freeze | Compile | Gate | Ledger | Promote | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| thread | P21 | 13/20 | 334.8 | 129630 / 161869 (n=20) | 38 / 49 (n=20) | 524 / 563 (n=20) | 186 / 256 (n=20) | 115 / 127 (n=20) | 37 / 46 (n=20) | 130385 / 162709 (n=20) |
| thread | P19 | 9/10 | 126.1 | 95635 / 125162 (n=9) | 38 / 40 (n=9) | 526 / 548 (n=9) | 196 / 243 (n=9) | 114 / 119 (n=9) | 38 / 44 (n=9) | 96569 / 126082 (n=10) |
| process | P21 | 9/20 | 305.3 | 119956 / 175331 (n=20) | 39 / 48 (n=20) | 564 / 640 (n=20) | 90 / 226 (n=20) | 115 / 124 (n=20) | 37 / 40 (n=20) | 120864 / 176181 (n=20) |
| process | P19 | 10/10 | 163.1 | 94116 / 162205 (n=10) | 38 / 41 (n=10) | 523 / 587 (n=10) | 189 / 203 (n=10) | 111 / 119 (n=10) | 38 / 44 (n=10) | 95050 / 163056 (n=10) |

Generation is 98–99% of total latency. Everything after generation (freeze,
compile, gate, ledger, promote) sums to roughly 0.8–0.9 s at p50.

## Refusals and failures

19 of 60 did not promote; every one is retained in `receipt/real-2026-11-01/refusals.json`
and `summary.json`.

- 15 refused at G7 only: generated glue declared numeric results without a
  precision field (P-21 cohort, both modes).
- 2 refused at G4 only and 1 at G4 and G7: generated code failed its own
  frozen tests.
- 1 failed in generation (thread, add-3): no candidate passed the generate stage;
  later stages are null.

## Old vs new

| Measurement | Requests | p50 | p95 |
|---|---|---|---|
| P-21 Oct 17 (Codex loop, old pipeline) | 20 | 96.5 s | 146.2 s |
| P-21 Oct 18 | 20 | 29.4 s | 53.7 s |
| P-21 Nov 1 | 20 | 59.4 s | 83.6 s |
| P-19 synthetic (no generation) | add ×10 | — | 2.119 s thread / 2.156 s process |
| P-22 P-21 cohort, thread | 20 | 130.4 s | 162.7 s |
| P-22 P-21 cohort, process | 20 | 120.9 s | 176.2 s |
| P-22 P-19 cohort, thread | add ×10 | 96.6 s | 126.1 s |
| P-22 P-19 cohort, process | add ×10 | 95.1 s | 163.1 s |
| P-22 post-generation stages | all | ≈0.8–0.9 s | ≈1.0 s |

## What it does not show

- It does not show the new pipeline is slower at verification: P-22 adds two
  Codex sessions with a durable freeze before implementation, which P-21 did
  not, so the end-to-end numbers are not like for like.
- Generated tests are not independent domain oracles; a promotion means the
  candidate passed its own frozen tests, G1–G7 and a verified chain, not that
  the engineering answer is right.
- Promotion is local qualification in EndoForge; POODO has no callable API and
  nothing was activated or deployed.
- One run per mode; Codex latency depends on the remote service at that hour.
- The harness ran from commit `8376ef5`, whose non-fake path matches main.
