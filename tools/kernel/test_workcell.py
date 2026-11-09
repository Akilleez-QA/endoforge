from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from wasmtime import Store, WasmtimeError
from wasmtime.component import Component

from tools.kernel.contract import WIT, wasm_tools
from tools.kernel.workcell import MAX_INPUT, Workcell


SCHEMAS = ("test:byte", "test:byte", "test:none")
REFERENCE = Path(__file__).with_name("reference.wat").read_text()


def build(wat=REFERENCE, wit=WIT):
    with tempfile.TemporaryDirectory(prefix="ef19-") as directory:
        path = Path(directory) / "kernel.wit"
        path.write_bytes(wit)
        module = wasm_tools("component", "embed", str(path), "--dummy" if wat is None else "-",
                            data=None if wat is None else wat.encode())
        return wasm_tools("component", "new", "-", data=module)


class WorkcellTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.component = build()

    def test_compile_once_and_fresh_state_for_1000_attempts(self):
        stores = []

        def create(engine):
            store = Store(engine)
            stores.append(store)
            return store

        with patch("tools.kernel.workcell.Component", wraps=Component) as compile_module:
            cell = Workcell(self.component, SCHEMAS)
            with patch("tools.kernel.workcell.Store", side_effect=create):
                for _ in range(1000):
                    result = cell.run(b"\x02", b"\x03", [b"\x04"])
                    self.assertEqual(result["state"], b"\x09")
                    self.assertEqual(result["effects"], [])
                    self.assertEqual(result["artifact_id"], cell.artifact["id"])
                    self.assertGreater(result["fuel_consumed"], 0)
                    self.assertGreater(result["instantiate_ns"], 0)
            self.assertEqual(compile_module.call_count, 1)
            self.assertEqual(cell.compile_count, 1)
        self.assertEqual(len({id(s) for s in stores}), 1000)
        for store in stores:
            with self.assertRaises(ValueError):
                store.ptr()

    def test_only_explicit_state_and_current_buffer_carry_forward(self):
        cell = Workcell(self.component, SCHEMAS)
        first = cell.run(b"\x01", b"\x02", [b"\x03"])
        self.assertEqual(cell.run(first["state"], b"\x02", [b"\x04"])["state"], b"\x0c")
        self.assertEqual(cell.run(b"\x01", b"\x02")["state"], b"\x03")

    def test_buffer_range_errors_and_overflow_are_typed(self):
        for wat, inputs in ((REFERENCE, [b""]),
                            (REFERENCE.replace("(i64.const 0)", "(i64.const -1)"), [b"x"])):
            result = Workcell(build(wat), SCHEMAS).run(b"\x01", b"\x02", inputs)
            self.assertEqual(result["state"], b"\x03")
            self.assertEqual(result["buffer_bytes_read"], 0)

    def test_trap_and_fuel_failure_dispose_store_and_allow_next_attempt(self):
        cell = Workcell(self.component, SCHEMAS)
        stores = []

        def create(engine):
            store = Store(engine)
            stores.append(store)
            return store

        with patch("tools.kernel.workcell.Store", side_effect=create):
            for state, fuel in ((b"", 100000), (b"\x01", 1)):
                with self.assertRaises(WasmtimeError):
                    cell.run(state, b"\x02", [b"x"], fuel=fuel)
        for store in stores:
            with self.assertRaises(ValueError):
                store.ptr()
        self.assertEqual(cell.run(b"\x01", b"\x02")["state"], b"\x03")

    def test_loop_is_stopped_by_fuel(self):
        wat = REFERENCE.replace("(global.set $calls", "(loop $spin (br $spin)) (global.set $calls")
        with self.assertRaisesRegex(WasmtimeError, "fuel"):
            Workcell(build(wat), SCHEMAS).run(b"\x00", b"\x00", fuel=1000)

    def test_buffer_read_budget_and_forged_handle(self):
        read = '(call $read (i32.load (local.get $inputs)) (i64.const 0) (i32.const 1) (i32.const 80))'
        repeated = '(local.set $en (i32.const 33)) (loop $reads ' + read.replace(
            '(i32.const 1)', '(i32.const 32768)') + '''
            (local.set $en (i32.sub (local.get $en) (i32.const 1)))
            (br_if $reads (local.get $en)))'''
        wat = REFERENCE.replace(read, repeated).replace(
            '(export "cm32p2_memory") 1', '(export "cm32p2_memory") 32')
        result = Workcell(build(wat), SCHEMAS).run(b"\x01", b"\x02", [b"x" * 32768])
        self.assertEqual(result["state"], b"\x03")
        self.assertEqual(result["buffer_bytes_read"], MAX_INPUT)
        forged = REFERENCE.replace('(call $size (i32.load (local.get $inputs)))',
                                   '(call $size (i32.const 9999))')
        with self.assertRaises(WasmtimeError):
            Workcell(build(forged), SCHEMAS).run(b"\x01", b"\x02", [b"x"])

    def test_effects_are_returned_as_data(self):
        stores = ''.join(f'(i32.store (i32.const {p}) (i32.const {v}))' for p, v in
                         ((192, 320), (196, 4), (200, 324), (204, 4), (208, 328), (212, 1)))
        wat = REFERENCE.replace('(data (i32.const 256)', '(data (i32.const 320) "demoemit!") (data (i32.const 256)')
        wat = wat.replace('(i32.store (i32.const 8) (i32.const 0))', stores +
                          '(i32.store (i32.const 8) (i32.const 192))').replace(
                              '(i32.store (i32.const 12) (i32.const 0))',
                              '(i32.store (i32.const 12) (i32.const 1))')
        result = Workcell(build(wat), SCHEMAS).run(b"\x01", b"\x02")
        self.assertEqual(result["effects"], [{"capability": "demo", "operation": "emit", "payload": b"!"}])

    def test_memory_ceiling_is_enforced_at_instantiation(self):
        wat = REFERENCE.replace('(export "cm32p2_memory") 1', '(export "cm32p2_memory") 257')
        with self.assertRaisesRegex(WasmtimeError, "memory"):
            Workcell(build(wat), SCHEMAS).run(b"\x00", b"\x00")

    def test_guest_table_beside_import_shim_is_admitted_and_ceiling_holds(self):
        def with_tables(count):
            return REFERENCE.replace('(global $heap', '(table 1 funcref) ' * count + '(global $heap', 1)

        result = Workcell(build(with_tables(1)), SCHEMAS).run(b"\x01", b"\x02", [b"\x03"])
        self.assertEqual(result["state"], b"\x06")
        with self.assertRaisesRegex(WasmtimeError, "table"):
            Workcell(build(with_tables(2)), SCHEMAS).run(b"\x01", b"\x02", [b"\x03"])

    def test_metadata_runtime_and_input_admission(self):
        with patch("tools.kernel.workcell.version", return_value="0.0.0"):
            with self.assertRaisesRegex(ValueError, "49.0.0"):
                Workcell(self.component, SCHEMAS)
        cell = Workcell(self.component, ("different", *SCHEMAS[1:]))
        with self.assertRaisesRegex(ValueError, "metadata"):
            cell.run(b"\x00", b"\x00")
        for state, inputs, fuel in ((bytearray(1), (), 1), (b"", [b""] * 65, 1),
                                    (b"x" * (MAX_INPUT + 1), (), 1), (b"", (), 0)):
            with self.subTest(fuel=fuel), self.assertRaises(ValueError):
                cell.run(state, b"", inputs, fuel=fuel)

    def test_static_contract_and_cache_identity_bind_exact_bytes(self):
        cell = Workcell(self.component, SCHEMAS)
        changed = Workcell(self.component + b"\x00\x04\x03tag", SCHEMAS)
        self.assertNotEqual(cell.cache_key, changed.cache_key)
        bad = build(None, WIT.replace(b"import buffers;", b"import buffers; import clock: func();"))
        with patch("tools.kernel.workcell.Component", wraps=Component) as compile_module:
            with self.assertRaisesRegex(ValueError, "imports"):
                Workcell(bad, SCHEMAS)
            compile_module.assert_not_called()


if __name__ == "__main__":
    unittest.main()
