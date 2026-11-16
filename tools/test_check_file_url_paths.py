"""REQ-REPO-011: tools/check_file_url_paths.py findings, skips, allowlist, output and exit codes."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / 'tools' / 'check_file_url_paths.py'
_spec = importlib.util.spec_from_file_location('check_file_url_paths', SCRIPT)
cf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cf)
FIX = 'use fileURLToPath(new URL(...)) from node:url; URL.pathname keeps percent-encoding, so paths with spaces break'


class Findings(unittest.TestCase):
    def test_pathname_forms_are_found(self):
        text = ("const a = new URL('./x.mjs', import.meta.url).pathname;\n"
                "const b = new URL('.', import.meta.url)\n  .pathname;\n"
                "const { pathname } = new URL(import.meta.url);\n"
                "const c = url.pathname + '/x';\n")
        self.assertEqual([n for n, _ in cf.findings('a.mjs', text)], [1, 3, 4, 5])

    def test_file_url_to_path_is_clean(self):
        text = ("import { fileURLToPath } from 'node:url';\n"
                "const a = fileURLToPath(new URL('./x.mjs', import.meta.url));\n"
                "const pathnames = [];\n")
        self.assertEqual(cf.findings('a.mjs', text), [])

    def test_allowlist_is_exact_to_file_and_line(self):
        line = "const e = path.extname(new URL(r.url).pathname);\n"
        self.assertEqual(cf.findings('tools/hillclimb/bin/hillclimb.mjs', line), [])
        self.assertEqual(len(cf.findings('tools/hillclimb/bin/other.mjs', line)), 1)
        other = "const d = new URL('.', import.meta.url).pathname;\n"
        self.assertEqual(len(cf.findings('tools/hillclimb/bin/hillclimb.mjs', other)), 1)

    def test_suffixes_and_skips(self):
        frozen = {'experiments/P-1/'}
        for path in ('a.mjs', 'a.js', 'a.cjs', 'a.ts', 'a.mts', 'a.cts', 'run.sh', 'Makefile', 'sub/Makefile',
                     'experiments/P-2/run.mjs', 'TODELETE/a.mjs'):
            with self.subTest(path=path):
                self.assertTrue(cf.checked(path, frozen))
        for path in ('a.py', 'a.md', 'node_modules/a.mjs', 'x/node_modules/a.js', 'vendor/a.js',
                     'experiments/P-1/run.mjs', 'experiments/P-1/bin/x.mjs'):
            with self.subTest(path=path):
                self.assertFalse(cf.checked(path, frozen))

    def test_frozen_experiments_are_those_with_a_result(self):
        files = ['experiments/P-1/RESULT.md', 'experiments/P-1/run.mjs', 'experiments/P-2/PRECOMMIT.md',
                 'experiments/P-3/receipt/RESULT.md', 'experiments/README.md']
        self.assertEqual(cf.frozen_experiments(files), {'experiments/P-1/'})

    def test_repository_is_clean(self):
        result = subprocess.run([sys.executable, '-I', str(SCRIPT)], cwd=REPO, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_check_target_runs_checker(self):
        text = (REPO / 'Makefile').read_text(encoding='utf8')
        check = text.split('\ncheck:\n', 1)[1].split('\n\n', 1)[0]
        self.assertIn('tools/check_file_url_paths.py', check)


class Script(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)

    def add(self, rel, text):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf8')
        subprocess.run(['git', 'add', '--', rel], cwd=self.root, check=True)

    def run_script(self, *args):
        return subprocess.run([sys.executable, '-I', str(SCRIPT), *args], cwd=self.root,
                              capture_output=True, text=True)

    def test_exit_zero_when_clean(self):
        self.add('a.mjs', "export const a = fileURLToPath(new URL('.', import.meta.url));\n")
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout, '')

    def test_exit_one_lists_findings_and_states_the_fix(self):
        self.add('src/a.mjs', "const x = 1;\nconst d = new URL('.', import.meta.url).pathname;\n")
        self.add('Makefile', "t:\n\tnode -e \"console.log(new URL('.', 'file:///x/').pathname)\"\n")
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.splitlines(), [
            "Makefile:2: node -e \"console.log(new URL('.', 'file:///x/').pathname)\"",
            "src/a.mjs:2: const d = new URL('.', import.meta.url).pathname;",
        ])
        self.assertIn(f'2 URL.pathname uses: {FIX}', result.stderr)

    def test_untracked_skipped_and_frozen_files_ignored(self):
        bad = "new URL('.', import.meta.url).pathname;\n"
        (self.root / 'loose.mjs').write_text(bad, encoding='utf8')
        self.add('node_modules/x.js', bad)
        self.add('vendor/x.js', bad)
        self.add('notes.md', bad)
        self.add('experiments/P-1/RESULT.md', '# Result\n')
        self.add('experiments/P-1/run.mjs', bad)
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_unfrozen_experiment_is_checked(self):
        self.add('experiments/P-2/PRECOMMIT.md', '# Plan\n')
        self.add('experiments/P-2/run.mjs', "new URL('.', import.meta.url).pathname;\n")
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.splitlines(), ["experiments/P-2/run.mjs:1: new URL('.', import.meta.url).pathname;"])

    def test_paths_limit_the_file_set(self):
        bad = "new URL('.', import.meta.url).pathname;\n"
        self.add('one/a.mjs', bad)
        self.add('two/b.mjs', bad)
        result = self.run_script('two')
        self.assertEqual(result.stdout.splitlines(), ["two/b.mjs:1: new URL('.', import.meta.url).pathname;"])

    def test_git_failure_exits_two(self):
        with tempfile.TemporaryDirectory() as bare:
            result = subprocess.run([sys.executable, '-I', str(SCRIPT)], cwd=bare, capture_output=True, text=True,
                                    env={'PATH': '/usr/bin:/bin', 'GIT_CEILING_DIRECTORIES': str(Path(bare).parent)})
        self.assertEqual(result.returncode, 2)
        self.assertIn('git ls-files failed', result.stderr)

    def test_help_lists_usage(self):
        result = self.run_script('--help')
        self.assertEqual(result.returncode, 0)
        self.assertIn('usage: python3 -I tools/check_file_url_paths.py [PATH ...]', result.stdout)


if __name__ == '__main__':
    unittest.main()
