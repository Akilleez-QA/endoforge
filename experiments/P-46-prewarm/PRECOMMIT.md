# P-46 loading a host module's warm state in `ready()`: precommit

Label: **Proposed** procedure, frozen 2026-11-06 before measurement.

Question: [P-43](../P-43-tsrs-workcell/RESULT.md) found that a cell's first check pays a compile of about 1.2 s and a slower first check. Does an opt-in `warm` option, which has `ready()` wait for a host module's `warm(options)` in every cell, remove this from the first job?

Design under test: `new IsolatePool({warm: {...}})`, off by default. Each cell imports the host module and awaits `warm(options)` before it reports ready. Replacement cells do the same and aren't awaited. A warm failure rejects `ready()`, and any job given to that cell is an unknown outcome. `tools/tscheck/port.mjs` exports `warm({vendor, probe})`, which compiles the module and, with `probe`, runs one tiny check.

Arms, thread cells, `WORKCELL`, `medium/ill`, a fresh Node process each rep, 5 reps at N = 1 and 3 reps at N = 8:

- `prewarm`: today's `prewarm: true`, spawn and ledger only.
- `warm`: `warm: {}`, compile in `ready()`.
- `warm-probe`: `warm: {probe: true}`.

Record `ready()` time, the first job's wall time, its `compileMs` and check `wallMs`, the median of the next 8 jobs and the diagnostic count. At N = 8, the first batch is N jobs at once.

Predictions:

1. `prewarm`: first job at N = 1 is above 1,300 ms, against about 400 ms for later jobs. A job runs the check twice (rounds 0 and 1), so later-job time is not a single check.
2. `warm`: the first job's `compileMs` is 0 and its wall time falls by at least 60%, while staying above later jobs because the first check is cold.
3. `warm-probe`: first job within 1.25 × the later-job median, with `ready()` about 100 ms slower than `warm`.
4. Diagnostics match across arms.

Decision: ship the opt-in if prediction 2 holds. The README recommends whichever arm the numbers support. A miss on 3 means `probe` isn't recommended.

Failure meaning: a miss is a result. This moves cost into `ready()` and doesn't remove it; the total stays visible as `ready()` time plus first job.

Limits: a shared desktop with other work running, one host, Node as recorded.
