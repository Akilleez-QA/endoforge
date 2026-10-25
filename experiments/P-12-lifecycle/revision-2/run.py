#!/usr/bin/env python3
"""One-shot fault-matrix qualification; rerun only in a fresh probe copy."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import statistics
import subprocess
import sys
import time
import lifecycle
from unittest.mock import patch
from lifecycle import IMAGE, DOCKER, run_attempt, sha, write
HERE = Path(__file__).resolve().parent
ROOT = next(p for p in HERE.parents if (p/'.git').is_dir())
RECEIPT = HERE / 'receipt'

def environment():
    return {'utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'kernel': platform.platform(), 'python': sys.version,
            'cpu': next(x for x in Path('/proc/cpuinfo').read_text().splitlines() if x.startswith('model name')),
            'cpuCount': os.cpu_count(), 'load': os.getloadavg(),
            'memory': Path('/proc/meminfo').read_text(), 'freeBytes': shutil.disk_usage(HERE).free,
            'git': subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip(),
            'docker': subprocess.check_output(DOCKER+['version', '--format', '{{json .}}'], text=True),
            'image': subprocess.check_output(DOCKER+['image', 'inspect', IMAGE], text=True)}

def tree_digest(path):
    return {str(p.relative_to(path)):sha(p) for p in sorted(path.rglob('*')) if p.is_file()}

def main():
    # Exclusive claim before changing any receipts on rerun.
    RECEIPT.mkdir()
    write(RECEIPT/'frozen-hashes.json', {p.name:sha(p) for p in [HERE/'PRECOMMIT.md',HERE/'run.py',HERE/'lifecycle.py']})
    write(RECEIPT/'env-before.json', environment())
    if shutil.disk_usage(HERE).free < 5*1024**3:
        raise RuntimeError('disk stop rule')
    started=time.monotonic()
    frozen=RECEIPT/'frozen-input.txt'
    frozen.write_text('artifact-ok\n')
    frozen.chmod(0o444)
    expected=sha(frozen)
    rows=[]
    def case(name, script, want, timeout=3, job=None, input_hash=expected):
        if time.monotonic()-started > 300:
            raise RuntimeError('time stop rule')
        row=run_attempt(RECEIPT, name, job or name, frozen,input_hash,expected,script,timeout)
        assert row['outcome']==want, row
        assert row['cleanupVerified'], row
        rows.append(row)
    case('success','cat /input.txt','passed',job='single-job')
    case('nonzero','echo failure >&2; exit 7','worker_failed')
    case('timeout','echo waiting >&2; sleep 100','timeout',timeout=.4)
    case('missing','true','missing_output')
    case('invalid','printf incorrect','validation_failed')
    case('duplicate','cat /input.txt','duplicate_publication',job='single-job')
    case('tampered','cat /input.txt','input_rejected',input_hash='0'*64)
    before=tree_digest(RECEIPT/'attempts'/'success')
    try:
        run_attempt(RECEIPT,'success','another',frozen,expected,expected,'cat /input.txt')
        raise AssertionError('reuse accepted')
    except FileExistsError:
        pass
    assert before==tree_digest(RECEIPT/'attempts'/'success')
    write(RECEIPT/'reuse.json',{'outcome':'refused','before':before,'after':tree_digest(RECEIPT/'attempts'/'success'),'unchanged':True})
    argv=[sys.executable,str(HERE/'lifecycle.py'),str(RECEIPT),'interrupted','interrupted',str(frozen),expected,expected,'echo ready >&2; sleep 100','--timeout','20']
    proc=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    name=None
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        command_file=RECEIPT/'attempts'/'interrupted'/'commands.json'
        if command_file.exists():
            try:
                commands=json.loads(command_file.read_text())
                if any('start' in c['argv'] and c['exit']==0 for c in commands):
                    name=commands[0]['argv'][commands[0]['argv'].index('--name')+1]
                    break
            except (ValueError,KeyError):
                pass
        time.sleep(.05)
    assert name, 'controller never started'
    proc.send_signal(signal.SIGINT)
    stdout,stderr=proc.communicate(timeout=30)
    write(RECEIPT/'interrupt-controller.json',{'argv':argv,'signal':'SIGINT','exit':proc.returncode,'stdout':stdout,'stderr':stderr})
    row=json.loads((RECEIPT/'attempts'/'interrupted'/'result.json').read_text())
    assert row['outcome']=='interrupted' and row['cleanupVerified'] and not row['published'],row
    rows.append(row)
    # Missing immutable image must fail without pulling or leaking a container.
    with patch.object(lifecycle, 'IMAGE', 'sha256:'+'0'*64):
        case('create-failure','cat /input.txt','controller_error')
    real_run=subprocess.run
    def fail_start(argv, **kwargs):
        if argv[:3]==DOCKER and len(argv)>3 and argv[3]=='start':
            return subprocess.CompletedProcess(argv,71,'','injected client start failure')
        return real_run(argv,**kwargs)
    with patch.object(lifecycle.subprocess,'run',side_effect=fail_start):
        case('start-failure','cat /input.txt','controller_error')
    # Test collision: existing foreign container must survive refusal untouched.
    from types import SimpleNamespace
    token='collision'+str(os.getpid())
    foreign='endoforge-p12-'+token
    subprocess.run(DOCKER+['create','--name',foreign,'--label','endoforge.owner=foreign',
        '--pull=never','--network=none','--entrypoint','/bin/true',IMAGE],check=True,capture_output=True)
    try:
        with patch.object(lifecycle.uuid,'uuid4',return_value=SimpleNamespace(hex=token)):
            row=run_attempt(RECEIPT,'collision','collision',frozen,expected,expected,'cat /input.txt')
        assert row['outcome']=='cleanup_failed' and 'ownership label mismatch' in row['cleanupError'],row
        assert not row['published']
        foreign_inspect=json.loads(subprocess.check_output(DOCKER+['inspect',foreign],text=True))[0]
        assert foreign_inspect['Config']['Labels']['endoforge.owner']=='foreign'
        write(RECEIPT/'collision-survival.json',{'survived':True,'inspect':foreign_inspect})
    finally:
        subprocess.run(DOCKER+['rm',foreign],check=True,capture_output=True)
    all_names=[r['containerName'] for r in rows]
    assert len(set(all_names))==len(all_names)
    assert list((RECEIPT/'published').iterdir())==[RECEIPT/'published'/'single-job.txt']
    assert sha(frozen)==expected
    remaining=subprocess.check_output(DOCKER+['ps','-aq','--filter','label=endoforge.probe=P12'],text=True)
    assert not remaining.strip(),remaining
    write(RECEIPT/'final-containers.json',{'argv':DOCKER+['ps','-aq','--filter','label=endoforge.probe=P12'],'stdout':remaining})
    values=sorted(r['wallMs'] for r in rows)
    write(RECEIPT/'summary.json',{'label':'Recorded (probe)','matrixPassed':True,'foreignCollisionPreserved':True,'createFailureQualified':True,'startClientFailureQualified':True,'attempts':rows,
        'attemptReuseUnchanged':True,'onlyOnePublication':True,'inputUnchanged':True,
        'wallTimeDescriptiveOnly':{'n':len(values),'medianMs':statistics.median(values),'p95Ms':values[-1],'minMs':values[0],'maxMs':values[-1]},
        'elapsedSeconds':time.monotonic()-started})
    write(RECEIPT/'env-after.json',environment())
    print(json.dumps({'passed':True,'attempts':len(rows),'elapsedSeconds':time.monotonic()-started}))

if __name__=='__main__':
    main()
