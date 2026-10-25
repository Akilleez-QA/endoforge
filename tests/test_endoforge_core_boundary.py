"""ADR 005 decision 3 check 2 for the Endoforge core path (item 12a): forge/endoforge/core/ imports only the stdlib
allowlist poodo_core/ is held to. Standalone until PR #82's shared check (tests/replaceability/test_shared.py) merges;
fold this into that check then, keeping its test-file rule. The core's own lifecycle tests also run from here."""
import ast
import importlib
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "forge" / "endoforge" / "core"
# Identical to the poodo_core allowlist in PR #82 and tests/test_core.py.
STDLIB_ALLOWLIST = frozenset({"__future__", "dataclasses", "enum", "hashlib", "json", "re", "typing"})
TEST_ONLY = frozenset({"unittest"})  # core test_*.py files may also use the test runner, and nothing else


def imports(path):
    """Absolute top-level modules imported by one file, plus any relative import that leaves the package."""
    found, escapes = set(), []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"), str(path))):
        if isinstance(node, ast.Import):
            found.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0:
                found.add(node.module.split(".")[0])
            elif node.level > 1:
                escapes.append(node.lineno)
    return found, escapes


class EndoforgeCoreBoundaryTests(unittest.TestCase):
    def test_core_imports_only_the_allowlisted_stdlib(self):
        files = sorted(CORE.rglob("*.py"))
        self.assertTrue(any(f.name == "lifecycle.py" for f in files))
        for path in files:
            allowed = STDLIB_ALLOWLIST | (TEST_ONLY if path.name.startswith("test_") else frozenset())
            found, escapes = imports(path)
            with self.subTest(path=str(path.relative_to(ROOT))):
                self.assertEqual(found - allowed, set())
                self.assertEqual(escapes, [], "relative imports must stay inside the core package")

    def test_importing_the_core_loads_nothing_concrete(self):
        code = ("import sys, forge.endoforge.core; print(sorted(m for m in sys.modules if m.split('.')[0] in "
                "('subprocess', 'socket', 'poodo_core', 'adapters', 'extensions', 'bootstrap', 'urllib', 'http')))")
        proc = subprocess.run([sys.executable, "-B", "-c", code], cwd=ROOT, capture_output=True, timeout=30)
        self.assertEqual((proc.returncode, proc.stdout.strip()), (0, b"[]"), proc.stderr)


def load_tests(loader, tests, pattern):
    for path in sorted(CORE.glob("test_*.py")):
        tests.addTests(loader.loadTestsFromModule(importlib.import_module("forge.endoforge.core." + path.stem)))
    return tests


if __name__ == "__main__":
    unittest.main()
