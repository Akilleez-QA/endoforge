import json,subprocess,uuid,time,threading
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
from . import runner,core
R=Path(__file__).resolve().parents[2];A=R/'campaigns/next50-20261018/runtime'/('faults-'+uuid.uuid4().hex[:8]);A.mkdir()
def save(n,v):core.durable(A/(n+'.json'),v)
def main():
 inp=A/'input';inp.write_text('ok\n');sha=core.digest(inp);root=A/'runner';results={}
 with patch.object(runner,'IMAGE','sha256:'+'0'*64):results['create']=runner.run_attempt(root,'create','create',inp,sha,sha,'cat /input.txt',3)
 assert results['create']['outcome']=='controller_error' and results['create']['cleanupVerified']
 original=runner.subprocess.run
 def run(argv,*a,**kw):
  if argv[:4]==['sudo','-n','docker','start']:return subprocess.CompletedProcess(argv,1,'','injected Docker client start failure')
  return original(argv,*a,**kw)
 with patch.object(runner.subprocess,'run',side_effect=run):results['start']=runner.run_attempt(root,'start','start',inp,sha,sha,'cat /input.txt',3)
 assert results['start']['outcome']=='controller_error' and results['start']['cleanupVerified']
 token=uuid.uuid4().hex;name='endoforge-v1-'+token
 subprocess.run(runner.DOCKER+['create','--name',name,'--label','endoforge.owner=FOREIGN','--network=none',runner.IMAGE,'sleep','30'],capture_output=True,check=True)
 try:
  with patch.object(runner.uuid,'uuid4',return_value=SimpleNamespace(hex=token)):results['collision']=runner.run_attempt(root,'collision','collision',inp,sha,sha,'cat /input.txt',3)
  row=json.loads(subprocess.check_output(runner.DOCKER+['inspect',name],text=True))[0]
  assert row['Config']['Labels']['endoforge.owner']=='FOREIGN' and results['collision']['outcome']=='cleanup_failed'
  results['foreignContainerPreserved']=True
 finally:subprocess.run(runner.DOCKER+['rm','-f',name],capture_output=True,check=True)
 mutable=A/'mutable';mutable.write_text('ok\n')
 def mutate():time.sleep(.4);mutable.write_text('changed\n')
 thread=threading.Thread(target=mutate);thread.start();results['inputChanged']=runner.run_attempt(root,'sourcechange','sourcechange',mutable,sha,sha,'sleep 1; cat /input.txt',3);thread.join();assert results['inputChanged']['outcome']=='input_changed'
 code='from tools.factory_runtime.runner import run_attempt;run_attempt(*'+repr([str(root),'terminate','terminate',str(inp),sha,sha,'sleep 20',30])+')'
 child=subprocess.Popen(['python','-c',code],cwd=R)
 for _ in range(100):
  journal=root/'journals/terminate.json'
  if journal.exists():
   j=json.loads(journal.read_text());probe=subprocess.run(runner.DOCKER+['inspect','--format','{{.State.Running}}',j['containerName']],capture_output=True,text=True)
   if probe.returncode==0 and probe.stdout.strip()=='true':break
  time.sleep(.03)
 else:child.kill();raise AssertionError('terminate worker never running')
 child.terminate();child.wait(timeout=15);results['sigterm']=json.loads((root/'attempts/terminate/result.json').read_text());assert results['sigterm']['outcome']=='interrupted' and results['sigterm']['cleanupVerified']
 save('faults',results);print(A)
if __name__=='__main__':main()
