# Job locks

`job-locks.py` prints the decisions a user has locked for each active job, so a session-start hook can put them in
front of a coding agent every time a session starts, resumes or is compacted. A long job outlives any one agent
session; this keeps "the user already decided this" from being lost when the context is.

## How it works

A small registry lists the manifests of active jobs. On each run the script reads every registered manifest's `locks`
object and prints one line per lock. It never fails a session start, because a failing hook would break the session
it is meant to inform: problems become warnings and the default command always exits 0.

## Use it

```sh
python3 -B tools/job-locks/job-locks.py                  # print the locks of every active job
python3 -B tools/job-locks/job-locks.py add <manifest>   # register a job manifest
python3 -B tools/job-locks/job-locks.py rm <manifest>    # unregister it
```

- The registry is `$XDG_CONFIG_HOME/job-locks/active.json` (`~/.config` when `XDG_CONFIG_HOME` is unset), a JSON list
  of resolved manifest paths written atomically.
- Each lock prints its `decision`, `text`, `plan`, `words` or `voice` field, then `by` in parentheses, then any
  `exception*` fields, cut at 300 characters. The job name comes from `name` or `job`.
- An unreadable manifest or registry prints a warning. `add` and `rm` exit 1 if the registry cannot be changed. With
  no registry the default command prints nothing.

## Example

```console
$ echo '{"name":"site-redesign","locks":{"palette":{"decision":"blue and white only","by":"owner"}}}' > manifest.json
$ XDG_CONFIG_HOME=$PWD/cfg python3 -B $REPO/tools/job-locks/job-locks.py add manifest.json
/tmp/tmp.6WCS4fMRvf/manifest.json
$ XDG_CONFIG_HOME=$PWD/cfg python3 -B $REPO/tools/job-locks/job-locks.py
LOCKED DECISIONS for job "site-redesign" (/tmp/tmp.6WCS4fMRvf/manifest.json). Re-read before any brief, render or deliverable; never contradict one without the user changing it:
- palette: blue and white only (owner)
```

This ran in a temporary directory; `$REPO` is the repository root.

## Limits

- It prints what the manifest says; it does not check that agents obey it.
- It reads only `name` or `job` and `locks` from a manifest; the rest of the file is ignored.

## Test

`make lib-test` runs [test_job_locks.py](test_job_locks.py).

Engineering record: component C-23, requirement REQ-LOCK-001.
