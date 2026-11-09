# Step harness (archived)

Archived in round 5 (P4): nothing in EndoForge calls it, and no caller belongs in this repository. Why is in
[tools/step_harness/README.md](../../../tools/step_harness/README.md). It stays here, tested, until it is deleted.

The step harness is a bounded loop for one agent working towards one goal, where the agent never decides that it is
done. Each turn the model proposes a tool call (with what it expects to see), the host decides and executes it, and
every step is written to a ledger. The goal closes only when host-owned evidence satisfies every acceptance criterion;
the model saying "done" is recorded as an observation and nothing more.

It is pure Python standard library and never calls a model provider: the model, the decision core, the ledger and the
clock are passed in. Nothing in EndoForge calls it yet; it is a tested library for building an agent loop on the
POODO decision core.

## How it works

- `model(view) -> dict` returns a `tool_call` (plan, capability, operation, arguments and a precommitment of
  `expected_observation`, `success_boundary` and `failure_meaning`), a `claim_done` (with `text`) or a `blocked` (with
  `reason`).
- `core.decide(proposal)` returns a decision id or a refusal; `core.execute(decision_id)` returns an outcome with
  `execution_status`, `execution_certainty` and `raw_result`. An adapter onto the real POODO core is not part of this
  module.
- `ledger.append(kind, data)` and `clock()` (monotonic seconds). Optional `summarise` and `constraints`.
- A `Criterion(criterion_id, text, capability_id, operation, accepts=...)` is met by a completed, responded outcome
  from that capability and operation whose `raw_result` passes `accepts`. The model cannot supply or widen `accepts`.

The loop stops with `DONE`, `BLOCKED`, `STOPPED_BUDGET` (steps), `STOPPED_CLOCK` (seconds), `STOPPED_REPETITION` (the
same tool call proposed `repeat_limit` times, not dispatched again), `HALTED_UNCERTAIN_OUTCOME` (an outcome that may or
may not have happened is never retried) or `STOPPED_MODEL_ERROR`. `Limits` defaults: `max_steps` 20, `max_seconds`
600, `repeat_limit` 3, `compact_threshold_tokens` 8000, `keep_recent_steps` 2. History is compacted only between steps;
token counts are a four-characters-per-token estimate.

## Example

Saved as `step_demo.py` in the repository root. The scripted model first claims it is done, then runs the tests:

```python
from TODELETE.tools.step_harness.harness import StepHarness, Criterion, Limits

pre = {"expected_observation": "the test summary", "success_boundary": "exit 0", "failure_meaning": "a failing test"}
script = [{"kind": "claim_done", "text": "tests pass"},
          {"kind": "tool_call", "plan": "run the tests", "capability_id": "shell", "operation": "test",
           "arguments": {}, "precommitment": pre}]

class Core:
    def decide(self, proposal): return {"status": "decided", "decision_id": "d1"}
    def execute(self, decision_id):
        return {"execution_status": "completed", "execution_certainty": "responded", "raw_result": {"exit": 0}}

class Ledger:
    def __init__(self): self.kinds = []
    def append(self, kind, data): self.kinds.append(kind); return {"sequence": len(self.kinds), "event_sha256": "0" * 64}

ticks = iter(range(1000))
ledger = Ledger()
result = StepHarness(goal={"goal_id": "g", "revision": 1, "objective": "Make the tests pass"},
                     criteria=[Criterion("c1", "the tests ran and passed", "shell", "test",
                                         accepts=lambda raw: raw.get("exit") == 0)],
                     model=lambda view: script.pop(0), core=Core(), ledger=ledger,
                     clock=lambda: float(next(ticks)), limits=Limits()).run()
print(result.verdict, result.steps, result.reason)
print(ledger.kinds)
```

```console
$ python3 -B step_demo.py
DONE 2 every acceptance criterion has matching evidence
['harness.proposal', 'harness.judgement', 'harness.proposal', 'harness.decision', 'harness.outcome', 'harness.judgement', 'harness.verdict']
```

The first claim of "done" was judged and the loop went on. The goal closed only after the tests actually ran and
returned exit 0.

## Tests

`make harness-test` runs [test_retired.py](../../../tools/step_harness/test_retired.py), which runs
[test_harness.py](test_harness.py) (12 tests, a scripted model and a fake core): done needs
matching evidence, a repeated call is never dispatched, blocked is separate from done, no retry after an unknown
outcome, compaction re-injects constraints, and a harness runs once.

Engineering record: component C-20, requirement REQ-STEP-001.
