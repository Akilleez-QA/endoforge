"""Durable host model-stage ownership journal. No model calls or automatic retry.

Use one fenced ModelJournal per campaign. Declare the scope before launching it,
set systemd Description to scope_description(), and register the exact worker PID
when available. Reconciliation records unknown for interrupted stages and preserves durable terminal
observations for cleanup only. External files never imply success or promotion.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import uuid


def _sync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


def _safe_dir(path):
    path=Path(path).absolute()
    for part in [*reversed(path.parents),path]:
        if part.is_symlink():raise ValueError('symlink journal path')
    if not path.is_dir():raise ValueError('journal directory absent')
    return path


def _atomic(path,value):
    path=Path(path);_safe_dir(path.parent)
    if path.is_symlink():raise ValueError('symlink journal file')
    fd,name=tempfile.mkstemp(prefix='.journal-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb')as stream:
            stream.write((json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode())
            stream.flush();os.fsync(stream.fileno())
        os.replace(name,path);_sync_dir(path.parent)
    finally:
        if Path(name).exists():Path(name).unlink()


def identity(pid=None):
    pid=pid or os.getpid()
    try:
        raw=Path(f'/proc/{pid}/stat').read_text();fields=raw[raw.rindex(')')+2:].split()
        return {'pid':int(pid),'starttime':fields[19],'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'state':fields[0]}
    except (FileNotFoundError,ProcessLookupError):return None


def alive(who):
    if not isinstance(who,dict):return False
    current=identity(who.get('pid'))
    return bool(current and current['state']not in {'Z','X'}and all(current[k]==who.get(k)for k in ['pid','starttime','bootId']))


def _read(path):
    path=Path(path)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):raise ValueError('journal must be regular')
        with os.fdopen(fd,'r')as stream:return json.load(stream)
    except BaseException:
        try:os.close(fd)
        except OSError:pass
        raise


class ModelJournal:
    """Controller fence and explicit new_attempt/start/finish/reconcile API."""
    def __init__(self,root,_fault=None):self.root=Path(root).absolute();self.fd=None;self._fault=_fault

    def __enter__(self):
        for part in [*reversed(self.root.parents),self.root]:
            if part.is_symlink():raise ValueError('symlink journal path')
        if not self.root.exists():self.root.mkdir(parents=True,mode=0o700)
        _safe_dir(self.root)
        mode=self.root.stat()
        if mode.st_uid!=os.getuid()or mode.st_mode&0o022:raise ValueError('journal root must be owner-controlled')
        self.fd=os.open(self.root/'model-controller.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
        try:fcntl.flock(self.fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BaseException:os.close(self.fd);self.fd=None;raise RuntimeError('live model controller holds fence')
        try:
            self.generation=uuid.uuid4().hex;self.who=identity()
            (self.root/'model-attempts').mkdir(exist_ok=True,mode=0o700);_safe_dir(self.root/'model-attempts');_sync_dir(self.root)
            _atomic(self.root/'model-controller.json',{'version':1,'generation':self.generation,'controller':self.who})
            return self
        except BaseException:
            fcntl.flock(self.fd,fcntl.LOCK_UN);os.close(self.fd);self.fd=None;raise

    def check(self):
        if self.fd is None:raise RuntimeError('closed model controller fence')
        row=_read(self.root/'model-controller.json')
        if row.get('generation')!=self.generation or not alive(self.who)or self.who['pid']!=os.getpid():raise RuntimeError('stale model controller fence')

    def __exit__(self,*args):
        if self.fd is not None:fcntl.flock(self.fd,fcntl.LOCK_UN);os.close(self.fd);self.fd=None

    def _path(self,attempt):
        if not isinstance(attempt,str)or not re.fullmatch('[0-9a-f]{32}',attempt):raise ValueError('unsafe attempt id')
        return self.root/'model-attempts'/attempt

    def read(self,attempt):
        dest=self._path(attempt);_safe_dir(dest)
        events=dest/'events';_safe_dir(events);previous='0'*64;latest=None
        for i,eventpath in enumerate(sorted(events.glob('*.json')),1):
            if eventpath.name!=f'{i:08}.json':raise ValueError('journal event order')
            event=_read(eventpath)
            if event.get('version')!=1 or event.get('sequence')!=i or event.get('previous')!=previous:raise ValueError('journal event chain')
            previous=hashlib.sha256(eventpath.read_bytes()).hexdigest();latest=event['state']
        if latest is None:raise ValueError('no durable attempt event')
        row=latest
        try:snapshot=_read(dest/'state.json')
        except (FileNotFoundError,json.JSONDecodeError):snapshot=None
        if snapshot!=row:
            self.check();_atomic(dest/'state.json',row)
        if row.get('version')!=1 or row.get('attempt')!=attempt or row.get('journalRoot')!=str(self.root):raise ValueError('journal identity mismatch')
        if row.get('scope')!='endoforge-worker-'+attempt+'.scope':raise ValueError('scope ownership mismatch')
        if row.get('temporary')!='/tmp/ef-model-journal-'+attempt:raise ValueError('unsafe temporary path')
        if not isinstance(row.get('controller'),dict)or not re.fullmatch('[0-9a-f]{32}',row.get('generation','')):raise ValueError('controller identity missing')
        return row

    def _save(self,row,event):
        self.check();dest=self._path(row['attempt']);_safe_dir(dest)
        events=dest/'events';_safe_dir(events);names=sorted(events.glob('*.json'))
        seq=len(names)+1;previous=hashlib.sha256(names[-1].read_bytes()).hexdigest()if names else '0'*64;entry={'previous':previous,'version':1,'sequence':seq,'event':event,'atUnix':time.time(),'writerGeneration':self.generation,'state':row}
        eventpath=events/f'{seq:08}.json'
        if eventpath.exists():raise RuntimeError('journal event already exists')
        _atomic(eventpath,entry)
        if self._fault:self._fault(event,'event-durable-before-snapshot')
        _atomic(dest/'state.json',row)
        return row

    def new_attempt(self,stage,family,prompt_sha256,retry_of=None):
        self.check()
        if not isinstance(stage,str)or not re.fullmatch('[A-Za-z0-9_-]{1,100}',stage):raise ValueError('unsafe model stage')
        if family not in {'claude','codex','qwen','deterministic-test'}:raise ValueError('unsupported family')
        if not re.fullmatch('[a-f0-9]{64}',prompt_sha256):raise ValueError('prompt digest')
        previous=[self.read(p.name)for p in (self.root/'model-attempts').iterdir()if p.is_dir()and self.read(p.name)['stage']==stage]
        if previous:
            if not retry_of or retry_of not in [r['attempt']for r in previous]:raise RuntimeError('explicit retry_of required; no automatic retry')
            if any(r['state']in {'planned','running'}for r in previous):raise RuntimeError('unreconciled model stage')
        elif retry_of is not None:raise ValueError('retry parent absent')
        token=uuid.uuid4().hex;dest=self._path(token);dest.mkdir(mode=0o700);(dest/'events').mkdir(mode=0o700);_sync_dir(dest);_sync_dir(dest.parent)
        row={'version':1,'attempt':token,'stage':stage,'family':family,'promptSha256':prompt_sha256,'controller':self.who,'generation':self.generation,'journalRoot':str(self.root),'scope':'endoforge-worker-'+token+'.scope','temporary':'/tmp/ef-model-journal-'+token,'state':'planned','retryOf':retry_of,'worker':None,'promotionAllowed':False,'automaticRetry':False}
        return self._save(row,'declared-before-worker')

    def private_home(self,attempt):
        row=self.read(attempt);self._owned(row);target=Path(row['temporary'])
        target.mkdir(mode=0o700);_sync_dir(target.parent)
        _atomic(target/'.model-owner.json',{'version':1,'attempt':attempt,'journalRoot':str(self.root)})
        (target/'home').mkdir(mode=0o700);_sync_dir(target)
        return target/'home'

    def scope_description(self,attempt):return 'endoforge-model-journal:'+self.read(attempt)['attempt']

    def _owned(self,row):
        self.check()
        if row['generation']!=self.generation or row['controller']!=self.who:raise RuntimeError('attempt owned by another controller generation')

    def started(self,attempt,pid=None):
        row=self.read(attempt);self._owned(row)
        if row['state']!='planned':raise RuntimeError('attempt already started')
        if pid is not None:
            worker=identity(pid)
            if not alive(worker):raise RuntimeError('worker not alive')
            proc=Path(f'/proc/{pid}/stat').read_text();fields=proc[proc.rindex(')')+2:].split()
            if int(fields[1])!=os.getpid():raise RuntimeError('worker not controller direct child')
            row['worker']=worker
        row['state']='running';return self._save(row,'worker-started')

    def finish(self,attempt,outcome,metadata=None):
        row=self.read(attempt);self._owned(row)
        if row['state']not in {'planned','running'}:raise RuntimeError('model attempt already terminal')
        if outcome not in {'passed','failed','timeout','cancelled','unknown'}:raise ValueError('terminal outcome')
        row['state']=outcome;row['metadata']=metadata or {};return self._save(row,'terminal-observed')

    def _cleanup(self,row,stop_scope=True):
        self.check();actions=[]
        if stop_scope:
            found=subprocess.run(['systemctl','--user','show',row['scope'],'--property=Description','--property=LoadState'],capture_output=True,text=True,timeout=10)
            properties=dict(line.split('=',1)for line in found.stdout.splitlines()if '='in line)
            if found.returncode!=0:raise RuntimeError('scope state could not be verified')
            loadstate=properties.get('LoadState');description=properties.get('Description')
            if loadstate=='not-found':actions.append({'scope':row['scope'],'absent':True,'loadState':loadstate})
            elif loadstate=='loaded'and description==self.scope_description(row['attempt']):
                stopped=subprocess.run(['systemctl','--user','stop',row['scope']],capture_output=True,text=True,timeout=15)
                if stopped.returncode:raise RuntimeError('owned scope stop failed')
                actions.append({'scope':row['scope'],'stopped':True,'loadState':loadstate})
            else:raise RuntimeError('scope state/description ownership mismatch')
        worker=row.get('worker')
        if alive(worker):
            fd=os.pidfd_open(worker['pid'])
            try:
                if alive(worker):signal.pidfd_send_signal(fd,signal.SIGKILL)
            finally:os.close(fd)
            actions.append({'worker':worker,'signalledExactPid':True,'descendantsCovered':False})
        target=Path(row['temporary'])
        if target.is_symlink():raise ValueError('temporary path symlink')
        if target.exists():
            if target.parent!=Path('/tmp')or target.name!='ef-model-journal-'+row['attempt']:raise ValueError('unsafe temporary cleanup')
            mode=target.stat();marker=_read(target/'.model-owner.json')
            if not stat.S_ISDIR(mode.st_mode)or mode.st_uid!=os.getuid()or stat.S_IMODE(mode.st_mode)!=0o700 or marker!={'version':1,'attempt':row['attempt'],'journalRoot':str(self.root)}:raise ValueError('temporary ownership mismatch')
            if not shutil.rmtree.avoids_symlink_attacks:raise RuntimeError('safe recursive removal unavailable')
            shutil.rmtree(target);_sync_dir(target.parent);actions.append({'temporary':str(target),'removed':True})
        return actions

    def cleanup_owned(self,attempt,stop_scope=True):
        row=self.read(attempt);self._owned(row)
        if row['state']in {'planned','running'}:raise RuntimeError('record terminal outcome before cleanup')
        actions=self._cleanup(row,stop_scope);row['cleanup']=actions;return self._save(row,'owned-cleanup')

    def reconcile(self,attempt,stop_scope=True):
        self.check();row=self.read(attempt)
        if alive(row['controller']):raise RuntimeError('controller live; reconciliation forbidden')
        if row['state']not in {'planned','running','unknown','passed','failed','timeout','cancelled'}:raise RuntimeError('invalid attempt state')
        # Preserve a durably observed terminal result, but infer no success from files.
        if row['state']in {'planned','running','unknown'}:row['state']='unknown'
        else:row['observedTerminalOutcome']=row['state']
        row['recoveryOutcome']='cleanup-only-no-promotion-no-retry';row['reconciledBy']={'generation':self.generation,'controller':self.who}
        self._save(row,'controller-dead-outcome-unknown'if row['state']=='unknown'else'controller-dead-terminal-cleanup-only')
        try:row['cleanup']=self._cleanup(row,stop_scope);row['cleanupComplete']=True
        except BaseException as exc:row['cleanupComplete']=False;row['cleanupError']=str(exc);self._save(row,'reconciliation-cleanup-incomplete');raise
        return self._save(row,'reconciled-no-retry-no-promotion')
