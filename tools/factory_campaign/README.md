# Factory campaign

Python helpers that keep a multi-stage campaign's state durable across crashes, record which model stage owns which
worker process, and apply one bounded repair to a failed candidate. They make no model calls and never retry on
their own. They come from the earlier factory design; nothing outside their own tests imports them today.

## Why it exists

A campaign that runs for hours will meet a crash, a reboot or two controllers started by mistake. These helpers make
each of those safe: state is rebuilt from a hash-chained log rather than trusted from a snapshot, a second controller
is fenced out, and an interrupted model stage is recorded as `unknown` instead of being retried or guessed.

## Modules

- `state.py`: an append-only, hash-chained stage-state log with an atomically replaced snapshot.
  - `record(jobdir, state)` writes `state-events/NNNNNNNN.json` (each event names the SHA-256 of the previous one),
    then replaces `state.json`, holding an exclusive lock on `state.lock`.
  - `recover(jobdir)` checks the chain and rewrites `state.json` from the last durable event if the snapshot is
    missing, corrupt or behind.
  - `chain(jobdir)` returns the events and the head hash, and raises on any gap, reorder, symlink or version mismatch.
- `model_journal.py`: `ModelJournal(root)`, a fenced journal of model-stage ownership, used as a context manager, one
  per campaign.
  - `new_attempt(stage, family, prompt_sha256, retry_of=None)` plans an attempt; each attempt owns a systemd user
    scope named `endoforge-worker-<attempt>.scope` (`scope_description(attempt)`).
  - `started(attempt, pid)`, `finish(attempt, outcome)`, `cleanup_owned(attempt)` and `reconcile(attempt)` move it
    through its states. `reconcile` records `unknown` for an interrupted stage. Cleanup stops a scope only when its
    Description matches. `promotionAllowed` and `automaticRetry` are always false.
- `repair.py`: `patch(...)` applies one bounded text replacement to a failed `kernel.ts` or `glue.json` candidate and
  writes a new `<name>.repair-<n>` file. Round 0 patches the original; round `n` patches `<name>.repair-<n>`. It
  refuses if the candidate's hash changed, the match is not unique, the round limit is reached, the dispute is not an
  `implementation-defect`, no frozen path is given, the candidate is itself listed as frozen, or any frozen path
  changed (the new file is then removed).

## Example

```console
$ make factory-state-test
python3 -B -m tools.factory_campaign.test_model_journal && python3 -B -m tools.factory_campaign.test_state && true
{"path": "<repo>/.test-work/model-journal-9a7b6b36d7d14e51aa9c6f6c2d911f37", "passed": true, "checks": 31}
{"passed": true, "boundaries": 2, "receipt": "<repo>/.test-work/state-controls/state-recovery.json"}
```

The journal test passed 31 checks; the state test crashed the writer at two boundaries and recovered both.

## Limits

- The tests use `unittest` assertions, so they still check under `make test-optimized` (`python3 -O`).
- The journal test uses short-lived local `sleep` processes with `stop_scope=False`, so it never touches systemd.

## Tests

`make factory-state-test` runs `test_model_journal`, `test_repair` and `test_state`. The journal and state tests
write receipts under `ENDOFORGE_TEST_OUTPUT` (the Makefile sets `.test-work`); `test_repair` (GAP-EF-006) covers
chained rounds, every refusal and frozen-path mutation.

Engineering record: component C-25, requirement REQ-FACTORY-001.
