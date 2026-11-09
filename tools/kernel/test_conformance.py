import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tools.kernel.conformance import check, task
from tools.kernel.journal import DenialJournal
from tools.kernel.test_workcell import EMITTING, SCHEMAS, build


ROOT = Path(__file__).resolve().parents[2]
EMIT = {"capability": "demo", "operation": "emit", "payload": "21"}


def reference_task(*, effects=(), expect_effects=()):
    return {"id": "reference-v1",
            "schemas": {"state": SCHEMAS[0], "event": SCHEMAS[1], "effect": SCHEMAS[2]},
            "effects": {"id": SCHEMAS[2], "effects": list(effects)},
            "cases": [{"name": "inline", "state": "01", "event": "02", "inputs": [],
                       "expect": {"state": "03", "effects": list(expect_effects)}},
                      {"name": "buffer", "state": "05", "event": "03", "inputs": ["0209"],
                       "expect": {"state": "0a", "effects": list(expect_effects)}}]}


class ConformanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = build()
        cls.emitting = build(EMITTING)

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.journal = DenialJournal(self.directory / "denials.sqlite")

    def test_conforming_kernel_passes_every_frozen_case(self):
        report = check(self.reference, reference_task(), self.journal)
        self.assertTrue(report["passed"])
        self.assertEqual([row["outcome"] for row in report["cases"]], ["passed", "passed"])
        self.assertEqual(report["artifact"]["validation"], "static-interface-only")
        self.assertEqual(self.journal.entries(), [])

    def test_wrong_output_fails_the_case(self):
        value = reference_task()
        value["cases"][0]["expect"]["state"] = "04"
        report = check(self.reference, value)
        self.assertFalse(report["passed"])
        self.assertEqual(report["cases"][0]["actual"], {"state": "03", "effects": []})

    def test_undeclared_effect_is_denied_and_journaled(self):
        report = check(self.emitting, reference_task(expect_effects=[EMIT]), self.journal)
        self.assertFalse(report["passed"])
        self.assertEqual({row["outcome"] for row in report["cases"]}, {"denied"})
        self.assertEqual([e["reason"] for e in self.journal.entries()], ["undeclared-effect"] * 2)
        declared = [{"capability": "demo", "operation": "emit", "payload": {"encoding": "bytes", "max_bytes": 1}}]
        self.assertTrue(check(self.emitting, reference_task(effects=declared, expect_effects=[EMIT]))["passed"])

    def test_schema_mismatch_and_malformed_tasks_are_refused(self):
        value = reference_task()
        value["schemas"]["state"] = "other"
        report = check(self.reference, value)
        self.assertEqual({row["outcome"] for row in report["cases"]}, {"refused"})
        self.assertIn("refused", check(b"\x00asm\x0d\x00\x01\x00", reference_task()))
        for change in (lambda t: t.pop("cases"), lambda t: t["cases"].clear(),
                       lambda t: t["cases"][0].update(state="zz"),
                       lambda t: t["cases"][1].update(name="inline"),
                       lambda t: t["effects"].update(id="other")):
            value = reference_task()
            change(value)
            with self.subTest(change=change), self.assertRaises(ValueError):
                task(value)

    def test_host_process_entry_point(self):
        component = self.directory / "kernel.wasm"
        component.write_bytes(self.emitting)
        request = {"component": str(component), "task": reference_task(expect_effects=[EMIT]),
                   "journal": str(self.directory / "denials.sqlite")}
        result = subprocess.run([sys.executable, "-B", "-m", "tools.kernel.conformance"],
                                input=json.dumps(request), capture_output=True, text=True,
                                timeout=120, check=True, cwd=ROOT)
        self.assertFalse(json.loads(result.stdout)["passed"])
        self.assertEqual(len(self.journal.entries()), 2)


if __name__ == "__main__":
    unittest.main()
