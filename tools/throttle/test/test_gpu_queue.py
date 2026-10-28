"""GPU queue state and recovery checks; all writes use temporary fixtures."""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

TOOL = pathlib.Path(__file__).resolve().parent.parent / 'gpu-queue.py'
SPEC = importlib.util.spec_from_file_location('gpu_queue', TOOL)
queue = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(queue)


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.directory = self.root / 'nested' / 'queue'
        patcher = mock.patch.dict(os.environ, {'FLEET_STATE_DIR': str(self.root / 'fleet')})   # this machine's dial
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch.object(queue, 'QDIR', str(self.directory))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.status_file = self.root / 'status'
        self.status_file.write_text('NSpid:\t123\n')
        self.dev = self.root / 'dev'
        self.dev.mkdir()
        (self.dev / 'nvidiactl').touch()
        for key, value in [('STATUS_PATH', str(self.status_file)), ('DEV_DIR', str(self.dev))]:
            patcher = mock.patch.object(queue, key, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_default_directory(self):
        with mock.patch.dict(os.environ, {'HOME': str(self.root),
                                          'XDG_STATE_HOME': str(self.root / 'ignored')}, clear=True):
            self.assertEqual(queue.queue_dir(), str(self.root / '.local/state/gpu-queue'))

    def test_directory_override(self):
        with mock.patch.dict(os.environ, {'GPU_QUEUE_DIR': str(self.directory)}):
            self.assertEqual(queue.queue_dir(), str(self.directory))

    def test_directory_creation_is_nested_and_idempotent(self):
        queue.ensure_queue_dir()
        queue.ensure_queue_dir()
        self.assertTrue(self.directory.is_dir())
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o700)

    def test_dangling_symlink_gets_its_target_created(self):
        # The 2026-10-26 reboot: ~/.local/state/gpu-queue -> /tmp/.../gpu-queue, and /tmp was wiped.
        self.directory.parent.mkdir(parents=True)
        target = self.root / 'tmp' / 'claude-1000' / 'gpu-queue'
        self.directory.symlink_to(target)
        self.assertFalse(self.directory.exists())
        with contextlib.redirect_stderr(io.StringIO()) as err:
            queue.ensure_queue_dir()
            self.assertEqual(queue.tickets(), [])
        self.assertTrue(self.directory.is_symlink())
        self.assertTrue(target.is_dir())
        self.assertEqual(target.stat().st_mode & 0o777, 0o700)
        self.assertIn('creating it', err.getvalue())
        queue.write_ticket(str(self.directory / '1-1-1.ticket'), {})
        self.assertTrue((target / '1-1-1.ticket').exists())

    def test_relative_dangling_symlink_resolves_from_the_link(self):
        self.directory.parent.mkdir(parents=True)
        self.directory.symlink_to('gone/queue')
        with contextlib.redirect_stderr(io.StringIO()):
            queue.tickets()
        self.assertTrue((self.directory.parent / 'gone' / 'queue').is_dir())

    def test_tickets_order_and_stale_dead_pid_pruning(self):
        queue.ensure_queue_dir()
        names = ['5-100-11.ticket', '1-300-12.ticket', '1-200-13.ticket',
                 '0-100-99.ticket', 'unfinished.tmp']
        for name in names:
            (self.directory / name).write_text('{}')
        os.utime(self.directory / names[3], (1, 1))
        with mock.patch.object(queue, 'alive', side_effect=lambda pid: pid != 99):
            self.assertEqual(queue.tickets(), [(1, 200, 13, names[2]),
                                              (1, 300, 12, names[1]),
                                              (5, 100, 11, names[0])])
        self.assertFalse((self.directory / names[3]).exists())
        self.assertTrue((self.directory / names[4]).exists())

    def test_missing_directory_is_recreated(self):
        self.assertEqual(queue.tickets(), [])
        self.assertTrue(self.directory.is_dir())

    def test_ticket_is_published_atomically(self):
        path = self.directory / '1-200-13.ticket'
        data = {'name': 'fixture', 'cmd': ['example'], 'cwd': str(self.root)}
        replace = os.replace

        def inspect_replace(source, destination):
            source = pathlib.Path(source)
            self.assertEqual(source.parent, self.directory)
            self.assertFalse(source.name.endswith('.ticket'))
            self.assertFalse(path.exists())
            self.assertEqual(json.loads(source.read_text()), data)
            replace(source, destination)

        with mock.patch.object(queue.os, 'replace', side_effect=inspect_replace) as publish:
            queue.write_ticket(str(path), data)
        publish.assert_called_once()
        self.assertEqual(json.loads(path.read_text()), data)
        self.assertEqual(list(self.directory.iterdir()), [path])

    def test_restore_preserves_ticket_name_and_content(self):
        path = self.directory / '1-200-13.ticket'
        data = {'name': 'fixture', 'cmd': ['example'], 'cwd': str(self.root)}
        queue.write_ticket(str(path), data)
        original = path.read_bytes()
        path.unlink()
        # Recreate the whole directory too, as scratch cleanup can remove it.
        self.directory.rmdir()
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            queue.restore_ticket(str(path), data)
            queue.restore_ticket(str(path), data)
        self.assertEqual(list(self.directory.iterdir()), [path])
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(stderr.getvalue(), 'gpu-queue: fixture ticket was missing, restored\n')

    def test_invisible_pid_needs_expired_lease(self):
        path = self.directory / '1-200-13.ticket'
        queue.write_ticket(path, {'pid': 13, 'pidns': 'foreign'})
        with mock.patch.object(queue, 'pid_namespace', return_value='ours'), \
             mock.patch.object(queue.os, 'kill', side_effect=ProcessLookupError):
            self.assertEqual(len(queue.tickets()), 1)
            self.assertTrue(path.exists())
            os.utime(path, (1, 1))
            self.assertEqual(queue.tickets(), [])
            self.assertFalse(path.exists())

    def test_same_namespace_dead_pid_reaped_with_fresh_mtime(self):
        path = self.directory / '1-200-13.ticket'
        queue.write_ticket(path, {'pid': 13, 'pidns': 'ours'})
        with mock.patch.object(queue, 'pid_namespace', return_value='ours'), \
             mock.patch.object(queue.os, 'kill', side_effect=ProcessLookupError):
            self.assertEqual(queue.tickets(), [])
        self.assertFalse(path.exists())

    def test_stale_alive_tickets_survive(self):
        for data in [{'pid': 13, 'pidns': 'ours'}, {}]:
            with self.subTest(data=data):
                path = self.directory / '1-200-13.ticket'
                queue.write_ticket(path, data)
                os.utime(path, (1, 1))
                with mock.patch.object(queue, 'pid_namespace', return_value='ours'), \
                     mock.patch.object(queue, 'alive', return_value=True):
                    self.assertEqual(len(queue.tickets()), 1)
                self.assertTrue(path.exists())

    def test_foreign_namespace_is_not_proof_of_liveness(self):
        path = self.directory / '1-200-13.ticket'
        queue.write_ticket(path, {'pid': 13, 'pidns': 'foreign'})
        os.utime(path, (1, 1))
        with mock.patch.object(queue, 'pid_namespace', return_value='ours'), \
             mock.patch.object(queue, 'alive', return_value=True) as alive:
            self.assertEqual(queue.tickets(), [])
        alive.assert_not_called()

    def test_lease_default_and_poll_clamp(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(queue.lease_seconds(30), 600)
        with mock.patch.dict(os.environ, {'GPU_QUEUE_LEASE_SEC': '1'}):
            self.assertEqual(queue.lease_seconds(30), 90)

    def test_invalid_lease_uses_default(self):
        with mock.patch.dict(os.environ, {'GPU_QUEUE_LEASE_SEC': 'bad'}):
            self.assertEqual(queue.lease_seconds(30), 600)

    def test_heartbeat_advances_mtime(self):
        path = self.directory / '1-200-13.ticket'
        queue.write_ticket(path, {})
        os.utime(path, (1, 1))
        queue.heartbeat(path, {})
        self.assertGreater(path.stat().st_mtime, 1)

    def test_running_heartbeat_until_stopped(self):
        stopped = mock.Mock()
        stopped.wait.side_effect = [False, False, True]
        with mock.patch.object(queue, 'heartbeat') as heartbeat:
            queue.keep_alive('ticket', {}, 30, stopped)
        self.assertEqual(heartbeat.call_count, 2)
        self.assertEqual(stopped.wait.call_args_list, [mock.call(30)] * 3)

    def assert_refusal_untouched(self, reason):
        self.directory.mkdir(parents=True)
        path = self.directory / '1-200-13.ticket'
        path.write_text('{}')
        os.utime(path, (1, 1))
        before = (os.listdir(self.directory), self.directory.stat().st_mtime_ns,
                  path.stat().st_mtime_ns, path.read_bytes())
        # Exercise the entry point and each mutation helper independently.
        with mock.patch.object(queue.sys, 'argv', ['gpu-queue.py', '--name', 'fixture', '--', 'example']), \
             mock.patch.object(queue, 'alive', return_value=False):
            for action in [queue.main, queue.ensure_queue_dir,
                           lambda: queue.write_ticket(path, {}),
                           lambda: queue.heartbeat(path, {}), queue.tickets]:
                with self.subTest(action=action), contextlib.redirect_stderr(io.StringIO()) as stderr:
                    with self.assertRaises(SystemExit) as refusal:
                        action()
                    self.assertEqual(refusal.exception.code, 77)
                    self.assertIn(reason, stderr.getvalue())
                    self.assertEqual(before, (os.listdir(self.directory), self.directory.stat().st_mtime_ns,
                                              path.stat().st_mtime_ns, path.read_bytes()))
        self.directory = self.root / 'absent'
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            queue.ensure_queue_dir()
        self.assertFalse(self.directory.exists())

    def test_nested_namespace_refuses_without_mutation(self):
        self.status_file.write_text('NSpid:\t123\t2\n')
        self.assert_refusal_untouched('nested PID namespace')

    def test_missing_nvidia_refuses_without_mutation(self):
        (self.dev / 'nvidiactl').unlink()
        self.assert_refusal_untouched('no /dev/nvidia* device nodes')

    def test_host_like_fixture_is_not_refused(self):
        queue.require_host(self.status_file, self.dev)

    def test_job_has_heartbeat_and_pid_metadata(self):
        worker = mock.Mock()
        with mock.patch.object(queue.sys, 'argv', ['gpu-queue.py', '--name', 'fixture', '--', 'example']), \
             mock.patch.object(queue.signal, 'signal'), \
             mock.patch.object(queue, 'status', return_value=(0, {})), \
             mock.patch.object(queue, 'headroom', return_value=None), \
             mock.patch.object(queue.threading, 'Thread', return_value=worker) as thread, \
             mock.patch.object(queue.subprocess, 'call', return_value=0) as run:
            def inspect_job(cmd):
                paths = list(self.directory.glob('*.ticket'))
                self.assertEqual(len(paths), 1)
                data = json.loads(paths[0].read_text())
                self.assertEqual(data['pid'], os.getpid())
                self.assertEqual(data['pidns'], queue.pid_namespace())
                worker.start.assert_called_once()
                return 0
            run.side_effect = inspect_job
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(queue.main(), 0)
        self.assertTrue(thread.call_args.kwargs['daemon'])
        worker.join.assert_called_once()
        self.assertEqual([n for n in os.listdir(self.directory) if n.endswith('.ticket')], [])  # history.jsonl stays


    def write_health(self, fb_used, bar1_used):
        path = self.root / 'health.json'
        path.write_text(json.dumps({'gpus': [{'framebuffer_mib': {'total': 16000, 'used': fb_used},
                                              'bar1_mib': {'total': 16000, 'used': bar1_used}}]}))
        return path

    def write_meminfo(self, total_gb, avail_gb):
        path = self.root / 'meminfo'
        path.write_text(f'MemTotal: {total_gb * 2 ** 20} kB\nMemAvailable: {avail_gb * 2 ** 20} kB\n')
        return path

    def test_headroom_scales_with_the_hardware(self):
        mem = self.write_meminfo(124, 60)
        with mock.patch.dict(os.environ, {'GPU_QUEUE_MAX_LOAD': '28'}):
            self.assertIsNone(queue.headroom(self.write_health(8000, 4), mem, load1=10))
            self.assertIn('framebuffer', queue.headroom(self.write_health(9700, 4), mem, load1=10))
            self.assertIn('bar1', queue.headroom(self.write_health(100, 8000), mem, load1=10))
            self.assertIn('load', queue.headroom(self.write_health(100, 4), mem, load1=30))
            self.assertIn('system memory', queue.headroom(self.write_health(100, 4), self.write_meminfo(124, 10), load1=10))
            self.assertIsNone(queue.headroom(self.write_health(100, 4), self.write_meminfo(16, 9), load1=1))  # 8 GB floor
        self.assertEqual(queue.headroom(self.root / 'absent.json', mem, load1=1), 'no GPU health sample')

    def test_head_waits_out_temporary_trouble_then_runs(self):
        states = iter([(78, {'monitor_status': 'journal_unavailable'}), (75, {'guard_status': 'occupied'}), (0, {}), (0, {})])
        rooms = iter(['load 30.0 (start under 28.0)', None])
        with mock.patch.object(queue.sys, 'argv', ['gpu-queue.py', '--name', 'fixture', '--poll', '5', '--', 'example']), \
             mock.patch.object(queue.signal, 'signal'), mock.patch.object(queue.time, 'sleep'), \
             mock.patch.object(queue, 'status', side_effect=lambda: next(states)), \
             mock.patch.object(queue, 'headroom', side_effect=lambda: next(rooms)), \
             mock.patch.object(queue.threading, 'Thread', return_value=mock.Mock()), \
             mock.patch.object(queue.subprocess, 'call', return_value=0) as run, \
             contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(queue.main(), 0)
        run.assert_called_once()
        self.assertIn('journal_unavailable', err.getvalue()); self.assertIn('load 30.0', err.getvalue())

    def test_fault_stops_at_once(self):
        with mock.patch.object(queue.sys, 'argv', ['gpu-queue.py', '--name', 'fixture', '--', 'example']), \
             mock.patch.object(queue.signal, 'signal'), \
             mock.patch.object(queue, 'status', return_value=(78, {'fault': True})), \
             mock.patch.object(queue.subprocess, 'call') as run, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(queue.main(), 78)
        run.assert_not_called()
        self.assertEqual([n for n in os.listdir(self.directory) if n.endswith('.ticket')], [])  # history.jsonl stays

    def test_short_lane_priority(self):
        with mock.patch.dict(os.environ, {'GPU_QUEUE_SHORT_SEC': '300'}):
            self.assertEqual(queue.ticket_priority(2, 120), 0)
            self.assertEqual(queue.ticket_priority(2, 300), 0)
            self.assertEqual(queue.ticket_priority(2, 900), 2)
            self.assertEqual(queue.ticket_priority(2, None), 2)

    def run_job(self, argv, call=None):
        with mock.patch.object(queue.sys, 'argv', ['gpu-queue.py', *argv]), \
             mock.patch.object(queue.signal, 'signal'), mock.patch.object(queue.time, 'sleep'), \
             mock.patch.object(queue, 'status', return_value=(0, {})), \
             mock.patch.object(queue, 'headroom', return_value=None), \
             mock.patch.object(queue.threading, 'Thread', return_value=mock.Mock()), \
             mock.patch.object(queue.subprocess, 'call', side_effect=call or (lambda cmd: 0)), \
             contextlib.redirect_stderr(io.StringIO()) as err:
            return queue.main(), err.getvalue()

    def test_short_job_is_filed_in_the_short_lane(self):
        # the 2026-10-27 case: a 2 s check clip waited behind a 40-minute capture
        seen = []
        def look(cmd):
            seen.extend(p.name for p in self.directory.glob('*.ticket'))
            return 0
        rc, _ = self.run_job(['--name', 'check', '--priority', '2', '--est', '30', '--', 'example'], look)
        self.assertEqual(rc, 0)
        self.assertEqual(len(seen), 1)
        self.assertTrue(seen[0].startswith('0-'), seen)

    def test_short_ticket_is_the_head_for_the_guard_too(self):
        # the browser guard reads only names: <priority>-<arrival>-<pid>.ticket, lowest first
        queue.ensure_queue_dir()
        for name in ['1-100-11.ticket', '0-300-12.ticket']:
            (self.directory / name).write_text('{}')
        with mock.patch.object(queue, 'alive', return_value=True):
            self.assertEqual(queue.tickets()[0][3], '0-300-12.ticket')

    def test_long_ticket_ages_into_the_short_lane(self):
        clock = iter(range(0, 10_000, 400))
        names = []
        real_tickets = queue.tickets
        def tickets(poll=30):
            q = real_tickets(poll)
            names.append([t[3] for t in q])
            # a short job ahead keeps the long one waiting until it has aged
            return [(0, 1, 1, 'ahead')] + q if len(names) < 3 else q
        with mock.patch.dict(os.environ, {'GPU_QUEUE_AGE_SEC': '600'}), \
             mock.patch.object(queue.time, 'time', side_effect=lambda: float(next(clock))), \
             mock.patch.object(queue, 'tickets', side_effect=tickets):
            rc, err = self.run_job(['--name', 'capture', '--priority', '1', '--', 'example'])
        self.assertEqual(rc, 0)
        self.assertTrue(names[0][0].startswith('1-'))
        self.assertTrue(any(n and n[0].startswith('0-') for n in names[1:]))
        self.assertIn('now in the short lane', err)

    def test_history_and_stats(self):
        rc, _ = self.run_job(['--name', 'clip', '--est', '20', '--', 'example'])
        self.assertEqual(rc, 0)
        rc, _ = self.run_job(['--name', 'capture', '--priority', '1', '--', 'example'], lambda cmd: 3)
        self.assertEqual(rc, 3)
        lines = [json.loads(l) for l in (self.directory / 'history.jsonl').read_text().splitlines()]
        self.assertEqual([(e['name'], e['lane'], e['rc']) for e in lines], [('clip', 'short', 0), ('capture', 'long', 3)])
        self.assertTrue(all(e['waited'] >= 0 and e['ran'] >= 0 for e in lines))
        out = io.StringIO()
        rows = queue.stats(12, out=out)
        self.assertEqual(len(rows), 2)
        self.assertIn('short', out.getvalue()); self.assertIn('long', out.getvalue()); self.assertIn('failed 1', out.getvalue())


class SlotUseTests(unittest.TestCase):
    """A slot is for the GPU: a job that never opens it gives the slot back; GPU and guarded jobs keep it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ticket = os.path.join(self.tmp.name, 'job.ticket')
        open(self.ticket, 'w').write('{}')
        self.device = os.path.join(self.tmp.name, 'nvidia0')
        open(self.device, 'w').write('')
        self.old_device, queue.GPU_DEVICE = queue.GPU_DEVICE, self.device

    def tearDown(self):
        queue.GPU_DEVICE = self.old_device
        self.tmp.cleanup()

    def watch(self, cmd, grace=1):
        """Run keep_alive while a child of this process runs `cmd`; report (ticket released, ticket on disk)."""
        import subprocess, sys, threading
        job = subprocess.Popen([sys.executable, '-c', cmd, self.device, 'browser_guard.py' if 'guard' in cmd else 'x'])
        stopped = threading.Event()
        done = threading.Event()
        with mock.patch.object(queue, 'require_host'), contextlib.redirect_stderr(io.StringIO()):
            t = threading.Thread(target=lambda: (queue.keep_alive(self.ticket, {'name': 't'}, 1, stopped, grace),
                                                 done.set()))
            t.start()
            t.join(timeout=4)
            stopped.set(); t.join()
        job.kill(); job.wait()
        return not os.path.exists(self.ticket), os.path.exists(self.ticket)

    def test_cpu_only_job_releases_its_slot(self):
        self.assertEqual(self.watch('import time; time.sleep(30)'), (True, False))

    def test_job_holding_the_gpu_keeps_its_slot(self):
        self.assertEqual(self.watch('import sys, time; f = open(sys.argv[1]); time.sleep(30)'), (False, True))

    def test_guarded_job_keeps_its_slot(self):
        self.assertEqual(self.watch('import time; guard = 1; time.sleep(30)'), (False, True))

    def test_tree_includes_grandchildren(self):
        import subprocess, sys
        job = subprocess.Popen(['sh', '-c', 'sleep 30 & wait'])
        try:
            import time; time.sleep(0.3)
            self.assertGreaterEqual(len(queue.process_tree(job.pid)), 2)
        finally:
            job.kill(); job.wait()

    def test_grace_override_and_off_switch(self):
        with mock.patch.dict(os.environ, {'GPU_QUEUE_IDLE_GRACE': '0'}):
            self.assertEqual(queue.idle_grace(), 0)
        with mock.patch.dict(os.environ, {'GPU_QUEUE_IDLE_GRACE': 'x'}):
            self.assertEqual(queue.idle_grace(), 600)

if __name__ == '__main__':
    unittest.main()
