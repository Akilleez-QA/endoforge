from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from .frozen import FrozenEvaluators, digest
from .ledger import Ledger, SCHEMA, conforms, encode
from .test_ledger import chain, record


class FrozenTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.tree = self.root / "evaluator"
        self.tree.mkdir()
        self.code = self.tree / "judge.py"
        self.code.write_text("assert value == 4\n")
        self.ledger = Ledger(self.root / "ledger.sqlite")
        for row in chain()[:2] + [chain()[3]]:
            self.ledger.append(row)
        self.store = FrozenEvaluators(self.ledger)
        self.components = dict(configuration={"tolerance": 0}, residual="equals 4", invariant_version="v1")
        self.manifest = dict(task="t1", admitted_input="i1", confirmed_by="owner",
                             qualification="anchor and seeded-fault receipt",
                             synthesis_context=dict(id="context-1", candidate_blind="confirmed", inputs=["i1"]),
                             **self.components)
        self.frozen = self.store.freeze(self.tree, **self.manifest)
        self.receipt = chain()[-1]
        self.receipt["data"]["frozen_evaluator"] = self.frozen["id"]
        self.receipt["data"]["precommit"]["oracle"] = self.frozen["id"]
        self.receipt["data"]["precommit"]["oracle_version"] = self.frozen["data"]["freeze"]["digest"]

    def test_evaluation_records_hash_before_judge_and_uses_snapshot(self):
        def judge(bundle):
            rows = Ledger(self.ledger.path).records()
            self.assertEqual(rows[-2], self.frozen)
            self.assertEqual(rows[-1]["data"]["delivery_state"], "running")
            self.code.write_text("changed during evaluation")
            self.assertEqual(bytes.fromhex(bundle["files"]["judge.py"]), b"assert value == 4\n")
            return "passed", [{"output": 4}]
        result = self.store.evaluate(self.tree, self.receipt, judge, **self.components)
        self.assertEqual(result["data"]["outcome_state"], "passed")
        self.assertEqual(Ledger(self.ledger.path).records()[-1], result)

    def test_every_component_change_refuses_before_judging(self):
        def judge(_):
            self.fail("modified evaluator reached judge")
        for field, value in (("configuration", {}), ("residual", "equals 3"), ("invariant_version", "v2")):
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "digest differs"):
                self.store.evaluate(self.tree, self.receipt, judge, **(self.components | {field: value}))
        for change in ("edit", "add", "rename", "remove"):
            with self.subTest(change=change):
                if change == "edit":
                    self.code.write_text("assert value == 3\n")
                elif change == "add":
                    (self.tree / "extra.py").write_text("pass\n")
                elif change == "rename":
                    self.code.rename(self.tree / "renamed.py")
                else:
                    self.code.unlink()
                with self.assertRaises(ValueError):
                    self.store.evaluate(self.tree, self.receipt, judge, **self.components)
                if change == "add":
                    (self.tree / "extra.py").unlink()
                if change == "rename":
                    (self.tree / "renamed.py").rename(self.code)
                self.code.write_text("assert value == 4\n")
        self.assertEqual(len(self.ledger.records()), 4)

    def test_edit_after_failure_refused_even_with_new_identity_or_input(self):
        for outcome in ("failed", "failed_with_test_concern"):
            self.ledger.append(self.receipt | {"id": outcome, "data": self.receipt["data"] | {"outcome_state": outcome}})
        self.code.write_text("assert value == 3\n")
        revision = dict(of=self.frozen["id"], reason="specification_correction", evidence="i1")
        with self.assertRaisesRegex(ValueError, "after recorded failure"):
            FrozenEvaluators(Ledger(self.ledger.path)).freeze(self.tree, **self.manifest, revision=revision)
        self.ledger.append(record("admitted_input", "i2", task="t1", content="2", origin="user"))
        for admitted_input in ("i1", "i2"):
            attempt = chain()[2] | {"id": "replacement"}
            attempt["data"]["admitted_input"] = admitted_input
            with self.assertRaisesRegex(ValueError, "after recorded failure"):
                self.ledger.append(attempt)
        self.code.write_text("assert value == 4\n")
        self.assertTrue(self.store.require_frozen(self.frozen["id"], self.tree, **self.components))

    def test_revision_requires_structured_independent_reason(self):
        self.code.write_text("assert value == 5\n")
        revision = dict(of=self.frozen["id"], reason="specification_correction", evidence="i1")
        with self.assertRaisesRegex(ValueError, "latest frozen"):
            self.store.freeze(self.tree, **self.manifest)
        for patch in ({"reason": "candidate_failed"}, {"candidate_outcome": "failed"}):
            attempt = deepcopy(self.frozen)
            attempt["data"]["revision"] = revision | patch
            self.assertFalse(conforms(attempt, SCHEMA))
        with self.assertRaisesRegex(ValueError, "outcome-independent"):
            self.store.freeze(self.tree, **self.manifest, revision=revision | {"evidence": "c1"})
        revised = self.store.freeze(self.tree, **self.manifest, revision=revision)
        self.assertNotEqual(revised["data"]["freeze"]["digest"], self.frozen["data"]["freeze"]["digest"])

    def test_candidate_context_and_missing_confirmation_refused(self):
        for inputs in (["i1", "c1"], ["i1", "missing"], []):
            manifest = deepcopy(self.manifest)
            manifest["synthesis_context"]["inputs"] = inputs
            with self.assertRaisesRegex(ValueError, "context"):
                self.store.freeze(self.tree, **manifest)
        manifest = self.manifest | {"confirmed_by": ""}
        with self.assertRaisesRegex(ValueError, "schema"):
            self.store.freeze(self.tree, **manifest)

    def test_missing_legacy_and_forged_hash_are_refused(self):
        with self.assertRaisesRegex(ValueError, "content-hashed"):
            self.store.require_frozen("missing", self.tree, **self.components)
        legacy = Ledger(self.root / "legacy.sqlite")
        for row in chain()[:3]:
            legacy.append(row)
        with self.assertRaisesRegex(ValueError, "content-hashed"):
            FrozenEvaluators(legacy).require_frozen("e1", self.tree, **self.components)
        attempt = deepcopy(self.frozen)
        attempt["id"] = "forged"
        attempt["data"]["freeze"]["digest"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "digest differs"):
            self.ledger.append(attempt)
        receipt = deepcopy(self.receipt)
        del receipt["data"]["frozen_evaluator"]
        with self.assertRaises(ValueError):
            self.ledger.append(receipt)
        receipt = deepcopy(self.receipt)
        receipt["data"]["precommit"]["oracle_version"] = "wrong"
        with self.assertRaisesRegex(ValueError, "digest"):
            self.ledger.append(receipt)

    def test_cli_freeze_and_symlink_refusal(self):
        manifest = self.manifest | {"revision": dict(of=self.frozen["id"], reason="independent_qualification", evidence="i1")}
        path = self.root / "manifest.json"
        path.write_text(json.dumps(manifest))
        result = subprocess.run([sys.executable, "-B", "-m", "tools.ledger.frozen", "freeze",
                                 self.ledger.path, str(self.tree), str(path)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        frozen = self.ledger.records()[-1]
        self.assertEqual(result.stdout.strip(), frozen["id"])
        self.assertEqual(frozen["id"], "evr:" + digest(encode(frozen["data"])))
        (self.tree / "link").symlink_to(self.code)
        with self.assertRaisesRegex(ValueError, "link"):
            self.store.freeze(self.tree, **manifest)


if __name__ == "__main__":
    unittest.main()
