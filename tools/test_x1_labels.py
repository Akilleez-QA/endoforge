import hashlib
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from core.ledger.frozen import frozen_record
from core.ledger.ledger import Ledger
from tools import x1_loop

REPOSITORY = Path(__file__).resolve().parents[1]
NINE = {"G1_frozen", "G2_compiles", "G3_exports", "G4_tests", "G5_deterministic", "G6_bounded", "G7_glue", "G8_nonfinite", "G9_units"}
LEGACY_LABEL = "X1 G1-G7"
LEGACY_POLICY = "X1-G1-G8/v1"


def cli(*arguments, stdin=""):
    return subprocess.run([sys.executable, "-B", "-m", "tools.x1_ledger", *arguments], cwd=REPOSITORY,
                          input=stdin, capture_output=True, text=True, timeout=60)


def passing_records(gates):
    content = "kernel"
    candidate = hashlib.sha256(content.encode()).hexdigest()
    results = [dict(check=name, passed=True, reason="") for name in x1_loop.ROUND_CHECKS]
    results[-1]["reason"] = json.dumps(dict(promotable=True, gates={name: dict(ok=True) for name in gates}))
    attempts = [dict(candidate=candidate, round=number, stage="passed", firstFailure=None, frozen_evaluator="evr:legacy",
                     evaluator_digest="d", results=results) for number in (0, 1)]
    report = dict(stage="completed", frontier=[candidate], attempts=attempts, frozen_evaluator="evr:legacy", evaluator_digest="d")
    receipt = dict(candidate=candidate, frozen_evaluator="evr:legacy", delivery_state="finished", outcome_state="passed",
                   precommit=dict(oracle_version="d"), observations=[dict(status="completed", report=report)])
    records = dict(task=dict(kind="task", id="task", data=dict(intent="need", acceptance=LEGACY_LABEL)))
    records[candidate] = dict(kind="candidate", id=candidate, data=dict(content=content))
    records["receipt"] = dict(kind="receipt", id="receipt", data=receipt)
    return records, candidate


def decide(records, candidate):
    return x1_loop.decide(records, "tip", "hash", dict(reference=dict(identity="evr:legacy"), candidate=candidate,
                                                      receipt=dict(id="receipt", hash="hash")))


class Labels(unittest.TestCase):
    def test_constants_name_all_nine_gates(self):
        self.assertEqual(x1_loop.GATES, NINE)
        self.assertEqual(x1_loop.GATE_LABEL, "X1 G1-G9")
        self.assertEqual(x1_loop.POLICY, "X1-G1-G9/v2")

    def test_new_decisions_carry_the_nine_gate_policy(self):
        records, candidate = passing_records(NINE)
        decision = decide(records, candidate)
        self.assertEqual(decision["decision"], "promote")
        self.assertEqual(decision["policy"], "X1-G1-G9/v2")

    def test_eight_gates_are_refused(self):
        records, candidate = passing_records(NINE - {"G9_units"})
        self.assertEqual(decide(records, candidate)["decision"], "refuse")

    def test_admit_writes_the_nine_gate_labels(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "CONTRACT.md").write_text("contract")
            written = []
            job = dict(job=dict(reference=dict(root=root)), result=dict(need="need", configuration=dict(a=1)))
            x1_loop.admit(job, {}, written.append, None, sqlite3.connect(":memory:"))
        self.assertEqual(written[0]["data"]["acceptance"], "X1 G1-G9")
        self.assertEqual(json.loads(written[2]["data"]["content"])["residual"], "X1 G1-G9")

    def test_no_stale_failure_text(self):
        source = (REPOSITORY / "tools/x1_loop.py").read_text()
        self.assertNotIn("all seven gates", source)
        self.assertNotIn(LEGACY_LABEL, (REPOSITORY / "tools/x1_ledger.py").read_text())
        self.assertNotIn(LEGACY_POLICY, (REPOSITORY / "tools/x1_ledger.py").read_text())


class Migration(unittest.TestCase):
    def test_note_names_old_and_new_labels(self):
        note = x1_loop.LABEL_MIGRATION
        for text in (LEGACY_LABEL, LEGACY_POLICY, "X1 G1-G9", "X1-G1-G9/v2"):
            self.assertIn(text, note)

    def test_existing_frozen_record_shows_no_drift(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "CONTRACT.md").write_text("contract")
            record = frozen_record(root, task="task", admitted_input="input", **x1_loop.FREEZE_FACTS,
                                   configuration=dict(a=1), residual=LEGACY_LABEL, invariant_version="1")
            self.assertFalse(x1_loop.frozen_drift(record, root))
            self.assertEqual(json.loads(record["data"]["content"])["residual"], LEGACY_LABEL)

    def test_existing_ledger_with_old_labels_still_promotes(self):
        records, candidate = passing_records(NINE)
        self.assertEqual(records["task"]["data"]["acceptance"], LEGACY_LABEL)
        self.assertEqual(decide(records, candidate)["decision"], "promote")

    def test_stored_old_policy_decision_stays_durable_and_unchanged(self):
        records, candidate = passing_records(NINE)
        db = sqlite3.connect(":memory:")
        db.execute("CREATE TABLE records (id TEXT, hash TEXT)")
        db.execute("INSERT INTO records VALUES ('receipt', 'hash')")
        db.execute(x1_loop.DECISIONS)
        stored = x1_loop.sealed(dict(decision="promote", policy=LEGACY_POLICY, candidate=candidate))
        db.execute("INSERT INTO x1_decisions VALUES ('receipt', ?, ?)", (candidate, json.dumps(stored, sort_keys=True)))
        self.assertEqual(x1_loop.durable_promotion(dict(id="evr:legacy"), records, db), stored)


class CommandLine(unittest.TestCase):
    def assert_usage(self, done):
        self.assertEqual(done.returncode, 2, done.stderr)
        self.assertIn("usage:", done.stderr)
        self.assertNotIn("Traceback", done.stderr)
        self.assertEqual(done.stdout, "")

    def test_no_arguments_prints_usage(self):
        self.assert_usage(cli())

    def test_unknown_action_prints_usage(self):
        self.assert_usage(cli("unknown"))

    def test_extra_arguments_print_usage(self):
        self.assert_usage(cli("freeze", "extra"))

    def test_freeze_writes_the_nine_gate_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            root, path = Path(directory) / "evaluator", Path(directory) / "ledger.sqlite"
            root.mkdir()
            (root / "CONTRACT.md").write_text("contract")
            Ledger(path)
            request = dict(need="need", configuration=dict(a=1), reference=dict(ledger=str(path), root=str(root)))
            done = cli("freeze", stdin=json.dumps(request))
            self.assertEqual(done.returncode, 0, done.stderr)
            db = sqlite3.connect(path)
            bodies = [row[0] for row in db.execute("SELECT body FROM records ORDER BY seq")]
            db.close()
        self.assertIn("X1 G1-G9", bodies[0])
        self.assertTrue(any("G1-G9" in body for body in bodies[2:]))
        self.assertFalse(any("G1-G7" in body for body in bodies))

    def test_promote_refusal_carries_the_nine_gate_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.sqlite"
            Ledger(path)
            request = dict(reference=dict(ledger=str(path), identity="evr:x"), candidate="c", receipt={},
                           decisionPath=str(Path(directory) / "decision.json"))
            done = cli("promote", stdin=json.dumps(request))
        self.assertEqual(done.returncode, 0, done.stderr)
        decision = json.loads(done.stdout)
        self.assertEqual(decision["decision"], "refuse")
        self.assertEqual(decision["policy"], "X1-G1-G9/v2")


if __name__ == "__main__":
    unittest.main()
