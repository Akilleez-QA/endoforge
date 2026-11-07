import glob
import json
import os
import re
import shlex
import subprocess
import tempfile
import unittest
from fnmatch import fnmatch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path(__file__).with_name("test-reachability.json")
WORKFLOW = ROOT / ".github/workflows/ci.yml"
PRUNED = {"node_modules", "__pycache__", "target", "fixtures", "receipt"}
CODE = {".mjs", ".cjs", ".js", ".ts", ".py", ".sh", ".rs", ".c"}
NAMES = ("*.test.*", "*.spec.*", "test_*", "*_test.*", "test-*")
MARKER = re.compile(
    r"""from ['"]node:test['"]|require\(['"]node:test|"""
    r"""^\s*(?:import|from) (?:unittest|pytest)\b|#\[(?:cfg\()?test\)?\]""",
    re.MULTILINE,
)
DOTTED = re.compile(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+")


def is_test(path, relative):
    if path.suffix not in CODE:
        return False
    if any(fnmatch(path.name, name) for name in NAMES):
        return True
    if {"test", "tests"} & set(relative.parts[:-1]):
        return True
    if fnmatch(relative.as_posix(), "experiments/*/verify*"):
        return True
    return bool(MARKER.search(path.read_text(errors="replace")))


def discover(root):
    found = set()
    for folder, names, files in os.walk(root):
        names[:] = [n for n in names if n not in PRUNED and not n.startswith(".")]
        for name in files:
            path = Path(folder, name)
            relative = path.relative_to(root)
            if is_test(path, relative):
                found.add(relative.as_posix())
    return found


def make_commands(root):
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("MAKE") and key not in {"MFLAGS", "PYTHONOPTIMIZE"}
    }
    done = subprocess.run(
        ["make", "-n", "test", "PYTHON=python3"],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    return done.stdout.splitlines()


def named_by(line, root):
    try:
        tokens = shlex.split(line)
    except ValueError:
        tokens = line.split()
    found = set()
    if "discover" in tokens and "-s" in tokens:
        start = tokens[tokens.index("-s") + 1]
        pattern = tokens[tokens.index("-p") + 1] if "-p" in tokens else "test*.py"
        found.update(glob.glob(f"{start}/{pattern}", root_dir=root))
    for token in tokens:
        if token.startswith("/"):
            continue
        found.update(glob.glob(token, root_dir=root, recursive=True))
        if DOTTED.fullmatch(token):
            found.update(glob.glob(token.replace(".", "/") + ".py", root_dir=root))
    return {Path(p).as_posix() for p in found if Path(root, p).is_file()}


def reached(root):
    found = set()
    for line in make_commands(root):
        found |= named_by(line, root)
    return found


def orphans(root, manifest):
    accounted = set(manifest["indirect"]) | set(manifest["excluded"]) | set(manifest["known_failing"])
    return sorted(discover(root) - reached(root) - accounted)


class TestReachability(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(MANIFEST.read_text())

    def test_every_test_file_is_reached(self):
        missing = orphans(ROOT, self.manifest)
        self.assertEqual(
            missing,
            [],
            f"no make test target reaches these; wire them in or list them with a reason in {MANIFEST.name}",
        )

    def test_manifest_entries_are_current(self):
        tests, direct = discover(ROOT), reached(ROOT)
        for section in ("indirect", "excluded", "known_failing"):
            for path, value in self.manifest[section].items():
                with self.subTest(section=section, path=path):
                    self.assertIn(path, tests)
                    self.assertNotIn(path, direct)
                    self.assertTrue(value.strip())

    def test_indirect_parents_run_their_children(self):
        direct = reached(ROOT)
        for child, parent in self.manifest["indirect"].items():
            with self.subTest(child=child):
                self.assertIn(parent, direct)
                self.assertIn(Path(child).name, (ROOT / parent).read_text())

    def test_ci_runs_both_suites(self):
        workflow = WORKFLOW.read_text()
        self.assertRegex(workflow, r"run: make (-k )?test\n")
        self.assertRegex(workflow, r"run: make (-k )?test-optimized\n")

    def test_guard_reports_an_orphan(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "Makefile").write_text("test:\n\tnode --test a*.test.mjs\n\tpython3 -m unittest pkg.test_b\n")
            (root / "pkg").mkdir()
            for name in ("a1.test.mjs", "pkg/test_b.py", "pkg/test_c.py", "plain.mjs"):
                (root / name).write_text("")
            (root / "marked.py").write_text("import unittest\n")
            empty = {"indirect": {}, "excluded": {}, "known_failing": {}}
            self.assertEqual(orphans(root, empty), ["marked.py", "pkg/test_c.py"])


if __name__ == "__main__":
    unittest.main()
