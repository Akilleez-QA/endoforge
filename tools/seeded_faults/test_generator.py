import hashlib
import unittest
from pathlib import Path

from . import generator as g


def anchor(value):
    return dict(left={"value": value["left"], "unit": "bar"},
                right={"value": value["right"], "unit": "kPa"},
                difference=value["left"] - value["right"],
                rows=list(value["rows"]), binding=value["binding"])


INPUTS = [dict(left=4, right=4, rows=[], binding="revision-1"),
          dict(left=7, right=3, rows=["a", "b"], binding="revision-2")]
FAULTS = [
    dict(family="swapped_units", path=["left", "unit"], other=["right", "unit"]),
    dict(family="dropped_rows", path=["rows"], index=0),
    dict(family="off_by_one", path=["difference"], delta=1),
    dict(family="reversed_inputs", path=["left"], other=["right"]),
    dict(family="stale_binding", path=["binding"], stale="revision-1"),
]


def generate(**changes):
    arguments = dict(known_good=anchor, anchor_id="control-anchor-v1", inputs=INPUTS,
                     faults=FAULTS, seed=17)
    return g.generate(**(arguments | changes))


class GeneratorTests(unittest.TestCase):
    def test_all_families_have_exact_replayable_witnesses(self):
        result = generate()
        self.assertEqual(len(result["faults"]), 5)
        self.assertEqual(result["filtered"], [])
        by_family = {row["fault"]["family"]: row for row in result["faults"]}
        for family, row in by_family.items():
            witness = row["witness"]
            value = INPUTS[witness["input_index"]]
            self.assertEqual(witness["input"], value)
            self.assertEqual(witness["expected"], anchor(value))
            self.assertEqual(witness["actual"], g.run_candidate(anchor, row["fault"], value))
            self.assertNotEqual(witness["expected"], witness["actual"])
            if family in ("dropped_rows", "stale_binding"):
                self.assertEqual(witness["input_index"], 1)
        self.assertEqual(by_family["swapped_units"]["witness"]["actual"]["left"]["unit"], "kPa")
        self.assertEqual(by_family["dropped_rows"]["witness"]["actual"]["rows"], ["b"])
        self.assertEqual(by_family["off_by_one"]["witness"]["actual"]["difference"], 1)
        self.assertEqual(by_family["stale_binding"]["witness"]["actual"]["binding"], "revision-1")
        difference_only = lambda value: value["left"] - value["right"]
        self.assertEqual(g.run_candidate(difference_only, FAULTS[3], INPUTS[1]), -4)

    def test_equivalent_fraction_and_later_input_separate_mutants(self):
        result = generate(inputs=INPUTS[:1])
        self.assertEqual(result["strata"]["S2"], dict(
            proposed=5, emitted=2, equivalent=3, equivalent_fraction=3 / 5))
        self.assertTrue(all(row["reason"] == "equivalent_on_extended_set"
                            for row in result["filtered"]))
        self.assertEqual(generate()["strata"]["S2"]["equivalent_fraction"], 0)

    def test_commutative_reversal_equal_units_and_absent_rows_are_filtered(self):
        commutative = lambda value: value["left"] + value["right"]
        self.assertEqual(generate(known_good=commutative, faults=[FAULTS[3]])["faults"], [])
        same_units = lambda value: {"left": {"unit": "bar"}, "right": {"unit": "bar"}}
        self.assertEqual(generate(known_good=same_units, faults=[FAULTS[0]])["faults"], [])
        result = generate(faults=[FAULTS[1] | {"index": 20}])
        self.assertEqual(result["strata"]["S2"]["equivalent_fraction"], 1)

    def test_repeated_seed_is_byte_identical_and_order_independent(self):
        expected = g.canonical(generate())
        for _ in range(100):
            self.assertEqual(g.canonical(generate(faults=list(reversed(FAULTS)))), expected)
        self.assertNotEqual(generate(seed=18), generate())
        self.assertEqual(g.GENERATOR_DIGEST, hashlib.sha256(Path(g.__file__).read_bytes()).hexdigest())
        for changes in ({"anchor_id": "other-anchor"}, {"inputs": list(reversed(INPUTS))}):
            self.assertNotEqual(generate(**changes)["faults"][0]["id"], generate()["faults"][0]["id"])

    def test_caller_inputs_descriptors_and_shared_outputs_are_isolated(self):
        before = g.canonical([INPUTS, FAULTS])
        shared = anchor(INPUTS[1])
        expected = g.clone(shared)
        generate(known_good=lambda value: shared)
        self.assertEqual(shared, expected)
        generate()
        self.assertEqual(g.canonical([INPUTS, FAULTS]), before)
        def mutating_anchor(value):
            value["rows"].append("owned")
            return anchor(value)
        generate(known_good=mutating_anchor)
        self.assertEqual(g.canonical([INPUTS, FAULTS]), before)

    def test_empty_duplicate_oversized_or_invalid_requests_fail(self):
        for changes in ({"inputs": []}, {"faults": []}, {"inputs": {}}, {"seed": True},
                        {"anchor_id": ""}, {"faults": FAULTS * 2}, {"inputs": INPUTS * 5000}):
            with self.subTest(changes=list(changes)), self.assertRaises(ValueError):
                generate(**changes)

    def test_invalid_fault_fields_paths_and_types_fail(self):
        invalid = [FAULTS[0] | {"other": ["left"]}, FAULTS[0] | {"path": []},
                   FAULTS[0] | {"other": ["left", "unit"]},
                   FAULTS[1] | {"index": -1}, FAULTS[1] | {"index": True},
                   FAULTS[2] | {"delta": 2}, FAULTS[2] | {"delta": True},
                   FAULTS[4] | {"stale": ""}, FAULTS[4] | {"unexpected": 1},
                   FAULTS[2] | {"path": ["missing"]}, FAULTS[2] | {"path": ["rows", -1]},
                   FAULTS[2] | {"path": ["rows", True]}, FAULTS[2] | {"path": ["binding"]},
                   FAULTS[1] | {"path": ["difference"]}, FAULTS[0] | {"path": ["difference"]},
                   FAULTS[4] | {"path": ["difference"]}, {"family": "unknown"}]
        for spec in invalid:
            with self.subTest(spec=spec), self.assertRaises(ValueError):
                generate(faults=[spec])

    def test_negative_delta_and_nested_array_target(self):
        spec = dict(family="off_by_one", path=["rows", 1], delta=-1)
        self.assertEqual(g.run_candidate(lambda value: value, spec, {"rows": [4, 9]}), {"rows": [4, 8]})

    def test_exceptions_non_json_and_nondeterminism_abort(self):
        def crash(value):
            raise RuntimeError("anchor failed")
        with self.assertRaisesRegex(RuntimeError, "anchor failed"):
            generate(known_good=crash)
        for value in (float("nan"), float("inf"), {1: "key"}, (1, 2)):
            with self.subTest(value=value), self.assertRaises(ValueError):
                generate(known_good=lambda _: value)
        calls = []
        def unstable(value):
            calls.append(value)
            return len(calls)
        with self.assertRaisesRegex(ValueError, "known-good.*nondeterministic"):
            generate(known_good=unstable)
        def unstable_when_reversed(value):
            if value["left"] == 3:
                calls.append(value)
                return len(calls)
            return 0
        with self.assertRaisesRegex(ValueError, "mutant.*nondeterministic"):
            generate(known_good=unstable_when_reversed, faults=[FAULTS[3]])


if __name__ == "__main__":
    unittest.main()
