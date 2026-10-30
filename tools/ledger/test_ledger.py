from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
import sqlite3
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from .ledger import Ledger, SCHEMA, conforms


def record(kind, identity, **data):
    return {"version": 0, "kind": kind, "id": identity, "data": data}


def chain():
    return [
        record("task", "t1", intent="Double the input", acceptance="2 becomes 4"),
        record("admitted_input", "i1", task="t1", content="2", origin="user"),
        record("frozen_evaluator", "e1", task="t1", admitted_input="i1",
               content="assert candidate(2) == 4", confirmed_by="task contract"),
        record("candidate", "c1", task="t1", admitted_input="i1", content="x * 2", proposer="worker"),
        record("receipt", "r1", task="t1", candidate="c1", frozen_evaluator="e1",
               precommit={"observable": "output", "acceptance_boundary": "equals 4", "oracle": "e1",
                          "oracle_version": "0", "artifact_identity": "c1", "environment": {"runtime": "test"},
                          "failure_meaning": "incorrect doubling", "stop_condition": "one case"},
               delivery_state="finished", outcome_state="passed", observations=[{"output": 4}]),
    ]


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "ledger.sqlite"
        self.ledger = Ledger(self.path)

    def seed(self):
        for row in chain():
            self.ledger.append(row)

    def test_temporary_databases_and_nonfinite_payloads_are_refused(self):
        for path in ("", ":memory:"):
            with self.assertRaisesRegex(ValueError, "durable storage"):
                Ledger(path)
        for number in (float("nan"), float("inf"), float("-inf")):
            with self.assertRaises(ValueError):
                self.ledger.append(record("task", "t1", intent="Test", acceptance=number))
        self.assertEqual(self.ledger.records(), [])

    def test_round_trip_five_records_and_independent_return_values(self):
        self.seed()
        self.assertEqual(Ledger(self.path).records(), chain())
        rows = self.ledger.records()
        rows[0]["data"]["intent"] = "changed"
        self.assertEqual(self.ledger.records(), chain())

    def test_rewrites_and_identical_retries_leave_records_unchanged(self):
        self.seed()
        for row in chain():
            for changed in (False, True):
                attempt = deepcopy(row)
                if changed:
                    attempt["data"][next(iter(attempt["data"]))] = "changed"
                with self.assertRaisesRegex(ValueError, "rewrites"):
                    self.ledger.append(attempt)
        self.assertEqual(self.ledger.records(), chain())

    def test_missing_required_fields_and_unknown_fields_fail_schema(self):
        self.seed()
        for row in chain():
            for key in row["data"]:
                attempt = deepcopy(row)
                attempt["id"] = "new"
                del attempt["data"][key]
                with self.subTest(kind=row["kind"], missing=key), self.assertRaises(ValueError):
                    self.ledger.append(attempt)
                self.assertFalse(conforms(attempt, SCHEMA))
        for patch in ({"version": True}, {"kind": "unknown"}, {"unexpected": 1}):
            with self.assertRaises(ValueError):
                self.ledger.append(chain()[0] | patch)

    def test_non_durable_and_wrong_kind_references_fail(self):
        for row in chain()[1:]:
            with self.assertRaisesRegex(ValueError, "durable"):
                self.ledger.append(row)
        self.ledger.append(chain()[0])
        attempt = chain()[3]
        attempt["data"]["admitted_input"] = "t1"
        with self.assertRaisesRegex(ValueError, "durable admitted_input"):
            self.ledger.append(attempt)

    def test_cross_task_and_input_mismatches_fail(self):
        self.seed()
        self.ledger.append(record("task", "t2", intent="Other", acceptance="Other"))
        self.ledger.append(record("admitted_input", "i2", task="t1", content="3", origin="user"))
        for patch in ({"task": "t2"}, {"admitted_input": "i2"}):
            attempt = chain()[3] | {"id": "c2"}
            attempt["data"].update(patch)
            if "task" in patch:
                with self.assertRaisesRegex(ValueError, "different task"):
                    self.ledger.append(attempt)
            else:
                self.ledger.append(attempt)
                receipt = chain()[4] | {"id": "r2"}
                receipt["data"]["candidate"] = "c2"
                with self.assertRaisesRegex(ValueError, "same admitted input"):
                    self.ledger.append(receipt)

    def test_receipt_requires_frozen_evaluator_bound_artifact_and_observations(self):
        self.seed()
        for field, value in (("frozen_evaluator", "missing"), ("observations", []),
                             ("precommit", chain()[4]["data"]["precommit"] | {"oracle": "other"}),
                             ("precommit", chain()[4]["data"]["precommit"] | {"artifact_identity": "other"})):
            attempt = chain()[4] | {"id": "r2"}
            attempt["data"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.ledger.append(attempt)
        unknown = chain()[4] | {"id": "r3"}
        unknown["data"].update(delivery_state="outcome_unknown", outcome_state="unobserved", observations=[])
        self.ledger.append(unknown)
        self.assertEqual(Ledger(self.path).records()[-1], unknown)

    def test_sql_update_delete_and_replace_are_refused(self):
        self.seed()
        with sqlite3.connect(self.path) as db:
            for sql in ("UPDATE records SET body='{}'", "DELETE FROM records",
                        "INSERT OR REPLACE INTO records SELECT * FROM records"):
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute(sql)
        self.assertEqual(self.ledger.records(), chain())

    def test_reopen_and_append_detect_tampering(self):
        self.seed()
        with sqlite3.connect(self.path) as db:
            db.execute("DROP TRIGGER no_update")
            db.execute("UPDATE records SET body=replace(body, 'Double', 'Triple') WHERE seq=1")
        with self.assertRaisesRegex(ValueError, "chain failed"):
            Ledger(self.path)
        with self.assertRaisesRegex(ValueError, "chain failed"):
            self.ledger.append(record("task", "t2", intent="Other", acceptance="Other"))

    def test_concurrent_duplicate_has_exactly_one_winner(self):
        def append(_):
            try:
                self.ledger.append(chain()[0])
                return True
            except ValueError:
                return False
        with ThreadPoolExecutor(max_workers=2) as workers:
            self.assertEqual(sorted(workers.map(append, range(2))), [False, True])
        self.assertEqual(Ledger(self.path).records(), chain()[:1])

    def test_process_exit_before_and_after_commit(self):
        script = """
import os, sqlite3, sys
from tools.ledger.ledger import Ledger
from tools.ledger.test_ledger import chain
class Interrupted(sqlite3.Connection):
    def execute(self, sql, *args):
        result = super().execute(sql, *args)
        if sql.startswith('INSERT') and sys.argv[2] == 'before': os._exit(9)
        return result
ledger = Ledger(sys.argv[1])
ledger._connect = lambda: sqlite3.connect(sys.argv[1], factory=Interrupted)
ledger.append(chain()[0])
os._exit(9)
"""
        for stage, expected in (("before", []), ("after", chain()[:1])):
            result = subprocess.run([sys.executable, "-B", "-c", script, str(self.path), stage],
                                    cwd=Path(__file__).resolve().parents[2], timeout=10)
            self.assertEqual(result.returncode, 9)
            self.assertEqual(Ledger(self.path).records(), expected)


if __name__ == "__main__":
    unittest.main()
