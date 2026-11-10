# P-64 amendment 1: the streaming tail counted overlapping waits twice

Written 2026-11-09 after the round-8 backfill review (R11). [PRECOMMIT.md](PRECOMMIT.md) and [RESULT.md](RESULT.md) are unchanged.

## What was wrong

[harness.mjs](harness.mjs) set a turn's streaming tail to `(max(lastToken, final check done) − lastToken) + (result − lastToken)`. The wait for the final check and the wait for the CLI's result event run at the same time, so adding them counted the overlap twice. The turn is ready at `max(final check done, result, lastToken)`, and the tail is that minus `lastToken`. [tail.mjs](tail.mjs) now computes it, and both the harness and [analyze.mjs](analyze.mjs) use it.

## Regeneration

The replay rows in [receipt/replay](receipt/replay) keep each turn's `lastToken`, `resultAt` and `stream.finalFinishedAt`. `analyze.mjs` now recomputes every streaming tail from those three timings and reads the gzipped rows directly. [receipt/replay/analysis.json](receipt/replay/analysis.json) was regenerated with `node analyze.mjs receipt/record receipt/replay`. With the old formula, the refactored analysis reproduced the committed file exactly. [analyze.test.mjs](analyze.test.mjs) checks the formula and that the committed analysis matches the raw rows.

| Figure (H workload) | Before | After |
|---|---|---|
| Per-turn tail after, p50 / p95 / max | 20.3 / 40.5 / 149.8 ms | 18.0 / 27.1 / 132.6 ms |
| Per-candidate tail after, p50 / p95 | 184.6 / 384.6 ms | 183.8 / 364.4 ms |
| Candidate tail drop at p50 | 61.05% | 61.23% |
| End-to-end latency after, p50 | 26,551.4 ms | 26,544.3 ms |
| End-to-end drop at p50 | 1.13% | 1.16% |

34 of the 70 H turns change. None of the 225 P-57 turns do: in every one, the final check finished before the last token, so the two waits never overlapped. No verdict changes. Bar 1 (tail −50%) is still met at −61% (H) and −70% (P-57). Bar 2 (end-to-end −15%) is still missed at −1.2% (H) and −0.45% (P-57). The pre-check is slightly better than reported: the per-turn tail on H is 18 ms, not 20 ms.
