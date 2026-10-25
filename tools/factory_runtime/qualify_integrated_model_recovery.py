"""Actual controller SIGKILL around declared final wrapper+ModelJournal; no models."""
import hashlib,json,os,shlex,signal,subprocess,sys,time,uuid
from pathlib import Path
from . import core,egress
from .runner import run_attempt
from tools.factory_campaign.model_journal import ModelJournal,alive,identity
R=Path(__file__).resolve().parents[2];A=R/'campaigns/next50-20261018/runtime'/('model-recovery-'+uuid.uuid4().hex[:8])
def wrapper(journal,row,home,command):
 temporary=home.parent;proxy=egress.serve(temporary/'proxy.sock')
 argv=egress.role_worker_command('consumer',home,A,temporary/'proxy.sock',command,inputs={})
 argv[argv.index('--unit')+1]=row['scope'].removesuffix('.scope')
 argv[argv.index('--unit'):argv.index('--unit')]=['-p','Description='+journal.scope_description(row['attempt'])]
 return proxy,argv
def child(root):
 with ModelJournal(root/'journal') as journal:
  row=journal.new_attempt('interrupted-stage','deterministic-test',hashlib.sha256(b'deterministic-sleep').hexdigest());home=journal.private_home(row['attempt'])
  proxy,argv=wrapper(journal,row,home,['sh','-c','echo worker-ready; sleep 90'])
  journal.started(row['attempt']);core.durable(root/'owned-attempt.json',row)
  try:egress.run_bounded(argv,timeout=100)
  finally:proxy.shutdown();proxy.server_close()
def properties(unit):
 p=subprocess.run(['systemctl','--user','show',unit,'--property=LoadState','--property=ActiveState','--property=Description','--property=ControlGroup'],capture_output=True,text=True,check=True)
 return dict(line.split('=',1) for line in p.stdout.splitlines() if '=' in line)
def main():
 A.mkdir();core.durable(A/'precommit.json',{'version':1,'modelCalls':0,'sourceHashes':{str(p.relative_to(R)):core.digest(p) for p in Path(__file__).parent.glob('*.py')},'procedure':['actual final wrapper long deterministic worker','confirm active scope and identities','live-fence denial','SIGKILL controller','fresh ModelJournal cleanup-only reconcile','foreign scope preserved','new explicit retry succeeds','fake-worker success cannot publish'],'limits':{'workerMaxSeconds':100,'scopeSeconds':190}})
 foreign='endoforge-runtime-foreign-'+uuid.uuid4().hex
 fp=subprocess.Popen(['systemd-run','--user','--scope','--quiet','--unit',foreign,'-p','RuntimeMaxSec=30s','sleep','25'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 controller=None
 try:
  controller=subprocess.Popen([sys.executable,'-m','tools.factory_runtime.qualify_integrated_model_recovery','--child',str(A)],cwd=R,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  for _ in range(150):
   if (A/'owned-attempt.json').exists():
    row=json.loads((A/'owned-attempt.json').read_text());state=properties(row['scope'])
    if state.get('ActiveState')=='active':break
   if controller.poll() is not None:raise AssertionError(controller.communicate())
   time.sleep(.03)
  else:raise AssertionError('wrapper scope did not start')
  time.sleep(.15);state=properties(row['scope']);assert state['Description']=='endoforge-model-journal:'+row['attempt']
  cg=Path('/sys/fs/cgroup')/state['ControlGroup'].lstrip('/');members=[identity(int(pid)) for pid in (cg/'cgroup.procs').read_text().split()];assert any(alive(m) for m in members)
  live_refused=False
  try:
   with ModelJournal(A/'journal'):pass
  except RuntimeError:live_refused=True
  assert live_refused
  before={'scope':state,'members':members,'controller':identity(controller.pid),'foreign':properties(foreign+'.scope'),'liveControllerFenceDenied':True};core.durable(A/'before-kill.json',before)
  controller.kill();controller.wait(timeout=5);assert controller.returncode==-signal.SIGKILL
  with ModelJournal(A/'journal') as journal:
   recovered=journal.reconcile(row['attempt']);assert recovered['state']=='unknown' and recovered['cleanupComplete'] and not recovered['promotionAllowed'];assert not Path(row['temporary']).exists()
   assert not any(alive(m) for m in members)
   assert properties(foreign+'.scope')['ActiveState']=='active'
   try:journal.new_attempt('interrupted-stage','deterministic-test','a'*64)
   except RuntimeError:automatic_denied=True
   else:raise AssertionError('retry accepted without parent')
   retry=journal.new_attempt('interrupted-stage','deterministic-test','a'*64,retry_of=row['attempt']);home=journal.private_home(retry['attempt'])
   forbidden=shlex.quote(str(A/'journal'));cmd=['sh','-c',f'test ! -e {forbidden}; echo retry-ok']
   proxy,argv=wrapper(journal,retry,home,cmd);journal.started(retry['attempt'])
   try:result=egress.run_bounded(argv,timeout=10)
   finally:proxy.shutdown();proxy.server_close()
   assert result['exit']==0 and result['stdout'].strip()=='retry-ok';journal.finish(retry['attempt'],'passed',{'stdoutSha256':hashlib.sha256(result['stdout'].encode()).hexdigest()});clean=journal.cleanup_owned(retry['attempt']);assert not Path(retry['temporary']).exists()
  core.durable(A/'recovery-and-retry.json',{'version':1,'controllerExit':controller.returncode,'reconciled':recovered,'oldMembersDead':not any(alive(m) for m in members),'foreignPreserved':True,'implicitRetryDenied':automatic_denied,'retry':clean,'retryExecution':result,'modelCalls':0})
  # Independent host acceptance rejects a worker's forged success without any model.
  inp=A/'input';inp.write_text('7\n');sha=core.digest(inp)
  bad=run_attempt(A/'acceptance','forged-success','candidate',inp,sha,sha,"printf '{\"success\":true,\"value\":999}\\n'",3)
  good=run_attempt(A/'acceptance','known-good','candidate',inp,sha,sha,'cat /input.txt',3)
  duplicate=run_attempt(A/'acceptance','duplicate','candidate',inp,sha,sha,'cat /input.txt',3)
  assert bad['outcome']=='validation_failed' and not bad['published'];assert good['outcome']=='passed' and duplicate['outcome']=='duplicate_publication'
  core.durable(A/'independent-acceptance.json',{'version':1,'wrongWorkerClaimRejected':bad,'correctDigestAccepted':good,'duplicateRejected':duplicate,'publishedSha256':core.digest(A/'acceptance/published/candidate.txt')})
 finally:
  if controller and controller.poll() is None:controller.kill();controller.wait()
  subprocess.run(['systemctl','--user','stop',foreign+'.scope'],capture_output=True,check=True);fp.wait(timeout=5)
 print(A)
if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='--child':child(Path(sys.argv[2]))
 else:main()
