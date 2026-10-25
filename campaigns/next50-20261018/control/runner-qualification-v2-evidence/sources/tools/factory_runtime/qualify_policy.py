import json,os,shutil,socket,ssl,subprocess,tempfile,threading,time,uuid
from pathlib import Path
from unittest.mock import patch
from . import core,egress
from .runner import capture_attempt
from .scheduler import Scheduler
R=Path(__file__).resolve().parents[2];A=R/'campaigns/next50-20261018/runtime'/('policy-'+uuid.uuid4().hex[:8]);A.mkdir()
def save(n,v):core.durable(A/(n+'.json'),v)
def main():
 scratch=Path(tempfile.mkdtemp(prefix='endoforge-policy-'));proxy=None
 try:
  home=scratch/'home';home.mkdir();out=scratch/'out';out.mkdir();sock=scratch/'proxy.sock';proxy=egress.serve(sock,{'redirect.test'})
  def run(command):return egress.run_bounded(egress.worker_command(home,out,sock,command),timeout=15)
  # EOF must return immediately and release bounded thread slot.
  client=socket.socket(socket.AF_UNIX);client.connect(str(sock));client.sendall(b'CONNECT');client.close();time.sleep(.05)
  # Real HTTPS redirect through proxy, injected trusted upstream target only.
  key=scratch/'key.pem';cert=scratch/'cert.pem'
  subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-keyout',str(key),'-out',str(cert),'-days','1','-nodes','-subj','/CN=redirect.test'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
  listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen();port=listener.getsockname()[1]
  context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(cert,key)
  def endpoint():
   conn,_=listener.accept()
   with context.wrap_socket(conn,server_side=True) as tls:
    tls.recv(8192);tls.sendall(b'HTTP/1.1 302 Found\r\nLocation: https://169.254.169.254/latest/meta-data/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
   listener.close()
  threading.Thread(target=endpoint,daemon=True).start();original_connect=socket.socket.connect;original_dns=socket.getaddrinfo
  def dns(host,p,*args,**kwargs):
   if host=='redirect.test':return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34',443))]
   return original_dns(host,p,*args,**kwargs)
  def connect(s,address):return original_connect(s,('127.0.0.1',port) if address==('93.184.216.34',443) else address)
  with patch.object(egress.socket,'getaddrinfo',side_effect=dns),patch.object(socket.socket,'connect',connect):
   got=run(['curl','-kfSL','--max-time','10','https://redirect.test'])
  assert got['exit']!=0 and any(e.get('host')=='redirect.test' for e in proxy.events) and any(e.get('decision')=='denied' for e in proxy.events);save('redirect-control',{'upstreamInjection':'global DNS and connection numerically redirected to local testTLS server only in trusted proxy','result':got,'events':proxy.events})
  # Real worker bounds are reflected in actual cgroup files via trusted host lookup.
  got=run(['python','-c','print(open("/proc/self/cgroup").read())']);assert got['exit']==0
  path=got['stdout'].strip().split('::',1)[1];cgroup=Path('/sys/fs/cgroup')/path.lstrip('/')
  # Scope may already have disappeared, so inspect values during live execution instead.
  prog='import time;print(open("/proc/self/cgroup").read(),flush=True);time.sleep(2)'
  p=subprocess.Popen(egress.worker_command(home,out,sock,['python','-c',prog]),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  line=p.stdout.readline().strip()
  while not line.startswith('0::'):line=p.stdout.readline().strip()
  cg=Path('/sys/fs/cgroup')/line.split('::',1)[1].lstrip('/');limits={n:(cg/n).read_text().strip() for n in ['cpu.max','memory.max','memory.swap.max','pids.max']};p.communicate(timeout=5)
  assert limits['cpu.max']=='100000 100000' and limits['memory.max']=='2147483648' and limits['pids.max']=='64';save('live-model-cgroup-limits',limits)
  # Named role view prevents generator/evaluator cross-inputs and requires freeze.
  inputfile=scratch/'request';inputfile.write_text('request')
  errors={}
  for label,role,inputs,freeze in [('generator-unfrozen','generator',{'request':inputfile},None),('eval-code','eval_writer',{'candidate':inputfile},None),('generator-evals','generator',{'frozen_evals':inputfile},{'version':1,'frozen':True,'suiteSha256':'a'*64})]:
   try:egress.role_worker_command(role,home,out,sock,['true'],inputs,freeze)
   except ValueError as e:errors[label]=str(e)
   else:raise AssertionError('role bypass')
  save('role-authority',errors)
  role=egress.role_worker_command('eval_writer',home,out,sock,['sh','-c','cat /in/request; test ! -e /in/candidate; test ! -e /in/frozen_evals'],{'request':inputfile})
  observed=egress.run_bounded(role,timeout=10);assert observed['exit']==0;save('role-real-mounts',observed)
  # Native TLS ClientHello exercises exact SNI check without another model call.
  checks={}
  for name in ['chatgpt.com','evil.example']:
   incoming=ssl.MemoryBIO();outgoing=ssl.MemoryBIO();ctx=ssl.create_default_context();tls=ctx.wrap_bio(incoming,outgoing,server_hostname=name)
   try:tls.do_handshake()
   except ssl.SSLWantReadError:pass
   raw=outgoing.read();left,right=socket.socketpair();left.sendall(raw)
   try:
    try:egress.tls_client_hello(right,'chatgpt.com');checks[name]='accepted'
    except ValueError:checks[name]='denied'
   finally:left.close();right.close()
  assert checks=={'chatgpt.com':'accepted','evil.example':'denied'};save('sni-controls',checks)
 finally:
  if proxy:proxy.shutdown();proxy.server_close()
  shutil.rmtree(scratch)
 inp=A/'input';inp.write_text('capture\n');r=capture_attempt(A/'runner','capture','capture',inp,core.digest(inp),'cat /input.txt',3);assert r['outcome']=='captured' and not r['published'] and Path(r['stdoutPath']).read_text()=='capture\n';save('capture',r)
 s=Scheduler(root=A/'schedule',backoff_seconds=3);s.submit('rate-limited');s.step(lambda _: {'outcome':'subscription_limit'},100);t=Scheduler(root=A/'schedule');assert t.jobs[0]['state']=='blocked' and t.jobs[0]['eligible']==103;save('scheduler-durable',t.jobs)
 print(A)
if __name__=='__main__':main()
