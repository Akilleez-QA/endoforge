#!/usr/bin/env python3
"""GAP-EF-006: Wasmtime qualification, offline stage resume and campaign transfer."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import uuid

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location('portability_' + name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


R = load('resume_stage')
T = load('campaign_transfer')
C = T.C

FAKE_WASMTIME = r'''#!/usr/bin/env python3
import sys
from pathlib import Path
a = sys.argv[1:]
i = a.index('--invoke')
fn, module, args = a[i + 1], Path(a[i + 2]), a[i + 3:]
text = module.read_text()
def trap():
    sys.stderr.write('Error: failed to run\n\nCaused by:\n    wasm trap: wasm `unreachable` instruction executed\n')
    raise SystemExit(134)
if fn == 'run':
    if 'unreachable' in text:
        trap()
    if 'loop' in text:
        sys.stderr.write('Error: all fuel consumed by WebAssembly\n')
        raise SystemExit(1)
    print(42)
elif fn == 'add':
    print(float(args[0]) + float(args[1]))
elif fn == 'checked':
    if float(args[0]) < 0:
        trap()
    print(float(args[0]))
elif fn == 'tamper':
    (module.parent / 'state.json').write_text('{}')
    print(0)
else:
    sys.stderr.write('unknown export\n')
    raise SystemExit(1)
'''

WAT = ('(module\n'
       '  (func (export "add") (param f64 f64) (result f64) local.get 0 local.get 1 f64.add)\n'
       '  (func (export "checked") (param f64) (result f64)\n'
       '    local.get 0 f64.const 0 f64.lt if unreachable end local.get 0))\n')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def bundle(root, body=FAKE_WASMTIME, pin=None):
    (root / 'bin').mkdir(parents=True)
    tool = root / 'bin/wasmtime'
    real = os.environ.get('ENDOFORGE_WASMTIME')
    if body is FAKE_WASMTIME and real:
        shutil.copy2(real, tool)
    else:
        tool.write_text(body)
    tool.chmod(0o755)
    (root / 'toolchain.json').write_text(json.dumps({'files': {'bin/wasmtime': {'sha256': pin or sha(tool.read_bytes())}}}))
    return root


def stage(root, cases=None, **over):
    root.mkdir(parents=True)
    (root / 'module.wat').write_text(WAT)
    (root / 'state.json').write_text(json.dumps({'job': 'j1', 'completedStages': ['contract', 'generate'],
                                                 'pendingStages': ['verify', 'promote']}))
    spec = {'schema': 'endoforge.portable-stage.v1', 'requiresModelAuthentication': False, 'statePath': 'state.json',
            'stage': 'verify', 'modulePath': 'module.wat', 'moduleSha256': sha(WAT.encode()),
            'cases': cases if cases is not None else [{'id': 'sum', 'fn': 'add', 'args': [2, 3], 'expect': 5},
                               {'id': 'neg', 'fn': 'checked', 'args': [-1], 'expectError': True}]}
    spec.update(over)
    (root / 'resume.json').write_text(json.dumps(spec))
    meta = {'schema': C.VERSION, 'job_states': {'j1': 'generated'}, 'frozen_evals': {'suite': 'fixture'},
            'dependencies': {'lock': 'fixture'}, 'references': {'source': 'fixture'},
            'provenance': {'source': 'test'}, 'credentials': 'excluded-reauthenticate-at-destination'}
    (root / 'checkpoint.json').write_text(json.dumps(meta))
    return root


def inventory(root):
    meta = json.loads((root / 'checkpoint.json').read_text())
    meta['files'] = {p.relative_to(root).as_posix(): {'sha256': sha(p.read_bytes()), 'size': p.stat().st_size,
                                                      'executable': False}
                     for p in sorted(root.rglob('*')) if p.is_file() and p.name != 'checkpoint.json'}
    (root / 'checkpoint.json').write_text(json.dumps(meta))
    return root


class Workspace(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='ef-portability-')
        self.addCleanup(temp.cleanup)
        self.dir = Path(temp.name)


class Qualify(Workspace):
    def qualify(self, root, optimize=False):
        argv = [sys.executable, '-B'] + (['-O'] if optimize else []) + [str(HERE / 'qualify_wasmtime.py'), str(root)]
        return subprocess.run(argv, capture_output=True, text=True, timeout=60)

    def test_pinned_runtime_qualifies(self):
        root = bundle(self.dir / 'good')
        for optimize in [False, True]:
            with self.subTest(optimize=optimize):
                done = self.qualify(root, optimize)
                self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
                result = json.loads(done.stdout)
                self.assertTrue(result['passed'])
                self.assertEqual([r['name'] for r in result['checks']], ['answer', 'loop', 'trap'])
                self.assertEqual(result['wasmtime_sha256'], sha((root / 'bin/wasmtime').read_bytes()))

    def test_unqualified_runtime_fails_even_when_optimized(self):
        lenient = bundle(self.dir / 'lenient', '#!/bin/sh\necho 42\n')
        mismatch = bundle(self.dir / 'mismatch', '#!/bin/sh\necho 42\n', pin='0' * 64)
        for root in [lenient, mismatch]:
            for optimize in [False, True]:
                with self.subTest(root=root.name, optimize=optimize):
                    done = self.qualify(root, optimize)
                    self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
                    self.assertFalse(json.loads(done.stdout)['passed'])


class Resume(Workspace):
    def setUp(self):
        super().setUp()
        self.bundle = bundle(self.dir / 'bundle')

    def checkpoint(self, name='cp', cases=None, **over):
        return inventory(stage(self.dir / name, cases, **over))

    def test_stage_resumes_publishes_once_and_preserves_checkpoint(self):
        cp = self.checkpoint()
        before = {p.name: sha(p.read_bytes()) for p in cp.iterdir()}
        out = self.dir / 'out'
        first = R.run(cp, self.bundle, out)
        self.assertTrue(first['passed'] and first['published'] and not first['reused'], first)
        self.assertEqual([c['outcome'] for c in first['cases']], ['value', 'refused'])
        self.assertEqual(first['resumedState'], {'job': 'j1', 'stage': 'verify-completed',
                                                 'completedStages': ['contract', 'generate', 'verify'],
                                                 'pendingStages': ['promote']})
        self.assertEqual(first['publicationSha256'], sha((out / 'stage.json').read_bytes()))
        second = R.run(cp, self.bundle, out)
        self.assertTrue(second['reused'] and not second['published'])
        self.assertEqual(second['publicationSha256'], first['publicationSha256'])
        self.assertEqual(len(list((out / 'attempts').iterdir())), 2)
        self.assertEqual(before, {p.name: sha(p.read_bytes()) for p in cp.iterdir()})

    def test_failing_stage_is_recorded_not_published(self):
        cp = self.checkpoint(cases=[{'id': 'sum', 'fn': 'add', 'args': [2, 3], 'expect': 6},
                                    {'id': 'pos', 'fn': 'checked', 'args': [1], 'expectError': True}])
        result = R.run(cp, self.bundle, self.dir / 'out')
        self.assertFalse(result['passed'] or result['published'])
        self.assertEqual([c['passed'] for c in result['cases']], [False, False])
        self.assertEqual(result['resumedState']['stage'], 'verify-failed')
        self.assertFalse((self.dir / 'out/stage.json').exists())
        self.assertEqual(len(list((self.dir / 'out/attempts').iterdir())), 1)

    def test_conflicting_publication_is_refused(self):
        cp = self.checkpoint()
        (self.dir / 'out').mkdir()
        (self.dir / 'out/stage.json').write_text('{"other": true}\n')
        with self.assertRaises(ValueError):
            R.run(cp, self.bundle, self.dir / 'out')
        self.assertEqual((self.dir / 'out/stage.json').read_text(), '{"other": true}\n')

    def test_refusals(self):
        outside = self.dir / 'outside'
        outside.mkdir()
        (outside / 'state.json').write_text(json.dumps({'job': 'x', 'completedStages': ['a'], 'pendingStages': ['verify']}))
        cases = {
            'model authentication': dict(requiresModelAuthentication=True),
            'not pending': dict(stage='promote-later'),
            'module identity': dict(moduleSha256='0' * 64),
            'unsafe path': dict(statePath='../outside/state.json'),
            'absolute path': dict(statePath=str(outside / 'state.json')),
            'module outside inventory': dict(modulePath='extra.wat'),
            'no cases': dict(cases=[]),
            'too many cases': dict(cases=[{'id': str(i), 'fn': 'add', 'args': [1, 1], 'expect': 2} for i in range(257)]),
            'flag argument': dict(cases=[{'id': 'x', 'fn': 'add', 'args': ['--dir=/', 1], 'expect': 1}]),
            'boolean argument': dict(cases=[{'id': 'x', 'fn': 'add', 'args': [True, 1], 'expect': 2}]),
            'tampering stage': dict(cases=[{'id': 'x', 'fn': 'tamper', 'args': [], 'expect': 0}]),
            'wrong schema': dict(schema='endoforge.portable-stage.v2'),
        }
        for label, over in cases.items():
            with self.subTest(label=label):
                name = 'cp-' + uuid.uuid4().hex
                cp = self.checkpoint(name, **over)
                if label == 'module outside inventory':
                    (cp / 'extra.wat').write_text(WAT)
                with self.assertRaises(ValueError):
                    R.run(cp, self.bundle, self.dir / ('out-' + name))
                self.assertFalse((self.dir / ('out-' + name) / 'stage.json').exists())

    def test_symlinked_directory_cannot_escape_checkpoint(self):
        outside = self.dir / 'outside'
        outside.mkdir()
        (outside / 'state.json').write_text(json.dumps({'job': 'x', 'completedStages': ['a'],
                                                        'pendingStages': ['verify']}))
        cp = stage(self.dir / 'cp', statePath='sub/state.json')
        (cp / 'sub').symlink_to(outside)
        inventory(cp)
        meta = json.loads((cp / 'checkpoint.json').read_text())
        meta['files']['sub/state.json'] = {'sha256': sha((outside / 'state.json').read_bytes()), 'size': 1,
                                           'executable': False}
        (cp / 'checkpoint.json').write_text(json.dumps(meta))
        with self.assertRaises(ValueError):
            R.run(cp, self.bundle, self.dir / 'out')

    def test_runtime_identity_is_pinned(self):
        cp = self.checkpoint()
        wrong = bundle(self.dir / 'wrong', pin='0' * 64)
        with self.assertRaises(ValueError):
            R.run(cp, wrong, self.dir / 'out')

    def test_cli(self):
        cp = self.checkpoint()
        done = subprocess.run([sys.executable, '-B', str(HERE / 'resume_stage.py'), str(cp), str(self.bundle),
                               str(self.dir / 'out')], capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertTrue(json.loads(done.stdout)['published'])


FAKE_SSH = '''import hashlib, os, subprocess, sys
a = sys.argv[1:]
while a and a[0] == '-o':
    a = a[2:]
host, command = a[0], a[1]
if host != 'second-host':
    raise SystemExit(255)
if command == 'sha256sum /etc/machine-id':
    print(hashlib.sha256(b'second-host').hexdigest() + '  /etc/machine-id')
    raise SystemExit(0)
fail = os.environ.get('FAKE_SSH_FAIL')
if fail and fail in command:
    sys.stderr.write('injected remote failure\\n')
    raise SystemExit(1)
raise SystemExit(subprocess.run(['/bin/sh', '-c', command]).returncode)
'''

FAKE_SCP = '''import os, shutil, sys
a = sys.argv[1:]
while a and a[0] == '-o':
    a = a[2:]
a = [x for x in a if x not in ('-q', '-r')]
src, dst = [x.split(':', 1)[1] if x.startswith('second-host:') else x for x in a]
if os.path.isdir(src):
    shutil.copytree(src, dst)
else:
    shutil.copy2(src, dst)
'''


def sandbox_reason():
    for tool in ['age', 'age-keygen', 'bwrap']:
        if not shutil.which(tool):
            return tool + ' is not installed'
    probe = subprocess.run(['bwrap', '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64',
                            '/lib64', '--ro-bind', '/bin', '/bin', '--unshare-all', '--new-session', '--die-with-parent',
                            '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '/usr/bin/python3', '-c', 'print(1)'],
                           capture_output=True, text=True)
    if probe.returncode:
        return 'bwrap cannot create an unprivileged sandbox here: ' + probe.stderr.strip()[:200]
    if not Path('/etc/machine-id').exists():
        return '/etc/machine-id is missing'
    return None


class Transfer(Workspace):
    def setUp(self):
        super().setUp()
        self.source = stage(self.dir / 'source')
        self.bundle = bundle(self.dir / 'bundle')
        self.remote = '/tmp/endoforge-transfer-' + uuid.uuid4().hex
        self.addCleanup(shutil.rmtree, self.remote, True)
        self.identity = self.dir / 'keys/identity'

    def fakes(self):
        bin_dir = self.dir / 'fake-bin'
        bin_dir.mkdir()
        for name, body in [('ssh', FAKE_SSH), ('scp', FAKE_SCP)]:
            (bin_dir / name).write_text('#!' + sys.executable + '\n' + body)
            (bin_dir / name).chmod(0o755)
        return mock.patch.dict(os.environ, {'PATH': str(bin_dir) + os.pathsep + os.environ['PATH']})

    def transfer(self, receipt='receipt', remote=None):
        return T.execute_transfer(self.source, self.bundle, self.dir / receipt, self.identity, 'second-host',
                                  remote or self.remote)

    def test_refusals_before_any_remote_action(self):
        (self.dir / 'exists').mkdir()
        with self.assertRaises(FileExistsError):
            self.transfer('exists')
        for remote in ['/tmp/other', '/tmp/endoforge-transfer-x/nested', '/var/endoforge-transfer-x']:
            with self.subTest(remote=remote), self.assertRaises(ValueError):
                self.transfer('r-' + uuid.uuid4().hex, remote)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ['bundle', 'exists', 'source'])

    @unittest.skipUnless(shutil.which('age-keygen'), 'age-keygen is not installed')
    def test_loose_identity_permissions_are_refused(self):
        self.identity.parent.mkdir()
        subprocess.run(['age-keygen', '-o', str(self.identity)], capture_output=True, check=True)
        self.identity.chmod(0o644)
        with self.fakes(), self.assertRaises(ValueError):
            self.transfer()
        summary = json.loads((self.dir / 'receipt/summary.json').read_text())
        self.assertEqual(summary['state'], 'failed')
        self.assertFalse(any(row['argv'][0] in ('ssh', 'scp') for row in
                             json.loads((self.dir / 'receipt/commands.json').read_text())))
        self.assertFalse(Path(self.remote).exists())

    def test_emulated_second_host_resume(self):
        reason = sandbox_reason()
        if reason:
            self.skipTest(reason)
        before = {p.name: sha(p.read_bytes()) for p in self.source.iterdir()}
        with self.fakes():
            summary = self.transfer()
        self.assertTrue(summary['passed'], summary)
        self.assertEqual(summary['state'], 'passed')
        self.assertTrue(summary['onePublication'] and summary['secondResumeIdempotent'])
        self.assertTrue(summary['remoteOwnedStagingRemoved'])
        self.assertEqual(summary['completedStagesPreserved'], ['contract', 'generate'])
        self.assertEqual(summary['resumedState']['stage'], 'verify-completed')
        self.assertNotEqual(summary['sourceMachineSha256'], summary['destinationMachineSha256'])
        self.assertFalse(Path(self.remote).exists())
        receipt = self.dir / 'receipt'
        self.assertEqual(json.loads((receipt / 'summary.json').read_text())['state'], 'passed')
        self.assertEqual(sha((receipt / 'remote-output/stage.json').read_bytes()), summary['matchingPublicationSha256'])
        self.assertEqual(sha((receipt / 'local-output/stage.json').read_bytes()), summary['matchingPublicationSha256'])
        self.assertEqual(before, {p.name: sha(p.read_bytes()) for p in self.source.iterdir()})
        logged = (receipt / 'commands.json').read_text()
        self.assertNotIn('AGE-SECRET-KEY', logged)
        remote_rows = [row['argv'] for row in json.loads(logged) if row['argv'][0] in ('ssh', 'scp')]
        self.assertEqual({argv[0] for argv in remote_rows}, {'ssh', 'scp'})
        for argv in remote_rows:
            with self.subTest(argv=argv[:4]):
                self.assertEqual(argv[1:3], ['-o', 'BatchMode=yes'])

    def test_remote_failure_removes_owned_staging(self):
        reason = sandbox_reason()
        if reason:
            self.skipTest(reason)
        with self.fakes(), mock.patch.dict(os.environ, {'FAKE_SSH_FAIL': 'resume_stage.py'}):
            with self.assertRaises(RuntimeError):
                self.transfer()
        summary = json.loads((self.dir / 'receipt/summary.json').read_text())
        self.assertEqual(summary['state'], 'failed')
        self.assertTrue(summary['remoteOwnedStagingRemoved'])
        self.assertFalse(Path(self.remote).exists())


SECOND_HOST = os.environ.get('ENDOFORGE_SECOND_HOST', '')


def ssh(host, command, timeout=30):
    return subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, command],
                          stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)


@unittest.skipUnless(SECOND_HOST, 'ENDOFORGE_SECOND_HOST is unset; set it to an ssh destination reachable with '
                                  'BatchMode=yes that has age, bwrap and python3 to transfer to a real second host')
class RealSecondHost(Workspace):
    def setUp(self):
        super().setUp()
        reason = sandbox_reason()
        if reason:
            self.skipTest(reason)
        probe = ssh(SECOND_HOST, 'command -v age && command -v bwrap && command -v python3 && sha256sum /etc/machine-id')
        self.assertEqual(probe.returncode, 0, 'ENDOFORGE_SECOND_HOST=%s is set but not usable: %s'
                         % (SECOND_HOST, probe.stderr.strip()[:300] or probe.stdout.strip()[:300]))
        self.remote_machine = probe.stdout.split()[-2]
        self.local_machine = sha(Path('/etc/machine-id').read_bytes())
        self.source = stage(self.dir / 'source')
        self.bundle = bundle(self.dir / 'bundle')
        self.remote = '/tmp/endoforge-transfer-' + uuid.uuid4().hex
        self.addCleanup(ssh, SECOND_HOST, 'rm -rf -- ' + self.remote)
        self.identity = self.dir / 'keys/identity'

    def transfer(self):
        return T.execute_transfer(self.source, self.bundle, self.dir / 'receipt', self.identity, SECOND_HOST,
                                  self.remote)

    def test_same_machine_is_refused_before_staging(self):
        if self.remote_machine != self.local_machine:
            self.skipTest('ENDOFORGE_SECOND_HOST is a distinct machine; the same-machine refusal does not apply')
        with self.assertRaisesRegex(ValueError, 'second host identity equals source'):
            self.transfer()
        summary = json.loads((self.dir / 'receipt/summary.json').read_text())
        self.assertEqual((summary['state'], summary['remoteOwnedStagingRemoved']), ('failed', False))
        self.assertNotEqual(ssh(SECOND_HOST, 'test -e ' + self.remote).returncode, 0)

    def test_real_second_host_resume(self):
        if self.remote_machine == self.local_machine:
            self.skipTest('ENDOFORGE_SECOND_HOST=%s reaches this machine (same /etc/machine-id); a real transfer '
                          'needs a distinct host' % SECOND_HOST)
        before = {p.name: sha(p.read_bytes()) for p in self.source.iterdir()}
        summary = self.transfer()
        self.assertTrue(summary['passed'], summary)
        self.assertEqual((summary['host'], summary['state']), (SECOND_HOST, 'passed'))
        self.assertEqual(summary['sourceMachineSha256'], self.local_machine)
        self.assertEqual(summary['destinationMachineSha256'], self.remote_machine)
        self.assertTrue(summary['onePublication'] and summary['secondResumeIdempotent'])
        self.assertTrue(summary['remoteOwnedStagingRemoved'])
        self.assertEqual(summary['completedStagesPreserved'], ['contract', 'generate'])
        self.assertEqual(summary['resumedState']['stage'], 'verify-completed')
        self.assertNotEqual(ssh(SECOND_HOST, 'test -e ' + self.remote).returncode, 0)
        receipt = self.dir / 'receipt'
        self.assertEqual(sha((receipt / 'remote-output/stage.json').read_bytes()), summary['matchingPublicationSha256'])
        self.assertEqual(sha((receipt / 'local-output/stage.json').read_bytes()), summary['matchingPublicationSha256'])
        self.assertEqual(before, {p.name: sha(p.read_bytes()) for p in self.source.iterdir()})
        logged = (receipt / 'commands.json').read_text()
        self.assertNotIn('AGE-SECRET-KEY', logged)
        self.assertTrue(any(row['argv'][0] == 'scp' for row in json.loads(logged)))


if __name__ == '__main__':
    unittest.main()
