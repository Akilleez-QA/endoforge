import hashlib,json,os,shutil,socket,subprocess,tempfile,time,uuid
from pathlib import Path
from . import core,egress
from .runner import run_attempt
from .recovery import reconcile
from .wasm import run as wasm_run
R=Path(__file__).resolve().parents[2];A=R/'campaigns/next50-20261018/runtime'/('attempt-'+uuid.uuid4().hex[:8]);A.mkdir()
def save(name,obj):core.durable(A/(name+'.json'),obj)
def main():
 save('env-before',{'kernel':os.uname().release,'load':os.getloadavg(),'cpu':os.cpu_count(),'git':subprocess.check_output(['git','rev-parse','HEAD'],cwd=R,text=True).strip(),'sourceHashes':{p.name:core.digest(p) for p in Path(__file__).parent.glob('*.py')}})
 inp=A/'input';inp.write_text('qualified\n');sha=core.digest(inp);root=A/'runner';results={}
 for name,script,expected,timeout in [('good','cat /input.txt',sha,3),('bad','echo wrong',sha,3),('missing','true',sha,3),('timeout','sleep 20',sha,.2),('trap','exit 7',sha,3),('duplicate','cat /input.txt',sha,3)]:
  result=run_attempt(root,name,'one' if name=='duplicate' else ('one' if name=='good' else name),inp,sha,expected,script,timeout);results[name]=result
 expected={'good':'passed','bad':'validation_failed','missing':'missing_output','timeout':'timeout','trap':'worker_failed','duplicate':'duplicate_publication'}
 assert all(results[k]['outcome']==v for k,v in expected.items()),results
 try:run_attempt(root,'good','other',inp,sha,sha,'true')
 except FileExistsError:results['reuse']='denied'
 else:raise AssertionError('attempt reuse')
 with core.Fence(root):
  try:reconcile(root,'good')
  except RuntimeError:results['liveFence']='denied'
  else:raise AssertionError('live reconcile')
 save('lifecycle',results)
 # Actual controller death and new-process recovery.
 code="from tools.factory_runtime.runner import run_attempt;run_attempt(*"+repr([str(root),'killed','killed',str(inp),sha,sha,'sleep 30',60])+")"
 p=subprocess.Popen(['python','-c',code],cwd=R)
 journal=root/'journals/killed.json'
 for _ in range(100):
  if journal.exists():break
  time.sleep(.03)
 time.sleep(.4);p.kill();p.wait();rec=reconcile(root,'killed');assert rec['outcome']=='interrupted_reconciled';save('hardkill',rec)
 # Epoch timeout (no fuel), fuel exhaustion, excessive memory, trap and good module.
 wats={'good':'(module (func (export "run") (result i32) i32.const 7))','loop':'(module (func (export "run") (loop br 0)))','memory':'(module (memory 1) (func (export "run") (result i32) i32.const 100 memory.grow))','trap':'(module (func (export "run") unreachable))'}
 wr={}
 for name,wat in wats.items():
  p=A/(name+'.wat');p.write_text(wat);wr[name]=wasm_run(p)
 assert wr['good']['exit']==0 and all(wr[n]['exit']!=0 for n in ['loop','memory','trap']),wr
 # independently epoch preemption, abundant fuel
 wr['epoch']=wasm_run(A/'loop.wat',fuel=10**15,epoch='10ms');assert wr['epoch']['exit']!=0;save('wasm',wr)
 # Hostile artifact importing actual symlink/hardlink/socket fixtures.
 hostile={};inp2=A/'private-peer';inp2.write_text('peer-secret');(A/'symlink').symlink_to(inp2);os.link(inp2,A/'hardlink');sock=socket.socket(socket.AF_UNIX);sock.bind(str(A/'socket'))
 for name in ['symlink','hardlink','socket']:
  try:core.import_regular(A/name,A/(name+'-import'))
  except (OSError,ValueError) as e:hostile[name]=repr(e)
  else:raise AssertionError(name+' accepted')
 sock.close();save('hostile-import',hostile)
 spec={'version':1,'job':'example','attempt':'example','input':str(inp),'inputSha256':sha,'expectedSha256':sha,'script':'cat /input.txt','timeoutSeconds':3};core.validate_spec(spec);save('job-spec-valid',spec)
 invalid={}
 for key,val in [('version',2),('job','../escape'),('timeoutSeconds',True),('expectedSha256','bogus')]:
  x=dict(spec);x[key]=val
  try:core.validate_spec(x)
  except ValueError as e:invalid[key]=str(e)
  else:raise AssertionError('invalid accepted')
 save('job-spec-invalid',invalid)
 save('authority',{'version':1,'roles':core.ROLES,'transitions':core.TRANSITIONS})
 from .scheduler import Scheduler
 s=Scheduler(capacity=2,backoff_seconds=2);s.submit('a');s.submit('b');s.submit('c');counts={}
 def job(j):counts[j]=counts.get(j,0)+1;return {'outcome':'subscription_limit' if j=='a' and counts[j]==1 else 'passed'}
 s.step(job,0);s.step(job,1);s.step(job,2);assert all(j['state']=='passed' for j in s.jobs);save('scheduler',s.jobs)
 save('env-after',{'load':os.getloadavg(),'results':'pass','sourceHashes':{p.name:core.digest(p) for p in Path(__file__).parent.glob('*.py')}})
 print(A)
if __name__=='__main__':main()
