"""Append-only stage state with recoverable, atomically replaced snapshots."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile


def encoded(obj):return (json.dumps(obj,sort_keys=True,separators=(',',':'))+'\n').encode()
def sync_dir(p):
    fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)


def atomic(path,obj):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(prefix='.snapshot-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as f:f.write(encoded(obj));f.flush();os.fsync(f.fileno())
        os.replace(name,path);sync_dir(path.parent)
    finally:
        if Path(name).exists():Path(name).unlink()


def chain(jobdir):
    events=Path(jobdir)/'state-events';events.mkdir(exist_ok=True)
    rows=[];previous='0'*64
    for i,p in enumerate(sorted(events.glob('*.json')),start=1):
        if p.name!=f'{i:08}.json' or p.is_symlink():raise ValueError('state event order/type')
        raw=p.read_bytes();row=json.loads(raw)
        if row.get('version')!=1 or row.get('seq')!=i or row.get('previous')!=previous:raise ValueError('state hash chain mismatch')
        if row.get('state',{}).get('version')!=1:raise ValueError('state version')
        previous=hashlib.sha256(raw).hexdigest();rows.append(row)
    return rows,previous


def record(jobdir,state,fault=None):
    jobdir=Path(jobdir)
    with (jobdir/'state.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        rows,previous=chain(jobdir)
        row={'version':1,'seq':len(rows)+1,'previous':previous,'state':state}
        event=jobdir/'state-events'/f'{row["seq"]:08}.json'
        with event.open('xb') as f:f.write(encoded(row));f.flush();os.fsync(f.fileno())
        sync_dir(event.parent)
        if fault:fault('event-durable')
        atomic(jobdir/'state.json',state)
        if fault:fault('snapshot-durable')
    return row


def recover(jobdir):
    jobdir=Path(jobdir)
    with (jobdir/'state.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        rows,_=chain(jobdir)
        if not rows:raise ValueError('no durable state events')
        last=rows[-1]['state']
        try:current=json.loads((jobdir/'state.json').read_text())
        except (FileNotFoundError,json.JSONDecodeError):current=None
        if current!=last:atomic(jobdir/'state.json',last)
        return last
