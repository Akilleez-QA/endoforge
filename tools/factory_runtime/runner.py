#!/usr/bin/env python3
"""Trusted-host offline worker runner. Workers cannot access receipts/publication."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import uuid
from .recovery import journal_before_create
from .core import Fence, identity, fsync_dir, durable, import_regular, validate_record

IMAGE = os.environ.get('ENDOFORGE_WORKER_IMAGE', '')
DOCKER = ['sudo', '-n', 'docker']

def _checkpoint(point):
    """No-op hook for externally injected controller-crash qualification."""
    pass

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')

def seal(path):
    for p in Path(path).rglob('*'):
        p.chmod(0o555 if p.is_dir() else 0o444)
    Path(path).chmod(0o555)

def _run_attempt(root, attempt, job, frozen_input, input_sha, expected_sha, script, timeout=3, fence=None, capture_only=False):
    """Return receipt; raise FileExistsError before writes if attempt already exists.

    Publication is one atomic no-overwrite hard link of a validated regular file.
    Caller owns trusted expected hashes/script and must not expose root to workers.
    """
    if not all(re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', x) for x in (attempt, job)):
        raise ValueError('unsafe identifier')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', IMAGE):
        raise ValueError('Set ENDOFORGE_WORKER_IMAGE to a qualified image digest')
    root = Path(root).resolve()
    attempts = root / 'attempts'
    attempts.mkdir(parents=True, exist_ok=True)
    dest = attempts / attempt
    dest.mkdir()  # exclusive; do not mutate an existing attempt
    token = uuid.uuid4().hex
    name = 'endoforge-v1-' + token
    commands = []
    interrupted = []
    previous = {}
    result = {'attempt': attempt, 'job': job, 'containerName': name, 'image': IMAGE,
              'outcome': 'controller_error', 'published': False}
    started = time.monotonic()

    def received(sig, frame):
        interrupted.append(sig)

    def cmd(args, check=True):
        argv = DOCKER + [str(a) for a in args]
        begin = time.monotonic()
        r = subprocess.run(argv, capture_output=True, text=True, timeout=20)
        commands.append({'argv': argv, 'exit': r.returncode, 'stdout': r.stdout,
                         'stderr': r.stderr, 'wallMs': (time.monotonic()-begin)*1000})
        write(dest / 'commands.json', commands)
        if check and r.returncode:
            raise RuntimeError('Docker command failed: ' + r.stderr[:500])
        return r

    def stopped():
        r = cmd(['inspect', '--format', '{{json .State}}', name])
        state = json.loads(r.stdout)
        return state, not state['Running']

    for sig in (signal.SIGINT, signal.SIGTERM):
        previous[sig] = signal.signal(sig, received)
    journal_before_create(root, attempt, job, token, expected_sha, fence, capture_only)
    owned = False
    stage = None
    try:
        if sha(frozen_input) != input_sha:
            result['outcome'] = 'input_rejected'
        else:
            # Copy validated input: no TOCTOU exposure of the caller's mutable file.
            snapshot = dest / 'input.txt'
            if import_regular(frozen_input,snapshot) != input_sha:
                raise ValueError('input changed while snapshotting')
            snapshot.chmod(0o444)
            result['inputSha256'] = input_sha
            owned = True  # cleanup by unique name even if create is interrupted
            created = cmd(['create', '--name', name, '--label', 'endoforge.runtime=v1',
                '--label', 'endoforge.owner=' + token, '--pull=never', '--network=none', '--read-only', '--user', f'{os.getuid()}:{os.getgid()}',
                '--cap-drop=ALL', '--security-opt=no-new-privileges', '--cpus=1',
                '--memory=512m', '--memory-swap=512m', '--pids-limit=32',
                '--log-opt', 'max-size=1m', '--log-opt', 'max-file=1',
                '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m',
                '--tmpfs', f'/out:rw,nosuid,nodev,size=8m,uid={os.getuid()},gid={os.getgid()}',
                '--mount', f'type=bind,src={snapshot},dst=/input.txt,readonly',
                '--entrypoint', '/bin/sh', IMAGE, '-c', script])
            result['containerId'] = created.stdout.strip()
            if not interrupted:
                cmd(['start', name])
            deadline = time.monotonic() + timeout
            while True:
                state, terminal = stopped()
                if interrupted:
                    result['outcome'] = 'interrupted'
                    break
                if terminal:
                    result['outcome'] = 'worker_failed' if state['ExitCode'] else 'validation_pending'
                    break
                if time.monotonic() >= deadline:
                    result['outcome'] = 'timeout'
                    break
                time.sleep(.1)
    except Exception as exc:
        result['error'] = repr(exc)
    finally:
        # Catchable signals only set a flag; no asynchronous exception can skip cleanup.
        try:
            if owned:
                probe = cmd(['inspect', name], check=False)
                if probe.returncode == 0:
                    inspected = json.loads(probe.stdout)[0]
                    if inspected.get('Config', {}).get('Labels', {}).get('endoforge.owner') != token:
                        owned = False
                        raise RuntimeError('ownership label mismatch; refusing cleanup')
                    state = inspected['State']
                    if state['Running']:
                        cmd(['kill', name])
                    state, terminal = stopped()
                    result['terminalState'] = state
                    if not terminal:
                        raise RuntimeError('container did not become terminal')
                    logs = cmd(['logs', name], check=False)
                    (dest / 'stdout.log').write_text(logs.stdout)
                    (dest / 'stderr.log').write_text(logs.stderr)
                    # tmpfs disappears on stop; export via docker cp is unavailable then.
                    # The trusted artifact channel is stdout, bounded by log rotation.
                    if result['outcome'] == 'validation_pending':
                        payload = logs.stdout.encode()
                        if not payload:
                            result['outcome'] = 'missing_output'
                        elif capture_only:
                            result.update(outcome='captured',captureOnly=True,capturedSha256=hashlib.sha256(payload).hexdigest(),stdoutPath=str(dest / 'stdout.log'))
                        elif hashlib.sha256(payload).hexdigest() != expected_sha:
                            result['outcome'] = 'validation_failed'
                        else:
                            stage = dest / 'artifact.txt'
                            stage.write_bytes(payload)
                            stage.chmod(0o444)
                            with stage.open('rb') as artifact_fd: os.fsync(artifact_fd.fileno())
                            fsync_dir(dest)
                            _checkpoint('artifact_fsynced')
                            result['artifactSha256'] = sha(stage)
                    cmd(['rm', name])
                verify = cmd(['ps', '-aq', '--filter', 'name=^/' + name + '$'])
                result['cleanupVerified'] = not bool(verify.stdout.strip())
                if not result['cleanupVerified']:
                    raise RuntimeError('owned container remains')
            else:
                result['cleanupVerified'] = True
            if interrupted and result['outcome'] == 'validation_pending':
                result['outcome'] = 'interrupted'
            if stage and (sha(dest / 'input.txt') != input_sha or sha(frozen_input) != input_sha):
                result['outcome'] = 'input_changed'
            if stage and result['outcome'] == 'validation_pending':
                published = root / 'published'
                published.mkdir(exist_ok=True)
                try:
                    fence.check()
                    durable(dest / 'validated.json', {'version':1,'expectedSha256':expected_sha,'generation':fence.token})
                    _checkpoint('validation_receipt_fsynced')
                    os.link(stage, published / (job + '.txt'))
                    fsync_dir(published)
                    fsync_dir(root)
                    _checkpoint('publication_fsynced')
                    result.update(outcome='passed', published=True)
                except FileExistsError:
                    result['outcome'] = 'duplicate_publication'
        except Exception as exc:
            result.update(outcome='cleanup_failed', cleanupError=repr(exc), cleanupVerified=False)
            # Last-resort deletion limited to unique owned name.
            if owned:
                fallback = cmd(['inspect', name], check=False)
                if fallback.returncode == 0 and json.loads(fallback.stdout)[0].get('Config', {}).get('Labels', {}).get('endoforge.owner') == token:
                    cmd(['rm', '-f', name], check=False)
        result['signals'] = interrupted
        result['wallMs'] = (time.monotonic()-started)*1000
        write(dest / 'commands.json', commands)
        result.update(version=1, parent=None, stage='verification', usage={'wallMs':result['wallMs'],'tokens':None}, generation=fence.token)
        state={'passed':'passed','captured':'passed','timeout':'timeout','interrupted':'cancelled'}.get(result['outcome'],'failed')
        record={'version':1,'kind':'receipt','job':job,'attempt':attempt,'state':state,'parent':None,'usage':result['usage'],'hashes':{'input':input_sha,'expected':expected_sha},'error':None if state=='passed' else {'type':result['outcome'],'message':result.get('error',result['outcome'])}}
        if result.get('artifactSha256'):record['hashes']['artifact']=result['artifactSha256']
        validate_record(record,'receipt')
        durable(dest / 'record.json',record)
        durable(dest / 'result.json', result)
        _checkpoint('terminal_receipt_fsynced')
        seal(dest)
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    return result


def run_attempt(root, attempt, job, frozen_input, input_sha, expected_sha, script, timeout=3):
    with Fence(root) as fence:
        return _run_attempt(root,attempt,job,frozen_input,input_sha,expected_sha,script,timeout,fence)


def capture_attempt(root,attempt,job,frozen_input,input_sha,script,timeout=3):
    """Offline bounded compile/capture stage; never publishes or invokes output.

    Caller must independently validate captured stdout (e.g. base64 WASM), then
    run bounded verification. Captured digest is observation, not acceptance.
    """
    with Fence(root) as fence:
        return _run_attempt(root,attempt,job,frozen_input,input_sha,'0'*64,script,timeout,fence,capture_only=True)
