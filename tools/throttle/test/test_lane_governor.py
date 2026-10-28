"""lane-governor: limits on made-up machines, the gates, the app-log sensors, crash replay, tickets, queue and hook."""
import importlib.util, io, json, os, pathlib, subprocess, sys, tempfile, time, unittest
from contextlib import redirect_stderr
from unittest import mock
HERE = pathlib.Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('lane_governor', HERE / 'lane-governor.py')
lg = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(lg)
GB = lg.GB
RIG = (32, 124 * GB)


def lim(threads=32, ram_gb=124, capacity=100, **env):
    return lg.limits(threads, ram_gb * GB, env, capacity)


def calm(**kw):
    s = {'in_use': 1, 'cli': 2, 'starts': 1, 'since_admit': None, 'growth': 0, 'tree_rss': 4 * GB, 'scope_anon': 2 * GB,
         'avail': 90 * GB, 'free': 10 * GB, 'psi': 0.5, 'load': 4.0}
    s.update(kw)
    return s


def stamp(t):
    return time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(t))


def memline(t, pid, rss_mb, children=40, cli=2, avail_mb=90000, free_mb=8000):
    return (f'{stamp(t)} [info] [process-memory] trigger=interval tree_rss_sum={rss_mb}MB tree_footprint_sum=1MB '
            f'electron(9)=1MB children({children})=1MB top=[electron_main:{pid}:300MB] kinds=[cli({cli}):9procs:fp=1MB:'
            f'rss=1MB] sys_free={avail_mb}MB/128437MB sys_free_raw={free_mb}MB\n')


class Limits(unittest.TestCase):
    def test_rig_gets_three_lanes(self):
        l = lim()
        self.assertEqual((l['lanes'], l['max_load']), (3, 28.0))
        self.assertAlmostEqual(l['growth'] / GB, 0.07 * 124)
        self.assertEqual(l['reserve'], 14 * GB)

    def test_scales_to_a_laptop_and_a_large_box(self):
        self.assertEqual(lim(8, 16)['lanes'], 1)
        self.assertEqual(lim(8, 16)['reserve'], 8 * GB)
        self.assertEqual(lim(128, 512)['lanes'], 6)
        self.assertEqual(lim(128, 512)['max_load'], 112.0)

    def test_overrides_win(self):
        self.assertEqual(lim(LANE_MAX='5', LANE_BURST='2')['lanes'], 5)
        self.assertEqual(lim(LANE_MAX_LOAD='9')['max_load'], 9.0)

    def test_fleet_dial_scales_lanes_and_load(self):
        self.assertEqual((lim(capacity=50)['lanes'], lim(capacity=50)['max_load']), (1, 14.0))
        self.assertEqual(lim(capacity=0)['lanes'], 0)
        self.assertIn('draining', lg.decide(calm(in_use=0), lim(capacity=0))[0])


class Gates(unittest.TestCase):
    def held(self, **kw):
        return [g for g, _ in lg.gates(calm(**kw), lim())]

    def test_calm_admits(self):
        self.assertEqual(lg.decide(calm(), lim()), [])

    def test_each_gate_holds(self):
        cases = {'lanes': dict(in_use=3), 'cli': dict(cli=8), 'burst': dict(starts=6), 'growth': dict(growth=9 * GB),
                 'tree': dict(tree_rss=25 * GB), 'memory': dict(avail=10 * GB), 'load': dict(load=28.0)}
        for gate, kw in cases.items():
            with self.subTest(gate):
                self.assertEqual(self.held(**kw), [gate])
        self.assertEqual(self.held(since_admit=20), ['burst'])
        self.assertEqual(self.held(free=GB), ['memory'])
        self.assertEqual(self.held(psi=25), ['memory'])
        self.assertEqual(self.held(scope_anon=40 * GB), ['tree'])

    def test_first_lane_skips_only_the_gates_that_can_stay_up_while_idle(self):
        self.assertEqual(self.held(in_use=0, cli=20, tree_rss=60 * GB, scope_anon=60 * GB), [])
        self.assertEqual(self.held(in_use=0, growth=12 * GB), ['growth'])      # background subagents (10-25 15:47)
        self.assertEqual(self.held(in_use=0, avail=5 * GB), ['memory'])

    def test_missing_readings_are_skipped(self):
        self.assertEqual(lg.decide({'in_use': 1}, lim()), [])


class AppLog(unittest.TestCase):
    def test_working_sessions_and_burst(self):
        now = time.time()
        a, b, c = 'local_aaaaaaaa-1', 'local_bbbbbbbb-2', 'local_cccccccc-3'
        text = ''.join([
            f'{stamp(now - 7200)} [info] Starting app {{\n',
            f'{stamp(now - 900)} [info] LocalSessions.sendMessage: sessionId={a}, messageLength=5\n',
            f'{stamp(now - 900)} [info] Sending message to session {a}\n',          # the same message: one start
            f'{stamp(now - 300)} [info] LocalSessions.sendMessage: sessionId={b}, messageLength=5\n',
            f'{stamp(now - 200)} [info] [CCD CycleHealth] healthy cycle for {b} (100s, hadFirstResponse=true)\n',
            f'{stamp(now - 100)} [info] [CCD] side session (fresh) {c} <- {a}\n',
            f'{stamp(now - 90)} [info] Starting local session local_dddddddd-4 in /tmp\n',   # a respawn, not a cycle
            memline(now - 60, 10, 4000),
        ])
        r = lg.read_app_log(text, now)
        self.assertEqual(r['working'], [a, c])
        self.assertEqual(r['starts'], 2)
        self.assertEqual(r['rss'][0][1], 4000 * 2 ** 20)

    def test_a_new_app_run_forgets_the_old_one(self):
        now = time.time()
        text = (f'{stamp(now - 600)} [info] LocalSessions.sendMessage: sessionId=local_old-1, x\n'
                f'{stamp(now - 300)} [info] Starting app {{\n')
        self.assertEqual(lg.read_app_log(text, now)['working'], [])


class Tree(unittest.TestCase):
    def test_finds_the_app_and_counts_its_clis(self):
        with tempfile.TemporaryDirectory() as proc:
            page = os.sysconf('SC_PAGE_SIZE')
            def fake(pid, ppid, comm, rss_pages, cmd=b''):
                os.makedirs(f'{proc}/{pid}')
                fields = ['S', str(ppid)] + ['0'] * 19 + [str(rss_pages)] + ['0'] * 20
                pathlib.Path(f'{proc}/{pid}/stat').write_text(f'{pid} ({comm}) {" ".join(fields)}')
                pathlib.Path(f'{proc}/{pid}/cmdline').write_bytes(cmd)
            fake(1, 0, 'systemd', 10)
            fake(100, 1, 'claude-desktop', 1000)
            fake(101, 100, 'claude-desktop', 500)                          # a helper, not a second app
            fake(102, 100, 'disclaimer', 1)
            fake(103, 102, 'claude', 2000, b'claude\0--output-format\0stream-json\0')
            fake(104, 103, 'bash', 100)
            fake(105, 102, 'claude', 50, b'claude\0--version\0')            # not a session CLI
            fake(200, 1, 'bash', 99)
            t = lg.app_tree(lg.processes(proc), proc)
            self.assertEqual((t['pid'], t['procs'], t['cli']), (100, 5, 1))
            self.assertEqual(t['tree_rss'], (1000 + 500 + 1 + 2000 + 100 + 50) * page)
            self.assertIsNone(lg.app_tree(lg.processes(proc) | {100: {'ppid': 1, 'comm': 'x', 'rss': 0},
                                                               101: {'ppid': 1, 'comm': 'x', 'rss': 0}}, proc))


class Replay(unittest.TestCase):
    def log(self):
        t0 = time.mktime((2026, 10, 26, 10, 0, 0, 0, 0, -1))
        lines = [f'{stamp(t0)} [info] Starting app {{\n']
        for i in range(20):                                               # run 1: grows fast, then dies silently
            lines.append(memline(t0 + 60 * i, 100, 4000 if i < 15 else 4000 + 4000 * (i - 14), cli=3))
            if i == 12:
                lines += [f'{stamp(t0 + 60 * i + 1)} [info] LocalSessions.sendMessage: sessionId=local_a-{k}, x\n'
                          for k in range(7)]
        t1 = t0 + 3600
        lines.append(f'{stamp(t1)} [info] Starting app {{\n')
        lines.append(f'{stamp(t1 + 1)} [info] Quit requested before \'ready\'; not creating the main window\n')
        for i in range(20):                                               # run 2: calm, quits cleanly
            lines.append(memline(t1 + 60 * i, 200, 3000))
        lines.append(f'{stamp(t1 + 1200)} [info] beforeQuit: handler fired, going down\n')
        t2 = t1 + 1500
        lines.append(f'{stamp(t2)} [info] Starting app {{\n')
        lines += [memline(t2 + 60 * i, 300, 3000) for i in range(3)]       # run 3: relaunched within 5 min
        t3 = t2 + 600
        lines.append(f'{stamp(t3)} [info] Starting app {{\n')
        lines += [memline(t3 + 60 * i, 400, 3000) for i in range(60)]      # run 4: still running
        return t0, lines

    def test_unclean_exits_only(self):
        t0, lines = self.log()
        rows, exits = lg.parse_logs(lines)
        self.assertEqual(len(rows), 103)
        self.assertEqual([e['pid'] for e in exits], ['100'])
        self.assertEqual(exits[0]['t'], t0 + 60 * 19)
        self.assertEqual(lg.crashes(exits, [t0 + 60 * 19 + 30]), [])     # a reboot in between is not an app crash
        self.assertEqual(len(lg.crashes(exits, [t0 - 100])), 1)

    def test_rows_carry_the_policy_inputs(self):
        _, lines = self.log()
        rows, _ = lg.parse_logs(lines)
        r = rows[19]
        self.assertEqual((r['in_use'], r['cli'], r['starts']), (7, 3, 7))
        self.assertEqual(r['growth'], 8000 * 2 ** 20)
        self.assertEqual(rows[25]['in_use'], 0)                           # the new run starts with no sessions

    def test_calibration_separates_the_crash_window(self):
        _, lines = self.log()
        rows, exits = lg.parse_logs(lines)
        rep = lg.calibrate(rows, exits, lim(LANE_GROWTH_GB='6'), margin=600)
        self.assertEqual(rep['policy']['crash_windows_held'], 1)
        self.assertGreater(rep['policy']['crash_minutes_held_pct'], 50)
        self.assertEqual(rep['policy']['healthy_minutes_held_pct'], 0)
        self.assertEqual(rep['gates']['lanes']['crash_windows_held'], 1)
        self.assertEqual(rep['gates']['growth']['crash_windows_held'], 1)


class Tickets(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.fleet = tempfile.TemporaryDirectory()
        self.patches = [mock.patch.object(lg, 'STATE', self.dir.name),
                        mock.patch.dict(os.environ, {'FLEET_STATE_DIR': self.fleet.name}),
                        mock.patch.object(lg, 'hardware', lambda env=os.environ: RIG)]
        for p in self.patches:
            p.start()
        self.readings = calm(in_use=0)
        real = lg.sense
        def sense(now=None):          # live tickets and admissions, made-up machine readings
            s = real(now)
            s.update({k: v for k, v in self.readings.items() if k not in ('in_use', 'starts', 'since_admit')})
            s['in_use'] = len(s['tickets']) + self.readings['in_use']
            return s
        self.patches.append(mock.patch.object(lg, 'sense', sense))
        self.patches[-1].start()
        self.patches.append(mock.patch.object(lg, 'read_app_log', lambda text, now: {'working': [], 'starts': 0, 'rss': []}))
        self.patches[-1].start()
        self.patches.append(mock.patch.object(lg, 'app_tree', lambda procs, proc=None: None))
        self.patches[-1].start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.dir.cleanup()
        self.fleet.cleanup()

    def test_admit_stagger_release(self):
        code, tid = lg.acquire('one', wait=False)
        self.assertEqual(code, 0)
        code, why = lg.acquire('two', wait=False)
        self.assertEqual(code, 75)
        self.assertTrue(any('admitted' in w for w in why), why)
        self.assertTrue(lg.release(tid))
        self.assertFalse(lg.release(tid))

    def test_subagent_tickets_fill_the_lanes(self):
        os.environ['LANE_STAGGER_SEC'] = '0'
        try:
            got = [lg.acquire(f'l{i}', wait=False) for i in range(4)]
        finally:
            del os.environ['LANE_STAGGER_SEC']
        self.assertEqual([c for c, _ in got], [0, 0, 0, 75])
        self.assertIn('lanes 3/3', got[3][1][0])

    def test_session_tickets_count_only_while_starting(self):
        now = time.time()
        t = {'kind': 'session', 'admitted': now - lg.SESSION_GRACE - 1, 'lease_until': 0}
        self.assertFalse(lg.counting(t, now))
        self.assertTrue(lg.counting(dict(t, admitted=now), now))
        self.assertFalse(lg.counting({'kind': 'run', 'pid': 2 ** 22 + 7, 'lease_until': now + 60}, now))
        self.assertFalse(lg.counting({'kind': 'subagent', 'lease_until': now - 1}, now))

    def test_renew_extends_a_lease(self):
        _, tid = lg.acquire('long', wait=False)
        self.assertTrue(lg.renew(tid, 7200))
        t = lg.read_json(os.path.join(self.dir.name, 'lanes', f'{tid}.json'))
        self.assertGreater(t['lease_until'], time.time() + 7000)

    def test_queue_order_is_respected(self):
        os.makedirs(os.path.join(self.dir.name, 'queue'))
        lg.write_json(os.path.join(self.dir.name, 'queue', '1-1-1.json'),
                      {'name': 'ahead', 'kind': 'subagent', 'priority': 1, 'since': 1, 'pid': os.getppid()})
        code, why = lg.acquire('behind', wait=False)
        self.assertEqual((code, why), (75, ['1 lane request(s) queued ahead']))
        lg.write_json(os.path.join(self.dir.name, 'queue', '1-1-1.json'),
                      {'name': 'gone', 'kind': 'subagent', 'priority': 1, 'since': 1, 'pid': 2 ** 22 + 7})
        self.assertEqual(lg.acquire('behind', wait=False)[0], 0)          # a dead waiter is dropped

    def test_waits_then_gets_in(self):
        self.readings['load'] = 99.0
        with redirect_stderr(io.StringIO()) as err:
            code, why = lg.acquire('patient', max_wait=0.3, poll=0.1)
        self.assertEqual(code, 75)
        self.assertIn('load 99.0', err.getvalue())
        self.assertEqual(os.listdir(os.path.join(self.dir.name, 'queue')), [])
        self.readings['load'] = 1.0
        self.assertEqual(lg.acquire('patient', max_wait=1, poll=0.1)[0], 0)

    def test_drain_refuses_at_once(self):
        pathlib.Path(self.fleet.name, 'DRAIN').write_text('reboot')
        code, why = lg.acquire('x', max_wait=60)
        self.assertEqual(code, 75)
        self.assertIn('draining', why[0])

    def test_hook_takes_and_releases_subagent_lanes(self):
        def run(event):
            with redirect_stderr(io.StringIO()) as err:
                return lg.hook(event), err.getvalue()
        pre = {'hook_event_name': 'PreToolUse', 'session_id': 's1', 'tool_name': 'Agent',
               'tool_input': {'description': 'audio pass'}}
        self.assertEqual(run(pre), (0, ''))
        code, msg = run(pre)                                              # 60 s stagger
        self.assertEqual(code, 2)
        self.assertIn('hold this subagent', msg)
        card = {'hook_event_name': 'PreToolUse', 'session_id': 's1', 'tool_name': 'mcp__ccd_session__start_session',
                'tool_input': {'initiation': 'own_initiative', 'title': 'later'}}
        self.assertEqual(run(card), (0, ''))                              # a proposal card starts nothing
        self.assertEqual(run({'hook_event_name': 'PreToolUse', 'tool_name': 'Bash'}), (0, ''))
        lanes = os.path.join(self.dir.name, 'lanes')
        self.assertEqual(len(os.listdir(lanes)), 1)
        run({'hook_event_name': 'SubagentStop', 'session_id': 'other'})
        self.assertEqual(len(os.listdir(lanes)), 1)
        run({'hook_event_name': 'SubagentStop', 'session_id': 's1'})
        self.assertEqual(os.listdir(lanes), [])


class Cli(unittest.TestCase):
    """The installed command end to end, with every live gate opened so this machine's state cannot block it."""
    def env(self, d, **kw):
        e = dict(os.environ, LANE_GOVERNOR_DIR=d, LANE_GOVERNOR_LOGS=d, FLEET_STATE_DIR=d, LANE_MAX='50',
                 LANE_MAX_CLI='100000', LANE_BURST='100000', LANE_STAGGER_SEC='0', LANE_GROWTH_GB='100000',
                 LANE_TREE_GB='100000', LANE_SCOPE_GB='100000', LANE_RESERVE_GB='0', LANE_MIN_FREE_GB='0',
                 LANE_MAX_LOAD='100000', LANE_MAX_PSI='100000')
        e.update(kw)
        return e

    def call(self, d, *args, **kw):
        return subprocess.run([sys.executable, str(HERE / 'lane-governor.py'), *args], capture_output=True, text=True,
                              env=self.env(d, **kw), timeout=60)

    def test_run_acquire_release_and_exit_75(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self.call(d, 'run', '--name', 'ok', '--', 'true').returncode, 0)
            self.assertEqual(self.call(d, 'run', '--name', 'rc', '--', 'sh', '-c', 'exit 3').returncode, 3)
            self.assertEqual(os.listdir(os.path.join(d, 'lanes')), [])
            r = self.call(d, 'acquire', '--name', 'a', '--no-wait', LANE_MAX='1')
            self.assertEqual(r.returncode, 0)
            held = self.call(d, 'acquire', '--name', 'b', '--no-wait', LANE_MAX='1')
            self.assertEqual(held.returncode, 75)
            self.assertIn('lanes', held.stderr)
            self.assertEqual(self.call(d, 'release', r.stdout.strip()).returncode, 0)
            self.assertEqual(self.call(d, 'status', '--json').returncode, 0)
            self.assertIn('lanes=3', self.call(d, 'limits', '--threads', '32', '--ram-gb', '124', LANE_MAX='').stdout)


if __name__ == '__main__':
    unittest.main()
