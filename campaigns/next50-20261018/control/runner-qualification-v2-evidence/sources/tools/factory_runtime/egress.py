"""Trusted host CONNECT proxy: exact provider allowlist, public DNS only, port 443.

Worker has no network interface other than loopback; socat forwards its local
HTTP proxy to this private Unix socket. TLS remains end-to-end. No payload logs.
"""
import ipaddress, os, select, socket, socketserver, threading, uuid
ALLOW={'chatgpt.com','auth.openai.com','api.openai.com'}
def tls_client_hello(connection,expected):
 """Validate visible SNI before forwarding an end-to-end TLS tunnel."""
 def exact(n):
  result=b''
  while len(result)<n:
   chunk=connection.recv(n-len(result))
   if not chunk:raise ValueError('TLS EOF')
   result+=chunk
  return result
 raw=b'';hello=b''
 while len(hello)<4 or len(hello)<4+int.from_bytes(hello[1:4],'big'):
  header=exact(5);size=int.from_bytes(header[3:5],'big')
  if header[0]!=22 or size>32768 or len(raw)+size>65536:raise ValueError('invalid TLS hello record')
  part=exact(size);raw+=header+part;hello+=part
 if hello[0]!=1:raise ValueError('TLS ClientHello required')
 body=hello[4:];offset=34
 if len(body)<offset+1:raise ValueError('short TLS hello')
 offset+=1+body[offset];length=int.from_bytes(body[offset:offset+2],'big');offset+=2+length
 offset+=1+body[offset];length=int.from_bytes(body[offset:offset+2],'big');offset+=2;end=offset+length;names=[]
 while offset+4<=end:
  kind=int.from_bytes(body[offset:offset+2],'big');size=int.from_bytes(body[offset+2:offset+4],'big');extension=body[offset+4:offset+4+size];offset+=4+size
  if kind in [0xfe0d,0xffce]:raise ValueError('encrypted client hello unsupported')
  if kind==0:
   pos=2
   while pos+3<=len(extension):
    typ=extension[pos];n=int.from_bytes(extension[pos+1:pos+3],'big');pos+=3
    if typ==0:names.append(extension[pos:pos+n].decode('ascii'))
    pos+=n
 if names!=[expected]:raise ValueError('TLS SNI must equal CONNECT authority')
 return raw

class Proxy(socketserver.ThreadingUnixStreamServer):
 daemon_threads=True
 request_queue_size=32
 def __init__(self,path,allow=None):
  self.allow=set(allow or ALLOW);self.events=[];self.total_requests=0;self.slots=threading.BoundedSemaphore(32);super().__init__(str(path),Handler);os.chmod(path,0o600)
 def record(self,event):
  if len(self.events)>=4096:self.events.pop(0)
  self.events.append(event)
 def process_request(self,request,address):
  self.total_requests+=1
  if self.total_requests>2048:self.close_request(request);return
  if not self.slots.acquire(blocking=False):self.close_request(request);return
  try:super().process_request(request,address)
  except BaseException:self.slots.release();raise
 def process_request_thread(self,request,address):
  try:super().process_request_thread(request,address)
  finally:self.slots.release()
class Handler(socketserver.BaseRequestHandler):
 def handle(self):
  self.request.settimeout(10);data=b''
  try:
   while b'\r\n\r\n' not in data:
    chunk=self.request.recv(1)
    if not chunk:return
    data+=chunk
    if len(data)>8192:raise ValueError('header too large')
   parts=data.split(b'\r\n',1)[0].decode('ascii').split()
   if len(parts)!=3 or parts[0]!='CONNECT':raise ValueError('CONNECT only')
   host,port=parts[1].rsplit(':',1)
   if host not in self.server.allow or port!='443':raise ValueError('destination denied')
   addresses=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
   if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):raise ValueError('non-public DNS answer')
   # IPv4-only upstream avoids translation/tunneling address ranges. Direct
   # IPv6 in the worker is unroutable; IPv6 CONNECT literals are not allowlisted.
   addresses=[row for row in addresses if row[0]==socket.AF_INET]
   if not addresses:raise ValueError('no public IPv4 upstream')
   # Connect using the already checked numeric result, never resolve a second time.
   fam,typ,proto,_,addr=addresses[0];up=socket.socket(fam,typ,proto);up.settimeout(15);up.connect(addr)
   self.server.record({'host':host,'decision':'allowed','ip':addr[0]})
   self.request.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
   hello=tls_client_hello(self.request,host)
   up.sendall(hello)
   with up:
    sockets=[up,self.request]
    while True:
     ready,_,_=select.select(sockets,[],[],180)
     if not ready:return
     for source in ready:
      chunk=source.recv(65536)
      if not chunk:return
      (up if source is self.request else self.request).sendall(chunk)
  except Exception as e:
   if 'up' in locals():up.close()
   self.server.record({'decision':'denied','reason':str(e)[:120]})
   try:self.request.sendall(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
   except OSError:pass

def serve(path,allow=None):
 proxy=Proxy(path,allow);threading.Thread(target=proxy.serve_forever,daemon=True).start();return proxy

def worker_command(home,work,proxy_socket,command,readonly=None):
 """Isolated home/out, no peer/repo/docker socket; ONLY declared code mounts."""
 from pathlib import Path
 import shutil
 node=Path(shutil.which('node')).resolve();codex=Path(shutil.which('codex')).resolve()
 b=['bwrap','--unshare-user','--unshare-net','--unshare-pid','--unshare-uts','--unshare-ipc','--cap-drop','ALL','--die-with-parent','--new-session','--clearenv']
 for path in ['/usr','/lib','/lib64','/bin','/sbin','/etc/ssl','/etc/ca-certificates','/etc/passwd','/etc/group']:
  if Path(path).exists():b+=['--ro-bind',path,path]
 for path in sorted(set([node.parent.parent,codex.parent.parent])):b+=['--ro-bind',str(path),str(path)]
 b+=['--ro-bind',str(Path(__file__).with_name('bridge.py')),'/bridge.py']
 b+=['--size','67108864','--tmpfs','/home/worker','--size','8388608','--tmpfs','/out','--ro-bind',str(proxy_socket),'/proxy.sock','--proc','/proc','--dev','/dev','--remount-ro','/dev','--size','67108864','--tmpfs','/tmp','--chdir','/out']
 for rel in ['.codex/auth.json']:
  source=Path(home)/rel
  if source.exists():b+=['--ro-bind',str(source),'/home/worker/'+rel]
 for source,target in readonly or []:
  from .core import validate_mount_tree
  validate_mount_tree(source)
  b+=['--ro-bind',str(source),target]
 for key,value in {'HOME':'/home/worker','PATH':':'.join(map(str,[node.parent,codex.parent,'/usr/bin','/bin'])),'LANG':'C.UTF-8','HTTPS_PROXY':'http://127.0.0.1:18080','HTTP_PROXY':'http://127.0.0.1:18080','ALL_PROXY':'http://127.0.0.1:18080','NO_PROXY':''}.items():b+=['--setenv',key,value]
 # Unshare leaves loopback down. Raising only loopback needs namespaced cap_net_admin;
 # bwrap drops caps, so unshare net wrapper raises it before inner bwrap.
 b.remove('--unshare-net');b.remove('--unshare-user');b+=['--remount-ro','/']
 import shlex
 inner='set -e; python /bridge.py & bridge_pid=$!; i=0; while ! test -f /tmp/bridge-ready; do kill -0 "$bridge_pid"; i=$((i+1)); test "$i" -lt 200; sleep .01; done; exec '+shlex.join(command)
 return ['systemd-run','--user','--scope','--quiet','--unit','endoforge-worker-'+uuid.uuid4().hex,'-p','RuntimeMaxSec=190s','-p','MemoryMax=2G','-p','MemorySwapMax=0','-p','TasksMax=64','-p','CPUQuota=100%','unshare','-Urn','/bin/sh','-c','set -e; ip link set lo up; exec "$@"','endoforge-net']+b+['/bin/sh','-c',inner]


def run_bounded(command,timeout=180,output_limit=1048576,preexec_fn=None):
 """Bound combined stdout+stderr and terminate the exact process group on excess."""
 import subprocess,time,signal,selectors
 started=time.monotonic();p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,preexec_fn=preexec_fn)
 sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ,'stdout');sel.register(p.stderr,selectors.EVENT_READ,'stderr');data={'stdout':bytearray(),'stderr':bytearray()};reason=None
 while sel.get_map():
  if time.monotonic()-started>timeout:reason='timeout';break
  for key,_ in sel.select(.05):
   chunk=os.read(key.fileobj.fileno(),65536)
   if not chunk:sel.unregister(key.fileobj);continue
   data[key.data].extend(chunk)
   if sum(map(len,data.values()))>output_limit:reason='output_limit';break
  if reason:break
 if reason:
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
 p.wait(timeout=10);sel.close()
 # Retain at most the declared receipt payload bytes.
 left=output_limit;out={}
 for key in ['stdout','stderr']:
  out[key]=bytes(data[key][:left]).decode(errors='replace');left-=len(data[key][:left])
 return dict(out,version=1,exit=p.returncode,outcome=reason or ('passed' if p.returncode==0 else 'worker_failed'),wallMs=(time.monotonic()-started)*1000,outputLimit=output_limit)

def role_worker_command(role,home,work,proxy_socket,command,inputs,freeze=None):
 """Host assembles a least-authority role view; evaluator never sees candidates.

 Named resources map to individual /in/<name> mounts. Generator/repairer cannot
 start until host verifies a frozen suite digest (suite itself is never mounted).
 """
 from .core import ROLES,valid_id
 import re
 if role not in ['eval_writer','generator','repairer','consumer']:raise ValueError('not a model-worker role')
 if not isinstance(inputs,dict) or not set(inputs).issubset(ROLES[role]['read']):raise ValueError('role input authority violation')
 if role in ['generator','repairer'] and (not isinstance(freeze,dict) or freeze.get('version')!=1 or freeze.get('frozen') is not True or not re.fullmatch('[a-f0-9]{64}',freeze.get('suiteSha256',''))):raise ValueError('evals must freeze before generation/repair')
 return worker_command(home,work,proxy_socket,command,[(path,'/in/'+key) for key,path in inputs.items()])
