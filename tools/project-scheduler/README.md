# Cross-project scheduler

L2 of `/workspace/ops/agent-memory/chief-of-staff/lanes/factory-scale-2026-10-26.md`.
Serves the jobs board's ammonia training, certification and service-business jobs.
The happy path is a reviewed decomposition → parallel commands → one successful join.

Reuses hillclimb's `ownershipMap`, `fleetCapacity` and `waveSize`, throttle's
`headroom`, and the existing GPU queue. It launches no model agents itself.
A job declares its atoms as pieces, each with exclusive repository-relative files;
shared contracts stay frozen. Files are relative to the invocation's working directory.
The scheduler rotates between jobs, checks the capacity dial and headroom before
**each** launch, and lets running commands finish when capacity shrinks or drains.
GPU pieces and joins go through `gpu-queue.py`; ABI defaults to priority 1, others 5.
The existing queue retains its host checks, safety gate and capacity limits.

```json
{
  "schema": "endoforge/project-scheduler/1",
  "concurrency": 4,
  "projects": {"abi": {"tokenBudget": 2500, "gpuPriority": 1}},
  "contracts": ["shared/schema.json"],
  "jobs": [{
    "id": "lesson01", "project": "abi",
    "pieces": [
      {"id": "script", "files": ["out/script.json"], "maxTokens": 1000,
       "command": ["./make-script"]},
      {"id": "look", "files": ["out/look.png"], "maxTokens": 1000,
       "gpu": true, "command": ["./make-look"]}
    ],
    "recombine": {"maxTokens": 500, "command": ["./compose-and-qualify"]}
  }]
}
```

Projects are `abi`, `reta`, `campus`, `service-forward`. Validate with
`node tools/project-scheduler/scheduler.mjs batch.json --check`; omit `--check`
to execute. Run from `forge/endoforge` (or pass an absolute tool path from the
project's directory). Commands are argv arrays, never shell-expanded. The final
JSON report goes to stdout; command output goes to stderr. Any failed project job
makes the CLI exit 1. A failed piece prevents its join while unrelated jobs finish.

Budgets apply to **one batch invocation**. Preflight reserves all `maxTokens`,
including joins, against each project's `tokenBudget` before any launch. No refunds,
automatic retries, persistent daily ledger or cross-process budget sharing.
Commands receive `ENDOFORGE_PROJECT`, `ENDOFORGE_JOB`, `ENDOFORGE_PIECE`,
`ENDOFORGE_TOKEN_BUDGET`, and joins receive ordered `ENDOFORGE_RESULTS` JSON.
Model adapters must enforce their token reservation; arbitrary commands cannot be
metered by this launcher. Use existing Endoforge runners for isolation and claim
qualification; file declarations are validated ownership, not an OS sandbox.
The join must compose and run the project's acceptance/qualify checks. It may read
piece outputs but must not mutate another job's outputs or frozen contracts.

The design target is 10,000 videos/day, not a measured throughput claim. Feed bounded
windows (for example 100 jobs), with disjoint outputs and externally allocated batch
budgets, through one scheduler per shared budget. Tests schedule 10,000 synthetic
jobs in 100 windows; real render/model capacity and approval time remain to measure.

Tests: `node --test tools/project-scheduler/test/scheduler.test.mjs`.
