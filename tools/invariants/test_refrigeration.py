from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from . import refrigeration as library
from ..ledger.frozen import snapshot, digest


FOUNDATION = Path(library.units.__file__).resolve().parents[1]
GOLDEN = json.loads((FOUNDATION / "golden/coolprop-8.0.0-points.json").read_text())


def quantity(value, unit):
    return {"value": value, "unit": unit}


def relation(left, right, operation="eq", atmosphere=None):
    claim = dict(left=quantity(*left), right=quantity(*right), relation=operation)
    if left[1] in library.units.PRESSURE_UNITS:
        claim["atmosphere"] = atmosphere
    return claim


def anchors():
    cases = [
        ("pressure_relation", relation((1, "bar(a)"), (100, "kPa(a)"))),
        ("pressure_relation", relation((1, "bar(a)"), (200, "kPa(a)"), "lt")),
        ("pressure_relation", relation((0, "kPa(g)"), (90, "kPa(a)"), atmosphere={
            "basis": "measured", "pressure": quantity(90, "kPa(a)")})),
        ("temperature_relation", relation((32, "degF"), (0, "degC"))),
        ("temperature_relation", relation((-40, "degF"), (-40, "degC"))),
        ("temperature_relation", relation((300, "K"), (0, "degC"), "gt")),
    ]
    for row in GOLDEN["by_temperature"]:
        for side in library.thermo.SIDES:
            cases.append(("saturation_temperature", dict(
                fluid=row["fluid"], side=side, atmosphere=None,
                pressure=quantity(row[side + "_kpa_a"], "kPa(a)"),
                temperature=quantity(row["temperature_c"], "degC"))))
    for row in GOLDEN["by_pressure"]:
        for side in library.thermo.SIDES:
            cases.append(("saturation_temperature", dict(
                fluid=row["fluid"], side=side, atmosphere=None,
                pressure=quantity(row["pressure_kpa_a"], "kPa(a)"),
                temperature=quantity(row[side + "_temperature_c"], "degC"))))
    return cases


class RefrigerationTests(unittest.TestCase):
    def assertVerdict(self, check, claim, passed):
        before = deepcopy(claim)
        result = library.evaluate(check, claim)
        self.assertEqual(result["passed"], passed, (check, claim, result))
        self.assertEqual(claim, before)
        self.assertEqual(result["check"], check)
        self.assertTrue(result["reason"])
        return result

    def test_existing_independent_anchors_and_each_seeded_fault_100_times(self):
        self.assertEqual(GOLDEN["oracle"].split()[1], "8.0.0")
        cases = anchors()
        self.assertEqual(len(cases), 112)
        for check, good in cases:
            bad = deepcopy(good)
            if check == "saturation_temperature":
                bad["temperature"]["value"] += library.thermo.resolve_fluid(good["fluid"]).error_k + 1
            elif good["relation"] == "eq":
                bad["left"]["value"] += 10
            else:
                bad["left"], bad["right"] = bad["right"], bad["left"]
            for claim, passed in ((good, True), (bad, False)):
                with self.subTest(check=check, claim=claim):
                    expected = self.assertVerdict(check, claim, passed)
                    for _ in range(100):
                        self.assertEqual(library.evaluate(check, claim), expected)

    def test_unit_swaps_dimension_mismatch_and_implicit_atmosphere_fail(self):
        pressure = anchors()[2][1]
        faults = [pressure | {"atmosphere": None},
                  pressure | {"atmosphere": {"basis": "standard"}},
                  pressure | {"left": quantity(0, "kPa(a)")},
                  pressure | {"right": quantity(90, "psia")},
                  pressure | {"right": quantity(90, "degC")}]
        for claim in faults:
            self.assertVerdict("pressure_relation", claim, False)
        self.assertVerdict("temperature_relation", relation((32, "degC"), (0, "degF")), False)

    def test_missing_unknown_fields_and_nonfinite_values_fail_closed(self):
        for check, good in (anchors()[0], anchors()[3], anchors()[-1]):
            for field in good:
                bad = deepcopy(good)
                del bad[field]
                self.assertVerdict(check, bad, False)
            self.assertVerdict(check, good | {"tolerance": 1e9}, False)
            for value in (None, [], 0, "claim"):
                self.assertVerdict(check, value, False)
            target = "temperature" if check == "saturation_temperature" else "left"
            for value in (True, "1", float("nan"), float("inf"), -float("inf"), 10**400):
                bad = deepcopy(good)
                bad[target]["value"] = value
                self.assertFalse(library.evaluate(check, bad)["passed"])
        for check in ("unknown", None, []):
            self.assertFalse(library.evaluate(check, {})["passed"])
        self.assertVerdict("pressure_relation", anchors()[0][1] | {"relation": "ne"}, False)

    def test_absolute_zero_pressure_bounds_and_blend_side_refusals(self):
        self.assertVerdict("temperature_relation", relation((0, "K"), (0, "K")), False)
        self.assertVerdict("pressure_relation", relation((-1, "psia"), (-1, "psia")), False)
        check, good = anchors()[-1]
        for change in ({"side": None}, {"side": "liquid"}, {"side": "bubble"},
                       {"fluid": "missing"}, {"pressure": quantity(1, "kPa(a)")}):
            self.assertVerdict(check, good | change, False)
        pure = anchors()[6][1]
        self.assertVerdict(check, pure | {"side": None}, True)

    def test_round_trips_symmetry_and_reversed_order(self):
        for check, good in anchors()[:6]:
            reversed_claim = good | {"left": good["right"], "right": good["left"],
                                     "relation": {"eq": "eq", "lt": "gt", "gt": "lt"}[good["relation"]]}
            self.assertVerdict(check, reversed_claim, True)
        for atmosphere in ({"basis": "standard"}, {"basis": "elevation", "elevation": quantity(1500, "m")}):
            kpa, _, _ = library.units.read_atmosphere(atmosphere)
            for unit in library.units.PRESSURE_UNITS:
                value = library.units.from_absolute_kpa(500, unit, kpa)
                self.assertVerdict("pressure_relation", relation(
                    (500, "kPa(a)"), (value, unit), atmosphere=atmosphere), True)
        for unit in library.units.TEMPERATURE_UNITS:
            value = library.units.from_celsius(-20, unit)
            self.assertVerdict("temperature_relation", relation((-20, "degC"), (value, unit)), True)

    def test_fixed_tolerance_boundary_and_order_dead_band(self):
        epsilon = library.RELATION_TOLERANCE
        self.assertVerdict("temperature_relation", relation((0, "degC"), (epsilon, "degC")), True)
        self.assertVerdict("temperature_relation", relation((0, "degC"), (epsilon * 2, "degC")), False)
        self.assertVerdict("temperature_relation", relation((0, "degC"), (epsilon, "degC"), "lt"), False)
        self.assertVerdict("temperature_relation", relation((0, "degC"), (epsilon * 2, "degC"), "lt"), True)

    def test_gauge_saturation_anchor_and_source_evidence_preserved(self):
        for point in GOLDEN["census_nh3_anchor_points"]:
            good = dict(fluid=point["fluid"], side=None, atmosphere={"basis": "standard"},
                        pressure=quantity(point["pressure_psig_standard_atmosphere"], "psig"),
                        temperature=quantity(point["temperature_f"], "degF"))
            result = self.assertVerdict("saturation_temperature", good, True)
            self.assertEqual(result["measurements"]["evidence"][0]["status"], "CHECK")
            self.assertFalse(result["measurements"]["atmosphere"]["assumed"])
            self.assertVerdict("saturation_temperature", good | {"atmosphere": None}, False)
            self.assertVerdict("saturation_temperature", good | {
                "pressure": quantity(point["pressure_psig_standard_atmosphere"], "psia")}, False)

    def test_version_covers_reused_rules_and_frozen_bundle_identity(self):
        sources = library.SOURCE_HASHES
        self.assertEqual(sources, library._source_hashes())
        for suffix in ("units.py", "thermo.py", "evidence.py", "projection.py",
                       "data/refrigerant-saturation.nh3.json", "invariants/refrigeration.py"):
            self.assertTrue(any(path.endswith(suffix) for path in sources), suffix)
        identity = hashlib.sha256(json.dumps(sources, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        self.assertEqual(library.LIBRARY_VERSION, library.VERSION + ":" + identity)
        root = FOUNDATION / "golden"
        frozen = snapshot(root, {}, "anchor qualification", library.LIBRARY_VERSION)
        self.assertEqual(json.loads(frozen)["invariant_version"], library.LIBRARY_VERSION)
        self.assertNotEqual(digest(frozen), digest(snapshot(root, {}, "anchor qualification", "changed")))


if __name__ == "__main__":
    unittest.main()
