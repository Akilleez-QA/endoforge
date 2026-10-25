import json,os,shutil,tempfile,uuid,time
from pathlib import Path
from . import core,egress
R=Path(__file__).resolve().parents[2];A=R/'campaigns/next50-20261018/runtime'/('transport-'+uuid.uuid4().hex[:8]);A.mkdir()
def main():
 scratch=Path(tempfile.mkdtemp(prefix='endoforge-transport-'));server=None
 try:
  home=scratch/'home';home.mkdir();out=scratch/'out';out.mkdir();sock=scratch/'proxy.sock';server=egress.serve(sock)
  # No auth is copied. Idle app-server has no initialized model request/client.
  script='''import subprocess,time,json,os
p=subprocess.Popen(["codex","app-server","--listen","stdio://"],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
samples=[]
for _ in range(20):
 time.sleep(.025)
 if p.poll() is not None:break
 status=open('/proc/'+str(p.pid)+'/status').read();samples.append(int([s.split()[1] for s in status.splitlines() if s.startswith('Threads:')][0]))
r=subprocess.run(['curl','-sS','-o','/dev/null','-w','%{http_code}','--max-time','8','https://chatgpt.com/'],capture_output=True,text=True)
p.kill();p.wait()
print(json.dumps({'codexThreads':samples,'maxThreads':max(samples,default=0),'curlExit':r.returncode,'httpCode':r.stdout,'curlStderr':r.stderr,'affinityCount':len(os.sched_getaffinity(0)),'cpuCount':os.cpu_count()}))
'''
  result=egress.run_bounded(egress.worker_command(home,out,sock,['python','-c',script]),timeout=15);core.durable(A/'native-codex-idle.json',result)
  # No model/auth/provider API request: HTTPS homepage only; 403 still proves TLS.
  urls=['https://chatgpt.com/']
  for i,url in enumerate(urls):
   command=['curl','-sS','-o','/dev/null','-w','%{http_code}','--max-time','8',url]
   r=egress.run_bounded(egress.worker_command(home,out,sock,command),timeout=12);core.durable(A/('tls-'+str(i)+'.json'),dict(r,url=url));assert r['exit']==0,r
  core.durable(A/'proxy-events.json',server.events)
 finally:
  if server:server.shutdown();server.server_close()
  shutil.rmtree(scratch)
 print(A)
if __name__=='__main__':main()
