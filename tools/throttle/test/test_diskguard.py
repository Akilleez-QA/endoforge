"""diskguard on made-up folders: idle and busy rules, pruned search, worktree safety, alarm levels."""
import contextlib, importlib.util, io, os, pathlib, subprocess, tempfile, time, unittest
from unittest import mock
SPEC = importlib.util.spec_from_file_location('diskguard', pathlib.Path(__file__).resolve().parent.parent / 'diskguard.py')
dg = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(dg)
P = pathlib.Path


def sh(*a, cwd):
    subprocess.run(a, cwd=cwd, check=True, capture_output=True)


class Plan(unittest.TestCase):
    def test_only_idle_and_unused_folders(self):
        now = time.time()
        folders = [{'path': P('/w/old'), 'mtime': now - 50 * 3600, 'busy': False, 'regen': [P('/w/old/node_modules')]},
                   {'path': P('/w/new'), 'mtime': now - 3600, 'busy': False, 'regen': [P('/w/new/node_modules')]},
                   {'path': P('/w/run'), 'mtime': now - 99 * 3600, 'busy': True, 'regen': [P('/w/run/node_modules')]}]
        self.assertEqual([p for p, _ in dg.plan(folders, now, 48)], [P('/w/old/node_modules')])

    def test_busy_means_any_path_inside(self):
        self.assertTrue(dg.is_busy(P('/w/a'), {'/w/a', '/w', '/w/a/src'}))
        self.assertFalse(dg.is_busy(P('/w/ab'), {'/w/a', '/w'}))


class Search(unittest.TestCase):
    def test_finds_regen_without_descending_into_it(self):
        with tempfile.TemporaryDirectory() as d:
            d = P(d)
            for p in ['node_modules/x/node_modules', 'pkg/a/node_modules', 'pkg/a/b/c/d/node_modules', '.git/node_modules']:
                (d / p).mkdir(parents=True)
            found = sorted(str(p.relative_to(d)) for p in dg.regenerable_dirs(d, depth=4))
            self.assertEqual(found, ['node_modules', 'pkg/a/node_modules'])

    def test_frozen_read_only_install_is_left_alone(self):
        with tempfile.TemporaryDirectory() as d:
            d = P(d); (d / 'a/node_modules').mkdir(parents=True); (d / 'b/node_modules').mkdir(parents=True)
            os.chmod(d / 'b/node_modules', 0o555)
            try:
                self.assertEqual([str(p.relative_to(d)) for p in dg.regenerable_dirs(d)], ['a/node_modules'])
            finally:
                os.chmod(d / 'b/node_modules', 0o755)

    def test_idle_age_ignores_regen_churn(self):
        with tempfile.TemporaryDirectory() as d:
            d = P(d); (d / 'src').mkdir(); (d / 'node_modules').mkdir()
            old = time.time() - 100 * 3600
            for p in [d / 'src', d]:
                os.utime(p, (old, old))
            (d / 'node_modules' / 'fresh').write_text('x')
            os.utime(d, (old, old))
            self.assertLess(dg.newest_mtime(d), time.time() - 99 * 3600)


class Worktrees(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); t = P(self.tmp.name)
        self.origin, self.main, self.wt = t / 'origin.git', t / 'main', t / 'wt'
        sh('git', 'init', '-q', '--bare', str(self.origin), cwd=t)
        sh('git', 'clone', '-q', str(self.origin), str(self.main), cwd=t)
        for k, v in [('user.email', 't@t'), ('user.name', 't')]:
            sh('git', 'config', k, v, cwd=self.main)
        (self.main / '.gitignore').write_text('node_modules/\nout/\n.env\n')
        sh('git', 'add', '.', cwd=self.main); sh('git', 'commit', '-qm', 'a', cwd=self.main)
        sh('git', 'push', '-q', 'origin', 'HEAD:main', cwd=self.main)
        sh('git', 'fetch', '-q', cwd=self.main)
        sh('git', 'worktree', 'add', '-q', '--detach', str(self.wt), 'origin/main', cwd=self.main)

    def tearDown(self):
        self.tmp.cleanup()

    def test_clean_pushed_worktree_is_removable(self):
        (self.wt / 'node_modules').mkdir()
        self.assertTrue(dg.removable_worktree(self.wt))

    def test_untracked_file_keeps_it(self):
        (self.wt / 'notes.md').write_text('x')
        self.assertIsNone(dg.removable_worktree(self.wt))

    def test_ignored_env_or_renders_keep_it(self):
        for name in ['.env', 'out']:
            p = self.wt / name
            if name == 'out':
                p.mkdir(); (p / 'frame.png').write_text('render')   # git does not list an empty folder
            else:
                p.write_text('k')
            self.assertIsNone(dg.removable_worktree(self.wt), name)
            subprocess.run(['rm', '-rf', str(p)])

    def test_unpushed_commit_keeps_it(self):
        sh('git', 'config', 'user.email', 't@t', cwd=self.wt); sh('git', 'config', 'user.name', 't', cwd=self.wt)
        (self.wt / 'f').write_text('x'); sh('git', 'add', 'f', cwd=self.wt); sh('git', 'commit', '-qm', 'b', cwd=self.wt)
        self.assertIsNone(dg.removable_worktree(self.wt))

    def test_main_checkout_is_never_a_worktree_candidate(self):
        self.assertIsNone(dg.removable_worktree(self.main))


class Keep(unittest.TestCase):
    def test_keep_marker_protects_an_idle_folder(self):
        with tempfile.TemporaryDirectory() as d:
            root = P(d) / 'Work'
            for name in ('kept', 'plain'):
                (root / name / 'node_modules').mkdir(parents=True)
            (root / 'kept' / dg.KEEP).write_text('')
            old = time.time() - 100 * 3600
            for name in ('kept', 'plain'):
                for p in (root / name / 'node_modules', root / name / dg.KEEP, root / name):
                    if p.exists():
                        os.utime(p, (old, old))
            out = io.StringIO()
            with mock.patch.object(dg, 'STATE', P(d) / 'state'), contextlib.redirect_stdout(out):
                dg.janitor(False, False, 48, roots=[root], dev=os.stat(d).st_dev)
            self.assertIn('plain/node_modules', out.getvalue())
            self.assertNotIn('kept/node_modules', out.getvalue())


class Remove(unittest.TestCase):
    def test_moves_to_trash_then_deletes_and_sweeps_leftovers(self):
        with tempfile.TemporaryDirectory() as d:
            d = P(d); old, dg.TRASH = dg.TRASH, d / 'trash'
            try:
                (d / 'w/node_modules/x').mkdir(parents=True); (d / 'trash/left-1/y').mkdir(parents=True)
                logged = []
                self.assertTrue(dg.remove(d / 'w/node_modules', logged.append))
                self.assertTrue(dg.remove(d / 'trash/left-1', logged.append))
                self.assertFalse((d / 'w/node_modules').exists())
                self.assertEqual(list((d / 'trash').iterdir()), [])
                self.assertTrue(all(r['ok'] for r in logged))
            finally:
                dg.TRASH = old


class Levels(unittest.TestCase):
    def test_levels(self):
        u = dg.usage('/')
        self.assertIn(u['level'], ('ok', 'warn', 'critical'))
        self.assertEqual(u['level'] == 'ok', u['use_pct'] < dg.WARN)


if __name__ == '__main__':
    unittest.main()
