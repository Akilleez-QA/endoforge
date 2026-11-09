# Project scheduler

The project scheduler runs one bounded batch of work across several projects. Each job in the batch is two or more
pieces that own disjoint files, followed by a recombine step that joins their results. It checks the whole batch
before anything starts, then runs pieces under a concurrency limit and the machine's headroom, rotating across jobs so
no job takes every slot.

## Why it exists

When coding agents work on several projects at once, two things go wrong first: one project's work crowds out the
others, and a batch overspends before anyone notices. The scheduler reserves each piece's `maxTokens` against its
project's `tokenBudget` up front and refuses the batch if any project would go over, refuses pieces that share files,
and never retries a piece (a retried model call is a second bill).

## How it works

1. **Validate** the whole batch: schema, unique ids, a known project for every job, at least two pieces per job,
   relative file paths with no `.` or `..`, disjoint file ownership within each project (paths are relative to their
   project, so two projects may name the same path; `contracts` apply to every project), token reservations within
   each project's budget, and a GPU queue for every step that asks for one.
2. **Run** pieces while there are free slots (the batch's `concurrency` scaled by the capacity dial) and machine
   headroom ([lib/headroom.mjs](../lib/headroom.mjs)), taking the next piece from the next job in turn.
3. **Recombine** each job once all its pieces have finished, passing their results as JSON in `ENDOFORGE_RESULTS`.

A failed piece marks its job `failed`; other jobs continue.

## Use it

`node tools/project-scheduler/scheduler.mjs <batch.json> [--check]`. `--check` runs the same preflight as a run
and prints the token reservation per project. Without it, the batch runs and a JSON report is printed. Exit 1 when a job fails or the batch
is invalid. The module also exports `validate`, `preflight`, `commandFor`, `execute` and `schedule`.

Each command gets `ENDOFORGE_PROJECT`, `ENDOFORGE_JOB`, `ENDOFORGE_PIECE`, `ENDOFORGE_TOKEN_BUDGET` (that piece's
`maxTokens`) and, for the recombine step, `ENDOFORGE_RESULTS`. A piece or recombine step with `"gpu": true` runs
through the GPU queue as `python3 $ENDOFORGE_GPU_QUEUE --name <project>-<job>-<piece> --priority <gpuPriority> --
<command>`.

## Example

```console
$ cat batch.json
{"schema": "endoforge/project-scheduler/1", "concurrency": 2,
 "projects": {"demo": {"tokenBudget": 100, "gpuPriority": 5}},
 "jobs": [{"id": "j1", "project": "demo",
   "pieces": [{"id": "a", "command": ["sh", "-c", "echo piece $ENDOFORGE_PIECE"], "maxTokens": 10, "files": ["a.txt"]},
              {"id": "b", "command": ["sh", "-c", "echo piece $ENDOFORGE_PIECE"], "maxTokens": 10, "files": ["b.txt"]}],
   "recombine": {"command": ["sh", "-c", "echo join $ENDOFORGE_RESULTS"], "maxTokens": 5}}]}
$ node tools/project-scheduler/scheduler.mjs batch.json --check
{
  "reserved": {
    "demo": 25
  }
}
$ node tools/project-scheduler/scheduler.mjs batch.json
piece a
piece b
join [{"piece":"a","result":{"code":0}},{"piece":"b","result":{"code":0}}]
{
  "reserved": {
    "demo": 25
  },
  "jobs": [
    {
      "id": "j1",
      "project": "demo",
      "state": "succeeded",
  ...
```

## Environment

| Variable | Default | Effect |
|---|---|---|
| `ENDOFORGE_GPU_QUEUE` | unset | Path of the GPU queue script. A batch with a GPU step is refused before anything runs without it. |
| `WORKER_STATE_DIR` | `$XDG_STATE_HOME/workers`, else `.local/state/workers` | Capacity dial state, read through the hillclimb fan-out library. |
| `ENDOFORGE_MAX_LOAD`, `ENDOFORGE_RESERVE_GB`, `ENDOFORGE_THROTTLE` | see [lib](../lib/README.md) | Headroom limits. |

## Limits

- Token budgets are reservations, not metering. The scheduler hands each command its `maxTokens`; the command (a
  model runner) must enforce it.
- `files` is checked for overlap but not enforced: commands run as ordinary processes with no sandbox.

Tests: [test/scheduler.test.mjs](test/scheduler.test.mjs) (`node --test tools/project-scheduler/test/scheduler.test.mjs`).

Engineering record: component C-30, GAP-EF-004.
