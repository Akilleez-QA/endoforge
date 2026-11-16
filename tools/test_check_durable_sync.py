import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CHECK = Path(__file__).resolve().parent / 'check_durable_sync.py'


class CheckDurableSyncTest(unittest.TestCase):
    def run_in(self, files):
        with tempfile.TemporaryDirectory() as root:
            subprocess.run(['git', 'init', '-q', root], check=True)
            for name, text in files.items():
                path = Path(root, name)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            subprocess.run(['git', '-C', root, 'add', '.'], check=True)
            return subprocess.run([sys.executable, '-I', str(CHECK)], cwd=root, capture_output=True, text=True)

    def test_a_raw_sync_is_refused_with_the_fix(self):
        result = self.run_in({'tools/a.py': 'import os\nos.fsync(1)\n', 'tools/b.py': 'import os\nos.fdatasync(2)\n'})
        self.assertEqual(result.returncode, 1)
        self.assertIn('tools/a.py:2: os.fsync(1)', result.stdout)
        self.assertIn('tools/b.py:2: os.fdatasync(2)', result.stdout)
        self.assertIn('use sync_data, sync_file or sync_dir from tools/durable.py', result.stdout)

    def test_the_helper_experiments_and_patching_are_allowed(self):
        result = self.run_in({'tools/durable.py': 'import os\nos.fsync(1)\n', 'experiments/P-1/x.py': 'import os\nos.fsync(1)\n',
                              'tools/c.py': 'import os\nreal = os.fsync\n', 'tools/d.py': 'from tools.durable import sync_file\nsync_file(1)\n'})
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_full_fsync_outside_the_helper_is_refused(self):
        result = self.run_in({'tools/e.py': 'import fcntl\nfcntl.fcntl(1, fcntl.F_FULLFSYNC)\n'})
        self.assertEqual(result.returncode, 1)


if __name__ == '__main__':
    unittest.main()
