"""No credentials/model calls: real idle Codex plus concurrent homepage TLS."""
import json,shutil,tempfile,uuid
from pathlib import Path
from . import core,egress
R=Path(__file__).resolve().parents[2];A=R/'campaigns/next50-20261018/runtime'/('transport-capacity-'+uuid.uuid4().hex[:8]);A.mkdir()
def main():
 scratch=Path(tempfile.mkdtemp(prefix='endoforge-transport-capacity-'));server=None
 try:
  home=scratch/'home';home.mkdir();out=scratch/'out';out.mkdir();sock=scratch/'proxy.sock';server=egress.serve(sock)
  script='''import subprocess,time,json,os
p=subprocess.Popen(['codex','app-server','--listen','stdio://'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE);time.sleep(.5)
status=open('/proc/'+str(p.pid)+'/status').read();threads=int([s.split()[1] for s in status.splitlines() if s.startswith('Threads:')][0]);jobs=[];results=[]
for i in range(12):
 try:jobs.append(subprocess.Popen(['curl','-sS','-o','/dev/null','-w','%{http_code}','--max-time','5','https://chatgpt.com/'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True))
 except OSError as e:results.append({'spawnError':e.errno})
for child in jobs:
 o,e=child.communicate();results.append({'exit':child.returncode,'status':o,'stderr':e})
p.kill();p.wait();check=subprocess.run(['curl','-sS','-o','/dev/null','-w','%{http_code}','--max-time','5','https://chatgpt.com/'],capture_output=True,text=True);print(json.dumps({'codexThreads':threads,'affinity':len(os.sched_getaffinity(0)),'results':results,'postPressureProbe':{'exit':check.returncode,'status':check.stdout,'stderr':check.stderr}}))
'''
  for name,limited in [('nofork-bounded',True)]:
   command=egress.worker_command(home,out,sock,['python','-c',script])
   if not limited:
    i=command.index('taskset');del command[i:i+3]
   result=egress.run_bounded(command,timeout=15);core.durable(A/(name+'.json'),result)
   if limited:
    j=json.loads(result['stdout']);assert result['exit']==0 and all(r.get('exit')==0 for r in j['results'] if 'spawnError' not in r) and j['postPressureProbe']['exit']==0,result
  core.durable(A/'proxy-events.json',server.events)
 finally:
  if server:server.shutdown();server.server_close()
  shutil.rmtree(scratch)
 print(A)
if __name__=='__main__':main()
