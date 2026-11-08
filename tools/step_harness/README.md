# Step harness

A bounded agent step loop in which every step is recorded as POODO evidence. Pure Python standard library. It never calls a provider: the model, the core, the ledger and the clock are passed in.

## Entry point

[harness.py](harness.py) exports `StepHarness`, `Criterion`, `Limits` and `Result`, plus the verdict constants `DONE`, `BLOCKED`, `STOP_BUDGET`, `STOP_CLOCK`, `STOP_REPEAT`, `STOP_UNCERTAIN` and `STOP_MODEL`.

```python
from tools.step_harness.harness import StepHarness, Criterion, Limits

result = StepHarness(goal=..., criteria=[Criterion(...)], model=model, core=core,
                     ledger=ledger, clock=clock, limits=Limits()).run()
```

## Ports

- `model(view) -> dict`: returns a `tool_call` (with a plan, capability, operation, arguments and a precommitment of `expected_observation`, `success_boundary` and `failure_meaning`), a `claim_done`, or a `blocked`.
- `core.decide(proposal)` and `core.execute(decision_id)`: the POODO decision and execution. An adapter onto the real core is not part of this module.
- `ledger.append(kind, data)` and `clock()`, which must be monotonic seconds.
- Optional `summarise` and `constraints`.

## Behaviour

- `claim_done` is only an observation. The goal closes when every `Criterion` has matching evidence: a completed, responded outcome from its capability and operation that passes its `accepts` predicate. The model cannot supply that predicate.
- `Limits` defaults: `max_steps` 20, `max_seconds` 600, `repeat_limit` 3, `compact_threshold_tokens` 8000, `keep_recent_steps` 2. History is compacted only between steps. Token counts are a four-characters-per-token estimate.
- `run()` returns a `Result` with `verdict`, `reason`, `steps`, `evidence` and an optional `checkpoint`.

No environment variables are read.

## Test

```sh
make harness-test
```

This ran 12 tests in [test_harness.py](test_harness.py), all passing.
