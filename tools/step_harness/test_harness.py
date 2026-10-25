"""Step harness tests with a scripted fake model and a fake core. No models or network.

Run from forge/endoforge:  python3 -B -m unittest tools.step_harness.test_harness -v
"""
import unittest

from tools.step_harness.harness import (BLOCKED, DONE, STOP_BUDGET, STOP_CLOCK, STOP_REPEAT,
                                        STOP_UNCERTAIN, Criterion, Limits, StepHarness)

PRE = {"expected_observation": "a reading", "success_boundary": "one call",
       "failure_meaning": "no accepted observation"}
GOAL = {"goal_id": "g", "revision": 1, "objective": "Observe one synthetic reading"}
CRITERIA = (Criterion("c1", "A reading was observed", "sensor", "reading"),)


def call(n=0, op="reading"):
    return {"kind": "tool_call", "plan": "read", "capability_id": "sensor", "operation": op,
            "arguments": {"n": n}, "precommitment": dict(PRE)}


class ScriptedModel:
    def __init__(self, *script):
        self.script, self.views = list(script), []

    def __call__(self, view):
        self.views.append(view)
        return self.script.pop(0) if len(self.script) > 1 else self.script[0]


class FakeLedger:
    def __init__(self):
        self.events = []

    def append(self, kind, data):
        event = {"sequence": len(self.events) + 1, "kind": kind, "data": data,
                 "event_sha256": "%064x" % (len(self.events) + 1)}
        self.events.append(event)
        return event

    def kinds(self):
        return [e["kind"] for e in self.events]


class FakeCore:
    def __init__(self, outcome=None, refuse=None):
        self.decided, self.executed = [], []
        self.outcome = outcome or {"execution_status": "completed", "execution_certainty": "responded",
                                   "raw_result": {"value": 1}}
        self.refuse = refuse

    def decide(self, proposal):
        self.decided.append(proposal)
        if self.refuse:
            return {"status": "refused", **self.refuse}
        return {"status": "decided", "decision_id": "d-%d" % len(self.decided)}

    def execute(self, decision_id):
        self.executed.append(decision_id)
        return dict(self.outcome)


class Clock:
    def __init__(self, step=0.0):
        self.now, self.step = 0.0, step

    def __call__(self):
        self.now += self.step
        return self.now


def harness(model, core=None, ledger=None, clock=None, criteria=CRITERIA, **limits):
    return StepHarness(goal=GOAL, criteria=criteria, model=model, core=core or FakeCore(),
                       ledger=ledger or FakeLedger(), clock=clock or Clock(), limits=Limits(**limits))


class StepHarnessTests(unittest.TestCase):
    def test_done_needs_matching_evidence_and_records_every_step(self):
        ledger = FakeLedger()
        result = harness(ScriptedModel(call()), ledger=ledger).run()
        self.assertEqual(result.verdict, DONE)
        self.assertEqual(result.evidence["c1"]["decision_id"], "d-1")
        self.assertEqual(ledger.kinds(), ["harness.proposal", "harness.decision", "harness.outcome",
                                          "harness.judgement", "harness.verdict"])
        self.assertEqual(result.evidence["c1"]["ledger_ref"]["sequence"], 3)
        self.assertIs(ledger.events[-1]["data"]["goal_closed"], False)

    def test_budget_stop(self):
        core = FakeCore()
        result = harness(ScriptedModel(*[call(i, "other") for i in range(10)]), core=core, max_steps=4).run()
        self.assertEqual((result.verdict, result.steps), (STOP_BUDGET, 4))
        self.assertEqual(len(core.executed), 4)

    def test_wall_clock_stop(self):
        result = harness(ScriptedModel(*[call(i, "other") for i in range(50)]), clock=Clock(step=1.0),
                         max_seconds=5.0).run()
        self.assertEqual(result.verdict, STOP_CLOCK)
        self.assertLess(result.steps, 5)

    def test_repetition_stop_never_dispatches_the_looped_call(self):
        core, ledger = FakeCore(), FakeLedger()
        result = harness(ScriptedModel(call(7, "other")), core=core, ledger=ledger, repeat_limit=3).run()
        self.assertEqual((result.verdict, result.steps), (STOP_REPEAT, 3))
        self.assertEqual(len(core.decided), 2)
        self.assertEqual(ledger.events[-2]["data"]["kind"], "repeated_call")

    def test_compaction_keeps_ledger_references(self):
        ledger = FakeLedger()
        model = ScriptedModel(*[call(i, "other") for i in range(8)])
        h = harness(model, ledger=ledger, max_steps=8, compact_threshold_tokens=200, keep_recent_steps=2)
        result = h.run()
        self.assertEqual(result.verdict, STOP_BUDGET)
        cp = result.checkpoint
        self.assertIsNotNone(cp)
        self.assertEqual(set(cp), {"goal", "decisions", "evidence", "open_questions", "notes",
                                   "ledger_refs", "folded_steps"})
        self.assertEqual(cp["goal"], GOAL)
        self.assertIn("c1: A reading was observed", cp["open_questions"])
        folded = {s["step"] for s in cp["decisions"]}
        step_refs = {e["sequence"] for e in ledger.events
                     if e["kind"] != "harness.checkpoint" and e["data"].get("step") in folded}
        self.assertEqual({r["sequence"] for r in cp["ledger_refs"]}, step_refs)
        self.assertEqual(len(folded), cp["folded_steps"])
        self.assertIn("harness.checkpoint", ledger.kinds())
        self.assertLessEqual(len(model.views[-1]["recent_steps"]), 3)
        self.assertIs(model.views[-1]["checkpoint"], cp)

    def test_blocked_verdict_is_separate_from_done(self):
        result = harness(ScriptedModel({"kind": "blocked", "reason": "needs Craig's input"})).run()
        self.assertEqual(result.verdict, BLOCKED)
        self.assertEqual(result.evidence, {})
        core = FakeCore(refuse={"reason": "approval pending", "blocking": True})
        result = harness(ScriptedModel(call()), core=core).run()
        self.assertEqual(result.verdict, BLOCKED)
        self.assertEqual(core.executed, [])

    def test_refuses_done_claim_without_evidence(self):
        core = FakeCore(outcome={"execution_status": "tool_error", "execution_certainty": "responded",
                                 "raw_result": None})
        claim = {"kind": "claim_done", "text": "All criteria met, trust me."}
        result = harness(ScriptedModel(claim, call(), claim, claim), core=core, max_steps=4).run()
        self.assertEqual(result.verdict, STOP_BUDGET)
        self.assertEqual(result.evidence, {})
        picky = (Criterion("c1", "Value above 5", "sensor", "reading", lambda r: r["value"] > 5),)
        self.assertEqual(harness(ScriptedModel(call(), claim), criteria=picky, max_steps=2).run().verdict,
                         STOP_BUDGET)
        later = harness(ScriptedModel(claim, call()), max_steps=3).run()
        self.assertEqual((later.verdict, later.steps), (DONE, 2))

    def test_no_retry_after_unknown_outcome(self):
        core = FakeCore(outcome={"execution_status": "indeterminate", "execution_certainty": "unknown",
                                 "raw_result": None})
        ledger = FakeLedger()
        result = harness(ScriptedModel(call()), core=core, ledger=ledger).run()
        self.assertEqual((result.verdict, result.steps), (STOP_UNCERTAIN, 1))
        self.assertEqual(core.executed, ["d-1"])
        self.assertEqual(ledger.kinds()[-2:], ["harness.outcome", "harness.verdict"])

    def test_execute_exception_is_unknown_not_retried(self):
        class Raising(FakeCore):
            def execute(self, decision_id):
                self.executed.append(decision_id)
                raise TimeoutError("transport dropped")
        core = Raising()
        result = harness(ScriptedModel(call()), core=core).run()
        self.assertEqual((result.verdict, core.executed), (STOP_UNCERTAIN, ["d-1"]))

    def test_malformed_proposal_and_non_blocking_refusal_continue(self):
        core = FakeCore(refuse={"reason": "denied operation", "blocking": False})
        bad = {"kind": "tool_call", "capability_id": "sensor", "operation": "reading", "arguments": {}}
        result = harness(ScriptedModel(bad, call()), core=core, max_steps=3).run()
        self.assertEqual(result.verdict, STOP_BUDGET)
        self.assertEqual(core.executed, [])
        self.assertEqual(len(core.decided), 2)  # Steps 2 and 3; the repeat limit is not reached.

    def test_single_use(self):
        h = harness(ScriptedModel(call()))
        h.run()
        with self.assertRaises(RuntimeError):
            h.run()


if __name__ == "__main__":
    unittest.main()
