"""fleet-disconnect and the capacity dial: ramp, drain, wait and resume on temporary fixtures; nothing touches this machine."""
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

HERE = pathlib.Path(__file__).resolve().parent.parent
TOOL, HR = HERE / 'fleet-disconnect', HERE / 'heavy-run'
SPEC = importlib.util.spec_from_file_location('gpu_queue_dial', HERE / 'gpu-queue.py')
queue = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(queue)


class Fleet(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root = pathlib.Path(t.name)
        for d in ('state', 'queue', 'cg/heavy.slice', 'proc'):
            (self.root / d).mkdir(parents=True)
        self.hooks = self.root / 'hooks.json'
        self.env = dict(os.environ, FLEET_STATE_DIR=str(self.root / 'state'), FLEET_HOOKS=str(self.hooks),
                        GPU_QUEUE_DIR=str(self.root / 'queue'), FLEET_CGROUP_ROOT=str(self.root / 'cg'),
                        FLEET_PROC=str(self.root / 'proc'), FLEET_NO_SYSTEMD='1', XDG_STATE_HOME=str(self.root))

    def run_tool(self, *args):
        return subprocess.run([str(TOOL), *args], env=self.env, capture_output=True, text=True, timeout=60)

    def status(self):
        return json.loads(self.run_tool('status', '--json').stdout)

    def test_ramp_drain_resume_round_trip_runs_hooks_and_keeps_a_receipt(self):
        log = self.root / 'hook.log'
        self.hooks.write_text(json.dumps([{
            'name': 'lanes', 'ramp': f'echo ramp $FLEET_PERCENT >> {log}', 'drain': f'echo drain >> {log}',
            'resume': f'echo resume >> {log}', 'auto_resume': True}]))
        self.assertEqual(self.status()['capacity'], 100)
        self.assertEqual(self.run_tool('ramp', '40', '--reason', 'reboot soon').returncode, 0)
        self.assertEqual(self.status()['capacity'], 40)
        out = self.run_tool('drain', '--reason', 'reboot')
        self.assertIn('Wrap up now', out.stdout)
        self.assertEqual(self.status()['capacity'], 0)
        self.assertTrue((self.root / 'state/DRAIN').exists())
        self.run_tool('resume')
        self.assertEqual(self.status()['capacity'], 100)
        self.assertFalse((self.root / 'state/DRAIN').exists() or (self.root / 'state/CAPACITY').exists())
        self.assertEqual(log.read_text().split('\n')[:4], ['ramp 40', 'drain', 'ramp 100', 'resume'])
        events = [e['event'] for e in json.loads((self.root / 'state/current.json').read_text())['events']]
        self.assertEqual(events, ['ramp', 'drain', 'resume'])

    def test_manual_hooks_are_listed_not_resumed(self):
        flag = self.root / 'STOP'
        self.hooks.write_text(json.dumps([{'name': 'codex', 'drain': f'touch {flag}', 'resume': f'rm -f {flag}'}]))
        self.run_tool('drain', '--reason', 'reboot')
        self.assertTrue(flag.exists())
        out = self.run_tool('resume').stdout
        self.assertTrue(flag.exists())
        self.assertIn('not resumed automatically', out)

    def test_wait_clears_only_when_nothing_is_in_flight(self):
        job = self.root / 'cg/heavy.slice/heavy-render-1.scope'
        job.mkdir()
        (job / 'cgroup.procs').write_text('4242\n')
        (self.root / 'queue/1-1-99.ticket').write_text(json.dumps({'name': 'plate', 'pid': 99}))
        busy = self.root / 'busy'
        busy.touch()
        self.hooks.write_text(json.dumps([{'name': 'lanes', 'busy': f'test -e {busy} && echo lane A'}]))
        out = self.run_tool('wait', '--timeout', '0', '--poll', '0.1')
        self.assertEqual(out.returncode, 1)
        for what in ('heavy-render-1.scope', 'GPU ticket plate', 'lane A'):
            self.assertIn(what, out.stdout)
        (job / 'cgroup.procs').write_text('')
        (self.root / 'queue/1-1-99.ticket').unlink()
        busy.unlink()
        self.assertEqual(self.run_tool('wait', '--timeout', '5', '--poll', '0.1').returncode, 0)

    def test_heavy_run_refuses_new_work_at_zero(self):
        env = dict(self.env, HEAVY_MAX_LOAD='100000', HEAVY_RESERVE_GB='1')
        (self.root / 'state/DRAIN').write_text('reboot\n')
        r = subprocess.run([str(HR), '--name', 'x', '--', 'true'], env=env, capture_output=True, text=True, timeout=20)
        self.assertEqual(r.returncode, 75)
        self.assertIn('draining', r.stderr)

    def test_queue_limits_follow_the_dial(self):
        health = self.root / 'health.json'
        health.write_text(json.dumps({'gpus': [{'framebuffer_mib': {'used': 4000, 'total': 16000},
                                                 'bar1_mib': {'used': 100, 'total': 16000}}]}))
        meminfo = self.root / 'meminfo'
        meminfo.write_text('MemTotal: 130000000 kB\nMemAvailable: 90000000 kB\n')
        with mock.patch.dict(os.environ, {'FLEET_STATE_DIR': str(self.root / 'state'), 'GPU_QUEUE_MAX_LOAD': '28'}):
            self.assertIsNone(queue.headroom(str(health), str(meminfo), load1=5))
            (self.root / 'state/CAPACITY').write_text('30 ramping down\n')       # VRAM 25 % >= 18 %: wait
            self.assertIn('framebuffer', queue.headroom(str(health), str(meminfo), load1=5))
            self.assertIsNone(queue.drain_reason())
            (self.root / 'state/DRAIN').write_text('reboot\n')
            self.assertEqual(queue.fleet_capacity()[0], 0)
            self.assertEqual(queue.drain_reason(), 'reboot')


if __name__ == '__main__':
    unittest.main()
