from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from tools.kernel.broker import BrokerDenied
from tools.kernel.effects import EffectDenied, check, declaration
from tools.kernel.journal import DenialJournal
from tools.kernel.limits import run_candidate
from tools.kernel.test_workcell import EMITTING, REFERENCE, SCHEMAS, build, emitting
from tools.kernel.workcell import Workcell


READ = '(call $read (i32.load (local.get $inputs)) (i64.const 0) (i32.const 1) (i32.const 80))'
TOTAL = {"type": "object", "required": ["total"], "additionalProperties": False,
         "properties": {"total": {"type": "integer"}}}


def declared(*effects, max_effects=4):
    return {"id": SCHEMAS[2], "max_effects": max_effects, "effects": [
        {"capability": c, "operation": o, "payload": p} for c, o, p in effects]}


def effect(capability="demo", operation="emit", payload=b"!"):
    return {"capability": capability, "operation": operation, "payload": payload}


class DeclarationTests(unittest.TestCase):
    def test_malformed_declarations_are_refused(self):
        spec = {"encoding": "utf8"}
        for value in (None, {"effects": []}, {"id": "", "effects": []},
                      {"id": "x", "effects": [], "extra": 1},
                      {"id": "x", "effects": [], "max_effects": 65},
                      {"id": "x", "effects": [{"capability": "a", "operation": "b"}]},
                      {"id": "x", "effects": [{"capability": "a", "operation": "b", "payload": spec}] * 2},
                      {"id": "x", "effects": [{"capability": "", "operation": "b", "payload": spec}]},
                      {"id": "x", "effects": [{"capability": "a", "operation": "b",
                                               "payload": {"encoding": "xml"}}]},
                      {"id": "x", "effects": [{"capability": "a", "operation": "b",
                                               "payload": {"encoding": "bytes", "min_bytes": 5, "max_bytes": 4}}]},
                      {"id": "x", "effects": [{"capability": "a", "operation": "b",
                                               "payload": {"encoding": "utf8", "schema": {}}}]},
                      {"id": "x", "effects": [{"capability": "a", "operation": "b",
                                               "payload": {"encoding": "json", "schema": {"$ref": "#/x"}}}]}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                declaration(value)

    def test_identity_binds_the_declared_content(self):
        one = declaration(declared(("demo", "emit", {"encoding": "bytes"})))
        two = declaration(declared(("demo", "emit", {"encoding": "bytes", "max_bytes": 2})))
        self.assertNotEqual(one["sha256"], two["sha256"])
        self.assertEqual(one["sha256"], declaration(declared(("demo", "emit", {"encoding": "bytes"})))["sha256"])

    def test_payloads_checked_against_declared_encoding_bounds_and_schema(self):
        frozen = declaration(declared(
            ("demo", "raw", {"encoding": "bytes", "min_bytes": 2, "max_bytes": 3}),
            ("demo", "text", {"encoding": "utf8", "max_bytes": 8}),
            ("demo", "json", {"encoding": "json", "max_bytes": 64, "schema": TOTAL})))
        cases = [
            (effect("demo", "raw", b"ab"), None), (effect("demo", "raw", b"a"), "payload-too-short"),
            (effect("demo", "raw", b"abcd"), "payload-too-long"),
            (effect("demo", "text", "é".encode()), None), (effect("demo", "text", b"\xff"), "payload-not-utf8"),
            (effect("demo", "json", b'{"total":3}'), None), (effect("demo", "json", b"{"), "payload-not-json"),
            (effect("demo", "json", b'{"total":NaN}'), "payload-not-json"),
            (effect("demo", "json", b'{"total":"3"}'), "payload-schema-mismatch"),
            (effect("demo", "json", b'{"total":3,"x":1}'), "payload-schema-mismatch"),
            (effect("demo", "other", b""), "undeclared-effect"), (effect("net", "raw", b"ab"), "undeclared-effect"),
        ]
        for value, reason in cases:
            with self.subTest(value=value):
                self.assertEqual([d["reason"] for d in check(frozen, [value])], [reason] if reason else [])

    def test_frozen_declaration_ignores_later_caller_mutation(self):
        bounds = {"encoding": "bytes", "max_bytes": 2}
        schema = {"type": "object", "required": ["total"], "properties": {"total": {"type": "integer"}}}
        shaped = {"encoding": "json", "max_bytes": 64, "schema": schema}
        value = declared(("demo", "emit", bounds), ("demo", "json", shaped))
        frozen = declaration(value)
        digest = frozen["sha256"]
        bounds["max_bytes"] = 1024
        bounds["encoding"] = "utf8"
        schema["properties"]["total"]["type"] = "string"
        shaped["schema"] = {}
        value["effects"].append({"capability": "demo", "operation": "late", "payload": {"encoding": "bytes"}})
        value["id"] = "other"
        self.assertEqual(check(frozen, [effect(payload=b"abc")]),
                         [{"index": 0, "capability": "demo", "operation": "emit", "reason": "payload-too-long"}])
        self.assertEqual(check(frozen, [effect(operation="json", payload=b'{"total":"x"}')]),
                         [{"index": 0, "capability": "demo", "operation": "json",
                           "reason": "payload-schema-mismatch"}])
        self.assertEqual(check(frozen, [effect(operation="late")])[0]["reason"], "undeclared-effect")
        self.assertEqual(frozen["sha256"], digest)
        self.assertEqual(frozen["id"], SCHEMAS[2])
        self.assertEqual(len(frozen["effects"]), 2)
        self.assertEqual(frozen["sha256"], declaration(declared(
            ("demo", "emit", {"encoding": "bytes", "max_bytes": 2}),
            ("demo", "json", {"encoding": "json", "max_bytes": 64, "schema": {
                "type": "object", "required": ["total"], "properties": {"total": {"type": "integer"}}}})))["sha256"])

    def test_non_finite_json_numbers_are_refused(self):
        frozen = declaration(declared(("demo", "json", {"encoding": "json", "max_bytes": 64})))
        for payload in (b'{"x":1e999}', b'{"x":-1e999}', b"1e400", b"[0, -2E+999]", b"NaN", b"Infinity",
                        b'{"x":-Infinity}'):
            with self.subTest(payload=payload):
                self.assertEqual(check(frozen, [effect(operation="json", payload=payload)]),
                                 [{"index": 0, "capability": "demo", "operation": "json",
                                   "reason": "payload-not-json"}])
        for payload in (b'{"x":1e308}', b"-0.0", b"12345678901234567890123", b'{"x":"1e999"}'):
            with self.subTest(payload=payload):
                self.assertEqual(check(frozen, [effect(operation="json", payload=payload)]), [])

    def test_effect_count_is_bounded(self):
        frozen = declaration(declared(("demo", "emit", {"encoding": "bytes"}), max_effects=1))
        self.assertEqual(check(frozen, [effect()]), [])
        self.assertEqual([d["reason"] for d in check(frozen, [effect(), effect()])], ["too-many-effects"])


class JournalTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "denials.sqlite"

    def test_entries_are_durable_and_hash_chained(self):
        first = DenialJournal(self.path)
        a = first.append({"kind": "effect", "reason": "undeclared-effect", "index": 0})
        b = first.append({"kind": "broker", "reason": "authority-denied", "handle": 0})
        entries = DenialJournal(self.path).entries()
        self.assertEqual([(e["seq"], e["hash"], e["reason"]) for e in entries],
                         [(1, a, "undeclared-effect"), (2, b, "authority-denied")])

    def test_rewrites_and_bad_entries_are_refused(self):
        journal = DenialJournal(self.path)
        journal.append({"kind": "effect", "reason": "payload-too-long"})
        for entry in ({"kind": "other", "reason": "x"}, {"kind": "effect"}, {"kind": "effect", "reason": ""},
                      {"kind": "effect", "reason": "x", "seq": 9}, {"kind": "effect", "reason": "x" * 5000}):
            with self.subTest(entry=entry), self.assertRaises(ValueError):
                journal.append(entry)
        with closing(sqlite3.connect(self.path)) as db:
            for statement in ("UPDATE denials SET body = '{}'", "DELETE FROM denials"):
                with self.subTest(statement=statement), self.assertRaisesRegex(sqlite3.DatabaseError, "append-only"):
                    db.execute(statement)
        with self.assertRaises(ValueError):
            DenialJournal(":memory:")

    def test_tampered_chain_is_detected(self):
        DenialJournal(self.path).append({"kind": "effect", "reason": "undeclared-effect"})
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("DROP TRIGGER no_update")
            db.execute("""UPDATE denials SET body = '{"kind":"effect","reason":"forged"}'""")
        with self.assertRaisesRegex(ValueError, "chain failed"):
            DenialJournal(self.path)


class WorkcellEffectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.emitting = build(EMITTING)

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.journal = DenialJournal(Path(directory.name) / "denials.sqlite")

    def test_undeclared_effect_is_denied_by_default_and_journaled(self):
        with self.assertRaises(EffectDenied) as raised:
            Workcell(self.emitting, SCHEMAS).run(b"\x01", b"\x02")
        self.assertEqual(raised.exception.denials[0]["reason"], "undeclared-effect")
        cell = Workcell(self.emitting, SCHEMAS, journal=self.journal)
        with self.assertRaises(EffectDenied):
            cell.run(b"\x01", b"\x02")
        [entry] = self.journal.entries()
        self.assertEqual({k: entry[k] for k in ("kind", "reason", "capability", "operation", "artifact_id")},
                         {"kind": "effect", "reason": "undeclared-effect", "capability": "demo",
                          "operation": "emit", "artifact_id": cell.artifact["id"]})

    def test_payload_violation_is_denied_and_journaled(self):
        spec = {"encoding": "json", "max_bytes": 32, "schema": TOTAL}
        cell = Workcell(build(emitting(payload='{"total":"x"}')), SCHEMAS,
                        effects=declared(("demo", "emit", spec)), journal=self.journal)
        with self.assertRaises(EffectDenied):
            cell.run(b"\x01", b"\x02")
        self.assertEqual([e["reason"] for e in self.journal.entries()], ["payload-schema-mismatch"])
        good = Workcell(build(emitting(payload='{"total":7}')), SCHEMAS, effects=declared(("demo", "emit", spec)))
        self.assertEqual(good.run(b"\x01", b"\x02")["effects"][0]["payload"], b'{"total":7}')

    def test_declaration_must_match_the_frozen_effect_schema(self):
        other = {"id": "other", "effects": []}
        with self.assertRaisesRegex(ValueError, "effect schema"):
            Workcell(self.emitting, SCHEMAS, effects=other)
        with self.assertRaisesRegex(ValueError, "journal"):
            Workcell(self.emitting, SCHEMAS, journal=object())

    def test_broker_denials_are_journaled(self):
        cell = Workcell(build(REFERENCE.replace(READ, READ + READ)), SCHEMAS, journal=self.journal)
        with self.assertRaises(BrokerDenied):
            cell.run(b"\x01", b"\x02", [b"\x03"], authorize=lambda handle, operation: operation == "size")
        [entry] = self.journal.entries()
        self.assertEqual((entry["kind"], entry["reason"], entry["operation"]), ("broker", "authority-denied", "read"))
        result = cell.run(b"\x01", b"\x02", [b""])
        self.assertEqual(result["broker"]["denial_count"], 2)
        self.assertEqual([e["reason"] for e in self.journal.entries()[1:]], ["out-of-bounds", "out-of-bounds"])

    def test_run_candidate_reports_denied_effects(self):
        receipt = run_candidate(self.emitting, SCHEMAS, b"\x01", b"\x02")
        self.assertEqual(receipt["outcome"], "denied")
        self.assertEqual(receipt["denials"][0]["reason"], "undeclared-effect")
        receipt = run_candidate(self.emitting, SCHEMAS, b"\x01", b"\x02",
                                effects=declared(("demo", "emit", {"encoding": "bytes"})))
        self.assertEqual(receipt["outcome"], "passed")
        with self.assertRaises(ValueError):
            run_candidate(self.emitting, SCHEMAS, b"\x01", b"\x02", effects={"id": "x"})


if __name__ == "__main__":
    unittest.main()
