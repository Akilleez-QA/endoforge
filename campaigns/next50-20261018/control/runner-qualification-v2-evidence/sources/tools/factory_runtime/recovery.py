"""Trusted host journal and explicit per-attempt crash reconciliation."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid
from .core import Fence, alive, identity, durable

DOCKER=['sudo','-n','docker']

def valid_id(value):
    return isinstance(value,str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',value)

def validate(journal, attempt):
    if not isinstance(journal.get('controller'),dict) or not re.fullmatch(r'[a-f0-9]{32}',journal.get('generation','')):
        raise ValueError('missing controller identity/generation')
    if journal.get('version') != 1 or journal.get('attempt') != attempt:
        raise ValueError('journal identity mismatch')
    if not all(valid_id(journal.get(k)) for k in ('attempt','job')):
        raise ValueError('unsafe journal identifier')
    if not re.fullmatch(r'[a-f0-9]{32}',journal.get('token','')):
        raise ValueError('unsafe token')
    if journal.get('containerName') != 'endoforge-v1-'+journal['token']:
        raise ValueError('unsafe container name')
    if not re.fullmatch(r'[a-f0-9]{64}',journal.get('expectedSha256','')):
        raise ValueError('unsafe expected digest')

def fsync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def journal_before_create(root, attempt, job, token, expected, fence, capture_only=False):
    root=Path(root)
    journals=root/'journals'
    journals.mkdir(exist_ok=True)
    fsync_dir(root)
    j={'version':1,'attempt':attempt,'job':job,'token':token,
       'containerName':'endoforge-v1-'+token,'expectedSha256':expected,'controller':identity(),'generation':fence.token,'captureOnly':capture_only}
    validate(j,attempt)
    with (journals/(attempt+'.json')).open('x') as f:
        f.write(json.dumps(j,indent=2)+'\n')
        f.flush(); os.fsync(f.fileno())
    fsync_dir(journals)
    return j

def _reconcile(root, attempt, fence):
    """Call only after supervisor has established this controller is dead.

    Operates on one validated journal; never scans/removes by global label/name.
    Original attempt evidence is preserved; recovery gets its own unique receipt.
    """
    if not valid_id(attempt): raise ValueError('unsafe attempt')
    root=Path(root).resolve()
    journal_path=root/'journals'/(attempt+'.json')
    if journal_path.is_symlink(): raise ValueError('symlink journal')
    j=json.loads(journal_path.read_text())
    validate(j,attempt)
    if alive(j.get('controller')): raise RuntimeError('controller is live; refusing reconciliation')
    fence.check()
    out=root/'reconciliations'
    out.mkdir(exist_ok=True)
    dest=out/(attempt+'-'+uuid.uuid4().hex)
    dest.mkdir()
    rows=[]
    result={'attempt':attempt,'job':j['job'],'outcome':'reconciliation_failed','published':False}
    def cmd(args,check=True):
        r=subprocess.run(DOCKER+args,capture_output=True,text=True,timeout=20)
        rows.append({'argv':DOCKER+args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
        if check and r.returncode: raise RuntimeError(r.stderr)
        return r
    try:
        name=j['containerName']
        inspected=cmd(['inspect',name],False)
        if inspected.returncode==0:
            data=json.loads(inspected.stdout)[0]
            if data.get('Config',{}).get('Labels',{}).get('endoforge.owner') != j['token']:
                raise ValueError('ownership mismatch; no container mutation')
            if data['State']['Running']: cmd(['kill',name])
            terminal=json.loads(cmd(['inspect',name]).stdout)[0]['State']
            if terminal['Running']: raise RuntimeError('not terminal')
            result['terminalState']=terminal
            logs=cmd(['logs',name],False)
            (dest/'stdout.log').write_text(logs.stdout)
            (dest/'stderr.log').write_text(logs.stderr)
            cmd(['rm',name])
        else:
            # Distinguish absence from daemon failure; never call either cleanup success blindly.
            if cmd(['ps','-aq','--filter','name=^/'+name+'$']).stdout.strip():
                raise RuntimeError('inspect failed but container exists')
        if cmd(['ps','-aq','--filter','name=^/'+name+'$']).stdout.strip():
            raise RuntimeError('owned container remains')
        result['cleanupVerified']=True
        published=root/'published'/(j['job']+'.txt')
        if published.is_symlink(): raise ValueError('symlink publication')
        if published.exists() and not j.get('captureOnly'):
            digest=hashlib.sha256(published.read_bytes()).hexdigest()
            if digest!=j['expectedSha256']: raise ValueError('published digest mismatch')
            result.update(outcome='publication_recovered',published=True,artifactSha256=digest)
        else:
            # Never promote logs/staging after an uncertain crash.
            result['outcome']='interrupted_reconciled'
    except Exception as exc:
        result['error']=repr(exc)
    (dest/'commands.json').write_text(json.dumps(rows,indent=2)+'\n')
    (dest/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    result['receipt']=str(dest)
    return result


def reconcile(root,attempt):
    with Fence(root) as fence:
        return _reconcile(root,attempt,fence)

def reconcile_all(root):
    return [reconcile(root,p.stem) for p in sorted((Path(root)/'journals').glob('*.json'))]
