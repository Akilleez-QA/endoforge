"""Exercise the release fold through its CLI in disposable repository trees."""

from datetime import datetime, timezone
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("fold_changelog.py")
INITIAL = "## [Unreleased]\n\n### Fixed\n\n- Existing fix.\n\n## [0.1]\n\n- Old release.\n"


class FoldChangelogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.unreleased = self.root / "changes/unreleased"
        self.unreleased.mkdir(parents=True)
        self.changelog = self.root / "CHANGELOG.md"
        self.changelog.write_text(INITIAL)
        (self.unreleased / "README.md").write_text("Documentation, not a fragment.\n")

    def fragment(self, name, text):
        (self.unreleased / name).write_text(text)

    def run_fold(self, *args):
        return subprocess.run([sys.executable, "-I", str(SCRIPT), "--root", str(self.root),
                               *args], capture_output=True, text=True)

    def snapshot(self):
        return {str(path.relative_to(self.root)): path.read_bytes()
                for path in self.root.rglob("*") if path.is_file()}

    def test_fold_and_archive(self):
        fragments = {
            "alpha.md": "### Fixed\n- First fix.\n  Wrapped detail.\n",
            "beta.md": "### Added\n- New feature.\n\n### Fixed\n- Second fix.\n",
        }
        for name, text in fragments.items():
            self.fragment(name, text)
        result = self.run_fold("--dest", "release-one")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.changelog.read_text(),
                         "## [Unreleased]\n\n### Fixed\n- First fix.\n  Wrapped detail.\n"
                         "- Second fix.\n\n- Existing fix.\n\n### Added\n- New feature.\n\n"
                         "## [0.1]\n\n- Old release.\n")
        self.assertEqual(sorted(p.name for p in self.unreleased.iterdir()), ["README.md"])
        for name, text in fragments.items():
            self.assertEqual((self.root / "changes/released/release-one" / name).read_text(), text)
        self.assertEqual((self.unreleased / "README.md").read_text(),
                         "Documentation, not a fragment.\n")
        before = self.snapshot()
        self.assertEqual(self.run_fold("--dest", "release-one").returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_no_fragments(self):
        before = self.snapshot()
        self.assertEqual(self.run_fold().returncode, 0)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse((self.root / "changes/released").exists())

    def test_malformed_leaves_everything_unchanged(self):
        for text in ("", "- No heading.\n", "### Unknown\n- Item.\n", "### Fixed\n",
                     "### Fixed\n- Valid.\nProse.\n", "### Added\n### Fixed\n- Item.\n"):
            with self.subTest(text=text):
                self.fragment("alpha.md", "### Fixed\n- Valid fix.\n")
                self.fragment("broken.md", text)
                before = self.snapshot()
                self.assertEqual(self.run_fold().returncode, 1)
                self.assertEqual(self.snapshot(), before)
                self.assertFalse((self.root / "changes/released").exists())

    def test_collision_leaves_everything_unchanged(self):
        self.fragment("alpha.md", "### Fixed\n- Valid fix.\n")
        self.fragment("beta.md", "### Added\n- New feature.\n")
        archive = self.root / "changes/released/release-one"
        archive.mkdir(parents=True)
        (archive / "beta.md").write_text("Already archived.\n")
        before = self.snapshot()
        self.assertEqual(self.run_fold("--dest", "release-one").returncode, 1)
        self.assertEqual(self.snapshot(), before)

    def test_default_destination(self):
        before = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self.fragment("alpha.md", "### Security\n- A fix.\n")
        result = self.run_fold()
        after = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self.assertEqual(result.returncode, 0, result.stderr)
        parents = list((self.root / "changes/released").iterdir())
        self.assertEqual(len(parents), 1)
        self.assertIn(parents[0].name, (before, after))

    def test_usage(self):
        for args in (("--unknown",), ("--dest", "../escape"), ("--root",)):
            with self.subTest(args=args):
                self.assertEqual(self.run_fold(*args).returncode, 2)
        for flag in ("-h", "--help"):
            result = self.run_fold(flag)
            self.assertEqual(result.returncode, 0)
            self.assertIn("usage:", result.stdout)


if __name__ == "__main__":
    unittest.main()
