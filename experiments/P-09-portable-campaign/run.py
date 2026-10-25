#!/usr/bin/env python3
"""One-shot, offline-after-image-setup probe; no candidate or production edits."""
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import statistics
import subprocess
import tarfile
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORK = HERE / 'work'
RECEIPT = HERE / 'receipt'
BASE = 'node@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e'
IMAGE = 'endoforge-p09:probe'
RESTORED_IMAGE = 'endoforge-p09:roundtrip'
DOCKER = ['sudo', '-n', 'docker']
START = time.monotonic()
COMMANDS = []


def write(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2) + '\n')


def sha(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def manifest(p):
    return {str(f.relative_to(p)): sha(f) for f in sorted(p.rglob('*')) if f.is_file()}


def command(args, check=True, timeout=90):
    if time.monotonic() - START > 600:
        raise RuntimeError('10 minute budget exhausted')
    if shutil.disk_usage(HERE).free < 5 * 1024**3:
        raise RuntimeError('less than 5 GiB free')
    begin = time.monotonic()
    r = subprocess.run([str(a) for a in args], capture_output=True, text=True, timeout=timeout)
    row = {'argv': [str(a) for a in args], 'exit': r.returncode,
           'wallMs': (time.monotonic() - begin) * 1000, 'stdout': r.stdout, 'stderr': r.stderr}
    COMMANDS.append(row)
    write(RECEIPT / 'commands.json', COMMANDS)
    if check and r.returncode:
        raise RuntimeError(f'command failed: {args[0:4]}: {r.stderr[-2000:]}')
    return row


def environment():
    return {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'kernel': platform.platform(), 'cpu': next((x.split(':', 1)[1].strip() for x in Path('/proc/cpuinfo').read_text().splitlines() if x.startswith('model name')), None),
            'cpuCount': os.cpu_count(), 'load': os.getloadavg(),
            'meminfo': Path('/proc/meminfo').read_text(),
            'freeBytes': shutil.disk_usage(HERE).free,
            'git': command(['git', '-C', ROOT, 'rev-parse', 'HEAD'])['stdout'].strip(),
            'gitStatus': command(['git', '-C', ROOT, 'status', '--short'])['stdout'],
            'docker': command(DOCKER + ['version', '--format', '{{json .}}'])['stdout'],
            'runnerSha256': sha(HERE / 'run.py'), 'boundarySha256': sha(HERE / 'boundary.mjs'),
            'precommitSha256': sha(HERE / 'PRECOMMIT.md')}


def stats(rows):
    a = sorted(r['wallMs'] for r in rows)
    return {'n': len(a), 'medianMs': statistics.median(a), 'p95Ms': a[math.ceil(.95 * len(a)) - 1], 'minMs': a[0], 'maxMs': a[-1]}


def docker_args(image, mounts=()):
    args = DOCKER + ['run', '--rm', '--pull=never', '--network=none', '--read-only',
                     '--user', f'{os.getuid()}:{os.getgid()}', '--cap-drop=ALL',
                     '--security-opt=no-new-privileges', '--cpus=1', '--memory=512m',
                     '--memory-swap=512m', '--pids-limit=64', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m']
    for src, dst, mode in mounts:
        args += ['--mount', f'type=bind,src={src},dst={dst}' + (',readonly' if mode == 'ro' else '')]
    return args + ['--entrypoint', '/usr/local/bin/node', image]


def bwrap_args(out):
    args = ['bwrap']
    for p in ['/usr', '/lib', '/lib64', '/bin', '/sbin']:
        if Path(p).exists():
            args += ['--ro-bind', p, p]
    return args + ['--ro-bind', str(WORK / 'node'), '/opt/node',
                   '--ro-bind', str(WORK / 'context/bundle'), '/bundle',
                   '--bind', str(out), '/out', '--tmpfs', '/tmp', '--proc', '/proc',
                   '--dev', '/dev', '--unshare-all', '--die-with-parent', '--new-session',
                   '--clearenv', '--setenv', 'PATH', '/opt:/usr/bin:/bin',
                   '--setenv', 'HOME', '/tmp', '--chdir', '/tmp']


def semantic(result):
    # Drop only timestamps and measured execution times; keep every gate, value and error.
    return {k: ({g: {a: b for a, b in v.items() if a not in ('maxMs',)} for g, v in value.items()} if k == 'gates'
                else [{a: b for a, b in t.items() if a != 'ms'} for t in value] if k == 'tests'
                else value) for k, value in result.items() if k != 'at'}


def replay(backend, source, image=IMAGE):
    out = WORK / backend
    shutil.copytree(source / 'candidates', out)
    rows = []
    for candidate in sorted(out.iterdir()):
        common = ['/bundle/campaigns/x1-spec-study/factory/gate.mjs', 'run', f'/out/{candidate.name}']
        if backend == 'bubblewrap':
            args = bwrap_args(out) + ['--', '/opt/node'] + common
        else:
            args = docker_args(image, [(out, '/out', 'rw')]) + common
        row = command(args, check=False)
        if row['exit'] not in (0, 1) or not (candidate / 'result.json').exists():
            raise RuntimeError(f'incomplete gate receipt: {backend}/{candidate.name}')
        result = json.loads((candidate / 'result.json').read_text())
        record = {'id': candidate.name, **row, 'result': result, 'wasmSha256': sha(candidate / 'kernel.wasm') if (candidate / 'kernel.wasm').exists() else None}
        write(RECEIPT / backend / f'{candidate.name}.json', record)
        rows.append(record)
        print(f'{backend}: {candidate.name} promotable={result["promotable"]}', flush=True)
    return rows


def main():
    if WORK.exists() or (RECEIPT / 'env-before.json').exists():
        raise RuntimeError('one-shot run exists; preserve its evidence and use a new probe for repetition')
    expected = (RECEIPT / 'precommit.sha256').read_text().split()[0]
    if sha(HERE / 'PRECOMMIT.md') != expected:
        raise RuntimeError('precommit hash mismatch')
    WORK.mkdir()
    write(RECEIPT / 'env-before.json', environment())
    bundle = WORK / 'context/bundle'
    factory = bundle / 'campaigns/x1-spec-study/factory'
    factory.mkdir(parents=True)
    for name in ['gate.mjs', 'glue.schema.json']:
        shutil.copy2(ROOT / 'campaigns/x1-spec-study/factory' / name, factory / name)
    compiler = ROOT / 'experiments/P-02-compiler-in-isolate'
    shutil.copytree(compiler / 'node_modules', bundle / 'experiments/P-02-compiler-in-isolate/node_modules', symlinks=True)
    for name in ['package.json', 'package-lock.json']:
        shutil.copy2(compiler / name, bundle / 'experiments/P-02-compiler-in-isolate' / name)
    shutil.copy2(HERE / 'boundary.mjs', bundle / 'boundary.mjs')
    inputs = WORK / 'inputs'
    before = {}
    old_results = {}
    names = ['CONTRACT.md', 'tests.json', 'frozen.sha256', 'kernel.ts', 'glue.json']
    for d in sorted((ROOT / 'campaigns/x1-spec-study/work/factory').iterdir()):
        if not d.is_dir() or not all((d / n).is_file() for n in names):
            continue
        dst = inputs / 'candidates' / d.name
        dst.mkdir(parents=True)
        for n in names:
            before[str(d / n)] = sha(d / n)
            shutil.copy2(d / n, dst / n)
        if (d / 'result.json').exists():
            old_results[d.name] = json.loads((d / 'result.json').read_text()).get('promotable')
        request = ROOT / 'campaigns/x1-spec-study/work/pool' / f'{d.name}.md'
        before[str(request)] = sha(request)
        request_dst = inputs / 'requests' / request.name
        request_dst.parent.mkdir(exist_ok=True)
        shutil.copy2(request, request_dst)
    if not old_results:
        raise RuntimeError('no frozen candidate receipts')
    write(RECEIPT / 'source-manifest.json', before)
    write(RECEIPT / 'bundle-manifest.json', manifest(bundle))
    write(RECEIPT / 'input-manifest.json', manifest(inputs))
    dockerfile = f'FROM {BASE}\nCOPY bundle /bundle\nENV PATH="/usr/local/bin:/usr/bin:/bin" HOME=/tmp\nWORKDIR /tmp\n'
    (WORK / 'context/Dockerfile').write_text(dockerfile)
    command(DOCKER + ['build', '--network=none', '-t', IMAGE, WORK / 'context'])
    inspect = json.loads(command(DOCKER + ['image', 'inspect', IMAGE])['stdout'])[0]
    write(RECEIPT / 'image.json', inspect)
    name = f'endoforge-p09-extract-{os.getpid()}'
    command(DOCKER + ['create', '--name', name, IMAGE])
    try:
        command(DOCKER + ['cp', f'{name}:/usr/local/bin/node', WORK / 'node'])
    finally:
        command(DOCKER + ['rm', name])
    write(RECEIPT / 'toolchain.json', {'nodeSha256': sha(WORK / 'node'), 'nativeNode': command([WORK / 'node', '--version'])['stdout'], 'containerNode': command(docker_args(IMAGE) + ['--version'])['stdout'], 'base': BASE})
    boundary = []
    canary = WORK / 'host-private-canary'
    canary.write_text('not mounted into workers\n')
    first = sorted((inputs / 'candidates').iterdir())[0]
    for role in ['generator', 'evaluator']:
        view = WORK / f'{role}-inputs'
        view.mkdir()
        shutil.copy2(first / 'CONTRACT.md', view / 'CONTRACT.md')
        shutil.copy2(inputs / 'requests' / f'{first.name}.md', view / 'request.md')
        row = command(docker_args(IMAGE, [(view, '/in', 'ro')]) + ['/bundle/boundary.mjs', role, canary])
        boundary.append(json.loads(row['stdout']))
    write(RECEIPT / 'boundary.json', boundary)
    starts = {'docker': [], 'bubblewrap': []}
    warm = WORK / 'startup-out'
    warm.mkdir()
    # One excluded warmup per backend, then alternate to reduce order drift.
    true_docker = docker_args(IMAGE)
    index = true_docker.index('--entrypoint') + 1
    true_docker[index] = '/bin/true'
    true_bwrap = bwrap_args(warm) + ['--', '/bin/true']
    for args in [true_docker, true_bwrap]:
        command(args)
    for _ in range(10):
        for backend, args in [('docker', true_docker), ('bubblewrap', true_bwrap)]:
            starts[backend].append(command(args))
    write(RECEIPT / 'startup.json', starts)
    native = replay('bubblewrap', inputs)
    container = replay('docker', inputs)
    # Do not delete/unregister the source image to simulate another machine.
    archive = WORK / 'image.tar'
    command(DOCKER + ['save', '-o', archive, IMAGE])
    # docker writes root-owned output; sudo reads it for the checksum without changing permissions.
    image_archive_sha = command(['sudo', '-n', 'sha256sum', archive])['stdout'].split()[0]
    command(DOCKER + ['load', '-i', archive])
    command(DOCKER + ['tag', inspect['Id'], RESTORED_IMAGE])
    restored_id = command(DOCKER + ['image', 'inspect', RESTORED_IMAGE, '--format', '{{.Id}}'])['stdout'].strip()
    # Known local archive only, member names and regular files checked before extraction.
    input_tar = WORK / 'inputs.tar.gz'
    with tarfile.open(input_tar, 'w:gz') as t:
        t.add(inputs, arcname='inputs')
    restored = WORK / 'restored'
    restored.mkdir()
    with tarfile.open(input_tar) as t:
        for m in t.getmembers():
            p = Path(m.name)
            if p.is_absolute() or '..' in p.parts or not (m.isfile() or m.isdir()):
                raise RuntimeError('unsafe local input archive')
        t.extractall(restored, filter='data')
    input_roundtrip = manifest(inputs) == manifest(restored / 'inputs')
    if not input_roundtrip:
        raise RuntimeError('input restore hash mismatch')
    roundtrip = replay('roundtrip', restored / 'inputs', RESTORED_IMAGE)
    comparisons = []
    for a, b, c in zip(native, container, roundtrip, strict=True):
        comparisons.append({'id': a['id'], 'matches': a['id'] == b['id'] == c['id'] and semantic(a['result']) == semantic(b['result']) == semantic(c['result']) and a['wasmSha256'] == b['wasmSha256'] == c['wasmSha256'], 'promotable': a['result']['promotable'], 'priorPromotable': old_results.get(a['id']), 'exitMatches': a['exit'] == b['exit'] == c['exit']})
    immutable = all(sha(Path(p)) == digest for p, digest in before.items())
    receipt_complete = all((RECEIPT / backend / f'{row["id"]}.json').exists() for backend, rows in [('bubblewrap', native), ('docker', container), ('roundtrip', roundtrip)] for row in rows)
    passed = immutable and receipt_complete and input_roundtrip and restored_id == inspect['Id'] and all(c['matches'] and c['exitMatches'] for c in comparisons) and all(b['ok'] for b in boundary)
    write(RECEIPT / 'summary.json', {'label': 'Recorded (probe)', 'passed': passed, 'candidates': len(native), 'comparisons': comparisons, 'boundary': boundary, 'sourceUnchanged': immutable, 'receiptComplete': receipt_complete, 'imageRoundtrip': restored_id == inspect['Id'], 'inputsRoundtrip': input_roundtrip, 'imageArchiveSha256': image_archive_sha, 'imageArchiveBytes': archive.stat().st_size, 'inputArchiveSha256': sha(input_tar), 'inputArchiveBytes': input_tar.stat().st_size, 'startup': {k: stats(v) for k, v in starts.items()}, 'replay': {k: stats(v) for k, v in [('bubblewrap', native), ('docker', container), ('roundtrip', roundtrip)]}, 'elapsedSeconds': time.monotonic() - START})
    write(RECEIPT / 'env-after.json', environment())
    if not passed:
        raise RuntimeError('probe failed acceptance checks; inspect summary')
    print(json.dumps(json.loads((RECEIPT / 'summary.json').read_text()), indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        write(RECEIPT / 'failure.json', {'error': str(e), 'elapsedSeconds': time.monotonic() - START})
        raise
