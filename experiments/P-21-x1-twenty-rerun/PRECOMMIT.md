# P-21 PRECOMMIT: the twenty loop-0 requests, re-run on 2026-11-01

Written 2026-11-01 before the recorded run. One exploratory run of the same harness was made earlier the same evening (20/20 gated); it is reported as exploratory and is not the result.

## Question

How long does one fresh agent take to turn each of the twenty X1 loop-0 requests into a gated capability today, against the 2026-10-17 loop-0 run and the 2026-10-18 atomizer direct run?

## Inputs (fixed)

- Requests: C-015 CC-036 CC-011 CC-014 CC-025 CC-027 C-007 C-019 CC-002 C-016 CC-001 CC-007 C-012 C-005 CC-026 CC-022 C-010 C-006 CC-013 CC-009.
- Need text and worker prompt: the exact `in/need/NEED.md` and `prompt-1.md` from the 2026-10-18 `baseline-20` atomizer archives (`tools/atomizer/ledger/archive/run-<id>-20261018T0644*.tar.zst`), with only the sandbox paths rewritten to the run directory.
- Gates: the unchanged `campaigns/x1-spec-study/factory/gate.mjs` (G1 frozen, G2 compiles, G3 exports, G4 tests, G5 deterministic, G6 bounded, G7 glue) with assemblyscript 0.28.20 from the P-02 lockfile.

## Method

- Worker: Codex CLI `codex exec`, account scubasteve, reasoning effort medium, sandbox workspace-write. The baselines used Claude Sonnet; this is a model difference, not only a runtime difference.
- Concurrency 10 (as on 2026-10-18). Clock starts before the worker reads the request and stops after the harness re-runs all seven gates on a clean copy.
- Persona stage is not run (2026-10-18 did not run it either).

## Metrics

Per-request seconds, median, p95, gated count (harness re-gate `promotable: true`), whole-set wall time, total tokens as printed by Codex (input plus output; the baselines report output tokens only).

## Criteria

- Pass: 20 runs complete, every number taken from receipts.
- Faster than 2026-10-18 if the median is under 30 s; slower otherwise. Either result is reported.
- Falsified if a gated count claim is not reproduced by the harness re-gate.
