# Factory runtime

The trusted host side of a version 1 worker runtime (`VERSION = 1` in `__init__.py`). It runs one worker attempt at a time in a locked-down container, validates its output against a hash the caller supplies, and publishes the result once. It is a library, not an application integration.

## Command line

```
python3 -B -m tools.factory_runtime run <root> <spec.json>
python3 -B -m tools.factory_runtime reconcile <root> <attempt>
```

Run it from the repository root. `run` reads a job spec that matches [schemas/v1/job-spec.json](schemas/v1/job-spec.json):

| Field | Meaning |
|---|---|
| `version` | `1` |
| `job`, `attempt` | identifiers, `[a-zA-Z0-9_-]{1,80}` |
| `input`, `inputSha256` | path to one regular input file and its SHA-256 |
| `expectedSha256` | SHA-256 the worker's stdout must match |
| `script` | shell command run as `/bin/sh -c` in the container |
| `timeoutSeconds` | greater than 0, at most 600 |

It prints the receipt as JSON. `reconcile` handles an attempt whose controller died; it refuses while the controller is still alive.

`run` needs Docker through `sudo -n docker` and a qualified image, so only the refusal path was run here. With `ENDOFORGE_WORKER_IMAGE` unset, `run` on a synthetic spec stopped with `ValueError: Set ENDOFORGE_WORKER_IMAGE to a qualified image digest` after writing only `controller.json` and `controller.lock` under `<root>`. `--help` prints the usage above.

## What a run does

1. Takes the controller fence (`Fence` in `core.py`) and writes a journal under `<root>/journals/` before creating anything.
2. Copies the input into `<root>/attempts/<attempt>/input.txt` and refuses if its hash differs.
3. Creates a container labelled with a per-attempt owner token, with no network, a read-only root, all capabilities dropped, 1 CPU, 512 MiB memory, 32 pids, and small `/tmp` and `/out` tmpfs mounts.
4. Waits up to the timeout, then reads stdout as the only artifact channel and compares its hash with `expectedSha256`.
5. On a match, hard-links `artifact.txt` to `<root>/published/<job>.txt` without overwrite. It removes only the container whose label carries its own token, and checks that it is gone.

Outcomes include `passed`, `input_rejected`, `worker_failed`, `timeout`, `interrupted`, `missing_output`, `validation_failed`, `input_changed` and `controller_error`. Each attempt directory keeps `commands.json`, `stdout.log`, `stderr.log` and a receipt that matches [schemas/v1/receipt.json](schemas/v1/receipt.json).

## Modules

- `core.py`: identifiers, `durable()` atomic JSON writes, the `Fence` controller lock, `validate_spec`, `validate_record` (job, attempt, stage and receipt records), the stage `TRANSITIONS` table and the `ROLES` table of what each role may read, write and reach on the network. Archive import is refused.
- `runner.py`: `run_attempt(...)` and `capture_attempt(...)`. The capture variant records stdout's hash and never publishes.
- `recovery.py`: `journal_before_create`, `reconcile(root, attempt)` and `reconcile_all(root)`. Reconciliation writes under `<root>/reconciliations/` and never removes containers by a global name or label.
- `scheduler.py`: `Scheduler(capacity=1..8, max_retries=2, backoff_seconds=60, root=None)`, a FIFO queue. It retries only a `subscription_limit` outcome, with exponential backoff, and marks jobs that were running when a controller died as `unknown`.
- `egress.py`: a CONNECT proxy on a Unix socket that allows only port 443 to a fixed provider host list and checks TLS SNI; `worker_command` and `role_worker_command` build a `systemd-run --user --scope` plus `bwrap` command for a model worker; `run_bounded` caps combined output and kills the process group on excess.
- `bridge.py`: runs inside the worker, relaying `localhost:18080` to `/proxy.sock`.
- `local_provider.py`: a Unix-socket gateway that forwards only exact, non-streaming, temperature 0 chat requests to one loopback port; `call_protected(...)` runs one no-retry local turn, optionally owned by a `ModelJournal` from [factory_campaign](../factory_campaign/README.md).
- `wasm.py`: `run(module, export='run', ...)` runs a pinned Wasmtime with fuel, memory and epoch limits inside a `systemd-run` scope.

The model-worker paths (`egress.py`, `local_provider.py`) start model clients and were not run.

## Environment

- `ENDOFORGE_WORKER_IMAGE`: container image as `sha256:<64 hex>`. Default empty, which refuses every run.
- `ENDOFORGE_WASMTIME`: Wasmtime binary for `wasm.py`. Default `wasmtime`.
- `ENDOFORGE_WASMTIME_SHA256`: required SHA-256 of that binary. No default; `wasm.run` refuses without it.

## Tests

No `make` target runs tests for this package.
