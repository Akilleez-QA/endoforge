"""job-locks: registry add/rm, one line per lock, unreadable manifests skipped, never fails."""
import importlib.util, json, os, pathlib, tempfile, unittest
from unittest import mock
SPEC = importlib.util.spec_from_file_location('jl', pathlib.Path(__file__).resolve().parent / 'job-locks.py')
jl = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(jl)


class Locks(unittest.TestCase):
    def test_add_render_rm(self):
        with tempfile.TemporaryDirectory() as d:
            man = pathlib.Path(d, 'job', 'manifest.json'); man.parent.mkdir()
            man.write_text(json.dumps({'locks': {'render-farm': {'plan': 'H100 only', 'by': 'Craig',
                                                                 'exception-1': 'second DC ok for Blender'},
                                                 'end-card-copy': {'text': "We move 'em by the ton."}}}))
            with mock.patch.object(jl, 'REG', pathlib.Path(d, 'active.json')):
                jl.main(['add', str(man)])
                text = jl.render(jl.active())
                self.assertIn('- render-farm: H100 only (Craig) EXCEPTION: second DC ok for Blender', text)
                self.assertIn("- end-card-copy: We move 'em by the ton.", text)
                jl.main(['rm', str(man)])
                self.assertEqual(jl.active(), [])

    def test_missing_or_broken_manifests_print_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            bad = pathlib.Path(d, 'bad.json'); bad.write_text('{')
            self.assertEqual(jl.render([str(bad), str(pathlib.Path(d, 'none.json'))]), '')


if __name__ == '__main__':
    unittest.main()
