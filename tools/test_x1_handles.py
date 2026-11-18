import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from core.ledger.ledger import Ledger, encode
from tools import x1_loop

ORACLE = {"CONTRACT.md": b"Add two integers.".hex(), "tests.json": b'[{"fn":"add","args":[1,2],"expect":3}]'.hex(),
          "frozen.sha256": b"{}".hex()}
CONFIGURATION = dict(gateInput=dict(version=1), invariants=[], objectives=dict(bytes="min"))


def digests():
    return {name: hashlib.sha256(bytes.fromhex(text)).hexdigest() for name, text in x1_loop.repository_files().items()}


def admitted(directory, payload):
    ledger = Ledger(str(Path(directory) / "ledger.sqlite"))
    with closing(ledger._connect()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        prior, previous = ledger._read(db)
        tip = [previous]

        def append(record):
            tip[0] = ledger._append(db, record, prior, tip[0])
            prior[record["id"]] = record
            return tip[0]

        answer = x1_loop.admit(dict(job=dict(reference=dict(ledger=ledger.path)), result=payload), prior, append, None, db)
    rows = sqlite3.connect(ledger.path).execute("SELECT * FROM records ORDER BY rowid").fetchall()
    return answer, rows


def assembled(answer):
    data = json.loads(answer["frame"])
    bundle = json.loads(data["content"])
    repository = x1_loop.repository_files()
    for name in answer["elided"]:
        assert bundle["files"][name] == ""
        bundle["files"][name] = repository[name]
    data["content"] = encode(bundle)
    return encode(data)


class Handles(unittest.TestCase):
    """The ban: the frozen bundle's implementation files cross the writer boundary as SHA-256 digests, never as payloads."""

    def test_an_admit_carrying_implementation_payload_is_refused(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, "digests, not payloads"):
            admitted(directory, dict(need="add", configuration=CONFIGURATION, files={**ORACLE, **x1_loop.repository_files()}))

    def test_a_digest_that_differs_from_the_repository_is_refused(self):
        wrong = dict(digests(), **{"gates.mjs": hashlib.sha256(b"export const runGates = () => ({});").hexdigest()})
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, "differs from the repository"):
            admitted(directory, dict(need="add", configuration=CONFIGURATION, files=ORACLE, implementation=wrong))

    def test_a_digest_outside_the_implementation_is_refused(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, "outside the implementation"):
            admitted(directory, dict(need="add", configuration=CONFIGURATION, files=ORACLE,
                                     implementation={"../../tools/x1_loop.py": "0" * 64}))

    def test_digests_freeze_the_same_rows_as_payloads_and_the_answer_is_a_small_frame(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            answer, rows = admitted(first, dict(need="add", configuration=CONFIGURATION, files=ORACLE, implementation=digests()))
            files = {**ORACLE, **x1_loop.repository_files()}
            expected = x1_loop.frozen_record(None, files=files, task="task", admitted_input="input", **x1_loop.FREEZE_FACTS,
                                             configuration=CONFIGURATION, residual=x1_loop.GATE_LABEL, invariant_version="1")
            self.assertEqual(answer["identity"], expected["id"])
            self.assertEqual(sorted(answer["elided"]), sorted(x1_loop.IMPLEMENTATION_FILES))
            self.assertNotIn("encoded", answer)
            self.assertLess(len(json.dumps(answer)), 32 * 1024)
            whole = assembled(answer)
            self.assertEqual(whole, encode(expected["data"]))
            self.assertEqual("evr:" + hashlib.sha256(whole.encode()).hexdigest(), answer["identity"])
            again, rows_again = admitted(second, dict(need="add", configuration=CONFIGURATION, files=ORACLE, implementation=digests()))
            self.assertEqual(again, answer)
            self.assertEqual(rows_again, rows)


if __name__ == "__main__":
    unittest.main()
