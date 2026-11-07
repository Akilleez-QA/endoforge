import io
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest

from core.ledger.ledger import Ledger
from tools.ledger_writer import Journal, Writer

ROOT = Path(__file__).resolve().parents[1]


def task(request, prior, append, _process, _db):
    append(dict(version=0, kind="task", id="task", data=dict(intent=request["result"]["need"], acceptance="test")))
    return dict(seq=len(prior))


def note(request, prior, append, _process, _db):
    append(dict(version=0, kind="admitted_input", id=request["result"]["id"],
                data=dict(task="task", content=request["result"]["id"], origin="caller")))
    return dict(seq=len(prior))


EXTENSION = types.SimpleNamespace(LOOP=dict(admit=task, note=note))


def line(identity, action, ledger, **result):
    return json.dumps(dict(id=identity, action=action, job=dict(reference=dict(ledger=str(ledger))), result=result)).encode()


def ids(path):
    return [record["id"] for record in Ledger(str(path)).records()]


class HeldJournal(Journal):
    def __init__(self, directory):
        super().__init__(directory)
        self.gate = threading.Event()
        self.entered = threading.Event()

    def write(self, entries):
        self.entered.set()
        self.gate.wait(10)
        super().write(entries)


class LedgerShedTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="ef-shed-"))
        self.addCleanup(lambda: shutil.rmtree(self.root, ignore_errors=True))

    def paths(self, count):
        return [self.root / f"l{index}" / "ledger.sqlite" for index in range(count)]

    def test_shed_closes_cached_handles_and_the_writer_carries_on(self):
        output = io.StringIO()
        writer = Writer(None, EXTENSION, Journal(self.root / "journal"), output)
        paths = self.paths(8)
        writer.batch([line(index, "admit", path, need="n") for index, path in enumerate(paths)])
        self.assertEqual(len(writer.handles), 8)
        self.assertGreater(writer.sheddable(), 0)
        self.assertIsNone(writer.request_shed())
        self.assertEqual(len(writer.handles), 0)
        self.assertEqual(writer.sheddable(), 0)
        self.assertEqual(writer.counts["handles_shed"], 8)
        writer.batch([line(100 + index, "note", path, id="after") for index, path in enumerate(paths)])
        writer.close()
        answers = [json.loads(text) for text in output.getvalue().splitlines()]
        self.assertEqual(len(answers), 16)
        self.assertTrue(all("error" not in answer for answer in answers))
        for path in paths:
            self.assertEqual(ids(path), ["task", "after"])

    def test_shed_inside_a_batch_waits_for_its_end(self):
        writer = Writer(None, EXTENSION, Journal(self.root / "journal"), io.StringIO())
        writer.batch([line(0, "admit", self.paths(1)[0], need="n")])
        writer.busy = True
        self.assertFalse(writer.request_shed())
        self.assertEqual(len(writer.handles), 1)
        self.assertTrue(writer.shed_requested)
        writer.busy = False
        writer.shed()
        self.assertEqual((len(writer.handles), writer.shed_requested), (0, False))
        writer.close()

    def test_shed_never_drops_unacknowledged_batches(self):
        output = io.StringIO()
        journal = HeldJournal(self.root / "journal")
        writer = Writer(None, EXTENSION, journal, output)
        writer.start()
        paths = self.paths(6)
        writer.batch([line(index, "admit", path, need="n") for index, path in enumerate(paths)])
        self.assertTrue(journal.entered.wait(5))
        for round_ in range(3):
            writer.batch([line(1000 * (round_ + 1) + index, "note", path, id=f"q{round_}") for index, path in enumerate(paths)])
        self.assertEqual(output.getvalue(), "")
        writer.shed()
        writer.shed()
        self.assertEqual(len(writer.handles), 0)
        journal.gate.set()
        writer.close()
        answers = [json.loads(text) for text in output.getvalue().splitlines()]
        self.assertEqual(sorted(answer["id"] for answer in answers), sorted([0, 1, 2, 3, 4, 5] + [1000 * (r + 1) + i for r in range(3) for i in range(6)]))
        self.assertTrue(all("error" not in answer for answer in answers))
        self.assertIn(journal.counts["frames"], (2, 3, 4))
        for path in paths:
            self.assertEqual(ids(path), ["task", "q0", "q1", "q2"])

    def test_served_writer_registers_sheds_on_sigusr2_and_unregisters(self):
        registry = self.root / "state"
        script = f"""
import sys, types
sys.path.insert(0, {str(ROOT)!r})
from tools.test_ledger_shed import EXTENSION
from tools.ledger_writer import serve
serve(None, EXTENSION)
"""
        env = dict(os.environ, XDG_STATE_HOME=str(registry), ENDOFORGE_DUMP_LIST="1", ENDOFORGE_LEDGER_JOURNAL=str(self.root / "journal"))
        child = subprocess.Popen([sys.executable, "-B", "-c", script], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env, cwd=ROOT)
        self.assertEqual(json.loads(child.stdout.readline()), dict(id=0, result="ready"))
        folder = registry / "memguard" / "dump-list.d"
        path = folder / f"{child.pid}-endoforge-ledger-writer.json"
        self.assertEqual(json.loads(path.read_text())["priority"], 110)
        paths = self.paths(20)
        child.stdin.write(b"\n".join(line(index + 1, "admit", p, need="n") for index, p in enumerate(paths)) + b"\n")
        child.stdin.flush()
        first = [json.loads(child.stdout.readline()) for _ in paths]
        self.assertTrue(all("error" not in answer for answer in first))
        deadline = time.monotonic() + 5
        while json.loads(path.read_text())["sheddable_bytes"] == 0 and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertGreater(json.loads(path.read_text())["sheddable_bytes"], 0)
        os.kill(child.pid, signal.SIGUSR2)
        deadline = time.monotonic() + 2
        while json.loads(path.read_text())["sheddable_bytes"] != 0 and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(json.loads(path.read_text())["sheddable_bytes"], 0)
        child.stdin.write(b"\n".join(line(100 + index, "note", p, id="after") for index, p in enumerate(paths)) + b"\n")
        child.stdin.close()
        rest = [json.loads(text) for text in child.stdout.read().splitlines()]
        self.assertEqual(child.wait(10), 0)
        child.stdout.close()
        self.assertEqual(len(rest), 20)
        self.assertTrue(all("error" not in answer for answer in rest))
        self.assertFalse(path.exists())
        for p in paths:
            self.assertEqual(ids(p), ["task", "after"])


if __name__ == "__main__":
    unittest.main()
