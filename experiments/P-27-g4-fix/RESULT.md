# P-27 RESULT: G4 fix confirmation, P-23 re-run

Precommit: `PRECOMMIT.md`, sha256 in `receipt/precommit.sha256` (cad45c2b…). Valid run: `receipt/real-2026-11-02` (Node v22.23.3, started 2026-11-02 00:25 EST, code under test main bbfc98a). Wall time 507.6 s for 60 records. The harness exits 1 because not every record promoted; that is its fixed rule, not a run failure.

## Targets

| Target | Threshold | P-23 | P-27 | Verdict |
|---|---|---|---|---|
| T1 promoted | >= 41/60 | 26/60 | 57/60 | Pass |
| T2 kernels containing `assert(` | <= 2/60 | not measured (P-24: 43/45 G4 refusals) | 0/60 | Pass |
| T3 total p50, thread P-21 | <= 74.9 s | 62.4 s | 59.3 s | Pass |
| T3 total p50, thread add | <= 51.7 s | 43.1 s | 38.3 s | Pass |
| T3 total p50, process P-21 | <= 80.9 s | 67.4 s | 64.9 s | Pass |
| T3 total p50, process add | <= 47.8 s | 39.8 s | 40.1 s | Pass |
| T4 `gates.mjs`, `compiler.mjs` identical to 3115829 | identical | | identical | Pass |

## Latency (s, p50 / p95)

| Mode | Cohort | Promoted | Generate | Total |
|---|---|---|---|---|
| thread | P-21 | 19/20 | 58.3 / 74.2 | 59.3 / 75.3 |
| thread | add | 10/10 | 37.0 / 51.0 | 38.3 / 52.0 |
| process | P-21 | 18/20 | 63.8 / 77.3 | 64.9 / 78.5 |
| process | add | 10/10 | 39.0 / 137.7 | 40.1 / 138.9 |

## Refusals

3 of 60 did not promote, listed in `receipt/real-2026-11-02/refusals.json`: CC-025 (thread), CC-036 and C-012 (process). Each failed G4 only, and none of the three kernels uses `assert`. G4 refusals fell from 34 to 3 with G4 and the compiler flags unchanged.

## What it does not show

- Variance: one run per mode, no repeats. The process add p95 of 137.7 s is one slow generation.
- Why the three remaining kernels fail their own frozen tests.
- Whether the fix holds for needs outside the P-21 and add cohorts, or on other hardware, accounts or model load.
- Correctness beyond each candidate's own frozen tests and the G1–G7 gates.
