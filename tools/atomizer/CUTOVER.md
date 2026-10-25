# Cutover: direct worker or atomized DAG

Experiment R-01 (`cutover-01`, rep 1, 18 Oct 2026). Every number is **Recorded (probe)**: one run per arm, paired by case and run concurrently under the same load. Cases: five development singles and three large requests stated as single goals in a technician's words (no pre-decomposed specification; `cases/`). Primary metric: time to a promotable gated artefact, planning included.

| Case | Direct to gated (s) | Direct promotable | Atomized: plan + DAG to gated (s) | Atomized promotable | Output tokens direct / atomized | Tests direct / atomized |
|---|---|---|---|---|---|---|
| S1-CC-036 | 19 | True | 49 + 17 = 66 | True | 2,461 / 11,599 | 9 / 9 |
| S2-CC-002 | 23 | True | 50 + 29 = 79 | True | 2,824 / 15,581 | 11 / 40 |
| S3-C-005 | 47 | False | 64 + — = — | False | 5,448 / 19,572 | 15 / — |
| S4-C-010 | 32 | True | 82 + — = — | False | 4,223 / 158,411 | 16 / — |
| S5-CC-022 | 30 | True | 82 + 34 = 117 | True | 3,879 / 25,422 | 12 / 69 |
| N1 | 112 | True | 107 + 90 = 197 | True | 14,935 / 68,661 | 47 / 124 |
| N2 | 74 | True | 75 + 153 = 228 | False | 10,762 / 53,528 | 39 / 189 |
| N3 | 29 | True | 47 + 35 = 82 | True | 3,976 / 20,559 | 22 / 51 |

## What it shows

- direct reached a promotable artefact first on all 7 cases where any arm promoted; no cutover inside the ladder, including the three large single-goal requests
- direct: promotable 7/8 (S3 failed 14/15 tests); atomized: promotable 5/8 (S3 a test atom returned no output twice; S4 a kernel atom ran 601 s and the draft compose then failed to compile; N2 one blind test expectation was wrong by hand arithmetic and stayed frozen)
- atomized used 3-12x the output tokens (S4 145k from a runaway kernel atom)
- scope is not equal: on N1 both built six exports; on N3 the direct worker reduced the request to a generic band check (3 exports) while the atomized plan built domain checks (4 exports); atomized wrote 2-5x more tests (N1 124 vs 47) - gates alone cannot compare usefulness
- planning alone (47-107 s) exceeds the whole direct run on every case; on N1 the DAG alone (90 s to gated) beat direct (112 s), so with near-zero planning the cutover would sit around N1's size (~15k direct output tokens); on N2 the DAG alone (153 s) lost even without planning

## What it means for the router

- **Default to direct.** At today's planning cost there is no measured case where atomizing gets to a gated artefact sooner.
- **Atomizing has to earn its place on something other than speed:** blind tests (2–5x more tests, written without the kernel) and scope (N3). Whether that buys usefulness is a question for the oracle panel, not the gates.
- **The cutover is set by planning cost.** With planning near zero, N1's DAG alone beat the direct run; the next experiment templates the planner and re-runs N1 and N2 with replication.

## Next (in `ledger/improvements.jsonl`)

- S-07 direct-first routing by default; atomize only when predicted direct output exceeds a threshold and planning is templated
- S-08 template planning (target < 10 s) then re-run N1/N2
- S-09 robustness: empty-output guard and per-atom wall cap (S4 601 s), compile-collision repair, blind-test arithmetic check before freezing
- quality comparison by the sealed oracle panel on the same artefacts (scope, coverage, usefulness), since speed alone favours the arm that does less


## R-02: templated planner, N1 and N2, three paired reps (cutover-02)

| Case | Rep | Direct to gated (s) | Direct promotable | Templated: plan + DAG (s) | Templated promotable | Templated tests passed | Output tokens direct / templated | First promotable |
|---|---|---|---|---|---|---|---|---|
| N1 | 1 | 113 | True | 8.5 + 27 = 35 | True | 24/24 | 15,093 / 16,453 | templated |
| N1 | 2 | 114 | True | 7.8 + 55 = 62 | False | 22/24 | 15,631 / 19,052 | direct |
| N1 | 3 | 157 | False | 7.6 + 29 = 37 | True | 24/24 | 21,601 / 17,016 | templated |
| N2 | 1 | 83 | False | 9.4 + 47 = 56 | False | 35/36 | 11,661 / 25,179 | neither |
| N2 | 2 | 74 | True | 10.8 + 47 = 58 | True | 24/24 | 10,948 / 21,566 | templated |
| N2 | 3 | 83 | True | 10.1 + 49 = 59 | False | 23/24 | 11,870 / 19,845 | direct |

- planning with the template took 7.6-10.8 s (median 9.0 s) on six runs: the target of under 10 s is met at the median, not on every run
- templated reached its gated result before direct in all 6 paired reps: N1 median 37 s vs 114 s (3.1x), N2 median 58 s vs 83 s (1.4x)
- promotable: templated 3/6, direct 4/6; every templated failure was a blind test whose expected value was wrong by hand arithmetic (22/24, 35/36, 23/24 passed) and stayed frozen; direct failed N1 r3 (157 s) and N2 r1
- counting only first-promotable wins: templated 3, direct 2, neither 1; expected time to a promotable result with one retry is lower for templated on N1 and about even on N2
- tokens: templated 1.1-2.2x direct (no longer 3-12x), because the template writes 8-10 atoms instead of 15-20 and the planner is 900-1,100 tokens

**Cutover.** with templated planning the cutover lies below N1/N2 size (direct about 11-16k output tokens, 75-115 s); R-01 singles took direct 19-47 s (2.5-5.5k tokens), so the cutover sits between them, most likely near direct about 40-60 s; the singles have not been run on the templated arm.

**Next.**
- S-09 blind-test expectation check before freezing (a second, independent computation of each expected value; disagreements are dropped or flagged, not frozen) - the binding constraint on the templated arm is now test correctness, not time
- run the five singles on the templated arm (3 reps) to place the cutover between 19 and 75 s direct
- router rule until then: direct when the planner's interface has at most 3 exports, templated above


## S-09: blind-test expectation check, N1 and N2, three paired reps (cutover-03)

| Case | Rep | Direct to gated (s) | Direct promotable | Templated: plan + DAG (s) | Templated promotable | Tests passed | First promotable |
|---|---|---|---|---|---|---|---|
| N1 | 1 | 97 | True | 8.5 + 62 = 71 | True | 24/24 | templated |
| N1 | 2 | 98 | False | 9.4 + 36 = 45 | True | 24/24 | templated |
| N1 | 3 | 101 | False | 8.8 + 48 = 57 | True | 24/24 | templated |
| N2 | 1 | 93 | True | 11.4 + 66 = 78 | True | 37/37 | templated |
| N2 | 2 | 91 | True | 9.6 + 51 = 60 | True | 36/36 | templated |
| N2 | 3 | 116 | True | 10.8 + 82 = 93 | True | 24/24 | templated |

- Templated promoted 6/6 and reached a gated result first in 6/6 (median 66 s against 97 s direct). Direct promoted 4/6.
- **The check changed no test** (169 kept, 0 dropped): the improvement from 3/6 is not attributable to it at this n.
- **Replay on the R-02 failures:** the check caught the arithmetic error (R-410A at 418 psig is about 120 F, not 110 F) and missed the two N2 failures, which were correct arithmetic for inputs the interface declares refused. A refusal-first prompt did not fix it.
- **Correction to R-02:** only one of its three templated failures was a wrong expected value; two were tests contradicting the interface's refusal rule.
- Next: machine-readable refusal ranges from the planner and a script check before freezing (S-10).

## Correction (2026-10-18)

The cutover "near 40-60 s of direct time" is an estimate, not a measurement: the 6/6 templated wins cover two distinct requests (N1, N2), and none of the five singles has been run on the templated arm. Route by measured outcome on equal scope; see `docs/REPORT-2026-10-18.md` §3 item 9.
