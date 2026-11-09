"""GAP-EF-002: factory runtime job specs, records, scheduler, recovery, egress and WebAssembly runner."""
import gc
import hashlib
import http.server
import json
import os
from pathlib import Path
import signal
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
import warnings

from tools.factory_runtime import core, egress, local_provider, recovery, runner, scheduler, wasm

REPO = Path(__file__).resolve().parents[2]
FAKE_DOCKER = Path(__file__).with_name('fixtures') / 'fake_docker.py'
IMAGE = 'sha256:' + 'a' * 64


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unseal(path):
    for root, dirs, files in os.walk(path):
        for name in dirs + files:
            target = os.path.join(root, name)
            if not os.path.islink(target):
                os.chmod(target, 0o700 if os.path.isdir(target) else 0o600)


def spec(**over):
    value = {'version': 1, 'job': 'job-1', 'attempt': 'attempt-1', 'input': 'in.txt', 'inputSha256': 'a' * 64,
             'expectedSha256': 'b' * 64, 'script': 'cat /input.txt', 'timeoutSeconds': 5}
    value.update(over)
    return value


def receipt(**over):
    value = {'version': 1, 'kind': 'receipt', 'job': 'job-1', 'attempt': 'attempt-1', 'state': 'passed',
             'parent': None, 'usage': {'wallMs': 1.5, 'tokens': None}, 'hashes': {'input': 'a' * 64}, 'error': None}
    value.update(over)
    return value


def dead_identity():
    process = subprocess.Popen(['sleep', '30'])
    who = core.identity(process.pid)
    process.kill()
    process.wait()
    return who


class Workspace(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ef-runtime-')
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(unseal, self.temp.name)
        self.dir = Path(self.temp.name)


class JobSpecs(Workspace):
    def test_valid_spec_is_returned_unchanged(self):
        value = spec()
        self.assertIs(core.validate_spec(value), value)

    def test_spec_refusals(self):
        bad = [spec(extra=1), {k: v for k, v in spec().items() if k != 'script'}, spec(version=2),
               spec(version=True), spec(job='../x'), spec(attempt='a' * 81), spec(inputSha256='A' * 64),
               spec(expectedSha256='b' * 63), spec(script=['sh']), spec(input=None), spec(timeoutSeconds=0),
               spec(timeoutSeconds=601), spec(timeoutSeconds=True), spec(timeoutSeconds='5')]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValueError):
                core.validate_spec(value)

    def test_spec_schema_file_matches_validator(self):
        schema = json.loads((REPO / 'tools/factory_runtime/schemas/v1/job-spec.json').read_text())
        self.assertEqual(set(schema['required']), set(spec()))
        self.assertFalse(schema['additionalProperties'])
        self.assertEqual(schema['properties']['timeoutSeconds']['maximum'], 600)

    def test_record_schemas_match_validator(self):
        fields = set(receipt())
        for kind in ['job', 'attempt', 'stage', 'receipt']:
            schema = json.loads((REPO / f'tools/factory_runtime/schemas/v1/{kind}.json').read_text())
            with self.subTest(kind=kind):
                self.assertEqual(set(schema['required']), fields)
                self.assertEqual(schema['properties']['kind']['const'], kind)
                core.validate_record(receipt(kind=kind), kind)

    def test_record_refusals(self):
        bad = [receipt(version=2), receipt(extra=1), receipt(state='exploded'), receipt(parent='../p'),
               receipt(usage={'wallMs': -1, 'tokens': None}), receipt(usage={'wallMs': float('nan'), 'tokens': None}),
               receipt(usage={'wallMs': True, 'tokens': None}), receipt(usage={'wallMs': 1, 'tokens': -1}),
               receipt(hashes={}), receipt(hashes={'input': 'z' * 64}), receipt(state='failed'),
               receipt(state='failed', error={'type': '', 'message': 'x'}),
               receipt(state='publication_recovered', hashes={'input': 'a' * 64}), receipt(job='a b')]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValueError):
                core.validate_record(value, 'receipt')
        with self.assertRaises(ValueError):
            core.validate_record(receipt(), 'job')
        core.validate_record(receipt(state='failed', error={'type': 'worker_failed', 'message': 'exit 1'}), 'receipt')

    def test_stage_transitions(self):
        self.assertEqual(core.transition('queued', 'running'), 'running')
        self.assertEqual(core.transition('unknown', 'publication_recovered'), 'publication_recovered')
        for before, after in [('passed', 'running'), ('queued', 'passed'), ('failed', 'queued'), ('nope', 'queued')]:
            with self.subTest(before=before, after=after), self.assertRaises(ValueError):
                core.transition(before, after)

    def test_roles_never_let_a_model_worker_promote(self):
        for name, role in core.ROLES.items():
            self.assertEqual(role['promote'], name == 'publisher', name)
        self.assertEqual(core.ROLES['verifier']['network'], [])
        self.assertNotIn('candidate', core.ROLES['eval_writer']['read'])

    def test_durable_exclusive_and_replace(self):
        target = self.dir / 'r.json'
        core.durable(target, {'a': 1})
        with self.assertRaises(FileExistsError):
            core.durable(target, {'a': 2})
        self.assertEqual(json.loads(target.read_text()), {'a': 1})
        core.durable(target, {'a': 3}, False)
        self.assertEqual(json.loads(target.read_text()), {'a': 3})
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ['r.json'])

    def test_durable_failure_keeps_previous_content(self):
        target = self.dir / 'r.json'
        core.durable(target, {'jobs': ['kept']})

        def broken(value, stream, **kw):
            stream.write('{"jobs": [')
            raise OSError(28, 'No space left on device')

        for exclusive in [False, True]:
            other = target if not exclusive else self.dir / 'fresh.json'
            with self.subTest(exclusive=exclusive), mock.patch.object(core.json, 'dump', broken):
                with self.assertRaises(OSError):
                    core.durable(other, {'jobs': ['lost']}, exclusive)
        self.assertEqual(json.loads(target.read_text()), {'jobs': ['kept']})
        self.assertFalse((self.dir / 'fresh.json').exists())
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ['r.json'])

    def test_import_regular_refuses_links_and_size(self):
        source = self.dir / 'src.txt'
        source.write_bytes(b'payload')
        self.assertEqual(core.import_regular(source, self.dir / 'copy.txt'), sha(b'payload'))
        (self.dir / 'link').symlink_to(source)
        os.link(self.dir / 'copy.txt', self.dir / 'hard')
        cases = [(self.dir / 'link', OSError), (self.dir / 'hard', ValueError), (self.dir, ValueError)]
        for path, error in cases:
            with self.subTest(path=path.name), self.assertRaises(error):
                core.import_regular(path, self.dir / ('out-' + path.name))
        (self.dir / 'big').write_bytes(b'x' * 11)
        with self.assertRaises(ValueError):
            core.import_regular(self.dir / 'big', self.dir / 'big-out', max_bytes=10)
        with self.assertRaises(FileExistsError):
            core.import_regular(source, self.dir / 'copy.txt')
        with self.assertRaises(ValueError):
            core.import_archive(self.dir / 'x.tar')

    def test_mount_tree_refuses_links(self):
        tree = self.dir / 'tree'
        (tree / 'sub').mkdir(parents=True)
        (tree / 'sub/a.txt').write_text('a')
        self.assertTrue(core.validate_mount_tree(tree))
        (tree / 'sub/l').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):
            core.validate_mount_tree(tree)


class Fencing(Workspace):
    def test_second_controller_is_refused_and_stale_fence_detected(self):
        with core.Fence(self.dir) as fence:
            fence.check()
            with self.assertRaises(RuntimeError):
                core.Fence(self.dir).__enter__()
            record = json.loads((self.dir / 'controller.json').read_text())
            self.assertEqual(record['identity'], core.identity())
            core.durable(self.dir / 'controller.json', dict(record, generation='0' * 32), False)
            with self.assertRaises(RuntimeError):
                fence.check()
        with core.Fence(self.dir) as again:
            again.check()
            self.assertNotEqual(again.token, fence.token)

    def test_identity_and_liveness(self):
        self.assertTrue(core.alive(core.identity()))
        self.assertFalse(core.alive(dead_identity()))
        self.assertFalse(core.alive(None))


class Scheduling(Workspace):
    def test_fifo_capacity(self):
        s = scheduler.Scheduler(capacity=2)
        for job in 'abc':
            s.submit(job)
        seen = []
        s.step(lambda j: seen.append(j) or {'outcome': 'passed'}, now=0)
        self.assertEqual(seen, ['a', 'b'])
        s.step(lambda j: seen.append(j) or {'outcome': 'failed'}, now=0)
        self.assertEqual(seen, ['a', 'b', 'c'])
        self.assertEqual([j['state'] for j in s.jobs], ['passed', 'passed', 'failed'])
        with self.assertRaises(ValueError):
            s.submit('a')
        for capacity in [0, 9]:
            with self.assertRaises(ValueError):
                scheduler.Scheduler(capacity=capacity)

    def test_subscription_limit_backoff_then_failure(self):
        s = scheduler.Scheduler(max_retries=2, backoff_seconds=60)
        s.submit('j')
        calls = []
        limited = lambda j: calls.append(j) or {'outcome': 'subscription_limit'}
        s.step(limited, now=0)
        self.assertEqual((s.jobs[0]['state'], s.jobs[0]['eligible']), ('blocked', 60))
        s.step(limited, now=59)
        self.assertEqual(len(calls), 1)
        s.step(limited, now=60)
        self.assertEqual((s.jobs[0]['state'], s.jobs[0]['eligible'], s.jobs[0]['retries']), ('blocked', 180, 2))
        s.step(limited, now=180)
        self.assertEqual(s.jobs[0]['state'], 'failed')
        self.assertEqual(len(calls), 3)

    def test_errors_and_malformed_results_fail_the_job_only(self):
        s = scheduler.Scheduler(capacity=3)
        for job in ['boom', 'none', 'ok']:
            s.submit(job)

        def run(job):
            if job == 'boom':
                raise RuntimeError('provider down')
            return None if job == 'none' else {'outcome': 'passed'}

        s.step(run, now=0)
        self.assertEqual([j['state'] for j in s.jobs], ['failed', 'failed', 'passed'])
        self.assertEqual(s.jobs[0]['result']['error'], 'provider down')

    def test_persistence_and_interrupted_job_becomes_unknown(self):
        root = self.dir / 'sched'
        s = scheduler.Scheduler(root=root)
        s.submit('a')
        s.submit('b')

        def crash(job):
            raise KeyboardInterrupt

        with self.assertRaises(KeyboardInterrupt):
            s.step(crash, now=0)
        self.assertEqual(json.loads((root / 'scheduler.json').read_text())['jobs'][0]['state'], 'running')
        again = scheduler.Scheduler(root=root)
        self.assertEqual(again.jobs[0]['state'], 'unknown')
        again.step(lambda j: {'outcome': 'passed'}, now=0)
        saved = json.loads((root / 'scheduler.json').read_text())
        self.assertEqual([j['state'] for j in saved['jobs']], ['unknown', 'passed'])

    def test_reload_refuses_unknown_version(self):
        root = self.dir / 'sched'
        s = scheduler.Scheduler(root=root)
        s.submit('a')
        (root / 'scheduler.json').write_text(json.dumps({'version': 2, 'jobs': []}))
        with self.assertRaises(ValueError):
            s.submit('b')
        with self.assertRaises(ValueError):
            scheduler.Scheduler(root=root)

    def test_failed_save_keeps_last_durable_queue(self):
        root = self.dir / 'sched'
        s = scheduler.Scheduler(root=root)
        s.submit('a')
        real = core.json.dump

        def broken(value, stream, **kw):
            if 'scheduler.json' not in stream.name:
                return real(value, stream, **kw)
            stream.write('{"version": 1, "jobs": [')
            raise OSError(28, 'No space left on device')

        with mock.patch.object(core.json, 'dump', broken), self.assertRaises(OSError):
            s.submit('b')
        self.assertEqual([j['job'] for j in scheduler.Scheduler(root=root).jobs], ['a'])

    def test_live_scheduler_fence_refuses_second_controller(self):
        root = self.dir / 'sched'
        s = scheduler.Scheduler(root=root)
        with core.Fence(root / 'scheduler-control'):
            with self.assertRaises(RuntimeError):
                s.submit('a')


class Docker(Workspace):
    def setUp(self):
        super().setUp()
        self.state = self.dir / 'docker'
        command = [sys.executable, str(FAKE_DOCKER), str(self.state)]
        for target in [mock.patch.object(runner, 'DOCKER', command), mock.patch.object(recovery, 'DOCKER', command),
                       mock.patch.object(runner, 'IMAGE', IMAGE)]:
            target.start()
            self.addCleanup(target.stop)
        self.root = self.dir / 'root'
        self.input = self.dir / 'input.txt'
        self.input.write_bytes(b'hello\n')
        self.input_sha = sha(b'hello\n')

    def run_attempt(self, attempt, script='cat /input.txt', expected=None, job=None, timeout=5):
        return runner.run_attempt(self.root, attempt, job or attempt, self.input, self.input_sha,
                                  expected or self.input_sha, script, timeout)

    def containers(self):
        return sorted(p.stem for p in self.state.glob('*.json'))


class Runner(Docker):
    def test_passed_attempt_publishes_once_with_valid_receipt(self):
        result = self.run_attempt('a1', job='job')
        self.assertEqual(result['outcome'], 'passed', result)
        self.assertTrue(result['published'] and result['cleanupVerified'])
        published = self.root / 'published/job.txt'
        self.assertEqual(published.read_bytes(), b'hello\n')
        self.assertEqual(os.stat(published).st_ino, os.stat(self.root / 'attempts/a1/artifact.txt').st_ino)
        record = json.loads((self.root / 'attempts/a1/record.json').read_text())
        core.validate_record(record, 'receipt')
        self.assertEqual(record['hashes']['artifact'], self.input_sha)
        self.assertEqual(self.containers(), [])
        journal = json.loads((self.root / 'journals/a1.json').read_text())
        self.assertEqual(journal['containerName'], result['containerName'])
        created = [json.loads(line) for line in (self.state / 'calls.jsonl').read_text().splitlines()]
        argv = next(c for c in created if c[0] == 'create')
        for flag in ['--network=none', '--read-only', '--cap-drop=ALL', '--pull=never', '--pids-limit=32']:
            self.assertIn(flag, argv)
        self.assertFalse(os.stat(self.root / 'attempts/a1').st_mode & stat.S_IWUSR)
        second = self.run_attempt('a2', job='job')
        self.assertEqual(second['outcome'], 'duplicate_publication')
        self.assertEqual(published.read_bytes(), b'hello\n')
        with self.assertRaises(FileExistsError):
            self.run_attempt('a1', job='job')

    def test_failure_outcomes(self):
        cases = [('wrong', 'echo other', None, 'validation_failed', 'failed'),
                 ('exit', 'exit 3', None, 'worker_failed', 'failed'),
                 ('empty', 'true', None, 'missing_output', 'failed'),
                 ('slow', 'sleep 30', 0.5, 'timeout', 'timeout')]
        for attempt, script, timeout, outcome, state in cases:
            with self.subTest(attempt=attempt):
                result = self.run_attempt(attempt, script, timeout=timeout or 5)
                self.assertEqual(result['outcome'], outcome, result)
                self.assertFalse(result['published'])
                self.assertTrue(result['cleanupVerified'])
                record = json.loads((self.root / 'attempts' / attempt / 'record.json').read_text())
                self.assertEqual(record['state'], state)
                self.assertEqual(record['error']['type'], outcome)
        self.assertEqual(self.containers(), [])
        self.assertFalse((self.root / 'published').exists() and any((self.root / 'published').iterdir()))

    def test_input_hash_mismatch_never_creates_a_container(self):
        result = runner.run_attempt(self.root, 'bad', 'bad', self.input, 'c' * 64, self.input_sha, 'cat /input.txt')
        self.assertEqual(result['outcome'], 'input_rejected')
        self.assertFalse((self.state / 'calls.jsonl').exists())

    def test_foreign_owner_label_is_never_removed(self):
        with mock.patch.dict(os.environ, {'FAKE_DOCKER_OWNER': 'f' * 32}):
            result = self.run_attempt('foreign')
        self.assertEqual(result['outcome'], 'cleanup_failed')
        self.assertFalse(result['published'])
        self.assertEqual(len(self.containers()), 1)
        calls = (self.state / 'calls.jsonl').read_text()
        self.assertNotIn('"rm"', calls)

    def test_capture_attempt_records_digest_without_publication(self):
        result = runner.capture_attempt(self.root, 'cap', 'cap', self.input, self.input_sha, 'echo captured')
        self.assertEqual(result['outcome'], 'captured')
        self.assertEqual(result['capturedSha256'], sha(b'captured\n'))
        self.assertFalse((self.root / 'published').exists())

    def test_missing_image_refuses_before_any_attempt(self):
        with mock.patch.object(runner, 'IMAGE', ''), self.assertRaises(ValueError):
            self.run_attempt('noimage')
        self.assertFalse((self.root / 'attempts').exists())

    def test_existing_journal_restores_signal_handlers(self):
        (self.root / 'journals').mkdir(parents=True)
        (self.root / 'journals/dup.json').write_text('{}')
        before = signal.getsignal(signal.SIGTERM)
        with self.assertRaises(FileExistsError):
            self.run_attempt('dup')
        self.assertIs(signal.getsignal(signal.SIGTERM), before)


class Recovery(Docker):
    def journal(self, attempt, controller=None, job='job'):
        token = os.urandom(16).hex()
        journal = {'version': 1, 'attempt': attempt, 'job': job, 'token': token,
                   'containerName': 'endoforge-v1-' + token, 'expectedSha256': self.input_sha,
                   'controller': controller or dead_identity(), 'generation': os.urandom(16).hex(), 'captureOnly': False}
        (self.root / 'journals').mkdir(parents=True, exist_ok=True)
        (self.root / 'journals' / (attempt + '.json')).write_text(json.dumps(journal))
        return journal

    def container(self, name, owner, script='sleep 30'):
        base = [sys.executable, str(FAKE_DOCKER), str(self.state)]
        subprocess.run(base + ['create', '--name', name, '--label', 'endoforge.owner=' + owner, IMAGE, '-c', script],
                       check=True, capture_output=True)
        subprocess.run(base + ['start', name], check=True, capture_output=True)

    def test_journal_before_create_is_exclusive_and_validated(self):
        class Fence:
            token = 'e' * 32
        self.root.mkdir()
        journal = recovery.journal_before_create(self.root, 'j1', 'job', 'd' * 32, self.input_sha, Fence())
        self.assertEqual(journal['controller'], core.identity())
        with self.assertRaises(FileExistsError):
            recovery.journal_before_create(self.root, 'j1', 'job', 'd' * 32, self.input_sha, Fence())
        with self.assertRaises(ValueError):
            recovery.journal_before_create(self.root, 'j2', 'job', 'D' * 32, self.input_sha, Fence())

    def test_live_controller_is_refused(self):
        self.journal('live', controller=core.identity())
        with self.assertRaises(RuntimeError):
            recovery.reconcile(self.root, 'live')
        self.assertFalse((self.root / 'reconciliations').exists())

    def test_absent_container_reconciles_without_publication(self):
        self.journal('gone')
        result = recovery.reconcile(self.root, 'gone')
        self.assertEqual(result['outcome'], 'interrupted_reconciled', result)
        self.assertTrue(result['cleanupVerified'])
        self.assertFalse(result['published'])
        self.assertTrue((Path(result['receipt']) / 'result.json').exists())

    def test_owned_running_container_is_stopped_logged_and_removed(self):
        journal = self.journal('running')
        self.container(journal['containerName'], journal['token'], 'echo partial; sleep 30')
        time.sleep(0.2)
        result = recovery.reconcile(self.root, 'running')
        self.assertEqual(result['outcome'], 'interrupted_reconciled', result)
        self.assertFalse(result['terminalState']['Running'])
        self.assertEqual((Path(result['receipt']) / 'stdout.log').read_text(), 'partial\n')
        self.assertEqual(self.containers(), [])

    def test_foreign_container_is_left_untouched(self):
        journal = self.journal('foreign')
        self.container(journal['containerName'], 'f' * 32)
        result = recovery.reconcile(self.root, 'foreign')
        self.assertEqual(result['outcome'], 'reconciliation_failed')
        self.assertIn('ownership mismatch', result['error'])
        self.assertEqual(self.containers(), [journal['containerName']])
        subprocess.run([sys.executable, str(FAKE_DOCKER), str(self.state), 'rm', '-f', journal['containerName']],
                       check=True)

    def test_publication_is_recovered_only_at_expected_digest(self):
        self.journal('pub', job='good')
        self.journal('mismatch', job='bad')
        (self.root / 'published').mkdir()
        (self.root / 'published/good.txt').write_bytes(b'hello\n')
        (self.root / 'published/bad.txt').write_bytes(b'tampered\n')
        good = recovery.reconcile(self.root, 'pub')
        self.assertEqual((good['outcome'], good['artifactSha256']), ('publication_recovered', self.input_sha))
        bad = recovery.reconcile(self.root, 'mismatch')
        self.assertEqual(bad['outcome'], 'reconciliation_failed')
        self.assertIn('digest mismatch', bad['error'])
        self.assertNotEqual(good['receipt'], recovery.reconcile(self.root, 'pub')['receipt'])

    def test_unsafe_journals_are_refused(self):
        with self.assertRaises(ValueError):
            recovery.reconcile(self.root, '../x')
        journal = self.journal('real')
        (self.root / 'journals/alias.json').symlink_to(self.root / 'journals/real.json')
        with self.assertRaises(ValueError):
            recovery.reconcile(self.root, 'alias')
        journal['containerName'] = 'other'
        (self.root / 'journals/real.json').write_text(json.dumps(journal))
        with self.assertRaises(ValueError):
            recovery.reconcile(self.root, 'real')

    def test_runner_crash_is_reconciled(self):
        code = ('import sys,os;from tools.factory_runtime import runner;'
                'runner.DOCKER=[sys.executable,sys.argv[1],sys.argv[2]];runner.IMAGE=sys.argv[3];'
                'runner._checkpoint=lambda p: os._exit(9) if p=="artifact_fsynced" else None;'
                'runner.run_attempt(sys.argv[4],"crash","crashjob",sys.argv[5],sys.argv[6],sys.argv[6],"cat /input.txt")')
        done = subprocess.run([sys.executable, '-B', '-c', code, str(FAKE_DOCKER), str(self.state), IMAGE,
                               str(self.root), str(self.input), self.input_sha], cwd=REPO, capture_output=True)
        self.assertEqual(done.returncode, 9, done.stderr)
        self.assertFalse((self.root / 'published/crashjob.txt').exists())
        result = recovery.reconcile(self.root, 'crash')
        self.assertEqual(result['outcome'], 'interrupted_reconciled', result)
        self.assertEqual(self.containers(), [])
        self.assertFalse((self.root / 'published/crashjob.txt').exists())
        self.assertTrue((self.root / 'attempts/crash/artifact.txt').exists())
        self.assertEqual(len(recovery.reconcile_all(self.root)), 1)


class Cli(Workspace):
    def test_run_refuses_without_qualified_image_and_bad_specs(self):
        env = {k: v for k, v in os.environ.items() if k != 'ENDOFORGE_WORKER_IMAGE'}
        good = self.dir / 'spec.json'
        good.write_text(json.dumps(spec(input=str(self.dir / 'in.txt'))))
        bad = self.dir / 'bad.json'
        bad.write_text(json.dumps(spec(extra=True)))
        for path, message in [(good, 'ENDOFORGE_WORKER_IMAGE'), (bad, 'unknown schema version or fields')]:
            done = subprocess.run([sys.executable, '-B', '-m', 'tools.factory_runtime', 'run', str(self.dir / 'root'),
                                   str(path)], cwd=REPO, env=env, capture_output=True, text=True)
            self.assertNotEqual(done.returncode, 0)
            self.assertIn(message, done.stderr)
        self.assertFalse((self.dir / 'root/attempts').exists())


def client_hello(name):
    context = ssl.create_default_context()
    incoming, outgoing = ssl.MemoryBIO(), ssl.MemoryBIO()
    tls = context.wrap_bio(incoming, outgoing, server_hostname=name)
    with self_suppress(ssl.SSLWantReadError):
        tls.do_handshake()
    return outgoing.read()


class self_suppress:
    def __init__(self, error):
        self.error = error

    def __enter__(self):
        return self

    def __exit__(self, kind, value, trace):
        return kind is not None and issubclass(kind, self.error)


class Egress(Workspace):
    def test_tls_hello_must_name_the_connect_authority(self):
        hello = client_hello('chatgpt.com')
        for expected, ok in [('chatgpt.com', True), ('api.openai.com', False)]:
            a, b = socket.socketpair()
            with a, b:
                a.sendall(hello)
                if ok:
                    self.assertEqual(egress.tls_client_hello(b, expected), hello)
                else:
                    with self.assertRaises(ValueError):
                        egress.tls_client_hello(b, expected)
        a, b = socket.socketpair()
        with a, b:
            a.sendall(b'GET / HTTP/1.1\r\nHost: chatgpt.com\r\n\r\n')
            with self.assertRaises(ValueError):
                egress.tls_client_hello(b, 'chatgpt.com')

    def request(self, path, data):
        with socket.socket(socket.AF_UNIX) as conn:
            conn.settimeout(10)
            conn.connect(str(path))
            reply = b''
            try:
                conn.sendall(data)
                while chunk := conn.recv(4096):
                    reply += chunk
            except ConnectionResetError:
                pass
            return reply

    def test_proxy_denies_everything_outside_the_allowlist(self):
        path = self.dir / 'proxy.sock'
        proxy = egress.serve(path, allow={'localhost', 'chatgpt.com'})
        self.addCleanup(proxy.server_close)
        self.addCleanup(proxy.shutdown)
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        cases = [(b'GET http://chatgpt.com/ HTTP/1.1\r\n\r\n', 'CONNECT only'),
                 (b'CONNECT evil.example:443 HTTP/1.1\r\n\r\n', 'destination denied'),
                 (b'CONNECT chatgpt.com:80 HTTP/1.1\r\n\r\n', 'destination denied'),
                 (b'CONNECT localhost:443 HTTP/1.1\r\n\r\n', 'non-public DNS answer'),
                 (b'CONNECT chatgpt.com:443 HTTP/1.1\r\nX: ' + b'a' * 9000 + b'\r\n\r\n', 'header too large')]
        for data, reason in cases:
            with self.subTest(reason=reason):
                reply = self.request(path, data)
                self.assertFalse(reply.startswith(b'HTTP/1.1 200'))
                if reason != 'header too large':
                    self.assertTrue(reply.startswith(b'HTTP/1.1 403'))
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline and (not proxy.events or proxy.events[-1].get('reason') != reason):
                    time.sleep(0.01)
                self.assertEqual(proxy.events[-1], {'decision': 'denied', 'reason': reason})
        self.assertFalse(any(e['decision'] == 'allowed' for e in proxy.events))

    def test_run_bounded_outcomes(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always', ResourceWarning)
            self.assertEqual(egress.run_bounded(['sh', '-c', 'echo ok'])['outcome'], 'passed')
            gc.collect()
        self.assertEqual([w for w in caught if issubclass(w.category, ResourceWarning)], [])
        failed = egress.run_bounded(['sh', '-c', 'echo err >&2; exit 3'])
        self.assertEqual((failed['outcome'], failed['exit'], failed['stderr']), ('worker_failed', 3, 'err\n'))
        flood = egress.run_bounded(['sh', '-c', 'yes'], output_limit=4096)
        self.assertEqual(flood['outcome'], 'output_limit')
        self.assertLessEqual(len(flood['stdout']) + len(flood['stderr']), 4096)
        marker = self.dir / 'child.pid'
        slow = egress.run_bounded(['sh', '-c', f'sleep 30 & echo $! > {marker}; wait'], timeout=0.5)
        self.assertEqual(slow['outcome'], 'timeout')
        child = int(marker.read_text())
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and Path(f'/proc/{child}').exists() and \
                Path(f'/proc/{child}/stat').read_text().split(') ')[1][0] != 'Z':
            time.sleep(0.05)
        self.assertFalse(Path(f'/proc/{child}').exists() and
                         Path(f'/proc/{child}/stat').read_text().split(') ')[1][0] != 'Z')

    def tools(self):
        bin_dir = self.dir / 'opt/bin'
        bin_dir.mkdir(parents=True)
        for name in ['node', 'codex']:
            (bin_dir / name).write_text('#!/bin/sh\n')
            (bin_dir / name).chmod(0o755)
        return mock.patch('shutil.which', lambda name: str(bin_dir / name))

    def test_worker_command_is_scoped_offline_and_least_authority(self):
        request = self.dir / 'request.py'
        request.write_text('print(1)')
        with self.tools():
            argv = egress.role_worker_command('generator', self.dir / 'home', self.dir / 'out', self.dir / 'p.sock',
                                              ['python', '/in/request'], {'request': request},
                                              freeze={'version': 1, 'frozen': True, 'suiteSha256': 'f' * 64})
        self.assertEqual(argv[:3], ['systemd-run', '--user', '--scope'])
        for limit in ['MemoryMax=2G', 'TasksMax=64', 'MemorySwapMax=0', 'RuntimeMaxSec=190s']:
            self.assertIn(limit, argv)
        for flag in ['--unshare-pid', '--clearenv', '--die-with-parent', '--new-session']:
            self.assertIn(flag, argv)
        self.assertEqual(argv[argv.index('ALL') - 1], '--cap-drop')
        self.assertIn('unshare', argv)
        self.assertEqual(argv[argv.index(str(request)) + 1], '/in/request')
        self.assertEqual(argv[argv.index(str(self.dir / 'p.sock')) + 1], '/proxy.sock')
        self.assertFalse(any('docker.sock' in a for a in argv))

    def test_role_authority_refusals(self):
        request = self.dir / 'request.py'
        request.write_text('print(1)')
        cases = [('verifier', {'request': request}, None), ('generator', {'reference': request}, None),
                 ('generator', {'request': request}, None),
                 ('repairer', {'candidate': request}, {'version': 1, 'frozen': False, 'suiteSha256': 'f' * 64}),
                 ('eval_writer', [], None)]
        with self.tools():
            for role, inputs, freeze in cases:
                with self.subTest(role=role, inputs=inputs), self.assertRaises(ValueError):
                    egress.role_worker_command(role, self.dir, self.dir, self.dir / 'p.sock', ['true'], inputs, freeze)
            tree = self.dir / 'tree'
            tree.mkdir()
            (tree / 'link').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):
                egress.role_worker_command('eval_writer', self.dir, self.dir, self.dir / 'p.sock', ['true'],
                                           {'request': tree})


class Upstream(http.server.BaseHTTPRequestHandler):
    status = 200

    def do_POST(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        payload = json.dumps({'model': 'qwen-local', 'echo': json.loads(body)['messages'][0]['content']}).encode()
        self.send_response(self.server.status)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


class LocalProvider(Workspace):
    def setUp(self):
        super().setUp()
        self.upstream = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        self.upstream.status = 200
        threading.Thread(target=self.upstream.serve_forever, daemon=True).start()
        self.addCleanup(self.upstream.server_close)
        self.addCleanup(self.upstream.shutdown)
        self.path = self.dir / 'gateway.sock'
        self.gateway = local_provider.serve(self.path, self.upstream.server_address[1])
        self.addCleanup(self.gateway.server_close)
        self.addCleanup(self.gateway.shutdown)

    def post(self, body=None, route=None, host=local_provider.ALIAS, extra=b''):
        data = json.dumps(body if body is not None else {'model': 'qwen-local', 'messages': [
            {'role': 'user', 'content': 'hi'}], 'temperature': 0, 'max_tokens': 8}).encode()
        route = route or f'http://{local_provider.ALIAS}/v1/chat/completions'
        head = f'POST {route} HTTP/1.1\r\nHost: {host}\r\nContent-Length: {len(data)}\r\n'.encode() + extra + b'\r\n'
        with socket.socket(socket.AF_UNIX) as conn:
            conn.settimeout(10)
            conn.connect(str(self.path))
            conn.sendall(head + data)
            reply = b''
            while chunk := conn.recv(4096):
                reply += chunk
        return reply

    def test_exact_request_is_forwarded(self):
        reply = self.post()
        self.assertTrue(reply.startswith(b'HTTP/1.1 200'), reply)
        self.assertEqual(json.loads(reply.split(b'\r\n\r\n', 1)[1])['echo'], 'hi')
        self.assertEqual(self.gateway.events[-1]['decision'], 'allowed')
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o600)

    def test_policy_refusals(self):
        base = {'model': 'qwen-local', 'messages': [{'role': 'user', 'content': 'hi'}]}
        cases = [dict(route='http://other.invalid/v1/chat/completions'), dict(host='evil.example'),
                 dict(extra=b'Transfer-Encoding: chunked\r\n'), dict(body=dict(base, model='gpt')),
                 dict(body=dict(base, stream=True)), dict(body=dict(base, temperature=0.7)),
                 dict(body=dict(base, tools=[])), dict(body=dict(base, max_tokens=5000)),
                 dict(body=dict(base, max_tokens=True)), dict(body=dict(base, messages=[])),
                 dict(body=dict(base, messages=[{'role': 'assistant', 'content': 'x'}]))]
        for case in cases:
            with self.subTest(case=case):
                self.assertTrue(self.post(**case).startswith(b'HTTP/1.1 403'))
                self.assertEqual(self.gateway.events[-1]['decision'], 'denied')
        self.upstream.status = 500
        self.assertTrue(self.post().startswith(b'HTTP/1.1 403'))

    def test_port_and_call_refusals(self):
        for port in [80, 70000, '8080']:
            with self.assertRaises(ValueError):
                local_provider.Gateway(self.dir / f'g{port}.sock', port)
        with self.assertRaises(ValueError):
            local_provider.call_protected(self.dir / 'calls', '../stage', 'p', 8080)
        with self.assertRaises(ValueError):
            local_provider.call_protected(self.dir / 'calls', 'stage', 'p', 8080, journal=object())
        self.assertFalse((self.dir / 'calls').exists())


class ChatUpstream(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.requests.append({'path': self.path, 'body': body})
        content = 'stub reply to ' + body['messages'][0]['content']
        payload = json.dumps({'model': 'qwen-local', 'choices': [{'message': {'role': 'assistant', 'content': content}}],
                              'usage': {'prompt_tokens': 3, 'completion_tokens': 4, 'total_tokens': 7}}).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


def sandbox_reason():
    import shutil
    for tool in ['bwrap', 'systemd-run', 'systemctl', 'unshare', 'ip', 'node', 'codex']:
        if not shutil.which(tool):
            return tool + ' is not on PATH; egress.worker_command needs it to start a sandboxed worker'
    probe = subprocess.run(['systemctl', '--user', 'show-environment'], capture_output=True, text=True, timeout=10)
    if probe.returncode:
        return 'no systemd user manager for systemd-run --user --scope: ' + probe.stderr.strip()[:160]
    probe = subprocess.run(['unshare', '-Urn', '/bin/sh', '-c', 'ip link set lo up && bwrap --ro-bind / / --cap-drop ALL '
                            '--unshare-pid --die-with-parent --new-session true'], capture_output=True, text=True, timeout=20)
    if probe.returncode:
        return 'unprivileged user/network namespaces or bwrap are unavailable: ' + probe.stderr.strip()[:160]
    return None


class SandboxedWorker(Workspace):
    def setUp(self):
        super().setUp()
        reason = sandbox_reason()
        if reason:
            self.skipTest(reason)
        self.upstream = http.server.ThreadingHTTPServer(('127.0.0.1', 0), ChatUpstream)
        self.upstream.requests = []
        threading.Thread(target=self.upstream.serve_forever, daemon=True).start()
        self.addCleanup(self.upstream.server_close)
        self.addCleanup(self.upstream.shutdown)

    def test_call_protected_runs_a_real_sandboxed_worker_through_the_bridge_relay(self):
        before = set(Path(tempfile.gettempdir()).glob('ef-local-role-*'))
        result = local_provider.call_protected(self.dir / 'calls', 'stage-1', 'hello worker',
                                               self.upstream.server_address[1], max_tokens=16, timeout=60)
        self.assertEqual(result['text'], 'stub reply to hello worker')
        self.assertEqual(self.upstream.requests, [{'path': '/v1/chat/completions', 'body': {
            'model': 'qwen-local', 'messages': [{'role': 'user', 'content': 'hello worker'}], 'temperature': 0,
            'stream': False, 'max_tokens': 16}}])
        stage = self.dir / 'calls/stage-1'
        metadata = json.loads((stage / 'metadata.json').read_text())
        self.assertEqual(metadata, result['metadata'])
        self.assertEqual((metadata['outcome'], metadata['tokens'], metadata['paidProvider']), ('passed', 7, False))
        self.assertEqual(metadata['promptSha256'], sha(b'hello worker'))
        self.assertEqual([e['decision'] for e in metadata['proxyEvents']], ['allowed'])
        self.assertEqual(metadata['proxyEvents'][0]['route'], local_provider.ALIAS)
        self.assertEqual((stage / 'result.txt').read_text(), 'stub reply to hello worker')
        execution = json.loads((stage / 'execution.json').read_text())
        self.assertEqual((execution['outcome'], execution['exit']), ('passed', 0), execution)
        ownership = json.loads((stage / 'ownership.json').read_text())
        self.assertTrue(ownership['scope'].startswith('endoforge-worker-') and ownership['scope'].endswith('.scope'))
        self.assertEqual(ownership['description'], 'endoforge-local-role:' + ownership['scope'])
        scope = subprocess.run(['systemctl', '--user', 'show', ownership['scope'], '--property=ActiveState'],
                               capture_output=True, text=True, timeout=10)
        self.assertNotIn('ActiveState=active', scope.stdout)
        self.assertEqual(len(json.loads((stage / 'scope-cleanup.json').read_text())['actions']), 1)
        self.assertEqual(json.loads((stage / 'credential-cleanup.json').read_text()),
                         {'temporaryRemoved': True, 'journalOwnsTemporary': False, 'credentialsCopied': False})
        self.assertEqual(set(Path(tempfile.gettempdir()).glob('ef-local-role-*')), before)

    def test_worker_has_no_route_but_the_relay(self):
        home, out = self.dir / 'home', self.dir / 'out'
        home.mkdir()
        out.mkdir()
        proxy = egress.serve(self.dir / 'proxy.sock', allow={'chatgpt.com'})
        self.addCleanup(proxy.server_close)
        self.addCleanup(proxy.shutdown)
        probe = self.dir / 'probe.py'
        probe.write_text(
            'import json,socket\n'
            'def reach(addr):\n'
            ' try:\n'
            '  s=socket.create_connection(addr,timeout=2);s.close();return True\n'
            ' except OSError:return False\n'
            's=socket.create_connection(("127.0.0.1",18080),timeout=5)\n'
            's.sendall(b"CONNECT evil.example:443 HTTP/1.1\\r\\n\\r\\n");reply=s.recv(64).decode();s.close()\n'
            'print(json.dumps({"relay":reply.split("\\r\\n")[0],"direct":reach(("127.0.0.1",%d)),'
            '"external":reach(("1.1.1.1",443))}))\n' % self.upstream.server_address[1])
        argv = egress.role_worker_command('eval_writer', home, out, self.dir / 'proxy.sock', ['python', '/in/request'],
                                          {'request': probe})
        unit = argv[argv.index('--unit') + 1] + '.scope'
        self.addCleanup(subprocess.run, ['systemctl', '--user', 'stop', unit], capture_output=True, timeout=15)
        result = egress.run_bounded(argv, timeout=60)
        self.assertEqual((result['outcome'], result['exit']), ('passed', 0), result)
        self.assertEqual(json.loads(result['stdout']),
                         {'relay': 'HTTP/1.1 403 Forbidden', 'direct': False, 'external': False})
        self.assertEqual(proxy.events[-1], {'decision': 'denied', 'reason': 'destination denied'})


class Wasm(Workspace):
    def fake(self, body):
        tool = self.dir / 'wasmtime'
        tool.write_text('#!' + sys.executable + '\n' + body)
        tool.chmod(0o755)
        return tool

    def test_identity_is_required(self):
        tool = self.fake('print(42)\n')
        unset = {k: v for k, v in os.environ.items() if k != 'ENDOFORGE_WASMTIME_SHA256'}
        for env in [unset, dict(unset, ENDOFORGE_WASMTIME_SHA256='0' * 64)]:
            with self.subTest(pinned='ENDOFORGE_WASMTIME_SHA256' in env), mock.patch.dict(os.environ, env, clear=True), \
                    mock.patch.object(wasm, 'WT', tool), self.assertRaises(ValueError):
                wasm.run(self.dir / 'm.wat')

    def test_missing_binary_is_a_refusal_not_a_crash(self):
        env = {'ENDOFORGE_WASMTIME_SHA256': '0' * 64, 'PATH': str(self.dir)}
        with mock.patch.dict(os.environ, env), mock.patch.object(wasm, 'WT', Path('wasmtime')):
            with self.assertRaises(ValueError):
                wasm.run(self.dir / 'm.wat')

    def test_bounded_scoped_invocation(self):
        tool = self.fake('import sys,json\nprint(json.dumps(sys.argv[1:]))\n')
        scope = self.dir / 'bin/systemd-run'
        scope.parent.mkdir()
        scope.write_text('#!/bin/sh\nwhile [ "$1" != "${1#-}" ]; do case "$1" in -p|--unit) shift 2;; *) shift;; esac;'
                         ' done\nexec "$@"\n')
        scope.chmod(0o755)
        env = {'ENDOFORGE_WASMTIME_SHA256': sha(tool.read_bytes()),
               'PATH': str(scope.parent) + os.pathsep + os.environ['PATH']}
        with mock.patch.dict(os.environ, env), mock.patch.object(wasm, 'WT', tool):
            result = wasm.run(self.dir / 'm.wasm', export='add', args=[2, 3])
        self.assertEqual(result['outcome'], 'passed', result)
        argv = json.loads(result['stdout'])
        self.assertEqual(argv[:1], ['run'])
        for flag in ['fuel=100000', 'max-memory-size=1048576', 'trap-on-grow-failure=y', 'timeout=100ms']:
            self.assertIn(flag, argv)
        self.assertEqual(argv[-4:], ['add', str(self.dir / 'm.wasm'), '2', '3'])
        for limit in ['MemoryMax=512M', 'TasksMax=32', 'RuntimeMaxSec=3s']:
            self.assertIn(limit, result['argv'])
        self.assertFalse(result['wallTimeout'])

    @unittest.skipUnless(os.environ.get('ENDOFORGE_WASMTIME') and os.environ.get('ENDOFORGE_WASMTIME_SHA256'),
                         'needs a pinned Wasmtime (ENDOFORGE_WASMTIME and ENDOFORGE_WASMTIME_SHA256) and a '
                         'systemd user manager; the fake-binary test above covers the Python path')
    def test_real_wasmtime(self):
        module = self.dir / 'answer.wat'
        module.write_text('(module (func (export "run") (result i32) i32.const 42))')
        with mock.patch.object(wasm, 'WT', Path(os.environ['ENDOFORGE_WASMTIME'])):
            result = wasm.run(module)
        self.assertEqual((result['outcome'], result['stdout'].strip()), ('passed', '42'))


if __name__ == '__main__':
    unittest.main()
