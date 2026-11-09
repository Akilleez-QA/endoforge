# Shared tool library

Small Node modules that the whole-job tools ([atomizer](../atomizer/README.md), [conductor](../conductor/README.md),
[hillclimb](../hillclimb/README.md), [job](../job/README.md) and the [project scheduler](../project-scheduler/README.md))
share, so they agree on what an exit code means, how to wait for a busy resource, and how to write state that survives
a crash. No dependencies.

## Why it exists

When many agents and checks run at once, "the command failed" is not one thing. A check may be busy (try again
later), may have found a reason to stop the whole job, or may simply have failed. If every tool guessed differently, a
busy machine would look like a failing test and a stop signal would be retried. This library fixes one meaning for
each exit code and gives every tool the same retry, lock and atomic-write behaviour.

| Exit code | Name | Meaning | What callers do |
|---|---|---|---|
| 0 | `OK` | Passed | Continue |
| 1 | `FAIL` | Failed | Report it; feed it back to the agent |
| 2 | `USAGE` | Wrong arguments | Fix the call |
| 75 | `TRANSIENT` | Busy (a lock, a queue, no headroom) | Wait with doubling backoff and retry |
| 78 | `STOP` | Something is unsafe or broken | Stop the whole job, loudly |
| 124 | `TIMEOUT` | Ran out of time | Treat as not finished |

A gate or evaluation that could not run is `{scored: false, why}` (`unscored`), never a number, so it cannot be
mistaken for a pass or a zero.

## Modules

- [errors.mjs](errors.mjs): `EXIT`, `classify(status)` (`'ok'`, `'transient'`, `'stop'` or `'fail'`), `runTyped` and
  `runTypedAsync` (on 75 they wait and retry with doubling backoff, defaults `baseMs` 2000, `capMs` 60000, `maxWaitMs`
  600000; on 78 or any other failure they return at once with `{status, kind, attempts, waitedMs, stdout, stderr}`),
  `StopError` (`exitCode` 78), `unscored(why)` and `isScored(x)`.
- [lock.mjs](lock.mjs): `acquire(target, {waitMs, pollMs, orphanMs})` creates the directory `<target>.lock` with the
  owner's pid, host and time. A lock whose owner pid is dead on this host, or an ownerless lock older than `orphanMs`,
  is reclaimed. After `waitMs` (default 60000) it throws `LockBusy` (`exitCode` 75). `withLock(target, fn, opts)` runs
  `fn` under the lock and always releases it. `writeJSONAtomic(file, value)` writes a temp file, fsyncs, renames and
  fsyncs the directory.
- [headroom.mjs](headroom.mjs): `headroom(env, sample)` returns `{ok, load1, availGb, maxLoad, reserveGb}`; `ok` is
  true when the one-minute load is below `maxLoad` and available memory is at least `reserveGb`. `limits(env)` and
  `availableGb()` are the parts.
- [exitfile.mjs](exitfile.mjs): `exitWrapper(file)` is a shell fragment that runs `"$@"` and writes its exit code to
  `file` atomically; `readExit(file)` reads it back or returns `null`. The conductor uses it to tell a finished worker
  from a running one after a restart.
- [run-typed](run-typed): the command-line form of `runTyped`.

## Example

```console
$ node tools/lib/run-typed
usage: run-typed [--max-wait SEC] [--base SEC] -- <command …>
$ node tools/lib/run-typed -- sh -c 'exit 78'; echo "exit $?"
run-typed: STOP: sh exited 78; not retrying
exit 78
$ node tools/lib/run-typed --max-wait 1 --base 1 -- sh -c 'exit 75'; echo "exit $?"
run-typed: sh is busy (exit 75); retrying in 1 s (attempt 1)
run-typed: still busy after 1 s; giving up with 75
exit 75
```

`--max-wait` defaults to 600 seconds and `--base` to 2. With no command, `run-typed` prints its usage and exits 2.

## Environment

| Variable | Read by | Default |
|---|---|---|
| `ENDOFORGE_MAX_LOAD` | `headroom.mjs` | 0.875 times the available CPU count |
| `ENDOFORGE_RESERVE_GB` | `headroom.mjs` | the larger of 8 and 12% of total RAM, in GiB |
| `ENDOFORGE_THROTTLE` | `headroom.mjs` | unset; `0` makes `headroom()` always return `ok` |

## Limits

- Locks are directories on a local file system. Dead-owner reclaim only works for owners on the same host.

## Tests

Every module has a direct test, and `make lib-test` runs them with the conductor, hillclimb, job and
[job-locks](../job-locks/README.md) tests:

- [test/errors.test.mjs](test/errors.test.mjs): `errors.mjs` and [run-typed](run-typed).
- [test/lock.test.mjs](test/lock.test.mjs): owner record, `LockBusy` after `waitMs`, dead-owner and orphan reclaim
  (and no reclaim across hosts), `withLock` release on throw, no lost update across four processes, and
  `writeJSONAtomic` output and cleanup.
- [test/headroom.test.mjs](test/headroom.test.mjs): default and overridden limits, the ok rule, `ENDOFORGE_THROTTLE=0`
  and the `MemAvailable` reading with its fallback.
- [test/exitfile.test.mjs](test/exitfile.test.mjs): the wrapper keeps the exit code, output and arguments, quotes the
  file path, records a signal as 128 plus the signal, and leaves no file when the wrapper itself is killed; `readExit`
  rejects anything that is not an exit code.

Engineering record: component C-23, requirement REQ-ERR-001.
