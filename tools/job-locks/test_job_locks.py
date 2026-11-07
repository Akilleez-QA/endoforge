"""job-locks: an unreadable registry or manifest is said out loud, and never overwritten."""
import importlib.util, json, pathlib, tempfile, unittest
from unittest import mock
SPEC = importlib.util.spec_from_file_location('jl', pathlib.Path(__file__).resolve().parent / 'job-locks.py')
jl = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(jl)


class Locks(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.dir = pathlib.Path(tmp.name); self.reg = self.dir / 'active.json'
        patch = mock.patch.object(jl, 'REG', self.reg); patch.start(); self.addCleanup(patch.stop)

    def manifest(self, name, locks):
        path = self.dir / name; path.write_text(json.dumps({'name': name, 'locks': locks})); return str(path)

    def test_add_render_rm(self):
        man = self.manifest('m', {'farm': {'plan': 'H100 only', 'by': 'owner'}})
        self.assertEqual(jl.main(['add', man]), 0)
        self.assertIn('- farm: H100 only (owner)', jl.render(jl.active()))
        self.assertEqual(jl.main(['rm', man]), 0)
        self.assertEqual(jl.active(), [])

    def test_a_missing_registry_is_no_jobs(self):
        self.assertEqual(jl.active(), [])

    def test_a_torn_manifest_is_named_beside_the_readable_locks(self):
        good = self.manifest('good', {'cut': {'decision': 'Keep cut 3'}})
        bad = self.dir / 'bad.json'; bad.write_text('{"name": "ba')
        text = jl.render([str(bad), good])
        self.assertIn('Keep cut 3', text)
        self.assertRegex(text, r'WARNING.*bad\.json')

    def test_a_missing_manifest_is_named(self):
        self.assertRegex(jl.render([str(self.dir / 'gone.json')]), r'WARNING.*gone\.json')

    def test_a_torn_registry_warns_on_read_and_is_not_overwritten(self):
        self.reg.write_text('["/job/a.json", "/jo')
        before = self.reg.read_text()
        with mock.patch('builtins.print') as out:
            self.assertEqual(jl.main([]), 0)
        self.assertRegex(' '.join(str(c.args[0]) for c in out.call_args_list), r'WARNING.*active\.json')
        with mock.patch('sys.stderr'):
            self.assertEqual(jl.main(['add', self.manifest('m', {})]), 1)
        self.assertEqual(self.reg.read_text(), before)

    def test_a_registry_of_the_wrong_shape_is_unreadable(self):
        self.reg.write_text('{"jobs": []}')
        with self.assertRaises(jl.RegistryError):
            jl.active()

    def test_a_failed_write_leaves_the_registry_and_no_temporary(self):
        man = self.manifest('m', {})
        jl.main(['add', man])
        before = self.reg.read_text()
        with mock.patch('os.fsync', side_effect=OSError(28, 'no space')):
            with mock.patch('sys.stderr'):
                self.assertEqual(jl.main(['add', self.manifest('n', {})]), 1)
        self.assertEqual(self.reg.read_text(), before)
        self.assertEqual([p.name for p in self.dir.iterdir() if 'tmp' in p.name], [])


if __name__ == '__main__':
    unittest.main()
