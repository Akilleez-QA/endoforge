# Factory campaign

Python helpers that keep campaign stage state durable across crashes. They make no model calls and never retry on their own.

## Modules

- `state.py`: an append-only, hash-chained stage-state log with an atomically replaced snapshot.
  - `record(jobdir, state)` writes `state-events/NNNNNNNN.json` (each event names the SHA-256 of the previous one), then replaces `state.json`. It holds an exclusive lock on `state.lock`.
  - `recover(jobdir)` checks the chain and rewrites `state.json` from the last durable event if the snapshot is missing, corrupt or behind.
  - `chain(jobdir)` returns the events and the head hash, and raises on any gap, reorder, symlink or version mismatch.
- `model_journal.py`: `ModelJournal(root)`, a fenced journal of model-stage ownership. Use it as a context manager, one per campaign.
  - `new_attempt(stage, family, prompt_sha256, retry_of=None)` plans an attempt. Each attempt owns a systemd user scope named `endoforge-worker-<attempt>.scope`, described by `scope_description(attempt)`.
  - `started(attempt, pid)`, `finish(attempt, outcome)`, `cleanup_owned(attempt)` and `reconcile(attempt)` move it through its states.
  - `reconcile` records `unknown` for an interrupted stage. Cleanup stops a scope only when its Description matches. `promotionAllowed` and `automaticRetry` are always false.
- `repair.py`: `patch(...)` applies one bounded text replacement to a failed `kernel.ts` or `glue.json` candidate. It writes a new `<name>.repair-<n>` file and refuses if the candidate hash changed, the match is not unique, the round limit is reached, the dispute is not an `implementation-defect`, or any frozen path changed.

## Tests

```
make factory-state-test
```

This runs `python3 -B -m tools.factory_campaign.test_model_journal` and `python3 -B -m tools.factory_campaign.test_state`. Both read `ENDOFORGE_TEST_OUTPUT` (the Makefile sets it to `.test-work`) and write their receipts there. The journal test uses short-lived local `sleep` processes and passes `stop_scope=False`, so it does not touch systemd. When run, the two tests reported 31 passing checks and 2 crash boundaries recovered.

`repair.py` has no test of its own.
