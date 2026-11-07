import json
import subprocess
import sys
import unittest

from tools.kernel.limits import Limits, _watch, run_candidate
from tools.kernel.test_workcell import REFERENCE, SCHEMAS, build
from tools.kernel.workcell import Workcell


class ContainmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.component = build()

    def run_case(self, component, limits=Limits(), outcome="passed"):
        result = run_candidate(component, SCHEMAS, b"\x01", b"\x02", limits=limits)
        self.assertEqual(result["outcome"], outcome, result)
        self.assertTrue(result["group_empty"], result)
        self.assertLess(result["wall_ns"], (limits.wall_seconds + 1) * 1e9)
        self.assertIsNotNone(result["time_to_stop_ns"], result)
        self.assertLess(result["time_to_stop_ns"], limits.wall_seconds * 1e9)
        self.assertLessEqual(result["output_bytes_retained"], limits.output_bytes)
        print(json.dumps({key: value for key, value in result.items() if key != "result"}))
        return result

    def test_success_and_fresh_process_after_failure(self):
        failed = self.run_case(self.component, Limits(fuel=1), "trapped")
        passed = self.run_case(self.component)
        self.assertEqual(passed["result"]["state"], b"\x03")
        self.assertNotEqual(failed["pid"], passed["pid"])

    def test_infinite_loop_and_deep_recursion(self):
        for operation, extra, message in (
                ("(loop $spin (br $spin))", "", "fuel"),
                ("(call $recurse)", "(func $recurse (call $recurse))", "call stack exhausted")):
            wat = REFERENCE.replace("(global.set $calls", operation + " (global.set $calls")
            wat = wat.replace('(global $calls', extra + ' (global $calls')
            result = self.run_case(build(wat), Limits(fuel=10000000), "trapped")
            self.assertIn(message, result["error"])
            self.assertNotIn("result", result)

    def test_allocation_bomb_and_memory_boundary(self):
        grow = '(if (i32.eq (memory.grow (i32.const 1)) (i32.const -1)) (then unreachable))'
        component = build(REFERENCE.replace("(global.set $calls", grow + " (global.set $calls"))
        self.run_case(component, Limits(memory_bytes=65536), "trapped")
        self.run_case(component, Limits(memory_bytes=131072))
        bomb = REFERENCE.replace("(global.set $calls",
                                 '(loop $alloc ' + grow + ' (br $alloc)) (global.set $calls')
        self.run_case(build(bomb), Limits(memory_bytes=131072), "trapped")
        initial = REFERENCE.replace('(export "cm32p2_memory") 1', '(export "cm32p2_memory") 2')
        result = self.run_case(build(initial), Limits(memory_bytes=65536), "trapped")
        self.assertIn("memory", result["error"])

    def test_output_flood_reaches_transport_cap_before_deadline(self):
        wat = REFERENCE.replace('(i32.store (i32.const 4) (i32.const 1))',
                                '(i32.store (i32.const 4) (i32.const 4096))')
        component = build(wat)
        result = self.run_case(component, Limits(output_bytes=1024), "output_limit")
        self.assertEqual(result["output_bytes_retained"], 1024)
        self.assertEqual(result["output_bytes_observed"], 1025)
        self.assertIsNotNone(result["time_to_kill_ns"])
        self.assertNotIn("result", result)
        passed = self.run_case(component, Limits(output_bytes=16384))
        self.assertEqual(len(passed["result"]["state"]), 4096)

    def test_watchdog_stops_unresponsive_host_even_with_closed_pipes(self):
        for close in ("", "os.close(1); os.close(2);"):
            code = ('import json, os, time; '
                    'print(json.dumps({"execution_started_ns": time.monotonic_ns()}), flush=True); '
                    + close + 'time.sleep(60)')
            result = _watch([sys.executable, "-c", code], subprocess.DEVNULL,
                            Limits(wall_seconds=0.2))
            self.assertEqual(result["outcome"], "timeout", result)
            self.assertTrue(result["group_empty"])
            self.assertLess(result["time_to_kill_ns"], 1e9)
            self.assertLess(result["wall_ns"], 1.2e9)
            self.assertIsNotNone(result["time_to_stop_ns"])

    def test_combined_transport_cap_and_exact_boundary(self):
        for count, outcome in ((1024, "host_failed"), (1025, "output_limit")):
            code = f'import os; os.write(1, b"x" * 512); os.write(2, b"y" * {count - 512})'
            result = _watch([sys.executable, "-c", code], subprocess.DEVNULL,
                            Limits(output_bytes=1024))
            self.assertEqual(result["outcome"], outcome)
            self.assertTrue(result["group_empty"])
            self.assertEqual(result["output_bytes_retained"], 1024)

    def test_invalid_limits_refused_before_launch(self):
        for name, value in (("fuel", 0), ("fuel", True), ("memory_bytes", 65535),
                            ("memory_bytes", 16777217), ("output_bytes", 0),
                            ("wall_seconds", float("nan")), ("wall_seconds", float("inf")),
                            ("wall_seconds", True), ("wall_seconds", 0), ("wall_seconds", 61)):
            with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                Limits(**{name: value})
        cell = Workcell(self.component, SCHEMAS)
        with self.assertRaises(ValueError):
            cell.run(b"\x01", b"\x02", memory_bytes=True)

    def test_invalid_component_and_incomplete_host_protocol_fail_closed(self):
        result = run_candidate(b"invalid!", SCHEMAS, b"", b"")
        self.assertEqual(result["outcome"], "host_failed")
        self.assertIsNone(result["time_to_stop_ns"])
        self.assertTrue(result["group_empty"])
        for header, exit_code in ((None, 0), ("now", 1)):
            code = ('import json, time; '
                    f'print(json.dumps({{"execution_started_ns": {"time.monotonic_ns()" if header else "None"}}})); '
                    'print(json.dumps({"outcome": "passed", "result": {}})); '
                    f'raise SystemExit({exit_code})')
            receipt = _watch([sys.executable, "-c", code], subprocess.DEVNULL, Limits())
            self.assertEqual(receipt["outcome"], "host_failed")
            self.assertNotIn("result", receipt)
            self.assertTrue(receipt["group_empty"])


if __name__ == "__main__":
    unittest.main()
