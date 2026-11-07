# P-56 amendment 1: a serialization defect found on the first corpus run

Written 2026-11-07 after the first corpus run was stopped, before any amended arm ran. [PRECOMMIT.md](PRECOMMIT.md) and its hash are unchanged.

## What happened

S1 started at 00:44 on the precommitted tree (`dc73ac2`). Its control arm refused 11 of 177 pristine kernels. The offline evaluator, built from the same recordings, refused 1 (`cand-r4/C-015`, code labels). Prediction 9 says the two must agree, so the run was stopped at 1,900 of 10,416 sampled rows and the difference traced.

Cause: `combine()` wrote a range with one open side as `Infinity`, which `JSON.stringify` writes as `null`. In the pipeline the evaluator is read back from the frozen file, so `max: null` refused every value; offline it stays in memory. One example, `cand-r1/CC-025`: every positive horsepower read as outside `[0, null]`. It's a defect in the stage, not a rule, and it changes no threshold, check or prompt.

## Change

`afde8a5`: a range bound that isn't finite is left out, and a vector whose reference value isn't finite is dropped, since JSON can't hold it. A test that fails on the old code now passes.

## Rows

| Row | Tree | What ran | Pristine | Sampled P-21 |
|---|---|---|---|---|
| S1 frozen | `dc73ac2` | control, 1,900 sampled rows, then stopped | 166 / 177 | 20 of 1,516 escaped; S0 on the same rows 65 |
| S1a, S2a | this amendment's commit | the precommitted arms, unchanged in every other respect | | |

The frozen row stays in the result beside the amended ones. Predictions and bar are unchanged and apply to S1a and S2a. S0 is derived from S1a's rows. The recordings (`recorded.jsonl`) are reused unchanged.
