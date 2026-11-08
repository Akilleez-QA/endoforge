# Job locks

Prints the locked decisions of every active job, so a session-start hook can put them in front of an agent at start, resume and compaction.

## Entry point

[job-locks.py](job-locks.py), a single script.

```sh
python3 -B tools/job-locks/job-locks.py                  # print the locks of every active job
python3 -B tools/job-locks/job-locks.py add <manifest>   # register a job manifest
python3 -B tools/job-locks/job-locks.py rm <manifest>    # unregister it
```

## Inputs and outputs

- The registry is `$XDG_CONFIG_HOME/job-locks/active.json`, a JSON list of manifest paths. `XDG_CONFIG_HOME` defaults to `~/.config`. `add` and `rm` store the resolved path and write the list atomically.
- Each manifest's `locks` object is printed one line per lock: the `decision`, `text`, `plan`, `words` or `voice` field, then `by` in parentheses, then any `exception*` fields. Lines are cut at 300 characters. The job name comes from `name` or `job`.
- An unreadable manifest or registry prints a warning instead. The default command always exits 0, so a hook never breaks session start. `add` and `rm` exit 1 if the registry cannot be changed.

This was run on a synthetic manifest with `XDG_CONFIG_HOME` set to a temp directory:

```sh
echo '{"name":"demo","locks":{"palette":{"decision":"blue only","by":"owner"}}}' > manifest.json
XDG_CONFIG_HOME=$PWD/cfg python3 -B tools/job-locks/job-locks.py add manifest.json
XDG_CONFIG_HOME=$PWD/cfg python3 -B tools/job-locks/job-locks.py
```

The last command printed a `LOCKED DECISIONS for job "demo"` header and `- palette: blue only (owner)`. With no registry it prints nothing.

## Test

`make lib-test` runs [test_job_locks.py](test_job_locks.py).
