"""remote-run: paths stay under the shared roots, private files never leave, the host script stops its job when the
owner link closes, input syncs are strict, and (with REMOTE_RUN_TEST_HOST set) a real job round-trips."""
import importlib.machinery
import importlib.util
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

TOOL = pathlib.Path(__file__).resolve().parent.parent / 'remote-run'
LOADER = importlib.machinery.SourceFileLoader('remote_run', str(TOOL))
SPEC = importlib.util.spec_from_loader('remote_run', LOADER)
rr = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(rr)


class PathRules(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = os.path.realpath(self.temp.name)
        os.makedirs(os.path.join(self.root, 'shared', 'job'))
        os.makedirs(os.path.join(self.root, 'private'))
        patch = mock.patch.multiple(rr, ROOTS=[os.path.join(self.root, 'shared')],
                                    PRIVATE=[os.path.join(self.root, 'private')])
        patch.start()
        self.addCleanup(patch.stop)

    def test_relative_paths_resolve_against_cwd(self):
        cwd = os.path.join(self.root, 'shared', 'job')
        self.assertEqual(rr.check_path('in/a.txt', cwd), os.path.join(cwd, 'in', 'a.txt'))

    def test_trailing_slash_is_kept_for_directories(self):
        self.assertTrue(rr.check_path(os.path.join(self.root, 'shared', 'job') + '/', '/').endswith('/'))

    def test_outside_the_shared_roots_is_refused(self):
        with self.assertRaises(SystemExit):
            rr.check_path('/etc/hostname', '/')

    def test_dotdot_cannot_escape(self):
        with self.assertRaises(SystemExit):
            rr.check_path(os.path.join(self.root, 'shared', '..', 'private', 'x'), '/')

    def test_private_files_are_refused_even_through_a_symlink(self):
        link = os.path.join(self.root, 'shared', 'job', 'sneaky')
        os.symlink(os.path.join(self.root, 'private'), link)
        with self.assertRaises(SystemExit):
            rr.check_path(os.path.join(link, 'photo.jpg'), '/')


class HostScript(unittest.TestCase):
    def test_job_runs_under_heavy_run_with_the_shared_home(self):
        s = rr.driver('/mnt/x', 8, 'job', 'blender -b a.blend')
        self.assertIn('heavy-run" --mem 8 --name job -- env HOME=/home/user bash -c', s)
        self.assertIn('cd /mnt/x || exit 66', s)

    def test_owner_link_stops_the_job_and_status_passes_through(self):
        # The script runs locally with a stand-in heavy-run; closing its stdin must TERM the job.
        with tempfile.TemporaryDirectory() as home:
            os.makedirs(os.path.join(home, '.local', 'bin'))
            fake = os.path.join(home, '.local', 'bin', 'heavy-run')
            with open(fake, 'w') as fh:
                fh.write('#!/bin/bash\nwhile [ "$1" != -- ]; do shift; done; shift; exec "$@"\n')
            os.chmod(fake, 0o755)
            env = dict(os.environ, HOME=home)
            done = subprocess.Popen(['bash', '-c', rr.driver(home, 1, 't', 'exit 7')], env=env,
                                    stdin=subprocess.PIPE)   # held open, as remote-run holds it
            self.assertEqual(done.wait(timeout=20), 7)
            done.stdin.close()
            p = subprocess.Popen(['bash', '-c', rr.driver(home, 1, 't', 'sleep 60')], env=env,
                                 stdin=subprocess.PIPE)
            p.stdin.close()   # remote-run gone
            self.assertNotEqual(p.wait(timeout=20), 0)


class Rsync(unittest.TestCase):
    def test_partial_input_sync_stops_the_job(self):
        with mock.patch.object(rr.subprocess, 'run', return_value=subprocess.CompletedProcess([], 23, '', 'x')):
            with self.assertRaises(SystemExit):
                rr.rsync(['a', 'h:/'], 'inputs', strict=True)
            rr.rsync(['h:a', '/'], 'output a', strict=False)   # outputs only warn

    def test_copies_arrive_writable(self):
        with mock.patch.object(rr.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as run:
            rr.rsync(['a', 'h:/'], 'inputs', strict=True)
        self.assertIn('--chmod=u+w', run.call_args.args[0])


@unittest.skipUnless(os.environ.get('REMOTE_RUN_TEST_HOST'), 'set REMOTE_RUN_TEST_HOST to run against a real host')
class Live(unittest.TestCase):
    def test_round_trip(self):
        host = os.environ['REMOTE_RUN_TEST_HOST']
        base = os.environ.get('REMOTE_RUN_TEST_DIR', '/mnt/cold-steam/factory-scratch/remote-run-test')
        os.makedirs(os.path.join(base, 'in'), exist_ok=True)
        pathlib.Path(base, 'in', 'msg.txt').write_text('ping\n')
        p = subprocess.run([str(TOOL), '--host', host, '--in', base + '/in/', '--out', base + '/out/', '--cwd', base,
                            '--mem', '1', '--name', 'rr-live', '--',
                            'mkdir -p out; cat in/msg.txt > out/msg.txt; exit 5'], timeout=180)
        self.assertEqual(p.returncode, 5)
        self.assertEqual(pathlib.Path(base, 'out', 'msg.txt').read_text(), 'ping\n')


if __name__ == '__main__':
    unittest.main()
