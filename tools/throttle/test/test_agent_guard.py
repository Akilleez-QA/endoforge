"""agent-guard on made-up commands: shared-checkout git, add-all, whole-drive scans, wrappers, overrides, the hook I/O."""
import importlib.util, io, json, os, pathlib, subprocess, sys, tempfile, unittest
from unittest import mock
TOOL = pathlib.Path(__file__).resolve().parent.parent / 'agent-guard.py'
SPEC = importlib.util.spec_from_file_location('agent_guard', TOOL)
ag = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(ag)
HOME = str(pathlib.Path.home())


def sh(*a, cwd):
    subprocess.run(a, cwd=cwd, check=True, capture_output=True)


class Git(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.repo = self.tmp.name
        sh('git', 'init', '-q', cwd=self.repo)
        for k, v in [('user.email', 't@t'), ('user.name', 't')]:
            sh('git', 'config', k, v, cwd=self.repo)
        pathlib.Path(self.repo, 'a').write_text('1'); sh('git', 'add', 'a', cwd=self.repo); sh('git', 'commit', '-qm', 'a', cwd=self.repo)

    def tearDown(self):
        self.tmp.cleanup()

    def rule(self, cmd):
        found = ag.evaluate(cmd, self.repo)
        return found and found[0]

    def test_destructive_git_is_fine_in_a_clean_checkout(self):
        self.assertIsNone(self.rule('git stash'))
        self.assertIsNone(self.rule('git reset --hard HEAD'))

    def test_destructive_git_is_refused_with_uncommitted_changes(self):
        pathlib.Path(self.repo, 'a').write_text('someone else')
        for cmd in ['git stash', 'git stash push -m x', 'git reset --hard', 'git checkout -- .', 'git checkout .',
                    'git restore .', 'git checkout -f main', 'git clean -fd', f'cd {self.repo} && git stash', f'git -C {self.repo} stash',
                    'git status && git stash drop']:
            self.assertEqual(self.rule(cmd), 'shared-git', cmd)

    def test_reads_and_safe_forms_pass(self):
        pathlib.Path(self.repo, 'a').write_text('dirty')
        for cmd in ['git stash list', 'git stash show', 'git restore --staged a', 'git reset HEAD a', 'git diff',
                    'git checkout -b new', 'git clean -n', 'echo git stash', 'git log --oneline -3',
                    'git checkout -- a', 'git restore a b']:
            self.assertIsNone(self.rule(cmd), cmd)

    def test_add_all_is_refused_add_by_path_passes(self):
        for cmd in ['git add -A', 'git add .', 'git add --all', 'git -C x add -A']:
            self.assertEqual(self.rule(cmd), 'add-all', cmd)
        self.assertIsNone(self.rule('git add a b/c.py'))
        self.assertIsNone(self.rule('git add -A game GAME.md'))

    def test_override(self):
        pathlib.Path(self.repo, 'a').write_text('mine')
        self.assertIsNone(self.rule('AGENT_GUARD_OK=1 git stash'))


class Scans(unittest.TestCase):
    def rule(self, cmd, cwd='/tmp'):
        found = ag.evaluate(cmd, cwd)
        return found and found[0]

    def test_whole_drive_scans_are_refused(self):
        for cmd in ['du -xh -d2 /home/user', 'du -sh /', 'ionice -c3 du -sh ~', 'sudo -n ionice -c3 du -xh -d2 /',
                    'timeout 300 ionice -c3 find /home /var -xdev -size +500M', f'du -sh "{HOME}/LOCAL LLM"',
                    'sudo -n btrfs filesystem du -s /', 'ncdu /', 'find ~ -name x']:
            self.assertEqual(self.rule(cmd), 'whole-tree', cmd)

    def test_bounded_and_specific_scans_pass(self):
        for cmd in ['du -sh ~/.cache/uv', 'find ~ -maxdepth 4 -name x', f'du -sh "{HOME}/LOCAL LLM/rea"',
                    'find . -name x', 'du -sh build', 'btrfs filesystem usage /', 'df -h /']:
            self.assertIsNone(self.rule(cmd), cmd)

    def test_du_without_path_uses_cwd(self):
        self.assertEqual(self.rule('du -sh', cwd=HOME), 'whole-tree')
        self.assertEqual(self.rule('cd ~ && du -sh'), 'whole-tree')

    def test_wrapper_parsing(self):
        self.assertEqual(ag.program(['sudo', '-n', 'btrfs', 'fi', 'du'])[0], 'btrfs')
        self.assertEqual(ag.program(['timeout', '-k', '30', '20m', 'blender', '-b'])[0], 'blender')
        self.assertEqual(ag.program(['systemd-run', '--user', '-p', 'Nice=19', '--', 'du', '/'])[0], 'du')
        self.assertEqual(ag.program(['FOO=1', 'nice', '-n', '10', 'git', 'add'])[0], 'git')


class Hook(unittest.TestCase):
    def run_hook(self, event):
        with tempfile.TemporaryDirectory() as state:
            r = subprocess.run([sys.executable, '-B', str(TOOL)], input=json.dumps(event), capture_output=True,
                               text=True, env={**os.environ, 'XDG_STATE_HOME': state})
            log = pathlib.Path(state, 'agent-guard', 'refusals.jsonl')
            return r.returncode, r.stderr, log.exists()

    def test_refusal_exits_2_with_reason_and_log(self):
        rc, err, logged = self.run_hook({'tool_name': 'Bash', 'tool_input': {'command': 'du -sh /'}, 'cwd': '/tmp'})
        self.assertEqual((rc, logged), (2, True)); self.assertIn('diskguard status', err)

    def test_allowed_and_other_tools_exit_0(self):
        self.assertEqual(self.run_hook({'tool_name': 'Bash', 'tool_input': {'command': 'ls'}, 'cwd': '/tmp'})[0], 0)
        self.assertEqual(self.run_hook({'tool_name': 'Read', 'tool_input': {}})[0], 0)

    def test_garbage_input_never_blocks(self):
        r = subprocess.run([sys.executable, '-B', str(TOOL)], input='not json', capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)
        rc = self.run_hook({'tool_name': 'Bash', 'tool_input': {'command': 'echo "unterminated'}, 'cwd': '/tmp'})[0]
        self.assertEqual(rc, 0)


if __name__ == '__main__':
    unittest.main()
