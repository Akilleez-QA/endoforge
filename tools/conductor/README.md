# Conductor

The Conductor runs one job after the user's go. It is a long-running, resumable daemon for an `endoforge/job/1` manifest (see [job](../job/README.md)). Every tick it reloads the manifest and its durable state, honours stop and pause, and runs the handler for the current phase. It launches atoms on the available logins, collects each atom's diff through a gate, runs that atom's checks, and then freezes the atom or relaunches it with the findings. When it cannot decide, it writes an escalation packet and emits `NEEDS-COORDINATOR`. Authority questions go to the user as `NEEDS-YOU`.

State lives in `<jobdir>/conductor/state.json`, written atomically under a lock, so a restart resumes where it stopped.

## Entry point

`bin/conduct.mjs <command> <job.json> ...`. The same commands are reachable as `node tools/job/bin/job.mjs <command> <job.json>`.

| Command | Effect |
|---|---|
| `status` | Phase, budget, atoms and the event timeline. |
| `go --sha <card sha> --by <user> --words "<words>"` | Records the user's go on the staged card. A wrong sha is refused. |
| `lock <atom> --by <user> --words "<words>"` | A taste lock on one atom. |
| `pause [--why text]`, `resume` | Pause and resume launches. |
| `budget [--launches N] [--iterations N] [--by ... --words ...]` | Shows or raises the budget. Raising needs the user's words. |
| `stop [--by who] [--why text]` | Stops the lanes and ends the job. |
| `patch <patch.json>` | The coordinator's reply to an escalation, applied through the same gates. |
| `adopt <new job.json> --map <map.json> ...` | Converts a job running on older scripts into a manifest and state. |
| `unit [--dry-run]` | Starts `run` as a systemd user service in `heavy.slice`. `--dry-run` prints the `systemd-run` command. |
| `run [--tick S] [--max-ticks N]` | The daemon in the foreground. Tick defaults to 5 seconds. |

`run` and `unit` launch real workers (Codex or Claude), each in its own git worktree, as a systemd unit or a detached child.

## Manifest settings

The `conductor` block of the job sets: `launcher` (`systemd` by default, or `local`), `maxIterations` (3), `maxLaunches` (200), `atomTimeoutSec` (2400), `gate` (the collect gate command), `checkConcurrency`, `worktrees`, `links`, `codexPool`, `claudeBin`, `codexModel`, `claudeModel`, `busyBaseSec` (2) and `busyWaitSec` (900).

## Environment

| Variable | Default | Effect |
|---|---|---|
| `CODEX_POOL_BIN` | `codex` on `PATH` | Passed to Codex lanes. |
| `ENDOFORGE_SYSTEMCTL` | `systemctl` | Used to see whether a lane's unit has ended. |

The event variables of the job tool (`ENDOFORGE_NOTIFY` and the hook lists) apply too.

## Example

These ran on a synthetic one-atom job in a temp directory, with `ENDOFORGE_NOTIFY=none`:

```sh
node tools/conductor/bin/conduct.mjs unit job.json --dry-run
node tools/job/bin/job.mjs card job.json --out card.md
node tools/conductor/bin/conduct.mjs go job.json --sha <card sha> --by operator --words "go"
node tools/conductor/bin/conduct.mjs status job.json
node tools/conductor/bin/conduct.mjs stop job.json --by operator --why done
```

`go` printed `phase go` and `status` showed `budget: 0/200 launches, 2 iterations per atom`. `run` was not run, because it launches model workers.

## Tests

`make lib-test` runs `test/failopen.test.mjs`, `test/principles.test.mjs` and `test/stream.test.mjs`, which use a stub worker script and fake logins. All three passed. `adopt` refers to `tools/conductor/examples` for a map file; that directory is not in this tree.
