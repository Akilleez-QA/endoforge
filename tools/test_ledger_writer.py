import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import types
import unittest
from unittest import mock

from core.ledger.ledger import Ledger
from tools.ledger_writer import HEADER, Journal, JournalCorrupt, Writer


def task(request, prior, append, _process, _db):
    append(dict(version=0, kind="task", id="task", data=dict(intent=request["result"]["need"], acceptance="test")))
    return dict(seq=len(prior))


def note(request, prior, append, _process, _db):
    append(dict(version=0, kind="admitted_input", id=request["result"]["id"],
                data=dict(task="task", content=request["result"]["id"], origin="caller")))
    return dict(seq=len(prior))


def fail(request, prior, append, process, db):
    note(request, prior, append, process, db)
    raise ValueError("refused after its first insert")


EXTENSION = types.SimpleNamespace(LOOP=dict(admit=task, note=note, fail=fail))


def line(identity, action, ledger, **result):
    return json.dumps(dict(id=identity, action=action, job=dict(reference=dict(ledger=str(ledger))), result=result)).encode()


def ids(path):
    return [record["id"] for record in Ledger(path).records()]


class WriterTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="ef-writer-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(self.root, ignore_errors=True))
        self.journal_dir = self.root / "journal"

    def writer(self):
        output = io.StringIO()
        return Writer(None, EXTENSION, Journal(self.journal_dir), output), output

    def ledger(self, name):
        return self.root / name / "ledger.sqlite"

    def segment(self):
        segments = sorted(self.journal_dir.glob("*.journal"))
        self.assertEqual(len(segments), 1)
        return segments[0]

    def answers(self, output):
        return [json.loads(text) for text in output.getvalue().splitlines()]

    def seeded(self, count=3, notes=2):
        writer, output = self.writer()
        paths = [self.ledger(f"t{n}") for n in range(count)]
        writer.batch([line(n, "admit", path, need=f"need {n}") for n, path in enumerate(paths)])
        for k in range(notes):
            writer.batch([line(100 * (k + 1) + n, "note", path, id=f"input-{k}") for n, path in enumerate(paths)])
        return writer, output, paths

    def lose(self, paths):
        for path in paths:
            for suffix in ("", "-wal", "-shm"):
                Path(f"{path}{suffix}").unlink(missing_ok=True)

    def test_one_journal_sync_per_batch_across_ledgers(self):
        writer, output, paths = self.seeded(count=5, notes=2)
        self.assertEqual(writer.journal.counts["journal_syncs"], 3)
        self.assertEqual(writer.journal.counts["frames"], 3)
        self.assertTrue(all("error" not in answer for answer in self.answers(output)))
        for path in paths:
            self.assertEqual(ids(path), ["task", "input-0", "input-1"])

    def test_answers_follow_the_journal_sync(self):
        writer, output = self.writer()
        events = []
        sync, respond = writer.journal.sync, writer.respond
        writer.journal.sync = lambda: (events.append("sync"), sync())
        writer.respond = lambda lines: (events.append("respond"), respond(lines))
        writer.batch([line(1, "admit", self.ledger("a"), need="a"), line(2, "admit", self.ledger("b"), need="b")])
        self.assertEqual(events, ["sync", "respond"])

    def test_a_failed_journal_sync_answers_nothing(self):
        writer, output = self.writer()
        writer.journal.sync = mock.Mock(side_effect=OSError(5, "Input/output error"))
        with self.assertRaises(OSError):
            writer.batch([line(1, "admit", self.ledger("a"), need="a")])
        self.assertEqual(output.getvalue(), "")

    def test_requests_for_one_ledger_keep_their_order_within_and_across_batches(self):
        writer, output = self.writer()
        path = self.ledger("ordered")
        writer.batch([line(1, "admit", path, need="n")] + [line(2 + k, "note", path, id=f"input-{k}") for k in range(5)])
        writer.batch([line(10 + k, "note", path, id=f"input-{5 + k}") for k in range(5)])
        answers = self.answers(output)
        self.assertEqual([a["id"] for a in answers], [1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14])
        self.assertEqual([a["result"]["seq"] for a in answers], list(range(1, 12)))
        self.assertEqual(ids(path), ["task"] + [f"input-{k}" for k in range(10)])

    def test_a_failing_request_leaves_nothing_in_the_ledger_or_the_journal(self):
        writer, output = self.writer()
        path = self.ledger("partial")
        writer.batch([line(1, "admit", path, need="n"), line(2, "fail", path, id="input-x"), line(3, "note", path, id="input-y")])
        answers = self.answers(output)
        self.assertIn("error", answers[1])
        self.assertEqual(ids(path), ["task", "input-y"])
        os.close(writer.journal.fd)
        for entry in writer.handles.values():
            entry[1].close()
        self.lose([path])
        Journal(self.journal_dir).close()
        self.assertEqual(ids(path), ["task", "input-y"])

    def test_lost_ledger_files_are_rebuilt_from_the_journal_after_a_kill(self):
        writer, output, paths = self.seeded()
        expected = {str(path): Ledger(path).records() for path in paths}
        os.close(writer.journal.fd)
        for entry in writer.handles.values():
            entry[1].close()
        self.lose(paths)
        recovered = Journal(self.journal_dir)
        self.assertEqual(recovered.counts["frames_replayed"], 9)
        self.assertEqual(recovered.counts["torn_tails"], 0)
        for path in paths:
            self.assertEqual(Ledger(path).records(), expected[str(path)])
        recovered.close()
        self.assertEqual(sorted(self.journal_dir.glob("*.journal")), [])

    def test_replay_skips_what_the_ledger_already_holds(self):
        writer, output, paths = self.seeded()
        os.close(writer.journal.fd)
        for entry in writer.handles.values():
            entry[1].close()
        recovered = Journal(self.journal_dir)
        self.assertEqual(recovered.counts["frames_replayed"], 0)
        self.assertEqual(recovered.counts["conflicts"], 0)
        for path in paths:
            self.assertEqual(ids(path), ["task", "input-0", "input-1"])

    def damaged(self, damage):
        writer, output, paths = self.seeded()
        expected = {str(path): ids(path) for path in paths}
        os.close(writer.journal.fd)
        for entry in writer.handles.values():
            entry[1].close()
        segment = self.segment()
        data = segment.read_bytes()
        segment.write_bytes(damage(data))
        self.lose(paths)
        return segment, data, expected, paths

    def last_frame_start(self, data):
        offset, starts = 0, []
        while offset < len(data):
            starts.append(offset)
            offset += HEADER.size + HEADER.unpack_from(data, offset)[1]
        return starts[-1]

    def assert_torn_tail_quarantined(self, damage, kept):
        segment, data, expected, paths = self.damaged(damage)
        damaged = segment.read_bytes()
        recovered = Journal(self.journal_dir)
        self.assertEqual(recovered.counts["torn_tails"], 1)
        quarantined = list(self.journal_dir.glob("*.torn-*"))
        self.assertEqual(len(quarantined), 1)
        end = int(quarantined[0].name.split(".torn-")[1].split(".")[0])
        self.assertEqual(quarantined[0].read_bytes(), damaged[end:])
        for path in paths:
            self.assertEqual(ids(path), expected[str(path)][:kept])
            self.assertNotEqual(ids(path), [])

    def test_a_frame_cut_mid_write_is_quarantined_and_earlier_frames_survive(self):
        self.assert_torn_tail_quarantined(lambda data: data[:self.last_frame_start(data) + 50], 2)

    def test_a_corrupted_last_frame_is_quarantined(self):
        def flip(data):
            position = len(data) - 10
            return data[:position] + bytes([data[position] ^ 0xFF]) + data[position + 1:]
        self.assert_torn_tail_quarantined(flip, 2)

    def test_trailing_garbage_is_quarantined_with_every_frame_kept(self):
        self.assert_torn_tail_quarantined(lambda data: data + b"\x00garbage", 3)

    def test_recovery_interrupted_after_quarantine_can_run_again(self):
        segment, data, expected, paths = self.damaged(lambda data: data + b"\x00garbage")
        first = segment.with_name(f"{segment.name}.torn-{len(data)}.1")
        first.write_bytes(b"\x00garbage")
        recovered = Journal(self.journal_dir)
        self.assertEqual(recovered.counts["torn_tails"], 1)
        self.assertEqual(len(list(self.journal_dir.glob("*.torn-*"))), 2)
        for path in paths:
            self.assertEqual(ids(path), expected[str(path)])

    def test_corruption_before_a_valid_frame_refuses_to_start(self):
        def middle(data):
            position = HEADER.size + 5
            return data[:position] + bytes([data[position] ^ 0xFF]) + data[position + 1:]
        segment, *_ = self.damaged(middle)
        with self.assertRaises(JournalCorrupt):
            Journal(self.journal_dir)
        self.assertTrue(segment.exists())

    def test_a_ledger_that_disagrees_with_the_journal_is_refused_not_rewritten(self):
        writer, output, paths = self.seeded(count=1, notes=1)
        os.close(writer.journal.fd)
        for entry in writer.handles.values():
            entry[1].close()
        self.lose(paths)
        other = Writer(None, EXTENSION, Journal(self.root / "elsewhere"), io.StringIO())
        other.batch([line(1, "admit", paths[0], need="a different task")])
        other.close()
        recovered = Journal(self.journal_dir)
        self.assertEqual(recovered.counts["conflicts"], 1)
        self.assertTrue(Path(f"{paths[0]}.journal-conflict").exists())
        self.assertEqual(Ledger(paths[0]).records()[0]["data"]["intent"], "a different task")
        refused, refused_output = self.writer()
        refused.batch([line(2, "note", paths[0], id="input-z")])
        self.assertIn("refused", self.answers(refused_output)[0]["error"])

    def test_a_live_writers_segment_is_not_recovered_by_another(self):
        first, _ = self.writer()
        first.batch([line(1, "admit", self.ledger("live"), need="n")])
        second, _ = self.writer()
        self.assertEqual(second.journal.counts["segments_recovered"], 0)
        self.assertEqual(len(list(self.journal_dir.glob("*.journal"))), 2)
        first.close()
        second.close()

    def test_rotation_retires_the_full_segment(self):
        writer, output = self.writer()
        writer.journal.segment_bytes = 1
        writer.batch([line(1, "admit", self.ledger("a"), need="a")])
        writer.batch([line(2, "admit", self.ledger("b"), need="b")])
        for thread in writer.journal.retiring:
            thread.join()
        self.assertEqual(len(list(self.journal_dir.glob("*.journal"))), 1)
        self.assertGreaterEqual(writer.journal.counts["retire_syncs"], 2)
        writer.close()
        self.assertEqual(list(self.journal_dir.glob("*.journal")), [])

    def test_new_ledgers_are_in_wal_mode(self):
        writer, output = self.writer()
        path = self.ledger("wal")
        writer.batch([line(1, "admit", path, need="n")])
        db = sqlite3.connect(path)
        self.assertEqual(db.execute("PRAGMA journal_mode").fetchone()[0], "wal")
        db.close()
        self.assertEqual(ids(path), ["task"])


if __name__ == "__main__":
    unittest.main()
