import contextlib
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("check_privacy", ROOT / "tools/check-privacy.py")
check_privacy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_privacy)


class CheckPrivacyTest(unittest.TestCase):
    def tree(self, allowlist=()):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        (root / "experiments/P-1-x").mkdir(parents=True)
        (root / "tools").mkdir()
        (root / "tools/privacy-allowlist.json").write_text(json.dumps(list(allowlist)))
        return root

    def run_check(self, root):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            failed = check_privacy.main(root)
        return failed, output.getvalue()

    def write(self, root, name, text):
        path = root / "experiments/P-1-x" / name
        path.write_text(text)
        return path

    def test_clean_records_pass(self):
        root = self.tree()
        self.write(root, "PRECOMMIT.md", "Run `make test` from the repository root on main-rig.\n")
        self.write(root, "RESULT.md", "Commit abc123; see experiments/P-1-x/receipt.\n")
        failed, output = self.run_check(root)
        self.assertFalse(failed, output)
        self.assertIn("0 failure(s) over 2 records", output)

    def test_each_leak_kind_fails(self):
        cases = {
            "home path": "Read /home/someone/notes.txt first.\n",
            "home path  ": "Read /Users/someone/notes.txt first.\n",
            "Claude projects path": "Transcripts under ~/.claude/projects were read.\n",
            "Claude projects path ": "See /root/.claude/projects/x.\n",
            "Claude scratch workspace id": "Directories matching `workspaces-c805778a-*`.\n",
            "Claude scratch workspace id ": "In scratch-workspaces/19a9c5a0-5acd-426e-911a/x.\n",
            "email address": "Contact jane.doe+qa@example.co.uk about it.\n",
        }
        for name in ("PRECOMMIT.md", "AMENDMENT.md", "RESULT.md"):
            for kind, text in cases.items():
                with self.subTest(name=name, kind=kind):
                    root = self.tree()
                    self.write(root, name, "Clean line.\n" + text)
                    failed, output = self.run_check(root)
                    self.assertTrue(failed, output)
                    self.assertIn(f"experiments/P-1-x/{name}:2: {kind.strip()}", output)

    def test_other_files_are_not_checked(self):
        root = self.tree()
        self.write(root, "NOTES.md", "/home/someone/ is fine here.\n")
        failed, output = self.run_check(root)
        self.assertFalse(failed, output)

    def test_allowlisted_file_passes_only_while_unchanged(self):
        text = "Read /home/someone/x.\n"
        digest = hashlib.sha256(text.encode()).hexdigest()
        entry = {"path": "experiments/P-1-x/PRECOMMIT.md", "sha256": digest, "reason": "merged before the lint"}
        root = self.tree([entry])
        path = self.write(root, "PRECOMMIT.md", text)
        failed, output = self.run_check(root)
        self.assertFalse(failed, output)
        path.write_text(text + "Contact a@example.com.\n")
        failed, output = self.run_check(root)
        self.assertTrue(failed)
        self.assertIn("email address", output)

    def test_allowlist_entries_need_a_reason_and_an_existing_file(self):
        root = self.tree([
            {"path": "experiments/P-1-x/PRECOMMIT.md", "sha256": "0" * 64, "reason": ""},
            {"path": "experiments/P-9-gone/RESULT.md", "sha256": "0" * 64, "reason": "old"},
        ])
        self.write(root, "PRECOMMIT.md", "Clean.\n")
        failed, output = self.run_check(root)
        self.assertTrue(failed)
        self.assertIn("experiments/P-1-x/PRECOMMIT.md: allowlist entry needs a reason", output)
        self.assertIn("experiments/P-9-gone/RESULT.md: allowlisted file missing", output)

    def test_repository_allowlist_reasons_are_recorded(self):
        entries = json.loads((ROOT / "tools/privacy-allowlist.json").read_text())
        self.assertTrue(entries)
        for entry in entries:
            self.assertEqual(set(entry), {"path", "sha256", "reason"})
            self.assertTrue(entry["reason"].strip())


if __name__ == "__main__":
    unittest.main()
