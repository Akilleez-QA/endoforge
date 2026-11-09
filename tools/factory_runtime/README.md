# Factory runtime

The trusted host side of a version 1 worker runtime (`VERSION = 1` in `__init__.py`): it runs one worker attempt at a
time in a locked-down Docker container, checks the output against a hash the caller supplies, and publishes the result
once. It comes from the earlier factory design, where each attempt got a container; the current design runs candidates
in V8 isolate workcells instead. It is a library, not wired into the candidate loop.

## What a run does

1. Takes the controller fence (`Fence` in `core.py`) and writes a journal under `<root>/journals/` before creating
   anything.
2. Copies the input into `<root>/attempts/<attempt>/input.txt` and refuses if its hash differs.
3. Creates a container labelled with a per-attempt owner token: no network, a read-only root, all capabilities
   dropped, 1 CPU, 512 MiB memory, 32 pids, small `/tmp` and `/out` tmpfs mounts.
4. Waits up to the timeout, then reads stdout as the only artifact channel and compares its hash with
   `expectedSha256`.
5. On a match, hard-links `artifact.txt` to `<root>/published/<job>.txt` without overwrite. It removes only the
   container whose label carries its own token, and checks that it is gone.

Outcomes include `passed`, `input_rejected`, `worker_failed`, `timeout`, `interrupted`, `missing_output`,
`validation_failed`, `input_changed` and `controller_error`. Each attempt directory keeps `commands.json`,
`stdout.log`, `stderr.log` and a receipt matching [schemas/v1/receipt.json](schemas/v1/receipt.json).

## Use it

```sh
python3 -B -m tools.factory_runtime run <root> <spec.json>
python3 -B -m tools.factory_runtime reconcile <root> <attempt>
```

Run from the repository root. The spec matches [schemas/v1/job-spec.json](schemas/v1/job-spec.json):

| Field | Meaning |
|---|---|
| `version` | `1` |
| `job`, `attempt` | identifiers, `[a-zA-Z0-9_-]{1,80}` |
| `input`, `inputSha256` | one regular input file and its SHA-256 |
| `expectedSha256` | the SHA-256 the worker's stdout must match |
| `script` | shell command run as `/bin/sh -c` in the container |
| `timeoutSeconds` | greater than 0, at most 600 |

`run` prints the receipt as JSON. `reconcile` handles an attempt whose controller died, and refuses while that
controller is still alive.

## Example

`run` needs Docker through `sudo -n docker` and a qualified image, so only the refusal path runs here. The spec
names a one-line input file `/tmp/fr/in.txt`, its SHA-256 as both `inputSha256` and `expectedSha256`, and the script
`cat /in/input.txt`:

```console
$ python3 -B -m tools.factory_runtime run /tmp/fr/root /tmp/fr/spec.json
Traceback (most recent call last):
...
ValueError: Set ENDOFORGE_WORKER_IMAGE to a qualified image digest
$ ls /tmp/fr/root
controller.json  controller.lock
```

With no image configured it refuses after taking only the controller fence.

## Modules

- `core.py`: identifiers, `durable()` atomic JSON writes, the `Fence` controller lock, `validate_spec`,
  `validate_record` (job, attempt, stage and receipt records), the stage `TRANSITIONS` table and the `ROLES` table of
  what each role may read, write and reach on the network. Archive import is refused.
- `runner.py`: `run_attempt(...)` and `capture_attempt(...)`; the capture variant records stdout's hash and never
  publishes.
- `recovery.py`: `journal_before_create`, `reconcile(root, attempt)` and `reconcile_all(root)`. Reconciliation writes
  under `<root>/reconciliations/` and never removes containers by a global name or label.
- `scheduler.py`: `Scheduler(capacity=1..8, max_retries=2, backoff_seconds=60, root=None)`, a FIFO queue that retries
  only a `subscription_limit` outcome, with exponential backoff, and marks jobs running when a controller died as
  `unknown`. A run that raises or returns no `outcome` fails that job only; a saved queue of another version is
  refused.
- `egress.py`: a CONNECT proxy on a Unix socket that allows only port 443 to a fixed provider host list and checks TLS
  SNI; `worker_command` and `role_worker_command` build a `systemd-run --user --scope` plus `bwrap` command for a model
  worker; `run_bounded` caps combined output and kills the process group on excess.
- `bridge.py`: runs inside the worker, relaying `localhost:18080` to `/proxy.sock`.
- `local_provider.py`: a Unix-socket gateway that forwards only exact, non-streaming, temperature-0 chat requests to
  one loopback port; `call_protected(...)` runs one no-retry local turn, optionally owned by a `ModelJournal` from
  [factory_campaign](../factory_campaign/README.md).
- `wasm.py`: `run(module, export='run', ...)` runs a pinned Wasmtime with fuel, memory and epoch limits inside a
  `systemd-run` scope.

## Environment

- `ENDOFORGE_WORKER_IMAGE`: container image as `sha256:<64 hex>`. Default empty, which refuses every run.
- `ENDOFORGE_WASMTIME`: Wasmtime binary for `wasm.py`. Default `wasmtime`.
- `ENDOFORGE_WASMTIME_SHA256`: required SHA-256 of that binary; `wasm.run` refuses without it.

## Tests

`make gap-tools-test` runs `tools.factory_runtime.test_runtime_gaps` (REQ-FACTORY-003), which checks job specs and records against
the schema files, durable writes, fencing, the scheduler (FIFO, backoff, persistence, interrupted jobs, version
refusal), full runner attempts and crash reconciliation, the egress proxy refusals and TLS SNI check, `run_bounded`,
worker command assembly and role authority, the local provider gateway policy, and `wasm.run`. The Docker CLI is
replaced by [fixtures/fake_docker.py](fixtures/fake_docker.py), which runs each container script as a local process.

## Limits

- No real Docker daemon, systemd scope or Wasmtime binary is used by the tests. `wasm.run` runs through a stand-in
  `systemd-run` and Wasmtime; the real-binary case runs only when `ENDOFORGE_WASMTIME` and
  `ENDOFORGE_WASMTIME_SHA256` are set. `local_provider.call_protected` is tested only for its refusals, and the worker
  command from `egress.worker_command` is checked as assembled but never run with the `bridge.py` relay (GAP-EF-002).

Engineering record: component C-29, requirement REQ-FACTORY-003, GAP-EF-002.
