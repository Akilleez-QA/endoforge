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

IMAGE = 'sha256:653395e40dfce4bbf2f3919638c1f375056deb81f47d8e3f7c855ed7b27b6541'
DOCKER = ['sudo', '-n', 'docker']

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')

def seal(path):
    for p in Path(path).rglob('*'):
        p.chmod(0o555 if p.is_dir() else 0o444)
    Path(path).chmod(0o555)

def run_attempt(root, attempt, job, frozen_input, input_sha, expected_sha, script, timeout=3):
    """Return receipt; raise FileExistsError before writes if attempt already exists.

    Publication is one atomic no-overwrite hard link of a validated regular file.
    Caller owns trusted expected hashes/script and must not expose root to workers.
    """
    if not all(re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', x) for x in (attempt, job)):
        raise ValueError('unsafe identifier')
    root = Path(root).resolve()
    attempts = root / 'attempts'
    attempts.mkdir(parents=True, exist_ok=True)
    dest = attempts / attempt
    dest.mkdir()  # exclusive; do not mutate an existing attempt
    token = uuid.uuid4().hex
    name = 'endoforge-p12-' + token
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
    owned = False
    stage = None
    try:
        if sha(frozen_input) != input_sha:
            result['outcome'] = 'input_rejected'
        else:
            # Copy validated input: no TOCTOU exposure of the caller's mutable file.
            data = Path(frozen_input).read_bytes()
            if hashlib.sha256(data).hexdigest() != input_sha:
                raise ValueError('input changed while snapshotting')
            snapshot = dest / 'input.txt'
            snapshot.write_bytes(data)
            snapshot.chmod(0o444)
            result['inputSha256'] = input_sha
            owned = True  # cleanup by unique name even if create is interrupted
            created = cmd(['create', '--name', name, '--label', 'endoforge.probe=P12',
                '--label', 'endoforge.owner=' + token, '--pull=never', '--network=none', '--read-only', '--user', f'{os.getuid()}:{os.getgid()}',
                '--cap-drop=ALL', '--security-opt=no-new-privileges', '--cpus=1',
                '--memory=128m', '--memory-swap=128m', '--pids-limit=32',
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
                        elif hashlib.sha256(payload).hexdigest() != expected_sha:
                            result['outcome'] = 'validation_failed'
                        else:
                            stage = dest / 'artifact.txt'
                            stage.write_bytes(payload)
                            stage.chmod(0o444)
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
            if stage and sha(dest / 'input.txt') != input_sha:
                result['outcome'] = 'input_changed'
            if stage and result['outcome'] == 'validation_pending':
                published = root / 'published'
                published.mkdir(exist_ok=True)
                try:
                    os.link(stage, published / (job + '.txt'))
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
        write(dest / 'result.json', result)
        seal(dest)
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    return result

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('root'); p.add_argument('attempt'); p.add_argument('job'); p.add_argument('input')
    p.add_argument('input_sha'); p.add_argument('expected_sha'); p.add_argument('script')
    p.add_argument('--timeout', type=float, default=3)
    a = p.parse_args()
    print(json.dumps(run_attempt(a.root, a.attempt, a.job, a.input, a.input_sha,
                                a.expected_sha, a.script, a.timeout)))
