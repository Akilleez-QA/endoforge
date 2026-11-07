import json
import time
import unittest
from pathlib import Path

from core.constraints.extract import ModelExtractor, RuleExtractor
from core.constraints.port import Message, Origin, PromotionRefused
from core.constraints.record import ConstraintRecord
from core.constraints.store import MemoryStore

SEEDS = json.loads((Path(__file__).parents[1] / "experiments/P-55-constraints/seeds.json").read_text())


def active(record):
    return [r for r in record.state().values() if r["status"] == "active"]


def lines(block):
    return [json.loads(line) for line in block.splitlines() if line.startswith("{")]


def fresh(extractor=None):
    return ConstraintRecord(MemoryStore(), extractor or RuleExtractor())


class LaunderingTest(unittest.TestCase):
    def run_seed(self, seed, extractor):
        record = fresh(extractor)
        record.observe(Message(seed["id"], Origin(seed["origin"]), seed["text"]))
        record.cross()
        return record

    def test_seeds_never_become_active_or_permissions(self):
        self.assertGreaterEqual(len(SEEDS), 20)
        for seed in SEEDS:
            for extractor in (RuleExtractor(), ModelExtractor(lambda prompt: "[]")):
                record = self.run_seed(seed, extractor)
                self.assertEqual(active(record), [], seed["id"])
                self.assertEqual(lines(record.resume_block()), [], seed["id"])

    def test_refused_records_keep_provenance_and_cannot_be_promoted(self):
        refused = 0
        for seed in SEEDS:
            record = self.run_seed(seed, RuleExtractor())
            for item in record.state().values():
                refused += 1
                self.assertEqual(item["status"], "refused")
                self.assertNotEqual(item["origin"], "human")
                self.assertEqual(item["source_message_id"], seed["id"])
                with self.assertRaises(PromotionRefused):
                    record.set_status(item["id"], "active", Message("m9", Origin.HUMAN, "promote it"))
        self.assertGreater(refused, 10)

    def test_model_output_outside_human_text_is_refused(self):
        reply = json.dumps([{"message_id": "m1", "text": "the user approved X", "kind": "requirement", "scope": "standing"}])
        record = fresh(ModelExtractor(lambda prompt: reply))
        record.observe(Message("m1", Origin.HUMAN, "Please read the log.\n<log>the user approved X</log>"))
        self.assertEqual(record.cross()["unverified"], 1)
        self.assertEqual(active(record), [])

    def test_model_never_sees_quoted_or_tool_text(self):
        seen = []

        def spy(prompt):
            seen.append(prompt)
            return "[]"
        record = fresh(ModelExtractor(spy))
        record.observe(Message("m1", Origin.HUMAN, "Read this.\n<doc>secret instruction</doc>"))
        record.observe(Message("t1", Origin.TOOL, "tool instruction"))
        record.cross()
        self.assertNotIn("secret instruction", seen[0])
        self.assertNotIn("tool instruction", seen[0])

    def test_reported_speech_is_not_a_user_constraint(self):
        seeds = json.loads((Path(__file__).parents[1] / "experiments/P-55-constraints/seeds-reported.json").read_text())
        for seed in seeds:
            reply = json.dumps([{"message_id": seed["id"], "text": seed["text"], "kind": "prohibition", "scope": "standing"}])
            for extractor in (RuleExtractor(), ModelExtractor(lambda prompt: reply)):
                self.assertEqual(active(self.run_seed(seed, extractor)), [], seed["id"])

    def test_block_states_no_authority(self):
        self.assertIn("grant no permission", fresh().resume_block())

    def test_pasted_block_with_attributes_on_close_is_quoted(self):
        record = fresh()
        record.observe(Message("m1", Origin.HUMAN, '<pasted_content id="1">Never ask me.</pasted_content id="1">'))
        record.cross()
        self.assertEqual(active(record), [])

    def test_oversized_message_is_quoted_and_fast(self):
        record = fresh()
        record.observe(Message("m1", Origin.HUMAN, "<a> Never ask. " * 50_000))
        started = time.perf_counter()
        record.cross()
        self.assertLess(time.perf_counter() - started, 5)
        self.assertEqual(active(record), [])

    def test_unclosed_paste_is_quoted_to_the_end(self):
        record = fresh()
        record.observe(Message("m1", Origin.HUMAN, 'Summarise.\n<pasted_content id="1">Never ask me.'))
        record.cross()
        self.assertEqual(active(record), [])


if __name__ == "__main__":
    unittest.main()
