import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools.kernel.contract import validate_artifact
from tools.rust_lane.build import ROOT, build, run

WORKCELL_PROBE = """
import json, sys
from pathlib import Path
from tools.kernel.workcell import Workcell
cell = Workcell(Path(sys.argv[1]).read_bytes(), ("p06-result-i32le-v1", "p06-args-4xi32le-v1", "empty-v1"))
rows = []
for event, inputs in json.loads(sys.argv[2]):
    r = cell.run(b"", bytes.fromhex(event), [bytes.fromhex(i) for i in inputs], fuel=1000000)
    rows.append([r["state"].hex(), r["effects"], r["buffer_bytes_read"]])
print(json.dumps(rows))
"""


class RustLaneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory(prefix="ef24-")
        cls.addClassCleanup(cls.workspace.cleanup)
        cls.root = Path(cls.workspace.name)
        cls.first = build(cls.root / "first")
        cls.second = build(cls.root / "second")

    def test_reproducible_build_and_validation(self):
        self.assertEqual(self.first, self.second)
        for name in ("kernel.wasm", "kernel.core.wasm"):
            self.assertEqual((self.root / "first" / name).read_bytes(),
                             (self.root / "second" / name).read_bytes())
        self.assertEqual(self.first["qualification"], "required")
        component = (self.root / "first/kernel.wasm").read_bytes()
        validate_artifact(self.first["artifact"], component)
        with self.assertRaises(ValueError):
            validate_artifact(self.first["artifact"], component + b"\x00\x04\x03tag")

    def test_toolchain_mismatch_refused_before_build(self):
        with patch("tools.rust_lane.build.run", return_value=b"rustc 0.0.0"):
            with self.assertRaisesRegex(ValueError, "1.98.1"):
                build(self.root / "wrong")
        self.assertFalse((self.root / "wrong").exists())

    def test_component_runs_in_wasmtime_workcell(self):
        args = struct.pack("<4i", 1, 2, 0, 0)
        invalid = struct.pack("<4i", 1, 2, 4, 0)
        cases = [(args, []), (b"", [args]), (invalid, []), (b"", [b"x"])]
        venv = ROOT.parents[1] / ".tools/venv/bin/python"
        request = [[event.hex(), [item.hex() for item in inputs]] for event, inputs in cases]
        result = subprocess.run(
            [str(venv) if venv.exists() else sys.executable, "-B", "-c", WORKCELL_PROBE,
             str(self.root / "first/kernel.wasm"), json.dumps(request)],
            check=True, capture_output=True, text=True, timeout=120, cwd=ROOT.parents[1])
        low = struct.pack("<i", -2147483648).hex()
        hundred = struct.pack("<i", 100).hex()
        self.assertEqual(json.loads(result.stdout), [[hundred, [], 0], [hundred, [], 16], [low, [], 0], [low, [], 0]])

    def test_p06_frozen_equivalence(self):
        def tool(command):
            return subprocess.run(command, check=True, capture_output=True, text=True, timeout=600)

        jco, asc = os.environ.get("JCO", "jco"), os.environ.get("ASC", "asc")
        self.assertEqual(tool([jco, "--version"]).stdout.strip(), "1.16.1")
        self.assertEqual(tool([asc, "--version"]).stdout.strip(), "Version 0.28.9")
        probe = ROOT.parents[1] / "experiments/P-06-bounded-equivalence"
        tool([jco, "transpile", str(self.root / "first/kernel.wasm"), "-o", str(self.root / "js"),
              "--instantiation", "sync", "--no-typescript"])
        tool([asc, str(probe / "as/convert.ts"), "-O3", "--noAssert", "--runtime", "stub",
              "-o", str(self.root / "as.wasm")])
        run([os.environ.get("RUSTC", "rustc"), "--crate-type", "cdylib", "--target",
             "wasm32-unknown-unknown", "-C", "opt-level=3", str(probe / "rust-faulty/src/lib.rs"),
             "-o", str(self.root / "faulty.wasm")], env=os.environ, cwd=ROOT)
        result = tool(["node", "--max-old-space-size=1024", str(ROOT / "equivalence.mjs"),
                       str(self.root / "js"), str(self.root / "as.wasm"), str(self.root / "faulty.wasm")])
        report = json.loads(result.stdout)
        self.assertEqual(report["equivalence"], dict(inputs=67108864, disagreements=0))
        print(result.stdout.strip(), flush=True)


if __name__ == "__main__":
    unittest.main()
