import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from core.ledger.ledger import Ledger
from tools import x1_loop

REPOSITORY = Path(__file__).resolve().parents[1]
ITEM = dict(kind="record", fields=[dict(name="id", kind="integer", unit="1"), dict(name="done", kind="boolean", unit="1"),
                                   dict(name="title", kind="text", maxBytes=8)])
STATE = dict(kind="record", fields=[dict(name="count", kind="integer", unit="1"), dict(name="weight", kind="number", unit="kg", precision=2),
                                    dict(name="status", kind="code", unit="1", codes={"0": "open", "1": "closed"}),
                                    dict(name="items", kind="list", max=2, items=ITEM)])
TITLE = dict(kind="text", maxBytes=4)
IDS = dict(kind="list", max=3, items=dict(kind="integer", unit="1"))
GOOD = dict(items=[dict(title="milk", done=True, id=7)], status=1, weight=2.5, count=1)


def suspect(fn, args, first, second=None, layout=STATE, name="wrong"):
    entry = dict(fn=fn, test=name, args=args, expect=0, references=[first, first if second is None else second])
    if layout is not None:
        entry["layout"] = layout
    return entry


def valued(value):
    return dict(value=value)


class Corrected(unittest.TestCase):
    def correct(self, entry, tests=None):
        return x1_loop.corrected_tests(tests if tests is not None else [dict(name=entry["test"], fn=entry["fn"], args=entry["args"], expect=0)], [entry])[0]

    def refuses(self, entry, message):
        with self.assertRaisesRegex(ValueError, message):
            self.correct(entry)

    def test_a_record_correction_is_recorded_in_declared_field_order(self):
        corrected = self.correct(suspect("step", [1], valued(GOOD)))
        self.assertEqual(corrected["expect"], dict(count=1, weight=2.5, status=1, items=[dict(id=7, done=True, title="milk")]))
        self.assertEqual(list(corrected["expect"]), ["count", "weight", "status", "items"])
        self.assertEqual(list(corrected["expect"]["items"][0]), ["id", "done", "title"])

    def test_a_list_correction_is_recorded(self):
        self.assertEqual(self.correct(suspect("ids", [1], valued([3, 4]), layout=IDS))["expect"], [3, 4])

    def test_an_empty_list_is_a_correction(self):
        self.assertEqual(self.correct(suspect("ids", [1], valued([]), layout=IDS))["expect"], [])

    def test_a_text_correction_is_recorded(self):
        self.assertEqual(self.correct(suspect("name", [1], valued("héé"), layout=dict(kind="text", maxBytes=5)))["expect"], "héé")

    def test_leaves_are_normalized_by_their_declared_kind(self):
        value = dict(GOOD, count=1.0, weight=3.0, items=[dict(id=7, done=1, title="milk")])
        expect = self.correct(suspect("step", [1], valued(value)))["expect"]
        self.assertIs(type(expect["count"]), int)
        self.assertIs(type(expect["weight"]), int)
        self.assertIs(expect["items"][0]["done"], True)

    def test_references_agree_whatever_their_field_order(self):
        reordered = dict(reversed(list(GOOD.items())))
        self.assertEqual(self.correct(suspect("step", [1], valued(GOOD), valued(reordered)))["expect"]["count"], 1)

    def test_references_agree_on_declared_boolean_spellings(self):
        one, other = [dict(GOOD, items=[dict(id=7, done=flag, title="milk")]) for flag in (True, 1)]
        self.assertIs(self.correct(suspect("step", [1], valued(one), valued(other)))["expect"]["items"][0]["done"], True)

    def test_the_frozen_tolerance_applies_to_every_numeric_leaf(self):
        near = dict(GOOD, weight=2.5000001)
        entry = suspect("step", [1], valued(GOOD), valued(near))
        corrected = self.correct(entry, [dict(name="wrong", fn="step", args=[1], expect=0, tol=0.001)])
        self.assertEqual((corrected["expect"]["weight"], corrected["tol"]), (2.5, 0.001))

    def test_a_correction_from_an_expected_error_drops_the_error(self):
        entry = suspect("ids", [1], valued([1]), layout=IDS)
        corrected = self.correct(entry, [dict(name="wrong", fn="ids", args=[1], expectError=True)])
        self.assertNotIn("expectError", corrected)
        self.assertEqual(corrected["expect"], [1])

    def test_differing_references_are_refused(self):
        self.refuses(suspect("step", [1], valued(GOOD), valued(dict(GOOD, count=2))), "agree")

    def test_a_leaf_beyond_the_tolerance_is_refused(self):
        self.refuses(suspect("step", [1], valued(GOOD), valued(dict(GOOD, weight=2.5000001))), "agree")

    def test_a_throw_against_a_structure_is_refused(self):
        self.refuses(suspect("step", [1], valued(GOOD), dict(throws=True)), "")

    def test_a_structure_without_a_declared_layout_is_refused(self):
        for value in (GOOD, [1], "text"):
            self.refuses(suspect("step", [1], valued(value), layout=None), "declared layout")

    def test_a_scalar_layout_is_not_a_structured_layout(self):
        self.refuses(suspect("step", [1], valued("text"), layout=dict(kind="integer", unit="1")), "declared layout")

    def test_values_that_do_not_fit_the_layout_are_refused(self):
        item = dict(id=7, done=True, title="milk")
        bad = {
            "missing field": {k: v for k, v in GOOD.items() if k != "count"},
            "extra field": dict(GOOD, extra=1),
            "text over its bytes": dict(GOOD, items=[dict(item, title="ééééé")]),
            "too many items": dict(GOOD, items=[item, item, item]),
            "fractional integer": dict(GOOD, count=1.5),
            "32-bit overflow": dict(GOOD, count=2 ** 31),
            "boolean as integer": dict(GOOD, count=True),
            "undeclared code": dict(GOOD, status=9),
            "number as text": dict(GOOD, weight="2.5"),
            "boolean as number": dict(GOOD, weight=True),
            "non-boolean flag": dict(GOOD, items=[dict(item, done=2)]),
            "list as record": [GOOD],
            "non-finite leaf": dict(GOOD, weight=float("inf")),
            "enormous leaf": dict(GOOD, weight=10 ** 400),
            "null leaf": dict(GOOD, weight=None),
        }
        for label, value in bad.items():
            with self.subTest(label):
                self.refuses(suspect("step", [1], valued(value)), "layout")

    def test_text_over_its_bytes_at_the_top_level_is_refused(self):
        self.refuses(suspect("name", [1], valued("ééé"), layout=TITLE), "layout")

    def test_a_malformed_layout_is_refused(self):
        for layout in (dict(kind="text"), dict(kind="list", items=dict(kind="integer")), dict(kind="list", max=True, items=dict(kind="integer")),
                       dict(kind="record", fields=[]), dict(kind="record", fields=[dict(name="a", kind="integer"), dict(name="a", kind="integer")]),
                       dict(kind="list", max=2)):
            with self.subTest(layout):
                self.refuses(suspect("step", [1], valued([]), layout=layout), "layout")

    def test_outcomes_that_are_not_objects_are_refused(self):
        entry = suspect("add", [1], valued(1))
        entry["references"] = [1, 1]
        self.refuses(entry, "agreeing")

    def test_scalar_corrections_do_not_need_a_layout(self):
        self.assertEqual(self.correct(suspect("add", [1], valued(9.0), layout=None))["expect"], 9)
        corrected = self.correct(suspect("add", [1], dict(throws=True), layout=None))
        self.assertTrue(corrected["expectError"])
        self.assertNotIn("expect", corrected)

    def test_a_scalar_that_overflows_is_refused_cleanly(self):
        self.refuses(suspect("add", [1], valued(10 ** 400), layout=None), "finite")

    def test_scalar_references_still_need_exact_agreement(self):
        self.refuses(suspect("add", [1], valued(1), valued(1.0000000001), layout=None), "agreeing")


class ThroughTheLedger(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        directory = Path(scratch.name)
        self.ledger, root = directory / "ledger.sqlite", directory / "evaluator"
        root.mkdir()
        tests = [dict(name="wrong", fn="step", args=[1], expect=dict(count=0)), dict(name="kept", fn="step", args=[2], expect=dict(count=2))]
        (root / "CONTRACT.md").write_text("contract")
        (root / "tests.json").write_text(json.dumps(tests))
        (root / "frozen.sha256").write_text("{}")
        Ledger(self.ledger)
        request = dict(need="need", configuration=dict(a=1), reference=dict(ledger=str(self.ledger), root=str(root)))
        done = subprocess.run([sys.executable, "-B", "-m", "tools.x1_ledger", "freeze"], cwd=REPOSITORY, input=json.dumps(request),
                              capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.identity = json.loads(done.stdout)["identity"]

    def revise(self, *suspects):
        report = dict(kind="suspect_frozen_tests", before="implementation", tests=list(suspects))
        request = dict(reference=dict(ledger=str(self.ledger), identity=self.identity), report=report)
        return subprocess.run([sys.executable, "-B", "-m", "tools.x1_loop", "revise"], cwd=REPOSITORY, input=json.dumps(request),
                              capture_output=True, text=True, timeout=60)

    def test_the_revision_freezes_the_corrected_structure_and_its_layout_evidence(self):
        entry = suspect("step", [1], valued(GOOD))
        done = self.revise(entry)
        self.assertEqual(done.returncode, 0, done.stderr)
        answer = json.loads(done.stdout)
        records = {record["id"]: record for record in Ledger(self.ledger).records()}
        revised = records[answer["identity"]]
        self.assertEqual(revised["data"]["revision"]["of"], self.identity)
        self.assertEqual(revised["data"]["revision"]["reason"], "specification_correction")
        tests = json.loads(bytes.fromhex(json.loads(revised["data"]["content"])["files"]["tests.json"]))
        self.assertEqual(json.dumps(tests[0]["expect"]), json.dumps(dict(count=1, weight=2.5, status=1, items=[dict(id=7, done=True, title="milk")])))
        self.assertEqual(tests[1]["expect"], dict(count=2))
        self.assertEqual(json.loads(answer["files"]["tests.json"]), tests)
        evidence = json.loads(records[revised["data"]["revision"]["evidence"]]["data"]["content"])
        self.assertEqual(evidence["tests"][0]["layout"], STATE)

    def test_the_corrected_structure_meets_the_commit_comparison(self):
        done = self.revise(suspect("step", [1], valued(GOOD)))
        self.assertEqual(done.returncode, 0, done.stderr)
        frozen = json.loads(json.loads(done.stdout)["files"]["tests.json"])[0]
        self.assertTrue(x1_loop.value_meets(frozen, dict(got=GOOD), STATE))
        self.assertFalse(x1_loop.value_meets(frozen, dict(got=dict(GOOD, count=2)), STATE))

    def test_a_refusal_appends_nothing_and_prints_no_traceback(self):
        before = len(Ledger(self.ledger).records())
        done = self.revise(suspect("step", [1], valued(GOOD), layout=None))
        self.assertEqual(done.returncode, 1)
        self.assertIn("revise refused", done.stderr)
        self.assertNotIn("Traceback", done.stderr)
        self.assertEqual(len(Ledger(self.ledger).records()), before)


if __name__ == "__main__":
    unittest.main()
