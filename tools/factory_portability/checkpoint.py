#!/usr/bin/env python3
"""Version 1 campaign checkpoints. Encryption: external age X25519 recipients."""
import argparse, ctypes, hashlib, io, json, os, re, shutil, stat, subprocess, tarfile, tempfile
from pathlib import Path, PurePosixPath
VERSION = 'endoforge.checkpoint.v1'
LIMIT = 512 * 1024 * 1024
REQUIRED = {'job_states', 'frozen_evals', 'dependencies', 'references', 'provenance'}
DENY = re.compile(r'(^|/)(\.env(?:\..*)?|\.ssh|\.aws|\.claude|\.codex|credentials?(?:\..*)?|.*\.(?:pem|key))($|/)', re.I)
SECRET = re.compile(rb'-----BEGIN (?:OPENSSH|RSA|EC|PRIVATE)|(?:sk-ant-|sk-proj-)[A-Za-z0-9_-]{12,}|AGE-SECRET-KEY-')
def sha(data): return hashlib.sha256(data).hexdigest()
def safe(name):
    p = PurePosixPath(name)
    if not name or p.is_absolute() or '..' in p.parts or '\\' in name or str(p) != name or DENY.search(name):
        raise ValueError('unsafe or credential-scoped path: ' + name)
    return name
def validate_manifest(m):
    if m.get('schema') != VERSION: raise ValueError('unknown checkpoint schema')
    if not REQUIRED <= m.keys(): raise ValueError('missing checkpoint metadata')
    if not all(isinstance(m[k], (dict,list)) and m[k] for k in REQUIRED): raise ValueError('empty/untyped required metadata')
    if m.get('credentials') != 'excluded-reauthenticate-at-destination': raise ValueError('credentials policy required')
    files=m.get('files')
    if not isinstance(files,dict) or not files: raise ValueError('missing file inventory')
    for name,item in files.items():
        safe(name)
        if name=='checkpoint.json' or not isinstance(item,dict) or set(item)!={'sha256','size','executable'}: raise ValueError('invalid inventory')
        if not re.fullmatch('[a-f0-9]{64}',item['sha256']) or type(item['size']) is not int or item['size']<0 or type(item['executable']) is not bool: raise ValueError('invalid file identity')
    return m

def pack(source, archive, recipient, age='age'):
    source,archive=Path(source),Path(archive)
    if archive.exists(): raise FileExistsError(archive)
    m=json.loads((source/'checkpoint.json').read_text()); files={}; contents={}; total=0
    for p in sorted(source.rglob('*')):
        st=p.lstat()
        if stat.S_ISDIR(st.st_mode): continue
        if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1: raise ValueError('nonregular or hardlinked entry: '+str(p))
        name=safe(p.relative_to(source).as_posix())
        if name=='checkpoint.json': continue
        data=p.read_bytes(); total+=len(data)
        if total>LIMIT: raise ValueError('checkpoint size limit')
        if SECRET.search(data): raise ValueError('credential marker in '+name)
        files[name]={'sha256':sha(data),'size':len(data),'executable':bool(st.st_mode&0o111)}; contents[name]=data
    m['files']=files; validate_manifest(m)
    metadata=json.dumps(m,sort_keys=True).encode()
    if SECRET.search(metadata): raise ValueError('credential marker in metadata')
    buf=io.BytesIO()
    with tarfile.open(fileobj=buf,mode='w') as tf:
        for name,data in [('checkpoint.json',metadata),*contents.items()]:
            item=tarfile.TarInfo(name); item.size=len(data); item.mode=0o600; tf.addfile(item,io.BytesIO(data))
    archive.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=archive.parent,prefix='.checkpoint-'); os.close(fd)
    try:
        cp=subprocess.run([age,'--encrypt','--recipient',recipient],input=buf.getvalue(),stdout=open(tmp,'wb'),stderr=subprocess.PIPE,timeout=120)
        if cp.returncode: raise ValueError('age encryption failed: '+cp.stderr.decode())
        os.link(tmp,archive)
    finally: os.unlink(tmp)
    return {'schema':VERSION,'files':len(files),'archive_sha256':sha(archive.read_bytes()),'plaintext_bytes':total}

def unpack(archive,destination,identity,age='age'):
    destination=Path(destination)
    if destination.exists(): raise FileExistsError(destination)
    # age verifies authentication before any extraction; bounded encrypted input and plaintext.
    if Path(archive).stat().st_size>LIMIT+1024*1024: raise ValueError('archive too large')
    cp=subprocess.run([age,'--decrypt','--identity',str(identity),str(archive)],capture_output=True,timeout=120)
    if cp.returncode: raise ValueError('checkpoint decryption/authentication failed')
    if len(cp.stdout)>LIMIT+1024*1024: raise ValueError('plaintext too large')
    contents={}
    with tarfile.open(fileobj=io.BytesIO(cp.stdout),mode='r:') as tf:
        for item in tf:
            name=safe(item.name)
            if not item.isfile() or item.size>LIMIT or name in contents: raise ValueError('unsafe archive member')
            contents[name]=tf.extractfile(item).read()
    m=validate_manifest(json.loads(contents.pop('checkpoint.json')))
    if set(contents)!=set(m['files']): raise ValueError('inventory mismatch')
    for n,data in contents.items():
        item=m['files'][n]
        if sha(data)!=item['sha256'] or len(data)!=item['size'] or SECRET.search(data): raise ValueError('file validation failed: '+n)
    destination.parent.mkdir(parents=True,exist_ok=True)
    tmp=Path(tempfile.mkdtemp(dir=destination.parent,prefix='.restore-'))
    try:
        for n,data in {**contents,'checkpoint.json':json.dumps(m,indent=2).encode()}.items():
            p=tmp/n; p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(data)
            p.chmod(0o700 if m['files'].get(n,{}).get('executable') else 0o600)
        # Directory rename is atomic on the destination filesystem; refuse existing target.
        if destination.exists(): raise FileExistsError(destination)
        libc=ctypes.CDLL(None,use_errno=True)
        if libc.renameat2(-100,os.fsencode(tmp),-100,os.fsencode(destination),1):
            err=ctypes.get_errno(); raise OSError(err,os.strerror(err))
    finally:
        if tmp.exists(): shutil.rmtree(tmp)
    return {'schema':VERSION,'files':len(contents),'archive_sha256':sha(Path(archive).read_bytes())}

def main():
    ap=argparse.ArgumentParser(); sub=ap.add_subparsers(dest='cmd',required=True)
    p=sub.add_parser('pack'); p.add_argument('source'); p.add_argument('archive'); p.add_argument('--recipient',required=True)
    p=sub.add_parser('unpack'); p.add_argument('archive'); p.add_argument('destination'); p.add_argument('--identity',required=True)
    a=ap.parse_args()
    print(json.dumps(pack(a.source,a.archive,a.recipient) if a.cmd=='pack' else unpack(a.archive,a.destination,a.identity)))
if __name__=='__main__': main()
