import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("check_trace", ROOT / "tools/check_trace.py")
check_trace = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_trace)

SRS = """# SRS

## 1. Requirements

### REQ-DEMO-001 — Adds

The demo shall add two numbers.

- Rationale: Demo.
- Derivation: `tools/add.py`
- Allocated to: SDD §4 C-01
- Verification: T
- Status: Baselined

## 11. Untested behaviour (requirement gaps)

| ID | Behaviour | Location | Why |
|---|---|---|---|
| GAP-EF-001 | Subtracts | `tools/add.py` | No test |
"""

SDD = """# SDD

## 4. Components

| ID | Component | Paths | Responsibility | Requirements |
|---|---|---|---|---|
| C-01 | Adder | `tools/add.py` | Adds | REQ-DEMO-001 |
| C-02 | Subtracter | `tools/add.py` | Subtracts | GAP-EF-001 |

## 5. Next

See [the matrix](../verification/verification-matrix.md#requirements-to-tests).
"""

VM = """# VM

## Requirements to tests

| Requirement | Method | Test | Observation | Last result |
|---|---|---|---|---|
| REQ-DEMO-001 | T | `tests/test_add.py::test_adds` | 1 + 1 = 2 | none |

## Tests without a requirement

| Test file | Classification and reason |
|---|---|
| `tests/test_reachability.py` | Discovery helper copied for the fixture |

## Change history
"""


class CheckTraceTest(unittest.TestCase):
    def tree(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        subprocess.run(["git", "-C", str(root), "init", "-q"], check=True)
        files = {
            check_trace.SRS: SRS,
            check_trace.SDD: SDD,
            check_trace.VM: VM,
            check_trace.CONFIG: "# Configuration\n\n- `DEMO_LEVEL`: demo.\n",
            "tools/add.py": "import os\nLEVEL = os.environ.get('DEMO_LEVEL')\n",
            "tests/test_add.py": "import unittest\n\n\nclass T(unittest.TestCase):\n    def test_adds(self):\n        pass\n",
        }
        for relative, content in files.items():
            (root / relative).parent.mkdir(parents=True, exist_ok=True)
            (root / relative).write_text(content)
        shutil.copy(ROOT / "tests/test_reachability.py", root / "tests/test_reachability.py")
        return root

    def problems(self, root):
        return check_trace.check(root)[0]

    def edit(self, root, relative, old, new):
        path = root / relative
        text = path.read_text()
        self.assertIn(old, text)
        path.write_text(text.replace(old, new))

    def test_fixture_is_clean(self):
        problems, summary = check_trace.check(self.tree())
        self.assertEqual(problems, [])
        self.assertEqual((summary["requirements"], summary["traced_requirements"], summary["untested_gaps"]), (1, 1, 1))

    def test_repository_trace_is_clean(self):
        problems, summary = check_trace.check(ROOT)
        self.assertEqual(problems, [])
        self.assertEqual(summary["requirements"], summary["traced_requirements"])

    def test_untraced_requirement_is_reported(self):
        root = self.tree()
        self.edit(root, check_trace.VM, "| REQ-DEMO-001 | T |", "| REQ-OTHER-001 | T |")
        problems = self.problems(root)
        self.assertIn("REQ-DEMO-001: no verification-matrix row", problems)
        self.assertIn("REQ-OTHER-001: matrix row for an undefined requirement", problems)

    def test_second_shall_and_missing_field_are_reported(self):
        root = self.tree()
        self.edit(root, check_trace.SRS, "add two numbers.", "add two numbers and shall subtract.")
        self.edit(root, check_trace.SRS, "- Status: Baselined\n", "")
        problems = self.problems(root)
        self.assertIn('REQ-DEMO-001: statement must contain exactly one "shall"', problems)
        self.assertIn("REQ-DEMO-001: missing field Status", problems)

    def test_missing_test_name_is_reported(self):
        root = self.tree()
        self.edit(root, check_trace.VM, "::test_adds", "::test_multiplies")
        self.assertIn("REQ-DEMO-001: test name not found in tests/test_add.py: test_multiplies", self.problems(root))

    def test_unclassified_test_file_is_reported(self):
        root = self.tree()
        (root / "tests/test_extra.py").write_text("import unittest\n")
        self.assertIn(
            "test file traces to no requirement and is not listed as supporting: tests/test_extra.py",
            self.problems(root),
        )

    def test_unallocated_component_is_reported(self):
        root = self.tree()
        self.edit(root, check_trace.SDD, "| Adds | REQ-DEMO-001 |", "| Adds | none |")
        problems = self.problems(root)
        self.assertIn("REQ-DEMO-001: not allocated to any design component", problems)
        self.assertIn("design component implements no requirement and is not infrastructure: C-01 Adder", problems)

    def test_unregistered_gap_is_reported(self):
        root = self.tree()
        self.edit(root, check_trace.SDD, "| Subtracts | GAP-EF-001 |", "| Subtracts | GAP-EF-009 |")
        self.assertIn("C-02 Subtracter: design names an unregistered gap GAP-EF-009", self.problems(root))

    def test_undocumented_environment_variable_is_reported(self):
        root = self.tree()
        (root / "tools/more.mjs").write_text("const x = process.env.DEMO_SECRET_PATH;\n")
        self.assertIn(
            "environment variable read by code is not in the configuration reference: DEMO_SECRET_PATH",
            self.problems(root),
        )

    def test_dead_anchor_is_reported(self):
        root = self.tree()
        self.edit(root, check_trace.SDD, "#requirements-to-tests", "#no-such-heading")
        self.assertIn(
            "dead anchor: docs/architecture/architecture.md:12: ../verification/verification-matrix.md#no-such-heading",
            self.problems(root),
        )

    def test_dead_link_is_reported(self):
        root = self.tree()
        self.edit(root, check_trace.SDD, "verification-matrix.md#", "missing.md#")
        self.assertIn(
            "dead link: docs/architecture/architecture.md:12: ../verification/missing.md#requirements-to-tests",
            self.problems(root),
        )


class DataDictionaryTest(unittest.TestCase):
    def load(self):
        spec = importlib.util.spec_from_file_location("gen_data_dictionary", ROOT / "tools/gen_data_dictionary.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_data_dictionary_is_current(self):
        self.assertEqual(self.load().main(["--check"]), 0)

    def test_stale_data_dictionary_is_reported(self):
        module = self.load()
        with tempfile.TemporaryDirectory() as folder:
            module.TARGET = Path(folder) / "data-dictionary.md"
            module.TARGET.write_text(module.render().replace("`evidence_sha256`", "`evidence`"))
            self.assertEqual(module.main(["--check"]), 1)
            module.main([])
            self.assertEqual(module.main(["--check"]), 0)


if __name__ == "__main__":
    unittest.main()
