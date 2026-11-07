import hashlib
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch

from tools.kernel.contract import (
    WIT, check_tool, interface_shape, validate_artifact, validate_component, wasm_tools,
)


class KernelContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        check_tool()
        cls.component = cls.build(WIT)

    @staticmethod
    def build(wit):
        with tempfile.TemporaryDirectory(prefix="ef18-") as directory:
            path = Path(directory) / "kernel.wit"
            path.write_bytes(wit)
            module = wasm_tools("component", "embed", str(path), "--dummy")
            return wasm_tools("component", "new", "-", data=module)

    def test_wit_binary_round_trip(self):
        binary = wasm_tools("component", "wit", "--wasm", data=WIT)
        original = json.loads(wasm_tools("component", "wit", "--json", data=WIT))
        restored = json.loads(wasm_tools("component", "wit", "--json", data=binary))
        self.assertEqual(interface_shape(original), interface_shape(restored))

    def test_static_stub_and_artifact_identity(self):
        record = validate_component(self.component)
        self.assertEqual(record["wit_sha256"], hashlib.sha256(WIT).hexdigest())
        self.assertEqual(record["component_sha256"], hashlib.sha256(self.component).hexdigest())
        self.assertEqual(record["validation"], "static-interface-only")
        self.assertEqual(validate_artifact(record, self.component), record)

    def test_artifact_fields_cannot_be_omitted_changed_or_added(self):
        record = validate_component(self.component)
        for field in record:
            with self.subTest(field=field):
                missing = {key: value for key, value in record.items() if key != field}
                for changed in (missing, {**record, field: "changed"}):
                    with self.assertRaisesRegex(ValueError, "revalidation"):
                        validate_artifact(changed, self.component)
        with self.assertRaisesRegex(ValueError, "revalidation"):
            validate_artifact({**record, "qualified": True}, self.component)

    def test_artifact_identity_binds_bytes_not_only_interface(self):
        changed = self.component + b"\x00\x04\x03tag"
        record = validate_component(self.component)
        self.assertNotEqual(record["id"], validate_component(changed)["id"])
        with self.assertRaisesRegex(ValueError, "revalidation"):
            validate_artifact(record, changed)

    def test_cli_emits_record_only_for_conforming_component(self):
        with tempfile.TemporaryDirectory(prefix="ef18-cli-") as directory:
            path = Path(directory) / "kernel.wasm"
            for data, status in ((self.component, 0), (b"invalid", 1)):
                path.write_bytes(data)
                result = subprocess.run(
                    [sys.executable, "-B", "-m", "tools.kernel.contract", str(path)],
                    capture_output=True, timeout=10,
                )
                self.assertEqual(result.returncode, status)
                if status == 0:
                    self.assertEqual(json.loads(result.stdout), validate_component(data))
                else:
                    self.assertEqual(result.stdout, b"")

    def test_undeclared_capabilities_and_exports_rejected(self):
        changes = (
            (b"import buffers;", b"import buffers; import clock: func() -> u64;", "imports"),
            (b"export reducer;", b"export reducer; export hidden: func();", "exports"),
            (b"describe: func()", b"hidden: func(); describe: func()", "exports"),
            (b"describe: func()", b"docs: func(); describe: func()", "exports"),
            (b"describe: func()", b"type stability = u32; describe: func()", "exports"),
            (b"size: func()", b"write: func(data: list<u8>); size: func()", "imports"),
        )
        for old, new, direction in changes:
            with self.subTest(new=new), self.assertRaisesRegex(ValueError, direction):
                validate_component(self.build(WIT.replace(old, new)))

    def test_types_handles_missing_exports_and_versions_rejected(self):
        changes = (
            (b"event: list<u8>", b"event: string"),
            (b"inputs: list<borrow<buffer>>", b"inputs: list<u32>"),
            (b"borrow<buffer>", b"own<buffer>"),
            (b"describe: func() -> metadata;", b""),
            (b"@1.0.0", b"@2.0.0"),
            (b"@1.0.0", b"@1.0.1"),
        )
        for old, new in changes:
            with self.subTest(new=new), self.assertRaisesRegex(ValueError, "differ"):
                validate_component(self.build(WIT.replace(old, new)))

    def test_malformed_wit_and_invalid_component_rejected(self):
        with self.assertRaises(ValueError):
            wasm_tools("component", "wit", "--json", data=WIT.replace(b"u64", b"pointer"))
        for data in (b"", b"\0asm\1\0\0\0", self.component[:20], WIT, b"x" * (16 * 1024 * 1024 + 1)):
            with self.subTest(size=len(data)), self.assertRaises(ValueError):
                validate_component(data)

    def test_tool_version_and_absence_fail_closed(self):
        with patch("tools.kernel.contract.wasm_tools", return_value=b"wasm-tools 0.0.0"):
            with self.assertRaisesRegex(ValueError, "1.262.0 required"):
                check_tool()
        with patch.dict("os.environ", {"WASM_TOOLS": "/nonexistent/ef18-wasm-tools"}):
            with self.assertRaisesRegex(ValueError, "wasm-tools failed"):
                validate_component(self.component)


if __name__ == "__main__":
    unittest.main()
