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


DRIVER = """
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptedProvider } from './core/runtime/x1/transports.mjs';
import { begin } from './core/runtime/x1/synth/stage.mjs';
const input = JSON.parse(await new Promise(done => { let text = ''; process.stdin.on('data', part => { text += part; }); process.stdin.on('end', () => done(text)); }));
const reply = (path, value) => ({ text: JSON.stringify({ calls: [{ name: 'edit_file', path, content: JSON.stringify(value) }, { name: 'done' }] }), usage: 1 });
const sheet = { residual: ['a'], quantities: [], relations: [], invariants: ['value.reference'] };
const provider = scriptedProvider(({ session }) => (session.startsWith('need') ? reply('sheet.json', sheet) : reply('binding.json', input.bindings[Number(session.split('-')[1])])));
const root = await mkdtemp(join(tmpdir(), 'structured-'));
await writeFile(join(root, 'CONTRACT.md'), 'contract');
await writeFile(join(root, 'tests.json'), JSON.stringify(input.tests));
const reports = [];
const stage = begin({ need: 'need', env: { ENDOFORGE_SYNTH_WIDTH: '2' }, provider, suspect: report => reports.push(report) });
const result = await stage.finish(root);
const evaluator = JSON.parse(await readFile(join(root, 'synth', 'evaluator.json'), 'utf8'));
await rm(root, { recursive: true, force: true });
process.stdout.write(JSON.stringify({ suspects: result.suspects, report: reports[0] ?? null, evaluator }));
"""
SANDBOX = """
import { runReferences } from './core/runtime/x1/synth/sandbox.mjs';
const input = JSON.parse(await new Promise(done => { let text = ''; process.stdin.on('data', part => { text += part; }); process.stdin.on('end', () => done(text)); }));
process.stdout.write(JSON.stringify(await runReferences(input.variants, input.calls)));
"""
CARD = dict(kind="record", fields=[dict(name="count", kind="integer", unit="1"), dict(name="done", kind="boolean", unit="1"),
                                   dict(name="label", kind="text", maxBytes=8), dict(name="tags", kind="list", max=3, items=dict(kind="integer", unit="1"))])
CARD_A = "function step(n) { if (n < 0 || n > 5) throw Error('range'); return { count: n, done: n > 2, label: 'n' + n, tags: [n, n + 1] }; }"
CARD_B = "function step(k) { if (k < 0) { throw new RangeError('low'); } if (k > 5) { throw new RangeError('high'); } const tags = [k, k + 1]; return { tags, label: `n${k}`, done: k > 2 ? 1 : 0, count: k }; }"
CARD_ONE = dict(count=1, done=False, label="n1", tags=[1, 2])
CARD_TWO = dict(count=2, done=False, label="n2", tags=[2, 3])
WRONG = dict(name="wrong", fn="step", args=[1], expect=dict(count=99, done=False, label="n1", tags=[1, 2]))
KEPT = dict(name="kept", fn="step", args=[2], expect=CARD_TWO)
LIST = dict(kind="list", max=3, items=dict(kind="integer", unit="1"))
TEXT = dict(kind="text", maxBytes=8)
NUMBER = dict(kind="number", unit="1")


def binding(reference, result=CARD, fn="step", params=None):
    domain = dict(name="n", unit="1", min=0, max=5, integer=True)
    return dict(exports=[dict(name=fn, params=params or [domain], result=result)], reference=reference)


def node(script, request):
    done = subprocess.run(["node", "--input-type=module", "-e", script], cwd=REPOSITORY, input=json.dumps(request), capture_output=True, text=True, timeout=120)
    if done.returncode != 0:
        raise AssertionError(done.stderr)
    return json.loads(done.stdout)


def synthesized(bindings, tests=(WRONG, KEPT)):
    return node(DRIVER, dict(bindings=bindings, tests=list(tests)))


class FromReferences(unittest.TestCase):
    def only(self, answer):
        self.assertEqual(len(answer["suspects"]), 1, json.dumps(answer["evaluator"]["members"]))
        return answer["suspects"][0]

    def test_agreeing_record_references_report_the_declared_layout(self):
        entry = self.only(synthesized([binding(CARD_A), binding(CARD_B)]))
        self.assertEqual((entry["fn"], entry["test"], entry["args"]), ("step", "wrong", [1]))
        self.assertEqual(entry["references"], [valued(CARD_ONE), valued(CARD_ONE)])
        self.assertEqual(entry["layout"], CARD)

    def test_a_list_result_is_reported(self):
        first = "function ids(n) { if (n < 0 || n > 3) throw Error('range'); return Array.from({ length: n }, (_, i) => i + 1); }"
        second = "function ids(m) { if (m < 0 || m > 3) throw new Error('range'); const out = []; for (let i = 1; i <= m; i += 1) out.push(i); return out; }"
        domain = [dict(name="n", unit="1", min=0, max=3, integer=True)]
        tests = [dict(name="wrong", fn="ids", args=[2], expect=[9]), dict(name="kept", fn="ids", args=[1], expect=[1])]
        entry = self.only(synthesized([binding(first, LIST, "ids", domain), binding(second, LIST, "ids", domain)], tests))
        self.assertEqual(entry["references"], [valued([1, 2]), valued([1, 2])])
        self.assertEqual(entry["layout"], LIST)

    def test_a_text_result_is_reported(self):
        first = "function name(n) { if (n < 0 || n > 5) throw Error('range'); return 'x' + n; }"
        second = "function name(k) { if (k < 0 || k > 5) throw new Error('range'); return `x${k}`; }"
        tests = [dict(name="wrong", fn="name", args=[3], expect="nope"), dict(name="kept", fn="name", args=[1], expect="x1")]
        entry = self.only(synthesized([binding(first, TEXT, "name"), binding(second, TEXT, "name")], tests))
        self.assertEqual(entry["references"], [valued("x3"), valued("x3")])

    def test_a_record_parameter_is_held_at_the_frozen_argument(self):
        first = "function size(o) { return { total: o.a + o.b }; }"
        second = "function size(v) { const total = v.b + v.a; return { total }; }"
        layout = dict(kind="record", fields=[dict(name="total", kind="integer", unit="1")])
        params = [dict(name="o", unit="", kind="record")]
        tests = [dict(name="wrong", fn="size", args=[dict(a=1, b=2)], expect=dict(total=9))]
        entry = self.only(synthesized([binding(first, layout, "size", params), binding(second, layout, "size", params)], tests))
        self.assertEqual(entry["args"], [dict(a=1, b=2)])
        self.assertEqual(entry["references"][0], valued(dict(total=3)))

    def test_a_record_parameter_never_becomes_a_number_vector(self):
        first = "function size(o) { return o.a + o.b; }"
        second = "function size(v) { return v.b + v.a; }"
        params = [dict(name="o", unit="")]
        tests = [dict(name="kept", fn="size", args=[dict(a=1, b=2)], expect=3)]
        answer = synthesized([binding(first, NUMBER, "size", params), binding(second, NUMBER, "size", params)], tests)
        self.assertEqual(answer["evaluator"]["checks"]["vectors"], [])

    def test_structured_results_never_become_number_vectors(self):
        self.assertEqual(synthesized([binding(CARD_A), binding(CARD_B)])["evaluator"]["checks"]["vectors"], [])

    def test_a_matching_frozen_structure_is_not_suspect(self):
        self.assertEqual(synthesized([binding(CARD_A), binding(CARD_B)], [dict(WRONG, expect=CARD_ONE), KEPT])["suspects"], [])

    def test_references_that_disagree_on_a_leaf_are_not_reported(self):
        self.assertEqual(synthesized([binding(CARD_A), binding(CARD_B.replace("`n${k}`", "`m${k}`"))])["suspects"], [])

    def test_a_tiny_numeric_difference_is_not_reported_as_agreement(self):
        layout = dict(kind="record", fields=[dict(name="v", kind="number", unit="1")])
        first = "function step(n) { return { v: n + 0.5 }; }"
        second = "function step(n) { return { v: n + 0.5 + (n === 1 ? 1e-12 : 0) }; }"
        tests = [dict(name="wrong", fn="step", args=[1], expect=dict(v=9)), dict(name="kept", fn="step", args=[2], expect=dict(v=2.5))]
        self.assertEqual(synthesized([binding(first, layout), binding(second, layout)], tests)["suspects"], [])

    def test_a_reference_that_returns_nothing_is_not_a_throw(self):
        silent = "function step(n) { if (n < 0 || n > 5) throw Error('range'); }"
        answer = synthesized([binding(silent), binding(silent)], [dict(WRONG, expect=CARD_ONE), KEPT])
        self.assertEqual(answer["suspects"], [])
        self.assertTrue(any(failure.startswith("M2") for failure in answer["evaluator"]["members"][0]["exports"]["step"]["failures"]))

    def test_a_reference_outside_the_layout_is_not_qualified(self):
        answer = synthesized([binding(CARD_A.replace("[n, n + 1]", "[n, n, n, n]")), binding(CARD_B)])
        self.assertEqual(answer["suspects"], [])
        self.assertFalse(answer["evaluator"]["members"][0]["exports"]["step"]["qualified"])

    def test_a_malformed_layout_is_not_qualified(self):
        answer = synthesized([binding(CARD_A, dict(kind="list", max=2)), binding(CARD_B)])
        self.assertEqual(answer["suspects"], [])
        self.assertFalse(answer["evaluator"]["members"][0]["exports"]["step"]["qualified"])

    def test_differing_declared_shapes_are_not_reported(self):
        other = dict(CARD, fields=[*CARD["fields"][:2], dict(name="label", kind="text", maxBytes=9), CARD["fields"][3]])
        self.assertEqual(synthesized([binding(CARD_A), binding(CARD_B, other)])["suspects"], [])

    def test_units_may_differ_between_declared_layouts(self):
        other = dict(CARD, fields=[dict(CARD["fields"][0], unit="items"), *CARD["fields"][1:]])
        self.only(synthesized([binding(CARD_A), binding(CARD_B, other)]))

    def test_a_scalar_suspect_carries_no_layout(self):
        first = "function add(a) { return a + 1; }"
        second = "function add(b) { const c = b + 1; return c; }"
        tests = [dict(name="wrong", fn="add", args=[1], expect=9), dict(name="kept", fn="add", args=[2], expect=3)]
        entry = self.only(synthesized([binding(first, NUMBER, "add"), binding(second, NUMBER, "add")], tests))
        self.assertNotIn("layout", entry)
        self.assertEqual(entry["references"], [valued(2), valued(2)])


class Sandbox(unittest.TestCase):
    def one(self, code):
        return node(SANDBOX, dict(variants=[code], calls=[dict(fn="f", args=[1])]))[0]["results"][0]

    def test_records_lists_and_text_come_back_as_plain_values(self):
        self.assertEqual(self.one("function f() { return { a: 1, b: [true, 'x'] }; }"), valued(dict(a=1, b=[True, "x"])))
        self.assertEqual(self.one("function f() { return [1, 2]; }"), valued([1, 2]))
        self.assertEqual(self.one("function f() { return 'héllo'; }"), valued("héllo"))

    def test_numbers_and_booleans_are_unchanged(self):
        self.assertEqual(self.one("function f() { return 2.5; }"), valued(2.5))
        self.assertEqual(self.one("function f() { return true; }"), valued(1))

    def test_a_throw_is_an_error(self):
        self.assertEqual(self.one("function f() { throw Error('no'); }"), dict(error="no"))

    def test_unusable_returns_are_marked_and_are_not_throws(self):
        for code in ("function f() {}", "function f() { const a = {}; a.a = a; return a; }", "function f() { return () => 1; }"):
            with self.subTest(code):
                self.assertTrue(self.one(code).get("invalid"))

    def test_a_reference_cannot_change_the_arguments_of_a_later_call(self):
        code = "function f(o) { const seen = o.a; o.a = 9; return seen; }"
        calls = [dict(fn="f", args=[dict(a=1)]), dict(fn="f", args=[dict(a=1)])]
        self.assertEqual(node(SANDBOX, dict(variants=[code], calls=calls))[0]["results"], [valued(1), valued(1)])


class EndToEnd(unittest.TestCase):
    def test_a_structured_correction_freezes_and_meets_the_commit_comparison(self):
        with tempfile.TemporaryDirectory() as scratch:
            directory = Path(scratch)
            ledger, root = directory / "ledger.sqlite", directory / "evaluator"
            root.mkdir()
            (root / "CONTRACT.md").write_text("contract")
            (root / "tests.json").write_text(json.dumps([WRONG, KEPT]))
            (root / "frozen.sha256").write_text("{}")
            Ledger(ledger)
            request = dict(need="need", configuration=dict(a=1), reference=dict(ledger=str(ledger), root=str(root)))
            frozen = subprocess.run([sys.executable, "-B", "-m", "tools.x1_ledger", "freeze"], cwd=REPOSITORY, input=json.dumps(request), capture_output=True, text=True, timeout=60)
            self.assertEqual(frozen.returncode, 0, frozen.stderr)
            report = synthesized([binding(CARD_A), binding(CARD_B)])["report"]
            self.assertIsNotNone(report)
            request = dict(reference=dict(ledger=str(ledger), identity=json.loads(frozen.stdout)["identity"]), report=report)
            done = subprocess.run([sys.executable, "-B", "-m", "tools.x1_loop", "revise"], cwd=REPOSITORY, input=json.dumps(request), capture_output=True, text=True, timeout=60)
            self.assertEqual(done.returncode, 0, done.stderr)
            tests = json.loads(json.loads(done.stdout)["files"]["tests.json"])
            self.assertEqual(json.dumps(tests[0]["expect"]), json.dumps(CARD_ONE))
            self.assertEqual(tests[1]["expect"], CARD_TWO)
            self.assertTrue(x1_loop.value_meets(tests[0], dict(got=CARD_ONE), CARD))
            self.assertFalse(x1_loop.value_meets(tests[0], dict(got=dict(CARD_ONE, count=2)), CARD))


if __name__ == "__main__":
    unittest.main()
