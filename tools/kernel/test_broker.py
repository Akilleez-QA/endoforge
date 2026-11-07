import unittest
from unittest.mock import patch

from wasmtime import Store
from wasmtime.component import Component

from tools.kernel.broker import Broker, BrokerDenied, DECLARED_IMPORTS, MAX_DENIALS
from tools.kernel.contract import WIT
from tools.kernel.test_workcell import REFERENCE, SCHEMAS, build
from tools.kernel.workcell import Workcell


READ = '(call $read (i32.load (local.get $inputs)) (i64.const 0) (i32.const 1) (i32.const 80))'
SIZE = '(drop (call $size (i32.load (local.get $inputs))))'


class BrokerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.component = build()

    def test_declared_import_runs_and_missing_declaration_rejects_before_compile(self):
        cell = Workcell(self.component, SCHEMAS, declared_imports=DECLARED_IMPORTS)
        result = cell.run(b"\x01", b"\x02", [b"\x03"], max_host_calls=2)
        self.assertEqual(result["state"], b"\x06")
        self.assertEqual(result["broker"], {
            "host_calls": 2, "host_call_limit": 2, "buffer_bytes_read": 1,
            "denial_count": 0, "denials": []})
        for declaration in ((), ("wasi:filesystem/types@0.2.0",), DECLARED_IMPORTS * 2):
            with self.subTest(declaration=declaration):
                with patch("tools.kernel.workcell.Component", wraps=Component) as compile_module:
                    with self.assertRaisesRegex(ValueError, "candidate declaration"):
                        Workcell(self.component, SCHEMAS, declared_imports=declaration)
                    compile_module.assert_not_called()

    def test_undeclared_authority_imports_are_rejected_before_compile(self):
        for name in ("escape-authority", "escape-proto", "network", "fs-read", "spawn"):
            with self.subTest(name=name):
                wit = WIT.replace(b"import buffers;", f"import buffers; import {name}: func();".encode())
                component = build(None, wit)
                with patch("tools.kernel.workcell.Component", wraps=Component) as compile_module:
                    with self.assertRaisesRegex(ValueError, "imports"):
                        Workcell(component, SCHEMAS)
                    compile_module.assert_not_called()

    def test_revoked_between_reads_denies_without_returning_stale_data(self):
        cell = Workcell(build(REFERENCE.replace(READ, READ + READ)), SCHEMAS)
        checked = []
        stores = []

        def authorize(handle, operation):
            checked.append((handle, operation))
            return len(checked) < 3

        def create(engine):
            store = Store(engine)
            stores.append(store)
            return store

        with patch("tools.kernel.workcell.Store", side_effect=create):
            with self.assertRaises(BrokerDenied) as denied:
                cell.run(b"\x01", b"\x02", [b"\x03"], authorize=authorize)
        self.assertEqual(checked, [(0, "size"), (0, "read"), (0, "read")])
        self.assertEqual(denied.exception.report["buffer_bytes_read"], 1)
        self.assertEqual(denied.exception.report["denials"], [
            {"operation": "read", "handle": 0, "reason": "authority-denied"}])
        with self.assertRaises(ValueError):
            stores[0].ptr()
        self.assertEqual(cell.run(b"\x01", b"\x02", [b"\x03"])["state"], b"\x06")

    def test_authority_checker_failure_and_non_true_result_deny_size(self):
        cell = Workcell(self.component, SCHEMAS)

        def unavailable(*args):
            raise RuntimeError("private authority service detail")

        for checker in (unavailable, lambda *_: False, lambda *_: 1):
            with self.subTest(checker=checker), self.assertRaises(BrokerDenied) as denied:
                cell.run(b"\x01", b"\x02", [b"\x03"], authorize=checker)
            report = denied.exception.report
            self.assertEqual(report["buffer_bytes_read"], 0)
            self.assertEqual(report["denials"][0]["operation"], "size")
            self.assertNotIn("private", str(denied.exception))

    def test_size_and_zero_length_read_floods_stop_at_call_limit(self):
        for call in (SIZE, READ.replace('(i32.const 1)', '(i32.const 0)')):
            with self.subTest(call=call):
                wat = REFERENCE.replace(SIZE, '(loop $flood ' + call + ' (br $flood))')
                cell = Workcell(build(wat), SCHEMAS)
                checked = []

                def authorize(handle, operation):
                    checked.append((handle, operation))
                    return True

                with self.assertRaisesRegex(BrokerDenied, "host-call-limit") as denied:
                    cell.run(b"\x01", b"\x02", [b"x"], authorize=authorize, max_host_calls=4)
                report = denied.exception.report
                self.assertEqual(report["host_calls"], 4)
                self.assertEqual(report["buffer_bytes_read"], 0)
                self.assertEqual(report["denial_count"], 1)
                self.assertEqual(len(checked), 4)

    def test_typed_denials_are_bounded_and_report_is_detached(self):
        broker = Broker((b"x",), 1, None, 100)
        self.assertEqual(broker.read(0, 0, 1), b"x")
        self.assertEqual(broker.read(0, 0, 1), "limit-exceeded")
        for _ in range(70):
            self.assertEqual(broker.read(0, 2, 1), "out-of-bounds")
        report = broker.report()
        self.assertEqual(report["denial_count"], 71)
        self.assertEqual(len(report["denials"]), MAX_DENIALS)
        report["denials"][0]["reason"] = "modified"
        self.assertEqual(broker.report()["denials"][0]["reason"], "limit-exceeded")
        with self.assertRaisesRegex(BrokerDenied, "foreign-or-stale-handle"):
            broker.size(1)

    def test_attempt_budgets_reset_and_invalid_policy_is_rejected(self):
        cell = Workcell(self.component, SCHEMAS)
        for _ in range(2):
            with self.assertRaisesRegex(BrokerDenied, "host-call-limit"):
                cell.run(b"\x01", b"\x02", [b"x"], max_host_calls=1)
            self.assertEqual(cell.run(b"\x01", b"\x02", [b"x"], max_host_calls=2)["broker"]["host_calls"], 2)
        for limit in (0, -1, True, 1.5, 4097):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                cell.run(b"\x01", b"\x02", max_host_calls=limit)
        with self.assertRaises(ValueError):
            cell.run(b"\x01", b"\x02", authorize=True)


if __name__ == "__main__":
    unittest.main()
