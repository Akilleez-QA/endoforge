# Shared tool library

Small modules that the atomizer, conductor, hillclimb, job and project-scheduler tools import. Node only, no dependencies.

## Modules

- [errors.mjs](errors.mjs): one exit-code taxonomy.
  - `EXIT`: `OK 0`, `FAIL 1`, `USAGE 2`, `TRANSIENT 75`, `STOP 78`, `TIMEOUT 124`.
  - `classify(status)`: returns `'ok'`, `'transient'` (75), `'stop'` (78) or `'fail'`.
  - `runTyped(argv, opts)` and `runTypedAsync(argv, opts)`: run a command. On 75 they wait and retry with doubling backoff (defaults: `baseMs` 2000, `capMs` 60000, `maxWaitMs` 600000). On 78 or any failure they return at once. The result is `{status, kind, attempts, waitedMs, stdout, stderr}`.
  - `StopError`: an error with `exitCode` 78.
  - `unscored(why)` and `isScored(x)`: a gate or eval that could not run is `{scored: false}`, never a number.
- [lock.mjs](lock.mjs): file locks.
  - `acquire(target, {waitMs, pollMs, orphanMs})`: creates the directory `<target>.lock` holding the owner pid, host and time. A lock whose owner pid is dead on this host is reclaimed. After `waitMs` (default 60000) it throws `LockBusy`, which has `exitCode` 75. Returns a release function.
  - `withLock(target, fn, opts)`: runs `fn` under the lock and always releases it.
  - `writeJSONAtomic(file, value)`: writes to a temp file, fsyncs, renames, then fsyncs the directory.
- [headroom.mjs](headroom.mjs): load and memory headroom.
  - `limits(env)`: `maxLoad` and `reserveGb`.
  - `availableGb()`: `MemAvailable` from `/proc/meminfo`.
  - `headroom(env, sample)`: returns `{ok, load1, availGb, maxLoad, reserveGb}`. `ok` is true when the 1-minute load is below `maxLoad` and available memory is at least `reserveGb`.
- [exitfile.mjs](exitfile.mjs): `exitWrapper(file)` returns a shell fragment that runs `"$@"` and writes its exit code to `file` atomically. `readExit(file)` reads it back, or returns `null`.
- [run-typed](run-typed): a CLI over `runTyped`.

## Environment

| Variable | Read by | Default |
|---|---|---|
| `ENDOFORGE_MAX_LOAD` | `headroom.mjs` | 0.875 times the available CPU count |
| `ENDOFORGE_RESERVE_GB` | `headroom.mjs` | the larger of 8 and 12% of total RAM, in GiB |
| `ENDOFORGE_THROTTLE` | `headroom.mjs` | unset; `0` makes `headroom()` always return `ok` |

## run-typed

```sh
node tools/lib/run-typed [--max-wait SEC] [--base SEC] -- <command ...>
```

`--max-wait` defaults to 600 seconds and `--base` to 2. These were run:

```sh
node tools/lib/run-typed                                               # prints usage, exits 2
node tools/lib/run-typed -- true                                       # exits 0
node tools/lib/run-typed -- sh -c 'exit 78'                            # STOP, not retried, exits 78
node tools/lib/run-typed --max-wait 1 --base 1 -- sh -c 'exit 75'      # retries once, gives up, exits 75
```

## Tests

`make lib-test` runs [test/errors.test.mjs](test/errors.test.mjs) along with the conductor, hillclimb and job tests, and the [job-locks](../job-locks/README.md) test. There is no separate test for `lock.mjs`, `headroom.mjs` or `exitfile.mjs`.
