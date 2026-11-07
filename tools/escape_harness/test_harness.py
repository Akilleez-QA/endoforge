import json
import unittest
from pathlib import Path

from ..seeded_faults.generator import canonical, run_candidate
from ..seeded_faults.test_generator import anchor, INPUTS, FAULTS
from .harness import run, seeded
from .stats import bounds


DIGEST = "a" * 64
CHECKS = ["universal", "invariants", "residual"]
PROBE = Path(__file__).resolve().parents[2] / "experiments/P-03-escape-rate-method/receipt"


def candidate(identity, domain="toy"):
    return dict(id=str(identity), domain=domain, task="task-1", stratum="S2")


def verdict(passed=True, promoted=None):
    return dict(results=[dict(check=check, passed=passed if check == "residual" else True)
                         for check in CHECKS], promoted=passed if promoted is None else promoted)


def campaign(candidates, evaluate=lambda _: verdict(), **changes):
    arguments = dict(frozen_digest=DIGEST, current_digest=lambda: DIGEST, checks=CHECKS,
                     lane="interim", candidate_format="python-json-wrapper", seed=17)
    return run(candidates, evaluate, **(arguments | changes))


class EscapeTests(unittest.TestCase):
    def test_p03_fixture_counts_attribution_and_exact_bounds(self):
        source = [json.loads(line) for line in (PROBE / "harness.jsonl").read_text().splitlines()]
        indexed = {row["id"]: row for row in source}
        def evaluate(item):
            row = indexed[item["id"]]
            return dict(results=[dict(check=name, passed=row[name]["pass"]) for name in CHECKS],
                        promoted=row["escape_full"])
        candidates = [candidate(row["id"], "post-hoc" if row["stratum"] == "S4b" else "toy")
                      | {"stratum": "S4" if row["stratum"] == "S4b" else row["stratum"]} for row in source]
        domains = campaign(candidates, evaluate)["domains"]
        report = domains["toy"]
        self.assertEqual((domains["post-hoc"]["n"], domains["post-hoc"]["escapes"]), (52, 0))
        summary = json.loads((PROBE / "summary.json").read_text())
        for stratum, expected in summary["per_stratum"].items():
            measured = ({"ALL": report, "S4b_post_hoc": domains["post-hoc"]}
                        | report["strata"])[stratum]
            expected = expected["full_harness"]
            for key in ("n", "escapes", "point"):
                self.assertEqual(measured[key], expected[key])
            for ours, theirs in (("upper", "one_sided_upper95"),
                                 ("cp_lower", "cp95_lower"), ("cp_upper", "cp95_upper")):
                self.assertAlmostEqual(measured[ours], expected[theirs], places=10)
        self.assertEqual(report["caught_by"], dict(universal=119, invariants=127, residual=67))

    def test_certification_sample_sizes_and_kill_threshold(self):
        for k, n in ((0, 2995), (1, 4742), (2, 6294)):
            self.assertLess(bounds(k, n)["upper"], .001)
            self.assertGreater(bounds(k, n - 1)["upper"], .001)
        self.assertLess(bounds(11, 6294)["lower"], .001)
        self.assertGreater(bounds(12, 6294)["lower"], .001)
        self.assertAlmostEqual(bounds(0, 1000)["upper"], 1 - .05 ** .001, places=12)

    def test_bound_edges_and_invalid_inputs(self):
        self.assertTrue(all(value is None for value in bounds(0, 0).values()))
        self.assertEqual(bounds(0, 1)["lower"], 0)
        self.assertEqual(bounds(1, 1)["upper"], 1)
        for args in ((-1, 1), (2, 1), (True, 1), (0, -1), (0, 1.5), (0, 1, 1), (0, 1, float("nan"))):
            with self.assertRaises(ValueError):
                bounds(*args)

    def test_five_planted_escapes_and_reproducible_random_order(self):
        items = [candidate(i) for i in range(1000)]
        evaluate = lambda row: verdict(int(row["id"]) < 5)
        result = campaign(items, evaluate)
        self.assertEqual((result["domains"]["toy"]["n"], result["domains"]["toy"]["escapes"]), (1000, 5))
        self.assertEqual(canonical(result), canonical(campaign(items, evaluate)))
        order = [row["candidate"]["id"] for row in result["receipts"]]
        self.assertNotEqual(order, [row["id"] for row in items])
        self.assertNotEqual(result["receipts"], campaign(items, evaluate, seed=18)["receipts"])
        for row in result["receipts"]:
            self.assertEqual((row["lane"], row["candidate_format"]), ("interim", "python-json-wrapper"))
            if row["promoted"]:
                self.assertEqual([check["check"] for check in row["results"] if check["passed"]], CHECKS)

    def test_ef10_interface_replays_all_families(self):
        items = seeded(anchor, domain="refrigeration", task="task-1", anchor_id="anchor-v1",
                       inputs=INPUTS, faults=FAULTS, seed=17)
        def evaluate(row):
            witness = row["witness"]
            self.assertEqual(run_candidate(anchor, row["fault"], witness["input"]), witness["actual"])
            self.assertNotEqual(anchor(witness["input"]), witness["actual"])
            return verdict(False)
        result = campaign(items, evaluate)
        self.assertEqual(result["domains"]["refrigeration"]["n"], 5)
        self.assertEqual(result["domains"]["refrigeration"]["escapes"], 0)
        self.assertEqual(len({row["fault"]["family"] for row in items}), 5)

    def test_adaptive_search_widths_oracle_separation_and_nonfault_denominator(self):
        for width in (1, 4, 16):
            seen = []
            def propose(generation, requested, history):
                self.assertEqual(requested, width)
                self.assertEqual(len(history), 1 + width * (generation - 1))
                self.assertTrue(all(set(row) == {"candidate", "results", "promoted"} for row in history))
                seen.append(history[-1]["promoted"])
                return [candidate(f"{generation}-{i}", "searched") for i in range(width)]
            result = campaign([candidate("seed")], propose=propose, width=width, rounds=2,
                              oracle=lambda row: row["id"].startswith("1-"))
            report = result["domains"]["searched"]
            self.assertEqual((report["n"], report["escapes"], report["promotions"]), (width, width, 2 * width))
            self.assertEqual(set(report["strata"]), {"S4"})
            self.assertEqual(seen, [True, True])
            self.assertEqual(result["domains"]["toy"]["n"], 1)

    def test_freeze_changes_before_during_and_after_callbacks_fail_closed(self):
        for stage in ("before", "evaluate", "propose", "oracle"):
            current = ["b" * 64 if stage == "before" else DIGEST]
            def callback(name, value):
                if stage == name:
                    current[0] = "b" * 64
                return value
            with self.subTest(stage=stage), self.assertRaisesRegex(ValueError, "digest changed"):
                campaign([candidate("seed")], lambda _: callback("evaluate", verdict()),
                         current_digest=lambda: current[0], rounds=1,
                         propose=lambda *args: callback("propose", [candidate("searched")]),
                         oracle=lambda _: callback("oracle", True))

    def test_incomplete_malformed_or_inconsistent_evidence_fails(self):
        invalid = [{}, verdict() | {"results": []}, verdict() | {"promoted": 1},
                   verdict() | {"results": verdict()["results"][:-1]},
                   verdict() | {"results": list(reversed(verdict()["results"]))}, verdict(False, True)]
        for outcome in invalid:
            with self.subTest(outcome=outcome), self.assertRaises(ValueError):
                campaign([candidate(1)], lambda _: outcome)
        self.assertEqual(campaign([candidate(1)], lambda _: verdict(True, False))["domains"]["toy"]["escapes"], 0)

    def test_budget_duplicates_and_unknown_oracle_abort(self):
        for changes in ({"width": 2}, {"seed": True}, {"checks": []}, {"lane": ""},
                        {"rounds": 100001}, {"propose": lambda *args: [], "rounds": 1},
                        {"propose": lambda *args: [], "oracle": lambda _: True, "rounds": 1},
                        {"propose": lambda *args: [candidate(2)], "oracle": lambda _: None, "rounds": 1}):
            with self.subTest(changes=list(changes)), self.assertRaises(ValueError):
                campaign([candidate(1)], **changes)
        with self.assertRaisesRegex(ValueError, "duplicate"):
            campaign([candidate(1), candidate(1)])

    def test_callback_mutations_do_not_rewrite_evidence(self):
        original = [candidate("seed")]
        def evaluate(row):
            row["id"] = "changed"
            return verdict()
        def propose(generation, width, history):
            history[0]["candidate"]["id"] = "also-changed"
            history[0]["results"].clear()
            return [candidate("searched")]
        def oracle(row):
            row.clear()
            return True
        result = campaign(original, evaluate, propose=propose, oracle=oracle, rounds=1)
        self.assertEqual(original, [candidate("seed")])
        self.assertEqual([row["candidate"]["id"] for row in result["receipts"]], ["seed", "searched"])
        self.assertEqual(len(result["receipts"][0]["results"]), 3)

    def test_failed_prefix_counts_and_callback_exceptions_abort(self):
        result = campaign([candidate(1)], lambda _: dict(
            results=[dict(check="universal", passed=False)], promoted=False))
        self.assertEqual(result["domains"]["toy"]["caught_by"], {"universal": 1})
        def crash(_):
            raise RuntimeError("execution failed")
        with self.assertRaisesRegex(RuntimeError, "execution failed"):
            campaign([candidate(1)], crash)


if __name__ == "__main__":
    unittest.main()
