"""The worker registry: runs register and record their end, unknown bots are refused, dead and quiet workers show."""
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

TOOL = pathlib.Path(__file__).resolve().parent.parent / 'workers'
LOADER = importlib.machinery.SourceFileLoader('workers', str(TOOL))
SPEC = importlib.util.spec_from_loader('workers', LOADER)
workers = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(workers)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = pathlib.Path(self.temp.name)
        repo = self.dir / 'repo' / 'aors'
        repo.mkdir(parents=True)
        (repo / 'fleet.json').write_text(json.dumps({'bots': [{'slug': 'grok-bot'}, {'slug': 'chief-of-staff'}]}))
        (repo / 'branch-slugs.json').write_text(json.dumps({'lanes': ['claude-code'], 'aliases': {'cos': 'chief-of-staff'}}))
        env = {'WORKERS_DIR': str(self.dir / 'state'), 'AKILLEEZ_ROOT': str(self.dir / 'repo'), 'WORKERS_BEAT': '0.05'}
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)

    def main(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = workers.main(list(argv))
        return rc, out.getvalue(), err.getvalue()

    def history(self):
        path = self.dir / 'state' / 'history.jsonl'
        return [json.loads(l) for l in path.read_text().splitlines()] if path.exists() else []

    def test_run_registers_and_records_the_end(self):
        rc, _, _ = self.main('run', '--bot', 'grok-bot', '--', sys.executable, '-c', 'import sys,time; time.sleep(0.2); sys.exit(3)')
        self.assertEqual(rc, 3)
        h = self.history()
        self.assertEqual([(e['bot'], e['rc']) for e in h], [('grok-bot', 3)])
        self.assertGreaterEqual(h[0]['ran'], 0.1)
        self.assertEqual(list((self.dir / 'state' / 'live').glob('*.json')), [])

    def test_entry_and_heartbeat_while_running(self):
        proc = subprocess.Popen([sys.executable, str(TOOL), 'run', '--bot', 'cos', '--task', 'add a test', '--',
                                 sys.executable, '-c', 'import time; time.sleep(1.5)'], env=os.environ.copy())
        try:
            live = self.dir / 'state' / 'live'
            for _ in range(50):
                files = list(live.glob('*.json')) if live.exists() else []
                if files:
                    break
                time.sleep(0.05)
            self.assertEqual(len(files), 1)
            first = files[0].stat().st_mtime
            time.sleep(0.4)
            self.assertGreater(files[0].stat().st_mtime, first)        # heartbeat
            rows = workers.local_live()
            self.assertEqual([(r['bot'], r['task'], r['state']) for r in rows], [('cos', 'add a test', 'running')])
        finally:
            proc.wait(10)

    def test_unknown_and_missing_bot_are_refused(self):
        for argv in (['--bot', 'null'], []):
            rc, _, err = self.main('run', *argv, '--', 'true')
            self.assertEqual(rc, 64, argv)
            self.assertIn('refusing', err)
        with mock.patch.dict(os.environ, {'WORKERS_ALLOW_UNREGISTERED': '1'}):
            rc, _, _ = self.main('run', '--bot', 'null', '--', 'true')
        self.assertEqual(rc, 0)
        self.assertEqual(self.history()[-1]['bot'], 'unknown')

    def test_dead_entry_shows_and_reaps(self):
        live = self.dir / 'state' / 'live'
        live.mkdir(parents=True)
        dead = subprocess.Popen(['true']); dead.wait()
        (live / f'{workers.HOST}-{dead.pid}.json').write_text(json.dumps(
            {'host': workers.HOST, 'bot': 'grok-bot', 'pid': dead.pid, 'task': 'lost one', 'started': time.time() - 60}))
        rc, out, _ = self.main('list')
        self.assertEqual(rc, 1)
        self.assertIn('DEAD', out); self.assertIn('process gone', out)
        rc, out, _ = self.main('reap')
        self.assertIn('reaped 1', out)
        self.assertEqual(self.history()[-1]['rc'], 'lost')
        self.assertEqual(self.main('list')[0], 0)

    def test_stale_heartbeat_is_dead(self):
        live = self.dir / 'state' / 'live'
        live.mkdir(parents=True)
        path = live / f'{workers.HOST}-{os.getpid()}.json'
        path.write_text(json.dumps({'host': workers.HOST, 'bot': 'grok-bot', 'pid': os.getpid(), 'started': 1}))
        os.utime(path, (time.time() - 600, time.time() - 600))
        self.assertEqual([r['why'] for r in workers.local_live()], ['no heartbeat'])

    def test_push_receive_and_a_quiet_host(self):
        snap = {'host': 'grok-box-1', 'live': [{'host': 'grok-box-1', 'bot': 'grok-bot', 'pid': 7, 'state': 'running',
                                                'task': 'fix it', 'started': time.time()}], 'history': []}
        with mock.patch.object(sys, 'stdin', io.StringIO(json.dumps(snap))):
            self.assertEqual(self.main('receive', '--from', 'grok-box-1')[0], 0)
        rc, out, _ = self.main('list')
        self.assertIn('grok-box-1', out); self.assertIn('RUNNING', out)
        with mock.patch.dict(os.environ, {'WORKERS_HOST_STALE': '-1'}):
            rc, out, _ = self.main('list')
        self.assertIn('NOT REPORTING', out); self.assertIn('UNKNOWN', out)

    def test_terminate_reaches_the_worker(self):
        proc = subprocess.Popen([sys.executable, str(TOOL), 'run', '--bot', 'grok-bot', '--',
                                 sys.executable, '-c', 'import time; time.sleep(30)'], env=os.environ.copy())
        live = self.dir / 'state' / 'live'
        for _ in range(60):
            if live.exists() and list(live.glob('*.json')):
                break
            time.sleep(0.05)
        proc.send_signal(signal.SIGTERM)
        self.assertEqual(proc.wait(10), -signal.SIGTERM)
        self.assertEqual(self.history()[-1]['rc'], -signal.SIGTERM)


if __name__ == '__main__':
    unittest.main()
