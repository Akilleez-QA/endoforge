# Atomizer execution results

Labels per `docs/CONVENTIONS.md`: every number here is **Recorded (probe)**: one shared desktop, one day (17–18 Oct 2026), one subscription login, no replication. The isolates, scheduler and helper are described in `README.md`.

## Run 0: C-005 alone (13 atoms, concurrency 8, no repair stage)

Wall 73.0 s against a sequential equivalent of 177.1 s (realized speedup 2.43x; planned bound 2.25x); critical path 46.2 s; 13 model calls; output tokens 19,359, input 22,804, cache read 96,485, cache creation 60,408. All 13 atoms finished first time. Gates on the composed artefact: G1, G2, G3, G5, G6, G7 pass; G4 61/66. Acceptance A1–A4 (exports exist; the requested 1 m, 1/4 in case between 17 and 21 g; 0 g inside the pre-charged length; refusals trap) passed from the composed wasm; A6 (all gates) and A7 failed; A7 was an acceptance command the atomizer wrote against an imagined glue field (`codes` at the top level), which the atomizer's rules now prevent. Reviews on the draft: Sonnet technician accept-with-change (fix G4, make the headline answer the question), Codex reject (require the refrigerant before presenting an actionable charge), Opus safety accept-with-change (no R410A default when the refrigerant is unknown).

## Run 1: five requests as one pool (fanout-01; 5 DAGs in parallel, 4 isolates each, repair stage on)

Pooled wall 121 s against 746 s of summed atom time: **pooled speedup 6.15x**; 65 model calls; output tokens 80,076, input 68,149, cache read 716,928, cache creation 236,428. Up to 20 isolates ran at once on one login; no rate-limit error occurred.

| Request | Atoms | Wall (s) | Speedup | Draft G4 | Final G4 | Promotable | Outcome |
|---|---|---|---|---|---|---|---|
| C-007 | 13 | 48 | 1.63x | 34/34 | 34/34 | True | all gates pass; compose marked failed because the atomizer declared the output as a directory (normalized since) |
| C-015 | 14 | 78 | 1.88x | 45/53 | 45/53 | False | G7 failed on a glue field my procedure wrongly allowed (labels on an argument); fixed |
| CC-002 | 11 | 79 | 1.34x | 33/36 | 33/36 | False | same directory-output declaration; G4 failures were the harness (see below) |
| C-005 | 15 | 94 | 2.03x | 60/64 | 60/64 | False | G4 failures were the harness |
| C-010 | 16 | 121 | 1.85x | 75/79 | 75/79 | False | G4 failures were the harness |

**What the failures were.** In four of five requests every failing test had an infinite argument. The test atoms wrote `1e999` (which `JSON.parse` reads as Infinity, as the gate runner does); my compose helper parsed and re-serialized the merged tests, and `JSON.stringify` writes Infinity as `null`, so the kernels received 0 and did not refuse. The repair atoms, which see only the failing tests, diagnosed this in all four cases as an expectation-or-harness fault and left every kernel unchanged, which is exactly what their procedure asks. Re-composing the fan-out's own C-005 parts with a text-level merge gives **G1–G7 all pass, 64/64 tests, promotable**: tests written blind to the kernel agreed with the kernel completely. Fixes: text-level test merge; canonical compose outputs; glue procedure matched to the schema; test procedure states the encodings.

**What this does and does not show.** It shows that a need can be decomposed by an agent into a valid DAG in one attempt (5/5), that single-shot atoms on Sonnet produce parts that compose and gate, that the isolate boundary holds under 20 concurrent isolates, and that pooling requests is where the parallelism is (6.15x pooled against 1.3–2.0x per request). It does not show anything about usefulness to a person (no human verdict), about durability (one day, one login), or about cost per clean promotion against the loop-0 protocol (that comparison belongs to loop 1 under its noise floor).


## Run 2: the same five after the fixes (fanout-02)

Pooled wall 135 s against 767 s of summed atom time: **pooled speedup 5.68x**; 69 model calls; output tokens 82,479. **Gates: 5/5 promotable (G1–G7 all pass).** Acceptance verification 3/5: C-005 and C-010 failed only on acceptance commands the atomizer wrote before it was given the real formats (they read `g.G1.pass`; the gate writes `gates.G1_frozen.ok`; one `grep 'Date'` check was lexical).

| Request | Wall (s) | Speedup | Promotable | Verify |
|---|---|---|---|---|
| C-007 | 57 | 1.9x | True | pass |
| C-015 | 62 | 2.09x | True | pass |
| CC-002 | 65 | 1.74x | True | pass |
| C-005 | 70 | 2.43x | True | fail (acceptance command format) |
| C-010 | 135 | 1.86x | True | fail (acceptance command format) |

## Run 3: C-005 and C-010 re-atomized under the current rules (fanout-03)

Both re-atomized in one attempt; pooled wall 92 s, pooled speedup 4.57x; **both promotable and both verify** (every acceptance command passes against the composed artefact). Earlier atomizations kept as `examples/C-005-v1`, `examples/C-010-v1`.

**Standing after run 3: 5/5 requests gated and verified through the atomized pipeline with no person in it.**

## Review verdicts (run 2; reviewers see the request, contract, glue, tests and gate record, never the kernel)

| Request | Verdicts |
|---|---|
| C-005 | accept-with-change, reject, accept-with-change |
| C-007 | accept-with-change, reject, accept-with-change |
| C-010 | accept-with-change, accept-with-change, reject |
| C-015 | Sonnet accept-with-change, Codex reject |
| CC-002 | accept-with-change ×3 (one Codex) |

Not one capability was accepted as returned by every reviewer. Gate pass is now cheap and parallel; intent fit is still the binding constraint, exactly as in loop 0. The rejections mostly ask for the open fact (refrigerant, equipment) to be required rather than defaulted, which is the case for loop-1 deviation D-02 and for moving reviewer criteria to contract time (D-03), before any kernel is written.

## Note (2026-10-18)

Pooled and realized speedups here are relative to the summed time of the atoms, not to a direct single worker. On small requests the direct worker in an isolate is faster than any atomized arm (median 30 s on the 20 baseline requests); see `CUTOVER.md` and `docs/REPORT-2026-10-18.md`.
