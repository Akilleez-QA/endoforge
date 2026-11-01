from copy import deepcopy
import hashlib
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest

from .ledger import Ledger, SCHEMA, conforms, encode, event_hash
from .test_ledger import chain


def admission(kind, identity, material_origin="authored", scopes=(), **data):
    provenance = {
        "origin": material_origin, "upstream_identity": "test-source", "upstream_version": "1",
        "input_scopes": list(scopes), "derived_from": [],
    }
    if material_origin == "generated":
        provenance["model"] = {"identity": "test-model", "version": "1"}
    return {
        "version": 1, "id": identity, "kind": kind, "data": data,
        "provenance": provenance,
        "license": {"expression": "MIT", "evidence_sha256": hashlib.sha256(b"test license").hexdigest()},
    }


def admissions(strict=False):
    return [
        admission("task", "t", intent="Double", acceptance="2 becomes 4",
                  precommit={"no_unknown_licenses": strict}),
        admission("admitted_input", "i", "imported", ["public-example"],
                  task="t", content="2", origin="test-source"),
        admission("candidate", "c", "generated", ["public-example", "prompt"],
                  task="t", admitted_input="i", content="x * 2", proposer="worker"),
        admission("frozen_evaluator", "e", scopes=["public-example"],
                  task="t", admitted_input="i", content="assert result == 4", confirmed_by="owner"),
        admission("receipt", "r", scopes=["public-example", "prompt"], task="t",
                  candidate="c", frozen_evaluator="e", delivery_state="finished",
                  outcome_state="passed", observations=[{"output": 4}],
                  precommit={"observable": "output", "acceptance_boundary": "equals 4",
                             "oracle": "e", "oracle_version": "1", "artifact_identity": "c",
                             "environment": {}, "failure_meaning": "wrong", "stop_condition": "one case"}),
    ]


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "ledger.sqlite"
        self.ledger = Ledger(self.path)

    def seed(self, rows=None):
        for row in admissions() if rows is None else rows:
            self.ledger.admit(row)

    def test_legacy_replay_reports_unknown_without_changing_records_or_hashes(self):
        for row in chain():
            self.assertTrue(conforms(row, SCHEMA))
            self.ledger.append(row)
        with sqlite3.connect(self.path) as db:
            before = db.execute("SELECT * FROM records ORDER BY seq").fetchall()
        reopened = Ledger(self.path)
        self.assertEqual(reopened.records(), chain())
        self.assertEqual(reopened.lineage("r1"),
                         [row | {"provenance_status": "provenance-unknown"} for row in chain()])
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT * FROM records ORDER BY seq").fetchall(), before)

    def test_current_admission_refuses_legacy_and_unsupported_versions(self):
        for row in chain():
            with self.subTest(kind=row["kind"]), self.assertRaisesRegex(ValueError, "schema version 1"):
                self.ledger.admit(row)
        for version in (0, 2, True, None):
            row = admissions()[0] | {"version": version}
            self.assertFalse(conforms(row, SCHEMA))
            with self.assertRaisesRegex(ValueError, "schema"):
                self.ledger.admit(row)
        self.assertEqual(self.ledger.records(), [])

    def test_current_admissions_can_extend_legacy_lineage_without_backfill(self):
        for row in chain():
            self.ledger.append(row)
        row = admission("candidate", "new", "generated", ["new-prompt"],
                        task="t1", admitted_input="i1", content="x + x", proposer="worker")
        row["provenance"]["derived_from"] = ["c1"]
        self.ledger.admit(row)
        reopened = Ledger(self.path)
        self.assertEqual(reopened.records(), chain() + [row])
        self.assertEqual(reopened.lineage("new"),
                         [old | {"provenance_status": "provenance-unknown"}
                          for old in chain() if old["id"] in ("t1", "i1", "c1")] + [row])
        downgraded = chain()[-1] | {"id": "downgraded"}
        downgraded["data"]["candidate"] = "new"
        with self.assertRaisesRegex(ValueError, "cannot be downgraded"):
            reopened.append(downgraded)

    def test_legacy_append_cannot_bypass_current_task_policy(self):
        self.seed(admissions(strict=True)[:1])
        row = chain()[1]
        row["data"]["task"] = "t"
        with self.assertRaisesRegex(ValueError, "cannot be downgraded"):
            self.ledger.append(row)
        self.assertEqual(self.ledger.records(), admissions(strict=True)[:1])

    def test_replay_refuses_current_record_without_metadata_even_with_valid_hash(self):
        row = chain()[0] | {"version": 1}
        body, previous = encode(row), "0" * 64
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT INTO records VALUES (?, ?, ?, ?, ?)",
                       (1, row["id"], body, previous, event_hash(1, previous, body)))
        with self.assertRaisesRegex(ValueError, "schema"):
            Ledger(self.path)

    def test_required_metadata_on_every_kind(self):
        for row in admissions():
            self.assertTrue(conforms(row, SCHEMA))
            for field in ("provenance", "license"):
                for key in [None, *row[field]]:
                    attempt = deepcopy(row)
                    if key is None:
                        del attempt[field]
                    else:
                        del attempt[field][key]
                    with self.subTest(kind=row["kind"], field=field, key=key):
                        self.assertFalse(conforms(attempt, SCHEMA))
                        with self.assertRaisesRegex(ValueError, "schema"):
                            self.ledger.admit(attempt)
                        with self.assertRaisesRegex(ValueError, "schema"):
                            self.ledger.append(attempt)
        self.assertEqual(self.ledger.records(), [])

    def test_metadata_shapes_and_blank_values_are_rejected(self):
        for field, key, values in (
            ("provenance", "origin", ["other", None, 1]),
            ("provenance", "upstream_identity", ["", " \n", None, 1]),
            ("provenance", "upstream_version", ["", " ", None, 1]),
            ("provenance", "model", [{}, {"identity": "m"}, {"identity": "m", "version": " "}]),
            ("provenance", "input_scopes", [None, "public", [""], [1], ["x", "x"]]),
            ("provenance", "derived_from", [None, "i", ["i", "i"], [False]]),
            ("license", "expression", [None, 1, "", " "]),
            ("license", "evidence_sha256", [None, "", "z" * 64, "a" * 63, "a" * 65, "a" * 64 + "\n"]),
        ):
            for value in values:
                row = admissions()[2]
                row[field][key] = value
                with self.subTest(field=field, key=key, value=value):
                    self.assertFalse(conforms(row, SCHEMA))
        for field in ("provenance", "license"):
            row = admissions()[0]
            row[field]["typo"] = "x"
            self.assertFalse(conforms(row, SCHEMA))

    def test_task_policy_requires_boolean(self):
        for value in ("true", 1, None):
            row = admissions()[0]
            row["data"]["precommit"]["no_unknown_licenses"] = value
            self.assertFalse(conforms(row, SCHEMA))

    def test_unknown_import_policy_is_pinned_before_admission(self):
        self.seed(admissions(strict=True)[:1])
        for origin in ("imported", "pre-built-wasm"):
            for expression in ("unknown", " UNKNOWN "):
                row = admissions()[1]
                row["provenance"]["origin"] = origin
                row["license"]["expression"] = expression
                with self.assertRaisesRegex(ValueError, "forbids unknown"):
                    self.ledger.admit(row)
        self.assertEqual(self.ledger.records(), admissions(strict=True)[:1])
        self.seed(admissions()[1:])
        self.assertEqual(len(Ledger(self.path).records()), 5)

    def test_explicit_unknown_is_allowed_without_strict_policy(self):
        rows = admissions()
        del rows[0]["data"]["precommit"]
        rows[1]["license"]["expression"] = "unknown"
        self.seed(rows)
        self.assertEqual(Ledger(self.path).records(), rows)

    def test_one_query_returns_sources_license_and_generation_scopes(self):
        self.seed()
        lineage = Ledger(self.path).lineage("r")
        self.assertEqual(lineage, admissions())
        self.assertEqual(lineage[2]["provenance"]["model"], {"identity": "test-model", "version": "1"})
        self.assertEqual(lineage[2]["provenance"]["input_scopes"], ["public-example", "prompt"])
        lineage[1]["license"]["expression"] = "changed"
        self.assertEqual(self.ledger.lineage("i"), admissions()[:2])
        with self.assertRaises(KeyError):
            self.ledger.lineage("absent")

    def test_successor_preserves_lineage_scopes_on_reopen(self):
        self.seed()
        promoted = admissions()[2]
        promoted["id"] = "promoted"
        promoted["provenance"]["derived_from"] = ["c"]
        promoted["provenance"]["input_scopes"].append("review")
        self.ledger.admit(promoted)
        self.assertEqual(Ledger(self.path).lineage("promoted"), admissions()[:3] + [promoted])
        successor = deepcopy(promoted)
        successor["id"] = "successor"
        successor["provenance"]["derived_from"] = ["promoted"]
        successor["provenance"]["input_scopes"].remove("review")
        with self.assertRaisesRegex(ValueError, "scopes cannot be removed"):
            self.ledger.admit(successor)

    def test_data_references_also_preserve_scopes(self):
        self.seed(admissions()[:2])
        row = admissions()[2]
        row["provenance"]["input_scopes"] = ["prompt"]
        with self.assertRaisesRegex(ValueError, "scopes cannot be removed"):
            self.ledger.admit(row)

    def test_lineage_cannot_reference_missing_self_or_other_task(self):
        self.seed()
        self.ledger.admit(admission("task", "other", intent="Other", acceptance="Other"))
        for parent, message in (("missing", "durable"), ("new", "durable"), ("other", "different task")):
            row = admissions()[2]
            row["id"] = "new"
            row["provenance"]["derived_from"] = [parent]
            with self.subTest(parent=parent), self.assertRaisesRegex(ValueError, message):
                self.ledger.admit(row)


if __name__ == "__main__":
    unittest.main()
