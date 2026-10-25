"""Endoforge core lifecycle: legal and illegal transitions, identity separation, and "generation grants nothing".

Run from the repository root: python3 -B -m unittest tests.test_endoforge_lifecycle
"""
from dataclasses import FrozenInstanceError, replace
import hashlib
import unittest

from forge.endoforge.core.lifecycle import (LEGAL, Artifact, LifecycleError, LifecycleRecord, PoodoDecision, QualificationReceipt,
                        State, TransitionProposal)


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


INPUTS, CANDIDATE, ORACLE = sha("inputs"), sha("candidate"), "oracle.frozen-v1"


class Decider:
    """Stands in for POODO: issues one fresh decision id per proposal it is shown, across all instances."""
    issued = [0]

    def __call__(self, proposal):
        self.issued[0] += 1
        return PoodoDecision(f"decision-{self.issued[0]}", proposal.sha256)


def step(record, decide, to_state, **evidence):
    return record.apply(proposal := record.proposal(to_state, **evidence), decide(proposal))


def through(state, decide=None):
    """Drive a fresh record along the happy path up to and including `state`."""
    decide = decide or Decider()
    record = LifecycleRecord.propose("task.ui-1", INPUTS, ORACLE)
    path = [(State.GENERATED, {"candidate_sha256": CANDIDATE}),
            (State.QUALIFIED, {"receipt": QualificationReceipt(CANDIDATE, ORACLE, "pass")}),
            (State.PREVIEWED, {"preview_ref": "preview.1"}),
            (State.ACTIVATED, {"host_approval_ref": "approval.craig-via-friday.1"})]
    for target, evidence in path:
        if record.state is state:
            break
        record = step(record, decide, target, **evidence)
    return record


class TransitionTests(unittest.TestCase):
    def test_happy_path_records_every_decision(self):
        record = step(through(State.ACTIVATED), Decider(), State.DISPOSED, reason="superseded")
        self.assertIs(record.state, State.DISPOSED)
        self.assertEqual([t.proposal.to_state for t in record.history],
                         [State.GENERATED, State.QUALIFIED, State.PREVIEWED, State.ACTIVATED, State.DISPOSED])

    def test_every_illegal_pair_is_refused(self):
        records = {s: through(s) for s in (State.PROPOSED, State.GENERATED, State.QUALIFIED, State.PREVIEWED,
                                           State.ACTIVATED)}
        records[State.FAILED] = step(through(State.GENERATED), Decider(), State.FAILED, reason="crash")
        records[State.REJECTED] = step(through(State.QUALIFIED), Decider(), State.REJECTED, reason="preview")
        records[State.DISPOSED] = step(through(State.PROPOSED), Decider(), State.DISPOSED, reason="unneeded")
        for source, record in records.items():
            for target in State:
                if source in LEGAL.get(target, ()):
                    continue
                with self.subTest(source=source, target=target), self.assertRaises(LifecycleError):
                    record.proposal(target, reason="x")

    def test_disposal_is_always_allowed_and_recorded(self):
        for state in (State.PROPOSED, State.GENERATED, State.QUALIFIED, State.PREVIEWED, State.ACTIVATED):
            record = step(through(state), Decider(), State.DISPOSED, reason="retired")
            self.assertIs(record.state, State.DISPOSED)
            self.assertEqual(dict(record.history[-1].proposal.evidence), {"reason": "retired"})
        failed = step(through(State.PROPOSED), Decider(), State.FAILED, reason="no route")
        self.assertIs(step(failed, Decider(), State.DISPOSED, reason="scrap").state, State.DISPOSED)

    def test_qualification_needs_a_passing_receipt_under_the_frozen_oracle(self):
        record = through(State.GENERATED)
        for receipt in (QualificationReceipt(CANDIDATE, "oracle.swapped", "pass"),
                        QualificationReceipt(sha("other bytes"), ORACLE, "pass"),
                        QualificationReceipt(CANDIDATE, ORACLE, "fail")):
            with self.subTest(receipt=receipt), self.assertRaises(LifecycleError):
                record.proposal(State.QUALIFIED, receipt=receipt)
        with self.assertRaises(LifecycleError):
            record.proposal(State.QUALIFIED, receipt={"candidate_sha256": CANDIDATE, "oracle_id": ORACLE,
                                                      "verdict": "pass"})

    def test_activation_needs_preview_and_host_approval(self):
        with self.assertRaises(LifecycleError):
            through(State.QUALIFIED).proposal(State.ACTIVATED, host_approval_ref="approval.1")
        with self.assertRaises(LifecycleError):
            through(State.PREVIEWED).proposal(State.ACTIVATED)
        with self.assertRaises(LifecycleError):
            through(State.PREVIEWED).proposal(State.ACTIVATED, host_approval_ref="not an id!")


class DecisionTests(unittest.TestCase):
    def test_a_transition_applies_only_with_a_decision_bound_to_its_digest(self):
        record = through(State.PROPOSED)
        proposal = record.proposal(State.GENERATED, candidate_sha256=CANDIDATE)
        for decision in (None, PoodoDecision("d1", sha("another proposal"))):
            with self.assertRaises(LifecycleError):
                record.apply(proposal, decision)
        self.assertIs(record.apply(proposal, PoodoDecision("d1", proposal.sha256)).state, State.GENERATED)

    def test_decisions_are_consumed_once_and_stale_proposals_refused(self):
        record = through(State.PROPOSED)
        first = record.proposal(State.GENERATED, candidate_sha256=CANDIDATE)
        generated = record.apply(first, PoodoDecision("d1", first.sha256))
        with self.assertRaises(LifecycleError):
            generated.apply(first, PoodoDecision("d2", first.sha256))
        nxt = generated.proposal(State.FAILED, reason="x")
        with self.assertRaises(LifecycleError):
            generated.apply(nxt, PoodoDecision("d1", nxt.sha256))

    def test_a_hand_built_proposal_cannot_skip_the_rules(self):
        record = through(State.GENERATED)
        forged = TransitionProposal(record.artifact.key, State.GENERATED, State.ACTIVATED,
                                    (("host_approval_ref", "approval.1"),))
        with self.assertRaises(LifecycleError):
            record.apply(forged, PoodoDecision("d9", forged.sha256))

    def test_a_hand_set_state_or_artifact_is_refused(self):
        qualified = through(State.QUALIFIED)
        for changes in ({"state": State.PREVIEWED}, {"history": ()},
                        {"artifact": Artifact("task.ui-1", INPUTS, CANDIDATE, sha("forged receipt"))}):
            with self.subTest(changes=changes), self.assertRaises(LifecycleError):
                replace(qualified, **changes)
        with self.assertRaises(LifecycleError):
            LifecycleRecord(Artifact("task.ui-1", INPUTS, CANDIDATE), ORACLE)


class GenerationGrantsNothingTests(unittest.TestCase):
    def test_a_generated_artifact_holds_no_qualification_or_activation(self):
        record = through(State.GENERATED)
        self.assertIsNone(record.artifact.qualification_receipt_sha256)
        for target, evidence in ((State.PREVIEWED, {"preview_ref": "p"}),
                                 (State.ACTIVATED, {"host_approval_ref": "a"})):
            with self.subTest(target=target), self.assertRaises(LifecycleError):
                record.proposal(target, **evidence)

    def test_generation_cannot_carry_its_own_claims(self):
        record = through(State.PROPOSED)
        for extra in ({"receipt": QualificationReceipt(CANDIDATE, ORACLE, "pass")}, {"qualified": True},
                      {"host_approval_ref": "approval.1"}):
            with self.subTest(extra=extra), self.assertRaises(LifecycleError):
                record.proposal(State.GENERATED, candidate_sha256=CANDIDATE, **extra)

    def test_the_generation_decision_does_not_authorize_the_next_step(self):
        decide = Decider()
        record = through(State.GENERATED, decide)
        proposal = record.proposal(State.QUALIFIED, receipt=QualificationReceipt(CANDIDATE, ORACLE, "pass"))
        with self.assertRaises(LifecycleError):
            record.apply(proposal, PoodoDecision(record.history[-1].decision_id, proposal.sha256))


class IdentityTests(unittest.TestCase):
    def test_the_four_identities_are_distinct(self):
        with self.assertRaises(LifecycleError):
            Artifact("task.1", INPUTS, INPUTS)
        with self.assertRaises(LifecycleError):
            Artifact("task.1", INPUTS, CANDIDATE, CANDIDATE)
        with self.assertRaises(LifecycleError):
            Artifact("task.1", INPUTS, None, sha("receipt"))
        with self.assertRaises(LifecycleError):
            through(State.PROPOSED).proposal(State.GENERATED, candidate_sha256=INPUTS)

    def test_same_candidate_from_other_inputs_or_task_is_another_artifact(self):
        a = Artifact("task.1", INPUTS, CANDIDATE)
        self.assertNotEqual(a.key, Artifact("task.1", sha("other inputs"), CANDIDATE).key)
        self.assertNotEqual(a.key, Artifact("task.2", INPUTS, CANDIDATE).key)

    def test_qualification_adds_the_receipt_identity_without_changing_the_others(self):
        generated, qualified = through(State.GENERATED), through(State.QUALIFIED)
        receipt = QualificationReceipt(CANDIDATE, ORACLE, "pass")
        self.assertEqual(qualified.artifact.qualification_receipt_sha256, receipt.sha256)
        self.assertEqual((qualified.artifact.task_id, qualified.artifact.generation_inputs_sha256,
                          qualified.artifact.candidate_sha256),
                         (generated.artifact.task_id, INPUTS, CANDIDATE))
        self.assertNotEqual(receipt.sha256, CANDIDATE)

    def test_records_are_immutable(self):
        record = through(State.QUALIFIED)
        with self.assertRaises(FrozenInstanceError):
            record.state = State.ACTIVATED
        with self.assertRaises(FrozenInstanceError):
            record.artifact.candidate_sha256 = sha("swap")


if __name__ == "__main__":
    unittest.main()
