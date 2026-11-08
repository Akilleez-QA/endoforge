# Project scheduler

Runs one bounded batch of jobs across projects. Each job has at least two pieces with disjoint files, then a recombine step. The scheduler checks the whole batch first: project token budgets, unique ids, relative file paths and file ownership. Then it launches pieces under the concurrency limit and machine headroom, rotating across jobs, and runs each job's recombine once its pieces finish. It reserves each piece's `maxTokens` up front and never retries.

## Entry point

`scheduler.mjs <batch.json> [--check]`. `--check` validates only and prints the token reservation per project. Without it, the batch runs and a JSON report is printed. Exit 1 when a job fails or the batch is invalid. The module also exports `validate`, `commandFor`, `execute` and `schedule`.

## Batch format

```json
{"schema": "endoforge/project-scheduler/1", "concurrency": 2,
 "projects": {"demo": {"tokenBudget": 100, "gpuPriority": 5}},
 "jobs": [{"id": "j1", "project": "demo",
   "pieces": [{"id": "a", "command": ["sh", "-c", "echo piece $ENDOFORGE_PIECE"], "maxTokens": 10, "files": ["a.txt"]},
              {"id": "b", "command": ["sh", "-c", "echo piece $ENDOFORGE_PIECE"], "maxTokens": 10, "files": ["b.txt"]}],
   "recombine": {"command": ["sh", "-c", "echo join $ENDOFORGE_RESULTS"], "maxTokens": 5}}]}
```

A piece or recombine step may set `"gpu": true`. It then runs through the GPU queue as `python3 $ENDOFORGE_GPU_QUEUE --name <project>-<job>-<piece> --priority <gpuPriority> -- <command>`.

Each command gets `ENDOFORGE_PROJECT`, `ENDOFORGE_JOB`, `ENDOFORGE_PIECE`, `ENDOFORGE_TOKEN_BUDGET` and, for recombine, `ENDOFORGE_RESULTS` (the pieces' results as JSON).

## Environment

| Variable | Default | Effect |
|---|---|---|
| `ENDOFORGE_GPU_QUEUE` | unset | Path of the GPU queue script. A GPU piece fails without it. |
| `WORKER_STATE_DIR` | `$XDG_STATE_HOME/workers`, else `.local/state/workers` | Worker capacity state, read through the hillclimb fan-out library. |

## Example

With the batch above saved as `batch.json`:

```sh
node tools/project-scheduler/scheduler.mjs batch.json --check
node tools/project-scheduler/scheduler.mjs batch.json
```

`--check` printed `{"reserved": {"demo": 25}}`. The run printed `piece a`, `piece b` and the join line, then a report with job `j1` in state `succeeded`.

## Tests

No `make` target runs this tool.
