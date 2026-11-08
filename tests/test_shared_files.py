import hashlib
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


index = load("experiments_index")
sums = load("source_sums")
allocator = load("experiment_id")


def git(root, *args):
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, check=True).stdout


def repository(folder):
    git(folder, "init", "--quiet", "-b", "main")
    git(folder, "config", "user.email", "test@example.invalid")
    git(folder, "config", "user.name", "test")
    git(folder, "config", "commit.gpgsign", "false")


class CommittedFiles(unittest.TestCase):
    def test_index_is_current(self):
        self.assertEqual(index.main(["--check"]), 0)

    def test_sums_are_current(self):
        self.assertEqual(sums.main(["--check"]), 0)

    def test_allocations_are_complete(self):
        self.assertEqual(allocator.problems(ROOT), [])

    def test_known_duplicates_are_recorded(self):
        _, entries = allocator.read(ROOT)
        legacy = {(n, slug) for n, slug, flag in entries if flag}
        for pair in [(55, "code-label-basis"), (55, "constraints"), (56, "evaluator-synthesis"), (56, "model-effort")]:
            self.assertIn(pair, legacy)


class Index(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.experiments = self.root / "experiments"
        self.experiments.mkdir()
        (self.experiments / "README.md").write_text(f"# E\n\n{index.BEGIN}\n{index.END}\n\nTail.\n")

    def tearDown(self):
        self.folder.cleanup()

    def fragment(self, name, *rows):
        folder = self.experiments / name
        folder.mkdir()
        (folder / "INDEX.md").write_text(index.HEADER + "\n" + "\n".join(rows) + "\n")

    def test_rows_are_numbered_and_links_rebased(self):
        self.fragment("P-10-b", "| [P-10](RESULT.md) | Q | [x](https://example.invalid) |")
        self.fragment("P-9-a", "| [P-9](./) | Q | [r](RESULT.md#part) |", "| [P-9 addendum](receipt/s.json) | Q2 | - |")
        self.assertEqual(index.main(["--root", str(self.root)]), 0)
        text = (self.experiments / "README.md").read_text()
        self.assertIn(
            "|---|---|---|\n| [P-9](P-9-a/) | Q | [r](P-9-a/RESULT.md#part) |\n"
            "| [P-9 addendum](P-9-a/receipt/s.json) | Q2 | - |\n"
            "| [P-10](P-10-b/RESULT.md) | Q | [x](https://example.invalid) |\n" + index.END + "\n\nTail.\n",
            text,
        )
        self.assertEqual(index.main(["--root", str(self.root), "--check"]), 0)

    def test_check_reports_a_stale_index(self):
        self.fragment("P-1-a", "| [P-1](RESULT.md) | Q | R |")
        self.assertEqual(index.main(["--root", str(self.root), "--check"]), 1)

    def test_empty_fragment_fails(self):
        (self.experiments / "P-2-a").mkdir()
        (self.experiments / "P-2-a" / "INDEX.md").write_text(index.HEADER + "\n")
        self.assertEqual(index.main(["--root", str(self.root)]), 1)


class Sums(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        (self.root / "sources").mkdir()
        (self.root / "core").mkdir()
        (self.root / "core/b.mjs").write_text("b\n")
        (self.root / "sources/a.json").write_text("{}\n")
        self.manifest = self.root / "sources/SHA256SUMS"
        self.manifest.write_text(f"{'0' * 64}  a.json\n")

    def tearDown(self):
        self.folder.cleanup()

    def digest(self, path):
        return hashlib.sha256((self.root / path).read_bytes()).hexdigest()

    def test_regenerates_listed_digests_sorted(self):
        self.assertEqual(sums.main(["--root", str(self.root), "--check"]), 1)
        self.assertEqual(sums.main(["--root", str(self.root), "--add", "core/b.mjs"]), 0)
        self.assertEqual(
            self.manifest.read_text(),
            f"{self.digest('core/b.mjs')}  ../core/b.mjs\n{self.digest('sources/a.json')}  a.json\n",
        )
        self.assertEqual(sums.main(["--root", str(self.root), "--check"]), 0)
        first = self.manifest.read_bytes()
        self.assertEqual(sums.main(["--root", str(self.root)]), 0)
        self.assertEqual(self.manifest.read_bytes(), first)

    def test_remove_and_missing(self):
        sums.main(["--root", str(self.root), "--add", "core/b.mjs"])
        self.assertEqual(sums.main(["--root", str(self.root), "--remove", "core/b.mjs"]), 0)
        self.assertNotIn("b.mjs", self.manifest.read_text())
        (self.root / "sources/a.json").unlink()
        self.assertEqual(sums.main(["--root", str(self.root)]), 1)


class Allocator(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        base = Path(self.folder.name)
        self.remote = base / "remote.git"
        subprocess.run(["git", "init", "--quiet", "--bare", "-b", "main", str(self.remote)], check=True)
        self.lanes = []
        seed = base / "seed"
        seed.mkdir()
        repository(seed)
        (seed / "experiments/P-03-a").mkdir(parents=True)
        (seed / "experiments/P-03-a/RESULT.md").write_text("r\n")
        (seed / "experiments/ALLOCATED").write_text("# header\nP-03  a\n")
        git(seed, "add", ".")
        git(seed, "commit", "--quiet", "-m", "seed")
        git(seed, "push", "--quiet", str(self.remote), "main")
        for name in ("one", "two"):
            lane = base / name
            subprocess.run(["git", "clone", "--quiet", str(self.remote), str(lane)], check=True)
            repository(lane)
            self.lanes.append(lane)

    def tearDown(self):
        self.folder.cleanup()

    def test_parallel_lanes_get_distinct_numbers_and_commit(self):
        one, two = self.lanes
        self.assertEqual(allocator.reserve(one, "first", "origin", False, True), 4)
        self.assertEqual(allocator.reserve(two, "second", "origin", False, True), 5)
        self.assertIn("P-04  first", (one / "experiments/ALLOCATED").read_text())
        self.assertEqual(git(one, "log", "-1", "--format=%s").strip(), "experiments: reserve P-04-first")
        self.assertEqual(git(two, "status", "--porcelain"), "")

    def test_a_claimed_tag_is_never_reused(self):
        one, two = self.lanes
        self.assertTrue(allocator.claim(one, "origin", 4, "x"))
        self.assertFalse(allocator.claim(two, "origin", 4, "y"))

    def test_check_refuses_duplicates_and_missing(self):
        one = self.lanes[0]
        (one / "experiments/ALLOCATED").write_text("P-03  a\nP-03  b\n")
        (one / "experiments/P-07-new").mkdir()
        found = allocator.problems(one)
        self.assertTrue(any("P-03 is allocated more than once" in f for f in found))
        self.assertTrue(any("P-07-new: not in" in f for f in found))
        (one / "experiments/ALLOCATED").write_text("P-03  a  legacy-duplicate\nP-03  b  legacy-duplicate\nP-07  new\n")
        self.assertEqual(allocator.problems(one), [])


if __name__ == "__main__":
    unittest.main()
