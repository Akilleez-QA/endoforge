import contextlib
import importlib.util
import io
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("check_docs", ROOT / "tools/check-docs.py")
check_docs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_docs)


def git(root, *args):
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)


class CheckDocsTest(unittest.TestCase):
    def tree(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        git(root, "init", "-q")
        (root / "sources").mkdir()
        (root / "sources/a.txt").write_text("a\n")
        digest = check_docs.hashlib.sha256(b"a\n").hexdigest()
        (root / "sources/SHA256SUMS").write_text(f"{digest}  a.txt\n")
        (root / "README.md").write_text("[ok](sources/a.txt)\n")
        (root / ".gitignore").write_text(".scratch/\n")
        return root

    def run_check(self, root):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            failed = check_docs.main(root)
        return failed, output.getvalue()

    def test_ignored_scratch_and_node_modules_are_skipped(self):
        root = self.tree()
        vendored = root / ".scratch/asc/node_modules/pkg"
        vendored.mkdir(parents=True)
        (vendored / "README.md").write_text("[gone](missing.md)\n")
        (root / ".scratch/notes.md").write_bytes(b"\xff\xfe not utf-8 [x](nope.md)\n")
        stray = root / "tools/node_modules/pkg"
        stray.mkdir(parents=True)
        (stray / "README.md").write_text("[gone](missing.md)\n")
        failed, output = self.run_check(root)
        self.assertFalse(failed, output)
        self.assertIn("over 1 documents", output)

    def test_untracked_unignored_document_is_still_checked(self):
        root = self.tree()
        (root / "NEW.md").write_text("[gone](missing.md)\n")
        failed, output = self.run_check(root)
        self.assertTrue(failed)
        self.assertIn("NEW.md:1: broken link missing.md", output)

    def test_tracked_document_is_checked(self):
        root = self.tree()
        docs = root / "docs"
        docs.mkdir()
        (docs / "a.md").write_text("[gone](../nope.md)\n")
        git(root, "add", "docs/a.md")
        failed, output = self.run_check(root)
        self.assertTrue(failed)
        self.assertIn("docs/a.md:1: broken link ../nope.md", output)

    def test_repository_ignores_scratch(self):
        result = subprocess.run(
            ["git", "-C", str(ROOT), "check-ignore", "-q", ".scratch/asc/notes.md"],
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
