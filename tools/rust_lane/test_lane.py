import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools.kernel.contract import validate_artifact
from tools.kernel.journal import DenialJournal
from tools.rust_lane.admit import TASKS, AdmissionRejected, admit, conform, load_task
from tools.rust_lane.build import (ROOT, build, cargo_home, crate_sources, fetch_locked,
                                   prefer_checkout_wasm_tools, run, rust_tool)

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


def node_tool(name, package, *, env_name):
    configured = os.environ.get(env_name)
    if configured:
        return configured
    local = package / "node_modules/.bin" / name
    if local.exists():
        return str(local)
    found = shutil.which(name)
    if found:
        return found
    subprocess.run(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", str(package)],
                   check=True, capture_output=True, text=True, timeout=300)
    return str(local)


class ToolDiscoveryTests(unittest.TestCase):
    def test_cargo_home_defaults_to_user_cache_and_honours_override(self):
        without = {k: v for k, v in os.environ.items() if k != "CARGO_HOME"}
        with patch.dict(os.environ, without, clear=True):
            self.assertEqual(cargo_home(), (Path.home() / ".cargo").resolve())
        with patch.dict(os.environ, {"CARGO_HOME": "/synthetic/cache"}):
            self.assertEqual(cargo_home(), Path("/synthetic/cache").resolve())

    def test_rust_tool_asks_rustup_for_the_pinned_toolchain_binary(self):
        without = {k: v for k, v in os.environ.items() if k != "RUSTC"}
        found = subprocess.CompletedProcess([], 0, stdout="/synthetic/toolchain/bin/rustc\n")
        with patch.dict(os.environ, without, clear=True), \
                patch("tools.rust_lane.build.shutil.which", return_value="/synthetic/rustup"), \
                patch("tools.rust_lane.build.subprocess.run", return_value=found) as asked:
            self.assertEqual(rust_tool("rustc"), Path("/synthetic/toolchain/bin/rustc").resolve())
        self.assertEqual(asked.call_args.args[0],
                         ["/synthetic/rustup", "which", "rustc", "--toolchain", "1.98.1"])

    def test_explicit_rust_tool_is_not_replaced_by_rustup(self):
        with patch.dict(os.environ, {"RUSTC": sys.executable}), \
                patch("tools.rust_lane.build.subprocess.run") as asked:
            self.assertEqual(rust_tool("rustc"), Path(sys.executable).resolve())
        asked.assert_not_called()

    def test_checkout_wasm_tools_used_only_without_override(self):
        without = {k: v for k, v in os.environ.items() if k != "WASM_TOOLS"}
        with tempfile.TemporaryDirectory() as directory:
            local = Path(directory) / ".tools/bin/wasm-tools"
            local.parent.mkdir(parents=True)
            local.touch()
            with patch("tools.rust_lane.build.REPOSITORY", Path(directory)):
                with patch.dict(os.environ, without, clear=True):
                    prefer_checkout_wasm_tools()
                    self.assertEqual(os.environ["WASM_TOOLS"], str(local))
                with patch.dict(os.environ, {"WASM_TOOLS": "/synthetic/wasm-tools"}):
                    prefer_checkout_wasm_tools()
                    self.assertEqual(os.environ["WASM_TOOLS"], "/synthetic/wasm-tools")


class NodeToolTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.package = Path(directory.name)
        self.local = self.package / "node_modules/.bin/jco"
        self.environment = {k: v for k, v in os.environ.items() if k != "JCO"}

    def resolve(self, *, which=None):
        with patch.dict(os.environ, self.environment, clear=True), \
                patch("tools.rust_lane.test_lane.shutil.which", return_value=which), \
                patch("tools.rust_lane.test_lane.subprocess.run") as ran:
            return node_tool("jco", self.package, env_name="JCO"), ran

    def test_explicit_path_wins(self):
        self.environment["JCO"] = "/synthetic/jco"
        found, ran = self.resolve(which="/synthetic/path/jco")
        self.assertEqual(found, "/synthetic/jco")
        ran.assert_not_called()

    def test_checkout_install_beats_path(self):
        self.local.parent.mkdir(parents=True)
        self.local.touch()
        found, ran = self.resolve(which="/synthetic/path/jco")
        self.assertEqual(found, str(self.local))
        ran.assert_not_called()

    def test_path_used_before_any_install(self):
        found, ran = self.resolve(which="/synthetic/path/jco")
        self.assertEqual(found, "/synthetic/path/jco")
        ran.assert_not_called()

    def test_missing_tool_installed_from_the_lockfile_without_scripts(self):
        found, ran = self.resolve()
        self.assertEqual(found, str(self.local))
        self.assertEqual(ran.call_args.args[0][:3], ["npm", "ci", "--ignore-scripts"])
        self.assertEqual(ran.call_args.args[0][-1], str(self.package))


class CrateFetchTests(unittest.TestCase):
    def test_primed_cache_stays_offline(self):
        with patch("tools.rust_lane.build.run", return_value=b"") as ran:
            fetch_locked("/synthetic/cargo", {}, "/synthetic/crate")
        self.assertEqual([call.args[0] for call in ran.call_args_list],
                         [["/synthetic/cargo", "fetch", "--frozen"]])

    def test_empty_cache_fetches_only_what_the_lock_pins(self):
        with patch("tools.rust_lane.build.run", side_effect=[ValueError("offline"), b""]) as ran:
            fetch_locked("/synthetic/cargo", {}, "/synthetic/crate")
        self.assertEqual([call.args[0] for call in ran.call_args_list],
                         [["/synthetic/cargo", "fetch", "--frozen"],
                          ["/synthetic/cargo", "fetch", "--locked"]])

    def test_failed_fetch_is_reported(self):
        with patch("tools.rust_lane.build.run", side_effect=[ValueError("offline"), ValueError("no route")]):
            with self.assertRaisesRegex(ValueError, "no route"):
                fetch_locked("/synthetic/cargo", {}, "/synthetic/crate")


TALLY = ROOT / "kernels/tally"


def crate_copy(directory, source=TALLY, replace=()):
    crate = Path(directory) / "crate"
    shutil.copytree(source, crate, ignore=shutil.ignore_patterns("target", "node_modules", "tasks", "kernels"))
    for name, old, new in replace:
        path = crate / name
        text = path.read_text()
        if old not in text:
            raise AssertionError(f"{old!r} not in {path}")
        path.write_text(text.replace(old, new))
    return crate


class CrateAdmissionShapeTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)

    def test_any_conforming_crate_layout_is_collected(self):
        for crate, library in ((ROOT, "ef24_kernel"), (TALLY, "ef24_tally")):
            name, sources = crate_sources(crate)
            self.assertEqual(name, library)
            self.assertEqual(list(sources)[:3], ["Cargo.toml", "Cargo.lock", "src/lib.rs"])
        crate = crate_copy(self.directory)
        (crate / "src/model.rs").write_text("pub const LIMIT: u64 = 1;\n")
        self.assertIn("src/model.rs", crate_sources(crate)[1])

    def test_crates_outside_the_kernel_contract_are_refused_before_building(self):
        library = crate_copy(self.directory / "rlib", replace=[("Cargo.toml", '"cdylib"', '"rlib"')])
        with self.assertRaisesRegex(ValueError, "cdylib"):
            crate_sources(library)
        local = crate_copy(self.directory / "path", replace=[
            ("Cargo.toml", "[dependencies]\n", '[dependencies]\nlocal = { path = "../local" }\n')])
        with self.assertRaisesRegex(ValueError, "crates.io"):
            crate_sources(local)
        script = crate_copy(self.directory / "script")
        (script / "build.rs").write_text("fn main() {}\n")
        with self.assertRaisesRegex(ValueError, "build script"):
            crate_sources(script)
        unlocked = crate_copy(self.directory / "unlocked")
        (unlocked / "Cargo.lock").unlink()
        with self.assertRaisesRegex(ValueError, "Cargo.lock"):
            crate_sources(unlocked)
        linked = crate_copy(self.directory / "linked")
        (linked / "src/outside.rs").symlink_to(self.directory / "rlib/crate/src/lib.rs")
        with self.assertRaisesRegex(ValueError, "regular files"):
            crate_sources(linked)

    def test_kernel_host_failure_rejects_and_is_journaled(self):
        receipt = {"artifact": {"id": "0" * 64}}
        journal = self.directory / "denials.sqlite"
        with patch("tools.rust_lane.admit.build", return_value=receipt), \
                patch("tools.rust_lane.admit.conform", side_effect=ValueError("kernel host failed: crash")):
            with self.assertRaises(AdmissionRejected) as raised:
                admit(TALLY, TASKS / "tally.json", self.directory / "out", journal)
        self.assertEqual(raised.exception.record["reason"], "kernel-host-failed")
        self.assertEqual([(e["kind"], e["reason"]) for e in DenialJournal(journal).entries()],
                         [("admission", "kernel-host-failed")])

    def test_tasks_are_frozen_and_distinct(self):
        p06, tally = load_task(TASKS / "p06-pressure.json"), load_task(TASKS / "tally.json")
        self.assertNotEqual(p06["schemas"], tally["schemas"])
        self.assertEqual(p06["effects"]["effects"], [])
        self.assertEqual({(e["capability"], e["operation"]) for e in tally["effects"]["effects"]},
                         {("notify", "threshold"), ("audit", "malformed")})


class GeneralizedAdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory(prefix="ef24-admit-")
        cls.addClassCleanup(cls.workspace.cleanup)
        cls.root = Path(cls.workspace.name)
        cls.journal = cls.root / "denials.sqlite"
        cls.p06 = admit(ROOT, TASKS / "p06-pressure.json", cls.root / "p06", cls.journal)
        cls.tally = admit(TALLY, TASKS / "tally.json", cls.root / "tally", cls.journal)
        rogue = crate_copy(cls.root / "rogue", replace=[("src/lib.rs", 'b"threshold"', 'b"broadcast"')])
        try:
            admit(rogue, TASKS / "tally.json", cls.root / "rogue-build", cls.journal)
            cls.rejected = None
        except AdmissionRejected as error:
            cls.rejected = error.record

    def test_two_distinct_tasks_are_built_checked_and_admitted(self):
        for record, name, directory in ((self.p06, "p06-pressure", "p06"), (self.tally, "tally", "tally")):
            task = load_task(TASKS / f"{name}.json")
            with self.subTest(task=name):
                self.assertEqual(record["status"], "admitted")
                self.assertEqual(record["task"], task["id"])
                self.assertEqual(record["cases"], [case["name"] for case in task["cases"]])
                self.assertEqual(record["qualification"], "required")
                validate_artifact(record["artifact"], (self.root / directory / "kernel.wasm").read_bytes())
                self.assertEqual(json.loads((self.root / directory / "admission.json").read_text()), record)
        self.assertNotEqual(self.p06["artifact"]["component_sha256"], self.tally["artifact"]["component_sha256"])
        self.assertNotEqual(self.p06["effect_declaration_sha256"], self.tally["effect_declaration_sha256"])

    def test_undeclared_effect_rejects_admission_with_durable_denials(self):
        self.assertIsNotNone(self.rejected)
        self.assertEqual(self.rejected["reason"], "conformance-failed")
        self.assertEqual(self.rejected["failed_cases"], ["threshold-crossed"])
        self.assertFalse((self.root / "rogue-build/admission.json").exists())
        entries = DenialJournal(self.journal).entries()
        effect = [e for e in entries if e["kind"] == "effect"]
        self.assertEqual([(e["capability"], e["operation"], e["reason"]) for e in effect],
                         [("notify", "broadcast", "undeclared-effect")])
        admission = [e for e in entries if e["kind"] == "admission"]
        self.assertEqual(admission[0]["artifact_id"], effect[0]["artifact_id"])
        self.assertLess(effect[0]["seq"], admission[0]["seq"])

    def test_component_is_checked_against_its_own_task_only(self):
        report = conform(self.root / "p06/kernel.wasm", load_task(TASKS / "tally.json"), self.root / "cross.sqlite")
        self.assertFalse(report["passed"])
        self.assertEqual({row["outcome"] for row in report["cases"]}, {"refused"})

    def test_build_failure_is_journaled(self):
        broken = crate_copy(self.root / "broken", replace=[("src/lib.rs", "fn amounts(", "fn renamed(")])
        journal = self.root / "broken.sqlite"
        with self.assertRaises(AdmissionRejected) as raised:
            admit(broken, TASKS / "tally.json", self.root / "broken-build", journal)
        self.assertEqual(raised.exception.record["reason"], "build-failed")
        self.assertEqual([e["reason"] for e in DenialJournal(journal).entries()], ["build-failed"])


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

        jco = node_tool("jco", ROOT, env_name="JCO")
        asc = node_tool("asc", ROOT, env_name="ASC")
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
