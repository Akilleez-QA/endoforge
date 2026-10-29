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
        env = {'WORKERS_DIR': str(self.dir / 'state'), 'AKILLEEZ_ROOT': str(self.dir / 'repo'), 'WORKERS_BEAT': '0.05',
               'THROTTLE_SCOPE_TAG': f'thrtest{os.getpid()}-'}         # never the production scope names
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

    def test_inside_a_registered_worker_it_never_nests(self):
        # 2026-10-27: a launcher that re-ran itself under `workers run` recursed 465 deep; a nested run is now a plain exec
        with mock.patch.dict(os.environ, {'WORKERS_REGISTERED': '1'}):
            r = subprocess.run([sys.executable, str(TOOL), 'run', '--bot', 'grok-bot', '--', 'true'], env=os.environ.copy())
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.history(), [])
        self.assertFalse((self.dir / 'state' / 'live').exists() and list((self.dir / 'state' / 'live').glob('*.json')))

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


    def test_receipt_records_the_change(self):
        repo = self.dir / 'work'
        git = lambda *a: subprocess.run(['git', '-C', str(repo), *a], check=True, capture_output=True, text=True).stdout
        subprocess.run(['git', 'init', '-q', '-b', 'main', str(repo)], check=True)
        git('-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base')
        before = git('rev-parse', 'HEAD').strip()
        evidence = self.dir / 'run-dir'
        evidence.mkdir()
        job = (f'cd {repo} && echo one > a.txt && git add a.txt && git -c user.email=t@e -c user.name=t commit -qm one && '
               'echo two > b.txt && git add b.txt && exit 4')
        task = 'make a and b; push with https://x-access-token:ghs_16C7e42F292c6912E7710c838347Ae178B4a@github.com/o/r'
        with mock.patch.dict(os.environ, {'WORKERS_EVIDENCE': f'{evidence}{os.pathsep}{self.dir}/missing',
                                          'SECRET_THING': 'hunter2'}):
            rc, _, _ = self.main('run', '--bot', 'grok-bot', '--task', task, '--repo', str(repo), '--',
                                 'bash', '-c', job, '--token', 'ghp_abcdef', 'GITHUB_TOKEN=xyz')
        self.assertEqual(rc, 4)
        files = list((self.dir / 'state' / 'receipts').glob('*.json'))
        self.assertEqual(len(files), 1)
        r = json.loads(files[0].read_text())
        self.assertEqual(r['id'], files[0].stem)
        self.assertEqual((r['bot'], r['repo'], r['rc'], r['program'], r['argc']), ('grok-bot', str(repo), 4, 'bash', 5))
        self.assertEqual(r['task_hmac'], workers.digest(task))
        self.assertEqual(r['cmd_hmac'], workers.digest(['bash', '-c', job, '--token', 'ghp_abcdef', 'GITHUB_TOKEN=xyz']))
        self.assertNotIn('cmd', r)
        self.assertNotIn('task', r)
        self.assertEqual((r['before']['head'], r['before']['branch'], r['after']['branch']), (before, 'main', 'main'))
        self.assertNotEqual(r['after']['head'], before)
        self.assertIn('a.txt', ' '.join(r['diff_stat']['commits']))
        self.assertIn('b.txt', ' '.join(r['diff_stat']['worktree']))
        self.assertEqual([e['exists'] for e in r['evidence']], [True, False])
        self.assertGreaterEqual(r['ended'], r['started'])
        written = files[0].read_text() + (self.dir / 'state' / 'history.jsonl').read_text()
        for secret in ('hunter2', 'ghp_abcdef', 'xyz', 'SECRET_THING', 'ghs_16C7', 'echo one'):
            self.assertNotIn(secret, written)
        self.assertIn('make a and b', self.history()[-1]['task'])                  # the registry keeps a scrubbed label
        self.assertEqual((self.history()[-1]['cmd'], self.history()[-1]['argc']), (['bash'], 5))
        rc, out, _ = self.main('list', '--receipts', '5')
        self.assertIn(r['id'], out); self.assertIn('rc 4', out)
        rc, out, _ = self.main('receipt', r['id'])
        self.assertEqual(json.loads(out)['id'], r['id'])
        self.assertEqual(self.main('receipt', 'nope')[0], 66)

    def test_list_receipts_skips_a_bad_file(self):
        self.assertEqual(self.main('run', '--bot', 'grok-bot', '--', 'true')[0], 0)
        receipts = self.dir / 'state' / 'receipts'
        (receipts / 'broken.json').write_text('{not json')
        (receipts / 'noid.json').write_text('{"bot": "x"}')               # N-m3: valid JSON, not a receipt
        (receipts / 'list.json').write_text('[]')
        rc, out, err = self.main('list', '--receipts', '9')
        self.assertEqual(rc, 0)
        self.assertIn('true (0 args)', out)
        for name in ('broken.json', 'noid.json', 'list.json'):
            self.assertIn(f'skipping unreadable receipt {name}', err)
        self.assertEqual(self.main('list', '--receipts', '9', '--json')[0], 0)

    def test_receipt_without_git_and_for_a_signal(self):
        proc = subprocess.Popen([sys.executable, str(TOOL), 'run', '--bot', 'grok-bot', '--repo', str(self.dir), '--',
                                 'bash', '-c', 'kill -TERM $$'], env=os.environ.copy())
        self.assertEqual(proc.wait(30), -signal.SIGTERM)
        r = json.loads(next((self.dir / 'state' / 'receipts').glob('*.json')).read_text())
        self.assertEqual((r['signal'], r['before'], r['diff_stat']), ('SIGTERM', None, {}))

    def test_post_job_git_runs_no_repo_hooks(self):
        # m2: a job can write its repo's .git/config; the registry's own git calls must not run what it names
        repo, marker = self.dir / 'work', self.dir / 'fsmonitor-ran'
        subprocess.run(['git', 'init', '-q', '-b', 'main', str(repo)], check=True)
        subprocess.run(['git', '-C', str(repo), '-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-q',
                        '--allow-empty', '-m', 'base'], check=True)
        hook = self.dir / 'fsmon.sh'
        hook.write_text(f'#!/bin/sh\necho ran >> {marker}\nexit 1\n')
        hook.chmod(0o755)
        job = f'git -C {repo} config core.fsmonitor {hook} && echo x > {repo}/f'
        self.assertEqual(self.main('run', '--bot', 'grok-bot', '--repo', str(repo), '--', 'bash', '-c', job)[0], 0)
        self.assertFalse(marker.exists(), 'the job-planted fsmonitor ran in the registry process')

    def test_spawn_rate_alarm(self):
        # 2026-10-27: thousands of `unknown` registrations of the same codex-pool command within minutes
        for _ in range(30):
            workers.spawn_gate('grok-bot', 'codex-pool', 30)
        rc, _, err = self.main('run', '--bot', 'grok-bot', '--', 'codex-pool', 'run')
        self.assertEqual(rc, 75)
        self.assertIn('spawn-rate alarm', err)
        self.assertEqual(self.main('run', '--bot', 'grok-bot', '--', 'true')[0], 0)     # another command still runs

    def test_spawn_gate_counts_refusals_and_ignores_clock_steps(self):
        # M2: a retry loop stays refused while it keeps retrying; refusals are attempts too
        t0 = 1_000_000.0
        got = [workers.spawn_gate('grok-bot', 'prog', 3, now=t0 + i)[1] for i in range(3)]
        got += [workers.spawn_gate('grok-bot', 'prog', 3, now=t0 + 30 + i)[1] for i in range(30)]
        self.assertEqual(got, [True] * 3 + [False] * 30)
        self.assertFalse(workers.spawn_gate('grok-bot', 'prog', 3, now=t0 + 62)[1])     # the first 3 expired, retries not
        self.assertTrue(workers.spawn_gate('grok-bot', 'prog', 3, now=t0 + 200)[1])     # quiet for 60 s: allowed again
        self.assertTrue(workers.spawn_gate('grok-bot', 'prog', 3, now=t0 - 3600)[1])    # clock stepped back an hour

    def test_spawn_rate_alarm_holds_under_a_burst(self):
        # M2: 20 simultaneous launches with WORKERS_SPAWN_MAX=5 start at most 5 (the reviewer's run started 19)
        env = {**os.environ, 'WORKERS_SPAWN_MAX': '5'}
        procs = [subprocess.Popen([sys.executable, '-B', str(TOOL), 'run', '--bot', 'grok-bot', '--', 'sleep', '2'],
                                  env=env, stderr=subprocess.DEVNULL) for _ in range(20)]
        rcs = sorted(p.wait(60) for p in procs)
        self.assertEqual(rcs, [0] * 5 + [75] * 15)

    def test_spawn_gate_counts_a_program_whatever_its_arguments(self):
        # N-m2 (second review): `sleep 0.$i` or a changing argument no longer starts a fresh count
        with mock.patch.dict(os.environ, {'WORKERS_SPAWN_MAX': '3'}):
            rcs = [self.main('run', '--bot', 'grok-bot', '--', 'true', str(i))[0] for i in range(6)]
        self.assertEqual(rcs, [0, 0, 0, 75, 75, 75])

    def test_digests_are_keyed_per_host(self):
        # N-m4: a plain sha256 of a known command lets a short secret in it be confirmed by guessing
        cmd = ['mysql', '-psecret']
        d = workers.digest(cmd)
        key = self.dir / 'state' / 'digest.key'
        self.assertEqual(key.stat().st_mode & 0o777, 0o600)
        self.assertEqual(len(key.read_bytes()), 32)
        self.assertEqual(d, workers.digest(cmd))                                    # stable on this host
        self.assertNotEqual(d, __import__('hashlib').sha256(json.dumps(cmd).encode()).hexdigest())
        key.write_bytes(os.urandom(32))
        self.assertNotEqual(d, workers.digest(cmd))                                 # another host's key: no match

    def test_task_label_is_short_and_scrubbed(self):
        task = 'deploy with GITHUB_TOKEN=ghp_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5 then ' + 'x' * 200 + '\nsecond line'
        self.assertEqual(self.main('run', '--bot', 'grok-bot', '--task', task, '--', 'true')[0], 0)
        label = self.history()[-1]['task']
        self.assertLessEqual(len(label), 80)
        self.assertNotIn('ghp_', label)
        self.assertTrue(label.startswith('deploy with GITHUB_TOKEN=[redacted]'))

    def test_a_signal_death_is_reported_without_reset_or_core(self):
        # N-M1 / N-m1 (second review): signal.signal(SIGKILL) raised; core-dumping signals made a Python core dump
        r = subprocess.run([sys.executable, str(TOOL), 'run', '--bot', 'grok-bot', '--', 'bash', '-c', 'kill -KILL $$'],
                           env=os.environ.copy(), capture_output=True, text=True, timeout=30)
        self.assertEqual((r.returncode, r.stderr), (137, ''))
        self.assertEqual(self.history()[-1]['rc'], -signal.SIGKILL)
        code = 'import sys, importlib.machinery as m, importlib.util as u\n' \
               'l = m.SourceFileLoader("w", sys.argv[1]); w = u.module_from_spec(u.spec_from_loader("w", l)); ' \
               'l.exec_module(w)\nsys.exit(w.die_like(-int(sys.argv[2])))'
        for sig, want in ((signal.SIGSEGV, 139), (signal.SIGQUIT, 131), (signal.SIGABRT, 134), (signal.SIGKILL, 137),
                          (signal.SIGTERM, -signal.SIGTERM), (signal.SIGHUP, -signal.SIGHUP)):
            with self.subTest(sig=sig.name):
                self.assertEqual(subprocess.run([sys.executable, '-c', code, str(TOOL), str(int(sig))]).returncode, want)

    def test_int_and_quit_reach_the_worker_without_a_python_core(self):
        # started as a shell script's background job would be: INT and QUIT ignored on entry
        ignore = lambda: (signal.signal(signal.SIGINT, signal.SIG_IGN), signal.signal(signal.SIGQUIT, signal.SIG_IGN))
        for sig in (signal.SIGINT, signal.SIGQUIT):
            with self.subTest(sig=sig.name):
                proc = subprocess.Popen([sys.executable, str(TOOL), 'run', '--bot', 'grok-bot', '--', 'bash', '-c',
                                         f'trap "exit 9" {sig.name[3:]}; while :; do sleep 0.1; done'],
                                        env=os.environ.copy(), preexec_fn=ignore)
                live = self.dir / 'state' / 'live'
                for _ in range(100):
                    if live.exists() and list(live.glob('*.json')):
                        break
                    time.sleep(0.05)
                time.sleep(0.3)
                proc.send_signal(sig)
                self.assertEqual(proc.wait(10), 9)           # the job trapped it; workers ends as the job did
                for f in live.glob('*.json'):
                    f.unlink()

    # the reviewer's scrub_probe.py cases (2026-10-27): every secret leaked before
    SCRUB_CASES = [
        (['--password=hunter2'], 'hunter2'), (['--password', 'hunter2'], 'hunter2'), (['-p', 'hunter2'], 'hunter2'),
        (['mysql', '-psecretpw'], 'secretpw'), (['-H', 'Authorization: Bearer abc.def-ghi_jkl'], 'abc.def'),
        (['-H', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'], 'eyJhbG'),
        (['https://x-access-token:ghs_16C7e42F292c6912E7710c838347Ae178B4a@github.com/o/r.git'], 'ghs_16C7'),
        (['https://user:hunter2@example.com/repo'], 'hunter2'), (['DATABASE_URL=postgres://u:p4ssw0rd@db/x'], 'p4ssw0rd'),
        (['AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE'], 'AKIAIOSF'), (['AKIAIOSFODNN7EXAMPLE'], 'AKIAIOSF'),
        (["use the key 'sk-ant-api03-AbCd_EfGh-IjKl_MnOp-QrSt_UvWx-YzAb_CdEf-GhIj' please"], 'AbCd_EfGh'),
        (['token="ghp_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5"'], 'aB3dE5'), (['(xoxb-1234-5678-abcdEFGHijkl)'], 'abcdEFGH'),
        (['Slack token xoxb-1234-5678-abcdEFGH'], 'abcdEFGH'), (['sk_live_51Habc'], '51Habc'),
        (['-c', 'model_providers.x.api_key="sk-abc"'], 'sk-abc'), (['--header=X-Api-Key: abc123'], 'abc123'),
        (['--key', 'abc123def'], 'abc123def'), (['OPENAI_KEY=abc'], 'abc'),
        (['HF_TOKEN', 'hf_abcdefghijklmnopqrstuvwxyz12'], 'hf_abc'), (['hf_abcdefghijklmnopqrstuvwxyzABCD'], 'hf_abc'),
        (['npm_abcdefghijklmnopqrstuvwxyz0123456789'], 'npm_abc'), (['glpat-abcdefghij1234567890'], 'glpat-abc'),
        (['fix the bug; my GitHub PAT is github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ'
          'KLMNOPQRS ok'], '11ABCDEFG'), (['see /tmp/ghp_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5/x'], 'aB3dE5'),
        (['--auth', 'user:hunter2'], 'hunter2'),
        # second review (2026-10-27): fixed shapes, not free-text phrasings
        (['--passphrase hunter2'], 'hunter2'), (['curl -u admin:hunter2 https://x'], 'hunter2'),
        (['https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX'], 'XXXXXXXX'),
        (['bearer:abc123'], 'abc123'),
    ]

    def test_scrub_redacts_the_reviewers_cases(self):
        for words, secret in self.SCRUB_CASES:
            with self.subTest(words=words):
                self.assertNotIn(secret, ' '.join(workers.scrub(words)))
                self.assertIn('[redacted]', ' '.join(workers.scrub(words)))

    def test_scrub_keeps_ordinary_words(self):
        words = ['codex', '--cd', '/home/x/Code/akilleez-endoforge-long-path/a', '--author=Craig', '--author', 'Craig',
                 'claude-code/20261027-caps-receipts', 'task-runner', 'fix the bug in workers:251 please', 'x' * 300]
        self.assertEqual(workers.scrub(words), words[:-1] + ['x' * 200])
        self.assertEqual(workers.scrub(['--api-key', 'k', 'use sk-proj-abc now']), ['--api-key', '[redacted]',
                                                                                 'use [redacted] now'])


if __name__ == '__main__':
    unittest.main()
