# Step harness (retired)

The step harness, a bounded host-decided agent loop over an injected POODO decision core, now lives in
[TODELETE/tools/step_harness](../../TODELETE/tools/step_harness/README.md) with its tests. Nothing in EndoForge called it,
and round 5 (P4) found that no caller belongs in this repository:

- Its contract is `core.decide(proposal)` and `core.execute(decision_id)` on a POODO core. No POODO core is in this
  repository. `poodo_core` is in the sibling cstack checkout, and its `EndoforgePort` offers only ledger append, read
  and verify ([P-19 RESULT](../../experiments/P-19-need-to-candidate/RESULT.md)). An adapter written here would be a
  stand-in, not a real decision core.
- The conductor's per-atom loop runs `claude -p` or Codex ([conductor README](../conductor/README.md)). Those agents
  run their own tool calls, so the host cannot decide and run each call as the harness needs.
- The job tool checks a manifest against the POODO gates and waits for the user's go. It does not run an agent loop
  ([tools/job](../job/README.md)).
- EndoForge's host-decided agent loop already exists: the candidate loop in `core/runtime/x1/` (`pipeline.mjs`,
  `loop.mjs`, `gates.mjs`). There the agent writes code, the host runs the frozen tests and gates, and the agent never
  grades its own work. A second loop in Python would duplicate it.

## Tests

`make harness-test` runs [test_retired.py](test_retired.py). It checks that the harness is no longer under `tools/`,
that the archive holds `harness.py`, `test_harness.py` and the README and can be imported, that the 12 archived tests
still pass, and that no tracked code outside `TODELETE/` imports or constructs it.
