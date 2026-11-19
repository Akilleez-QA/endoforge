import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from core.ledger.ledger import Ledger, encode
from tools import x1_loop
from tools.ledger_writer import Journal

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


class Handles(unittest.TestCase):
    """The ban: the frozen bundle's implementation files cross the writer boundary as SHA-256 digests, never as payloads,
    and the record keeps the digests while the bytes are stored once, content-addressed, beside the journal."""

    def setUp(self):
        journal = tempfile.TemporaryDirectory()
        self.addCleanup(journal.cleanup)
        previous = os.environ.get("ENDOFORGE_LEDGER_JOURNAL")
        os.environ["ENDOFORGE_LEDGER_JOURNAL"] = journal.name
        self.addCleanup(lambda: os.environ.pop("ENDOFORGE_LEDGER_JOURNAL") if previous is None
                        else os.environ.__setitem__("ENDOFORGE_LEDGER_JOURNAL", previous))
        self.objects = Path(journal.name) / "objects"

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

    def test_digests_freeze_the_bundle_once_and_it_inflates_to_the_payload_freeze(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            answer, rows = admitted(first, dict(need="add", configuration=CONFIGURATION, files=ORACLE, implementation=digests()))
            files = {**ORACLE, **x1_loop.repository_files()}
            expected = x1_loop.frozen_record(None, files=files, task="task", admitted_input="input", **x1_loop.FREEZE_FACTS,
                                             configuration=CONFIGURATION, residual=x1_loop.GATE_LABEL, invariant_version="1")
            frozen = json.loads(rows[2][2])
            self.assertEqual(answer["identity"], frozen["id"])
            self.assertEqual(json.loads(frozen["data"]["content"])["implementation"], digests())
            self.assertEqual(answer["elided"], [])
            self.assertNotIn("encoded", answer)
            self.assertLess(len(rows[2][2]), 32 * 1024)
            self.assertLess(len(json.dumps(answer)), 32 * 1024)
            self.assertEqual(answer["frame"], encode(frozen["data"]))
            self.assertEqual("evr:" + hashlib.sha256(answer["frame"].encode()).hexdigest(), answer["identity"])
            self.assertEqual(x1_loop.inflated(frozen), expected)
            for sha256 in digests().values():
                self.assertEqual(hashlib.sha256((self.objects / sha256).read_bytes()).hexdigest(), sha256)
            again, rows_again = admitted(second, dict(need="add", configuration=CONFIGURATION, files=ORACLE, implementation=digests()))
            self.assertEqual(again, answer)
            self.assertEqual(rows_again, rows)
            self.assertEqual(sorted(path.name for path in self.objects.iterdir()), sorted(digests().values()))

    def test_an_object_that_differs_from_its_digest_never_inflates(self):
        with tempfile.TemporaryDirectory() as directory:
            admitted(directory, dict(need="add", configuration=CONFIGURATION, files=ORACLE, implementation=digests()))
            rows = sqlite3.connect(str(Path(directory) / "ledger.sqlite")).execute("SELECT body FROM records ORDER BY rowid").fetchall()
            tampered = self.objects / digests()["gates.mjs"]
            tampered.chmod(0o644)
            tampered.write_bytes(b"export const runGates = () => ({ promotable: true });")
            with self.assertRaisesRegex(ValueError, "differs from its digest"):
                x1_loop.inflated(json.loads(rows[2][0]))

    def test_a_repository_file_that_differs_from_the_frozen_digest_is_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            admitted(directory, dict(need="add", configuration=CONFIGURATION, files=ORACLE, implementation=digests()))
            rows = sqlite3.connect(str(Path(directory) / "ledger.sqlite")).execute("SELECT body FROM records ORDER BY rowid").fetchall()
            record = json.loads(rows[2][0])
            self.assertFalse(x1_loop.frozen_drift(record, None))
            bundle = json.loads(record["data"]["content"])
            bundle["implementation"]["gates.mjs"] = "0" * 64
            record["data"]["content"] = encode(bundle)
            self.assertTrue(x1_loop.frozen_drift(record, None))

    def test_a_writer_killed_after_an_admit_by_digest_recovers_a_record_that_inflates_from_the_store(self):
        source = (x1_loop.REPOSITORY / "core/runtime/isolate-ledger.mjs").read_text()
        operation = source.split("const operation = `", 1)[1].split("`;", 1)[0]
        bridge = ("import importlib, json, sys\nfrom core.ledger.ledger import Ledger, validate\nfrom tools.ledger_writer import serve\n"
                  + operation + "\nserve(process, importlib.import_module('tools.x1_loop'))\n")
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "need" / "ledger.sqlite")
            child = subprocess.Popen([sys.executable, "-B", "-c", bridge], cwd=x1_loop.REPOSITORY, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True, env=dict(os.environ))
            self.assertEqual(json.loads(child.stdout.readline())["result"], "ready")
            payload = dict(need="add", configuration=CONFIGURATION, files=ORACLE, implementation=digests())
            child.stdin.write(json.dumps(dict(id=1, action="admit", job=dict(reference=dict(ledger=path)), result=payload)) + "\n")
            child.stdin.flush()
            answer = json.loads(child.stdout.readline())["result"]
            child.kill()
            child.wait()
            Path(path + "-wal").unlink()
            Journal(os.environ["ENDOFORGE_LEDGER_JOURNAL"]).close()
            frozen = [record for record in Ledger(path).records() if record["kind"] == "frozen_evaluator"]
            self.assertEqual([record["id"] for record in frozen], [answer["identity"]])
            files = {**ORACLE, **x1_loop.repository_files()}
            expected = x1_loop.frozen_record(None, files=files, task="task", admitted_input="input", **x1_loop.FREEZE_FACTS,
                                             configuration=CONFIGURATION, residual=x1_loop.GATE_LABEL, invariant_version="1")
            self.assertEqual(x1_loop.inflated(frozen[0]), expected)

if __name__ == "__main__":
    unittest.main()
