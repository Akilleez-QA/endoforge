import contextlib
import importlib.util
import io
import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("gen_release_docs", HERE / "gen_release_docs.py")
gen = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gen)

NODE_SPEC = """\
# commit: 0123456789abcdef0123456789abcdef01234567
# node: v26.1.0
# python: 3.12.3
# command: make test
✔ adds (1.1ms)
✖ divides by zero (2.0ms)
ℹ tests 7
ℹ suites 0
ℹ pass 5
ℹ fail 1
ℹ skipped 1
ℹ start of coverage report
ℹ file          | line % | branch % | funcs % | uncovered lines
ℹ all files     |  85.71 |    66.67 |  90.00 |
ℹ end of coverage report
✖ failing tests:
✖ divides by zero (2.0ms)
make-exit=2
"""

NODE_TAP = """\
TAP version 13
ok 1 - first
not ok 2 - second
# tests 3
# pass 2
# fail 1
# skipped 0
# all files | 70.00 | 50.00 | 60.00 |
"""

UNITTEST = """\
test_a (m.T.test_a) ... ok
FAIL: test_b (m.T.test_b)
ERROR: test_c (m.T.test_c)
Ran 10 tests in 0.100s

FAILED (failures=1, errors=2, skipped=3)
Ran 4 tests in 0.010s

OK (skipped=1)
Name    Stmts   Miss  Cover
TOTAL     200     30    85%
"""

SCRIPT = """\
PASS cycle rejected
PASS fan-out all done
FAIL wall below 6 s: wall 7000 ms
make-exit=0
"""


def write(directory, name, text):
    path = Path(directory) / name
    path.write_text(text, encoding="utf-8")
    return path


def data(runs, **over):
    d = {
        "commit": "0123456789abcdef0123456789abcdef01234567",
        "tree": "fedcba9876543210fedcba9876543210fedcba98",
        "commit_date": "2026-11-09",
        "generated": "2026-11-09 12:00 UTC",
        "tags": [],
        "reservations": 4,
        "since": ["abc1234 2026-11-08 Merge pull request #1"],
        "commit_count": 42,
        "runs": runs,
        "run_drift": {},
        "trace_problems": [],
        "trace": {"traced_requirements": 9, "requirements": 9, "test_files_traced": 5, "test_files": 6,
                  "test_files_supporting": 1, "untested_gaps": 2, "design_infrastructure_components": 3,
                  "design_gap_components": 1},
        "gaps": [],
        "statuses": ["Implemented"],
        "issues": [
            {"number": 1, "state": "OPEN", "title": "first", "labels": [{"name": "S2"}, {"name": "bug"}]},
            {"number": 2, "state": "OPEN", "title": "second", "labels": []},
            {"number": 3, "state": "CLOSED", "title": "third", "labels": [{"name": "S1"}]},
        ],
        "prs": [{"number": 5, "reviews": [], "comments": [{}]}, {"number": 6, "reviews": [], "comments": []}],
        "pinned": [("sources/SHA256SUMS", "a" * 64)],
        "archive": {"sha256": "b" * 64, "bytes": 1000, "files": 12},
        "lines": [(".mjs", [10, 900]), (".py", [5, 400])],
        "gitleaks": None,
        "privacy": ["privacy: ok"],
        "tooling": {"lint": False, "lint_ci": False, "coverage": False},
    }
    d.update(over)
    return d


class ParseLog(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)

    def test_node_spec_summary_header_exit_failures_and_coverage(self):
        run = gen.parse_log("full", write(self.tmp, "spec.log", NODE_SPEC))
        self.assertEqual(run["label"], "full")
        self.assertEqual(run["file"], "spec.log")
        self.assertRegex(run["sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(run["totals"], {"tests": 7, "pass": 5, "fail": 1, "skipped": 1})
        self.assertEqual(run["exit"], 2)
        self.assertEqual(run["header"], {"commit": "0123456789abcdef0123456789abcdef01234567", "node": "v26.1.0",
                                         "python": "3.12.3", "command": "make test"})
        self.assertEqual(run["failures"], ["✖ divides by zero (2.0ms)"])
        self.assertEqual(run["coverage"], {"node": [(85.71, 66.67, 90.0)], "python": []})

    def test_node_tap_summary_and_not_ok_lines(self):
        run = gen.parse_log("tap", write(self.tmp, "tap.log", NODE_TAP))
        self.assertEqual(run["totals"], {"tests": 3, "pass": 2, "fail": 1, "skipped": 0})
        self.assertEqual(run["failures"], ["not ok 2 - second"])
        self.assertIsNone(run["exit"])
        self.assertEqual(run["header"], {})
        self.assertEqual(run["coverage"]["node"], [(70.0, 50.0, 60.0)])

    def test_unittest_summaries_count_failures_errors_and_skips(self):
        run = gen.parse_log("py", write(self.tmp, "py.log", UNITTEST))
        self.assertEqual(run["totals"], {"tests": 14, "pass": 7, "fail": 3, "skipped": 4})
        self.assertEqual(run["unittest_runs"], 2)
        self.assertEqual(run["failures"], ["FAIL: test_b (m.T.test_b)", "ERROR: test_c (m.T.test_c)"])
        self.assertEqual(run["coverage"]["python"], [85.0])

    def test_script_pass_and_fail_lines(self):
        run = gen.parse_log("script", write(self.tmp, "script.log", SCRIPT))
        self.assertEqual(run["totals"], {"tests": 3, "pass": 2, "fail": 1, "skipped": 0})
        self.assertEqual(run["failures"], ["FAIL wall below 6 s: wall 7000 ms"])
        self.assertEqual(run["exit"], 0)
        self.assertEqual(run["coverage"], {"node": [], "python": []})

    def test_last_make_exit_wins_and_invalid_utf8_is_tolerated(self):
        path = Path(self.tmp) / "bytes.log"
        path.write_bytes(b"make-exit=1\n\xff\xfe\nmake-exit=0\n")
        run = gen.parse_log("bytes", path)
        self.assertEqual(run["exit"], 0)
        self.assertEqual(run["totals"]["tests"], 0)


class Reports(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)

    def run_of(self, text, name="r.log", label="full"):
        return gen.parse_log(label, write(self.tmp, name, text))

    def test_severity_counts_by_state_and_label(self):
        issues = data([])["issues"]
        self.assertEqual(gen.severity(issues, "OPEN"), {"S2": 1, "unlabelled": 1})
        self.assertEqual(gen.severity(issues, "CLOSED"), {"S1": 1})
        self.assertEqual(gen.severity(None, "OPEN"), {})

    def test_passing_runs_give_a_passing_conclusion_and_no_problems(self):
        clean = self.run_of("# commit: 0123456789abcdef0123456789abcdef01234567\nℹ tests 2\nℹ pass 2\nℹ fail 0\nmake-exit=0\n")
        text = gen.str_report(data([clean]), "STR-x", "77")
        self.assertIn("# EndoForge test report STR-x", text)
        self.assertIn("| Document ID | ENDOFORGE-STR-x |", text)
        self.assertIn("every recorded run exited 0 with no failed test", text)
        self.assertIn("None. No recorded run failed and the trace check reported no problems.", text)
        self.assertIn("| full | 2 | 2 | 0 | 0 | 0 |", text)
        self.assertIn('| Issues open by severity | {"S2": 1, "unlabelled": 1} |', text)
        self.assertIn("| PRs merged / with a review or comment | 2 / 1 |", text)
        self.assertIn("| Secret scan | not run |", text)
        self.assertIn("for PR #77", text)
        self.assertIn("| 1.0 | 2026-11-09 | `0123456` | Generated record | PR #77 |", text)

    def test_failed_runs_and_trace_problems_are_listed(self):
        failing = self.run_of(NODE_SPEC)
        text = gen.str_report(data([failing], trace_problems=["REQ-X untraced"]), "STR-x", "1")
        self.assertIn("at least one recorded run or check failed; see section 4", text)
        self.assertIn("| full | make exit 2 |", text)
        self.assertIn("| full | `✖ divides by zero (2.0ms)` |", text)
        self.assertIn("| trace check | REQ-X untraced |", text)

    def test_run_drift_names_the_changed_files(self):
        run = self.run_of("make-exit=0\n")
        text = gen.str_report(data([run], run_drift={"9" * 40: ["a.py", "b.mjs"]}), "STR-x", "1")
        self.assertIn("The runs at `9999999` precede the record commit. Files changed between them: `a.py`, `b.mjs`.", text)

    def test_coverage_and_lint_rows_follow_the_repository_and_the_logs(self):
        covered = self.run_of(NODE_SPEC.replace("make-exit=2", "make-exit=0"), "cov.log", "coverage")
        plain = self.run_of("make-exit=0\n", "plain.log", "plain")
        none = gen.str_report(data([plain]), "STR-x", "1")
        self.assertIn("| Code coverage | not measured: no coverage target is configured |", none)
        configured = gen.str_report(data([plain], tooling={"lint": True, "lint_ci": True, "coverage": True}), "STR-x", "1")
        self.assertIn("| Code coverage | not measured in the recorded runs; `make coverage` produces it |", configured)
        measured = gen.str_report(data([covered, plain], tooling={"lint": True, "lint_ci": True, "coverage": True}), "STR-x", "1")
        self.assertIn("| Code coverage (coverage) | Node all files: line 85.71%, branch 66.67%, funcs 90.00% | log `cov.log` |", measured)
        self.assertNotIn("no coverage tool is configured", measured)
        vdd_none = self.vdd(data([plain]))
        self.assertIn("- Static analysis: no linter is configured.", vdd_none)
        vdd_local = self.vdd(data([plain], tooling={"lint": True, "lint_ci": False, "coverage": False}))
        self.assertIn("- Static analysis: `make lint` is configured but CI does not run it.", vdd_local)
        vdd_ci = self.vdd(data([plain], tooling={"lint": True, "lint_ci": True, "coverage": True}))
        self.assertIn("- Static analysis: `make lint` is configured and CI runs it.", vdd_ci)

    def vdd(self, d, changelog="# Changelog\n\n## [Unreleased]\n\n- Added [guide](docs/guide.md) and [site](https://example.test).\n\n## [0.1]\n- old\n"):
        root = Path(self.tmp) / "root"
        root.mkdir(exist_ok=True)
        (root / "CHANGELOG.md").write_text(changelog, encoding="utf-8")
        with mock.patch.object(gen, "ROOT", root):
            return gen.vdd_report(d, "VDD-x", "STR-x", "9")

    def test_vdd_rewrites_changelog_links_lists_issues_and_fixes_plan_link(self):
        text = self.vdd(data([]))
        self.assertIn("> - Added [guide](../../docs/guide.md) and [site](https://example.test).", text)
        self.assertNotIn("old", text.split("## 5. Changes", 1)[1].split("## 6.", 1)[0])
        self.assertIn("| #1 | S2, bug | first |", text)
        self.assertIn("| #2 | unlabelled | second |", text)
        self.assertNotIn("| #3 |", text)
        self.assertIn("](../plan/software-management-plan.md", text)
        self.assertNotIn("](../../plan/", text)
        self.assertIn("| `sources/SHA256SUMS` | `" + "a" * 64 + "` | pinned or controlled input |", text)
        self.assertIn("| Tag | none; no release tag has been created |", text)
        self.assertIn("abc1234 2026-11-08 Merge pull request #1", text)
        self.assertIn("[STR-x](../verification/reports/STR-x.md)", text)
        self.assertIn("No Unreleased section.", self.vdd(data([]), changelog="# Changelog\n"))
        self.assertIn("GitHub issues were not queried.", self.vdd(data([], issues=None)))

    def test_report_links_resolve_from_where_the_records_are_written(self):
        repo = gen.ROOT
        run = self.run_of("make-exit=0\n")
        for text, where in ((gen.str_report(data([run]), "STR-x", "1"), repo / "docs/verification/reports"),
                            (self.vdd(data([run])), repo / "docs/releases")):
            for target in re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", text):
                if re.match(r"[a-z]+:", target) or Path(target).name == "STR-x.md" or "docs/guide.md" in target:
                    continue
                self.assertTrue((where / target).resolve().exists(), f"{where.name}: {target}")


class IndexAndMain(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)

    def test_index_replaces_the_row_for_the_same_name(self):
        readme = self.tmp / "README.md"
        readme.write_text("# Reports\n\n| Record | Commit | Date |\n|---|---|---|\n| [STR-a](STR-a.md) | `1111111` | 2026-01-01 |\n| [STR-b](STR-b.md) | `2222222` | 2026-01-02 |\n", encoding="utf-8")
        gen.index(readme, "STR-a", data([]))
        rows = readme.read_text(encoding="utf-8").splitlines()
        self.assertEqual([r for r in rows if r.startswith("| [STR-a]")], ["| [STR-a](STR-a.md) | `0123456` | 2026-11-09 |"])
        self.assertEqual(rows[-1], "| [STR-a](STR-a.md) | `0123456` | 2026-11-09 |")
        self.assertIn("| [STR-b](STR-b.md) | `2222222` | 2026-01-02 |", rows)

    def fake_root(self):
        root = Path(tempfile.mkdtemp(dir=self.tmp))
        for sub in ("docs/verification/reports", "docs/releases"):
            (root / sub).mkdir(parents=True)
            (root / sub / "README.md").write_text("# Index\n", encoding="utf-8")
        (root / "CHANGELOG.md").write_text("## [Unreleased]\n- x\n", encoding="utf-8")
        return root

    def run_main(self, argv, runs, **over):
        root = self.fake_root()
        out = io.StringIO()
        with mock.patch.object(gen, "ROOT", root), mock.patch.object(gen, "collect", return_value=data(runs, **over)), \
                contextlib.redirect_stdout(out):
            code = gen.main(argv)
        return code, json.loads(out.getvalue()), root

    def test_main_writes_both_records_and_indexes_and_exits_0_when_clean(self):
        log = write(self.tmp, "ok.log", "ℹ tests 1\nℹ pass 1\nℹ fail 0\nmake-exit=0\n")
        run = gen.parse_log("full", log)
        code, summary, root = self.run_main(["--name", "main-x", "--pr", "3", "--log", f"full={log}"], [run])
        self.assertEqual(code, 0)
        self.assertEqual(summary, {"failed_runs": [], "str": "STR-main-x", "trace_problems": 0, "vdd": "VDD-main-x"})
        self.assertTrue((root / "docs/verification/reports/STR-main-x.md").is_file())
        self.assertTrue((root / "docs/releases/VDD-main-x.md").is_file())
        self.assertIn("| [STR-main-x](STR-main-x.md) |", (root / "docs/verification/reports/README.md").read_text(encoding="utf-8"))
        self.assertIn("| [VDD-main-x](VDD-main-x.md) |", (root / "docs/releases/README.md").read_text(encoding="utf-8"))

    def test_main_exits_1_on_a_failed_run_or_a_trace_problem(self):
        bad = gen.parse_log("full", write(self.tmp, "bad.log", NODE_SPEC))
        code, summary, _ = self.run_main(["--name", "x", "--pr", "3", "--log", "full=bad.log"], [bad])
        self.assertEqual((code, summary["failed_runs"]), (1, ["full"]))
        good = gen.parse_log("full", write(self.tmp, "good.log", "make-exit=0\n"))
        code, summary, _ = self.run_main(["--name", "x", "--pr", "3", "--log", "full=good.log"], [good], trace_problems=["p"])
        self.assertEqual((code, summary["trace_problems"]), (1, 1))

    def test_main_refuses_a_log_without_a_label_and_a_record_without_logs(self):
        for argv in (["--name", "x", "--pr", "1", "--log", str(self.tmp / "nolabel.log")], ["--name", "x", "--pr", "1"]):
            with mock.patch.object(gen, "ROOT", self.fake_root()), mock.patch.object(gen, "collect") as collect, \
                    contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as stop:
                gen.main(argv)
            self.assertEqual(stop.exception.code, 2, argv)
            collect.assert_not_called()

    def test_collect_refuses_a_dirty_tree_before_reading_anything(self):
        with mock.patch.object(gen, "git", return_value=" M tools/x.py") as git, \
                mock.patch.object(gen.check_trace, "check") as check, self.assertRaises(SystemExit) as stop:
            gen.collect(gen.argparse.Namespace(log=[], since=None, repo="r", gitleaks=None))
        self.assertIn("uncommitted changes", str(stop.exception))
        git.assert_called_once_with("status", "--porcelain", "--untracked-files=no")
        check.assert_not_called()

    def test_tooling_reads_the_makefile_and_the_ci_workflows(self):
        root = self.tmp / "repo"
        (root / ".github/workflows").mkdir(parents=True)
        (root / "Makefile").write_text("test:\n\ttrue\n", encoding="utf-8")
        (root / ".github/workflows/ci.yml").write_text("jobs:\n  t:\n    steps:\n      - run: make -k test\n", encoding="utf-8")
        with mock.patch.object(gen, "ROOT", root):
            self.assertEqual(gen.tooling(), {"lint": False, "lint_ci": False, "coverage": False})
            (root / "Makefile").write_text("lint:\n\truff check .\ncoverage:\n\tnode --test\ntest:\n\ttrue\n", encoding="utf-8")
            self.assertEqual(gen.tooling(), {"lint": True, "lint_ci": False, "coverage": True})
            (root / ".github/workflows/ci.yml").write_text("steps:\n  - run: make lint\n", encoding="utf-8")
            self.assertEqual(gen.tooling(), {"lint": True, "lint_ci": True, "coverage": True})
            (root / ".github/workflows/ci.yml").write_text("steps:\n  - run: make -k test\n", encoding="utf-8")
            (root / "Makefile").write_text("lint:\n\truff check .\ntest: check lint core-test\n\ttrue\n", encoding="utf-8")
            self.assertEqual(gen.tooling(), {"lint": True, "lint_ci": True, "coverage": False})


if __name__ == "__main__":
    unittest.main()
