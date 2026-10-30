"""Strict host-only schemas, durable writes, identities and advisory fencing."""
import fcntl, hashlib, json, os, re, stat, uuid, math
from pathlib import Path
VERSION=1
ROLES={
 'intake': {'read':['request'],'write':['contract'],'network':[],'promote':False},
 'eval_writer': {'read':['request','bare_signature','reference'],'write':['eval_procedure'],'network':['provider_proxy'],'promote':False},
 'generator': {'read':['request','typed_contract'],'write':['candidate'],'network':['provider_proxy'],'promote':False},
 'repairer': {'read':['candidate','permitted_failure'],'write':['candidate'],'network':['provider_proxy'],'promote':False},
 'verifier': {'read':['frozen_evals','candidate','reference'],'write':['gate_receipt'],'network':[],'promote':False},
 'consumer': {'read':['request','bare_signature','capability_interface'],'write':['invocation_plan'],'network':['provider_proxy'],'promote':False},
 'supervisor': {'read':['journals','receipts'],'write':['attempts','journals','fences'],'network':['docker_management'],'promote':False},
 'publisher': {'read':['gate_receipt','candidate','fence'],'write':['publication'],'network':[],'promote':True}}
TRANSITIONS={'queued':['running','cancelled','blocked'],'running':['passed','failed','timeout','cancelled','unknown'],'unknown':['reconciled','publication_recovered'],'reconciled':[],'publication_recovered':[],'passed':[],'failed':[],'timeout':[],'cancelled':[],'blocked':['queued']}
def valid_id(s): return isinstance(s,str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',s)
def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def fsync_dir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY)
 try: os.fsync(fd)
 finally: os.close(fd)
def durable(p,value,exclusive=True):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('x' if exclusive else 'w') as f:
  json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 fsync_dir(p.parent)
def identity(pid=None):
 pid=pid or os.getpid()
 try:
  raw=Path(f'/proc/{pid}/stat').read_text(); fields=raw[raw.rindex(')')+2:].split()
  return {'pid':pid,'starttime':fields[19],'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
 except FileNotFoundError: return None
def alive(who): return bool(who and identity(who['pid'])==who)
class Fence:
 def __init__(self,root): self.root=Path(root)
 def __enter__(self):
  self.root.mkdir(parents=True,exist_ok=True)
  self.fd=os.open(self.root/'controller.lock',os.O_CREAT|os.O_RDWR,0o600)
  try: fcntl.flock(self.fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BaseException: os.close(self.fd);raise RuntimeError('another live controller holds fence')
  self.token=uuid.uuid4().hex;self.who=identity()
  durable(self.root/'controller.json',{'version':1,'generation':self.token,'identity':self.who},False)
  return self
 def check(self):
  record=json.loads((self.root/'controller.json').read_text())
  if record['generation']!=self.token or not alive(self.who): raise RuntimeError('stale controller fence')
 def __exit__(self,*a): fcntl.flock(self.fd,fcntl.LOCK_UN);os.close(self.fd)
def validate_spec(s):
 required={'version','job','attempt','input','inputSha256','expectedSha256','script','timeoutSeconds'}
 if set(s)!=required or (type(s.get('version')) is not int or s.get('version')!=1): raise ValueError('unknown schema version or fields')
 if not all(valid_id(s[k]) for k in ['job','attempt']):raise ValueError('unsafe identifier')
 if not all(isinstance(s[k],str) and re.fullmatch('[0-9a-f]{64}',s[k]) for k in ['inputSha256','expectedSha256']):raise ValueError('invalid digest')
 if not isinstance(s['script'],str) or not isinstance(s['input'],str):raise ValueError('invalid input/script')
 if isinstance(s['timeoutSeconds'],bool) or not isinstance(s['timeoutSeconds'],(int,float)) or not 0<s['timeoutSeconds']<=600:raise ValueError('invalid timeout')
 return s
def import_regular(source,dest,max_bytes=1048576):
 """No archive extraction: accept a single owned regular file without link aliases."""
 fd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd)
  if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or st.st_size>max_bytes:raise ValueError('unsafe artifact type/link/size')
  data=os.read(fd,max_bytes+1)
  if len(data)>max_bytes:raise ValueError('artifact budget exceeded')
 finally:os.close(fd)
 p=Path(dest)
 with p.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 fsync_dir(p.parent)
 return hashlib.sha256(data).hexdigest()


def validate_mount_tree(source):
 source=Path(source)
 for p in [source]+(list(source.rglob('*')) if source.is_dir() else []):
  st=p.lstat()
  if stat.S_ISDIR(st.st_mode):continue
  if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1:raise ValueError('mount contains link/socket/special file')
 return True

def validate_record(record,kind):
 required={'version','kind','job','attempt','state','parent','usage','hashes','error'}
 if set(record)!=required or (type(record.get('version')) is not int or record.get('version')!=1) or record.get('kind')!=kind:raise ValueError('unknown schema version/fields/kind')
 if kind not in ['job','attempt','stage','receipt']:raise ValueError('unknown record kind')
 if not all(valid_id(record.get(key)) for key in ['job','attempt']):raise ValueError('record identity')
 if record.get('state') not in TRANSITIONS:raise ValueError('terminal/state unknown')
 if record.get('parent') is not None and not valid_id(record['parent']):raise ValueError('invalid parent')
 usage=record['usage']
 if not isinstance(usage,dict) or set(usage)!={'wallMs','tokens'} or not isinstance(usage['wallMs'],(int,float)) or not math.isfinite(usage['wallMs']) or usage['wallMs']<0 or isinstance(usage['wallMs'],bool):raise ValueError('invalid usage')
 if usage['tokens'] is not None and (not isinstance(usage['tokens'],int) or isinstance(usage['tokens'],bool) or usage['tokens']<0):raise ValueError('invalid tokens')
 hashes=record['hashes']
 if not isinstance(hashes,dict) or not hashes or not all(valid_id(k) and isinstance(v,str) and re.fullmatch('[a-f0-9]{64}',v) for k,v in hashes.items()):raise ValueError('invalid content hashes')
 if record['state']=='publication_recovered' and 'artifact' not in hashes:raise ValueError('recovery needs artifact digest')
 error=record['error']
 if error is not None and (not isinstance(error,dict) or set(error)!={'type','message'} or not all(isinstance(x,str) and x for x in error.values())):raise ValueError('invalid error')
 if record['state'] in ['failed','timeout','cancelled','unknown'] and error is None:raise ValueError('terminal failure needs error')
 return record

def transition(before,after):
 if after not in TRANSITIONS.get(before,[]):raise ValueError('illegal stage transition')
 return after

def import_archive(*args,**kwargs):
 raise ValueError('archive extraction unsupported; import individually validated regular files')
