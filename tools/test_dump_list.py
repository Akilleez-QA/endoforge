import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

from tools import dump_list

ROOT = Path(__file__).resolve().parents[1]


class DumpListTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="ef-dump-py-"))
        self.addCleanup(lambda: shutil.rmtree(self.root, ignore_errors=True))

    def test_off_without_directory_or_variable_and_on_with_either(self):
        env = dict(XDG_STATE_HOME=str(self.root))
        self.assertEqual(dump_list.directory(env), self.root / "memguard" / "dump-list.d")
        self.assertFalse(dump_list.enabled(env))
        holder = dump_list.register("off", 10, lambda: 1, env=env)
        self.assertFalse(holder.enabled)
        self.assertFalse((self.root / "memguard").exists())
        self.assertTrue(dump_list.enabled(dict(env, ENDOFORGE_DUMP_LIST="1")))
        dump_list.directory(env).mkdir(parents=True)
        self.assertTrue(dump_list.enabled(env))
        self.assertFalse(dump_list.enabled(dict(env, ENDOFORGE_DUMP_LIST="0")))

    def test_record_matches_the_node_helper_and_the_protocol(self):
        env = dict(XDG_STATE_HOME=str(self.root), ENDOFORGE_DUMP_LIST="1")
        holder = dump_list.register("py.holder_1", 110, lambda: 4096.9, env=env, listen=False)
        self.addCleanup(holder.close)
        folder = dump_list.directory(env)
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
        self.assertEqual(os.listdir(folder), [f"{os.getpid()}-py.holder_1.json"])
        record = json.loads(holder.path.read_text())
        self.assertEqual(list(record), ["schema", "pid", "name", "priority", "sheddable_bytes", "signal", "updated"])
        self.assertEqual({k: v for k, v in record.items() if k != "updated"},
                         dict(schema="memguard-dump/1", pid=os.getpid(), name="py.holder_1", priority=110, sheddable_bytes=4096, signal="SIGUSR2"))
        self.assertTrue(record["updated"].endswith("Z"))
        self.assertEqual(holder.path.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(ValueError):
            dump_list.register("bad name", 1, lambda: 0, folder=folder)
        with self.assertRaises(ValueError):
            dump_list.register("ok", 200, lambda: 0, folder=folder)

    def test_writes_are_atomic_renames_and_leave_no_temporary_file(self):
        value = [0]
        holder = dump_list.register("atomic", 1, lambda: value[0], folder=self.root, listen=False, refresh_seconds=0)
        self.addCleanup(holder.close)
        inodes = set()
        for index in range(200):
            value[0] = index * 1000 + 1
            holder.refresh()
            self.assertEqual(json.loads(holder.path.read_text())["sheddable_bytes"], value[0])
            inodes.add(holder.path.stat().st_ino)
        self.assertGreater(len(inodes), 1)
        self.assertEqual(os.listdir(self.root), [holder.path.name])

    def test_rate_limit_and_trailing_write(self):
        value = [10]
        holder = dump_list.register("rate", 1, lambda: value[0], folder=self.root, listen=False, refresh_seconds=0.2)
        self.addCleanup(holder.close)
        for _ in range(50):
            value[0] += 1
            holder.refresh()
        self.assertEqual(holder.writes, 1)
        deadline = time.monotonic() + 3
        while json.loads(holder.path.read_text())["sheddable_bytes"] != 60 and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(json.loads(holder.path.read_text())["sheddable_bytes"], 60)
        self.assertEqual(holder.writes, 2)

    def test_stale_file_is_overwritten_and_close_removes_it(self):
        path = self.root / f"{os.getpid()}-stale.json"
        path.write_text('{"schema":"memguard-dump/1","pid":1,"name":"stale","priority":0,"sheddable_bytes":999,"signal":"SIGUSR2","updated":"2000-01-01T00:00:00Z"}\n')
        holder = dump_list.register("stale", 7, lambda: 5, folder=self.root, listen=False)
        record = json.loads(path.read_text())
        self.assertEqual((record["pid"], record["priority"], record["sheddable_bytes"]), (os.getpid(), 7, 5))
        holder.close()
        self.assertFalse(path.exists())

    def test_signal_sheds_rewrites_survives_and_exit_removes_the_file(self):
        script = f"""
import sys, time
sys.path.insert(0, {str(ROOT)!r})
from tools import dump_list
held = [5000000]
def shed():
    held[0] = 1000
holder = dump_list.register("child", 30, lambda: held[0], shed, folder={str(self.root)!r})
print("registered", flush=True)
deadline = time.monotonic() + 20
while holder.sheds < 2 and time.monotonic() < deadline:
    time.sleep(0.01)
print("sheds", holder.sheds, flush=True)
"""
        child = subprocess.Popen([sys.executable, "-B", "-c", script], stdout=subprocess.PIPE, text=True)
        self.assertEqual(child.stdout.readline().strip(), "registered")
        path = self.root / f"{child.pid}-child.json"
        self.assertEqual(json.loads(path.read_text())["sheddable_bytes"], 5000000)
        os.kill(child.pid, signal.SIGUSR2)
        deadline = time.monotonic() + 2
        while json.loads(path.read_text())["sheddable_bytes"] != 1000 and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(json.loads(path.read_text())["sheddable_bytes"], 1000)
        os.kill(child.pid, signal.SIGUSR2)
        output, _ = child.communicate(timeout=20)
        self.assertEqual(child.returncode, 0)
        self.assertIn("sheds 2", output)
        self.assertEqual(os.listdir(self.root), [])

    def test_a_process_whose_sigusr2_is_already_claimed_is_not_registered(self):
        previous = signal.signal(signal.SIGUSR2, lambda number, frame: None)
        self.addCleanup(signal.signal, signal.SIGUSR2, previous)
        holder = dump_list.register("claimed", 1, lambda: 1, folder=self.root)
        self.assertFalse(holder.enabled)
        self.assertEqual(holder.refused, "sigusr2-claimed")
        self.assertEqual(os.listdir(self.root), [])

    def test_a_deferred_shed_does_not_rewrite_until_it_happens(self):
        held = [100]
        holder = dump_list.register("deferred", 1, lambda: held[0], lambda: False, folder=self.root, listen=False)
        self.addCleanup(holder.close)
        writes = holder.writes
        holder.shed_now()
        self.assertEqual(holder.writes, writes)


if __name__ == "__main__":
    unittest.main()
