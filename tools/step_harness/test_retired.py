"""The step harness has no caller in EndoForge and is archived under TODELETE/tools/step_harness.

Run from .:  python3 -B -m unittest tools.step_harness.test_retired -v
"""
import importlib
import io
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools" / "step_harness"
ARCHIVE = ROOT / "TODELETE" / "tools" / "step_harness"
CODE = {".py", ".mjs", ".js", ".cjs", ".ts", ".sh"}
IMPORT = re.compile(r"(?:from|import)\s+[\w.]*step_harness|step_harness/harness|StepHarness\(")


def tracked_code():
    listed = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT,
                            capture_output=True, text=True, check=True).stdout.splitlines()
    return [ROOT / p for p in listed if Path(p).suffix in CODE and (ROOT / p).is_file()]


class TestStepHarnessRetired(unittest.TestCase):
    def test_harness_is_not_live_under_tools(self):
        self.assertFalse((LIVE / "harness.py").exists())
        self.assertFalse((LIVE / "test_harness.py").exists())

    def test_archive_holds_the_harness_and_its_tests(self):
        for name in ("harness.py", "test_harness.py", "README.md"):
            self.assertTrue((ARCHIVE / name).is_file(), name)
        module = importlib.import_module("TODELETE.tools.step_harness.harness")
        self.assertTrue(hasattr(module, "StepHarness"))

    def test_archived_tests_still_pass(self):
        suite = unittest.defaultTestLoader.loadTestsFromName("TODELETE.tools.step_harness.test_harness")
        self.assertGreaterEqual(suite.countTestCases(), 12)
        outcome = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
        self.assertTrue(outcome.wasSuccessful(), outcome.failures + outcome.errors)

    def test_nothing_outside_the_archive_calls_it(self):
        callers = []
        for path in tracked_code():
            relative = path.relative_to(ROOT).as_posix()
            if relative.startswith("TODELETE/") or path.resolve() == Path(__file__).resolve():
                continue
            if IMPORT.search(path.read_text(errors="replace")):
                callers.append(relative)
        self.assertEqual(callers, [])


if __name__ == "__main__":
    unittest.main()
