import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAKEFILE = ROOT / "Makefile"

PY_PROBE = """import unittest


class Probe(unittest.TestCase):
    def test_probe(self):
        self.assertEqual(1, {value})
"""

NODE_PROBE = """import test from 'node:test';
import assert from 'node:assert/strict';

test('probe', () => {{
  assert.equal(1, {value});
}});
"""

HIDE_COVERAGE = 'raise ImportError("coverage.py hidden by the probe")\n'

PASS_THROUGH = """import runpy
import sys

args = sys.argv[1:]
if args and args[0] == "report":
    sys.exit(0)
module = args[args.index("-m") + 1]
sys.argv = [module, *args[args.index("-m") + 2:]]
runpy.run_module(module, run_name="__main__", alter_sys=True)
"""


def make_env(extra_path=()):
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("MAKE") and key not in {"MFLAGS", "PYTHONPATH"}
    }
    if extra_path:
        env["PYTHONPATH"] = os.pathsep.join(str(p) for p in extra_path)
    return env


def run_make(args, env, cwd=ROOT):
    return subprocess.run(
        ["make", "--no-print-directory", "-f", str(MAKEFILE), *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )


class CoverageFailsOnFailingTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.tmp = Path(folder.name)

    def python_probe(self, value):
        probes = self.tmp / f"probes{value}"
        probes.mkdir()
        (probes / "covprobe_case.py").write_text(PY_PROBE.format(value=value))
        return probes

    def coverage_python(self, value, shim):
        probes = self.python_probe(value)
        return run_make(
            ["coverage-python", f"PYTHON={sys.executable}", "PY_COVERAGE_TESTS=covprobe_case",
             f"COVERAGE_DIR={self.tmp / f'cov{value}'}"],
            make_env([shim, probes] if shim else [probes]),
        )

    def hidden_coverage(self):
        shim = self.tmp / "hide"
        shim.mkdir(exist_ok=True)
        (shim / "coverage.py").write_text(HIDE_COVERAGE)
        return shim

    def coverage_shim(self):
        if importlib.util.find_spec("coverage") is not None:
            return None
        shim = self.tmp / "passthrough"
        (shim / "coverage").mkdir(parents=True, exist_ok=True)
        (shim / "coverage" / "__init__.py").write_text("")
        (shim / "coverage" / "__main__.py").write_text(PASS_THROUGH)
        return shim

    def assert_split(self, failing, passing, marker):
        self.assertNotEqual(failing.returncode, 0, failing.stdout + failing.stderr)
        self.assertIn(marker, failing.stdout + failing.stderr)
        self.assertEqual(passing.returncode, 0, passing.stdout + passing.stderr)

    def test_trace_fallback_fails_on_a_failing_test(self):
        shim = self.hidden_coverage()
        failing = self.coverage_python(2, shim)
        passing = self.coverage_python(1, shim)
        self.assertIn("coverage.py is not installed", failing.stdout)
        self.assert_split(failing, passing, "AssertionError")

    def test_coverage_py_branch_fails_on_a_failing_test(self):
        shim = self.coverage_shim()
        failing = self.coverage_python(2, shim)
        passing = self.coverage_python(1, shim)
        self.assertNotIn("coverage.py is not installed", failing.stdout)
        self.assert_split(failing, passing, "AssertionError")

    def coverage_node(self, value):
        probe = self.tmp / f"probe{value}.test.mjs"
        probe.write_text(NODE_PROBE.format(value=value))
        return run_make(["coverage-node", "COVERAGE_SETUP=", f"NODE_COVERAGE_TESTS={probe}"], make_env())

    def test_coverage_node_fails_on_a_failing_test(self):
        failing = self.coverage_node(2)
        passing = self.coverage_node(1)
        self.assert_split(failing, passing, "probe")
        self.assertIn("coverage report", passing.stdout)

    def test_make_coverage_fails_when_either_half_fails(self):
        probe = self.tmp / "probe1.test.mjs"
        probe.write_text(NODE_PROBE.format(value=1))
        probes = self.python_probe(2)
        result = run_make(
            ["coverage", "COVERAGE_SETUP=", f"NODE_COVERAGE_TESTS={probe}", f"PYTHON={sys.executable}",
             "PY_COVERAGE_TESTS=covprobe_case", f"COVERAGE_DIR={self.tmp / 'cov'}"],
            make_env([self.hidden_coverage(), probes]),
        )
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("AssertionError", result.stdout + result.stderr)


class ExperimentAnalysisTarget(unittest.TestCase):
    def layout(self, value):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root = Path(folder.name)
        (root / "experiments/P-0-probe").mkdir(parents=True)
        (root / "experiments/P-0-probe/analyze.test.mjs").write_text(NODE_PROBE.format(value=value))
        (root / "experiments/P-51-escape-rate").mkdir(parents=True)
        (root / "experiments/P-51-escape-rate/controls.test.mjs").write_text(NODE_PROBE.format(value=2))
        return root

    def test_experiments_test_runs_every_analysis_test(self):
        failing = run_make(["experiments-test"], make_env(), self.layout(2))
        self.assertNotEqual(failing.returncode, 0, failing.stdout + failing.stderr)
        self.assertIn("experiments/P-0-probe/analyze.test.mjs", failing.stdout)
        passing = run_make(["experiments-test"], make_env(), self.layout(1))
        self.assertEqual(passing.returncode, 0, passing.stdout + passing.stderr)
        self.assertNotIn("controls.test.mjs", passing.stdout)

    def test_make_test_includes_experiments_test(self):
        listed = run_make(["-n", "test", "PYTHON=python3"], make_env(), self.layout(1))
        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertIn("node --test experiments/P-0-probe/analyze.test.mjs", listed.stdout)


if __name__ == "__main__":
    unittest.main()
