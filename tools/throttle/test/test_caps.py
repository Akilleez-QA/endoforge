"""Task caps, live: a runaway under heavy-run, gpu-queue.py and `workers run` stops at the cap within seconds, a normal
command is untouched (output, $ in arguments, exit codes 75 and 78, death by signal), log mode only reports, and
without a systemd user manager the job runs uncapped after a warning. A nested job never gets weaker limits than its
caller, and a failing systemd-run still runs the job. run.sh runs this inside a capped scope too.

Production state is never touched: heavy-run's jobs go to a per-run test slice (THROTTLE_SLICE, created with
runtime properties and removed in tearDownModule and at exit), scopes are named thrtest<pid>-... (THROTTLE_SCOPE_TAG),
no unit file is written, and no daemon-reload is run: the slice's runtime drop-in directory is removed directly
(`systemctl revert` would reload the user manager)."""
import atexit
import glob
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE = pathlib.Path(__file__).resolve().parent
TOOLS = HERE.parent
BOMB = str(HERE / 'forkbomb.sh')
CAP = 64
# reads its own cgroup's pids.max, prints $HOME unexpanded by systemd-run, then exits with the code in $1
PROBE = ['bash', '-c', 'cat "/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/self/cgroup)/pids.max"; echo "$HOME"; exit "$1"',
         'probe']
# the real gpu-queue CLI (main, then exit) with the GPU checks stubbed: no GPU is touched
GPU_CLI = ('import importlib.machinery as m, importlib.util as u, os, sys\n'
           'l = m.SourceFileLoader("q", sys.argv[1]); q = u.module_from_spec(u.spec_from_loader("q", l)); l.exec_module(q)\n'
           'q.status = lambda: (0, {}); q.headroom = lambda *a, **k: None; q.require_host = lambda *a, **k: None\n'
           'run_job = q.run_job\n'
           'def logged(cmd, name):\n'
           '    open(os.path.join(q.QDIR, "started"), "w").write("running")\n'
           '    return run_job(cmd, name)\n'
           'q.run_job = logged\n'
           'sys.argv = ["gpu-queue.py", "--name", "sigtest", "--poll", "5", "--", *sys.argv[2:]]\n'
           'q.cli()\n')
GPU_DRIVER = ('import importlib.machinery as m, importlib.util as u, sys\n'
              'l = m.SourceFileLoader("q", sys.argv[1]); q = u.module_from_spec(u.spec_from_loader("q", l))\n'
              'l.exec_module(q); rc = q.run_job(sys.argv[2:], "captest")[0]\n'
              'import os, signal\n'
              'if rc < 0: signal.signal(-rc, signal.SIG_DFL); os.kill(os.getpid(), -rc)\n'
              'sys.exit(rc)\n')


def systemd_scopes():
    return shutil.which('systemd-run') and subprocess.run(['systemctl', '--user', 'show-environment'],
                                                          capture_output=True).returncode == 0


def bombs():
    """pid -> cgroup of every running copy of the stand-in."""
    out = {}
    for d in glob.glob('/proc/[0-9]*'):
        try:
            with open(d + '/cmdline', 'rb') as fh:
                argv = fh.read().split(b'\0')
            if len(argv) > 1 and argv[1].decode(errors='replace') == BOMB:
                with open(d + '/cgroup') as fh:
                    out[int(d[6:])] = next(l[3:].strip() for l in fh if l.startswith('0::'))
        except (OSError, StopIteration):
            pass
    return out


def kill_bombs():
    for pid in bombs():
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


TEST_SLICE = f'thrtest_{os.getpid()}.slice'           # no dash: a dash would nest it under a parent slice
TAG = f'thrtest{os.getpid()}-'
SLICE_TASKS, SLICE_MEM = 1024, 4 << 30                 # stands in for heavy.slice's ceilings
# prints {"cg": its cgroup, "pids.max": .., "memory.max": .., "cpu": ..}: the tightest limits on its cgroup chain
LIMITS = ['python3', '-c', 'import json\n'
          'cg = open("/proc/self/cgroup").read().split("0::")[1].strip(); parts, out = cg.strip("/").split("/"), {}\n'
          'for i in range(len(parts), 0, -1):\n'
          '    d = "/sys/fs/cgroup/" + "/".join(parts[:i])\n'
          '    for k in ("pids.max", "memory.max", "cpu.max"):\n'
          '        try: v = open(d + "/" + k).read().split()\n'
          '        except OSError: continue\n'
          '        v = int(v[0]) * 100 // int(v[1]) if k == "cpu.max" and v[0].isdigit() else int(v[0]) if v[0].isdigit() else None\n'
          '        if v is not None: out[k] = min(out.get(k, v), v)\n'
          'print(json.dumps({"cg": cg, **out}))']


def remove_test_units():
    if not systemd_scopes():
        return
    units = subprocess.run(['systemctl', '--user', 'list-units', '--all', '--plain', '--no-legend', f'{TAG}*',
                            TEST_SLICE], capture_output=True, text=True).stdout.split()
    units = [u for u in units if u.startswith((TAG, TEST_SLICE))]
    if units:
        subprocess.run(['systemctl', '--user', 'stop', *units], capture_output=True)
    subprocess.run(['systemctl', '--user', 'stop', TEST_SLICE], capture_output=True)
    runtime = os.environ.get('XDG_RUNTIME_DIR') or f'/run/user/{os.getuid()}'
    shutil.rmtree(f'{runtime}/systemd/user.control/{TEST_SLICE}.d', ignore_errors=True)


def setUpModule():
    if systemd_scopes():
        atexit.register(remove_test_units)
        subprocess.run(['systemctl', '--user', 'set-property', '--runtime', TEST_SLICE, f'TasksMax={SLICE_TASKS}',
                        f'MemoryMax={SLICE_MEM}'], check=True)


def tearDownModule():
    remove_test_units()


@unittest.skipUnless(systemd_scopes(), 'no systemd user manager')
class Caps(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.addCleanup(kill_bombs)
        repo = self.tmp / 'repo' / 'aors'
        repo.mkdir(parents=True)
        (repo / 'fleet.json').write_text(json.dumps({'bots': [{'slug': 'grok-bot'}]}))
        self.env = {**os.environ, 'XDG_STATE_HOME': str(self.tmp / 'state'), 'WORKERS_DIR': str(self.tmp / 'reg'),
                    'AKILLEEZ_ROOT': str(self.tmp / 'repo'), 'HEAVY_MAX_LOAD': '100000', 'HEAVY_RESERVE_GB': '1',
                    'HEAVY_SLOTS': '50', 'HEAVY_TASKS_MAX': str(CAP), 'GPU_QUEUE_TASKS_MAX': str(CAP),
                    'WORKERS_TASKS_MAX': str(CAP), 'THROTTLE_SLICE': TEST_SLICE, 'THROTTLE_SCOPE_TAG': TAG}
        for k in ('WORKERS_REGISTERED', 'THROTTLE_TASKS'):
            self.env.pop(k, None)

    def launch(self, which, cmd):
        return {'heavy-run': [str(TOOLS / 'heavy-run'), '--mem', '1', '--name', 'captest', '--', *cmd],
                'gpu-queue': [sys.executable, '-c', GPU_DRIVER, str(TOOLS / 'gpu-queue.py'), *cmd],
                'workers': [sys.executable, str(TOOLS / 'workers'), 'run', '--bot', 'grok-bot', '--', *cmd]}[which]

    def runaway(self, which):
        env = {**self.env, 'FORKBOMB_UNTIL': str(int(time.time()) + 20)}
        proc = subprocess.Popen(self.launch(which, [BOMB]), env=env, stderr=subprocess.DEVNULL, start_new_session=True)
        start, most, hit, cg = time.time(), 0, None, None
        try:
            while time.time() - start < 6:
                found = bombs()
                most = max(most, len(found))
                if len(found) > 3 * CAP:                      # second line of defence: the cap did not hold
                    kill_bombs()
                    self.fail(f'{which}: {len(found)} copies, cap {CAP} did not hold')
                cg = cg or next(iter(found.values()), None)
                if cg and hit is None:
                    with open(f'/sys/fs/cgroup{cg}/pids.events') as fh:
                        if int(fh.read().split()[1]) > 0:     # the kernel refused a fork at pids.max
                            hit = time.time() - start
                if hit is not None and time.time() - start > hit + 2:
                    break
                time.sleep(0.05)
        finally:
            kill_bombs()
            proc.wait(15)
        self.assertIsNotNone(hit, f'{which}: never reached the cap')
        self.assertLess(hit, 5, f'{which}: took {hit:.1f} s to reach the cap')
        self.assertLessEqual(most, CAP, which)
        self.assertGreaterEqual(most, CAP // 2, which)      # it really ran away, up to the cap
        print(f'\n  {which}: runaway held at {most} processes (cap {CAP} tasks), cap reached in {hit:.2f} s',
              file=sys.stderr)
        self.assertEqual(bombs(), {})

    def test_runaway_stops_at_the_cap(self):
        for which in ('heavy-run', 'gpu-queue', 'workers'):
            with self.subTest(which):
                self.runaway(which)

    def test_normal_command_unaffected(self):
        for which in ('heavy-run', 'gpu-queue', 'workers'):
            for code in (0, 75, 78):
                with self.subTest(which, code=code):
                    r = subprocess.run(self.launch(which, [*PROBE, str(code)]), env=self.env, capture_output=True,
                                       text=True, timeout=60)
                    self.assertEqual(r.returncode, code, r.stderr)
                    self.assertEqual(r.stdout.split(), [str(CAP), os.environ['HOME']])
            with self.subTest(which, signal='TERM'):
                r = subprocess.run(self.launch(which, ['bash', '-c', 'kill -TERM $$']), env=self.env, timeout=60)
                # heavy-run supervises its job (#439) and reports a signal death as 128 + N; the others die by it
                self.assertEqual(r.returncode, 143 if which == 'heavy-run' else -signal.SIGTERM)

    def test_nested_launcher_stays_under_the_outer_cap(self):
        # gpu-queue.py inside `workers run`: the inner launcher keeps the outer scope (and its cap) instead of a new one
        inner = self.launch('gpu-queue', [*PROBE, '0'])
        r = subprocess.run(self.launch('workers', inner), env={**self.env, 'GPU_QUEUE_TASKS_MAX': '4096'},
                           capture_output=True, text=True, timeout=60)
        self.assertEqual((r.returncode, r.stdout.split()[0]), (0, str(CAP)), r.stderr)

    def test_log_mode_reports_without_capping(self):
        env = {**self.env, 'THROTTLE_TASKS': 'log'}
        for which in ('gpu-queue', 'workers', 'heavy-run'):
            with self.subTest(which):
                r = subprocess.run(self.launch(which, [*PROBE, '0']), env=env, capture_output=True, text=True,
                                   timeout=60)
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertIn(f'would cap at {CAP} tasks', r.stderr)
                self.assertNotEqual(r.stdout.split()[0], str(CAP))

    def limits(self, argv, env):
        r = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout.strip().splitlines()[-1])

    def outer(self, *props, slice_=None):
        """An outer capped context (an app, endoforge's run scope): a scope with these properties."""
        return ['systemd-run', '--user', '--scope', '--quiet', f'--unit={TAG}outer-{time.time_ns()}',
                *([f'--slice={slice_}'] if slice_ else []), *[a for p in props for a in ('-p', p)], '--']

    def test_nested_job_keeps_the_callers_limits(self):
        # B1 (E1, E3): the caller's scope sits in a heavy.slice-like slice with a loose task cap and MemoryMax 2G
        for which in ('workers', 'gpu-queue'):
            with self.subTest(which):
                got = self.limits(self.outer('TasksMax=8192', 'MemoryMax=2G', 'CPUQuota=150%', slice_=TEST_SLICE)
                                  + self.launch(which, LIMITS), self.env)
                self.assertIn(f'/{TEST_SLICE}/', got['cg'])                     # never moved out to app.slice
                self.assertIn(TAG, got['cg'])                                   # its own scope, its own cap
                self.assertLessEqual(got['pids.max'], CAP)
                self.assertLessEqual(got['memory.max'], 2 << 30)
                self.assertLessEqual(got['cpu.max'], 150)
        # heavy-run moves the job to its slice; the caller's tighter task cap and MemoryMax go with it
        got = self.limits(self.outer('TasksMax=50', 'MemoryMax=2G') + self.launch('heavy-run', LIMITS), self.env)
        self.assertIn(f'/{TEST_SLICE}/', got['cg'])
        self.assertLessEqual(got['pids.max'], 50)
        self.assertLessEqual(got['memory.max'], 2 << 30)

    def test_log_mode_chain_keeps_the_callers_limits(self):
        # B1 (E2): THROTTLE_TASKS=log, outer TasksMax 50 and MemoryMax 2G -> heavy-run -> workers run
        env = {**self.env, 'THROTTLE_TASKS': 'log'}
        got = self.limits(self.outer('TasksMax=50', 'MemoryMax=2G') + self.launch('heavy-run', self.launch('workers', LIMITS)),
                          env)
        self.assertIn(f'/{TEST_SLICE}/', got['cg'])
        self.assertLessEqual(got['pids.max'], 50)
        self.assertLessEqual(got['memory.max'], 2 << 30)

    def test_heavy_run_keeps_its_slice_in_every_mode(self):
        for mode in ('log', 'off'):
            with self.subTest(mode):
                got = self.limits(self.launch('heavy-run', LIMITS), {**self.env, 'THROTTLE_TASKS': mode})
                self.assertIn(f'/{TEST_SLICE}/', got['cg'])

    def test_endoforge_chain_stays_in_the_slice(self):
        # B1 (E3): endoforge's run scope (heavy-run --scope-argv, as endoforge uses it) -> codex-pool -> workers run
        env = {k: v for k, v in self.env.items() if k not in ('HEAVY_TASKS_MAX', 'WORKERS_TASKS_MAX')}
        scope = subprocess.run([str(TOOLS / 'heavy-run'), '--scope-argv'], env=env, capture_output=True, text=True,
                               check=True).stdout.splitlines()
        job = int(next(a for a in scope if a.startswith('TasksMax=')).split('=')[1])
        self.assertEqual(job, max(1024, 128 * os.cpu_count()))           # the run has a finite cap of its own
        pool = ['bash', '-c', 'exec "$@"', 'codex-pool']
        got = self.limits(scope + pool + self.launch('workers', LIMITS), env)
        self.assertIn(f'/{TEST_SLICE}/', got['cg'])
        self.assertLessEqual(got['pids.max'], job)
        self.assertIn('--scope-argv', (TOOLS.parent / 'runtime' / 'endoforge').read_text())

    def history(self):
        return [json.loads(l) for l in (self.tmp / 'reg' / 'history.jsonl').read_text().splitlines()]

    def fake_systemd_run(self):
        fake = self.tmp / 'bin'
        fake.mkdir(exist_ok=True)
        (fake / 'systemd-run').write_text('#!/bin/sh\necho "Failed to start transient scope unit: Unit x.scope was '
                                          'already loaded or has a fragment file." >&2\nexit 1\n')
        (fake / 'systemd-run').chmod(0o755)
        return {**self.env, 'PATH': f'{fake}:{os.environ["PATH"]}'}

    def test_failing_systemd_run_still_runs_the_job(self):
        # M4: systemd-run itself fails (a unit it cannot create, the bus gone): workers and gpu-queue warn once and
        # run the job uncapped
        ran, env = self.tmp / 'ran', self.fake_systemd_run()
        job = ['bash', '-c', f'echo run >> {ran}; exit 1']
        for which in ('workers', 'gpu-queue'):
            with self.subTest(which):
                ran.unlink(missing_ok=True)
                r = subprocess.run(self.launch(which, job), env=env, capture_output=True, text=True, timeout=60)
                self.assertEqual((r.returncode, ran.read_text()), (1, 'run\n'), r.stderr)
                self.assertIn('systemd-run failed (exit 1); running uncapped', r.stderr)
        self.assertEqual(self.history()[-1]['tasks_cap']['mode'], 'fallback')

    def test_heavy_run_refuses_rather_than_run_outside_its_slice(self):
        # N-M4 (second review): a heavy job in the caller's cgroup (the Claude app's scope) is worse than a refused one
        ran = self.tmp / 'ran'
        job = self.launch('heavy-run', ['bash', '-c', f'echo run >> {ran}'])
        for why, env in (('systemd-run fails', self.fake_systemd_run()),
                         ('the user manager does not answer', {**self.env, 'DBUS_SESSION_BUS_ADDRESS': 'unix:path=/nonexistent',
                                                              'XDG_RUNTIME_DIR': str(self.tmp / 'no')})):
            with self.subTest(why):
                r = subprocess.run(job, env=env, capture_output=True, text=True, timeout=60)
                self.assertEqual(r.returncode, 78, r.stderr)
                self.assertIn('refusing', r.stderr)
                self.assertFalse(ran.exists())

    def test_a_job_that_exits_1_is_not_a_fallback(self):
        ran = self.tmp / 'ran'
        for which in ('workers', 'gpu-queue', 'heavy-run'):
            with self.subTest(which):
                ran.unlink(missing_ok=True)
                r = subprocess.run(self.launch(which, ['bash', '-c', f'echo run >> {ran}; exit 1']), env=self.env,
                                   capture_output=True, text=True, timeout=60)
                self.assertEqual((r.returncode, ran.read_text()), (1, 'run\n'), r.stderr)
                self.assertNotIn('systemd-run failed', r.stderr)
                self.assertNotIn('refusing', r.stderr)
        self.assertEqual(self.history()[-1]['tasks_cap']['mode'], 'enforce')

    def test_gpu_queue_cli_reports_a_signal_death(self):
        # m1: the real CLI path (main -> sys.exit) turned -15 into 241; SIGTERM to gpu-queue left rc null in history
        env = {**self.env, 'GPU_QUEUE_DIR': str(self.tmp / 'gq')}
        r = subprocess.run([sys.executable, '-c', GPU_CLI, str(TOOLS / 'gpu-queue.py'), 'bash', '-c', 'kill -TERM $$'],
                           env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, -signal.SIGTERM, r.stderr)
        p = subprocess.Popen([sys.executable, '-c', GPU_CLI, str(TOOLS / 'gpu-queue.py'), 'sleep', '30'], env=env,
                             stderr=subprocess.DEVNULL)
        started = self.tmp / 'gq' / 'started'
        for _ in range(200):
            if started.exists():
                break
            time.sleep(0.1)
        time.sleep(0.5)
        p.send_signal(signal.SIGTERM)
        self.assertEqual(p.wait(30), -signal.SIGTERM)
        last = json.loads((self.tmp / 'gq' / 'history.jsonl').read_text().splitlines()[-1])
        self.assertEqual(last['rc'], -signal.SIGTERM)
        self.assertEqual(last['tasks_cap']['mode'], 'enforce')

    def test_gpu_queue_cli_exit_for_signals_python_cannot_reraise(self):
        # N-M1 / N-m1 (second review): signal.signal(SIGKILL) raised, giving rc 1; SEGV left a Python core dump
        env = {**self.env, 'GPU_QUEUE_DIR': str(self.tmp / 'gq')}
        r = subprocess.run([sys.executable, '-c', GPU_CLI, str(TOOLS / 'gpu-queue.py'), 'bash', '-c', 'kill -KILL $$'],
                           env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 137, r.stderr)
        self.assertNotIn('Traceback', r.stderr)
        stub = ('import importlib.machinery as m, importlib.util as u, sys\n'
                'l = m.SourceFileLoader("q", sys.argv[1]); q = u.module_from_spec(u.spec_from_loader("q", l)); '
                'l.exec_module(q)\nq.main = lambda: -int(sys.argv[2]); q.cli()\n')
        for sig, want in ((signal.SIGSEGV, 139), (signal.SIGABRT, 134), (signal.SIGQUIT, 131), (signal.SIGKILL, 137),
                          (signal.SIGTERM, -signal.SIGTERM)):
            with self.subTest(sig=sig.name):
                r = subprocess.run([sys.executable, '-c', stub, str(TOOLS / 'gpu-queue.py'), str(int(sig))], env=env)
                self.assertEqual(r.returncode, want)

    def test_gpu_queue_holds_its_ticket_until_an_interrupted_job_ends(self):
        # N-M3 (second review): SIGINT released the ticket while the job ran on, and the next job overlapped it
        env = {**self.env, 'GPU_QUEUE_DIR': str(self.tmp / 'gq')}
        for sig in (signal.SIGINT, signal.SIGHUP):
            with self.subTest(sig=sig.name):
                log = self.tmp / f'overlap.{sig.name}'
                first = (f'trap "sleep 1.5; echo end1 $(date +%s.%N) >> {log}; exit 5" {sig.name[3:]}; '
                         f'echo start1 $(date +%s.%N) >> {log}; while :; do sleep 0.1; done')
                second = f'echo start2 $(date +%s.%N) >> {log}'
                one = subprocess.Popen([sys.executable, '-c', GPU_CLI, str(TOOLS / 'gpu-queue.py'), 'bash', '-c', first],
                                       env=env, stderr=subprocess.DEVNULL)
                for _ in range(200):
                    if log.exists():
                        break
                    time.sleep(0.05)
                two = subprocess.Popen([sys.executable, '-c', GPU_CLI, str(TOOLS / 'gpu-queue.py'), 'bash', '-c', second],
                                       env=env, stderr=subprocess.DEVNULL)
                time.sleep(1)
                one.send_signal(sig)
                self.assertEqual(one.wait(30), 5)
                self.assertEqual(two.wait(30), 0)
                rows = dict(l.split() for l in log.read_text().splitlines())
                self.assertGreaterEqual(float(rows['start2']), float(rows['end1']), rows)
                hist = [json.loads(l) for l in (self.tmp / 'gq' / 'history.jsonl').read_text().splitlines()]
                self.assertIn(5, [h['rc'] for h in hist])

    def test_without_systemd_it_warns_and_runs_uncapped(self):
        env = {**self.env, 'DBUS_SESSION_BUS_ADDRESS': 'unix:path=/nonexistent', 'XDG_RUNTIME_DIR': str(self.tmp / 'no')}
        for which in ('gpu-queue', 'workers'):              # heavy-run refuses instead (test_heavy_run_refuses_...)
            with self.subTest(which):
                r = subprocess.run(self.launch(which, [*PROBE, '75']), env=env, capture_output=True, text=True,
                                   timeout=60)
                self.assertEqual(r.returncode, 75, r.stderr)
                self.assertIn('uncapped', r.stderr)
                self.assertNotEqual(r.stdout.split()[0], str(CAP))


if __name__ == '__main__':
    unittest.main()
