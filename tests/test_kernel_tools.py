import contextlib
import hashlib
import io
import os
import re
import tarfile
import tempfile
import unittest
from importlib.metadata import PackageNotFoundError
from pathlib import Path
from unittest.mock import patch

from tools.kernel import install_tools
from tools.kernel.contract import TOOL_VERSION


ROOT = Path(__file__).resolve().parents[1]


def archive(path, members):
    with tarfile.open(path, "w:gz") as bundle:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o755
            bundle.addfile(info, io.BytesIO(data))
    return hashlib.sha256(path.read_bytes()).hexdigest()


class KernelToolsTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.work = Path(directory.name)
        self.tools = self.work / ".tools"

    def test_pins_match_the_code_and_ci_uses_make_tools(self):
        workcell = (ROOT / "tools/kernel/workcell.py").read_text()
        runtime = re.search(r'RUNTIME_VERSION = "([^"]+)"', workcell).group(1)
        self.assertEqual(install_tools.WASMTIME_VERSION, runtime)
        self.assertEqual(install_tools.WASM_TOOLS_VERSION, TOOL_VERSION)
        requirements = (ROOT / "tools/kernel/requirements.txt").read_text()
        self.assertIn(f"wasmtime=={runtime}", requirements)
        self.assertGreaterEqual(requirements.count("--hash=sha256:"), 1)
        ci = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertIn("make tools", ci)
        self.assertNotIn("655b8df6", ci)

    def test_check_names_make_tools_when_missing(self):
        output = io.StringIO()
        with patch.object(install_tools, "version", side_effect=PackageNotFoundError("wasmtime")), \
                patch.dict(os.environ, {"WASM_TOOLS": "/nonexistent/f2-wasm-tools"}), \
                contextlib.redirect_stderr(output):
            failed = install_tools.check()
        self.assertTrue(failed)
        message = output.getvalue()
        self.assertIn("make tools", message)
        self.assertIn("wasmtime 49.0.0", message)
        self.assertIn("wasm-tools 1.262.0", message)

    def test_check_rejects_wrong_versions(self):
        output = io.StringIO()
        with patch.object(install_tools, "version", return_value="48.0.0"), \
                patch.object(install_tools, "wasm_tools_version", return_value="wasm-tools 1.0.0"), \
                contextlib.redirect_stderr(output):
            self.assertTrue(install_tools.check())
        self.assertIn("found wasmtime 48.0.0", output.getvalue())
        self.assertIn("found wasm-tools 1.0.0", output.getvalue())

    def test_check_passes_with_pinned_versions(self):
        with patch.object(install_tools, "version", return_value="49.0.0"), \
                patch.object(install_tools, "wasm_tools_version", return_value="wasm-tools 1.262.0 (abc 2026-01-01)"):
            self.assertFalse(install_tools.check())

    def fake_release(self, members):
        source = self.work / "release.tar.gz"
        digest = archive(source, members)

        def download(url, destination):
            destination.write_bytes(source.read_bytes())

        return digest, download

    def test_wasm_tools_hash_mismatch_installs_nothing(self):
        stem = "wasm-tools-1.262.0-x86_64-linux"
        _, download = self.fake_release({f"{stem}/wasm-tools": b"#!/bin/sh\n"})
        with patch.object(install_tools, "download", download), \
                patch.object(install_tools, "platform_key", return_value=("Linux", "x86_64")):
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                install_tools.install_wasm_tools(self.tools)
        self.assertFalse((self.tools / "bin/wasm-tools").exists())
        self.assertEqual(list((self.tools / "dl").iterdir()), [])

    def test_wasm_tools_extracts_only_the_binary(self):
        stem = "wasm-tools-1.262.0-x86_64-linux"
        digest, download = self.fake_release({
            f"{stem}/wasm-tools": b"#!/bin/sh\necho wasm-tools 1.262.0\n",
            f"{stem}/README.md": b"readme",
            "../escape": b"bad",
        })
        archives = {("Linux", "x86_64"): ("x86_64-linux", digest)}
        with patch.object(install_tools, "download", download), \
                patch.object(install_tools, "WASM_TOOLS_ARCHIVES", archives), \
                patch.object(install_tools, "platform_key", return_value=("Linux", "x86_64")):
            binary = install_tools.install_wasm_tools(self.tools)
        self.assertEqual(binary, self.tools / "bin/wasm-tools")
        self.assertEqual(sorted(p.name for p in (self.tools / "bin").iterdir()), ["wasm-tools"])
        self.assertTrue(os.access(binary, os.X_OK))
        self.assertFalse((self.work / "escape").exists())

    def test_unsupported_platform_is_named(self):
        with patch.object(install_tools, "platform_key", return_value=("Darwin", "arm64")):
            with self.assertRaisesRegex(ValueError, "no pinned wasm-tools 1.262.0 archive for Darwin arm64"):
                install_tools.install_wasm_tools(self.tools)


if __name__ == "__main__":
    unittest.main()
