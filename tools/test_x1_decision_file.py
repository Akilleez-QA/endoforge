import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

from tools import compat_policy, x1_loop


class DecisionFileTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="ef-decision-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.path = self.root / "promotion.json"

    def test_a_decision_file_is_complete_when_it_appears(self):
        x1_loop.store_decision(dict(decision="promote", sha256="d" * 64), self.path)
        self.assertEqual(json.loads(self.path.read_text()), dict(decision="promote", sha256="d" * 64))
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["promotion.json"])

    def test_a_write_cut_short_leaves_no_decision_file(self):
        def cut(decision, output, **_):
            output.write('{"decision": "pro')
            raise OSError("killed mid-write")

        with mock.patch.object(x1_loop.json, "dump", cut), self.assertRaises(OSError):
            x1_loop.store_decision(dict(decision="promote"), self.path)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_an_existing_decision_is_never_replaced(self):
        x1_loop.store_decision(dict(decision="refuse"), self.path)
        with self.assertRaises(FileExistsError):
            x1_loop.store_decision(dict(decision="promote"), self.path)
        self.assertEqual(json.loads(self.path.read_text()), dict(decision="refuse"))
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["promotion.json"])

    def test_the_compatibility_lane_stores_decisions_the_same_way(self):
        self.assertIs(compat_policy.store_decision, x1_loop.store_decision)


if __name__ == "__main__":
    unittest.main()
